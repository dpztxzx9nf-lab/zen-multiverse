// Things set down in the world (js/game/fixtures.js): workbenches, forges and cooking fires to make things at, and
// chests and safes to keep things in. The server keeps them (one Durable Object per world, SQLite) and is the only
// one that moves anything in or out of a box. Every request is checked against what the server itself knows: your
// validated position (reach), the box's own contents (you can only take what is in it), the box's lock (a safe opens
// for its owner and the friends they add), caps, and a human pace. A Durable Object runs one message at a time and
// every transfer is a synchronous read-check-write, so two people grabbing the last stack at once cannot both get it.
//
// What the server can and cannot see: real objects (relics, the geode, a fish in your hands) live in the server's
// items table, so a box takes and gives those exactly (holder 'f:<box id>'). Bag items (wood, stone, metal...) live in
// the server's bag (server/src/bag.js, D1): a deposit takes them out of your bag there first and only then counts
// them into the box; a withdrawal counts them out of the box and into your bag. The client only asks, and shows the
// bag the server sends back. A client from before the server bag (a.bag unset) can't move bag items in or out.
//
// Breaking: a chest takes 40 points of blows (axe 10, pick 8, bare hands 4, one every 600 ms) and spills: real objects
// fall on the ground where it stood, bag items lie in a spilled heap anyone can pick through for 30 minutes. A safe,
// a forge, a bench or a fire cannot be broken by anyone; the owner takes their own down (a box must be empty first)
// and gets it back in the bag. The garden's own bench and fire at the cove and forge by the shed belong to everyone.
//
// Protocol (inside {t:'g'}). Client: splace {kind,x,y,z,yaw,tile}, sopen {id}, sclose, sput {id,item,n},
// sputo {id,iid}, stake {id,item,n}, stakeo {id,iid}, shit {id,tool}, sdown {id}, sallow {id,to,on}, sgear {gear},
// scraft {r,ref}. Server: sfix {list}, sone {f}, sgone {id,why}, sbox {...}, sno {text}, sgot {give,text},
// scraft {ref,ok,why}, sshut {id}.
import { FIXTURES, STATION_R, BOX_R, PLACE_R, GAP, STACK, CAPS, WORLD_CAP, ALLOW_MAX, BREAK_HIT, HIT_EVERY, ITEM_RE, carryFor, CARRY_GEAR, slotsUsed, room, locked } from '../../js/game/fixtures.js';
import { RECIPES } from '../../js/game/g7/craft.js';
import { WORKSHOP } from '../../js/opening.js';
import { gardenBlock } from './garden.js';
import { groundAt } from './builds.js';
import { inside as inCove } from '../../js/cove.js';
import { SHARED_HOME, WORLD_SPAWN } from '../../js/spawn.js';
import { itemOk } from '../../js/game/bag-rules.js';

const RECIPE = Object.fromEntries(RECIPES.map((r) => [r.id, r]));
const GARDEN = { x: 1.5, z: -0.5, r: 54 };
const EVERY = 180;                 // ms between two box moves by one person (a hand can only move so fast)
const SPILL_MS = 30 * 60e3;        // a spilled heap lies this long
const SPILL_SLOTS = 40;
const WORLD = 'world';             // owner of the garden's own stations
const AID_RE = /^[0-9a-f]{32}$/;
// the garden's own: a bench and a fire on the cove's bank (Ula's walk: make a spear or rod here, cook the catch),
// and a forge beside the shed (its bench is the shed's own, js/opening.js WORKSHOP)
export const GARDEN_FIXTURES = [
  { id: 'g-bench', kind: 'bench', x: 6.8, z: -23.2, yaw: -0.5 },
  { id: 'g-fire', kind: 'fire', x: -2.6, z: -23.4, yaw: 0 },
  { id: 'g-forge', kind: 'forge', x: 15.6, z: 0.4, yaw: -Math.PI / 2 }, // on open lawn between the pond and the shed, clear of the azalea at (16.8, -2.2)
];
const r2 = (v) => Math.round(v * 100) / 100;
const nid = () => 'f' + crypto.randomUUID().replace(/-/g, '').slice(0, 10);
const clampN = (n) => (Number.isInteger(n) && n > 0 && n <= 9999 ? n : 0);
const def = (k) => (k === 'spill' ? { name: 'Spilled things', kind: 'box', slots: SPILL_SLOTS, open: 'anyone', hp: 0 } : FIXTURES[k]);

export class Storage {
  constructor(w, games) {
    this.w = w; this.g = games; this.sql = w.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS fixtures (id TEXT PRIMARY KEY, kind TEXT NOT NULL, x REAL, y REAL, z REAL, yaw REAL, tile TEXT, owner TEXT, oname TEXT, hp INTEGER, inv TEXT, allow TEXT, ts INTEGER);
      CREATE TABLE IF NOT EXISTS gear (aid TEXT PRIMARY KEY, carry INTEGER NOT NULL);`);
    this.last = new Map(); this.hitT = new Map(); this.viewers = new Map(); // box id -> Set(aid)
  }
  garden(a) { return a && (a.world || '').split('#')[0] === SHARED_HOME && (a.tile || null) === null; }
  seed() {
    if (this._seeded) return; this._seeded = true;
    for (const f of GARDEN_FIXTURES) {
      if (this.get(f.id)) continue;
      this.sql.exec('INSERT INTO fixtures (id, kind, x, y, z, yaw, tile, owner, oname, hp, inv, allow, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', f.id, f.kind, f.x, groundAt(f.x, f.z), f.z, f.yaw, '', WORLD, 'the garden', 0, '{}', '[]', Date.now());
    }
  }
  // ---- rows (inv has no prototype: an item called 'constructor' is just an item)
  row(r) { return r ? { ...r, tile: r.tile || null, inv: Object.assign(Object.create(null), JSON.parse(r.inv || '{}')), allow: JSON.parse(r.allow || '[]') } : null; }
  get(id) { return typeof id === 'string' && id.length < 24 ? this.row(this.sql.exec('SELECT * FROM fixtures WHERE id = ?', id).toArray()[0]) : null; }
  all() { return this.sql.exec('SELECT * FROM fixtures').toArray().map((r) => this.row(r)); }
  saveInv(f) { this.sql.exec('UPDATE fixtures SET inv = ?, ts = ? WHERE id = ?', JSON.stringify(f.inv), Date.now(), f.id); }
  objs(id) { return this.sql.exec('SELECT id, k FROM items WHERE holder = ?', 'f:' + id).toArray(); }
  wire(f) { return [f.id, f.kind, r2(f.x), r2(f.y), r2(f.z), r2(f.yaw), f.tile, f.owner, f.oname || '', locked(f.kind) ? f.allow.length : 0, f.hp]; }
  carry(aid) { const r = this.sql.exec('SELECT carry FROM gear WHERE aid = ?', aid).toArray()[0]; return r ? r.carry : carryFor([]); }
  // ---- what clients see
  hello(ws, a) {
    if (this.garden(a)) this.seed();
    this.sweep(Date.now());
    this.w.send(ws, { t: 'g', k: 'sfix', list: this.all().map((f) => this.wire(f)), carry: this.carry(a.aid) });
  }
  tell(m) { this.w.broadcast({ t: 'g', ...m }); }
  // refused: say why. give = what the client already took out of its own view of the bag to ask with (it shows it
  // back; the server's bag never lost it). A bag client is then sent its bag as it really is.
  no(ws, text, give) { this.w.send(ws, { t: 'g', k: 'sno', text }); if (give) this.refund(ws, give); }
  refund(ws, give, text) { const a = this.w.att(ws); this.w.send(ws, { t: 'g', k: 'sgot', give, text: text || null, led: this.bag(a) ? 1 : 0 }); }
  bag(a) { return !!(this.w.bag && this.w.bag.on(a)); }
  old(ws, a, give) { if (this.bag(a)) return false; this.no(ws, 'Update Zen Multiverse to use storage: your bag now lives on the server.', give); return true; }
  async shown(ws, a) { if (this.bag(a)) await this.w.bag.show(ws, a); }
  slow(a, t, every = EVERY) { if (t - (this.last.get(a.aid) || 0) < every) return true; this.last.set(a.aid, t); return false; }
  near(a, f, r) { return a && a.x != null && f && (a.tile || null) === (f.tile || null) ? this.g.dist(a, f) <= r + (def(f.kind)?.r || 0) : false; }
  canOpen(a, f) { const d = def(f.kind); return d.open === 'anyone' || f.owner === a.aid || f.allow.includes(a.aid); }
  boxView(f, a) {
    const d = def(f.kind);
    return { t: 'g', k: 'sbox', id: f.id, kind: f.kind, inv: f.inv, objs: this.objs(f.id), slots: d.slots, used: slotsUsed(f.inv, this.objs(f.id).length), mine: f.owner === a.aid,
      allow: f.owner === a.aid && locked(f.kind) ? f.allow.map((x) => ({ id: x, name: (this.g.att(x) || {}).name || null })) : undefined, hp: f.hp, carry: this.carry(a.aid) };
  }
  // everyone looking into a box sees it change (two people at one chest)
  pushBox(f) {
    const set = this.viewers.get(f.id); if (!set) return;
    for (const aid of [...set]) {
      const s = this.g.sock(aid), o = s && this.w.att(s);
      if (!o || !this.near(o, f, BOX_R + 1) || !this.canOpen(o, f)) { set.delete(aid); if (s) this.w.send(s, { t: 'g', k: 'sshut', id: f.id }); continue; }
      this.w.send(s, this.boxView(f, o));
    }
  }
  sweep(t) { // spilled heaps that have lain too long, and empty ones
    for (const f of this.all()) if (f.kind === 'spill' && (t - f.ts > SPILL_MS || (!slotsUsed(f.inv) && !this.objs(f.id).length))) this.remove(f, 'gone');
  }
  remove(f, why) {
    this.sql.exec('DELETE FROM fixtures WHERE id = ?', f.id);
    this.viewers.delete(f.id);
    this.tell({ k: 'sgone', id: f.id, why });
  }

  async msg(ws, a, m, t) {
    switch (m.k) {
      case 'splace': { await this.place(ws, a, m, t); return this.shown(ws, a); }
      case 'sopen': return this.open(ws, a, m, t);
      case 'sclose': { const s = this.viewers.get(m.id); if (s) { s.delete(a.aid); if (!s.size) this.tell({ k: 'slid', id: m.id, on: 0 }); } return; }
      case 'sput': { await this.put(ws, a, m, t); return this.shown(ws, a); }
      case 'sputo': return this.putObj(ws, a, m, t);
      case 'stake': { await this.take(ws, a, m, t); return this.shown(ws, a); }
      case 'stakeo': return this.takeObj(ws, a, m, t);
      case 'shit': return this.hit(ws, a, m, t);
      case 'sdown': { await this.down(ws, a, m, t); return this.shown(ws, a); }
      case 'sallow': return this.allow(ws, a, m, t);
      case 'sgear': return this.gear(ws, a, m);
      case 'scraft': { await this.craft(ws, a, m, t); return this.shown(ws, a); }
    }
  }
  // what you wear that lets you carry more (the satchel, the travel pack: crafted in your save, like all gear)
  gear(ws, a, m) {
    const list = Array.isArray(m.gear) ? m.gear.filter((g) => typeof g === 'string' && CARRY_GEAR[g]).slice(0, 4) : [];
    const n = carryFor([...new Set(list)]);
    this.sql.exec('INSERT OR REPLACE INTO gear (aid, carry) VALUES (?, ?)', a.aid, n);
    this.w.send(ws, { t: 'g', k: 'scarry', carry: n });
  }

  // ---- setting things down: the thing comes out of your bag on the server when it stands (refused = it never left)
  async place(ws, a, m, t) {
    const d = FIXTURES[m.kind]; if (!d) return this.no(ws, 'That can\'t be set down.'); // bad messages are refused, never a kick
    const give = { [d.item]: 1 };
    if (this.old(ws, a, give)) return;
    let x = +m.x, y = +m.y, z = +m.z; const yaw = +m.yaw || 0, tile = typeof m.tile === 'string' && m.tile ? m.tile : null;
    if (![x, y, z, yaw].every(Number.isFinite)) return this.no(ws, 'Not there.', give);
    if (a.x == null) return this.no(ws, 'Take a step first so the world knows where you are.', give);
    if ((a.tile || null) !== tile) return this.no(ws, 'Not there.', give);
    if (this.slow(a, t, 400)) return this.no(ws, 'One thing at a time.', give);
    const p = { x, z, tile };
    if (this.g.dist(a, p) > PLACE_R) return this.no(ws, 'Too far to set it down there.', give);
    if (tile === null && this.garden(a)) {
      if (Math.hypot(x - GARDEN.x, z - GARDEN.z) > GARDEN.r) return this.no(ws, 'Set it down inside the garden.', give);
      if (Math.hypot(x - WORLD_SPAWN.x, z - WORLD_SPAWN.z) < 4) return this.no(ws, 'Keep the arrival stone clear.', give);
      const why = gardenBlock(x, z, d.r); if (why) return this.no(ws, `Not on the ${why.replace(/^place:/, '')}.`, give);
      if (inCove(x, z) > -0.4) return this.no(ws, 'Not in the water.', give);
      y = groundAt(x, z); // the server knows the garden's ground
    } else if (Math.abs(y - (a.y || 0)) > 2.5) return this.no(ws, 'It has to stand on the ground near you.', give);
    const room = () => { // checked again after the bag answers (someone may have set something down meanwhile)
      const list = this.all();
      if (list.length >= WORLD_CAP) return 'This world has all the things set down it can take for now.';
      if (list.filter((f) => f.owner === a.aid && f.kind === m.kind).length >= CAPS[m.kind]) return `You have ${CAPS[m.kind]} ${d.name.toLowerCase()}${CAPS[m.kind] > 1 ? 's' : ''} out already. Take one down first.`;
      if (list.some((f) => (f.tile || null) === tile && Math.hypot(f.x - x, f.z - z) < GAP + (def(f.kind).r || 0.5) + d.r - 0.6)) return 'Too close to something already there.';
      return null;
    };
    let why = room(); if (why) return this.no(ws, why, give);
    if (!(await this.w.bag.take(a, give))) return this.no(ws, `You have no ${d.name.toLowerCase()} in your bag.`, give);
    why = room(); if (why) { await this.w.bag.give(a, give); return this.no(ws, why, give); }
    const f = { id: nid(), kind: m.kind, x: r2(x), y: r2(y), z: r2(z), yaw: r2(yaw), tile, owner: a.aid, oname: a.name || '', hp: d.hp || 0, inv: {}, allow: [] };
    this.sql.exec('INSERT INTO fixtures (id, kind, x, y, z, yaw, tile, owner, oname, hp, inv, allow, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', f.id, f.kind, f.x, f.y, f.z, f.yaw, tile || '', f.owner, f.oname, f.hp, '{}', '[]', t);
    this.tell({ k: 'sone', f: this.wire(f), by: a.aid, ref: typeof m.ref === 'string' ? m.ref.slice(0, 16) : null });
  }
  // ---- boxes
  box(ws, a, id, reach = BOX_R) {
    const f = this.get(id); const d = f && def(f.kind);
    if (!f || !d || d.kind !== 'box') return null;
    if (!this.near(a, f, reach)) { this.no(ws, 'Too far away.'); return null; }
    if (!this.canOpen(a, f)) { this.no(ws, locked(f.kind) ? `Locked. This ${f.kind} belongs to ${f.oname || 'someone else'}.` : 'It will not open.'); return null; }
    return f;
  }
  open(ws, a, m, t) {
    const f = this.box(ws, a, m.id); if (!f) return;
    (this.viewers.get(f.id) || this.viewers.set(f.id, new Set()).get(f.id)).add(a.aid);
    this.w.send(ws, this.boxView(f, a));
    if (f.owner !== a.aid && f.owner !== WORLD && f.kind !== 'spill') { const o = this.g.att(f.owner); if (o) this.g.witness(t, [a, o], `${a.name} opened ${f.oname}'s crate`, [a.aid, f.owner]); }
    this.tell({ k: 'slid', id: f.id, on: 1 });
  }
  // in: out of your bag on the server first (it has to be there), then into the box. Nothing is ever in both.
  async put(ws, a, m, t) {
    const n = clampN(m.n), k = m.item;
    if (!n || typeof k !== 'string' || !ITEM_RE.test(k) || !itemOk(k)) return this.no(ws, 'That can\'t go in there.');
    const give = { [k]: n };
    if (this.old(ws, a, give)) return;
    if (this.slow(a, t)) return this.no(ws, 'Easy: one handful at a time.', give);
    let f = this.box(ws, a, m.id); if (!f) return this.refund(ws, give);
    if (f.kind === 'spill') return this.no(ws, 'That heap is only for picking through.', give);
    const fit = Math.min(n, room(def(f.kind), f.inv, this.objs(f.id).length, k));
    if (!fit) return this.no(ws, `The ${def(f.kind).name.toLowerCase()} is full.`, give);
    if (!(await this.w.bag.take(a, { [k]: fit }))) return this.no(ws, 'You don\'t have that many.', give);
    // the box as it is now (someone may have moved things while the bag answered); what no longer fits goes back
    f = this.get(m.id); const d = f && def(f.kind);
    const now = f && this.near(a, f, BOX_R) && this.canOpen(a, f) ? Math.min(fit, room(d, f.inv, this.objs(f.id).length, k)) : 0;
    if (now) { f.inv[k] = (f.inv[k] || 0) + now; this.saveInv(f); }
    if (now < fit) await this.w.bag.give(a, { [k]: fit - now });
    if (now < n) this.refund(ws, { [k]: n - now }, now ? `Only ${now} fit.` : 'It would not go in.');
    if (f) this.pushBox(f);
  }
  // out: counted out of the box at once (so two hands on the last stack can't both have it), then into your bag
  async take(ws, a, m, t) {
    const n = clampN(m.n), k = m.item;
    if (!n || typeof k !== 'string' || !ITEM_RE.test(k)) return this.no(ws, 'That isn\'t in there.');
    if (this.old(ws, a)) return;
    if (this.slow(a, t)) return;
    const f = this.box(ws, a, m.id); if (!f) return;
    const have = f.inv[k] || 0, got = Math.min(n, have);
    if (!got) return this.pushBox(f); // someone else got there first
    f.inv[k] = have - got; if (!f.inv[k]) delete f.inv[k]; this.saveInv(f);
    let ok = false; try { ok = itemOk(k) && (await this.w.bag.give(a, { [k]: got })); } catch (e) { console.warn('[storage] bag give', e && e.message); }
    if (!ok) { // the bag could not take it: it stays in the box
      const g = this.get(f.id); if (g) { g.inv[k] = (g.inv[k] || 0) + got; this.saveInv(g); this.pushBox(g); }
      return this.no(ws, 'That would not come out. Try again in a moment.');
    }
    this.w.send(ws, { t: 'g', k: 'sgot', give: { [k]: got }, text: null, from: f.id, led: 1 });
    if (f.owner !== a.aid && f.owner !== WORLD && f.kind !== 'spill') { const o = this.g.att(f.owner); if (o) this.g.witness(t, [a, o], `${a.name} took ${got} from ${f.oname}'s ${f.kind === 'chest' ? 'crate' : f.kind}`, [a.aid, f.owner]); }
    this.pushBox(f);
    if (f.kind === 'spill') this.sweep(t);
  }
  // real objects: from your hands into the box, from the box into your hands (if there is room in them)
  putObj(ws, a, m, t) {
    if (this.slow(a, t)) return;
    const f = this.box(ws, a, m.id); if (!f) return;
    if (f.kind === 'spill') return this.no(ws, 'That heap is only for picking through.');
    const it = this.g.held(a.aid).find((i) => i.id === m.iid); if (!it) return;
    if (slotsUsed(f.inv, this.objs(f.id).length) >= def(f.kind).slots) return this.no(ws, `The ${def(f.kind).name.toLowerCase()} is full.`);
    this.sql.exec('UPDATE items SET holder = ?, by = ?, ts = ? WHERE id = ? AND holder = ?', 'f:' + f.id, a.aid, t, it.id, a.aid);
    this.g.pushItems(); this.pushBox(f);
  }
  takeObj(ws, a, m, t) {
    if (this.slow(a, t)) return;
    const f = this.box(ws, a, m.id); if (!f) return;
    const it = this.objs(f.id).find((i) => i.id === m.iid); if (!it) return this.pushBox(f);
    if (this.g.held(a.aid).length >= this.carry(a.aid)) return this.no(ws, 'Your hands are full.');
    this.sql.exec('UPDATE items SET holder = ?, ts = ? WHERE id = ? AND holder = ?', a.aid, t, it.id, 'f:' + f.id);
    this.g.pushItems(); this.pushBox(f);
    if (f.kind === 'spill') this.sweep(t);
  }
  // ---- safes: the owner adds or removes a friend (someone in this world right now, picked from the people near you)
  allow(ws, a, m) {
    const f = this.get(m.id); if (!f || !locked(f.kind) || f.owner !== a.aid) return;
    const to = typeof m.to === 'string' && AID_RE.test(m.to) ? m.to : null; if (!to || to === a.aid) return;
    if (m.on) { if (!f.allow.includes(to)) { if (f.allow.length >= ALLOW_MAX) return this.no(ws, `It opens for ${ALLOW_MAX} friends at most.`); if (!this.g.att(to)) return this.no(ws, 'They need to be in this world to be added.'); f.allow.push(to); } }
    else f.allow = f.allow.filter((x) => x !== to);
    this.sql.exec('UPDATE fixtures SET allow = ? WHERE id = ?', JSON.stringify(f.allow), f.id);
    this.w.send(ws, this.boxView(f, a)); this.pushBox(f);
    this.tell({ k: 'sone', f: this.wire(f) });
  }
  // ---- breaking a crate open, or prying a locker (with a real tool); safes and stations never break
  hit(ws, a, m, t) {
    const f = this.get(m.id); if (!f) return;
    const d = def(f.kind);
    if (!d.hp) return this.no(ws, f.kind === 'safe' ? 'Riveted plate. Nothing you have will dent it.' : 'That will not break.');
    if (!this.near(a, f, BOX_R)) return;
    if (d.tools && !(m.tool === 'axe' || m.tool === 'pick')) return this.no(ws, 'Bare hands will not pry a locker. You need a real tool.');
    if (t - (this.hitT.get(a.aid) || 0) < HIT_EVERY) return; this.hitT.set(a.aid, t);
    const dmg = BREAK_HIT[m.tool] || BREAK_HIT.hand;
    f.hp = Math.max(0, f.hp - dmg);
    this.sql.exec('UPDATE fixtures SET hp = ? WHERE id = ?', f.hp, f.id);
    if (f.hp > 0) { this.tell({ k: 'shp', id: f.id, hp: f.hp, max: d.hp, by: a.aid }); return; }
    // it gives: real objects fall where it stood; bag items lie in a heap anyone can pick through for a while
    const objs = this.objs(f.id);
    for (const o of objs) this.sql.exec('UPDATE items SET holder = NULL, x = ?, z = ?, tile = ?, ts = ? WHERE id = ?', r2(f.x + (Math.random() - 0.5) * 0.8), r2(f.z + (Math.random() - 0.5) * 0.8), f.tile || '', t, o.id);
    this.remove(f, 'broken');
    if (slotsUsed(f.inv)) {
      const s = { id: nid(), kind: 'spill', x: f.x, y: f.y, z: f.z, yaw: f.yaw, tile: f.tile, owner: f.owner, oname: f.oname, hp: 0, inv: f.inv, allow: [] };
      this.sql.exec('INSERT INTO fixtures (id, kind, x, y, z, yaw, tile, owner, oname, hp, inv, allow, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', s.id, s.kind, s.x, s.y, s.z, s.yaw, s.tile || '', s.owner, s.oname, 0, JSON.stringify(s.inv), '[]', t);
      this.tell({ k: 'sone', f: this.wire(s) });
    }
    if (objs.length) this.g.pushItems();
    if (f.owner !== a.aid) { const o = this.g.att(f.owner); this.g.witness(t, o ? [a, o] : [a], `${a.name} broke open ${f.oname}'s ${f.kind === 'chest' ? 'crate' : f.kind}`, o ? [a.aid, f.owner] : [a.aid]); }
    this.w.send(ws, { t: 'g', k: 'sno', text: f.kind === 'chest' ? 'The crate splits open.' : 'The locker door bends and gives.' });
  }
  // ---- the owner takes their own thing down (a box empties first) and gets it back
  async down(ws, a, m, t) {
    const f = this.get(m.id); if (!f || f.kind === 'spill') return;
    if (f.owner !== a.aid) return this.no(ws, f.owner === WORLD ? 'That belongs to the garden.' : `That is ${f.oname || 'someone else'}'s.`);
    if (!this.near(a, f, BOX_R)) return this.no(ws, 'Too far away.');
    if (slotsUsed(f.inv, this.objs(f.id).length)) return this.no(ws, 'Empty it first.');
    if (this.slow(a, t, 400)) return;
    this.remove(f, 'down');
    if (this.bag(a)) await this.w.bag.give(a, { [FIXTURES[f.kind].item]: 1 });
    this.refund(ws, { [FIXTURES[f.kind].item]: 1 }, `${FIXTURES[f.kind].name} back in your bag.`);
  }
  // ---- making something at a station: are you within reach of a real one of the right kind?
  stationNear(a, kind) {
    if (a.x == null) return false;
    if (kind === 'bench' && this.garden(a) && Math.hypot(a.x - WORKSHOP.x, a.z - WORKSHOP.z) <= STATION_R) return true; // the shed's bench
    for (const f of this.all()) if (f.kind === kind && this.near(a, f, STATION_R)) return true;
    if (kind === 'bench') { // a workbench built from the building kit (garden builds; planet builds)
      if (this.garden(a) && this.g.bd && this.g.bd.all().some((p) => p.type === 'bench' && Math.hypot(a.x - p.x, a.z - p.z) <= STATION_R)) return true;
      if (a.tile) { try { if (this.sql.exec("SELECT x, z FROM builds WHERE tile = ? AND typ = 'bench'", a.tile).toArray().some((p) => Math.hypot(a.x - p.x, a.z - p.z) <= STATION_R)) return true; } catch { /* no builds table */ } }
    }
    return false;
  }
  async craft(ws, a, m, t) {
    const r = typeof m.r === 'string' ? RECIPE[m.r] : null, ref = typeof m.ref === 'string' ? m.ref.slice(0, 16) : null;
    if (!r) return this.w.send(ws, { t: 'g', k: 'scraft', ref, ok: false, why: 'Nothing like that can be made.' });
    if (t - (this.last.get('c' + a.aid) || 0) < 500) return this.w.send(ws, { t: 'g', k: 'scraft', ref, ok: false, why: 'One thing at a time.' });
    this.last.set('c' + a.aid, t);
    if (r.station && !this.stationNear(a, r.station)) return this.w.send(ws, { t: 'g', k: 'scraft', ref, ok: false, why: `Make this at ${r.station === 'bench' ? 'a workbench' : r.station === 'forge' ? 'a smelter' : 'a campfire'} (stand right by it).` });
    // the server's bag pays and takes what it makes, all at once (a client from before the server bag pays itself)
    if (this.bag(a)) {
      const paid = await this.w.bag.craft(a, r);
      if (!paid) return this.w.send(ws, { t: 'g', k: 'scraft', ref, ok: false, why: 'Not enough in your bag for that.' });
      this.w.send(ws, { t: 'g', k: 'scraft', ref, ok: true, led: 1, paid });
    } else this.w.send(ws, { t: 'g', k: 'scraft', ref, ok: true });
    if (this.g.op) this.g.op.did(a, 'craft', t);
  }
}
