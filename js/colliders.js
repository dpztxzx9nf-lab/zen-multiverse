// Simple physics-friendly colliders on the ground plane (metres): circles and oriented boxes with heights.
// Used now to keep the drifting camera out of solid things; later a walking character (or a physics
// engine such as Rapier) can be fed the same list: each entry maps to a cylinder or box collider.
//   { type: 'circle', x, z, r, h, kind }   { type: 'box', x, z, hw, hd, ry, h, kind }
// kind: 'solid' blocks movement; 'water' blocks walking but not looking; 'soft' (sand) is walkable.
export function createColliders() {
  const list = [];
  const api = {
    list,
    circle(x, z, r, { h = 1, kind = 'solid', name = '' } = {}) { list.push({ type: 'circle', x, z, r, h, kind, name }); return api; },
    box(x, z, hw, hd, { ry = 0, h = 1, kind = 'solid', name = '' } = {}) { list.push({ type: 'box', x, z, hw, hd, ry, h, kind, name }); return api; },
    // signed distance from (x, z) to the nearest blocking collider (negative = inside)
    distance(x, z, kinds = ['solid', 'water']) {
      let best = Infinity;
      for (const c of list) {
        if (!kinds.includes(c.kind)) continue;
        let d;
        if (c.type === 'circle') d = Math.hypot(x - c.x, z - c.z) - c.r;
        else {
          const cs = Math.cos(-c.ry), sn = Math.sin(-c.ry);
          const lx = (x - c.x) * cs - (z - c.z) * sn, lz = (x - c.x) * sn + (z - c.z) * cs;
          const qx = Math.abs(lx) - c.hw, qz = Math.abs(lz) - c.hd;
          d = Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0);
        }
        if (d < best) best = d;
      }
      return best;
    },
    // push a point (THREE.Vector3-like, uses x/z) out of blocking colliders, keeping `radius` clearance
    resolve(p, radius = 0.3, kinds = ['solid', 'water']) {
      for (let it = 0; it < 3; it++) {
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
  };
  return api;
}
