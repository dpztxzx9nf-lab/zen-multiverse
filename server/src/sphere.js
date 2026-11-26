// Sphere-surface math shared with the client (js/universe/sphere.js). Tile ids are "face:i:j".
// Local (x, z) are metres in the tile's tangent frame; global position is a unit direction (float64).
export const TILE = 2000;
const FACES = [
  { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] }, { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] }, { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] }, { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
import { hubFrame } from '../../js/xenia/xenia.js';
export const TILE_RE = /^[0-5]:\d{1,3}:\d{1,3}$/;
export const tilesPerFace = (R) => Math.max(1, Math.round((Math.PI * R / 2) / TILE));

export function makeFrame(R, id) {
  if (!TILE_RE.test(id) || !(R > 0)) throw new Error('tile');
  const [f, i, j] = id.split(':').map(Number), N = tilesPerFace(R);
  if (f > 5 || i >= N || j >= N) throw new Error('tile');
  const F = FACES[f];
  const ua = ((i + 0.5) / N) * 2 - 1, va = ((j + 0.5) / N) * 2 - 1;
  const a0 = Math.tan(ua * Math.PI / 4), b0 = Math.tan(va * Math.PI / 4);
  const a = norm([F.n[0] + F.u[0] * a0 + F.v[0] * b0, F.n[1] + F.u[1] * a0 + F.v[1] * b0, F.n[2] + F.u[2] * a0 + F.v[2] * b0]);
  const e = norm([F.u[0] - a[0] * dot(F.u, a), F.u[1] - a[1] * dot(F.u, a), F.u[2] - a[2] * dot(F.u, a)]);
  const s = cross(e, a);
  return {
    id, R, a, e, s,
    toDir(x, z, out = [0, 0, 0]) {
      const d = Math.hypot(x, z);
      if (d < 1e-9) { out[0] = a[0]; out[1] = a[1]; out[2] = a[2]; return out; }
      const th = d / R, c = Math.cos(th), k = Math.sin(th) / d;
      out[0] = a[0] * c + (e[0] * x + s[0] * z) * k;
      out[1] = a[1] * c + (e[1] * x + s[1] * z) * k;
      out[2] = a[2] * c + (e[2] * x + s[2] * z) * k;
      return out;
    },
  };
}
export const arc = (a, b, R) => Math.acos(Math.max(-1, Math.min(1, dot(a, b)))) * R;

// The frame a pose is in: its tile, or on Xenia (hub = true: the home world) no tile = the hub frame.
// Elsewhere no tile is a flat hand-built frame (the moon base) with no place on the sphere (null).
export function frameOf(R, tile, hub = false) {
  if (tile) return makeFrame(R, tile);
  return hub ? hubFrame(R) : null;
}
export function dirOf(p, R, hub = false) { const f = frameOf(R, p.tile || null, hub); return f ? f.toDir(p.x, p.z) : null; }
// Great-circle distance between two poses. Same frame uses flat tangent metres; a frame change mid-walk
// (a tile rebase, or Xenia's hub <-> tile hand-over) is measured on the sphere, so it is not a teleport.
export function surfaceDist(a, b, R, hub = false) {
  if (!a || !b) return Infinity;
  const ta = a.tile || null, tb = b.tile || null;
  if (ta === tb || !R || (!hub && (!ta || !tb))) return Math.hypot(a.x - b.x, a.z - b.z);
  try {
    return arc(frameOf(R, ta, hub).toDir(a.x, a.z), frameOf(R, tb, hub).toDir(b.x, b.z), R);
  } catch { return Math.hypot(a.x - b.x, a.z - b.z); }
}

export function tileOk(id, R) {
  if (id == null || id === '') return true;
  if (!TILE_RE.test(id)) return false;
  try { makeFrame(R, id); return true; } catch { return false; }
}
