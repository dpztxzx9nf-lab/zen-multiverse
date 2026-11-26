// "If you can see it, it's real": the shared, dependency-free half of the collision system.
// The client derives every static collider from the visible mesh itself (js/solids-bake.js), and the
// server (server/src/*) checks moves against the SAME shapes through these functions, so the two can
// never disagree. Shapes are plain JSON on the ground plane (metres):
//   { type: 'circle', x, z, r, h }        { type: 'box', x, z, hw, hd, ry, h }
//   { type: 'hull', pts: [[x, z], ...] (convex, any winding), pad, h }   h = top height above its base
//   { type: 'cells', x0, z0, cs, nx, nz, bits }  an occupancy grid: the exact cross-section of a mesh where a
//     body is (every surface it has between ankle and head height, plus whatever those surfaces enclose).
//     bits: Uint8Array (or a base64 string from JSON) of nx * nz cells, row-major from (x0, z0).
export const BODY = { radius: 0.32, height: 1.75, stepOver: 0.35 }; // js/game/move-config.js MOVE

// signed distance on the ground plane from (x, z) to one shape (negative = inside)
export function shapeDist(c, x, z) {
  if (c.type === 'circle') return Math.hypot(x - c.x, z - c.z) - c.r;
  if (c.type === 'fn') return c.sdf(x, z);
  if (c.type === 'hull') return polyDist(c.pts, x, z) - (c.pad || 0);
  if (c.type === 'cells') {
    if (c.ox == null) return cellsDist(c, x, z);
    // a grid baked in a prop's own frame, placed at (ox, oz) and turned by ry (three.js rotation.y)
    const cs = Math.cos(c.ry || 0), sn = Math.sin(c.ry || 0), dx = x - c.ox, dz = z - c.oz;
    return cellsDist(c, dx * cs - dz * sn, dx * sn + dz * cs);
  }
  // into the box's own frame: the inverse of three.js rotation.y (x' = x cos + z sin, z' = -x sin + z cos)
  const cs = Math.cos(c.ry || 0), sn = Math.sin(c.ry || 0), dx = x - c.x, dz = z - c.z;
  const lx = dx * cs - dz * sn, lz = dx * sn + dz * cs;
  const qx = Math.abs(lx) - c.hw, qz = Math.abs(lz) - c.hd;
  return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0);
}

// signed distance to a convex polygon (exact outside, exact inside)
export function polyDist(pts, x, z) {
  const n = pts.length;
  if (n === 1) return Math.hypot(x - pts[0][0], z - pts[0][1]);
  let best = Infinity, inside = n > 2;
  let sgn = 0;
  for (let i = 0; i < n; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % n];
    const ex = bx - ax, ez = bz - az, wx = x - ax, wz = z - az;
    const L = ex * ex + ez * ez || 1e-12, t = Math.max(0, Math.min(1, (wx * ex + wz * ez) / L));
    const d = Math.hypot(wx - ex * t, wz - ez * t); if (d < best) best = d;
    const cr = ex * wz - ez * wx;
    if (cr !== 0) { const s = Math.sign(cr); if (sgn === 0) sgn = s; else if (s !== sgn) inside = false; }
  }
  return inside ? -best : best;
}

// 2D convex hull (monotone chain), CCW, no collinear points
export function hull2(points) {
  const p = points.map((q) => [+q[0].toFixed(4), +q[1].toFixed(4)]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const u = []; for (const q of p) { if (u.length && u[u.length - 1][0] === q[0] && u[u.length - 1][1] === q[1]) continue; u.push(q); }
  if (u.length < 3) return u;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], hi = [];
  for (const q of u) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = u.length - 1; i >= 0; i--) { const q = u[i]; while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop(); hi.push(q); }
  lo.pop(); hi.pop(); return lo.concat(hi);
}

// nearest blocking distance over a list of shapes
export function nearest(shapes, x, z, kinds = ['solid']) {
  let best = Infinity;
  for (const c of shapes) { if (c.kind && !kinds.includes(c.kind)) continue; const d = shapeDist(c, x, z); if (d < best) best = d; }
  return best;
}

// Does a move from a to b pass through (or end deep inside) a solid? The server's wall check: the client
// keeps BODY.radius of clearance, so anything closer than `slack` past the surface is a real pass-through.
// does a step from a to b pass into something solid? The centre may come no closer than `clear` to a solid
// (a body is at least that thick, so thin walls and hairline gaps between stones still count). A real client
// keeps BODY.radius away, so it never trips this; a step that starts that close is only refused if it goes deeper.
export function crossesSolid(shapes, a, b, clear = 0.1) {
  const L = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(L / 0.04));
  let prev = nearest(shapes, a.x, a.z);
  for (let i = 1; i <= n; i++) {
    const k = i / n, d = nearest(shapes, a.x + (b.x - a.x) * k, a.z + (b.z - a.z) * k);
    if (d < clear && d < prev - 1e-6) return true;
    prev = Math.min(prev, d);
  }
  return false;
}

// Rotate/translate local shapes (an object's own frame) into the world frame.
export function placeShapes(shapes, ox, oz, ry = 0) {
  const c = Math.cos(ry), s = Math.sin(ry);
  const tx = (x, z) => [ox + x * c + z * s, oz - x * s + z * c]; // three.js rotation.y convention
  return shapes.map((sh) => {
    if (sh.type === 'circle') { const [x, z] = tx(sh.x, sh.z); return { ...sh, x, z }; }
    if (sh.type === 'box') { const [x, z] = tx(sh.x, sh.z); return { ...sh, x, z, ry: (sh.ry || 0) + ry }; }
    if (sh.type === 'hull') return { ...sh, pts: sh.pts.map(([x, z]) => tx(x, z)) };
    return sh;
  });
}

// ---- occupancy grids
const R_SCAN = 1.2; // metres searched around a point; farther than this only the grid's bounds count
export function cellBits(c) {
  if (c.bits instanceof Uint8Array) return c.bits;
  if (typeof c.bits === 'string') { // base64 from JSON (the server, js/solids-data.js); pack: 1 = one bit per cell
    const bin = typeof atob === 'function' ? atob(c.bits) : Buffer.from(c.bits, 'base64').toString('binary');
    let u;
    if (c.pack) { u = new Uint8Array(c.nx * c.nz); for (let i = 0; i < u.length; i++) u[i] = (bin.charCodeAt(i >> 3) >> (i & 7)) & 1; }
    else { u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); }
    c.bits = u; delete c.pack; return u;
  }
  return new Uint8Array(0);
}
export function cellsDist(c, x, z) {
  const { x0, z0, cs, nx, nz } = c, x1 = x0 + nx * cs, z1 = z0 + nz * cs;
  const bx = Math.max(x0 - x, 0, x - x1), bz = Math.max(z0 - z, 0, z - z1), bd = Math.hypot(bx, bz);
  if (bd > R_SCAN * 0.5) return bd; // far: the bounds are a lower bound and that's all a walker needs
  const bits = cellBits(c), h = cs * 0.5;
  const i0 = Math.max(0, Math.floor((x - R_SCAN - x0) / cs)), i1 = Math.min(nx - 1, Math.floor((x + R_SCAN - x0) / cs));
  const j0 = Math.max(0, Math.floor((z - R_SCAN - z0) / cs)), j1 = Math.min(nz - 1, Math.floor((z + R_SCAN - z0) / cs));
  let best = Infinity, inside = false;
  const ci = Math.floor((x - x0) / cs), cj = Math.floor((z - z0) / cs);
  if (ci >= 0 && cj >= 0 && ci < nx && cj < nz && bits[cj * nx + ci]) inside = true;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const on = !!bits[j * nx + i]; if (on === inside) continue;
    // distance to that cell's square
    const cx = x0 + (i + 0.5) * cs, cz = z0 + (j + 0.5) * cs;
    const qx = Math.abs(x - cx) - h, qz = Math.abs(z - cz) - h;
    const d = Math.hypot(Math.max(qx, 0), Math.max(qz, 0)); if (d < best) best = d;
  }
  if (inside) return best === Infinity ? -R_SCAN : -best;
  return best === Infinity ? Math.max(bd, R_SCAN) : best;
}
// Build a grid from cross-section polygons ([[x, z], ...] each: a clipped triangle seen from above; a vertical
// wall gives a thin sliver, a table top gives an area). Enclosed space is filled: you can't stand inside a
// closed box, and a wall can't leak through a diagonal gap (the outside flood is 4-connected).
export function cellsFrom(polys, cs = 0.1, pad = 1) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const p of polys) for (const [x, z] of p) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
  if (!Number.isFinite(x0)) return null;
  x0 = Math.floor(x0 / cs) * cs - pad * cs; z0 = Math.floor(z0 / cs) * cs - pad * cs;
  const nx = Math.ceil((x1 - x0) / cs) + 1 + pad, nz = Math.ceil((z1 - z0) / cs) + 1 + pad;
  if (nx * nz > 4e6) return null;
  const bits = new Uint8Array(nx * nz);
  const mark = (x, z) => { const i = Math.floor((x - x0) / cs), j = Math.floor((z - z0) / cs); if (i >= 0 && j >= 0 && i < nx && j < nz) bits[j * nx + i] = 1; };
  const st = cs / 3;
  for (const p of polys) {
    // fan triangles: sample edges and interior densely enough that no cell the polygon crosses is missed
    for (let k = 1; k + 1 < p.length || k === 1; k++) {
      const a = p[0], b = p[Math.min(k, p.length - 1)], c = p[Math.min(k + 1, p.length - 1)];
      const L = Math.max(Math.hypot(b[0] - a[0], b[1] - a[1]), Math.hypot(c[0] - a[0], c[1] - a[1]), Math.hypot(c[0] - b[0], c[1] - b[1]));
      const n = Math.max(1, Math.ceil(L / st));
      for (let u = 0; u <= n; u++) for (let v = 0; v <= n - u; v++) { const s1 = u / n, s2 = v / n; mark(a[0] + (b[0] - a[0]) * s1 + (c[0] - a[0]) * s2, a[1] + (b[1] - a[1]) * s1 + (c[1] - a[1]) * s2); }
      if (p.length < 3) break;
    }
  }
  // fill what the surfaces enclose: flood the outside from the border (4-connected), the rest is solid
  const out = new Uint8Array(nx * nz), q = [];
  for (let i = 0; i < nx; i++) { q.push(i, (nz - 1) * nx + i); }
  for (let j = 0; j < nz; j++) { q.push(j * nx, j * nx + nx - 1); }
  while (q.length) {
    const k = q.pop(); if (out[k] || bits[k]) continue; out[k] = 1;
    const i = k % nx, j = (k - i) / nx;
    if (i > 0) q.push(k - 1); if (i < nx - 1) q.push(k + 1); if (j > 0) q.push(k - nx); if (j < nz - 1) q.push(k + nx);
  }
  let n = 0; for (let k = 0; k < bits.length; k++) { if (!out[k]) bits[k] = 1; if (bits[k]) n++; }
  if (!n) return null;
  return { type: 'cells', x0, z0, cs, nx, nz, bits, n };
}
export function cellsToJSON(c) {
  const b = cellBits(c), n = Math.ceil(b.length / 8), p = new Uint8Array(n);
  for (let i = 0; i < b.length; i++) if (b[i]) p[i >> 3] |= 1 << (i & 7);
  let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(p[i]);
  const o = { ...c, pack: 1, bits: typeof btoa === 'function' ? btoa(s) : Buffer.from(s, 'binary').toString('base64') };
  for (const k of ['x0', 'z0', 'cs', 'top', 'bottom', 'h', 'ox', 'oz', 'ry']) if (typeof o[k] === 'number') o[k] = Math.round(o[k] * 1e4) / 1e4;
  return o;
}

// ---- the hidden vault (js/compete.js draws it from these, server/src/games.js refuses steps through them):
// one definition, so the wall you see is exactly the wall both sides enforce
export const VAULT = { R: 3.3, n: 14, door: 0.24, block: { w: 1.45, h: 2.1, d: 0.55 }, slab: { w: 0.4, h: 2.1, d: 1.6 }, lock: { x: 3.6, z: 1.2, s: 0.3, y: 1.0 }, plate: { x: 5, r: 1.1 } };
// the stone blocks of the ring, in vault-local coords; `back` ones are where a tunnel can be dug
export function vaultBlocks() {
  const out = [];
  for (let i = 0; i < VAULT.n; i++) {
    const a = (i / VAULT.n) * Math.PI * 2;
    if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < VAULT.door) continue; // doorway faces +x
    const back = Math.abs(Math.atan2(Math.sin(a - Math.PI), Math.cos(a - Math.PI))) < VAULT.door;
    out.push({ x: Math.cos(a) * VAULT.R, z: Math.sin(a) * VAULT.R, ry: -a + Math.PI / 2, back });
  }
  return out;
}
// solid shapes (vault-local, place with placeShapes): walls (minus the back ones once tunnelled), the slab while it
// still blocks a body, and the lock block that sticks out by the door
export function vaultShapes({ tunnel = false, slabShut = true } = {}) {
  const B = VAULT.block, s = [];
  for (const b of vaultBlocks()) if (!(tunnel && b.back)) s.push({ type: 'box', kind: 'solid', x: b.x, z: b.z, hw: B.w / 2, hd: B.d / 2, ry: b.ry, h: B.h, name: 'vault-wall' });
  if (slabShut) s.push({ type: 'box', kind: 'solid', x: VAULT.R, z: 0, hw: VAULT.slab.w / 2, hd: VAULT.slab.d / 2, ry: 0, h: VAULT.slab.h, name: 'vault-slab' });
  s.push({ type: 'box', kind: 'solid', x: VAULT.lock.x, z: VAULT.lock.z, hw: VAULT.lock.s / 2, hd: VAULT.lock.s / 2, ry: 0, h: VAULT.lock.y + VAULT.lock.s / 2, y0: VAULT.lock.y - VAULT.lock.s / 2, name: 'vault-lock' });
  return s;
}

// ---- what the server checks a step against: only shapes that reach the mover's body band at her height y
// (feet + step-over .. head). Something she stands on, or a roof above her head, doesn't block her.
export function inBand(c, y) {
  if (y == null || c.top == null) return true;
  return c.top > y + BODY.stepOver && (c.bottom == null || c.bottom < y + BODY.height);
}
export function stepBlocked(shapes, a, b, y, clear = 0.1) {
  const S = shapes.filter((c) => (c.kind || 'solid') === 'solid' && inBand(c, y));
  return S.length ? crossesSolid(S, a, b, clear) : false;
}

// ---- bodies: people and animals are upright capsules; on the ground plane a circle of their radius
export const BODY_R = { person: BODY.radius, hare: 0.16, fox: 0.22, deer: 0.4 };
export const BODY_H = { person: BODY.height, hare: 0.35, fox: 0.5, deer: 1.5 };
export function bodyShape(kind, x, z, y = 0, extra = {}) {
  const r = BODY_R[kind] ?? 0.3, h = BODY_H[kind] ?? 1;
  return { type: 'circle', kind: 'body', who: kind, x, z, r, h, bottom: y, top: y + h, ...extra };
}
// a body in your way only blocks so long: pressed against someone for longer than this, you slip past (nobody can
// wall someone in, or hold a doorway against them)
export const BODY_YIELD_MS = 2000;
// do two bodies block each other? (a deeper step between two people / a person and an animal); clear: how close
// centres may come (the client keeps the full sum of radii, the server allows lag)
export function bodyStepBlocked(bodies, a, b, y, slack = 0.3) {
  const S = bodies.filter((c) => inBand({ top: c.top, bottom: c.bottom }, y)).map((c) => ({ ...c, kind: 'solid', r: Math.max(0.01, c.r + BODY.radius - slack) }));
  return S.length ? crossesSolid(S, a, b, 0) : false;
}
