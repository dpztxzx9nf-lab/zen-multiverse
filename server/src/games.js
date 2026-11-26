// Compete-together and co-op games inside one World Durable Object. The server decides everything:
// who is in, where stones and gates are, who picked up what, who finished when, who got shoved out.
// Clients only send intents ({t:'g', k:'grab', sid}) that are checked against the server's own
// validated positions (the same ones the movement anti-cheat holds), the round clock and cooldowns.
// Old clients (0.2.8 / 0.2.9) never send 't:g' and ignore 't:g' replies, so they keep working.
// One alarm per Durable Object drives every timer (countdowns, round ends, the standoff Easter egg).
import { surfaceDist } from './sphere.js';

export const MODES = ['race', 'hunt', 'cairn', 'ring'];
const SHOVE_MODES = new Set(['hunt', 'ring']);
const STONES = { quartz: 1, jasper: 2, agate: 3, obsidian: 5 };     // points by rarity (Mom's rock collecting)
const STONE_ODDS = [['quartz', 0.5], ['jasper', 0.28], ['agate', 0.16], ['obsidian', 0.06]];
const REACH = 2.2;           // metres: arm's reach plus a step, measured from the server's position
const CARRY = 3;             // fist-sized stones one person can carry by hand
const SHOVE_REACH = 1.9, SHOVE_CD = 1200, SHOVE_V = 5.0, SHOVE_UP = 1.4;
const RAID_CD = 1500;
const GATE_R = 3, GATE_MAX = 12, GATE_MIN = 4;
const RING_R = 4.5;
import { openGround } from './garden.js';
import { Places } from './places.js';
import { Builds } from './builds.js';
import { Fauna } from './fauna.js';
import { Opening } from './opening.js';
import { RELICS } from '../../js/places.js';
import { VAULT, vaultShapes, placeShapes, crossesSolid } from '../../js/solids.js';
const LOBBY_MS = 90e3, COUNT_MS = 3000;
const DUR = { race: 300e3, hunt: 120e3, cairn: 180e3, ring: 60e3 };
const STANDOFF_D = 1.6, STANDOFF_HOLD = 3000, STANDOFF_MAX = 30e3;
const GEODE_FIND = 1.3;
const KEEPER_TALK = 3, KEEPER_SHARE = 8;
const SEE_ITEMS = 25, SEE_VAULT = 14, VAULT_R = VAULT.R, PLATE_OFF = VAULT.plate.x, PLATE_R = VAULT.plate.r, LOCK_OFF = VAULT.lock.x; // shared with the client's mesh (js/solids.js)
const DIG_NEED = 30, DIG_EVERY = 350;
const ULA_SIGHT = 30, ULA_CONE = Math.cos(Math.PI / 3);
const RELIC_KINDS = ['amber', 'trilobite', 'meteorite', 'coin', 'blade'];
const NAMES = { ...RELICS, fish: 'fish from the cove', geode: 'geode', amber: 'amber with a trapped insect', trilobite: 'trilobite fossil', meteorite: 'lump of meteorite iron', coin: 'old silver coin', blade: 'obsidian blade' };
const RELIC_LORE = {
  amber: 'Ula: Amber is tree resin that hardened over millions of years. That insect walked into sticky sap before there were people.',
  trilobite: 'Ula: A trilobite. They crawled the sea floor for almost 300 million years, then vanished in the great dying. This hill was under an ocean once.',
  meteorite: 'Ula: Feel how heavy it is. Iron and nickel from the core of a broken little world, cooled so slowly in space that its crystals grew huge.',
  coin: 'Ula: Silver darkens because it reacts with sulfur in the air. Whoever sealed that vault traded with someone far away.',
  blade: 'Ula: An obsidian blade. Volcanic glass breaks to an edge a few atoms thin. Surgeons still use them.',
};
const ago = (ms) => ms < 90e3 ? 'just now' : ms < 3600e3 ? `${Math.round(ms / 60e3)} minutes ago` : `${Math.round(ms / 3600e3)} hours ago`;
const r2 = (v) => Math.round(v * 100) / 100;
const sid = () => crypto.randomUUID().replace(/-/g, '').slice(0, 8);
const pick = () => { let u = Math.random(); for (const [k, p] of STONE_ODDS) { if ((u -= p) <= 0) return k; } return 'quartz'; };
const AID_RE = /^[0-9a-f]{32}$/;

const KEEPER_LINES = {
  intro: 'Ula: Welcome, both of you. Somewhere within shouting distance a geode lies buried, a plain grey stone hiding crystals. Walk slowly and watch for a glint, then bring it to me.',
  waiting: 'Ula: Not yet? Walk slowly. A geode looks like any other stone until you are right over it.',
  clue: 'Ula: Look inside, under the crystals. Someone scratched lines there: a map. It shows the old vault, and the lock on its door is cut for a crystal just like this one. Keep it.',
  done: 'Ula: You found it! A geode starts as a gas bubble in cooling lava. Over thousands of years, water seeps in carrying dissolved silica, and crystals grow inward from the walls, layer by layer. That purple is quartz coloured by a trace of iron.',
  lore: [
    'Ula: Obsidian is lava that cooled so fast its atoms never lined up into crystals. That is why it breaks with edges sharper than steel.',
    'Ula: Jasper gets its red from iron oxide, the same rust that colours Mars.',
    'Ula: Agate grows in bands, each one a new layer of silica laid down by water, like rings in a tree.',
    'Ula: Quartz is the most common mineral on the continents. Squeeze a quartz crystal and it makes a tiny voltage, which is how watches keep time.',
  ],
};

export class Games {
  constructor(w) {
    this.w = w; this.sql = w.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS game (id INTEGER PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS course (i INTEGER PRIMARY KEY, x REAL, y REAL, z REAL, tile TEXT);
      CREATE TABLE IF NOT EXISTS board (aid TEXT PRIMARY KEY, name TEXT, wins INTEGER DEFAULT 0, games INTEGER DEFAULT 0, best_ms INTEGER, stones INTEGER DEFAULT 0, cairns INTEGER DEFAULT 0, eggs INTEGER DEFAULT 0, quests INTEGER DEFAULT 0);
      CREATE TABLE IF NOT EXISTS spot (k TEXT PRIMARY KEY, x REAL, z REAL, tile TEXT, ts INTEGER);
      CREATE TABLE IF NOT EXISTS quest (aid TEXT PRIMARY KEY, step INTEGER NOT NULL, lore INTEGER DEFAULT 0, ts INTEGER);
      CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY, k TEXT NOT NULL, x REAL, z REAL, tile TEXT, holder TEXT, by TEXT, ts INTEGER);
      CREATE TABLE IF NOT EXISTS vault (k TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS known (aid TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS seen (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, text TEXT, who TEXT);`);
    this.g = undefined;          // cached game (loaded lazily)
    this.so = null;              // standoff egg: { a, b, since, live, t0, pa, pb }
    this.soCd = new Map();       // pair -> cooldown until
    this.warm = new Map();       // aid -> last geode hint level
    this.isig = new Map();       // aid -> last items view sent
    this.seenV = new Set();      // who has seen the vault this session
    this.lastOpen = null; this.digT = new Map(); this.shoveCd = new Map();
    this.spd = new Map(); this.lastT = new Map(); this.noticed = new Set(); this.ulaYaw = 0;
    this.dev = w.env && w.env.LOCAL_DEV === '1'; // local wrangler dev only: short rounds + a test peek
    this.fa = new Fauna(w, this); // garden animals (server/src/fauna.js)
    this.bd = new Builds(w, this); // shared building (server/src/builds.js)
    this.pl = new Places(w, this); // points of interest: finds and shared digs (server/src/places.js)
    this.op = new Opening(w, this); // Ula's opening walk: gather, craft, fish, build, deliver (server/src/opening.js)
  }
  // dev runs use 8x shorter rounds; a starved headless screenshot page asks for slow ones ({k:'ch', slow:1}, dev only):
  // (stored on the game, so it survives the Durable Object sleeping between messages)
  dur(g) { return this.dev ? Math.round(DUR[g.mode] / (g.slow ? 2 : 8)) : DUR[g.mode]; }
  countMs(g) { return this.dev && g.slow ? 12e3 : COUNT_MS; }

  // ---- persistence
  get game() {
    if (this.g === undefined) { const r = this.sql.exec('SELECT data FROM game WHERE id = 1').toArray()[0]; this.g = r ? JSON.parse(r.data) : null; }
    return this.g;
  }
  save() {
    if (this.g) this.sql.exec('INSERT OR REPLACE INTO game (id, data) VALUES (1, ?)', JSON.stringify(this.g));
    else this.sql.exec('DELETE FROM game WHERE id = 1');
  }
  course() { return this.sql.exec('SELECT x, y, z, tile FROM course ORDER BY i').toArray().map((r) => ({ x: r.x, y: r.y, z: r.z, tile: r.tile || null })); }
  board() { return this.sql.exec('SELECT aid, name, wins, games, best_ms, stones, cairns, eggs, quests FROM board ORDER BY wins DESC, eggs DESC LIMIT 20').toArray(); }
  bump(aid, name, f) {
    this.sql.exec('INSERT OR IGNORE INTO board (aid, name) VALUES (?, ?)', aid, name);
    this.sql.exec('UPDATE board SET name = ? WHERE aid = ?', name, aid);
    for (const [k, v] of Object.entries(f)) {
      if (k === 'best_ms') this.sql.exec('UPDATE board SET best_ms = CASE WHEN best_ms IS NULL OR best_ms > ? THEN ? ELSE best_ms END WHERE aid = ?', v, v, aid);
      else this.sql.exec(`UPDATE board SET ${k} = ${k} + ? WHERE aid = ?`, v, aid);
    }
  }
  spot(k) { const r = this.sql.exec('SELECT x, z, tile FROM spot WHERE k = ?', k).toArray()[0]; return r ? { x: r.x, z: r.z, tile: r.tile || null } : null; }
  setSpot(k, p) { this.sql.exec('INSERT OR REPLACE INTO spot (k, x, z, tile, ts) VALUES (?, ?, ?, ?, ?)', k, p.x, p.z, p.tile || '', Date.now()); }
  questOf(aid) { return this.sql.exec('SELECT step, lore, ts FROM quest WHERE aid = ?', aid).toArray()[0] || { step: 0, lore: 0, ts: 0 }; }
  setQuest(aid, step, lore = 0) { this.sql.exec('INSERT OR REPLACE INTO quest (aid, step, lore, ts) VALUES (?, ?, ?, ?)', aid, step, lore, Date.now()); }

  // ---- what clients see
  view(t = Date.now()) {
    const g = this.game; if (!g) return null;
    return { mode: g.mode, phase: g.phase, host: g.host, invited: g.invited, players: g.players, anchor: g.anchor, stones: g.stones,
      caches: g.caches, cairn: g.cairn, ring: g.ring, gates: g.gates, tCount: g.tCount, t0: g.t0, tEnd: g.tEnd, result: g.result || null, now: t };
  }
  keeper() { const k = this.spot('keeper'); return k ? { name: 'Ula, the stone-keeper', ...k } : null; }
  hello(ws, a) {
    this.w.send(ws, { t: 'g', k: 'hello', modes: MODES, game: this.view(), course: this.course(), board: this.board(), keeper: this.keeper(), quest: this.questOf(a.aid).step, open: this.op.wire(a.aid), ula: { yaw: r2(this.ulaYaw) } });
    this.isig.delete(a.aid); this.seenV.delete(a.aid);
    if (a.x != null) this.sendItems(ws, a, true);
    this.sendVault(ws, a);
    this.pl.hello(ws, a);
    this.bd.hello(ws, a);
    this.fa.hello(ws, a);
    // the first minute: say plainly what there is to do here, and tell whoever is already here
    const now = Date.now(), last = (this.greeted ||= new Map()).get(a.aid) || 0; this.greeted.set(a.aid, now);
    if (now - last < 120e3) return; // a reconnect, not an arrival
    const step = this.questOf(a.aid).step;
    if (step < 3) this.sys(ws, step === 0
      ? 'Things to do right now: walk up to Ula the stone-keeper and press E. She has a job for you: a hidden geode, and what it opens. Compete & co-op (top right) has races, stone hunts, sparring and a co-op cairn.'
      : 'Ula is still waiting for the geode. Walk slowly and watch for a glint. Compete & co-op (top right) has races, hunts, sparring and the cairn.');
    for (const o of this.present()) if (o.aid !== a.aid) { const s = this.sock(o.aid); if (s) this.sys(s, `${a.name} is here. Challenge them or team up from Compete & co-op, or go find Ula together.`); }
  }
  push(t = Date.now()) { this.w.broadcast({ t: 'g', k: 'state', game: this.view(t) }); }
  sys(ws, text) { this.w.send(ws, { t: 'g', k: 'say', text }); }
  sock(aid) { return this.w.ctx.getWebSockets(aid)[0] || null; }
  att(aid) { const s = this.sock(aid); return s ? this.w.att(s) : null; }
  present() { return this.w.ctx.getWebSockets().map((s) => this.w.att(s)).filter((o) => o && o.aid); }
  R(a) { return this.w.rulesOf(a).sphereR; }
  dist(a, p) { return a && a.x != null && p ? surfaceDist(a, p, this.R(a)) : Infinity; }

  // ---- timers: one DO alarm for everything
  async schedule() {
    const g = this.game, cand = [];
    if (g) {
      if (g.phase === 'lobby') cand.push(g.tLobby);
      if (g.phase === 'count') cand.push(g.tCount);
      if (g.phase === 'live') cand.push(g.tEnd);
      if (g.phase === 'wait') cand.push(g.tWait);
      if (g.phase === 'done') cand.push(g.tDone);
    }
    if (this.so) cand.push(this.so.live ? this.so.t0 + STANDOFF_MAX : this.so.since + STANDOFF_HOLD);
    const next = cand.filter((v) => Number.isFinite(v)).sort((a, b) => a - b)[0];
    if (next) await this.w.ctx.storage.setAlarm(Math.max(Date.now() + 50, next));
  }
  async alarm() {
    const t = Date.now();
    this.tick(t);
    this.standoffTick(t);
    await this.schedule();
  }
  tick(t) {
    const g = this.game; if (!g) return;
    let changed = false;
    if (g.phase === 'lobby' && t >= g.tLobby) { this.g = null; this.save(); this.w.broadcast({ t: 'g', k: 'state', game: null }); return; }
    if (g.phase === 'count' && t >= g.tCount) { g.phase = 'live'; g.t0 = g.tCount; g.tEnd = g.t0 + this.dur(g); changed = true; }
    if (g.phase === 'wait' && t >= g.tWait) { this.finish(g, t, 'Nobody came back to the ring.'); return; }
    if (g.phase === 'live' && t >= g.tEnd) { this.finish(g, t, null); return; }
    if (g.phase === 'done' && t >= g.tDone) { this.g = null; this.save(); this.w.broadcast({ t: 'g', k: 'state', game: null }); return; }
    if (changed) { this.save(); this.push(t); }
  }

  // ---- messages
  async msg(ws, a, m, t) {
    const k = m.k;
    if (typeof k !== 'string') return this.w.strike(ws, a, 1, 'g-shape');
    if (JSON.stringify(m).length > 300) return this.w.strike(ws, a, 1, 'g-size');
    this.tick(t);
    switch (k) {
      case 'ch': return this.challenge(ws, a, m, t);
      case 'ac': return this.accept(ws, a, m.yes !== false, t);
      case 'go': return this.start(ws, a, t);
      case 'quit': return this.quit(ws, a, t);
      case 'gate': return this.gate(ws, a, t);
      case 'clr': return this.clearCourse(ws, a);
      case 'grab': return this.grab(ws, a, m, t);
      case 'bank': return this.bank(ws, a, t);
      case 'raid': return this.raid(ws, a, m, t);
      case 'give': return this.give(ws, a, m, t);
      case 'shove': return this.shove(ws, a, m, t);
      case 'v': a.gv = 1; ws.serializeAttachment(a); return; // this client draws games, the vault and items
      case 'talk': return this.talk(ws, a, t);
      case 'take': return this.take(ws, a, m, t);
      case 'drop': return this.drop(ws, a, m, t);
      case 'hand': return this.hand(ws, a, m, t);
      case 'unlock': return this.unlock(ws, a, t);
      case 'dig': return this.dig(ws, a, t);
      case 'pdig': return this.pl.pdig(ws, a, m, t);
      case 'ntake': return this.pl.ntake(ws, a, m, t);
      case 'catch': return this.pl.catch(ws, a, t);
      case 'made': return this.op.made(ws, a, m, t);
      case 'bplace': return this.bd.place(ws, a, m, t);
      case 'bremove': return this.bd.remove(ws, a, m, t);
      case 'fhit': case 'ffeed': case 'fbrush': return this.fa.act(ws, a, m, t);
      case 'stow': return this.stow(ws, a, m);
      case 'board': this.w.send(ws, { t: 'g', k: 'board', board: this.board() }); return;
      case 'dbg': if (!this.dev) return; this.w.send(ws, { t: 'g', k: 'dbg', geode: this.spot('geode'), keeper: this.spot('keeper'), vault: this.vault() }); return;
      default: return this.w.strike(ws, a, 1, 'g-kind');
    }
  }

  challenge(ws, a, m, t) {
    const g = this.game;
    if (g && g.phase !== 'done') return this.sys(ws, g.phase === 'lobby' ? 'A challenge is already open. Accept it or wait a moment.' : 'A game is already running here.');
    if (!MODES.includes(m.mode)) return this.w.strike(ws, a, 1, 'g-mode');
    if (a.x == null) return this.sys(ws, 'Take a step first so the world knows where you are.');
    const to = typeof m.to === 'string' && AID_RE.test(m.to) ? m.to : null;
    const others = this.present().filter((o) => o.aid !== a.aid && !this.w.blocked(a.aid, o.aid));
    if (to && !others.some((o) => o.aid === to)) return this.sys(ws, 'They are not in this world right now.');
    if (m.mode === 'race') {
      const c = this.course();
      if (c.length < 2) return this.sys(ws, 'Lay at least 2 gates first: walk the course and press Add gate at each one.');
    }
    if (m.mode === 'ring' && !others.length) return this.sys(ws, 'Sparring needs someone else here.');
    this.g = { id: sid(), mode: m.mode, host: a.aid, phase: 'lobby', invited: to ? [to] : others.map((o) => o.aid),
      players: { [a.aid]: this.player(a) }, anchor: { x: r2(a.x), y: r2(a.y), z: r2(a.z), tile: a.tile || null }, tLobby: t + LOBBY_MS, ...(this.dev && m.slow ? { slow: true } : {}) };
    this.save(); this.push(t);
    const who = to ? others.find((o) => o.aid === to).name : 'everyone here';
    for (const o of others) if (this.g.invited.includes(o.aid)) { const s = this.sock(o.aid); if (s) this.w.send(s, { t: 'g', k: 'invite', from: a.name, mode: m.mode }); }
    this.sys(ws, `Challenge sent to ${who}.`);
    return this.schedule();
  }
  player(a) { return { name: a.name, score: 0, carry: [], gi: 0, fin: null, out: false, wins: 0, scd: 0, rcd: 0 }; }
  accept(ws, a, yes, t) {
    const g = this.game;
    if (!g || g.phase !== 'lobby' || !g.invited.includes(a.aid)) return this.sys(ws, 'That challenge has closed.');
    if (!yes) { g.invited = g.invited.filter((x) => x !== a.aid); this.save(); this.push(t); return; }
    g.players[a.aid] = this.player(a);
    this.save();
    if (g.invited.every((x) => g.players[x])) return this.begin(g, t);
    this.push(t);
  }
  start(ws, a, t) {
    const g = this.game;
    if (!g || g.phase !== 'lobby') return;
    if (g.host !== a.aid) return this.sys(ws, 'Only the challenger can start early.');
    const n = Object.keys(g.players).length;
    if (n < 2 && (g.mode === 'ring')) return this.sys(ws, 'Wait for someone to accept.');
    return this.begin(g, t);
  }
  quit(ws, a, t) {
    const g = this.game; if (!g || !g.players[a.aid]) return;
    if (g.phase === 'lobby' && g.host === a.aid) { this.g = null; this.save(); this.w.broadcast({ t: 'g', k: 'state', game: null }); return; }
    const p = g.players[a.aid];
    for (const k of p.carry) this.dropStone(g, k, a, 0, 0);
    delete g.players[a.aid];
    const left = Object.keys(g.players).length;
    if (!left || (g.mode === 'ring' && left < 2 && g.phase !== 'lobby')) return this.finish(g, t, `${a.name} left the game.`);
    this.save(); this.push(t);
  }
  leave(a) { // socket closed
    const g = this.game; if (!g || !g.players[a.aid]) return;
    this.quit(null, a, Date.now());
  }

  begin(g, t) {
    const ids = Object.keys(g.players), np = ids.length, A = g.anchor;
    const ring = (n, r0, r1) => Array.from({ length: n }, () => {
      let s;
      for (let i = 0; i < 20; i++) { const ang = Math.random() * Math.PI * 2, r = Math.sqrt(r0 * r0 + Math.random() * (r1 * r1 - r0 * r0)); s = { id: sid(), k: pick(), x: r2(A.x + Math.cos(ang) * r), z: r2(A.z + Math.sin(ang) * r), tile: A.tile }; if (this.clearOfVault(s) && openGround(s, 0.3)) break; }
      return s;
    });
    if (g.mode === 'hunt') {
      g.stones = ring(8 + 6 * np, 5, 26);
      g.caches = {};
      ids.forEach((id, i) => { const ang = (i / np) * Math.PI * 2; g.caches[id] = { x: r2(A.x + Math.cos(ang) * 3.5), z: r2(A.z + Math.sin(ang) * 3.5), tile: A.tile, n: [] }; });
    }
    if (g.mode === 'cairn') {
      const goal = this.dev ? 2 + np : 4 + 4 * np;
      g.stones = ring(goal + 6, 5, 24);
      g.cairn = { x: A.x, z: A.z, tile: A.tile, n: 0, goal };
    }
    if (g.mode === 'ring') g.ring = { x: A.x, z: A.z, tile: A.tile, r: RING_R, round: 1 };
    if (g.mode === 'race') { g.gates = this.course(); g.anchor = { ...g.gates[0] }; }
    g.invited = ids;
    if (g.mode === 'ring') { g.phase = 'wait'; g.tWait = t + 45e3; }
    else { g.phase = 'count'; g.tCount = t + this.countMs(g); }
    this.save(); this.push(t);
    if (g.mode === 'ring') this.ringCheck(g, t);
    return this.schedule();
  }

  finish(g, t, why) {
    const ids = Object.keys(g.players);
    let res = { why: why || null, rows: [] };
    if (g.mode === 'race') {
      const rows = ids.map((id) => ({ id, name: g.players[id].name, ms: g.players[id].fin, gates: g.players[id].gi })).sort((x, y) => (x.ms ?? 1e12) - (y.ms ?? 1e12) || y.gates - x.gates);
      res.rows = rows; res.winner = rows[0] && rows[0].ms != null ? rows[0].id : null;
      for (const r of rows) this.bump(r.id, r.name, { games: 1, ...(r.ms != null ? { best_ms: r.ms } : {}), ...(r.id === res.winner && ids.length > 1 ? { wins: 1 } : {}) });
    } else if (g.mode === 'hunt') {
      const rows = ids.map((id) => ({ id, name: g.players[id].name, score: g.players[id].score, stones: (g.caches[id]?.n || []).length })).sort((x, y) => y.score - x.score);
      res.rows = rows; res.winner = rows[0] && rows[0].score > 0 && (!rows[1] || rows[0].score > rows[1].score) ? rows[0].id : null;
      for (const r of rows) this.bump(r.id, r.name, { games: 1, stones: r.stones, ...(r.id === res.winner && ids.length > 1 ? { wins: 1 } : {}) });
    } else if (g.mode === 'cairn') {
      const ok = g.cairn.n >= g.cairn.goal;
      res.team = ok; res.cairn = g.cairn.n; res.goal = g.cairn.goal;
      res.rows = ids.map((id) => ({ id, name: g.players[id].name, score: g.players[id].score })).sort((x, y) => y.score - x.score);
      for (const r of res.rows) this.bump(r.id, r.name, { games: 1, stones: r.score, ...(ok ? { cairns: 1 } : {}) });
    } else if (g.mode === 'ring') {
      const rows = ids.map((id) => ({ id, name: g.players[id].name, wins: g.players[id].wins })).sort((x, y) => y.wins - x.wins);
      res.rows = rows; res.winner = rows[0] && (!rows[1] || rows[0].wins > rows[1].wins) ? rows[0].id : null;
      for (const r of rows) this.bump(r.id, r.name, { games: 1, ...(r.id === res.winner && ids.length > 1 ? { wins: 1 } : {}) });
    }
    g.phase = 'done'; g.result = res; g.tDone = t + (this.dev && g.slow ? 60e3 : 20e3); g.stones = []; 
    this.save(); this.push(t);
    this.w.broadcast({ t: 'g', k: 'board', board: this.board() });
    this.schedule();
  }

  // ---- race course: gates laid where you actually stand
  gate(ws, a, t) {
    const g = this.game;
    if (g && g.mode === 'race' && ['count', 'live'].includes(g.phase)) return this.sys(ws, 'Wait for the race to end.');
    if (a.x == null) return this.sys(ws, 'Take a step first.');
    const c = this.course();
    if (c.length >= GATE_MAX) return this.sys(ws, `A course can have ${GATE_MAX} gates.`);
    const here = { x: a.x, z: a.z, tile: a.tile || null };
    if (c.length && c[0].tile !== here.tile && (c[0].tile || here.tile)) return this.sys(ws, 'Gates must all be in this area. Clear the course to start over here.');
    if (c.length && this.dist(a, c[c.length - 1]) < GATE_MIN) return this.sys(ws, `Walk at least ${GATE_MIN} m from the last gate.`);
    this.sql.exec('INSERT INTO course (i, x, y, z, tile) VALUES (?, ?, ?, ?, ?)', c.length, r2(a.x), r2(a.y), r2(a.z), here.tile || '');
    this.w.broadcast({ t: 'g', k: 'course', gates: this.course(), by: a.name });
  }
  clearCourse(ws, a) {
    const g = this.game;
    if (g && g.mode === 'race' && ['count', 'live'].includes(g.phase)) return this.sys(ws, 'Wait for the race to end.');
    this.sql.exec('DELETE FROM course');
    this.w.broadcast({ t: 'g', k: 'course', gates: [], by: a.name });
  }

  // ---- stones: grab, bank, raid, hand over
  live(ws, a, modes) {
    const g = this.game;
    if (!g || g.phase !== 'live' || !modes.includes(g.mode) || !g.players[a.aid]) { if (ws) this.sys(ws, 'Not in a round right now.'); return null; }
    return g;
  }
  grab(ws, a, m, t) {
    const g = this.live(ws, a, ['hunt', 'cairn']); if (!g) return;
    const p = g.players[a.aid];
    if (p.carry.length >= CARRY) return this.sys(ws, `Your hands are full (${CARRY} stones). Bank them first.`);
    const s = g.stones.find((x) => x.id === m.sid);
    if (!s) return; // someone else got there first
    if (this.dist(a, s) > REACH) return this.w.strike(ws, a, 1, 'grab-reach');
    g.stones = g.stones.filter((x) => x !== s);
    p.carry.push(s.k);
    this.save(); this.push(t);
  }
  bank(ws, a, t) {
    const g = this.live(ws, a, ['hunt', 'cairn']); if (!g) return;
    const p = g.players[a.aid];
    if (!p.carry.length) return;
    if (g.mode === 'hunt') {
      const c = g.caches[a.aid];
      if (this.dist(a, c) > REACH + 0.5) return this.sys(ws, 'Walk to your own cache to bank.');
      for (const k of p.carry) { c.n.push(k); p.score += STONES[k]; }
      p.carry = [];
    } else {
      if (this.dist(a, g.cairn) > REACH + 0.5) return this.sys(ws, 'Walk to the cairn to add your stones.');
      g.cairn.n += p.carry.length; p.score += p.carry.length; p.carry = [];
      if (g.cairn.n >= g.cairn.goal) { this.save(); return this.finish(g, t, null); }
    }
    this.save(); this.push(t);
  }
  raid(ws, a, m, t) {
    const g = this.live(ws, a, ['hunt']); if (!g) return;
    const p = g.players[a.aid];
    if (t < p.rcd) return;
    if (p.carry.length >= CARRY) return this.sys(ws, 'Your hands are full.');
    const owner = Object.keys(g.caches).find((id) => id !== a.aid && g.caches[id].n.length && this.dist(a, g.caches[id]) <= REACH + 0.5);
    if (!owner) return this.sys(ws, 'Stand at someone else\'s cache to take a stone.');
    const c = g.caches[owner], k = c.n.pop();
    g.players[owner].score -= STONES[k];
    p.carry.push(k); p.rcd = t + RAID_CD;
    const s = this.sock(owner); if (s) this.w.send(s, { t: 'g', k: 'say', text: `${a.name} is raiding your cache!` });
    this.save(); this.push(t);
  }
  give(ws, a, m, t) {
    const g = this.live(ws, a, ['hunt', 'cairn']); if (!g) return;
    const p = g.players[a.aid];
    const to = typeof m.to === 'string' && g.players[m.to] && m.to !== a.aid ? m.to : null;
    if (!to || !p.carry.length) return;
    const o = this.att(to), q = g.players[to];
    if (!o || this.dist(a, o) > REACH + 0.3) return this.sys(ws, 'Get closer to hand it over.');
    if (q.carry.length >= CARRY) return this.sys(ws, 'Their hands are full.');
    q.carry.push(p.carry.pop());
    this.save(); this.push(t);
  }
  dropStone(g, k, at, dx, dz) {
    if (!g.stones) g.stones = [];
    g.stones.push({ id: sid(), k, x: r2(at.x + dx * 1.3), z: r2(at.z + dz * 1.3), tile: at.tile || null });
  }

  // ---- sparring: a shove the server checks (reach, cooldown, rewound target), then pushes the target
  shove(ws, a, m, t) {
    // in a round: only sparring modes, only other players in it. Outside a round: anyone not in a round
    // (a plain push; if they carry something, it can fall).
    const g0 = this.game, inGame = !!(g0 && g0.phase !== 'done' && g0.players[a.aid]);
    if (inGame && (g0.phase !== 'live' || !SHOVE_MODES.has(g0.mode))) return;
    const g = inGame ? g0 : null;
    if (a.x == null || t < (this.shoveCd.get(a.aid) || 0)) return;
    this.shoveCd.set(a.aid, t + SHOVE_CD);
    const ago = typeof m.ago === 'number' && Number.isFinite(m.ago) ? Math.max(0, Math.min(300, m.ago)) : 0;
    const when = t - ago;
    const me = this.w.rewind(a.aid, when, a);
    let best = null, bd = SHOVE_REACH;
    const pool = g ? Object.keys(g.players).filter((id) => !g.players[id].out) : this.present().map((o) => o.aid).filter((id) => !(g0 && g0.phase !== 'done' && g0.players[id]) && !this.w.blocked(a.aid, id));
    for (const id of pool) {
      if (id === a.aid) continue;
      const o = this.att(id); if (!o || o.x == null || (o.tile || null) !== (a.tile || null)) continue;
      const q = this.w.rewind(id, when, o);
      const d = Math.hypot(q.x - me.x, q.z - me.z);
      if (d <= bd && Math.abs(q.y - me.y) < 1.3) { bd = d; best = { id, q }; }
    }
    this.w.broadcast({ t: 'g', k: 'fx', e: 'shove', by: a.aid, hit: best ? best.id : null });
    if (!best) return;
    const o = this.att(best.id), q = g ? g.players[best.id] : { carry: [] };
    const things = this.held(best.id);
    let dx = o.x - me.x, dz = o.z - me.z; const l = Math.hypot(dx, dz);
    if (l < 1e-3) { dx = 1; dz = 0; } else { dx /= l; dz /= l; }
    const v = SHOVE_V / (1 + 0.12 * (q.carry.length + things.length)); // a loaded player is heavier to move
    // let the movement check accept the push: a short extra budget on the target
    for (const s of this.w.ctx.getWebSockets(best.id)) { const at = this.w.att(s); if (at) { at.kbU = t + 1500; at.budget = (at.budget || 0) + 3; s.serializeAttachment(at); } }
    const s = this.sock(best.id);
    if (s) this.w.send(s, { t: 'g', k: 'kb', by: a.aid, dx: r2(dx), dz: r2(dz), v: r2(v), up: SHOVE_UP });
    this.witness(t, [a, o], `${a.name} shoved ${o.name}`, [a.aid, best.id]);
    if (g && g.mode === 'hunt' && q.carry.length) { const k = q.carry.pop(); this.dropStone(g, k, o, dx, dz); }
    else if (!g && things.length) { // the last thing picked up is the loosest in the hands
      const it = things[things.length - 1];
      this.sql.exec('UPDATE items SET holder = NULL, by = ?, x = ?, z = ?, tile = ?, ts = ? WHERE id = ?', best.id, r2(o.x + dx * 1.2), r2(o.z + dz * 1.2), o.tile || '', t, it.id);
      this.witness(t, [a, o], `${o.name} dropped the ${NAMES[it.k]} when ${a.name} shoved them`, [a.aid, best.id]);
      this.pushItems();
    }
    if (g) { this.save(); this.push(t); }
  }

  // ---- called by World.pose() after a move was accepted (prev = position before it)
  onPose(ws, a, prev, t) {
    this.firstSpots(a);
    this.pl.onPose(ws, a);
    this.fa.onPose(ws, a, t);
    this.geode(ws, a, t);
    this.ulaPose(a, prev, t);
    this.vaultPose(ws, a, t);
    this.sendItems(ws, a, false);
    this.standoffPose(a, prev, t);
    const g = this.game; if (!g || !g.players[a.aid]) return;
    this.tick(t);
    const p = g.players[a.aid];
    if (g.mode === 'race' && g.phase === 'live' && p.fin == null) {
      const gate = g.gates[p.gi];
      if (gate && (gate.tile || null) === (a.tile || null) && segDist(prev || a, a, gate) <= GATE_R) {
        p.gi += 1;
        if (p.gi >= g.gates.length) {
          p.fin = t - g.t0;
          this.w.broadcast({ t: 'g', k: 'say', text: `${a.name} finished in ${(p.fin / 1000).toFixed(2)} s` });
          const all = Object.values(g.players).every((x) => x.fin != null);
          if (all) { this.save(); return this.finish(g, t, null); }
          g.tEnd = Math.min(g.tEnd, t + 45e3); this.schedule();
        }
        this.save(); this.push(t);
      }
    }
    if (g.mode === 'ring' && (g.phase === 'wait' || g.phase === 'live' || g.phase === 'count')) this.ringCheck(g, t);
  }
  ringCheck(g, t) {
    const ids = Object.keys(g.players), R = g.ring.r;
    const pos = Object.fromEntries(ids.map((id) => [id, this.att(id)]));
    const d = (id) => this.dist(pos[id], g.ring);
    if (g.phase === 'wait') {
      if (ids.every((id) => d(id) <= R * 0.8)) { g.phase = 'count'; g.tCount = t + this.countMs(g); for (const id of ids) g.players[id].out = false; this.save(); this.push(t); this.schedule(); }
      return;
    }
    if (g.phase === 'count') return;
    let changed = false;
    for (const id of ids) if (!g.players[id].out && d(id) > R) { g.players[id].out = true; changed = true; this.w.broadcast({ t: 'g', k: 'say', text: `${g.players[id].name} is out of the ring` }); }
    if (!changed) return;
    const inn = ids.filter((id) => !g.players[id].out);
    if (inn.length <= 1) {
      if (inn[0]) g.players[inn[0]].wins += 1;
      const top = Math.max(...ids.map((id) => g.players[id].wins));
      if (top >= 2 || g.ring.round >= 3) { this.save(); return this.finish(g, t, null); }
      g.ring.round += 1; g.phase = 'wait'; g.tWait = t + 45e3;
      this.w.broadcast({ t: 'g', k: 'say', text: `Round ${g.ring.round}: everyone back inside the ring` });
      this.schedule();
    }
    this.save(); this.push(t);
  }

  // ---- the stone-keeper (one NPC with one side quest) and the hidden geode, placed where people really walk
  firstSpots(a) {
    if (a.x == null || this._k) return;
    this._k = true;
    if (!this.spot('keeper')) {
      // Ula stands near the first arrival, on open ground (not in the pond or on the raked sand)
      let k = { x: r2(a.x + 2.5), z: r2(a.z + 1.5), tile: a.tile || null };
      for (let i = 0; i < 24 && !openGround(k, 0.6); i++) { const ang = i * 2.4, r = 2.5 + i * 0.5; k = { x: r2(a.x + Math.cos(ang) * r), z: r2(a.z + Math.sin(ang) * r), tile: a.tile || null }; }
      this.setSpot('keeper', k); this.w.broadcast({ t: 'g', k: 'keeper', keeper: this.keeper() }); }
    if (!this.vault()) this.newVault(this.spot('keeper'));
    if (!this.spot('geode')) this.moveGeode(a);
  }
  clearOfVault(p) { const v = this.vault(); return !v || (v.tile || null) !== (p.tile || null) || Math.hypot(p.x - v.x, p.z - v.z) > VAULT_R + 1.5; }
  moveGeode(from) {
    let p;
    for (let i = 0; i < 20; i++) { const ang = Math.random() * Math.PI * 2, r = 12 + Math.random() * 22; p = { x: r2(from.x + Math.cos(ang) * r), z: r2(from.z + Math.sin(ang) * r), tile: from.tile || null }; if (this.clearOfVault(p) && openGround(p, 0.4)) break; }
    this.setSpot('geode', p);
    this.warm.clear();
  }
  geode(ws, a, t) {
    const gp = this.spot('geode'); if (!gp || (gp.tile || null) !== (a.tile || null)) return;
    const d = this.dist(a, gp);
    const lvl = d <= GEODE_FIND ? 3 : d < 4 ? 2 : d < 9 ? 1 : 0;
    const was = this.warm.get(a.aid) || 0;
    if (lvl === was) return;
    this.warm.set(a.aid, lvl);
    if (lvl === 3) {
      this.bump(a.aid, a.name, { eggs: 1 });
      // the geode is a real object now: in your hands, or at your feet if your hands are full
      const full = this.held(a.aid).length >= CARRY;
      this.addItem('geode', { x: gp.x, z: gp.z, tile: gp.tile }, full ? null : a.aid, a.aid);
      this.w.broadcast({ t: 'g', k: 'egg', e: 'geode', id: a.aid, name: a.name, x: gp.x, z: gp.z, tile: gp.tile, full });
      this.moveGeode(a);
      this.pushItems();
      this.w.broadcast({ t: 'g', k: 'board', board: this.board() });
    } else if (lvl > was) this.w.send(ws, { t: 'g', k: 'warm', lvl });
  }

  // ---- real objects: relics and the geode. Anyone can pick up, carry (3 in two hands), drop, hide or hand over.
  // Carried items stay with the carrier across sessions. Ground items are only shown to people near enough to see them.
  // a fish in your hands goes into your bag (to cook, salt or cut for bait): the object is gone from the world
  stow(ws, a, m) {
    const it = this.held(a.aid).find((i) => i.id === m.id && i.k === 'fish'); if (!it) return;
    this.sql.exec('DELETE FROM items WHERE id = ?', it.id);
    this.w.send(ws, { t: 'g', k: 'grant', why: 'node', give: { fish: 1 }, text: 'Into the bag.' });
    this.pushItems();
  }
  held(aid) { return this.sql.exec('SELECT id, k FROM items WHERE holder = ?', aid).toArray(); }
  item(id) { return this.sql.exec('SELECT id, k, x, z, tile, holder, by FROM items WHERE id = ?', id).toArray()[0] || null; }
  addItem(k, p, holder, by) { const id = sid(); this.sql.exec('INSERT INTO items (id, k, x, z, tile, holder, by, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', id, k, r2(p.x), r2(p.z), p.tile || '', holder, by || null, Date.now()); return id; }
  itemsFor(a) {
    const out = { ground: [], carried: {} };
    for (const r of this.sql.exec('SELECT id, k, x, z, tile, holder FROM items').toArray()) {
      if (r.holder) { if (this.present().some((o) => o.aid === r.holder)) (out.carried[r.holder] || (out.carried[r.holder] = [])).push({ id: r.id, k: r.k }); continue; }
      const p = { x: r.x, z: r.z, tile: r.tile || null };
      if ((p.tile || null) === (a.tile || null) && this.dist(a, p) <= SEE_ITEMS) out.ground.push({ id: r.id, k: r.k, x: r.x, z: r.z, tile: p.tile });
    }
    return out;
  }
  sendItems(ws, a, force) {
    const v = this.itemsFor(a), sig = JSON.stringify(v);
    if (!force && this.isig.get(a.aid) === sig) return;
    this.isig.set(a.aid, sig);
    this.w.send(ws, { t: 'g', k: 'items', ...v });
  }
  pushItems() { for (const s of this.w.ctx.getWebSockets()) { const o = this.w.att(s); if (o && o.x != null) this.sendItems(s, o, false); } }
  take(ws, a, m, t) {
    const it = typeof m.iid === 'string' ? this.item(m.iid) : null;
    if (!it || it.holder) return;
    if (this.held(a.aid).length >= CARRY) return this.sys(ws, 'Your hands are full. Drop something first.');
    if (this.dist(a, { x: it.x, z: it.z, tile: it.tile || null }) > REACH) return this.w.strike(ws, a, 1, 'take-reach');
    this.sql.exec('UPDATE items SET holder = ?, ts = ? WHERE id = ?', a.aid, t, it.id);
    if (it.by && it.by !== a.aid) { const o = this.att(it.by); if (o) this.witness(t, [a, o], `${a.name} picked up the ${NAMES[it.k]} that ${o.name} put down`, [a.aid, it.by]); }
    this.pushItems();
  }
  drop(ws, a, m, t) {
    const mine = this.held(a.aid); if (!mine.length) return;
    const it = mine.find((x) => x.id === m.iid) || mine[mine.length - 1];
    if (a.x == null) return;
    this.sql.exec('UPDATE items SET holder = NULL, by = ?, x = ?, z = ?, tile = ?, ts = ? WHERE id = ?', a.aid, r2(a.x), r2(a.z), a.tile || '', t, it.id);
    this.pushItems();
  }
  hand(ws, a, m, t) {
    const to = typeof m.to === 'string' && AID_RE.test(m.to) ? m.to : null;
    const mine = this.held(a.aid); if (!to || !mine.length) return;
    const it = mine.find((x) => x.id === m.iid) || mine[mine.length - 1];
    const o = this.att(to);
    if (!o || this.dist(a, o) > REACH + 0.3) return this.sys(ws, 'Get closer to hand it over.');
    if (this.held(to).length >= CARRY) return this.sys(ws, 'Their hands are full.');
    this.sql.exec('UPDATE items SET holder = ?, by = ?, ts = ? WHERE id = ?', to, a.aid, t, it.id);
    this.witness(t, [a, o], `${a.name} handed the ${NAMES[it.k]} to ${o.name}`, [a.aid, to]);
    this.pushItems();
  }

  // ---- the hidden vault: an old stone chamber with a slab door on a counterweight.
  // The crystal from a geode fits its lock (used once). After that the slab stays up only while someone
  // stands on the plate outside. Step off and anyone inside is shut in until they dig through the back wall.
  vault() { const r = this.sql.exec("SELECT data FROM vault WHERE k = 'v'").toArray()[0]; return r ? JSON.parse(r.data) : null; }
  saveVault(v) { this.sql.exec("INSERT OR REPLACE INTO vault (k, data) VALUES ('v', ?)", JSON.stringify(v)); this._v = v; }
  newVault(from) {
    if (!from) return;
    let x, z; // the vault, its pressure plate and its lock all on solid open ground
    for (let i = 0; i < 40; i++) {
      const ang = Math.random() * Math.PI * 2, r = 26 + Math.random() * 14;
      x = r2(from.x + Math.cos(ang) * r); z = r2(from.z + Math.sin(ang) * r);
      const t = from.tile || null;
      if (openGround({ x, z, tile: t }, VAULT_R + 0.5) && openGround({ x: x + PLATE_OFF, z, tile: t }, PLATE_R) && openGround({ x: x + LOCK_OFF, z: z + VAULT.lock.z, tile: t }, 0.5)) break;
    }
    const v = { x, z, tile: from.tile || null, locked: true, tunnel: false, dig: 0, ts: Date.now() };
    this.saveVault(v);
    this.sql.exec('DELETE FROM known');
  }
  parts(v) { return { plate: { x: v.x + PLATE_OFF, z: v.z, tile: v.tile }, lock: { x: v.x + LOCK_OFF, z: v.z + VAULT.lock.z, tile: v.tile } }; }
  doorOpen(v, except) {
    if (!v || v.locked) return false;
    const { plate } = this.parts(v);
    return this.present().some((o) => o.aid !== except && o.x != null && (o.tile || null) === (v.tile || null) && this.dist(o, plate) <= PLATE_R);
  }
  knows(aid) { return this.sql.exec('SELECT 1 FROM known WHERE aid = ?', aid).toArray().length > 0; }
  learn(aid) { this.sql.exec('INSERT OR IGNORE INTO known (aid) VALUES (?)', aid); }
  vaultView(v) { const { plate, lock } = this.parts(v); return { x: v.x, z: v.z, tile: v.tile, r: VAULT_R, locked: v.locked, tunnel: v.tunnel, dig: v.dig, digNeed: DIG_NEED, open: this.doorOpen(v), plate, lock }; }
  sendVault(ws, a) { const v = this.vault(); if (v && (this.knows(a.aid) || this.dist(a, v) <= SEE_VAULT)) this.w.send(ws, { t: 'g', k: 'vault', vault: this.vaultView(v) }); }
  pushVault() { for (const s of this.w.ctx.getWebSockets()) { const o = this.w.att(s); if (o) this.sendVault(s, o); } }
  // World.pose asks before accepting a move: the step may not pass into the vault's walls, its shut slab or its lock.
  // These are the very shapes the client draws and collides with (js/solids.js vaultShapes), never a private circle.
  blocks(a, next) {
    const v = this._v !== undefined ? this._v : (this._v = this.vault());
    if (!a.gv || !v || a.x == null || (v.tile || null) !== (next.tile || null) || (a.tile || null) !== (next.tile || null)) return false;
    const far = VAULT.lock.x + 2; if (Math.hypot(a.x - v.x, a.z - v.z) > far && Math.hypot(next.x - v.x, next.z - v.z) > far) return false;
    const shapes = placeShapes(vaultShapes({ tunnel: !!v.tunnel, slabShut: !this.doorOpen(v, a.aid) }), v.x, v.z, 0);
    return crossesSolid(shapes, a, next);
  }
  vaultPose(ws, a, t) {
    const v = this.vault(); if (!v || (v.tile || null) !== (a.tile || null)) return;
    const d = this.dist(a, v);
    if (d <= SEE_VAULT && !this.seenV.has(a.aid)) { this.seenV.add(a.aid); this.sendVault(ws, a); }
    const open = this.doorOpen(v);
    if (open !== this.lastOpen) { this.lastOpen = open; this.pushVault(); }
    // emptied and left alone for 6 h: the chamber settles shut and a new one waits for the next geode
    if (!v.locked && t - (v.unlockedAt || t) > 6 * 3600e3) {
      const inside = this.sql.exec('SELECT x, z FROM items WHERE holder IS NULL').toArray().some((r) => Math.hypot(r.x - v.x, r.z - v.z) < VAULT_R);
      if (!inside && !open) { this.newVault(this.spot('keeper') || a); this.seenV.clear(); }
    }
  }
  unlock(ws, a, t) {
    const v = this.vault(); if (!v) return;
    const { lock } = this.parts(v);
    if (this.dist(a, lock) > REACH + 0.3) return this.sys(ws, 'Stand at the lock on the slab.');
    if (!v.locked) return this.sys(ws, 'The lock already holds a crystal. Stand on the plate to raise the slab.');
    const key = this.held(a.aid).find((x) => x.k === 'geode');
    if (!key) return this.sys(ws, 'The lock is a six-sided socket, cut for a crystal. You have nothing that fits.');
    this.sql.exec('DELETE FROM items WHERE id = ?', key.id);
    v.locked = false; v.unlockedAt = t;
    RELIC_KINDS.forEach((k, i) => { const ang = (i / RELIC_KINDS.length) * Math.PI * 2 + 0.4, r = 1.0 + (i % 2) * 1.0; this.addItem(k, { x: v.x + Math.cos(ang) * r, z: v.z + Math.sin(ang) * r, tile: v.tile }, null, null); });
    this.saveVault(v);
    for (const o of this.present()) if (this.dist(o, v) <= SEE_VAULT) this.learn(o.aid);
    this.w.broadcast({ t: 'g', k: 'say', text: `${a.name} set the crystal in the lock. Something heavy shifts inside the stone.` });
    this.pushVault(); this.pushItems();
  }
  dig(ws, a, t) {
    const v = this.vault(); if (!v || v.tunnel || v.locked) return;
    if (Math.hypot(a.x - v.x, a.z - v.z) >= VAULT_R) return;
    if (this.doorOpen(v)) return this.sys(ws, 'The slab is up. Just walk out.');
    if (t - (this.digT.get(a.aid) || 0) < DIG_EVERY) return;
    this.digT.set(a.aid, t);
    v.dig += 1;
    if (v.dig >= DIG_NEED) { v.tunnel = true; this.saveVault(v); this.w.broadcast({ t: 'g', k: 'say', text: `${a.name} dug through the back wall of the vault.` }); this.pushVault(); return; }
    this.saveVault(v);
    this.w.send(ws, { t: 'g', k: 'dig', n: v.dig, need: DIG_NEED });
  }

  // ---- Ula's senses: she sees in a cone in front of her and hears by how loud you move. She only knows
  // what she noticed herself, and only that goes into her memory. No hidden reputation, just what she witnessed.
  perceives(o) {
    const kp = this.spot('keeper'); if (!kp || !o || o.x == null || (o.tile || null) !== (kp.tile || null)) return false;
    const dx = o.x - kp.x, dz = o.z - kp.z, d = Math.hypot(dx, dz);
    if (d > ULA_SIGHT) return false;
    const fx = Math.sin(this.ulaYaw), fz = Math.cos(this.ulaYaw);
    const cos = d > 0.01 ? (dx * fx + dz * fz) / d : 1;
    const speed = this.spd.get(o.aid) || 0;
    const loud = speed > 5.5 ? 16 : speed > 2.5 ? 7 : speed > 0.3 ? 3 : 1.2;   // sprint / walk / creep / still
    return cos > ULA_CONE || d < loud;
  }
  ulaPose(a, prev, t) {
    if (prev) { const dt = Math.max(0.05, (t - (this.lastT.get(a.aid) || t - 100)) / 1000); this.spd.set(a.aid, Math.hypot(a.x - prev.x, a.z - prev.z) / dt); }
    this.lastT.set(a.aid, t);
    const kp = this.spot('keeper'); if (!kp) return;
    const now = this.perceives(a), was = this.noticed.has(a.aid);
    if (now && !was) {
      this.noticed.add(a.aid);
      this.ulaYaw = Math.atan2(a.x - kp.x, a.z - kp.z);   // she turns to look
      this.w.broadcast({ t: 'g', k: 'ula', yaw: r2(this.ulaYaw), look: a.aid, how: (this.spd.get(a.aid) || 0) > 5.5 ? 'heard' : 'saw' });
    } else if (!now && was) this.noticed.delete(a.aid);
  }
  witness(t, actors, text, who) {
    if (!actors.some((o) => this.perceives(o))) return;
    this.sql.exec('INSERT INTO seen (ts, text, who) VALUES (?, ?, ?)', t, text, who.join(','));
    this.sql.exec('DELETE FROM seen WHERE id <= (SELECT MAX(id) - 30 FROM seen)');
  }
  talk(ws, a, t) {
    const kp = this.spot('keeper');
    if (!kp || this.dist(a, kp) > KEEPER_TALK) return;
    const q = this.questOf(a.aid), lines = [];
    // what she saw since you last spoke, that involved you
    const seen = this.sql.exec('SELECT ts, text, who FROM seen WHERE ts > ? ORDER BY ts DESC LIMIT 2', q.ts || 0).toArray().filter((r) => r.who.split(',').includes(a.aid));
    for (const r of seen.reverse()) lines.push(`Ula: I saw it with my own eyes: ${r.text}, ${ago(t - r.ts)}.`);
    const mine = this.held(a.aid);
    const geode = mine.find((x) => x.k === 'geode');
    let step = q.step;
    // newcomers first walk the opening with her (gather, craft, fish, build, deliver); the geode waits until then,
    // unless they already started it (old players keep where they were)
    const hearers = this.present().filter((o) => this.dist(o, kp) <= KEEPER_SHARE);
    const op = step === 0 && !geode && this.op.here(a) ? this.op.talk(a, t, hearers) : null;
    if (op) {
      lines.push(op.text);
      this.setQuest(a.aid, 0, q.lore); // what she saw is now told
      this.ulaYaw = Math.atan2(a.x - kp.x, a.z - kp.z);
      return this.w.send(ws, { t: 'g', k: 'npc', text: lines.join(' '), quest: 0, open: op.step });
    }
    if (step === 0) { lines.push(KEEPER_LINES.intro); step = 1; }
    if (geode && step < 3) {
      lines.push(KEEPER_LINES.done, KEEPER_LINES.clue);
      step = 3; this.bump(a.aid, a.name, { quests: 1 });
      // she says it out loud: anyone close enough to hear her voice learns where the vault is
      for (const o of this.present()) if (o.aid === a.aid || (this.dist(o, kp) <= KEEPER_SHARE)) {
        this.learn(o.aid); const s = this.sock(o.aid); if (s) this.sendVault(s, o);
        if (o.aid !== a.aid) { const oq = this.questOf(o.aid); if (oq.step < 3) { this.setQuest(o.aid, 3); this.bump(o.aid, o.name, { quests: 1 }); if (s) this.w.send(s, { t: 'g', k: 'npc', text: `${KEEPER_LINES.done} ${KEEPER_LINES.clue}`, quest: 3 }); } }
      }
      this.w.broadcast({ t: 'g', k: 'board', board: this.board() });
    } else if (step === 1 && !lines.length) lines.push(KEEPER_LINES.waiting);
    else if (step === 1 && seen.length) lines.push(KEEPER_LINES.waiting);
    else if (step >= 3) {
      const relic = mine.find((x) => RELIC_LORE[x.k]);
      if (relic) lines.push(RELIC_LORE[relic.k]);
      else if (!seen.length) lines.push(KEEPER_LINES.lore[q.lore % KEEPER_LINES.lore.length]);
    }
    this.setQuest(a.aid, step, step >= 3 && !mine.some((x) => RELIC_LORE[x.k]) ? q.lore + 1 : q.lore);
    this.ulaYaw = Math.atan2(a.x - kp.x, a.z - kp.z);
    this.w.send(ws, { t: 'g', k: 'npc', text: lines.join(' '), quest: step });
  }

  // ---- Easter egg: the standoff. Two players stand face to face and both hold still for 3 s;
  // then the first one to move loses. Decided from the server's own record of who moved.
  standoffPose(a, prev, t) {
    const so = this.so;
    if (so && (so.a === a.aid || so.b === a.aid)) {
      const base = so.a === a.aid ? so.pa : so.pb;
      const moved = Math.hypot(a.x - base.x, a.z - base.z) > 0.3 || Math.abs(angDiff(a.yaw, base.yaw)) > 0.7;
      if (!so.live) { if (moved) this.so = null; return; }
      if (t - so.t0 < 600 || !moved) return;
      const loser = a.aid, winner = so.a === a.aid ? so.b : so.a, wo = this.att(winner);
      this.so = null; this.soCd.set(pairKey(so.a, so.b), t + 60e3);
      if (wo) this.bump(winner, wo.name, { eggs: 1 });
      this.w.broadcast({ t: 'g', k: 'egg', e: 'standoff-end', winner, loser, name: wo ? wo.name : '?', lname: a.name });
      return;
    }
    if (so) return;
    const g = this.game; if (g && g.phase !== 'done' && g.players[a.aid]) return;
    for (const o of this.present()) {
      if (o.aid === a.aid || o.x == null || (o.tile || null) !== (a.tile || null)) continue;
      if (Math.hypot(o.x - a.x, o.z - a.z) > STANDOFF_D) continue;
      if ((this.soCd.get(pairKey(a.aid, o.aid)) || 0) > t) continue;
      this.so = { a: a.aid, b: o.aid, since: t, live: false, pa: { x: a.x, z: a.z, yaw: a.yaw }, pb: { x: o.x, z: o.z, yaw: o.yaw } };
      this.schedule();
      return;
    }
  }
  standoffTick(t) {
    const so = this.so; if (!so) return;
    if (so.live) {
      if (t >= so.t0 + STANDOFF_MAX) { this.so = null; this.soCd.set(pairKey(so.a, so.b), t + 60e3); this.w.broadcast({ t: 'g', k: 'egg', e: 'standoff-end', winner: null }); }
      return;
    }
    if (t < so.since + STANDOFF_HOLD) return;
    const A = this.att(so.a), B = this.att(so.b);
    if (!A || !B || A.x == null || B.x == null || Math.hypot(A.x - B.x, A.z - B.z) > STANDOFF_D) { this.so = null; return; }
    so.live = true; so.t0 = t; so.pa = { x: A.x, z: A.z, yaw: A.yaw }; so.pb = { x: B.x, z: B.z, yaw: B.yaw };
    this.w.broadcast({ t: 'g', k: 'egg', e: 'standoff', a: so.a, b: so.b, an: A.name, bn: B.name });
  }
}

function segDist(p0, p1, c) {
  const vx = p1.x - p0.x, vz = p1.z - p0.z, L = vx * vx + vz * vz;
  const k = L > 1e-9 ? Math.max(0, Math.min(1, ((c.x - p0.x) * vx + (c.z - p0.z) * vz) / L)) : 0;
  return Math.hypot(p0.x + vx * k - c.x, p0.z + vz * k - c.z);
}
const angDiff = (a, b) => { let d = ((a - b + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI; return d; };
const pairKey = (a, b) => (a < b ? a + b : b + a);
