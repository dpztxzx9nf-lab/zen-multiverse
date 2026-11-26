// "If you can see it, it's real" (Brock, Nov 26): the client half of the collision system.
// A visible thing that should stop you is tagged solid() where its mesh is made; bakeSolids() then turns
// THAT mesh (its real triangles, clipped to the height a body occupies) into convex colliders, so the
// collider can't drift from what you see. Things you can see but walk through on purpose are tagged
// passable(obj, why) (grass, cloth, light). auditSolids() lists every visible mesh with what blocks it,
// and every collider with no visible mesh (an invisible wall); tools/ci/collision.py fails on either.
import * as THREE from 'three';
import { hull2, BODY, shapeDist, cellsFrom } from './solids.js';

export function solid(obj, opts = {}) { obj.userData.phys = { k: 'solid', ...opts }; return obj; }
export function passable(obj, why) { obj.userData.phys = { k: 'pass', why: why || 'passable' }; return obj; }
// moving bodies (people, animals, players) that get out of your way instead of being walls
export function actor(obj, why) { obj.userData.phys = { k: 'actor', why: why || 'actor' }; return obj; }
const physOf = (o) => { for (let p = o; p; p = p.parent) if (p.userData && p.userData.phys) return p.userData.phys; return null; };

const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), M4 = new THREE.Matrix4(), MI = new THREE.Matrix4();
// clip a triangle to the slab y0 <= y <= y1 and push the clipped polygon's points (x, z)
function clipTri(a, b, c, y0, y1, out) {
  let poly = [[a.x, a.y, a.z], [b.x, b.y, b.z], [c.x, c.y, c.z]];
  for (const [lim, keepBelow] of [[y1, true], [y0, false]]) {
    const res = [];
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      const pin = keepBelow ? p[1] <= lim : p[1] >= lim, qin = keepBelow ? q[1] <= lim : q[1] >= lim;
      if (pin) res.push(p);
      if (pin !== qin) { const t = (lim - p[1]) / (q[1] - p[1]); res.push([p[0] + (q[0] - p[0]) * t, lim, p[2] + (q[2] - p[2]) * t]); }
    }
    poly = res; if (!poly.length) return;
  }
  if (out.polys) out.polys.push(poly.map((p) => [p[0], p[2]]));
  for (const p of poly) out.push([p[0], p[2]]);
}
// World-space footprints of one mesh (or one instance) inside the body band above `base`: one convex hull per
// connected piece ("island"), so a merged mesh (consolidated boards, a set of stones, a lattice) keeps its gaps.
export function bandFootprints(mesh, base, inst = -1, band = [0.05, BODY.height]) {
  const g = mesh.geometry, pos = g && g.attributes.position; if (!pos) return [];
  mesh.updateWorldMatrix(true, false);
  if (inst >= 0) { mesh.getMatrixAt(inst, MI); M4.multiplyMatrices(mesh.matrixWorld, MI); } else M4.copy(mesh.matrixWorld);
  const idx = g.index, n = idx ? idx.count : pos.count;
  // islands: triangles that share a (rounded) vertex position belong together
  const key = new Map(), par = [];
  const find = (a) => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
  const kid = (i) => { const k = `${Math.round(pos.getX(i) * 1e3)},${Math.round(pos.getY(i) * 1e3)},${Math.round(pos.getZ(i) * 1e3)}`; let v = key.get(k); if (v === undefined) { v = par.length; par.push(v); key.set(k, v); } return v; };
  const tris = [];
  for (let i = 0; i + 2 < n; i += 3) {
    const ia = idx ? idx.getX(i) : i, ib = idx ? idx.getX(i + 1) : i + 1, ic = idx ? idx.getX(i + 2) : i + 2;
    const a = kid(ia), b = kid(ib), c = kid(ic);
    const ra = find(a), rb = find(b); if (ra !== rb) par[rb] = ra; const rc = find(c), r2 = find(a); if (rc !== r2) par[rc] = r2;
    tris.push(ia, ib, ic, a);
  }
  // first pass: each island's extent (its ground is under its own middle, not the mesh origin: merged meshes live
  // in world coordinates), second pass: clip to that island's band
  const out = new Map();
  for (let t = 0; t < tris.length; t += 4) {
    A.fromBufferAttribute(pos, tris[t]).applyMatrix4(M4); B.fromBufferAttribute(pos, tris[t + 1]).applyMatrix4(M4); C.fromBufferAttribute(pos, tris[t + 2]).applyMatrix4(M4);
    const r = find(tris[t + 3]); let o = out.get(r); if (!o) { out.set(r, o = { pts: [], top: -Infinity, bottom: Infinity, x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity }); o.pts.polys = []; }
    o.top = Math.max(o.top, A.y, B.y, C.y); o.bottom = Math.min(o.bottom, A.y, B.y, C.y);
    o.x0 = Math.min(o.x0, A.x, B.x, C.x); o.x1 = Math.max(o.x1, A.x, B.x, C.x); o.z0 = Math.min(o.z0, A.z, B.z, C.z); o.z1 = Math.max(o.z1, A.z, B.z, C.z);
  }
  for (const o of out.values()) { o.base = typeof base === 'function' ? base((o.x0 + o.x1) / 2, (o.z0 + o.z1) / 2) : base; }
  for (let t = 0; t < tris.length; t += 4) {
    const o = out.get(find(tris[t + 3])), y0 = o.base + band[0], y1 = o.base + band[1];
    A.fromBufferAttribute(pos, tris[t]).applyMatrix4(M4); B.fromBufferAttribute(pos, tris[t + 1]).applyMatrix4(M4); C.fromBufferAttribute(pos, tris[t + 2]).applyMatrix4(M4);
    if (Math.max(A.y, B.y, C.y) < y0 || Math.min(A.y, B.y, C.y) > y1) continue;
    clipTri(A, B, C, y0, y1, o.pts);
  }
  return [...out.values()].map((o) => ({ top: o.top, bottom: o.bottom, base: o.base, polys: o.pts.polys, pts: o.pts.length ? hull2(o.pts) : [] }));
}
// one hull for the whole mesh (kept for callers that want a single outline)
export function bandFootprint(mesh, base, inst = -1, band) {
  const fs = bandFootprints(mesh, base, inst, band); if (!fs.length) return null;
  const pts = []; let top = -Infinity, bottom = Infinity; for (const f of fs) { pts.push(...f.pts); top = Math.max(top, f.top); bottom = Math.min(bottom, f.bottom); }
  return { pts: pts.length ? hull2(pts) : [], top, bottom };
}
// the meshes an object's collision comes from: its own visible meshes (not those of a nested solid/passable),
// and for a level-of-detail switch always the full-detail level, so collision never changes with distance
const meshesUnder = (o, out = []) => {
  const own = o.userData.phys;
  const walk = (n, forced) => {
    if (!forced && !n.visible) return;
    if (n !== o && n.userData && n.userData.phys && n.userData.phys !== own) return;
    const mt = n.material && (Array.isArray(n.material) ? n.material[0] : n.material);
    const glow = mt && mt.transparent && (mt.opacity < 0.6 || mt.depthWrite === false); // light, glow, decals: nothing to bump into
    if ((n.isMesh || n.isInstancedMesh) && !n.isSkinnedMesh && mt && mt.visible !== false && !glow) out.push(n);
    if (n.isLOD && n.levels && n.levels.length) { walk(n.levels[0].object, true); return; }
    for (const k of n.children) walk(k, false);
  };
  walk(o, false);
  return out;
};
function visibleChain(o) { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; }

// Bake every solid-tagged object under root into the collider list (replacing this root's earlier bake).
// Each object becomes one occupancy grid (js/solids.js cellsFrom) of exactly what its meshes have between
// ankle and head height, minus pieces low enough to step over (a floor deck, a log), plus what they enclose.
//   ground(x, z): the ground height there (the band starts at the ground under each piece)
//   solid() opts: { base } fixed base height; { stepOver } override; { name }
export function bakeSolids(root, colliders, { ground = () => 0, tag = root.uuid, cs = 0.1 } = {}) {
  colliders.removeWhere((c) => c.tag === tag);
  root.updateWorldMatrix(true, true);
  const made = [], V = new THREE.Vector3();
  root.traverse((o) => {
    const ph = o.userData && o.userData.phys; if (!ph || ph.k !== 'solid' || !visibleChain(o)) return;
    const wp = o.getWorldPosition(new THREE.Vector3()), base0 = ph.base != null ? ph.base : ground(wp.x, wp.z);
    const baseFn = ph.base != null ? ph.base : ground;
    // a scatter across a whole valley is split by where its pieces are (16 m buckets) so no grid gets enormous;
    // anything smaller stays one grid, so a building's walls always enclose its inside
    const parts = []; let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const m of meshesUnder(o)) {
      const insts = m.isInstancedMesh ? [...Array(m.count).keys()] : [-1];
      for (const ii of insts) {
        for (const f of bandFootprints(m, baseFn, ii)) {
          if (!f.polys.length || f.top < f.base + (ph.stepOver ?? BODY.stepOver)) continue; // low enough to step over
          parts.push(f); for (const q of f.polys) for (const [x, z] of q) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
        }
      }
    }
    const split = x1 - x0 > 64 || z1 - z0 > 64, buckets = new Map();
    for (const f of parts) {
      const p0 = f.polys[0][0], key = split ? Math.floor(p0[0] / 16) + ',' + Math.floor(p0[1] / 16) : '0';
      let b = buckets.get(key); if (!b) buckets.set(key, b = { polys: [], top: -Infinity, bottom: Infinity });
      for (const q of f.polys) b.polys.push(q); b.top = Math.max(b.top, f.top); b.bottom = Math.min(b.bottom, f.bottom);
    }
    for (const b of buckets.values()) {
      const c = cellsFrom(b.polys, cs); if (!c) continue;
      Object.assign(c, { kind: ph.kind || 'solid', top: b.top, bottom: b.bottom, h: b.top - base0, name: ph.name || o.name || 'solid', tag, src: o.uuid });
      colliders.add(c); made.push(c);
    }
  });
  return made;
}
// A movable prop (a crate, a locker, a station someone set down) stays its own rigid body with one simple collider:
// the oriented box around its own solid meshes, measured in the prop's frame (so it turns with it). Never baked
// into the static scenery grids, so moving, opening or removing it is just replacing one entry.
export function bodyBox(o) {
  o.updateWorldMatrix(true, true);
  const inv = new THREE.Matrix4().copy(o.matrixWorld).invert(), bb = new THREE.Box3(), tmp = new THREE.Box3(), m4 = new THREE.Matrix4();
  for (const m of meshesUnder(o)) {
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    tmp.copy(m.geometry.boundingBox).applyMatrix4(m4.multiplyMatrices(inv, m.matrixWorld)); bb.union(tmp);
  }
  if (bb.isEmpty()) return null;
  const sc = new THREE.Vector3(); o.getWorldScale(sc);
  const c = bb.getCenter(new THREE.Vector3()), w = o.localToWorld(c.clone()), e = new THREE.Euler().setFromQuaternion(o.getWorldQuaternion(new THREE.Quaternion()), 'YXZ');
  const bottom = o.localToWorld(new THREE.Vector3(c.x, bb.min.y, c.z)).y, top = o.localToWorld(new THREE.Vector3(c.x, bb.max.y, c.z)).y;
  return { type: 'box', kind: 'solid', x: w.x, z: w.z, hw: ((bb.max.x - bb.min.x) / 2) * sc.x, hd: ((bb.max.z - bb.min.z) / 2) * sc.z, ry: e.y, top, bottom, h: top - bottom, src: o.uuid, name: (o.userData.phys && o.userData.phys.name) || o.name || 'prop' };
}
export function unbake(colliders, tag) { colliders.removeWhere((c) => c.tag === tag); }

// ---- audit: every visible mesh vs the colliders (and the 3D env.solid), and every collider vs the meshes
const pathOf = (o, stop) => { const p = []; for (let q = o; q && q !== stop; q = q.parent) p.unshift(q.name || q.type); return p.join('/').slice(-90); };
export function auditSolids(scene, colliders, { ground = () => 0, env = null, near = null, maxInst = 400 } = {}) {
  scene.updateWorldMatrix(true, true);
  const rows = [], hulls = [];
  // covered: points on the mesh's own surface (inside the body band) sit on or inside something that blocks
  const covered = (f, base) => {
    const P = f.polys.map((p) => { let x = 0, z = 0; for (const q of p) { x += q[0]; z += q[1]; } return [x / p.length, z / p.length]; });
    const step = Math.max(1, Math.floor(P.length / 60)); let hit = 0, n = 0;
    for (let i = 0; i < P.length; i += step) {
      const [x, z] = P[i]; n++;
      const d = colliders ? colliders.distance(x, z, ['solid', 'water']) : Infinity;
      if (d <= 0.12 || (env && env.solid && (env.solid(x, Math.min(f.top - 0.05, base + 1.0), z) || env.solid(x, base + 0.4, z)))) hit++;
    }
    return !n || hit / n >= 0.9;
  };
  scene.traverse((m) => {
    if (!(m.isMesh || m.isInstancedMesh) || !visibleChain(m)) return;
    const ph = physOf(m), mat = Array.isArray(m.material) ? m.material[0] : m.material;
    const row = { path: pathOf(m, scene), phys: ph ? ph.k : '', why: ph && ph.why || '' };
    m.updateWorldMatrix(true, false);
    const box = new THREE.Box3().setFromObject(m), size = box.getSize(new THREE.Vector3()), ctr = box.getCenter(new THREE.Vector3());
    row.at = [+ctr.x.toFixed(1), +ctr.z.toFixed(1)]; row.size = [+size.x.toFixed(1), +size.y.toFixed(1), +size.z.toFixed(1)];
    if (near && Math.hypot(ctr.x - near.x, ctr.z - near.z) > near.r + Math.max(size.x, size.z) / 2) return;
    if (ph && ph.k !== 'solid') { row.cls = ph.k; rows.push(row); return; }
    // shader-instanced geometry: its bounds say nothing about where the copies are, so it must say what it is
    if (m.geometry && m.geometry.isInstancedBufferGeometry && !ph) { row.cls = 'UNTAGGED-SCATTER'; rows.push(row); return; }
    if (m.isSkinnedMesh) { row.cls = 'actor'; row.why = 'skinned body'; rows.push(row); return; }
    if (!mat || mat.visible === false || (mat.transparent && (mat.opacity < 0.6 || mat.depthWrite === false)) || mat.isShaderMaterial && mat.depthWrite === false) { row.cls = 'see-through'; rows.push(row); return; }
    if (Math.max(size.x, size.z) > 80) { row.cls = 'ground/sky'; rows.push(row); return; }
    if (box.max.y < ground(ctr.x, ctr.z) + BODY.stepOver && box.max.y - box.min.y < BODY.stepOver + 0.3) { row.cls = 'low'; rows.push(row); return; }
    const n = m.isInstancedMesh ? m.count : 1;
    if (n > maxInst && !ph) { row.cls = 'UNTAGGED-SCATTER'; row.n = n; rows.push(row); return; }
    let bad = 0, tot = 0, low = 0;
    const stride = Math.max(1, Math.ceil(n / maxInst));
    for (let i = 0; i < n; i += stride) {
      const ii = m.isInstancedMesh ? i : -1;
      for (const f of bandFootprints(m, ground, ii)) {
        const base = f.base;
        if (!f.pts.length || f.top < base + BODY.stepOver) { low++; continue; }
        hulls.push({ pts: f.pts, path: row.path });
        tot++; if (!covered(f, base)) { bad++; if (!row.bad) row.bad = f.pts.slice(0, 3).map((p) => p.map((v) => +v.toFixed(1))); }
      }
    }
    row.cls = tot === 0 ? (low ? 'low' : 'overhead') : bad === 0 ? 'blocked' : (ph ? 'BAKED-BUT-UNCOVERED' : 'WALK-THROUGH');
    if (m.isInstancedMesh) row.n = `${tot - bad}/${tot}`;
    rows.push(row);
  });
  // every blocking collider must come from a mesh (baked: src) or name the visible thing that stops you (cause)
  const ghosts = [];
  for (const c of colliders ? colliders.list : []) {
    if (c.kind !== 'solid' || c.src) continue;
    let x, z; if (c.type === 'hull') [x, z] = c.pts[0]; else if (c.type === 'fn') { x = NaN; z = NaN; } else { x = c.x; z = c.z; }
    const seen = Number.isFinite(x) && hulls.some((h) => shapeDist({ type: 'hull', pts: h.pts }, x, z) < 0.35);
    ghosts.push({ name: c.name, type: c.type, at: Number.isFinite(x) ? [+x.toFixed(1), +z.toFixed(1)] : null, cause: c.cause || '',
      cls: c.cause ? 'hand-made (cause given)' : seen ? 'UNSOURCED (hand-made next to a mesh: bake the mesh instead)' : 'INVISIBLE' });
  }
  const count = (k) => rows.filter((r) => r.cls === k).length;
  const bad = ghosts.filter((g) => /^[A-Z]/.test(g.cls));
  return { rows, colliders: ghosts, fails: rows.filter((r) => /^[A-Z]/.test(r.cls)).length + bad.length,
    summary: { meshes: rows.length, blocked: count('blocked'), walkThrough: count('WALK-THROUGH'), scatter: count('UNTAGGED-SCATTER'), invisible: ghosts.filter((g) => g.cls === 'INVISIBLE').length, unsourced: bad.length } };
}
