// Shared building in the home world (tile null, SHARED_HOME): pieces from js/game/g7/pieces.js placed by
// players, kept here and sent to everyone. The server checks what it can see: the piece and material are real,
// the spot is within arm's reach of where it saw you, on open ground (not the pond, sand, beds, the spawn or a
// camp) and inside the garden, at a human pace, under a cap; and it stands: on the ground, or touching a piece
// that does. Taking a piece away is for its builder, and whatever was only held up by it falls (removed for all,
// marked 'fall' so clients drop it as a body). Materials stay in the client's bag, like all inventory today.
import { PIECES } from '../../js/game/g7/pieces.js';
import { lookoutHeight } from '../../js/places.js';
import { coveGround } from '../../js/cove.js';
import { gardenBlock } from './garden.js';
import { SHARED_HOME, WORLD_SPAWN } from '../../js/spawn.js';

export const BUILDABLE = ['floor', 'wall', 'beam', 'post', 'ramp', 'block', 'bench'];
const REACH = 7.5, UP = 6, EVERY = 250, PER = 150, TOTAL = 800, GARDEN = { x: 1.5, z: -0.5, r: 54 };
const r2 = (v) => Math.round(v * 1000) / 1000;
export const groundAt = (x, z) => { const c = coveGround(x, z); return c != null ? c : lookoutHeight(x, z); };
const half = (t) => { const d = PIECES[t].dims; return { x: d[0] / 2, y: d[1] / 2, z: d[2] / 2, r: Math.hypot(d[0], d[1], d[2]) / 2 }; };
// the piece's lowest point: boxes turn only about y (a ramp also pitches)
const bottom = (p) => { const h = half(p.type), pitch = PIECES[p.type].pitch || 0; return p.y - (h.y * Math.cos(pitch) + h.z * Math.abs(Math.sin(pitch))); };
export function grounded(p) {
  const h = half(p.type), c = Math.cos(p.yaw), s = Math.sin(p.yaw); let g = -Infinity;
  for (const [ax, az] of [[0, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]]) { const lx = ax * h.x * 0.9, lz = az * h.z * 0.9; g = Math.max(g, groundAt(p.x + lx * c + lz * s, p.z - lx * s + lz * c)); }
  return bottom(p) <= g + 0.15; // the client sets free pieces 6 cm into the ground; a floor is 20 cm thick
}
// touching: bounding spheres overlap (a little generous; the client's snapping makes real contacts)
export const touching = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) <= half(a.type).r + half(b.type).r + 0.05;
// what still stands: everything reachable through touching pieces from a grounded one
export function standing(list) {
  const up = new Set(), q = list.filter(grounded); q.forEach((p) => up.add(p.id));
  while (q.length) { const p = q.pop(); for (const o of list) if (!up.has(o.id) && touching(p, o)) { up.add(o.id); q.push(o); } }
  return up;
}

export class Builds {
  constructor(w, games) {
    this.w = w; this.g = games; this.sql = w.sql; this.last = new Map();
    this.sql.exec(`CREATE TABLE IF NOT EXISTS builds (id TEXT PRIMARY KEY, type TEXT NOT NULL, mat TEXT NOT NULL, x REAL, y REAL, z REAL, yaw REAL, by TEXT, ts INTEGER);`);
  }
  here(a) { return a && (a.world || '').split('#')[0] === SHARED_HOME && (a.tile || null) === null; }
  all() { return this.sql.exec('SELECT id, type, mat, x, y, z, yaw, by FROM builds').toArray(); }
  wire(p) { return [p.id, p.type, p.mat, p.x, p.y, p.z, p.yaw, p.by]; }
  hello(ws, a) { if (this.here(a)) this.w.send(ws, { t: 'g', k: 'builds', list: this.all().map((p) => this.wire(p)) }); }
  tell(m) { for (const o of this.g.present()) if (this.here(o)) { const s = this.g.sock(o.aid); if (s) this.w.send(s, { t: 'g', ...m }); } }
  no(ws, text) { this.w.send(ws, { t: 'g', k: 'bno', text }); }
  place(ws, a, m, t) {
    if (!this.here(a) || a.x == null) return;
    const type = m.type, mat = m.mat;
    if (!BUILDABLE.includes(type) || !PIECES[type] || typeof mat !== 'string' || !PIECES[type].mats[mat]) return this.w.strike(ws, a, 1, 'bplace-kind');
    const x = +m.x, y = +m.y, z = +m.z, yaw = +m.yaw;
    if (![x, y, z, yaw].every(Number.isFinite) || Math.abs(yaw) > 20) return this.w.strike(ws, a, 1, 'bplace-num');
    if (t - (this.last.get(a.aid) || 0) < EVERY) return; this.last.set(a.aid, t);
    if (Math.hypot(x - a.x, z - a.z) > REACH || Math.abs(y - (a.y || 0)) > UP) return this.no(ws, 'Too far to build there.');
    if (Math.hypot(x - GARDEN.x, z - GARDEN.z) > GARDEN.r) return this.no(ws, 'Build inside the garden.');
    if (Math.hypot(x - WORLD_SPAWN.x, z - WORLD_SPAWN.z) < 4) return this.no(ws, 'Keep the arrival stone clear.');
    const why = gardenBlock(x, z, 0.2); if (why) return this.no(ws, `Not on the ${why}.`);
    if (y < -6 || y > 14) return this.no(ws, 'Not there.');
    const p = { id: 'b' + t.toString(36) + Math.floor(Math.random() * 1e6).toString(36), type, mat, x: r2(x), y: r2(y), z: r2(z), yaw: r2(yaw), by: a.aid };
    const list = this.all();
    if (list.length >= TOTAL) return this.no(ws, 'The garden has all the building it can take for now.');
    if (list.filter((o) => o.by === a.aid).length >= PER) return this.no(ws, `You have ${PER} pieces up already. Take some down first.`);
    if (list.some((o) => Math.hypot(o.x - p.x, o.y - p.y, o.z - p.z) < 0.15 && o.type === p.type)) return this.no(ws, 'There is already a piece there.');
    if (!grounded(p) && !list.some((o) => touching(p, o) && standing(list).has(o.id))) return this.no(ws, 'It needs to rest on the ground or on something that does.');
    this.sql.exec('INSERT INTO builds (id, type, mat, x, y, z, yaw, by, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', p.id, p.type, p.mat, p.x, p.y, p.z, p.yaw, p.by, t);
    this.tell({ k: 'bput', p: this.wire(p), by: a.aid, ref: typeof m.ref === 'string' ? m.ref.slice(0, 24) : null });
  }
  remove(ws, a, m, t) {
    if (!this.here(a) || a.x == null || typeof m.id !== 'string') return;
    const p = this.sql.exec('SELECT id, type, mat, x, y, z, yaw, by FROM builds WHERE id = ?', m.id).toArray()[0]; if (!p) return;
    if (p.by !== a.aid) return this.no(ws, 'Someone else built that.');
    if (Math.hypot(p.x - a.x, p.z - a.z) > REACH + 1) return this.no(ws, 'Too far away.');
    this.sql.exec('DELETE FROM builds WHERE id = ?', p.id);
    const rest = this.all(), up = standing(rest), fall = rest.filter((o) => !up.has(o.id)).map((o) => o.id);
    for (const id of fall) this.sql.exec('DELETE FROM builds WHERE id = ?', id);
    this.w.send(ws, { t: 'g', k: 'grant', why: 'node', give: { ...PIECES[p.type].mats[p.mat] }, text: 'Taken back down.' });
    this.tell({ k: 'bdel', ids: [p.id], fall });
  }
}
