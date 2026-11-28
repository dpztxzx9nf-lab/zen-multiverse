// 0.2.38: guns and Rattler camp combat. Inventory and drops are server-issued
// (one id, claimed once). Rattlers live on the Durable Object and shoot with
// the same lag-compensated hit scan the players use.
import { starterPistol, rollGun, publicGun, gunStats, validateGun, hash } from '../../js/game/guns.js';
import { campRoster, coverPoints, canSee, canHear, pickCover, flankPoint, stepToward, aimYaw, RATTLER_HP, NOISE_RANGE, STEP_RANGE, CALL_RANGE, SHOT_RANGE, SHOT_MS } from '../../js/game/rattlers.js';
import { surfaceDist } from './sphere.js';

const r2 = (v) => Math.round(v * 100) / 100;
const id16 = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16);

export class Combat {
  constructor(w) {
    this.w = w;
    this.sql = w.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS guns (
        id TEXT PRIMARY KEY, aid TEXT NOT NULL, data TEXT NOT NULL, origin TEXT, ts INTEGER);
      CREATE INDEX IF NOT EXISTS guns_aid ON guns(aid);
      CREATE TABLE IF NOT EXISTS gun_drops (
        id TEXT PRIMARY KEY, camp TEXT, x REAL, y REAL, z REAL, tile TEXT, data TEXT NOT NULL, claimed_by TEXT, ts INTEGER);
      CREATE TABLE IF NOT EXISTS rattler_dead (id TEXT PRIMARY KEY, camp TEXT, ts INTEGER);
      CREATE TABLE IF NOT EXISTS rattler_camps (
        key TEXT PRIMARY KEY, cx REAL, cz REAL, x REAL, y REAL, z REAL, tile TEXT, starter INTEGER, world TEXT, ts INTEGER);`);
    this.camps = new Map(); // key -> { key, cx, cz, x, y, z, tile, starter, rats: [], covers: [], lastSnap: 0 }
    this.noise = []; // { x, z, tile, t, range }
    this.lastTick = 0;
  }

  needsTick() { return this.camps.size > 0; }

  list(aid) {
    return this.sql.exec('SELECT id, data FROM guns WHERE aid = ?', aid).toArray().map((r) => {
      try { const g = JSON.parse(r.data); g.id = r.id; return g; } catch { return null; }
    }).filter(Boolean);
  }

  grantStarter(aid, t = Date.now()) {
    const id = 'st' + String(aid || '').replace(/[^0-9a-f]/gi, '').slice(0, 14);
    const have = this.list(aid);
    if (have.some((g) => g.starter || g.id === id)) return have;
    const g = starterPistol(id);
    this.sql.exec('INSERT OR IGNORE INTO guns (id, aid, data, origin, ts) VALUES (?, ?, ?, ?, ?)', id, aid, JSON.stringify(g), 'starter', t);
    return this.list(aid);
  }

  hello(ws, a, t = Date.now()) {
    const guns = this.grantStarter(a.aid, t).map(publicGun);
    this.w.send(ws, { t: 'rt', k: 'inv', guns });
    // a reconnect next to a known camp should wake it even if the client announce is late
    try { this.wakeNear(a, t, ws); } catch { /* */ }
    return guns;
  }

  equipped(a, gunId) {
    if (typeof gunId !== 'string' || gunId.length < 4 || gunId.length > 32) return null;
    const row = this.sql.exec('SELECT id, aid, data FROM guns WHERE id = ?', gunId).toArray()[0];
    if (!row || row.aid !== a.aid) return null;
    try {
      const g = JSON.parse(row.data); g.id = row.id;
      if (validateGun(g)) return null;
      g.stats = gunStats(g);
      return g;
    } catch { return null; }
  }

  hear(x, z, tile, t, range = NOISE_RANGE) {
    this.noise.push({ x, z, tile: tile || null, t, range });
    if (this.noise.length > 40) this.noise.splice(0, this.noise.length - 40);
  }

  recentNoise(t) { return this.noise.filter((n) => t - n.t < 1800); }

  async onMsg(ws, a, m, t) {
    const k = m && m.k;
    if (k === 'camp') return this.activate(ws, a, m, t);
    if (k === 'loot') return this.claim(ws, a, m, t);
    if (k === 'inv') { this.w.send(ws, { t: 'rt', k: 'inv', guns: this.list(a.aid).map(publicGun) }); return; }
    return this.w.strike(ws, a, 1, 'rt-type');
  }

  activate(ws, a, m, t) {
    if (a.x == null) return;
    const cx = +m.cx, cz = +m.cz, x = +m.x, z = +m.z, y = Number.isFinite(+m.y) ? +m.y : (a.y || 0);
    if (![cx, cz, x, z].every((v) => Number.isFinite(v))) return this.w.strike(ws, a, 1, 'camp-shape');
    const R = this.w.rulesOf(a);
    if (surfaceDist(a, { x, z, tile: m.tile || a.tile || null }, R.sphereR) > 140) return;
    const key = `${Math.round(cx)}:${Math.round(cz)}`;
    let camp = this.camps.get(key);
    if (!camp) {
      const roster = campRoster(hash(key, a.world || ''), cx, cz);
      const dead = new Set(this.sql.exec('SELECT id FROM rattler_dead WHERE camp = ?', key).toArray().map((r) => r.id));
      const rats = [];
      for (const slot of roster) {
        const id = 'ra' + hash(key, slot.i).toString(16).padStart(8, '0') + String(slot.i);
        if (dead.has(id)) continue;
        rats.push({
          id, camp: key, i: slot.i,
          x: x + slot.dx, y, z: z + slot.dz, yaw: slot.yaw, tile: m.tile || a.tile || null,
          hp: RATTLER_HP, hpMax: RATTLER_HP,
          st: 'idle', target: null, dest: null, lastShot: 0, called: 0,
        });
      }
      const covers = coverPoints(x, z, m.parts);
      camp = { key, cx, cz, x, y, z, tile: m.tile || a.tile || null, starter: !!m.starter, world: a.world || '', rats, covers, lastSnap: 0 };
      this.camps.set(key, camp);
      this.rememberCamp(camp, t);
      this.ensureCrateDrops(camp, t);
      try { this.w.ctx.storage.setAlarm(Date.now() + 80); } catch { /* */ }
    }
    this.snap(ws, camp, true);
    this.sendDrops(ws, camp.key);
  }

  rememberCamp(camp, t) {
    try {
      this.sql.exec(
        'INSERT OR REPLACE INTO rattler_camps (key, cx, cz, x, y, z, tile, starter, world, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        camp.key, camp.cx, camp.cz, camp.x, camp.y, camp.z, camp.tile || '', camp.starter ? 1 : 0, camp.world || '', t,
      );
    } catch { /* */ }
  }

  // Re-hydrate any stored camp the player is standing in range of (socket-open race, DO sleep, reconnect).
  wakeNear(a, t, ws = null) {
    if (!a || a.x == null) return;
    let rows = [];
    try { rows = this.sql.exec('SELECT key, cx, cz, x, y, z, tile, starter, world FROM rattler_camps').toArray(); } catch { return; }
    for (const row of rows) {
      const d = surfaceDist(a, { x: row.x, z: row.z, tile: row.tile || a.tile || null }, this.w.rulesOf(a).sphereR);
      if (!(d <= 140)) continue;
      let camp = this.camps.get(row.key);
      const fresh = !camp;
      if (!camp) camp = this.restoreCamp(row, t);
      if (!camp) continue;
      if (ws) { this.snap(ws, camp, true); this.sendDrops(ws, camp.key); }
      else if (fresh) { this.broadcastSnap(camp); this.broadcastDrops(camp.key); }
    }
  }

  restoreCamp(row, t) {
    const key = row.key;
    const cx = +row.cx, cz = +row.cz, x = +row.x, z = +row.z, y = Number.isFinite(+row.y) ? +row.y : 0;
    const roster = campRoster(hash(key, row.world || ''), cx, cz);
    let dead = new Set();
    try { dead = new Set(this.sql.exec('SELECT id FROM rattler_dead WHERE camp = ?', key).toArray().map((r) => r.id)); } catch { /* */ }
    const rats = [];
    for (const slot of roster) {
      const id = 'ra' + hash(key, slot.i).toString(16).padStart(8, '0') + String(slot.i);
      if (dead.has(id)) continue;
      rats.push({
        id, camp: key, i: slot.i,
        x: x + slot.dx, y, z: z + slot.dz, yaw: slot.yaw, tile: row.tile || null,
        hp: RATTLER_HP, hpMax: RATTLER_HP,
        st: 'idle', target: null, dest: null, lastShot: 0, called: 0,
      });
    }
    const covers = coverPoints(x, z);
    const camp = { key, cx, cz, x, y, z, tile: row.tile || null, starter: !!row.starter, world: row.world || '', rats, covers, lastSnap: 0 };
    this.camps.set(key, camp);
    this.ensureCrateDrops(camp, t);
    try { this.w.ctx.storage.setAlarm(Date.now() + 80); } catch { /* */ }
    return camp;
  }

  ensureCrateDrops(camp, t) {
    const existing = this.sql.exec('SELECT id FROM gun_drops WHERE camp = ?', camp.key).toArray();
    if (existing.length) return;
    const n = camp.starter ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const id = id16();
      const g = rollGun(hash(camp.key, 'crate', i), { id });
      const ang = (i / Math.max(1, n)) * Math.PI * 2 + 0.4;
      const x = r2(camp.x + Math.cos(ang) * 1.6), z = r2(camp.z + Math.sin(ang) * 1.6);
      this.sql.exec('INSERT OR IGNORE INTO gun_drops (id, camp, x, y, z, tile, data, claimed_by, ts) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)',
        id, camp.key, x, camp.y, z, camp.tile || '', JSON.stringify(g), t);
    }
  }

  drops(campKey) {
    return this.sql.exec('SELECT id, camp, x, y, z, tile, data, claimed_by FROM gun_drops WHERE camp = ?', campKey).toArray().map((r) => {
      let g = null; try { g = JSON.parse(r.data); } catch { /* */ }
      return { id: r.id, camp: r.camp, x: r.x, y: r.y, z: r.z, tile: r.tile || null, claimed: !!r.claimed_by, gun: r.claimed_by ? null : publicGun(g) };
    });
  }

  sendDrops(ws, campKey) { this.w.send(ws, { t: 'rt', k: 'drops', camp: campKey, drops: this.drops(campKey) }); }
  broadcastDrops(campKey) { this.w.broadcast({ t: 'rt', k: 'drops', camp: campKey, drops: this.drops(campKey) }, null); }

  claim(ws, a, m, t) {
    const id = m && m.id;
    if (typeof id !== 'string' || id.length < 8 || id.length > 32) return this.w.strike(ws, a, 1, 'loot-id');
    const row = this.sql.exec('SELECT id, camp, x, y, z, tile, data, claimed_by FROM gun_drops WHERE id = ?', id).toArray()[0];
    if (!row) { this.w.send(ws, { t: 'rt', k: 'loot', id, ok: false, why: 'gone' }); return; }
    if (row.claimed_by) { this.w.send(ws, { t: 'rt', k: 'loot', id, ok: false, why: 'taken' }); return; }
    if (a.x == null) return;
    const R = this.w.rulesOf(a);
    if (surfaceDist(a, { x: row.x, z: row.z, tile: row.tile || a.tile || null }, R.sphereR) > 8) {
      this.w.send(ws, { t: 'rt', k: 'loot', id, ok: false, why: 'far' }); return;
    }
    this.sql.exec('UPDATE gun_drops SET claimed_by = ?, ts = ? WHERE id = ? AND claimed_by IS NULL', a.aid, t, id);
    const after = this.sql.exec('SELECT claimed_by FROM gun_drops WHERE id = ?', id).toArray()[0];
    if (!after || after.claimed_by !== a.aid) { this.w.send(ws, { t: 'rt', k: 'loot', id, ok: false, why: 'taken' }); return; }
    let g; try { g = JSON.parse(row.data); } catch { return this.w.strike(ws, a, 1, 'loot-data'); }
    if (validateGun(g)) return this.w.strike(ws, a, 1, 'loot-shape');
    g.id = id;
    try {
      this.sql.exec('INSERT INTO guns (id, aid, data, origin, ts) VALUES (?, ?, ?, ?, ?)', id, a.aid, JSON.stringify(g), 'drop:' + (row.camp || ''), t);
    } catch {
      this.w.send(ws, { t: 'rt', k: 'loot', id, ok: false, why: 'dupe' }); return;
    }
    this.w.send(ws, { t: 'rt', k: 'loot', id, ok: true, gun: publicGun(g) });
    this.w.send(ws, { t: 'rt', k: 'inv', guns: this.list(a.aid).map(publicGun) });
    this.broadcastDrops(row.camp);
  }

  rayHit(ox, oy, oz, dx, dy, dz, maxD, rayCapsule) {
    let hit = null, hitD = maxD;
    for (const camp of this.camps.values()) {
      for (const rat of camp.rats) {
        if (!rat || rat.st === 'dead' || rat.hp <= 0) continue;
        const d = rayCapsule(ox, oy, oz, dx, dy, dz, rat.x, rat.y || 0, rat.z, 0.38, 1.7, maxD);
        if (d != null && d < hitD) { hitD = d; hit = rat; }
      }
    }
    return hit ? { r: hit, d: hitD } : null;
  }

  hurt(rat, dmg, by, t) {
    if (!rat || rat.st === 'dead') return null;
    rat.hp -= dmg;
    const killed = rat.hp <= 0;
    if (killed) {
      rat.hp = 0; rat.st = 'dead'; rat.target = null;
      try { this.sql.exec('INSERT OR REPLACE INTO rattler_dead (id, camp, ts) VALUES (?, ?, ?)', rat.id, rat.camp, t); } catch { /* */ }
      this.dropFrom(rat, t);
    } else {
      rat.st = rat.st === 'idle' ? 'alert' : rat.st;
      if (by && by.aid) rat.target = by.aid;
      this.callFriends(rat, t);
    }
    const camp = this.camps.get(rat.camp);
    if (camp) this.broadcastSnap(camp);
    return { id: rat.id, hp: Math.max(0, rat.hp), killed, camp: rat.camp };
  }

  dropFrom(rat, t) {
    const id = id16();
    const g = rollGun(hash(rat.camp, rat.id, 'drop'), { id });
    this.sql.exec('INSERT OR IGNORE INTO gun_drops (id, camp, x, y, z, tile, data, claimed_by, ts) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)',
      id, rat.camp, r2(rat.x), rat.y || 0, r2(rat.z), rat.tile || '', JSON.stringify(g), t);
    this.broadcastDrops(rat.camp);
  }

  callFriends(rat, t) {
    if (!rat || t - (rat.called || 0) < 2000) return;
    rat.called = t;
    for (const camp of this.camps.values()) {
      for (const o of camp.rats) {
        if (o === rat || o.st === 'dead') continue;
        const d = Math.hypot(o.x - rat.x, o.z - rat.z);
        if (d > CALL_RANGE && o.camp !== rat.camp) continue;
        if (o.st === 'idle') o.st = 'alert';
        if (rat.target) o.target = rat.target;
      }
    }
  }

  players() {
    return this.w.ctx.getWebSockets().map((s) => this.w.att(s)).filter((o) => o && o.aid && o.x != null);
  }

  async tick(t) {
    if (t - this.lastTick < 80) return;
    const dt = Math.min(0.4, (t - (this.lastTick || t)) / 1000) || 0.2;
    this.lastTick = t;
    const players = this.players();
    for (const p of players) this.wakeNear(p, t);
    if (!this.camps.size) return;
    const noises = this.recentNoise(t);
    let dirty = new Set();
    for (const camp of this.camps.values()) {
      for (const rat of camp.rats) {
        if (rat.st === 'dead') continue;
        const before = rat.x + ',' + rat.z + ',' + rat.st + ',' + rat.hp;
        this.stepRat(rat, camp, players, noises, t, dt);
        if (rat.x + ',' + rat.z + ',' + rat.st + ',' + rat.hp !== before) dirty.add(camp);
      }
    }
    for (const camp of dirty) this.broadcastSnap(camp);
  }

  stepRat(rat, camp, players, noises, t, dt) {
    let noticed = null;
    for (const p of players) {
      const d = Math.hypot(p.x - rat.x, p.z - rat.z);
      if (canSee(rat, p, rat.yaw)) { noticed = p; break; }
      if (d < STEP_RANGE && (p.vx || p.vz || p.moving)) { noticed = p; break; }
    }
    if (!noticed) {
      for (const n of noises) if (canHear(rat, n, n.range || NOISE_RANGE)) {
        noticed = players.find((p) => Math.hypot(p.x - n.x, p.z - n.z) < 8) || players[0];
        break;
      }
    }
    if (noticed) {
      rat.target = noticed.aid;
      if (rat.st === 'idle') rat.st = 'alert';
      this.callFriends(rat, t);
    }
    const target = rat.target ? players.find((p) => p.aid === rat.target) : null;
    if (!target) {
      if (rat.st !== 'idle' && rat.st !== 'dead') {
        // go back toward the camp if the target left
        const home = stepToward(rat, { x: camp.x, z: camp.z }, dt, 2.4);
        rat.x = home.x; rat.z = home.z; rat.yaw = home.yaw;
        if (home.arrived) rat.st = 'idle';
      }
      return;
    }
    const dist = Math.hypot(target.x - rat.x, target.z - rat.z);
    rat.yaw = aimYaw(rat, target);
    if (rat.st === 'alert') {
      const cov = pickCover(rat, target, camp.covers);
      rat.dest = cov;
      rat.st = 'cover';
    }
    if (rat.st === 'cover' && rat.dest) {
      const s = stepToward(rat, rat.dest, dt);
      rat.x = s.x; rat.z = s.z; rat.yaw = aimYaw(rat, target);
      if (s.arrived) rat.st = 'flank';
    }
    if (rat.st === 'flank') {
      if (!rat.dest || Math.hypot((rat.dest.x - rat.x), (rat.dest.z - rat.z)) < 0.4) rat.dest = flankPoint(rat, target, camp.covers);
      const s = stepToward(rat, rat.dest, dt);
      rat.x = s.x; rat.z = s.z; rat.yaw = aimYaw(rat, target);
    }
    if (dist < SHOT_RANGE && t - (rat.lastShot || 0) >= SHOT_MS) {
      rat.lastShot = t;
      rat.st = 'flank';
      try { this.w.npcFire(rat, target, t); } catch (e) { console.warn('[combat] npcFire', e && e.message); }
    }
  }

  wireRat(rat) {
    return { id: rat.id, camp: rat.camp, x: r2(rat.x), y: r2(rat.y || 0), z: r2(rat.z), yaw: r2(rat.yaw || 0), tile: rat.tile || null, hp: rat.hp, hpMax: rat.hpMax, st: rat.st };
  }

  snap(ws, camp, full) {
    this.w.send(ws, { t: 'rt', k: full ? 'st' : 'p', camp: camp.key, rats: camp.rats.map((r) => this.wireRat(r)) });
  }

  broadcastSnap(camp) {
    this.w.broadcast({ t: 'rt', k: 'p', camp: camp.key, rats: camp.rats.map((r) => this.wireRat(r)) }, null);
  }
}
