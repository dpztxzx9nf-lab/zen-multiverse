// Points of interest on the server (js/places.js has the data): who has found which place, the shared digs
// and what they give. Only in the one shared world, on the garden frame (tile null). Nothing is taken on the
// client's word: a place is found when the server saw you inside it (or on top of the lookout hill), a dig
// counts only from within reach of the rubble at a human pace, and the loot is decided and handed out here.
// Protocol (inside {t:'g'}): client {k:'pdig', id}; server {k:'pl', seen, digs}, {k:'pfound', id, all},
// {k:'grant', why, id, give, text}. Old clients never send pdig and ignore the rest.
import { PLACES, NODES, RELICS, DIG_REFILL_MS, digSpot, nodeNow, FISH, atCove } from '../../js/places.js';
import { SHARED_HOME } from './worlds.js';

const PDIG_EVERY = 550;           // ms between two digs by one person (a swing of the arms)
const SLACK = 0.8;                // metres of pose lag allowed on top of a dig's reach
const ID_RE = /^[a-z]{2,16}$/;
const BY_ID = Object.fromEntries(PLACES.map((p) => [p.id, p]));
const NODE = Object.fromEntries(NODES.map((n) => [n.id, n]));
const NODE_RE = /^[a-z]{2,12}\d{0,2}$/;
// a place inside something (the sea cave) is only there between its floor and roof, not on the rock above it
const inY = (p, a) => (p.ymin == null || (a.y ?? 0) >= p.ymin) && (p.ymax == null || (a.y ?? 0) <= p.ymax);

export class Places {
  constructor(w, games) {
    this.w = w; this.g = games; this.sql = w.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS place_seen (aid TEXT NOT NULL, id TEXT NOT NULL, ts INTEGER, PRIMARY KEY (aid, id));
      CREATE TABLE IF NOT EXISTS place_dig (id TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0, cycle INTEGER NOT NULL DEFAULT 0, crew TEXT NOT NULL DEFAULT '[]', done INTEGER, ts INTEGER);
      CREATE TABLE IF NOT EXISTS place_node (id TEXT PRIMARY KEY, n INTEGER NOT NULL, ts INTEGER NOT NULL);`);
    this.last = new Map(); // aid -> last dig time
    this.seenC = new Map(); // aid -> Set (cache of place_seen)
    this.refill = w.env && w.env.LOCAL_DEV === '1' ? 90e3 : DIG_REFILL_MS;
  }
  // the shared world's garden frame only (per-player home keys and other worlds keep the old game)
  here(a) { return a && (a.world || '').split('#')[0] === SHARED_HOME && (a.tile || null) === null; }
  seen(aid) {
    let s = this.seenC.get(aid);
    if (!s) { s = new Set(this.sql.exec('SELECT id FROM place_seen WHERE aid = ?', aid).toArray().map((r) => r.id)); this.seenC.set(aid, s); }
    return s;
  }
  dig(id, t = Date.now()) {
    let r = this.sql.exec('SELECT n, cycle, crew, done FROM place_dig WHERE id = ?', id).toArray()[0];
    r = r ? { n: r.n, cycle: r.cycle, crew: JSON.parse(r.crew || '[]'), done: r.done || null } : { n: 0, cycle: 0, crew: [], done: null };
    if (r.done && t - r.done >= this.refill) { r.n = 0; r.cycle += 1; r.crew = []; r.done = null; this.saveDig(id, r); } // the rubble settled: there is more under it
    return r;
  }
  saveDig(id, r) { this.sql.exec('INSERT OR REPLACE INTO place_dig (id, n, cycle, crew, done, ts) VALUES (?, ?, ?, ?, ?, ?)', id, r.n, r.cycle, JSON.stringify(r.crew), r.done, Date.now()); }
  digView(t = Date.now()) {
    const out = {};
    for (const p of PLACES) if (p.dig) { const r = this.dig(p.id, t); out[p.id] = { n: r.n, need: p.dig, left: r.done ? Math.max(0, r.done + this.refill - t) : 0 }; }
    return out;
  }
  // gatherable spots (driftwood, reeds): how many are there now (they come back one at a time)
  node(nd, t = Date.now()) {
    return nodeNow(nd, this.sql.exec('SELECT n, ts FROM place_node WHERE id = ?', nd.id).toArray()[0], t);
  }
  nodeView(t = Date.now()) { return Object.fromEntries(NODES.map((nd) => [nd.id, this.node(nd, t).n])); }
  ntake(ws, a, m, t) {
    if (!this.here(a) || a.x == null) return;
    const nd = typeof m.id === 'string' && NODE_RE.test(m.id) ? NODE[m.id] : null;
    if (!nd) return this.w.strike(ws, a, 1, 'ntake-id');
    if (Math.hypot(a.x - nd.x, a.z - nd.z) > nd.reach + SLACK) return this.g.sys(ws, 'Too far away. Step up to it.');
    if (t - (this.last.get(a.aid) || 0) < PDIG_EVERY) return;
    this.last.set(a.aid, t);
    const c = this.node(nd, t);
    if (c.n <= 0) return this.g.sys(ws, nd.kind === 'drift' ? 'Nothing left of this log worth taking. More washes up in time.' : 'These reeds are cut to the stubs. They grow back.');
    this.sql.exec('INSERT OR REPLACE INTO place_node (id, n, ts) VALUES (?, ?, ?)', nd.id, c.n - 1, c.ts);
    this.w.send(ws, { t: 'g', k: 'grant', why: 'node', id: nd.id, give: { ...nd.give }, text: nd.kind === 'drift' ? 'Dry, salt-bleached wood.' : 'Long, tough stems: good fibre.' });
    for (const o of this.g.present()) if (this.here(o)) { const s = this.g.sock(o.aid); if (s) this.w.send(s, { t: 'g', k: 'pnode', id: nd.id, n: c.n - 1 }); }
  }
  // a fish caught at the cove: the client's line and fish are its own, but the stock is shared and counted
  // here, and the fish you can hand to someone is a real object in your hands (or at your feet)
  catch(ws, a, t) {
    if (!this.here(a) || a.x == null) return;
    if (!atCove(a.x, a.z)) return; // not at the cove (a fish from elsewhere is the client's own business)
    const k = 'fish:' + a.aid; if (t - (this.last.get(k) || 0) < FISH.minGap) return; this.last.set(k, t);
    const c = this.node(FISH, t);
    if (c.n <= 0) return this.w.send(ws, { t: 'g', k: 'fishout', text: 'It slips the hook. The cove is fished out for now; give it an hour.' });
    this.sql.exec('INSERT OR REPLACE INTO place_node (id, n, ts) VALUES (?, ?, ?)', FISH.id, c.n - 1, c.ts);
    const full = this.g.held(a.aid).length >= 3;
    this.g.addItem('fish', { x: a.x, z: a.z, tile: null }, full ? null : a.aid, a.aid);
    this.w.send(ws, { t: 'g', k: 'fishok', left: c.n - 1, full });
    this.g.pushItems();
  }
  hello(ws, a) {
    if (!this.here(a)) return;
    this.w.send(ws, { t: 'g', k: 'pl', seen: [...this.seen(a.aid)], digs: this.digView(), nodes: { ...this.nodeView(), [FISH.id]: this.node(FISH).n } });
  }
  found(ws, a, ids, all) {
    const s = this.seen(a.aid), fresh = ids.filter((id) => !s.has(id)); if (!fresh.length) return;
    const t = Date.now();
    for (const id of fresh) { s.add(id); this.sql.exec('INSERT OR IGNORE INTO place_seen (aid, id, ts) VALUES (?, ?, ?)', a.aid, id, t); }
    this.w.send(ws, { t: 'g', k: 'pfound', ids: fresh, all: !!all });
  }
  // walking inside a place finds it; standing on top of the lookout hill shows you all of them
  onPose(ws, a) {
    if (!this.here(a) || a.x == null) return;
    const L = BY_ID.lookout;
    if (L && Math.hypot(a.x - L.x, a.z - L.z) < 3.2 && (a.y || 0) > L.top - 1.0) this.found(ws, a, PLACES.filter((p) => !p.hidden).map((p) => p.id), true);
    const inside = PLACES.filter((p) => Math.hypot(a.x - p.x, a.z - p.z) < p.r && inY(p, a)).map((p) => p.id);
    if (inside.length) this.found(ws, a, inside, false);
  }
  // one swing at a dig; when the rubble gives way, everyone who helped this time gets the materials
  pdig(ws, a, m, t) {
    if (!this.here(a) || a.x == null) return;
    const p = typeof m.id === 'string' && ID_RE.test(m.id) ? BY_ID[m.id] : null;
    if (!p || !p.dig) return this.w.strike(ws, a, 1, 'pdig-id');
    const at = digSpot(p);
    if (Math.hypot(a.x - at.x, a.z - at.z) > (p.reach || 2.4) + SLACK || !inY(p, a)) return this.g.sys(ws, 'Too far away to dig there. Step up to it.');
    if (t - (this.last.get(a.aid) || 0) < PDIG_EVERY) return;
    this.last.set(a.aid, t);
    const r = this.dig(p.id, t);
    if (r.done) { const mins = Math.ceil((r.done + this.refill - t) / 60e3); return this.g.sys(ws, `Nothing more comes out of the ${p.name.toLowerCase()} for now. It settles over time (about ${mins >= 90 ? Math.round(mins / 60) + ' h' : mins + ' min'}).`); }
    this.found(ws, a, [p.id], false);
    r.n += 1; if (!r.crew.includes(a.aid)) r.crew.push(a.aid);
    if (r.n < p.dig) { this.saveDig(p.id, r); return this.pushDig(p, r, t); }
    r.done = t; r.n = p.dig; this.saveDig(p.id, r);
    const names = [];
    for (const aid of r.crew) {
      const s = this.g.sock(aid), o = s && this.w.att(s); if (!o) continue;
      names.push(o.name);
      this.w.send(s, { t: 'g', k: 'grant', why: 'place', id: p.id, give: { ...p.loot }, text: p.found });
    }
    // the relic is a real object on the ground: whoever picks it up has it (one at a time in the world)
    if (p.relic && !this.sql.exec('SELECT id FROM items WHERE k = ?', p.relic).toArray().length) {
      this.g.addItem(p.relic, { x: at.x + 0.6, z: at.z + 0.4, tile: null }, null, null);
      this.g.pushItems();
    }
    this.pushDig(p, r, t);
    const crew = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0] || a.name;
    for (const o of this.g.present()) if (this.here(o) && Math.hypot(o.x - at.x, o.z - at.z) < 30) { const s = this.g.sock(o.aid); if (s) this.g.sys(s, `${crew} broke into the ${p.name.toLowerCase()}${p.relic ? `: there is a ${RELICS[p.relic]} on the ground` : ''}.`); }
  }
  pushDig(p, r, t) {
    const v = { n: r.n, need: p.dig, left: r.done ? Math.max(0, r.done + this.refill - t) : 0 };
    for (const o of this.g.present()) if (this.here(o)) { const s = this.g.sock(o.aid); if (s) this.w.send(s, { t: 'g', k: 'pdig', id: p.id, ...v }); }
  }
}
