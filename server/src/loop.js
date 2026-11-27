// Xenia's core loop on the server (rules: js/xenia/loop.js). The server alone decides every part of a fight:
//   kit     the weapons and ammo you carry for fighting (granted by supply crates and the stations, spent by
//           boxes): a client can't fight with something the server didn't give it
//   health  hits, downs, respawns and regeneration
//   melee   reach (rewound target position), facing, the weapon's own swing rate, the region's rules
//   guns    rounds in the magazine, the reserve, fire rate, reload time, recoil added to the aim, hitscan
//           against rewound bodies, damage falloff and headshots
//   raids   build pieces take blows only where the region allows it (contested: only while a builder has been
//           on lately; wild: always), and break when they've taken their material's worth; builders repair
//   loot    supply crates (storage fixtures of kind 'loot') stand at fixed spots and refill when emptied
// Bad or early intents are refused with a reason ({t:'cb',k:'no'}) or dropped; never a strike, never a kick.
//
// Protocol {t:'cb'}. Client: hello, eq {w}, sw {id|piece, ago}, fire {d:[x,y,z], ago}, rl, fix {piece}, up.
// Server: st {hp, kit, w, mag, rl, down}, hit {by, to, dmg, hp, head}, ko {id, by}, shot {by, o, d, n, tile},
// ph {id, left}, raid {id, by}, no {why}, click.
import { HP, RESPAWN_MS, REGEN_AFTER, REGEN, WEAPONS, isKit, meleeDamage, meleeSpec, FACING, BODY_R, GUNS, EYE, CAP_R, CAP_H, HEAD_Y,
  recoil, kickAim, gunDamage, rayBody, pvpOk, raidOk, PIECE_J, pieceHitJ, REPAIR_K, LOOT_MS, rollLoot, CRATE_SPOTS } from '../../js/xenia/loop.js';
import { MELEE } from '../../js/game/g7/melee.js';
import { hubHeight } from '../../js/xenia/xenia.js';
import { WORLD_SPAWN } from '../../js/spawn.js';

const r2 = (v) => Math.round(v * 100) / 100;
const MELEE_AGO = 250, GUN_AGO = 400; // ms of lag the server rewinds for (the world keeps 1 s of history)
const W_OF = Object.fromEntries(Object.entries(WEAPONS).map(([k, w]) => [w, k])); // 'bat' -> 'w_bat'

export class Loop {
  constructor(w) {
    this.w = w; this.sql = w.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS fighters (aid TEXT PRIMARY KEY, hp REAL, kit TEXT, mag TEXT, hurtT INTEGER, downT INTEGER, ts INTEGER);
      CREATE TABLE IF NOT EXISTS piecedmg (id TEXT PRIMARY KEY, j REAL);`);
    this.raidT = new Map();
  }
  get dev() { return this.w.env && this.w.env.LOCAL_DEV === '1'; }
  // ---- state
  load(aid) {
    const r = this.sql.exec('SELECT * FROM fighters WHERE aid = ?', aid).toArray()[0];
    return r ? { aid, hp: r.hp, kit: JSON.parse(r.kit || '{}'), mag: JSON.parse(r.mag || '{}'), hurtT: r.hurtT || 0, downT: r.downT || 0 }
      : { aid, hp: HP, kit: {}, mag: {}, hurtT: 0, downT: 0 };
  }
  save(s) { this.sql.exec('INSERT OR REPLACE INTO fighters (aid, hp, kit, mag, hurtT, downT, ts) VALUES (?, ?, ?, ?, ?, ?, ?)', s.aid, s.hp, JSON.stringify(s.kit), JSON.stringify(s.mag), s.hurtT, s.downT, Date.now()); }
  has(s, k, n = 1) { return (s.kit[k] || 0) >= n; }
  // time passes: health comes back out of the fight; a reload in progress finishes
  settle(s, a, t) {
    if (!s.downT && s.hp < HP && t - s.hurtT > REGEN_AFTER) { const from = Math.max(s.hurtT + REGEN_AFTER, s.regT || 0); s.hp = Math.min(HP, s.hp + REGEN * (t - from) / 1000); s.regT = t; }
    if (a && a.rlT && t >= a.rlT) {
      const G = GUNS[a.rlG], have = s.mag[a.rlG] || 0, want = G.mag - have, got = Math.min(want, s.kit[G.ammo] || 0);
      s.mag[a.rlG] = have + got; s.kit[G.ammo] = (s.kit[G.ammo] || 0) - got; if (!s.kit[G.ammo]) delete s.kit[G.ammo];
      a.rlT = 0; a.rlG = null;
    }
    return s;
  }
  view(s, a) { return { t: 'cb', k: 'st', hp: Math.round(s.hp), kit: s.kit, w: a.cw || 'hand', mag: s.mag, rl: a.rlT ? a.rlT - Date.now() : 0, down: s.downT ? Math.max(0, s.downT + RESPAWN_MS - Date.now()) : 0 }; }
  tell(ws, a, s) { this.w.send(ws, this.view(s, a)); }
  no(ws, why) { this.w.send(ws, { t: 'cb', k: 'no', why }); }
  // ---- the kit: storage (crates, boxes) and crafting call these
  grant(aid, k, n) {
    if (!isKit(k) || !(n > 0)) return; const s = this.load(aid); s.kit[k] = (s.kit[k] || 0) + n; this.save(s);
    const ws = this.w.games.sock(aid), a = ws && this.w.att(ws); if (ws && a) this.tell(ws, a, s);
  }
  spend(aid, k, n) { // true when the kit had it (and now doesn't)
    const s = this.load(aid); if (!this.has(s, k, n)) return false;
    s.kit[k] -= n; if (!s.kit[k]) delete s.kit[k];
    const a = this.w.games.sock(aid) && this.w.att(this.w.games.sock(aid));
    if (a && a.cw && W_OF[a.cw] === k && !s.kit[k]) a.cw = 'hand';
    this.save(s); return true;
  }
  crafted(a, recipe) { const tool = recipe && recipe.give && recipe.give.tool && recipe.give.tool[0]; if (MELEE[tool]) this.grant(a.aid, W_OF[tool], 1); }
  // ---- where we are
  risk(a, p = a) {
    if (this.dev && a.rgx) return a.rgx;
    const r = this.w.regionOf(a, p); return r ? r.risk : 'safe';
  }
  // ---- supply crates
  seed(a) {
    if (!this.w.isX(a) || this.seeded) return; this.seeded = true;
    const st = this.w.games.st, t = Date.now();
    for (const c of CRATE_SPOTS) {
      if (st.get(c.id)) continue;
      const risk = this.risk({ ...a, rgx: null }, { x: c.x, z: c.z, tile: null });
      this.sql.exec('INSERT INTO fixtures (id, kind, x, y, z, yaw, tile, owner, oname, hp, inv, allow, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        c.id, 'loot', c.x, r2(hubHeight(c.x, c.z)), c.z, 0, '', 'world', 'the world', 0, JSON.stringify(rollLoot(risk)), '[]', t);
    }
  }
  refill(f, a) { // an emptied supply crate fills again once it has stood empty long enough
    if (f.kind !== 'loot' || Object.keys(f.inv).length || Date.now() - f.ts < LOOT_MS) return f;
    f.inv = rollLoot(this.risk({ ...a, rgx: null }, f)); this.w.games.st.saveInv(f); return f;
  }
  hello(ws, a) { this.seed(a); const s = this.settle(this.load(a.aid), a, Date.now()); this.tell(ws, a, s); }

  async msg(ws, a, m, t) {
    if (a.x == null) return this.no(ws, 'Take a step first.');
    const s = this.settle(this.load(a.aid), a, t);
    try {
      switch (m.k) {
        case 'hello': break;
        case 'eq': this.equip(ws, a, s, m); break;
        case 'sw': this.swing(ws, a, s, m, t); break;
        case 'fire': this.fire(ws, a, s, m, t); break;
        case 'rl': this.reload(ws, a, s, t); break;
        case 'fix': this.repair(ws, a, s, m, t); break;
        case 'up': this.up(ws, a, s, t); break;
        case 'dev': // local wrangler dev only (tests): stand in a region, carry a kit
          if (!this.dev) return this.no(ws, 'Not a thing you can do.');
          if ('risk' in m && ['safe', 'guarded', 'contested', 'wild', null].includes(m.risk)) a.rgx = m.risk || null;
          if (m.kit && typeof m.kit === 'object') s.kit = Object.fromEntries(Object.entries(m.kit).filter(([k, n]) => isKit(k) && Number.isInteger(n) && n > 0));
          break;
        default: return this.no(ws, 'Not a thing you can do.');
      }
    } finally { this.save(s); ws.serializeAttachment(a); }
    if (['eq', 'rl', 'up', 'hello', 'fire', 'dev'].includes(m.k)) this.tell(ws, a, s);
  }
  equip(ws, a, s, m) {
    const w = typeof m.w === 'string' ? m.w : '';
    if (w === 'hand') { a.cw = 'hand'; return; }
    if (!W_OF[w]) return this.no(ws, 'Nothing like that to hold.');
    if (!this.has(s, W_OF[w])) return this.no(ws, `You have no ${w}.`);
    a.cw = w; a.rlT = 0;
  }
  // ---- melee: a swing at a person or at a build piece
  swing(ws, a, s, m, t) {
    if (s.downT) return;
    const w = a.cw && a.cw !== 'pistol' ? a.cw : 'hand', spec = meleeSpec(w);
    if (w !== 'hand' && !this.has(s, W_OF[w])) { a.cw = 'hand'; return this.no(ws, `You have no ${w}.`); }
    if (t - (a.swT || 0) < spec.every * 1000 * 0.9) return; // faster than the weapon swings: dropped
    a.swT = t;
    if (typeof m.piece === 'string') return this.hitPiece(ws, a, w, spec, m.piece, t);
    const tws = typeof m.id === 'string' ? this.w.games.sock(m.id) : null, o = tws && this.w.att(tws);
    if (!o || o.aid === a.aid || o.x == null || (o.tile || null) !== (a.tile || null) || this.w.blocked(a.aid, o.aid)) return;
    const ago = Math.max(0, Math.min(MELEE_AGO, +m.ago || 0)), p = this.w.rewind(o.aid, t - ago, { x: o.x, y: o.y, z: o.z, tile: o.tile });
    const d = this.w.dist(a, p);
    if (d > spec.reach + BODY_R + 0.3) return this.no(ws, 'Out of reach.');
    const fx = Math.sin(a.yaw || 0), fz = Math.cos(a.yaw || 0), tx = p.x - a.x, tz = p.z - a.z, tl = Math.hypot(tx, tz);
    if (tl > 0.3 && Math.acos(Math.max(-1, Math.min(1, (fx * tx + fz * tz) / tl))) > FACING) return this.no(ws, 'Face them to land it.');
    if (!pvpOk(this.risk(a)) || !pvpOk(this.risk(o, p))) return this.no(ws, 'No fighting here.');
    this.hurt(tws, o, meleeDamage(w), a, t, false);
  }
  hitPiece(ws, a, w, spec, id, t) {
    const row = this.sql.exec('SELECT id, tile, typ, mat, x, y, z, aid FROM builds WHERE id = ?', id).toArray()[0];
    if (!row || (row.tile || null) !== (a.tile || null)) return;
    if (this.w.dist(a, { x: row.x, z: row.z, tile: row.tile || null }) > spec.reach + 1.5) return this.no(ws, 'Out of reach.');
    if (row.aid === a.aid) return this.no(ws, 'Your own: take it down with the building kit.');
    const risk = this.risk(a, { x: row.x, z: row.z, tile: row.tile || null });
    const seen = this.seenAgo(row.aid, t);
    if (!raidOk(risk, seen)) return this.no(ws, risk === 'contested' ? 'Its builder is away: bases here can only be raided while their builder is around.' : 'Nobody raids here.');
    const J = PIECE_J[row.mat] || PIECE_J.wood, got = pieceHitJ(w, row.mat);
    const had = this.sql.exec('SELECT j FROM piecedmg WHERE id = ?', id).toArray()[0]?.j || 0, j = had + got;
    const ows = row.aid && this.w.games.sock(row.aid);
    if (ows && t - (this.raidT.get(row.aid) || 0) > 30e3) { this.raidT.set(row.aid, t); this.w.send(ows, { t: 'cb', k: 'raid', id, by: a.name, x: r2(row.x), z: r2(row.z), tile: row.tile || null }); }
    if (j >= J) {
      this.sql.exec('DELETE FROM builds WHERE id = ?', id); this.sql.exec('DELETE FROM piecedmg WHERE id = ?', id);
      this.w.broadcast({ t: 'e', k: 'build', op: 'remove', id, tile: row.tile || '', by: a.aid }, null, a.aid);
      return;
    }
    this.sql.exec('INSERT OR REPLACE INTO piecedmg (id, j) VALUES (?, ?)', id, j);
    this.w.broadcast({ t: 'cb', k: 'ph', id, left: r2(1 - j / J) }, null, a.aid);
  }
  seenAgo(aid, t) {
    if (!aid) return Infinity;
    if (this.w.games.sock(aid)) return 0;
    const r = this.sql.exec('SELECT ts FROM lastpos WHERE aid = ?', aid).toArray()[0];
    return r ? t - r.ts : Infinity;
  }
  repair(ws, a, s, m, t) {
    const row = typeof m.piece === 'string' ? this.sql.exec('SELECT id, tile, mat, x, z, aid FROM builds WHERE id = ?', m.piece).toArray()[0] : null;
    if (!row) return;
    if (row.aid !== a.aid) return this.no(ws, 'Only its builder can patch it.');
    if (this.w.dist(a, { x: row.x, z: row.z, tile: row.tile || null }) > 3) return this.no(ws, 'Stand by it to patch it.');
    if (t - (a.fixT || 0) < 1000) return; a.fixT = t;
    const J = PIECE_J[row.mat] || PIECE_J.wood, had = this.sql.exec('SELECT j FROM piecedmg WHERE id = ?', row.id).toArray()[0]?.j || 0;
    const j = Math.max(0, had - J * REPAIR_K);
    this.sql.exec('INSERT OR REPLACE INTO piecedmg (id, j) VALUES (?, ?)', row.id, j);
    this.w.broadcast({ t: 'cb', k: 'ph', id: row.id, left: r2(1 - j / J) }, null);
  }
  // ---- guns
  fire(ws, a, s, m, t) {
    if (s.downT) return;
    const g = a.cw, G = GUNS[g];
    if (!G || !this.has(s, G.item)) return this.no(ws, 'No gun in hand.');
    if (!pvpOk(this.risk(a))) return this.no(ws, 'Holstered: no shooting here.');
    if (a.rlT) return this.no(ws, 'Reloading.');
    if (t - (a.shotT || 0) < G.every * 1000 * 0.85) return; // faster than the gun cycles: dropped
    if (!(s.mag[g] > 0)) { this.w.send(ws, { t: 'cb', k: 'click' }); return; }
    const d = Array.isArray(m.d) && m.d.length === 3 && m.d.every((v) => typeof v === 'number' && Number.isFinite(v)) ? m.d : null;
    const len = d ? Math.hypot(d[0], d[1], d[2]) : 0;
    if (len < 0.5 || len > 1.5) return this.no(ws, 'Aim somewhere.');
    const n = t - (a.shotT || 0) < G.settle * 1000 ? (a.shotN || 0) + 1 : 0;
    a.shotN = n; a.shotT = t; s.mag[g] -= 1;
    const dir = kickAim([d[0] / len, d[1] / len, d[2] / len], recoil(g, n));
    const when = t - Math.max(0, Math.min(GUN_AGO, +m.ago || 0));
    const me = this.w.rewind(a.aid, when, { x: a.x, y: a.y, z: a.z, tile: a.tile }), o = [me.x, me.y + EYE, me.z];
    let best = null;
    for (const sock of this.w.ctx.getWebSockets()) {
      const b = this.w.att(sock);
      if (!b || b.aid === a.aid || b.x == null || (b.tile || null) !== (a.tile || null) || this.w.blocked(a.aid, b.aid)) continue;
      if (this.load(b.aid).downT) continue;
      const p = this.w.rewind(b.aid, when, { x: b.x, y: b.y, z: b.z, tile: b.tile });
      const h = rayBody(o, dir, [p.x, p.y, p.z], CAP_R, CAP_H, G.range);
      if (h && (!best || h.d < best.h.d)) best = { sock, b, p, h };
    }
    this.w.broadcast({ t: 'cb', k: 'shot', by: a.aid, o: o.map(r2), d: dir.map((v) => r2(v * 1000) / 1000), n, tile: a.tile || null }, null);
    if (best && pvpOk(this.risk(best.b, best.p))) this.hurt(best.sock, best.b, gunDamage(g, best.h.d, best.h.y > HEAD_Y), a, t, best.h.y > HEAD_Y);
  }
  reload(ws, a, s, t) {
    const g = a.cw, G = GUNS[g];
    if (!G || !this.has(s, G.item)) return this.no(ws, 'No gun in hand.');
    if (a.rlT) return;
    if ((s.mag[g] || 0) >= G.mag) return this.no(ws, 'Magazine full.');
    if (!(s.kit[G.ammo] > 0)) return this.no(ws, `No ${G.ammo.replace('ammo_', '')} rounds left.`);
    a.rlT = t + G.reload * 1000; a.rlG = g;
  }
  // ---- health
  hurt(tws, o, dmg, by, t, head) {
    const s = this.settle(this.load(o.aid), o, t); if (s.downT || dmg <= 0) return;
    s.hp = Math.max(0, s.hp - dmg); s.hurtT = t; s.regT = 0;
    const hit = { t: 'cb', k: 'hit', by: by.aid, to: o.aid, dmg, hp: Math.round(s.hp), head: !!head };
    this.w.broadcast(hit, null);
    if (s.hp <= 0) {
      s.downT = t; o.rlT = 0;
      // what drops: the rounds you carried and the gun; your melee weapons stay with you
      const inv = {};
      for (const [k, n] of Object.entries(s.kit)) if (k.startsWith('ammo_') || k === 'w_pistol') { inv[k] = n; delete s.kit[k]; }
      for (const [g, n] of Object.entries(s.mag)) if (n > 0) { const G = GUNS[g]; inv[G.ammo] = (inv[G.ammo] || 0) + n; s.mag[g] = 0; }
      if (o.cw === 'pistol') o.cw = 'hand';
      if (Object.keys(inv).length) this.w.games.st.spillAt(o, inv, t);
      this.w.broadcast({ t: 'cb', k: 'ko', id: o.aid, by: by.aid, name: o.name }, null);
    }
    this.save(s);
    if (tws) { tws.serializeAttachment(o); this.tell(tws, o, s); }
  }
  up(ws, a, s, t) {
    if (!s.downT) return;
    if (t - s.downT < RESPAWN_MS) return this.no(ws, 'Not yet.');
    s.downT = 0; s.hp = HP; s.hurtT = 0;
    // back at the hub's arrival stone (a re-seat: the server moves her, the client follows the fix)
    a.x = WORLD_SPAWN.x; a.z = WORLD_SPAWN.z; a.y = 0; a.tile = null; a.lt = t; a.fid = (a.fid || 0) + 1; a.fx = a.fid;
    this.w.hist.delete(a.aid);
    this.w.send(ws, { t: 'fix', id: a.fid, s: 0, x: a.x, y: a.y, z: a.z, tile: null, why: 'respawn' });
  }
}
