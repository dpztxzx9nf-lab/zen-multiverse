// One World Durable Object per world key (+ shard). Holds the live sockets for that world, checks every
// message, relays validated poses + chat + world edits, and keeps nothing a client could forge: names,
// ids, mute and block lists all come from the signed ticket the Worker verified, never from the client.
// Uses the WebSocket Hibernation API: when nobody is moving or talking the object sleeps (no duration
// billing) while sockets stay open; per-socket state lives in serializeAttachment (keep it small).
import { DurableObject } from 'cloudflare:workers';
import { cleanChat } from './filter.js';
import { parseWorld, RULES, PIECE_TYPES, PIECE_MATS, rulesFor, WORLD_SPAWN, WORLD_OWNER } from './worlds.js';
const SHARED_CAP = 48; // the one shared world (one DO); regional and skill-based servers come later
import { surfaceDist, tileOk, makeFrame, arc } from './sphere.js';
import { parseAb, maxRise, JUMP_V } from './physics.js';
import { Factions } from './factions.js';
import { Games } from './games.js';
import { migrateGardenFrame } from './garden-migrate.js';
import { isLegacyGardenTile, liftGardenPose, inGardenArea } from '../../js/hub.js';
import { PROTOCOL } from './protocol.js';
import { devAllowed } from './dev.js';
import { wipeStaleTerrain } from './world-gen-wipe.js';
import { Combat } from './combat.js';

const MAX_MSG = 65536;          // bytes per client message (a dig's voxel edits are the big ones; clients split at ~12 KB)
const POSE_MAX = 1024;
const CHAT_MAX = 400;
const POSE_RATE = 15, POSE_BURST = 20;   // messages / s (client sends 10 Hz while moving)
const CHAT_EVERY = 1200, CHAT_BURST = 4;
const EDIT_RATE = 6, EDIT_BURST = 8;
const FIRE_RATE = 8, FIRE_BURST = 4;
const GAME_RATE = 8, GAME_BURST = 10;  // compete/co-op intents per second
const VIO_KICK = 12;
const TELEPORT = 20;            // one-step walk (m) that counts as a teleport attempt
const FRAME_SWITCH_MS = 15e3;  // garden <-> home-Earth-as-planet re-seat, at most this often
// Vertical budget (m): every rise spends it, it refills at VB_RATE m/s up to VB_CAP. Covers a jump, a ledge mantle
// (2.1 m in 0.36 s), climbing out of the water (up to ~2.4 m in under half a second) and swimming up from the bottom;
// sustained flight is held to VB_RATE. The server can't fix her height on her screen (the ground does that), so a
// rise over budget isn't refused: her server height follows at the budget's pace (others see that) and nothing is
// rubber-banded. Movement anomalies never kick on their own: only a sustained run of them adds a strike.
const VB_CAP = 3.0, VB_RATE = 4.5;
const VB_GAP = 6;               // her height over the server's by more than this (m) while rising = a fly attempt
const MOVE_SOFT = 30;           // soft movement corrections (speed / over-budget rise) per strike point
const HIST_MS = 1000;           // lag-compensation rewind window
const FIRE_RANGE = 120;         // metres, walking gunplay skeleton
const FIRE_MIN = 80;            // ms between shots
const FIRE_DMG = 25, FIRE_HP = 100;
const CAP_R = 0.35, CAP_H = 1.75, EYE = 1.6;
// Pose batching for clients that ask for it (/ws?...&b=1): poses collect and go out as one {t:'P', ps:[...]} per
// recipient at FLUSH_HZ, nearest players every flush, further ones less often (interest management). Older
// clients keep the per-pose 'p' messages unchanged.
const FLUSH_MS = 66;            // ~15 Hz
const NEAR_M = 100, MID_M = 300, MID_MS = 200, FAR_MS = 1000;
const CHUNK_RE = /^-?\d{1,6},-?\d{1,6},-?\d{1,6}$/;
const B64_RE = /^[A-Za-z0-9+/]+=*$/;
const r2 = (v) => Math.round(v * 100) / 100;
const id12 = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16);

export class World extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS jti (id TEXT PRIMARY KEY, exp INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS blk (aid TEXT NOT NULL, other TEXT NOT NULL, PRIMARY KEY (aid, other));
      CREATE TABLE IF NOT EXISTS chat (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, aid TEXT, name TEXT, text TEXT);
      CREATE TABLE IF NOT EXISTS lastpos (aid TEXT PRIMARY KEY, x REAL, y REAL, z REAL, ts INTEGER);
      CREATE TABLE IF NOT EXISTS vox (tile TEXT NOT NULL, ck TEXT NOT NULL, data TEXT NOT NULL, aid TEXT, ts INTEGER, PRIMARY KEY (tile, ck));
      CREATE TABLE IF NOT EXISTS builds (id TEXT PRIMARY KEY, tile TEXT NOT NULL, typ TEXT NOT NULL, mat TEXT NOT NULL, x REAL, y REAL, z REAL, yaw REAL, aid TEXT, ts INTEGER);`);
    try { this.sql.exec('ALTER TABLE lastpos ADD COLUMN tile TEXT'); } catch { /* already there */ }
    this.hist = new Map(); // aid -> [{t,x,y,z,yaw,tile}]  (in-memory; empty after hibernation)
    this.fa = new Factions(this); // witnesses, memories, couriers (server/src/factions.js)
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    this.games = new Games(this);
    this.combat = new Combat(this);
    try { migrateGardenFrame(this.sql); } catch (e) { console.warn('[garden] migrate', e && e.message); }
    this.wipeStaleTerrain();
  }
  // 0.2.34 world reset: drop griefed voxel digs and shared place-digs from older generations.
  // Accounts, last positions, chat, blocks and placed builds stay so saves and sessions still load.
  wipeStaleTerrain() { wipeStaleTerrain(this.sql); }
  async alarm() {
    const t = Date.now();
    try { await this.combat.tick(t); } catch (e) { console.warn('[combat] alarm', e && e.message); }
    await this.games.alarm();
    if (this.combat && this.combat.needsTick()) {
      const when = Date.now() + 250;
      try {
        const cur = await this.ctx.storage.getAlarm();
        if (!cur || cur > when) await this.ctx.storage.setAlarm(when);
      } catch { try { await this.ctx.storage.setAlarm(when); } catch { /* */ } }
    }
  }

  parsed(name) { return parseWorld((name || '').split('#')[0]); }
  rulesOf(a) { const w = this.parsed(a.world); return w ? rulesFor(w) : rulesFor({ kind: a.kind }); }

  // ---- connect
  async fetch(req) {
    const name = req.headers.get('X-Zen-World') || '';
    const tk = JSON.parse(req.headers.get('X-Zen-Ticket') || 'null');
    const w = parseWorld(name.split('#')[0]);
    if (!tk || !w || tk.world !== w.key) return new Response('bad', { status: 400 });
    const t = Date.now();
    this.sql.exec('DELETE FROM jti WHERE exp < ?', t);
    if (this.sql.exec('SELECT 1 FROM jti WHERE id = ?', tk.jti).toArray().length) return new Response('ticket used', { status: 401 });
    this.sql.exec('INSERT INTO jti (id, exp) VALUES (?, ?)', tk.jti, tk.exp + 1000);
    const rules = rulesFor(w);
    const live = this.ctx.getWebSockets();
    const dupe = live.filter((s) => this.att(s)?.aid === tk.aid);
    if (live.length - dupe.length >= (w.owner === WORLD_OWNER ? SHARED_CAP : (rules.cap || RULES[w.kind].cap))) return new Response('full', { status: 409 });
    for (const s of dupe) { try { s.close(4001, 'signed in somewhere else'); } catch { /* */ } }

    this.sql.exec('DELETE FROM blk WHERE aid = ?', tk.aid);
    for (const o of tk.blocks || []) this.sql.exec('INSERT OR IGNORE INTO blk (aid, other) VALUES (?, ?)', tk.aid, o);
    this.blk = null;

    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server, new URL(req.url).searchParams.get('b') === '1' ? [tk.aid, 'b'] : [tk.aid]); // 'b' = wants batched poses
    const a = { aid: tk.aid, name: tk.name, tag: tk.tag, muted: !!tk.muted, world: name, kind: w.kind,
      x: null, y: 0, z: 0, yaw: 0, tile: null, lt: 0, budget: 0, fid: 0, fx: 0, at: 0, vio: 0, vt: t,
      pt: POSE_BURST, ptt: t, ct: CHAT_BURST, ctt: t, et: EDIT_BURST, ett: t, ft: FIRE_BURST, ftt: t, lastFire: 0,
      last: '', hb: t, drops: 0, air: 0, ab: 0, vb: VB_CAP, soft: 0,
      dev: !!(tk.dev && devAllowed(this.env, tk.aid)), hp: FIRE_HP };
    let resume = null;
    if (tk.resume) {
      let lp = this.sql.exec('SELECT x, y, z, tile, ts FROM lastpos WHERE aid = ?', a.aid).toArray()[0];
      if (lp && t - lp.ts < 30 * 60e3) {
        if (isLegacyGardenTile(lp.tile) && w.kind === 'home') {
          const p = liftGardenPose({ x: lp.x, y: lp.y, z: lp.z, tile: null });
          lp = { ...lp, x: p.x, y: p.y, z: p.z, tile: p.tile };
          try { this.sql.exec('UPDATE lastpos SET x = ?, y = ?, z = ?, tile = ? WHERE aid = ?', p.x, p.y, p.z, p.tile, a.aid); } catch (e) { /* */ }
        }
        a.x = lp.x; a.y = lp.y; a.z = lp.z; a.tile = lp.tile || null; a.lt = t; a.budget = 1;
        resume = { x: lp.x, y: lp.y, z: lp.z, tile: lp.tile || null };
      }
    }
    // where to land when not resuming: next to the inviter / friend if they're here, else the world spawn
    // (first time in this world, or an invite whose sender is offline). Same trust as a resume: the server picks it.
    let spawn = null;
    if (!resume && w.kind === 'home' && w.owner === WORLD_OWNER) {
      const near = tk.near ? this.ctx.getWebSockets(tk.near).map((s) => this.att(s)).find((o) => o && o.x != null && !this.blocked(a.aid, o.aid)) : null;
      const seen = this.sql.exec('SELECT 1 FROM lastpos WHERE aid = ?', a.aid).toArray().length > 0;
      if (near) {
        const ang = Math.random() * Math.PI * 2;
        resume = { x: r2(near.x + Math.cos(ang) * 1.6), y: near.y, z: r2(near.z + Math.sin(ang) * 1.6), tile: near.tile || null }; spawn = 'near';
      } else if (tk.near || !seen) { resume = { x: WORLD_SPAWN.x, y: WORLD_SPAWN.y || 0, z: WORLD_SPAWN.z, tile: WORLD_SPAWN.tile || null, yaw: WORLD_SPAWN.yaw }; spawn = 'spawn'; }
      if (spawn) { a.x = resume.x; a.y = resume.y; a.z = resume.z; a.tile = resume.tile; a.lt = t; a.budget = 1; }
    }
    server.serializeAttachment(a);
    const others = this.ctx.getWebSockets().filter((s) => s !== server).map((s) => this.att(s)).filter((o) => o && !this.blocked(a.aid, o.aid));
    this.send(server, { t: 'hi', you: { id: a.aid, name: a.name, tag: a.tag }, dev: !!a.dev, world: name, n: others.length + 1,
      peers: others.filter((o) => o.x != null).map((o) => ({ id: o.aid, name: o.name, tag: o.tag, x: o.x, y: o.y, z: o.z, yaw: o.yaw, tile: o.tile || null })),
      others: others.map((o) => ({ id: o.aid, name: o.name, tag: o.tag })),
      rules: { maxH: rules.maxH, g: rules.gravity, sphereR: rules.sphereR }, resume, spawn, st: t, fa: 1, games: 1, proto: PROTOCOL });
    this.broadcast({ t: 'join', id: a.aid, name: a.name, tag: a.tag }, server, a.aid);
    this.count();
    for (const o of others) if (o.lk) this.send(server, { t: 'lk', id: o.aid, lk: o.lk });
    await this.presence(a.aid, name);
    this.sendSnap(server);
    this.games.hello(server, a);
    try { this.combat.hello(server, a, t); } catch (e) { console.warn('[combat] hello', e && e.message); }
    return new Response(null, { status: 101, webSocket: client });
  }

  att(ws) { try { return ws.deserializeAttachment(); } catch { return null; } }
  isDev(a) { return !!(a && a.dev && devAllowed(this.env, a.aid)); }
  send(ws, m) { try { ws.send(JSON.stringify(m)); } catch { /* closed */ } }
  // Block pairs, both directions, read once from SQL and kept until a block changes (this ran one SQL query per
  // recipient per pose: 32 players at 10 Hz was ~10k queries/s). Empty after hibernation, rebuilt on first use.
  blockPairs() {
    if (!this.blk) { this.blk = new Set(); for (const r of this.sql.exec('SELECT aid, other FROM blk').toArray()) { this.blk.add(r.aid + '|' + r.other); this.blk.add(r.other + '|' + r.aid); } }
    return this.blk;
  }
  blocked(a, b) { return this.blockPairs().has(a + '|' + b); }
  broadcast(m, except, from) {
    // a pose carries its sender's own clock (ct) so others can space the samples as they were sent, not as they arrived
    // a pose carries its sender's optional extras: own clock (ct), move/animation state (m), look code (lk)
    if (m.t === 'p' && this.pct && this.pct[0] === m.id) { Object.assign(m, this.pct[1]); this.pct = null; }
    const pose = m.t === 'p';
    let s = null;
    const pairs = from ? this.blockPairs() : null;
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      const tags = (pose || (pairs && pairs.size)) ? this.ctx.getTags(ws) : null;
      if (pairs && pairs.size) { const aid = tags[0]; if (aid && pairs.has(from + '|' + aid)) continue; }
      if (pose && tags[1] === 'b') continue; // batched in flush()
      try { ws.send(s || (s = JSON.stringify(m))); } catch { /* */ }
    }
    if (pose) this.queuePose(m);
  }
  queuePose(m) {
    if (!this.pend) { this.pend = new Map(); this.pos = new Map(); this.sentAt = new Map(); }
    const prev = this.pend.get(m.id);
    if (prev && prev.lk && !m.lk) m.lk = prev.lk; // latest pose wins, but a look code in a superseded one still goes out
    if (prev && prev.m) m.m = m.m ? { ...prev.m, ...m.m } : prev.m; // and so does a move-state part (they're deltas)
    this.pend.set(m.id, m);
    let dir = null;
    if (m.tile && this.sR) { try { dir = makeFrame(this.sR, m.tile).toDir(m.x, m.z); } catch { /* flat */ } }
    this.pos.set(m.id, { x: m.x, z: m.z, tile: m.tile || null, dir });
    if (!this.ft) this.ft = setTimeout(() => this.flush(), FLUSH_MS);
  }
  span(a, b) {
    if (!a || !b) return 0; // unknown (e.g. just woke from hibernation): treat as near
    if (a.tile === b.tile || !a.dir || !b.dir) return a.tile === b.tile ? Math.hypot(a.x - b.x, a.z - b.z) : (a.dir || b.dir ? Infinity : 0);
    return arc(a.dir, b.dir, this.sR);
  }
  flush() {
    this.ft = null;
    if (!this.pend || !this.pend.size) return;
    const list = [...this.pend.values()]; this.pend.clear();
    const t = Date.now(), pairs = this.blockPairs(), live = new Set();
    const socks = this.ctx.getWebSockets();
    for (const ws of socks) live.add(this.ctx.getTags(ws)[0]);
    for (const ws of socks) {
      const [rid, b] = this.ctx.getTags(ws);
      if (b !== 'b') continue;
      const me = this.pos.get(rid);
      let sent = this.sentAt.get(rid); if (!sent) this.sentAt.set(rid, (sent = new Map()));
      const out = [];
      for (const e of list) {
        if (e.id === rid || !live.has(e.id) || pairs.has(e.id + '|' + rid)) continue;
        const d = this.span(me, this.pos.get(e.id));
        const every = d <= NEAR_M ? 0 : d <= MID_M ? MID_MS : FAR_MS;
        if (every && t - (sent.get(e.id) || 0) < every) continue;
        sent.set(e.id, t); out.push(e);
      }
      if (out.length) { try { ws.send(JSON.stringify(out.length === 1 ? out[0] : { t: 'P', ps: out })); } catch { /* closed */ } }
    }
    if (this.sentAt.size > live.size * 2 + 8) for (const k of this.sentAt.keys()) if (!live.has(k)) this.sentAt.delete(k);
    for (const k of this.pos.keys()) if (!live.has(k)) this.pos.delete(k);
  }
  count() { this.broadcast({ t: 'n', n: this.ctx.getWebSockets().length }); }
  async presence(aid, world) {
    try { await this.env.DB.prepare(`INSERT INTO presence (account_id, world, updated) VALUES (?1, ?2, ?3)
      ON CONFLICT(account_id) DO UPDATE SET world = ?2, updated = ?3`).bind(aid, world, Date.now()).run(); } catch (e) { console.warn('[world] presence', e); }
  }
  async flag(a, kind, detail) {
    console.warn(`[anticheat] ${a.aid.slice(0, 8)} ${kind} ${detail}`);
    try { await this.env.DB.prepare('INSERT INTO cheat_flags (account_id, world, kind, detail, created) VALUES (?, ?, ?, ?, ?)').bind(a.aid, a.world, kind, String(detail).slice(0, 200), Date.now()).run(); } catch { /* */ }
  }

  // ---- messages
  async webSocketMessage(ws, raw) {
    const a = this.att(ws); if (!a) return ws.close(1011, 'state');
    const t = Date.now();
    if (typeof raw !== 'string' || raw.length > MAX_MSG) { try { ws.send(JSON.stringify({ t: 'no', why: 'too-big', max: MAX_MSG })); } catch { /* */ } await this.flag(a, 'oversize', typeof raw === 'string' ? raw.length : 'binary'); return; } // dropped with a reply, never a closed socket
    a.pt = Math.min(POSE_BURST, a.pt + ((t - a.ptt) / 1000) * POSE_RATE); a.ptt = t;
    // over-rate messages are dropped; only a sustained flood (>150 dropped within a 10 s stretch) closes the socket.
    // A Wi-Fi stall that flushes ~10 s of queued poses at once is dropped quietly, not kicked.
    if (a.pt < 1 && this.env.LOCAL_DEV === '1' && !String(raw).startsWith('{"t":"p"')) console.warn('[drop]', a.name, String(raw).slice(0, 60));
    if (a.pt < 1) { if (t - (a.dropT || 0) > 10e3) a.drops = 0; a.dropT = t; if (++a.drops > 150) { if (this.env.LOCAL_DEV === '1') console.warn('[flood] last message', String(raw).slice(0, 90)); await this.flag(a, 'flood', a.drops); return ws.close(4008, 'too many messages'); } ws.serializeAttachment(a); return; }
    a.pt -= 1;
    let m; try { m = JSON.parse(raw); } catch { return this.strike(ws, a, 2, 'json'); }
    if (!m || typeof m !== 'object' || Array.isArray(m)) return this.strike(ws, a, 2, 'shape');
    if (t - a.vt > 10e3) { const n = Math.floor((t - a.vt) / 10e3); a.vio = Math.max(0, a.vio - n); a.soft = Math.max(0, (a.soft || 0) - 10 * n); a.vt = t; }
    // a bug in any one handler must never take the socket (or the whole object) down: log it and carry on
    try {
      switch (m.t) {
        case 'p': return await this.pose(ws, a, m, t);
        case 'c': return await this.chat(ws, a, m, t);
        case 'e': return await this.edit(ws, a, m, t);
        case 'f': return await this.fire(ws, a, m, t);
        case 'rt': return await this.combat.onMsg(ws, a, m, t);
        case 'fa': return await this.fa.onMsg(ws, a, m, t);
        case 'g': {
          a.gt = Math.min(GAME_BURST, (a.gt ?? GAME_BURST) + ((t - (a.gtt || t)) / 1000) * GAME_RATE); a.gtt = t;
          if (a.gt < 1) { ws.serializeAttachment(a); return; }
          a.gt -= 1; ws.serializeAttachment(a);
          return await this.games.msg(ws, a, m, t);
        }
        case 'hb': if (t - a.hb > 45e3) { a.hb = t; await this.presence(a.aid, a.world); } ws.serializeAttachment(a); return;
        default: return await this.strike(ws, a, 1, 'type');
      }
    } catch (e) { console.warn('[world] handler', m.t, m.k || '', e && (e.stack || e.message)); }
  }

  async strike(ws, a, pts, why) {
    a.vio += pts;
    if (a.vio >= VIO_KICK) { await this.flag(a, 'kick', why + ' vio=' + a.vio); ws.serializeAttachment(a); return ws.close(4003, 'failed checks'); }
    ws.serializeAttachment(a);
  }

  async pose(ws, a, m, t) {
    const R = this.rulesOf(a);
    if (JSON.stringify(m).length > POSE_MAX) return this.strike(ws, a, 2, 'pose-size');
    const keys = Object.keys(m);
    if (keys.length > 12 || !['x', 'y', 'z', 'yaw'].every((k) => typeof m[k] === 'number' && Number.isFinite(m[k]))) return this.strike(ws, a, 2, 'pose-shape');
    const seq = Number.isInteger(m.s) ? m.s : 0;
    this.sR = R.sphereR;
    this.pct = [a.aid, poseExtras(m, a)]; // relayed with the accepted pose (all optional; older clients send none)
    let tile = (typeof m.tile === 'string' && m.tile) ? m.tile : null;
    let { x, y, z, yaw } = m;
    const home = this.parsed(a.world);
    let legacyIn = false;
    if (home && home.kind === 'home' && isLegacyGardenTile(tile)
        && Number.isFinite(x) && Number.isFinite(z)) {
      const lifted = liftGardenPose({ x, y, z, yaw, tile: null });
      x = lifted.x; y = lifted.y; z = lifted.z; tile = lifted.tile; legacyIn = true;
    }
    if (!tileOk(tile, R.sphereR)) return this.strike(ws, a, 2, 'tile');
    const ab = parseAb(m.ab);
    if (a.fx) { if (m.r !== a.fx) { ws.serializeAttachment(a); return; } a.fx = 0; a.lt = t; }
    yaw = ((yaw % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    // no world borders: only reject non-finite / absurd heights (through the planet, or above any walk/jet)
    if (Math.abs(x) > 1e7 || Math.abs(z) > 1e7 || y < -R.sphereR || y > 20000) {
      await this.flag(a, 'bounds', `${r2(x)},${r2(y)},${r2(z)}`);
      return this.correct(ws, a, 3, 'bounds', seq);
    }
    const next = { x, y, z, yaw, tile };
    // Lifting a leftover garden-frame pose onto this globe can land ~95 m from the city spawn.
    // That is a frame re-seat, not a teleport (at most one per FRAME_SWITCH_MS). A second leftover
    // pose that far away, inside the window, is the earth-boot flash: ignore it, no strike.
    // A leftover garden-frame pose that lifts into the garden from outside it (city spawn, or the
    // earth-boot flash) is a re-seat, not a cheat. Later leftovers in the 15 s window are ignored.
    // Jumps that are already inside the garden, or that don't land in it, stay ordinary teleports.
    const farLegacy = legacyIn && a.x != null && surfaceDist(a, next, R.sphereR) > TELEPORT
      && !inGardenArea(a) && inGardenArea(next);
    if (farLegacy && t - (a.fsT || 0) <= FRAME_SWITCH_MS) { ws.serializeAttachment(a); return; }
    const prev = a.x != null ? { x: a.x, y: a.y, z: a.z, tile: a.tile } : null;
    if (a.x == null) {
      const lp = this.sql.exec('SELECT x, y, z, tile, ts FROM lastpos WHERE aid = ?', a.aid).toArray()[0];
      if (lp && t - lp.ts < 10e3) {
        const d0 = surfaceDist({ x: lp.x, z: lp.z, tile: lp.tile || null }, next, R.sphereR);
        // a quick rejoin into the other map (left on the planet, the reloaded app starts in the garden) is not a
        // teleport: the distance between two frames means nothing. It must not use up the frame-switch allowance
        // either: the save restores the planet seconds later, and that switch has to be re-seated (0.2.23 live
        // test: using it up here judged that restore a teleport, and three of them kicked her).
        // leftover garden-frame clients start again at the arrival stone; lastpos may be a few
        // metres away in the same garden on this globe — that is not a rejoin teleport.
        if (!lp.tile !== !tile) { /* seated where she is, below */ }
        else if (inGardenArea({ x: lp.x, y: lp.y, z: lp.z, tile: lp.tile || null }) && inGardenArea(next)) { /* seat here */ }
        else if (d0 > R.maxH * ((t - lp.ts) / 1000) + 3) {
          a.x = lp.x; a.y = lp.y; a.z = lp.z; a.tile = lp.tile || null; a.lt = t;
          await this.flag(a, 'rejoin-teleport', `${r2(d0)} m`);
          return this.correct(ws, a, 0, 'rejoin', seq);
        }
      }
      a.x = x; a.y = y; a.z = z; a.yaw = yaw; a.tile = tile; a.lt = t; a.budget = 1; a.air = 0;
    } else {
      const dt = Math.min(2, (t - a.lt) / 1000);
      a.budget = Math.min(R.maxH + R.burst + (a.kbU > t ? 4 : 0), a.budget + R.maxH * dt); // a sparring shove adds a short push
      a.vb = Math.min(VB_CAP, (a.vb ?? VB_CAP) + VB_RATE * dt);
      const d = surfaceDist(a, next, R.sphereR), dy = y - a.y;
      // a tile change (planet rebase, or arriving on another tile) is a re-seat, not a teleport.
      // At most one per FRAME_SWITCH_MS so it can't be farmed.
      if ((((a.tile || null) !== (tile || null)) || farLegacy) && t - (a.fsT || 0) > FRAME_SWITCH_MS) {
        a.fsT = t; a.x = x; a.y = y; a.z = z; a.yaw = yaw; a.tile = tile; a.lt = t; a.budget = 1; a.vb = VB_CAP; a.air = 0; a.ab = ab.bits;
      } else {
      // back after a quiet spell (alone, the client only sends poses now and then): a walk that fits the time is a re-seat
      const gap = (t - a.lt) / 1000;
      if (gap > 2 && d <= R.maxH * gap + 3 && dy <= VB_RATE * gap + VB_CAP && !this.games.blocks(a, next) && !(a.sol && this.games.sol.inside(a, next))) { a.x = x; a.y = y; a.z = z; a.yaw = yaw; a.tile = tile; a.lt = t; a.budget = 1; a.vb = VB_CAP; a.air = 0; a.ab = ab.bits; }
      else {
      if (d > TELEPORT) { await this.flag(a, 'teleport', `${r2(d)} m`); return this.correct(ws, a, 3, 'teleport', seq); }
      if (d > a.budget + 0.25) return this.correct(ws, a, this.soft(a), 'speed', seq);
      // walls are real: the vault, and (for a client that collides with the same shapes) everything solid you can see;
      // bodies too, until you've pressed against one long enough to slip past. A snap back, never a strike.
      if (this.games.blocks(a, next) || (a.sol && this.games.sol.wall(a, next))) return this.correct(ws, a, 0, 'wall', seq);
      if (a.sol && this.games.sol.body(a, next, t)) return this.correct(ws, a, 0, 'body', seq);
      // up: climbing claws / jet boots add their own sustained rise on top of the budget
      const extra = Math.max(0, maxRise(Math.max(dt, 1e-3), R.gravity, ab, 0) - (JUMP_V * Math.max(dt, 1e-3) + 0.4));
      let ny = y;
      if (dy > 0) {
        const spend = Math.max(0, dy - extra);
        if (spend > a.vb + 0.05) {
          ny = a.y + extra + a.vb; a.vb = 0;
          if (y - ny > VB_GAP) { const p = this.soft(a); if (p) { await this.strike(ws, a, p, 'fly'); if (a.vio >= VIO_KICK) return; } }
        }
        else a.vb = Math.max(0, a.vb - spend);
      }
      a.air = ny - a.y > 0.12 ? 1 : dy < -0.05 ? 0 : a.air;
      a.budget -= d;
      a.x = x; a.y = ny; a.z = z; a.yaw = yaw; a.tile = tile; a.lt = t; a.ab = ab.bits;
      }
      }
    }
    if (seq && t - a.at > 500) { a.at = t; this.send(ws, { t: 'a', s: seq, x: r2(a.x), y: r2(a.y), z: r2(a.z), tile: a.tile }); }
    this.persistPos(a, t);
    ws.serializeAttachment(a);
    this.remember(a, t);
    this.broadcast({ t: 'p', id: a.aid, x: r2(a.x), y: r2(a.y), z: r2(a.z), yaw: r2(a.yaw), tile: a.tile || null }, ws, a.aid);
    try { this.fa.onPose(a, t); } catch (e) { console.warn('[fa] pose', e && e.message); }
    try { this.games.onPose(ws, a, prev && (prev.tile || null) === (a.tile || null) ? prev : null, t); } catch (e) { console.warn('[games] pose', e && e.message); }
    try { this.combat.tick(t); } catch (e) { console.warn('[combat] pose', e && e.message); }
  }

  // Write lastpos often enough that a hard deploy or eviction still has the last accepted spot
  // (webSocketClose also writes; this covers the case where that hook never runs).
  persistPos(a, t = Date.now(), force = false) {
    if (!a || a.x == null) return;
    if (!force && a.lpT && t - a.lpT < 5000) return;
    a.lpT = t;
    this.sql.exec('INSERT OR REPLACE INTO lastpos (aid, x, y, z, tile, ts) VALUES (?, ?, ?, ?, ?, ?)', a.aid, a.x, a.y, a.z, a.tile || '', t);
  }

  // Called from the Worker before a deploy (POST /deploy-soon): flush every position, tell clients,
  // then close with 1012 so they auto-reconnect with a resume ticket and lose no progress.
  async warnUpdate() {
    const t = Date.now();
    const socks = this.ctx.getWebSockets();
    for (const ws of socks) {
      const a = this.att(ws);
      if (a) this.persistPos(a, t, true);
      this.send(ws, { t: 'upd', proto: PROTOCOL, why: 'deploy' });
      try { ws.close(1012, 'updating'); } catch { /* */ }
    }
    return { n: socks.length };
  }

  remember(a, t) {
    const h = this.hist.get(a.aid) || [];
    h.push({ t, x: a.x, y: a.y, z: a.z, yaw: a.yaw, tile: a.tile || null });
    const cut = t - HIST_MS;
    while (h.length && h[0].t < cut) h.shift();
    this.hist.set(a.aid, h);
  }
  rewind(aid, when, fallback) {
    const h = this.hist.get(aid);
    if (!h || !h.length) return fallback;
    if (when >= h[h.length - 1].t) return h[h.length - 1];
    if (when <= h[0].t) return h[0];
    for (let i = 1; i < h.length; i++) {
      if (h[i].t >= when) {
        const a = h[i - 1], b = h[i], k = (when - a.t) / Math.max(1, b.t - a.t);
        return { t: when, x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k, yaw: a.yaw, tile: b.tile || a.tile };
      }
    }
    return h[h.length - 1];
  }

  // soft movement anomalies: one strike point per MOVE_SOFT of them (fades 10 per 10 s, like strikes)
  soft(a) { a.soft = (a.soft || 0) + 1; if (a.soft >= MOVE_SOFT) { a.soft = 0; return 1; } return 0; }

  async correct(ws, a, pts, why, seq = 0) {
    a.lt = Date.now(); a.fid += 1; a.fx = a.fid;
    this.send(ws, { t: 'fix', id: a.fid, s: seq, x: a.x, y: a.y, z: a.z, tile: a.tile || null, why });
    return this.strike(ws, a, pts, why);
  }

  async chat(ws, a, m, t) {
    if (typeof m.text !== 'string' || Object.keys(m).length > 2 || m.text.length > CHAT_MAX) return this.strike(ws, a, 1, 'chat-shape');
    if (a.muted) { this.send(ws, { t: 'sys', text: 'Chat is paused on your account for now.' }); return; }
    a.ct = Math.min(CHAT_BURST, a.ct + (t - a.ctt) / CHAT_EVERY); a.ctt = t;
    if (a.ct < 1) { ws.serializeAttachment(a); this.send(ws, { t: 'sys', text: 'Slow down a little.' }); return; }
    a.ct -= 1;
    const c = cleanChat(m.text);
    if (c.blocked) { ws.serializeAttachment(a); if (c.reason) this.send(ws, { t: 'sys', text: c.reason }); if (c.flagged) await this.strike(ws, a, 1, 'chat-filter'); return; }
    if (c.text === a.last) { ws.serializeAttachment(a); return; }
    a.last = c.text;
    ws.serializeAttachment(a);
    this.sql.exec('INSERT INTO chat (ts, aid, name, text) VALUES (?, ?, ?, ?)', t, a.aid, a.name, c.text);
    this.sql.exec('DELETE FROM chat WHERE id <= (SELECT MAX(id) - 200 FROM chat)');
    const msg = { t: 'c', id: a.aid, name: a.name, tag: a.tag, text: c.text, ts: t };
    this.send(ws, msg);
    this.broadcast(msg, ws, a.aid);
  }

  // ---- world edits (voxel diffs + placed pieces), server-authoritative, rate-limited
  takeEditToken(a, t) {
    a.et = Math.min(EDIT_BURST, a.et + ((t - a.ett) / 1000) * EDIT_RATE); a.ett = t;
    if (a.et < 1) return false;
    a.et -= 1; return true;
  }

  async edit(ws, a, m, t) {
    if (!this.takeEditToken(a, t)) { ws.serializeAttachment(a); this.send(ws, { t: 'sys', text: 'Slow down a little.' }); return; }
    const R = this.rulesOf(a);
    const tile = (typeof m.tile === 'string' && m.tile) ? m.tile : '';
    if (tile && !tileOk(tile, R.sphereR)) return this.editNo(ws, a, m, 'edit-tile');
    if (m.k === 'vox') return this.editVox(ws, a, m, t, tile);
    if (m.k === 'build') return this.editBuild(ws, a, m, t, tile);
    if (m.k === 'sync') {
      if (m.vox && typeof m.vox === 'object') await this.editVox(ws, a, { diffs: m.vox, quiet: true }, t, tile);
      if (Array.isArray(m.builds)) {
        for (const p of m.builds.slice(0, 40)) await this.editBuild(ws, a, { op: 'place', piece: p, quiet: true }, t, tile);
      }
      this.sendSnap(ws, tile);
      return;
    }
    return this.editNo(ws, a, m, 'edit-kind');
  }

  // A building or digging message the server won't take is answered, never punished: a strike here kicked players
  // whose piece was out of the server's view (2026-11-26: building alone on the home planet sent no poses, so every
  // piece looked 12 m+ away -> 12 strikes -> 'failed checks'). The client keeps playing; the piece just isn't shared.
  editNo(ws, a, m, why) {
    ws.serializeAttachment(a);
    if (this.env.LOCAL_DEV === '1') console.warn('[edit-no]', a.aid.slice(0, 8), why);
    this.send(ws, { t: 'e', k: 'no', what: m && m.k === 'build' ? 'build' : m && m.k === 'vox' ? 'vox' : 'edit', op: m && m.op === 'remove' ? 'remove' : 'place', lid: m && typeof m.lid === 'string' ? m.lid.slice(0, 32) : null, id: m && typeof m.id === 'string' ? m.id.slice(0, 32) : null, why });
  }

  // reach for a build: only when the server has seen her in that frame (tile) lately; a piece placed before her
  // first pose there (or after a long quiet spell) is not judged on a stale spot. Pace is held by the edit tokens.
  tooFar(a, p, t) {
    if (a.x == null || (a.tile || '') !== (p.tile || '') || t - (a.lt || 0) > 5000) return false;
    return surfaceDist(a, p, this.rulesOf(a).sphereR) > 14;
  }

  async editVox(ws, a, m, t, tile) {
    const diffs = m.diffs;
    if (!diffs || typeof diffs !== 'object' || Array.isArray(diffs)) return this.editNo(ws, a, m, 'vox-shape');
    const keys = Object.keys(diffs);
    if (keys.length > 24) return this.editNo(ws, a, m, 'vox-many');
    const accepted = {};
    for (const ck of keys) {
      const data = diffs[ck];
      if (!CHUNK_RE.test(ck) || typeof data !== 'string' || data.length > 8000 || !B64_RE.test(data)) return this.editNo(ws, a, m, 'vox-chunk');
      this.sql.exec('INSERT OR REPLACE INTO vox (tile, ck, data, aid, ts) VALUES (?, ?, ?, ?, ?)', tile, ck, data, a.aid, t);
      accepted[ck] = data;
    }
    ws.serializeAttachment(a);
    if (!m.quiet && Object.keys(accepted).length) this.broadcast({ t: 'e', k: 'vox', id: a.aid, tile, diffs: accepted }, ws, a.aid);
  }

  async editBuild(ws, a, m, t, tile) {
    const op = m.op === 'remove' ? 'remove' : 'place';
    if (op === 'remove') {
      const id = typeof m.id === 'string' && /^[0-9a-z]{6,32}$/i.test(m.id) ? m.id : null;
      if (!id) return this.editNo(ws, a, m, 'build-id');
      const row = this.sql.exec('SELECT id, x, y, z FROM builds WHERE id = ?', id).toArray()[0];
      if (!row) { ws.serializeAttachment(a); return; }
      // must be standing near the piece (or have no pose yet)
      if (this.tooFar(a, { x: row.x, z: row.z, tile }, t)) return this.editNo(ws, a, m, 'build-reach');
      this.sql.exec('DELETE FROM builds WHERE id = ?', id);
      ws.serializeAttachment(a);
      this.broadcast({ t: 'e', k: 'build', op: 'remove', id, tile, by: a.aid }, null, a.aid);
      return;
    }
    const p = m.piece;
    if (!Array.isArray(p) || p.length < 6) return this.editNo(ws, a, m, 'build-shape');
    const [typ, mat, x, y, z, yaw] = p;
    if (!PIECE_TYPES.includes(typ) || !PIECE_MATS.includes(mat)) return this.editNo(ws, a, m, 'build-kind');
    if (![x, y, z, yaw].every((v) => typeof v === 'number' && Number.isFinite(v))) return this.editNo(ws, a, m, 'build-num');
    if (this.tooFar(a, { x, z, tile }, t)) return this.editNo(ws, a, m, 'build-reach');
    const n = this.sql.exec('SELECT COUNT(*) AS n FROM builds').toArray()[0]?.n || 0;
    if (n > 4000) { this.send(ws, { t: 'sys', text: 'This world is full of buildings for now.' }); return; }
    const id = (typeof m.id === 'string' && /^[0-9a-z]{6,32}$/i.test(m.id)) ? m.id : id12();
    try {
      const existing = this.sql.exec('SELECT id FROM builds WHERE id = ?', id).toArray()[0];
      if (existing) this.sql.exec('UPDATE builds SET tile=?, typ=?, mat=?, x=?, y=?, z=?, yaw=?, aid=?, ts=? WHERE id=?', tile, typ, mat, x, y, z, yaw, a.aid, t, id);
      else this.sql.exec('INSERT INTO builds (id, tile, typ, mat, x, y, z, yaw, aid, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', id, tile, typ, mat, x, y, z, yaw, a.aid, t);
    } catch (e) { console.warn('[world] build save', e && e.message); return this.editNo(ws, a, m, 'build-save'); }
    ws.serializeAttachment(a);
    if (!m.quiet) {
      const msg = { t: 'e', k: 'build', op: 'place', id, lid: m.lid || null, tile, piece: [typ, mat, r2(x), r2(y), r2(z), r2(yaw)], by: a.aid };
      this.send(ws, msg);
      this.broadcast(msg, ws, a.aid);
    }
  }

  sendSnap(ws, onlyTile) {
    const voxRows = onlyTile != null
      ? this.sql.exec('SELECT tile, ck, data FROM vox WHERE tile = ?', onlyTile).toArray()
      : this.sql.exec('SELECT tile, ck, data FROM vox').toArray();
    const builds = (onlyTile != null
      ? this.sql.exec('SELECT id, tile, typ, mat, x, y, z, yaw FROM builds WHERE tile = ?', onlyTile).toArray()
      : this.sql.exec('SELECT id, tile, typ, mat, x, y, z, yaw FROM builds').toArray()
    ).map((r) => ({ id: r.id, tile: r.tile, piece: [r.typ, r.mat, r.x, r.y, r.z, r.yaw] }));
    // send voxel diffs in batches so one hi-follow message stays modest
    const by = {};
    for (const r of voxRows) { (by[r.tile] || (by[r.tile] = {}))[r.ck] = r.data; }
    const tiles = Object.keys(by);
    if (!tiles.length && !builds.length) return;
    if (!tiles.length) { this.send(ws, { t: 'e', k: 'snap', vox: {}, builds }); return; }
    for (let i = 0; i < tiles.length; i++) {
      const tile = tiles[i];
      this.send(ws, { t: 'e', k: 'snap', tile, vox: { [tile]: by[tile] }, builds: i === tiles.length - 1 ? builds : [] });
    }
  }

  // ---- gunplay: a validated equipped gun (or the owner-only dev M4) fires; server-authoritative hits, lag-compensated rewind (~1 s of poses)
  async fire(ws, a, m, t) {
    const gun = this.combat ? this.combat.equipped(a, m.gun) : null;
    if (!gun && !this.isDev(a)) return;
    if (a.x == null) return this.strike(ws, a, 1, 'fire-pose');
    a.ft = Math.min(FIRE_BURST, a.ft + ((t - a.ftt) / 1000) * FIRE_RATE); a.ftt = t;
    if (a.ft < 1 || t - a.lastFire < FIRE_MIN) { ws.serializeAttachment(a); return; }
    a.ft -= 1; a.lastFire = t;
    const dir = [m.dx, m.dy, m.dz];
    if (!dir.every((v) => typeof v === 'number' && Number.isFinite(v))) return this.strike(ws, a, 1, 'fire-dir');
    const len = Math.hypot(dir[0], dir[1], dir[2]);
    if (len < 0.5 || len > 1.5) return this.strike(ws, a, 1, 'fire-dir');
    const dx = dir[0] / len, dy = dir[1] / len, dz = dir[2] / len;
    const ago = typeof m.ago === 'number' && Number.isFinite(m.ago) ? Math.max(0, Math.min(HIST_MS, m.ago)) : 0;
    const when = t - ago;
    const R = this.rulesOf(a);
    const origin = this.rewind(a.aid, when, { x: a.x, y: a.y, z: a.z, tile: a.tile });
    const ox = origin.x, oy = origin.y + EYE, oz = origin.z;
    const stats = gun && gun.stats;
    const dmg = stats && Number.isFinite(stats.dmg) ? stats.dmg : FIRE_DMG;
    const range = stats && Number.isFinite(stats.range) ? Math.max(18, Math.min(FIRE_RANGE, stats.range + 8)) : FIRE_RANGE;
    let hit = null, hitD = range, hitKind = null;
    for (const other of this.ctx.getWebSockets()) {
      const o = this.att(other);
      if (!o || o.aid === a.aid || o.x == null || this.blocked(a.aid, o.aid)) continue;
      const p = this.rewind(o.aid, when, { x: o.x, y: o.y, z: o.z, tile: o.tile });
      const dist = surfaceDist(origin, p, R.sphereR);
      if (dist > range + 2) continue;
      const d = rayCapsule(ox, oy, oz, dx, dy, dz, p.x, p.y, p.z, CAP_R, CAP_H, range);
      if (d != null && d < hitD) { hitD = d; hit = o; hitKind = 'player'; }
    }
    // garden animals (server fauna)
    const fa = this.games && this.games.fa;
    if (fa && fa.st && Array.isArray(fa.st.animals)) {
      for (const an of fa.st.animals) {
        if (!an || an.dead) continue;
        const ax = an.x, az = an.z, ay = an.y != null ? an.y : 0;
        const d = rayCapsule(ox, oy, oz, dx, dy, dz, ax, ay, az, 0.35, 0.9, range);
        if (d != null && d < hitD) { hitD = d; hit = an; hitKind = 'animal'; }
      }
    }
    // faction NPCs, if this world has them
    const npcs = this.fa && this.fa.sim && this.fa.sim.st && this.fa.sim.st.npcs;
    if (npcs) {
      for (const n of Object.values(npcs)) {
        if (!n || n.st === 'dead') continue;
        const p = n.mv && (n.mv.x != null) ? n.mv : n;
        if (p.x == null || p.z == null) continue;
        const d = rayCapsule(ox, oy, oz, dx, dy, dz, p.x, p.y || 0, p.z, CAP_R, CAP_H, range);
        if (d != null && d < hitD) { hitD = d; hit = n; hitKind = 'npc'; }
      }
    }
    if (this.combat) {
      const rhit = this.combat.rayHit(ox, oy, oz, dx, dy, dz, range, rayCapsule);
      if (rhit && rhit.d < hitD) { hitD = rhit.d; hit = rhit.r; hitKind = 'rattler'; }
      this.combat.hear(ox, oz, origin.tile, t, gun && gun.perk === 'Quiet' ? 22 : 48);
    }
    ws.serializeAttachment(a);
    const shot = { t: 'f', id: a.aid, gun: gun ? gun.id : (this.isDev(a) ? 'm4' : null), x: r2(ox), y: r2(oy - EYE), z: r2(oz), dx: r2(dx), dy: r2(dy), dz: r2(dz), tile: origin.tile || null };
    this.broadcast(shot, null, a.aid);
    if (!hit) return;
    if (hitKind === 'player') {
      hit.hp = (hit.hp == null ? FIRE_HP : hit.hp) - dmg;
      const killed = hit.hp <= 0;
      this.broadcast({ t: 'hit', by: a.aid, id: hit.aid, kind: 'player', d: r2(hitD), dmg, hp: Math.max(0, hit.hp) }, null);
      if (killed) this.respawnPlayer(hit, a);
      else { for (const s of this.ctx.getWebSockets(hit.aid)) { const o = this.att(s); if (o) { o.hp = hit.hp; s.serializeAttachment(o); } } }
      return;
    }
    if (hitKind === 'animal' && fa && fa.gunHit) {
      const r = fa.gunHit(hit.id, t, dmg);
      if (r) this.broadcast({ t: 'hit', by: a.aid, id: r.id, kind: 'animal', sp: r.sp, d: r2(hitD), dmg, killed: !!r.killed, hp: r.hp }, null);
      return;
    }
    if (hitKind === 'npc') {
      hit.st = 'dead';
      if (hit.mv) hit.mv = { k: 'stay', x: hit.mv.x, z: hit.mv.z, yaw: 0 };
      this.broadcast({ t: 'hit', by: a.aid, id: hit.id || hit.name, kind: 'npc', d: r2(hitD), dmg, killed: true }, null);
      return;
    }
    if (hitKind === 'rattler' && this.combat) {
      const r = this.combat.hurt(hit, dmg, a, t);
      if (r) this.broadcast({ t: 'hit', by: a.aid, id: r.id, kind: 'rattler', d: r2(hitD), dmg, killed: !!r.killed, hp: r.hp }, null);
    }
  }

  npcFire(rat, target, t) {
    if (!rat || !target || target.x == null) return;
    const p = this.rewind(target.aid, t, { x: target.x, y: target.y, z: target.z, tile: target.tile });
    const ox = rat.x, oy = (rat.y || 0) + 1.45, oz = rat.z;
    const tx = p.x, ty = (p.y || 0) + EYE, tz = p.z;
    const len = Math.hypot(tx - ox, ty - oy, tz - oz) || 1;
    if (len > 42) return;
    const dx = (tx - ox) / len, dy = (ty - oy) / len, dz = (tz - oz) / len;
    const d = rayCapsule(ox, oy, oz, dx, dy, dz, p.x, p.y, p.z, CAP_R, CAP_H, 42);
    this.broadcast({ t: 'f', id: rat.id, kind: 'rattler', x: r2(ox), y: r2(rat.y || 0), z: r2(oz), dx: r2(dx), dy: r2(dy), dz: r2(dz), tile: rat.tile || null }, null);
    if (this.combat) this.combat.hear(ox, oz, rat.tile, t, 48);
    if (d == null) return;
    const dmg = 14;
    target.hp = (target.hp == null ? FIRE_HP : target.hp) - dmg;
    const killed = target.hp <= 0;
    this.broadcast({ t: 'hit', by: rat.id, id: target.aid, kind: 'player', d: r2(d), dmg, hp: Math.max(0, target.hp) }, null);
    if (killed) this.respawnPlayer(target, { aid: rat.id });
    else {
      for (const s of this.ctx.getWebSockets(target.aid)) {
        const o = this.att(s);
        if (o) { o.hp = target.hp; s.serializeAttachment(o); }
      }
    }
  }

  respawnPlayer(hit, by) {
    hit.hp = FIRE_HP;
    const sp = WORLD_SPAWN;
    hit.x = sp.x; hit.y = sp.y || 0; hit.z = sp.z; hit.tile = sp.tile || null; hit.yaw = sp.yaw || 0;
    try { this.sql.exec('INSERT OR REPLACE INTO lastpos (aid, x, y, z, tile, ts) VALUES (?, ?, ?, ?, ?, ?)', hit.aid, hit.x, hit.y, hit.z, hit.tile || '', Date.now()); } catch { /* */ }
    for (const s of this.ctx.getWebSockets(hit.aid)) {
      const o = this.att(s);
      if (o) { o.hp = FIRE_HP; o.x = hit.x; o.y = hit.y; o.z = hit.z; o.tile = hit.tile; o.yaw = hit.yaw; s.serializeAttachment(o); }
      this.send(s, { t: 'respawn', x: hit.x, y: hit.y, z: hit.z, tile: hit.tile, yaw: hit.yaw, hp: FIRE_HP });
    }
    this.broadcast({ t: 'kill', id: hit.aid, by: by && by.aid, x: hit.x, y: hit.y, z: hit.z, tile: hit.tile }, null);
  }

  async webSocketClose(ws, code, reason) {
    const a = this.att(ws);
    try { ws.close(code >= 1000 && code < 5000 && code !== 1005 && code !== 1006 ? code : 1000, 'bye'); } catch { /* already closed */ }
    if (a) {
      if (a.x != null) this.sql.exec('INSERT OR REPLACE INTO lastpos (aid, x, y, z, tile, ts) VALUES (?, ?, ?, ?, ?, ?)', a.aid, a.x, a.y, a.z, a.tile || '', Date.now());
      const still = this.ctx.getWebSockets(a.aid).some((s) => s !== ws);
      if (!still) { this.broadcast({ t: 'leave', id: a.aid }, ws); try { this.games.leave(a); } catch (e) { console.warn('[games] leave', e && e.message); } await this.presence(a.aid, null); this.hist.delete(a.aid); }
      try { this.fa.onClose(); } catch { /* */ }
    }
    this.count();
  }
  async webSocketError(ws) { return this.webSocketClose(ws, 1011, 'error'); }

  setBlock(aid, other, on) {
    if (on) this.sql.exec('INSERT OR IGNORE INTO blk (aid, other) VALUES (?, ?)', aid, other);
    else this.sql.exec('DELETE FROM blk WHERE aid = ? AND other = ?', aid, other);
    this.blk = null;
    for (const ws of this.ctx.getWebSockets(aid)) this.send(ws, { t: on ? 'blocked' : 'unblocked', id: other });
    if (on) for (const ws of this.ctx.getWebSockets(other)) this.send(ws, { t: 'leave', id: aid });
    return true;
  }
  chatContext(target) {
    return this.sql.exec('SELECT ts, aid, name, text FROM chat ORDER BY id DESC LIMIT 30').toArray().reverse().map((r) => ({ ...r, target: r.aid === target }));
  }
  kick(aid, why = 'removed') { for (const ws of this.ctx.getWebSockets(aid)) ws.close(4004, why); return true; }
}

// Ray (ox,oy,oz + unit dir) vs a vertical capsule (feet at px,py,pz, radius r, height h). Returns travel or null.
function rayCapsule(ox, oy, oz, dx, dy, dz, px, py, pz, r, h, maxD) {
  const y0 = py + r, y1 = py + h - r;
  // side (infinite cylinder on xz), then clip to the segment; also cap spheres
  const fx = ox - px, fz = oz - pz;
  const a = dx * dx + dz * dz;
  let best = null;
  const keep = (t) => { if (t >= 0 && t <= maxD && (best == null || t < best)) best = t; };
  if (a > 1e-12) {
    const b = 2 * (fx * dx + fz * dz), c = fx * fx + fz * fz - r * r, disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const s = Math.sqrt(disc), t1 = (-b - s) / (2 * a), t2 = (-b + s) / (2 * a);
      for (const t of [t1, t2]) {
        const y = oy + dy * t;
        if (y >= y0 && y <= y1) keep(t);
      }
    }
  }
  for (const cy of [y0, y1]) {
    const t = raySphere(ox, oy, oz, dx, dy, dz, px, cy, pz, r);
    if (t != null) keep(t);
  }
  return best;
}
function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const fx = ox - cx, fy = oy - cy, fz = oz - cz;
  const b = 2 * (fx * dx + fy * dy + fz * dz), c = fx * fx + fy * fy + fz * fz - r * r, disc = b * b - 4 * c;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / 2;
  return t >= 0 ? t : null;
}

// ---- optional pose extras (other players drawn as real characters). Everything is checked and rebuilt, never passed through.
const LOOK_RE = /^ZA1\.[A-Za-z0-9_-]{40,70}$/;
const STATE_RE = /^[a-z_]{1,16}$/;
const MOVE_ANG = [['by', -7, 7], ['ay', -7, 7], ['ap', -2, 2], ['tl', -2, 2]];
const fin = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v * 100) / 100)) : 0);
export function poseExtras(m, a) {
  const x = {};
  if (typeof m.ct === 'number' && Number.isFinite(m.ct)) x.ct = Math.round(m.ct) % 2147483647;
  const v = m.m;
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    // delta-only senders send just the fields that changed (receivers merge), so only the fields present are rebuilt
    const o = {};
    if ('sp' in v) o.sp = fin(v.sp, 0, 20);
    if ('g' in v) o.g = v.g !== false;
    if ('vy' in v) o.vy = fin(v.vy, -80, 80);
    if ('st' in v) o.st = typeof v.st === 'string' && STATE_RE.test(v.st) ? v.st : 'idle';
    if ('a' in v) o.a = Array.isArray(v.a) ? v.a.filter((n) => typeof n === 'string' && STATE_RE.test(n)).slice(0, 2) : [];
    for (const [k, lo, hi] of MOVE_ANG) if (k in v) o[k] = fin(v[k], lo, hi);
    if ('gn' in v) o.gn = v.gn ? 1 : 0;
    if (Object.keys(o).length) x.m = o;
  }
  if (typeof m.lk === 'string' && LOOK_RE.test(m.lk)) { x.lk = m.lk; a.lk = m.lk; }
  return x;
}
