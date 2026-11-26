// RETIRED by Xenia (0.2.20): the garden is Xenia's hub frame now and its pieces are ordinary world builds
// (server/src/world.js editBuild; the old rows were copied over once by World.migrateXenia). This class only
// answers clients from before Xenia, telling them to update. grounded / standing stay exported (tests, tools).
//
// Shared building in the home world (tile null, SHARED_HOME): pieces from js/game/g7/pieces.js placed by
// players, kept here and sent to everyone. The server checks what it can see: the piece and material are real,
// the spot is within arm's reach of where it saw you, on open ground (not the pond, sand, beds, the spawn or a
// camp) and inside the garden, at a human pace, under a cap; and it stands: on the ground, or touching a piece
// that does. Taking a piece away is for its builder, and whatever was only held up by it falls (removed for all,
// marked 'fall' so clients drop it as a body). Materials stay in the client's bag, like all inventory today.
import { PIECES } from '../../js/game/g7/pieces.js';
import { lookoutHeight } from '../../js/places.js';
import { coveGround } from '../../js/cove.js';
import { SHARED_HOME } from '../../js/spawn.js';

export const BUILDABLE = ['floor', 'wall', 'beam', 'post', 'ramp', 'block', 'bench'];
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
    this.w = w; this.g = games; this.sql = w.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS garden_builds (id TEXT PRIMARY KEY, type TEXT NOT NULL, mat TEXT NOT NULL, x REAL, y REAL, z REAL, yaw REAL, by TEXT, ts INTEGER);`);
  }
  here(a) { return a && (a.world || '').split('#')[0] === SHARED_HOME && (a.tile || null) === null; }
  // world builds on Xenia's hub frame, in this class's row shape (for the opening walk's workbench check)
  hub() { return this.sql.exec("SELECT id, typ AS type, mat, x, y, z, yaw, aid AS by FROM builds WHERE tile = ''").toArray(); }
  all() { return this.sql.exec('SELECT id, type, mat, x, y, z, yaw, by FROM garden_builds').toArray(); }
  wire(p) { return [p.id, p.type, p.mat, p.x, p.y, p.z, p.yaw, p.by]; }
  hello() { /* pre-Xenia clients get no garden pieces: they see the world builds instead */ }
  tell(m) { for (const o of this.g.present()) if (this.here(o)) { const s = this.g.sock(o.aid); if (s) this.w.send(s, { t: 'g', ...m }); } }
  no(ws, text) { this.w.send(ws, { t: 'g', k: 'bno', text }); }
  // pre-Xenia clients: the garden's own building is gone, say why instead of dropping the request silently
  place(ws, a) { if (this.here(a)) this.no(ws, 'Building moved to Xenia: update the game to build here.'); }
  remove(ws, a) { if (this.here(a)) this.no(ws, 'Building moved to Xenia: update the game to build here.'); }
}
