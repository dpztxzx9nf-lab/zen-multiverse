// One World Durable Object per world key (+ shard). Holds the live sockets for that world, checks every
// message, relays validated poses + chat + world edits, and keeps nothing a client could forge: names,
// ids, mute and block lists all come from the signed ticket the Worker verified, never from the client.
// Uses the WebSocket Hibernation API: when nobody is moving or talking the object sleeps (no duration
// billing) while sockets stay open; per-socket state lives in serializeAttachment (keep it small).
import { DurableObject } from 'cloudflare:workers';
import { cleanChat } from './filter.js';
import { parseWorld, RULES, PIECE_TYPES, PIECE_MATS, rulesFor, WORLD_SPAWN, WORLD_OWNER } from './worlds.js';
const SHARED_CAP = 48; // the one shared world (one DO); regional and skill-based servers come later
import { surfaceDist, tileOk, frameOf, arc } from './sphere.js';
import { regionAt } from '../../js/xenia/xenia.js';
import { gardenBlock } from './garden.js';
import { COVE, HEAD } from '../../js/cove.js';
import { VS } from '../../js/game/g7/materials.js';
import { parseAb, maxRise, JUMP_V } from './physics.js';
import { Factions } from './factions.js';
import { Games } from './games.js';

const MAX_MSG = 16384;          // bytes per client message (edits may be larger than poses)
const POSE_MAX = 1024;
const EDIT_HARD = 262144;        // an edit message past MAX_MSG but under this is rejected, not closed
const CHAT_MAX = 400;
const POSE_RATE = 15, POSE_BURST = 20;   // messages / s (client sends 10 Hz while moving)
const CHAT_EVERY = 1200, CHAT_BURST = 4;
const EDIT_RATE = 6, EDIT_BURST = 8;
const FIRE_RATE = 8, FIRE_BURST = 4;
const GAME_RATE = 8, GAME_BURST = 10;  // compete/co-op intents per second
const VIO_KICK = 12;
const TELEPORT = 20;            // one-step walk (m) that counts as a teleport attempt
const FRAME_SWITCH_MS = 15e3;  // flat-frame <-> tile re-seat (not on Xenia, where the hub frame is on the sphere), at most this often
const VOX_CS = 32 * VS;         // voxel chunk size (m), js/game/g7/voxel.js CS
const REGION_MS = 1000;         // region tag refresh while moving
const HUB_PER = 400;            // pieces one player may have up on Xenia
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
    // Xenia: region tags (safe / guarded / contested / wild), kept now for the raid rules that come later
    try { this.sql.exec('ALTER TABLE lastpos ADD COLUMN rg TEXT'); } catch { /* already there */ }
    try { this.sql.exec('ALTER TABLE builds ADD COLUMN rg TEXT'); } catch { /* already there */ }
    this.sql.exec('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)');
    this.hist = new Map(); // aid -> [{t,x,y,z,yaw,tile}]  (in-memory; empty after hibernation)
    this.fa = new Factions(this); // witnesses, memories, couriers (server/src/factions.js)
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    this.games = new Games(this);
  }
  async alarm() { await this.games.alarm(); }

  parsed(name) { return parseWorld((name || '').split('#')[0]); }
  // Xenia (every home world): no tile = the hub frame, which sits on the sphere like a tile does
  isX(a) { return !!a && a.kind === 'home'; }
  dist(a, b) { return surfaceDist(a, b, this.rulesOf(a).sphereR, this.isX(a)); }
  // the region a pose is in (Xenia only): { id, risk } or null
  regionOf(a, p) {
    if (!this.isX(a) || !p) return null;
    try { const R = this.rulesOf(a).sphereR, d = frameOf(R, p.tile || null, true).toDir(p.x, p.z); const r = regionAt(d, R); return { id: r.id, risk: r.risk }; } catch { return null; }
  }
  // Once per Xenia world: the old garden's shared building (garden_builds) becomes ordinary world builds on the
  // hub frame (tile ''). Same coordinates: the hub frame's origin is the old garden's. The old table stays as it
  // was (nothing deleted), it is just no longer read.
  migrateXenia() {
    if (this.xm) return; this.xm = 1;
    if (this.sql.exec("SELECT 1 FROM meta WHERE k = 'xenia'").toArray().length) return;
    try {
      const has = this.sql.exec("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'garden_builds'").toArray().length;
      if (has) this.sql.exec("INSERT OR IGNORE INTO builds (id, tile, typ, mat, x, y, z, yaw, aid, ts, rg) SELECT id, '', type, mat, x, y, z, yaw, by, ts, 'home' FROM garden_builds");
    } catch (e) { console.warn('[world] xenia migrate', e && e.message); }
    this.sql.exec("INSERT OR REPLACE INTO meta (k, v) VALUES ('xenia', ?)", String(Date.now()));
  }
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
    if (w.kind === 'home') this.migrateXenia();
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
      last: '', hb: t, drops: 0, air: 0, ab: 0, vb: VB_CAP, soft: 0 };
    let resume = null;
    if (tk.resume) {
      const lp = this.sql.exec('SELECT x, y, z, tile, ts FROM lastpos WHERE aid = ?', a.aid).toArray()[0];
      if (lp && t - lp.ts < 30 * 60e3) {
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
      } else if (tk.near || !seen) { resume = { x: WORLD_SPAWN.x, y: 0, z: WORLD_SPAWN.z, tile: null, yaw: WORLD_SPAWN.yaw }; spawn = 'spawn'; }
      if (spawn) { a.x = resume.x; a.y = resume.y; a.z = resume.z; a.tile = resume.tile; a.lt = t; a.budget = 1; }
    }
    server.serializeAttachment(a);
    const others = this.ctx.getWebSockets().filter((s) => s !== server).map((s) => this.att(s)).filter((o) => o && !this.blocked(a.aid, o.aid));
    this.send(server, { t: 'hi', you: { id: a.aid, name: a.name, tag: a.tag }, world: name, n: others.length + 1,
      peers: others.filter((o) => o.x != null).map((o) => ({ id: o.aid, name: o.name, tag: o.tag, x: o.x, y: o.y, z: o.z, yaw: o.yaw, tile: o.tile || null })),
      others: others.map((o) => ({ id: o.aid, name: o.name, tag: o.tag })),
      rules: { maxH: rules.maxH, g: rules.gravity, sphereR: rules.sphereR }, resume, spawn, st: t, fa: 1, games: 1 });
    this.broadcast({ t: 'join', id: a.aid, name: a.name, tag: a.tag }, server, a.aid);
    this.count();
    for (const o of others) if (o.lk) this.send(server, { t: 'lk', id: o.aid, lk: o.lk });
    await this.presence(a.aid, name);
    this.sendSnap(server);
    this.games.hello(server, a);
    return new Response(null, { status: 101, webSocket: client });
  }

  att(ws) { try { return ws.deserializeAttachment(); } catch { return null; } }
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
    if ((m.tile || this.hubW) && this.sR) { try { const f = frameOf(this.sR, m.tile || null, !!this.hubW); dir = f ? f.toDir(m.x, m.z) : null; } catch { /* flat */ } }
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
    // an edit (build / dig) over the size limit is dropped with a word, never a closed socket; anything else
    // that size, or past EDIT_HARD, still closes it
    if (typeof raw === 'string' && raw.length > MAX_MSG && raw.length <= EDIT_HARD && raw.startsWith('{"t":"e"')) {
      this.reject(ws, a, 'edit-size ' + raw.length); this.send(ws, { t: 'sys', text: 'That change was too big to send in one go; it stays on your screen only.' }); return;
    }
    if (typeof raw !== 'string' || raw.length > MAX_MSG) { await this.flag(a, 'oversize', typeof raw === 'string' ? raw.length : 'binary'); return ws.close(1009, 'too big'); }
    a.pt = Math.min(POSE_BURST, a.pt + ((t - a.ptt) / 1000) * POSE_RATE); a.ptt = t;
    // over-rate messages are dropped; only a sustained flood (>150 dropped within a 10 s stretch) closes the socket.
    // A Wi-Fi stall that flushes ~10 s of queued poses at once is dropped quietly, not kicked.
    if (a.pt < 1 && this.env.LOCAL_DEV === '1' && !String(raw).startsWith('{"t":"p"')) console.warn('[drop]', a.name, String(raw).slice(0, 60));
    if (a.pt < 1) { if (t - (a.dropT || 0) > 10e3) a.drops = 0; a.dropT = t; if (++a.drops > 150) { if (this.env.LOCAL_DEV === '1') console.warn('[flood] last message', String(raw).slice(0, 90)); await this.flag(a, 'flood', a.drops); return ws.close(4008, 'too many messages'); } ws.serializeAttachment(a); return; }
    a.pt -= 1;
    let m; try { m = JSON.parse(raw); } catch { return this.strike(ws, a, 2, 'json'); }
    if (!m || typeof m !== 'object' || Array.isArray(m)) return this.strike(ws, a, 2, 'shape');
    if (t - a.vt > 10e3) { const n = Math.floor((t - a.vt) / 10e3); a.vio = Math.max(0, a.vio - n); a.soft = Math.max(0, (a.soft || 0) - 10 * n); a.vt = t; }
    switch (m.t) {
      case 'p': return this.pose(ws, a, m, t);
      case 'c': return this.chat(ws, a, m, t);
      case 'e': return this.edit(ws, a, m, t);
      case 'f': return this.fire(ws, a, m, t);
      case 'fa': return this.fa.onMsg(ws, a, m, t);
      case 'g': {
        a.gt = Math.min(GAME_BURST, (a.gt ?? GAME_BURST) + ((t - (a.gtt || t)) / 1000) * GAME_RATE); a.gtt = t;
        if (a.gt < 1) { ws.serializeAttachment(a); return; }
        a.gt -= 1; ws.serializeAttachment(a);
        return this.games.msg(ws, a, m, t);
      }
      case 'hb': if (t - a.hb > 45e3) { a.hb = t; await this.presence(a.aid, a.world); } ws.serializeAttachment(a); return;
      default: return this.strike(ws, a, 1, 'type');
    }
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
    this.sR = R.sphereR; this.hubW = this.isX(a);
    this.pct = [a.aid, poseExtras(m, a)]; // relayed with the accepted pose (all optional; older clients send none)
    const tile = (typeof m.tile === 'string' && m.tile) ? m.tile : null;
    if (!tileOk(tile, R.sphereR)) return this.strike(ws, a, 2, 'tile');
    const ab = parseAb(m.ab);
    if (a.fx) { if (m.r !== a.fx) { ws.serializeAttachment(a); return; } a.fx = 0; a.lt = t; }
    let { x, y, z, yaw } = m;
    yaw = ((yaw % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    // no world borders: only reject non-finite / absurd heights (through the planet, or above any walk/jet)
    if (Math.abs(x) > 1e7 || Math.abs(z) > 1e7 || y < -R.sphereR || y > 20000) {
      await this.flag(a, 'bounds', `${r2(x)},${r2(y)},${r2(z)}`);
      return this.correct(ws, a, 3, 'bounds', seq);
    }
    const next = { x, y, z, yaw, tile };
    const prev = a.x != null ? { x: a.x, y: a.y, z: a.z, tile: a.tile } : null;
    if (a.x == null) {
      const lp = this.sql.exec('SELECT x, y, z, tile, ts FROM lastpos WHERE aid = ?', a.aid).toArray()[0];
      if (lp && t - lp.ts < 10e3) {
        const d0 = this.dist({ kind: a.kind, world: a.world, x: lp.x, z: lp.z, tile: lp.tile || null }, next);
        if (d0 > R.maxH * ((t - lp.ts) / 1000) + 3) {
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
      const d = this.dist(a, next), dy = y - a.y;
      // On Xenia the hub frame (no tile) is a frame on the sphere like any tile: walking between it and the tiles
      // is measured on the sphere above, so there is no re-seat there (there used to be a separate garden map, and
      // the app switched to it at start-up). Elsewhere a flat frame (no tile) and the sphere's tiles are two maps
      // with their own coordinates: stepping between them is a re-seat, at most one per FRAME_SWITCH_MS.
      if (!this.isX(a) && (a.tile == null) !== (tile == null) && t - (a.fsT || 0) > FRAME_SWITCH_MS) {
        a.fsT = t; a.x = x; a.y = y; a.z = z; a.yaw = yaw; a.tile = tile; a.lt = t; a.budget = 1; a.vb = VB_CAP; a.air = 0; a.ab = ab.bits;
      } else {
      if (d > TELEPORT) { await this.flag(a, 'teleport', `${r2(d)} m`); return this.correct(ws, a, 3, 'teleport', seq); }
      if (d > a.budget + 0.25) return this.correct(ws, a, this.soft(a), 'speed', seq);
      if (this.games.blocks(a, next)) return this.correct(ws, a, 0, 'wall', seq); // the vault's shut slab and walls are solid
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
    if (this.isX(a) && (t - (a.rgT || 0) > REGION_MS || (a.tile || null) !== (a.rgTile || null))) {
      const r = this.regionOf(a, a); a.rgT = t; a.rgTile = a.tile || null;
      if (r) { a.rg = r.id; a.risk = r.risk; }
    }
    if (seq && t - a.at > 500) { a.at = t; this.send(ws, { t: 'a', s: seq, x: r2(a.x), y: r2(a.y), z: r2(a.z), tile: a.tile, ...(a.rg ? { rg: a.rg } : {}) }); }
    ws.serializeAttachment(a);
    this.remember(a, t);
    this.broadcast({ t: 'p', id: a.aid, x: r2(a.x), y: r2(a.y), z: r2(a.z), yaw: r2(a.yaw), tile: a.tile || null }, ws, a.aid);
    try { this.fa.onPose(a, t); } catch (e) { console.warn('[fa] pose', e && e.message); }
    try { this.games.onPose(ws, a, prev && (prev.tile || null) === (a.tile || null) ? prev : null, t); } catch (e) { console.warn('[games] pose', e && e.message); }
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
  // A world edit (build / dig) that fails a check is dropped and noted, never a strike: a stale or buggy client
  // must not lose its connection over a piece (the 0.2.18 build-disconnect fix). Movement checks still strike.
  reject(ws, a, why) {
    a.rj = (a.rj || 0) + 1;
    if (a.rj <= 3 || a.rj % 50 === 0) console.warn(`[edit] ${a.aid.slice(0, 8)} rejected ${why} (x${a.rj})`);
    ws.serializeAttachment(a);
  }
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
    if (tile && !tileOk(tile, R.sphereR)) return this.reject(ws, a, 'edit-tile');
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
    return this.reject(ws, a, 'edit-kind');
  }

  async editVox(ws, a, m, t, tile) {
    const diffs = m.diffs;
    if (!diffs || typeof diffs !== 'object' || Array.isArray(diffs)) return this.reject(ws, a, 'vox-shape');
    const keys = Object.keys(diffs);
    if (keys.length > 24) return this.reject(ws, a, 'vox-many');
    const accepted = {};
    for (const ck of keys) {
      const data = diffs[ck];
      if (!CHUNK_RE.test(ck) || typeof data !== 'string' || data.length > 8000 || !B64_RE.test(data)) return this.reject(ws, a, 'vox-chunk');
      if (this.isX(a) && !tile && this.hubKeep(ck)) continue; // the client won't dig there either (planet.js noDig)
      this.sql.exec('INSERT OR REPLACE INTO vox (tile, ck, data, aid, ts) VALUES (?, ?, ?, ?, ?)', tile, ck, data, a.aid, t);
      accepted[ck] = data;
    }
    ws.serializeAttachment(a);
    if (!m.quiet && Object.keys(accepted).length) this.broadcast({ t: 'e', k: 'vox', id: a.aid, tile, diffs: accepted }, ws, a.aid);
  }

  // Xenia's hub frame: chunks wholly inside Mom's garden or the cove stay as they are
  hubKeep(ck) {
    const [cx, , cz] = ck.split(',').map(Number), x = (cx + 0.5) * VOX_CS, z = (cz + 0.5) * VOX_CS, h = VOX_CS * 0.71;
    return Math.hypot(x - 1.5, z + 0.5) + h < 62 || Math.hypot(x - COVE.x, z - (COVE.z + HEAD.z) / 2) + h < 24;
  }
  // why a build can't go here on Xenia (null = fine): the garden's beds, pond, sand, paths, camps, the arrival stone
  hubNoBuild(tile, x, z) {
    if (tile) return null;
    const why = gardenBlock(x, z, 0.2); if (why) return why.startsWith('place:') ? 'camp' : why;
    if (Math.hypot(x - COVE.x, z - (COVE.z + HEAD.z) / 2) < 24) return 'cove';
    return null;
  }
  async editBuild(ws, a, m, t, tile) {
    const op = m.op === 'remove' ? 'remove' : 'place';
    if (op === 'remove') {
      const id = typeof m.id === 'string' && /^[0-9a-z]{6,32}$/i.test(m.id) ? m.id : null;
      if (!id) return this.reject(ws, a, 'build-id');
      const row = this.sql.exec('SELECT id, tile, x, y, z, aid FROM builds WHERE id = ?', id).toArray()[0];
      if (!row) { ws.serializeAttachment(a); return; }
      // Xenia: only the builder takes a piece down (raid rules for contested ground come later; rg is stored)
      if (this.isX(a) && row.aid && row.aid !== a.aid) { ws.serializeAttachment(a); if (!m.quiet) this.send(ws, { t: 'sys', text: 'Someone else built that.' }); return; }
      // must be standing near the piece (or have no pose yet)
      if (a.x != null) {
        const d = this.dist(a, { x: row.x, z: row.z, tile });
        if (d > 12) return this.reject(ws, a, 'build-reach');
      }
      this.sql.exec('DELETE FROM builds WHERE id = ?', id);
      ws.serializeAttachment(a);
      this.broadcast({ t: 'e', k: 'build', op: 'remove', id, tile, by: a.aid }, null, a.aid);
      return;
    }
    const p = m.piece;
    if (!Array.isArray(p) || p.length < 6) return this.reject(ws, a, 'build-shape');
    const [typ, mat, x, y, z, yaw] = p;
    if (!PIECE_TYPES.includes(typ) || !PIECE_MATS.includes(mat)) return this.reject(ws, a, 'build-kind');
    if (![x, y, z, yaw].every((v) => typeof v === 'number' && Number.isFinite(v))) return this.reject(ws, a, 'build-num');
    if (a.x != null) {
      const d = this.dist(a, { x, z, tile });
      if (d > 12) return this.reject(ws, a, 'build-reach');
    }
    const id = (typeof m.id === 'string' && /^[0-9a-z]{6,32}$/i.test(m.id)) ? m.id : id12();
    let rg = null;
    if (this.isX(a)) {
      const no = this.hubNoBuild(tile, x, z);
      if (no) { ws.serializeAttachment(a); if (!m.quiet) this.send(ws, { t: 'sys', text: `Not on the ${no}.` }); return; }
      const own = this.sql.exec('SELECT COUNT(*) AS n FROM builds WHERE aid = ?', a.aid).toArray()[0]?.n || 0;
      if (own >= HUB_PER) { ws.serializeAttachment(a); this.send(ws, { t: 'sys', text: `You have ${HUB_PER} pieces up already. Take some down first.` }); return; }
      const prior = this.sql.exec('SELECT aid FROM builds WHERE id = ?', id).toArray()[0];
      if (prior && prior.aid && prior.aid !== a.aid) { ws.serializeAttachment(a); if (!m.quiet) this.send(ws, { t: 'sys', text: 'Someone else built that.' }); return; } // can't move someone else's piece: rejected, never a strike
      const r = this.regionOf(a, { x, z, tile: tile || null }); rg = r ? r.id : null;
    }
    const n = this.sql.exec('SELECT COUNT(*) AS n FROM builds').toArray()[0]?.n || 0;
    if (n > 4000) { this.send(ws, { t: 'sys', text: 'This world is full of buildings for now.' }); return; }
    try {
      const existing = this.sql.exec('SELECT id FROM builds WHERE id = ?', id).toArray()[0];
      if (existing) this.sql.exec('UPDATE builds SET tile=?, typ=?, mat=?, x=?, y=?, z=?, yaw=?, aid=?, ts=?, rg=? WHERE id=?', tile, typ, mat, x, y, z, yaw, a.aid, t, rg, id);
      else this.sql.exec('INSERT INTO builds (id, tile, typ, mat, x, y, z, yaw, aid, ts, rg) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', id, tile, typ, mat, x, y, z, yaw, a.aid, t, rg);
    } catch (e) { console.warn('[world] build save', e && e.message); ws.serializeAttachment(a); return this.reject(ws, a, 'build-save'); }
    ws.serializeAttachment(a);
    if (this.isX(a) && !tile) { try { if (this.games.op) this.games.op.built(a, { type: typ, x, y, z }, t); } catch (e) { console.warn('[world] built', e && e.message); } }
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

  // ---- gunplay skeleton: server-authoritative hits, lag-compensated rewind (~1 s of poses)
  async fire(ws, a, m, t) {
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
    let hit = null, hitD = FIRE_RANGE;
    for (const other of this.ctx.getWebSockets()) {
      const o = this.att(other);
      if (!o || o.aid === a.aid || o.x == null || this.blocked(a.aid, o.aid)) continue;
      const p = this.rewind(o.aid, when, { x: o.x, y: o.y, z: o.z, tile: o.tile });
      const dist = surfaceDist(origin, p, R.sphereR, this.isX(a));
      if (dist > FIRE_RANGE + 2) continue;
      // line of sight: capsule at the rewound pose (terrain LoS is phase 2 — no heightfield on the DO yet)
      const d = rayCapsule(ox, oy, oz, dx, dy, dz, p.x, p.y, p.z, CAP_R, CAP_H, FIRE_RANGE);
      if (d != null && d < hitD) { hitD = d; hit = o; }
    }
    ws.serializeAttachment(a);
    const shot = { t: 'f', id: a.aid, x: r2(ox), y: r2(oy - EYE), z: r2(oz), dx: r2(dx), dy: r2(dy), dz: r2(dz), tile: origin.tile || null };
    this.broadcast(shot, null, a.aid);
    if (hit) {
      const msg = { t: 'hit', by: a.aid, id: hit.aid, d: r2(hitD), dmg: 1 };
      this.broadcast(msg, null);
    }
  }

  async webSocketClose(ws, code, reason) {
    const a = this.att(ws);
    try { ws.close(code >= 1000 && code < 5000 && code !== 1005 && code !== 1006 ? code : 1000, 'bye'); } catch { /* already closed */ }
    if (a) {
      if (a.x != null) this.sql.exec('INSERT OR REPLACE INTO lastpos (aid, x, y, z, tile, ts, rg) VALUES (?, ?, ?, ?, ?, ?, ?)', a.aid, a.x, a.y, a.z, a.tile || '', Date.now(), a.rg || null);
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
    if (Object.keys(o).length) x.m = o;
  }
  if (typeof m.lk === 'string' && LOOK_RE.test(m.lk)) { x.lk = m.lk; a.lk = m.lk; }
  return x;
}
