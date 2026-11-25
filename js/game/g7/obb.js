// Oriented boxes: the shape of build pieces (and resting props) for walking, rays and contacts.
//   const b = obb(center, quat, half)   half = Vector3 of half extents
import * as THREE from 'three';
const _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _d = new THREE.Vector3();
export function obb(c, q, h) { const o = { c: c.clone(), q: q.clone(), h: h.clone(), qi: q.clone().invert(), ax: [new THREE.Vector3(1, 0, 0).applyQuaternion(q), new THREE.Vector3(0, 1, 0).applyQuaternion(q), new THREE.Vector3(0, 0, 1).applyQuaternion(q)], r: h.length() }; return o; }
export function setObb(o, c, q) { o.c.copy(c); o.q.copy(q); o.qi.copy(q).invert(); o.ax[0].set(1, 0, 0).applyQuaternion(q); o.ax[1].set(0, 1, 0).applyQuaternion(q); o.ax[2].set(0, 0, 1).applyQuaternion(q); return o; }
export function inside(o, x, y, z, m = 0) { _p.set(x - o.c.x, y - o.c.y, z - o.c.z).applyQuaternion(o.qi); return Math.abs(_p.x) <= o.h.x + m && Math.abs(_p.y) <= o.h.y + m && Math.abs(_p.z) <= o.h.z + m; }
// ray (origin o, dir d) vs box: entry distance or null
export function rayObb(b, ox, oy, oz, dx, dy, dz, maxT = 1e9) {
  _p.set(ox - b.c.x, oy - b.c.y, oz - b.c.z).applyQuaternion(b.qi); _d.set(dx, dy, dz).applyQuaternion(b.qi);
  let t0 = 0, t1 = maxT, nAxis = -1, nSign = 1;
  for (let a = 0; a < 3; a++) {
    const p = _p.getComponent(a), d = _d.getComponent(a), h = b.h.getComponent(a);
    if (Math.abs(d) < 1e-9) { if (p < -h || p > h) return null; continue; }
    let ta = (-h - p) / d, tb = (h - p) / d, s = -1; if (ta > tb) { const t = ta; ta = tb; tb = t; s = 1; }
    if (ta > t0) { t0 = ta; nAxis = a; nSign = s; } if (tb < t1) t1 = tb; if (t0 > t1) return null;
  }
  if (nAxis < 0) return { t: 0, normal: new THREE.Vector3(0, 1, 0) };
  const n = b.ax[nAxis].clone().multiplyScalar(nSign);
  return { t: t0, normal: n };
}
// the top surface of the box straight under/over (x, z), or null
export function topAt(b, x, z) { const r = rayObb(b, x, b.c.y + b.r + 1, z, 0, -1, 0); return r ? b.c.y + b.r + 1 - r.t : null; }
export function closestPoint(b, p, out = new THREE.Vector3()) {
  _p.subVectors(p, b.c).applyQuaternion(b.qi);
  _p.x = Math.max(-b.h.x, Math.min(b.h.x, _p.x)); _p.y = Math.max(-b.h.y, Math.min(b.h.y, _p.y)); _p.z = Math.max(-b.h.z, Math.min(b.h.z, _p.z));
  return out.copy(_p).applyQuaternion(b.q).add(b.c);
}
// separating-axis overlap test, boxes grown by m (negative m = shrunk)
export function overlap(A, B, m = 0) {
  if (A.c.distanceTo(B.c) > A.r + B.r + 2 * Math.abs(m)) return false;
  const T = new THREE.Vector3().subVectors(B.c, A.c);
  const axes = [...A.ax, ...B.ax];
  for (const a of A.ax) for (const b of B.ax) { const c = new THREE.Vector3().crossVectors(a, b); if (c.lengthSq() > 1e-6) axes.push(c.normalize()); }
  for (const L of axes) {
    const ra = (A.h.x + m) * Math.abs(A.ax[0].dot(L)) + (A.h.y + m) * Math.abs(A.ax[1].dot(L)) + (A.h.z + m) * Math.abs(A.ax[2].dot(L));
    const rb = (B.h.x + m) * Math.abs(B.ax[0].dot(L)) + (B.h.y + m) * Math.abs(B.ax[1].dot(L)) + (B.h.z + m) * Math.abs(B.ax[2].dot(L));
    if (Math.abs(T.dot(L)) > ra + rb) return false;
  }
  return true;
}
void _q;
