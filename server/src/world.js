// One World Durable Object per world key (+ shard). Holds the live sockets for that world, checks every
// message, relays validated poses + chat, and keeps nothing a client could forge: names, ids, mute and
// block lists all come from the signed ticket the Worker verified, never from the client.
// Uses the WebSocket Hibernation API: when nobody is moving or talking the object sleeps (no duration
// billing) while sockets stay open; per-socket state lives in serializeAttachment.
import { DurableObject } from 'cloudflare:workers';
import { cleanChat } from './filter.js';
import { parseWorld, RULES } from './worlds.js';

const MAX_MSG = 1024;           // bytes per client message
const POSE_RATE = 15, POSE_BURST = 20;   // messages / s (client sends 10 Hz while moving)
const CHAT_EVERY = 1200, CHAT_BURST = 4; // one line per 1.2 s, bursts of 4
const VIO_KICK = 12;            // violation score that closes the socket
const TELEPORT = 20;            // one-step jump (m) that counts as a teleport attempt
const r2 = (v) => Math.round(v * 100) / 100;

export class World extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS jti (id TEXT PRIMARY KEY, exp INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS blk (aid TEXT NOT NULL, other TEXT NOT NULL, PRIMARY KEY (aid, other));
      CREATE TABLE IF NOT EXISTS chat (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, aid TEXT, name TEXT, text TEXT);
      CREATE TABLE IF NOT EXISTS lastpos (aid TEXT PRIMARY KEY, x REAL, y REAL, z REAL, ts INTEGER);`);
    // keep-alive pings never wake the object
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

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
    const rules = RULES[w.kind];
    const live = this.ctx.getWebSockets();
    const dupe = live.filter((s) => this.att(s)?.aid === tk.aid);
    if (live.length - dupe.length >= rules.cap) return new Response('full', { status: 409 });
    for (const s of dupe) { try { s.close(4001, 'signed in somewhere else'); } catch { /* */ } }

    this.sql.exec('DELETE FROM blk WHERE aid = ?', tk.aid);
    for (const o of tk.blocks || []) this.sql.exec('INSERT OR IGNORE INTO blk (aid, other) VALUES (?, ?)', tk.aid, o);

    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server, [tk.aid]);
    const a = { aid: tk.aid, name: tk.name, tag: tk.tag, muted: !!tk.muted, world: name, kind: w.kind,
      x: null, y: 0, z: 0, yaw: 0, lt: 0, budget: 0, fid: 0, fx: 0, at: 0, vio: 0, vt: t, pt: POSE_BURST, ptt: t, ct: CHAT_BURST, ctt: t, last: '', hb: t, drops: 0 };
    // session resume: after a dropped connection she continues from the last spot the server accepted
    let resume = null;
    if (tk.resume) {
      const lp = this.sql.exec('SELECT x, y, z, ts FROM lastpos WHERE aid = ?', a.aid).toArray()[0];
      if (lp && t - lp.ts < 30 * 60e3) { a.x = lp.x; a.y = lp.y; a.z = lp.z; a.lt = t; a.budget = 1; resume = { x: lp.x, y: lp.y, z: lp.z }; }
    }
    server.serializeAttachment(a);
    const others = this.ctx.getWebSockets().filter((s) => s !== server).map((s) => this.att(s)).filter((o) => o && !this.blocked(a.aid, o.aid));
    this.send(server, { t: 'hi', you: { id: a.aid, name: a.name, tag: a.tag }, world: name, n: others.length + 1,
      peers: others.filter((o) => o.x != null).map((o) => ({ id: o.aid, name: o.name, tag: o.tag, x: o.x, y: o.y, z: o.z, yaw: o.yaw })),
      others: others.map((o) => ({ id: o.aid, name: o.name, tag: o.tag })), rules: { maxH: rules.maxH }, resume, st: t });
    this.broadcast({ t: 'join', id: a.aid, name: a.name, tag: a.tag }, server, a.aid);
    this.count();
    await this.presence(a.aid, name);
    return new Response(null, { status: 101, webSocket: client });
  }

  att(ws) { try { return ws.deserializeAttachment(); } catch { return null; } }
  send(ws, m) { try { ws.send(JSON.stringify(m)); } catch { /* closed */ } }
  blocked(a, b) { return this.sql.exec('SELECT 1 FROM blk WHERE (aid = ?1 AND other = ?2) OR (aid = ?2 AND other = ?1) LIMIT 1', a, b).toArray().length > 0; }
  broadcast(m, except, from) {
    const s = JSON.stringify(m);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      const o = this.att(ws);
      if (from && o && this.blocked(from, o.aid)) continue;
      try { ws.send(s); } catch { /* */ }
    }
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
    if (typeof raw !== 'string' || raw.length > MAX_MSG) { await this.flag(a, 'oversize', typeof raw === 'string' ? raw.length : 'binary'); return ws.close(1009, 'too big'); }
    // token bucket for all messages
    a.pt = Math.min(POSE_BURST, a.pt + ((t - a.ptt) / 1000) * POSE_RATE); a.ptt = t;
    if (a.pt < 1) { if (++a.drops > 60) { await this.flag(a, 'flood', a.drops); return ws.close(4008, 'too many messages'); } ws.serializeAttachment(a); return; }
    a.pt -= 1;
    let m; try { m = JSON.parse(raw); } catch { return this.strike(ws, a, 2, 'json'); }
    if (!m || typeof m !== 'object' || Array.isArray(m)) return this.strike(ws, a, 2, 'shape');
    // forgive slowly: one violation point per 10 s of clean play
    if (t - a.vt > 10e3) { a.vio = Math.max(0, a.vio - Math.floor((t - a.vt) / 10e3)); a.vt = t; }
    switch (m.t) {
      case 'p': return this.pose(ws, a, m, t);
      case 'c': return this.chat(ws, a, m, t);
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
    const R = RULES[a.kind];
    const keys = Object.keys(m);
    if (keys.length > 7 || !['x', 'y', 'z', 'yaw'].every((k) => typeof m[k] === 'number' && Number.isFinite(m[k]))) return this.strike(ws, a, 2, 'pose-shape');
    const seq = Number.isInteger(m.s) ? m.s : 0;
    // after a correction, moves still in flight from before it are ignored (no strikes) until the
    // client confirms it snapped back (r = fix id). Then validation resumes from the corrected spot.
    if (a.fx) { if (m.r !== a.fx) { ws.serializeAttachment(a); return; } a.fx = 0; a.lt = t; }
    let { x, y, z, yaw } = m;
    yaw = ((yaw % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const out = Math.hypot(x - R.center[0], z - R.center[1]) > R.r || y < R.yMin || y > R.yMax;
    if (out) { await this.flag(a, 'bounds', `${r2(x)},${r2(y)},${r2(z)}`); return this.correct(ws, a, 3, 'bounds', seq); }
    if (a.x == null) {
      // first pose: anywhere legal in the world (the client restores her saved spot on arrival).
      // A rejoin within 10 s must start near where she left (no disconnect-to-teleport).
      const lp = this.sql.exec('SELECT x, y, z, ts FROM lastpos WHERE aid = ?', a.aid).toArray()[0];
      if (lp && t - lp.ts < 10e3 && Math.hypot(x - lp.x, z - lp.z) > R.maxH * ((t - lp.ts) / 1000) + 3) {
        a.x = lp.x; a.y = lp.y; a.z = lp.z; a.lt = t;
        await this.flag(a, 'rejoin-teleport', `${r2(Math.hypot(x - lp.x, z - lp.z))} m`);
        return this.correct(ws, a, 3, 'rejoin', seq);
      }
      a.x = x; a.y = y; a.z = z; a.yaw = yaw; a.lt = t; a.budget = 1;
    } else {
      // movement budget (leaky bucket): earns maxH metres per second, holds at most ~1 s of it, so
      // bunched packets from a laggy phone pass but sustained speed hacks and blinks do not.
      const dt = Math.min(2, (t - a.lt) / 1000);
      a.budget = Math.min(R.maxH + 1, a.budget + R.maxH * dt);
      const d = Math.hypot(x - a.x, z - a.z), dy = y - a.y;
      if (d > TELEPORT) { await this.flag(a, 'teleport', `${r2(d)} m`); return this.correct(ws, a, 4, 'teleport', seq); }
      if (d > a.budget + 0.25) return this.correct(ws, a, 1, 'speed', seq);
      if (dy > 6 * dt + 2.5) return this.correct(ws, a, 1, 'fly', seq);   // up faster than a jump allows
      a.budget -= d;
      a.x = x; a.y = y; a.z = z; a.yaw = yaw; a.lt = t;
    }
    // ack the newest accepted move twice a second (client uses it for reconciliation + latency)
    if (seq && t - a.at > 500) { a.at = t; this.send(ws, { t: 'a', s: seq, x: r2(a.x), y: r2(a.y), z: r2(a.z) }); }
    ws.serializeAttachment(a);
    this.broadcast({ t: 'p', id: a.aid, x: r2(a.x), y: r2(a.y), z: r2(a.z), yaw: r2(a.yaw) }, ws, a.aid);
  }

  // reject a move: tell her client the last good spot (it snaps back) and score it
  async correct(ws, a, pts, why, seq = 0) {
    a.lt = Date.now(); a.fid += 1; a.fx = a.fid;
    this.send(ws, { t: 'fix', id: a.fid, s: seq, x: a.x, y: a.y, z: a.z, why });
    return this.strike(ws, a, pts, why);
  }

  async chat(ws, a, m, t) {
    if (typeof m.text !== 'string' || Object.keys(m).length > 2) return this.strike(ws, a, 1, 'chat-shape');
    if (a.muted) { this.send(ws, { t: 'sys', text: 'Chat is paused on your account for now.' }); return; }
    a.ct = Math.min(CHAT_BURST, a.ct + (t - a.ctt) / CHAT_EVERY); a.ctt = t;
    if (a.ct < 1) { ws.serializeAttachment(a); this.send(ws, { t: 'sys', text: 'Slow down a little.' }); return; }
    a.ct -= 1;
    const c = cleanChat(m.text);
    if (c.blocked) { ws.serializeAttachment(a); if (c.reason) this.send(ws, { t: 'sys', text: c.reason }); if (c.flagged) await this.strike(ws, a, 1, 'chat-filter'); return; }
    if (c.text === a.last) { ws.serializeAttachment(a); return; } // repeats are dropped quietly
    a.last = c.text;
    ws.serializeAttachment(a);
    this.sql.exec('INSERT INTO chat (ts, aid, name, text) VALUES (?, ?, ?, ?)', t, a.aid, a.name, c.text);
    this.sql.exec('DELETE FROM chat WHERE id <= (SELECT MAX(id) - 200 FROM chat)');
    const msg = { t: 'c', id: a.aid, name: a.name, tag: a.tag, text: c.text, ts: t };
    this.send(ws, msg);
    this.broadcast(msg, ws, a.aid);
  }

  async webSocketClose(ws, code, reason) {
    const a = this.att(ws);
    try { ws.close(code >= 1000 && code < 5000 && code !== 1005 && code !== 1006 ? code : 1000, 'bye'); } catch { /* already closed */ }
    if (a) {
      if (a.x != null) this.sql.exec('INSERT OR REPLACE INTO lastpos (aid, x, y, z, ts) VALUES (?, ?, ?, ?, ?)', a.aid, a.x, a.y, a.z, Date.now());
      const still = this.ctx.getWebSockets(a.aid).some((s) => s !== ws);
      if (!still) { this.broadcast({ t: 'leave', id: a.aid }, ws); await this.presence(a.aid, null); }
    }
    this.count();
  }
  async webSocketError(ws) { return this.webSocketClose(ws, 1011, 'error'); }

  // ---- RPC from the Worker
  setBlock(aid, other, on) {
    if (on) this.sql.exec('INSERT OR IGNORE INTO blk (aid, other) VALUES (?, ?)', aid, other);
    else this.sql.exec('DELETE FROM blk WHERE aid = ? AND other = ?', aid, other);
    for (const ws of this.ctx.getWebSockets(aid)) this.send(ws, { t: on ? 'blocked' : 'unblocked', id: other });
    if (on) for (const ws of this.ctx.getWebSockets(other)) this.send(ws, { t: 'leave', id: aid });
    return true;
  }
  chatContext(target) {
    return this.sql.exec('SELECT ts, aid, name, text FROM chat ORDER BY id DESC LIMIT 30').toArray().reverse().map((r) => ({ ...r, target: r.aid === target }));
  }
  kick(aid, why = 'removed') { for (const ws of this.ctx.getWebSockets(aid)) ws.close(4004, why); return true; }
}
