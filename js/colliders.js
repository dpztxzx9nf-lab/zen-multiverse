// Colliders on the ground plane (metres): circles, oriented boxes and convex hulls with heights.
// The walker, the third-person camera and the server's wall check all read the same list.
//   { type: 'circle', x, z, r, h, kind }   { type: 'box', x, z, hw, hd, ry, h, kind }   { type: 'hull', pts, pad, h, kind }
// kind: 'solid' blocks movement; 'water' blocks walking but not looking; 'soft' (sand) is walkable.
// Static solids are NOT hand-authored here: tag the visible mesh with solid() and bake it
// (js/solids-bake.js), so the collider is the mesh's own shape. Hand-made entries must name the
// visible thing that stops you (`cause`) or tools/ci/collision.py fails them as invisible walls.
// top / bottom (optional, world y): the camera passes over anything lower than its eye, under anything higher.
import { shapeDist } from './solids.js';

export function createColliders() {
  const list = [];
  const api = {
    list,
    circle(x, z, r, { h = 1, kind = 'solid', name = '', cause = '' } = {}) { list.push({ type: 'circle', x, z, r, h, kind, name, cause }); return api; },
    box(x, z, hw, hd, { ry = 0, h = 1, kind = 'solid', name = '', cause = '' } = {}) { list.push({ type: 'box', x, z, hw, hd, ry, h, kind, name, cause }); return api; },
    // any signed-distance shape: sdf(x, z) -> metres (negative inside)
    shape(sdf, { h = 1, kind = 'solid', name = '', cause = '' } = {}) { list.push({ type: 'fn', sdf, h, kind, name, cause }); return api; },
    // a ready-made shape (from js/solids-bake.js or js/solids.js)
    add(c) { list.push({ kind: 'solid', h: 1, name: '', ...c }); return api; },
    // signed distance from (x, z) to the nearest blocking collider (negative = inside)
    distance(x, z, kinds = ['solid', 'water']) {
      let best = Infinity;
      for (const c of list) { if (!kinds.includes(c.kind)) continue; const d = shapeDist(c, x, z); if (d < best) best = d; }
      return best;
    },
    // like distance(), but only colliders that reach height y (a camera passes over a low wall, under a roof)
    distanceH(x, z, y, kinds = ['solid']) {
      let best = Infinity;
      for (const c of list) {
        if (!kinds.includes(c.kind) || (c.top ?? c.h) < y || (c.bottom != null && c.bottom > y)) continue;
        const d = shapeDist(c, x, z); if (d < best) best = d;
      }
      return best;
    },
    // people and animals (js/solids.js bodyShape): a named group replaced as a whole each frame by whoever draws them
    setBodies(group, shapes) { for (let i = list.length - 1; i >= 0; i--) if (list[i].group === group) list.splice(i, 1); for (const b of shapes) list.push({ ...b, kind: 'body', group }); return api; },
    remove(name) { for (let i = list.length - 1; i >= 0; i--) if (list[i].name === name) list.splice(i, 1); return api; },
    removeWhere(fn) { for (let i = list.length - 1; i >= 0; i--) if (fn(list[i])) list.splice(i, 1); return api; },
    // push a point (THREE.Vector3-like, uses x/z) out of blocking colliders, keeping `radius` clearance
    resolve(p, radius = 0.3, kinds = ['solid', 'water']) {
      for (let it = 0; it < 4; it++) {
        const d = api.distance(p.x, p.z, kinds);
        if (d >= radius) return p;
        const e = 0.02;
        const gx = api.distance(p.x + e, p.z, kinds) - api.distance(p.x - e, p.z, kinds);
        const gz = api.distance(p.x, p.z + e, kinds) - api.distance(p.x, p.z - e, kinds);
        const gl = Math.hypot(gx, gz) || 1;
        p.x += (gx / gl) * (radius - d); p.z += (gz / gl) * (radius - d);
      }
      return p;
    },
    // resolve along the whole move from (x0, z0) to p in short steps, so a fast or long frame can't skip
    // through a thin wall (a 0.2 m panel is thinner than one sprint frame at a low frame rate)
    sweep(x0, z0, p, radius = 0.3, kinds = ['solid', 'water']) {
      const tx = p.x, tz = p.z, L = Math.hypot(tx - x0, tz - z0), n = Math.max(1, Math.ceil(L / 0.12));
      const q = { x: x0, z: z0 };
      for (let i = 1; i <= n; i++) { q.x += (tx - x0) / n; q.z += (tz - z0) / n; api.resolve(q, radius, kinds); }
      p.x = q.x; p.z = q.z; return p;
    },
  };
  return api;
}
