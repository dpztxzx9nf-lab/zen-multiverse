// Sphere planets with a floating origin. A planet is a real ball of radius R (game metres) that you can
// walk all the way around. The scene never holds far-away coordinates: the surface is cut into cube-sphere
// tiles (~2 km), and the scene is always laid out in the local tangent frame of the tile you are in
// (x = east, y = up, z = east x up). Crossing into a neighbouring tile re-bases the scene on that tile's
// frame (the floating origin), so positions stay within ~1.5 km of 0,0,0 wherever you are on the globe.
// Global positions are unit direction vectors in float64 (nanometre precision at planet scale).
// Tile frames are canonical, so a tile always lays out the same way: player edits are stored per tile.
export const TILE = 2000;
const FACES = [
  { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] }, { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] }, { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] }, { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const tilesPerFace = (R) => Math.max(1, Math.round((Math.PI * R / 2) / TILE));

export function tileOf(R, d) {
  const N = tilesPerFace(R); let f = 0, best = -Infinity;
  FACES.forEach((F, i) => { const k = dot(d, F.n); if (k > best) { best = k; f = i; } });
  const F = FACES[f], a = dot(d, F.u) / best, b = dot(d, F.v) / best;
  // equal-angle cube mapping keeps tiles close to the same size everywhere
  const ua = Math.atan(a) / (Math.PI / 4), va = Math.atan(b) / (Math.PI / 4);
  const i = Math.min(N - 1, Math.max(0, Math.floor((ua + 1) / 2 * N))), j = Math.min(N - 1, Math.max(0, Math.floor((va + 1) / 2 * N)));
  return `${f}:${i}:${j}`;
}
export function tileCenter(R, id) {
  const [f, i, j] = id.split(':').map(Number), N = tilesPerFace(R), F = FACES[f];
  const ua = ((i + 0.5) / N) * 2 - 1, va = ((j + 0.5) / N) * 2 - 1;
  const a = Math.tan(ua * Math.PI / 4), b = Math.tan(va * Math.PI / 4);
  return { dir: norm([F.n[0] + F.u[0] * a + F.v[0] * b, F.n[1] + F.u[1] * a + F.v[1] * b, F.n[2] + F.u[2] * a + F.v[2] * b]), u: F.u };
}
// a tangent frame at direction a: x = east-ish (the face's u axis projected), y = up, z = x cross up
export function makeFrame(R, id) {
  const { dir: a, u } = tileCenter(R, id);
  const e = norm([u[0] - a[0] * dot(u, a), u[1] - a[1] * dot(u, a), u[2] - a[2] * dot(u, a)]);
  const s = cross(e, a);
  const fr = {
    id, R, a, e, s,
    // local (x, z) -> unit direction (exponential map: distance from the tile centre is exact arc length)
    toDir(x, z, out = [0, 0, 0]) {
      const d = Math.hypot(x, z);
      if (d < 1e-9) { out[0] = a[0]; out[1] = a[1]; out[2] = a[2]; return out; }
      const th = d / R, c = Math.cos(th), k = Math.sin(th) / d;
      out[0] = a[0] * c + (e[0] * x + s[0] * z) * k; out[1] = a[1] * c + (e[1] * x + s[1] * z) * k; out[2] = a[2] * c + (e[2] * x + s[2] * z) * k;
      return out;
    },
    // unit direction -> local (x, z)
    fromDir(d) {
      const c = Math.max(-1, Math.min(1, dot(a, d))), th = Math.acos(c);
      const t = [d[0] - a[0] * c, d[1] - a[1] * c, d[2] - a[2] * c], tl = Math.hypot(t[0], t[1], t[2]);
      if (tl < 1e-12) return [0, 0];
      const k = th * R / tl; return [dot(t, e) * k, dot(t, s) * k];
    },
  };
  return fr;
}
// carry a local position + heading from one tile frame to another
export function transfer(from, to, x, z, yaw = 0) {
  const d = from.toDir(x, z), [nx, nz] = to.fromDir(d);
  const d2 = from.toDir(x + Math.sin(yaw), z + Math.cos(yaw)), [ax, az] = to.fromDir(d2);
  return { x: nx, z: nz, yaw: Math.atan2(ax - nx, az - nz) };
}
export const arc = (a, b, R) => Math.acos(Math.max(-1, Math.min(1, dot(a, b)))) * R;
// the tile you are standing in, with hysteresis so walking along a border does not flip back and forth
export function shouldRebase(frame, x, z, margin = 150) {
  const d = frame.toDir(x, z), id = tileOf(frame.R, d);
  if (id === frame.id) return null;
  const c = tileCenter(frame.R, id).dir;
  return arc(frame.a, d, frame.R) - arc(c, d, frame.R) > margin ? id : null;
}
export { norm, dot, cross };
