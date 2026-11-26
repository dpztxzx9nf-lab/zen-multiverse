// Freeform building with snapping pieces that obey a support model (Valheim's WearNTear rules):
// grounded pieces carry full support; each piece loses some per metre (little going up, a lot
// going sideways, all of it sideways for stone unless it rests on supports on both sides, like a
// lintel or an arch). A piece left under its minimum gently gives way: it becomes a real rigid
// body that falls and, if it lands hard, breaks into fragments of its own material.
//   const build = createBuild({ scene, physics, props, env: terrainEnv, steps })
import * as THREE from 'three';
import { obb, setObb, inside, rayObb, topAt, closestPoint, overlap } from './obb.js';
import { SOLID } from './materials.js';

import { PIECES } from './pieces.js'; // pure data (the server checks shared builds against it)
export { PIECES };
const PROP_KIND = { wood: 'beam', stone: 'block', metal: 'plate', ice: 'ice' };

export function createBuild({ scene, physics, props, env, steps, lite, autoCollapse = true, sync = true }) {
  // sync false: don't announce edits to js/net.js (Xenia's hub builds go through net.js edits k:'build' too, server/src/world.js editBuild)
  // autoCollapse false: a shared world where the server decides what falls (it sends the removals)
  const pieces = new Map(); let seq = 0;
  const grid = new Map(); const CELL = 4;
  const cellKey = (x, z) => Math.floor(x / CELL) + ',' + Math.floor(z / CELL);
  function index(p, add) {
    const r = p.box.r, x0 = Math.floor((p.box.c.x - r) / CELL), x1 = Math.floor((p.box.c.x + r) / CELL), z0 = Math.floor((p.box.c.z - r) / CELL), z1 = Math.floor((p.box.c.z + r) / CELL);
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) { const k = i + ',' + j; let s = grid.get(k); if (!s) grid.set(k, (s = new Set())); if (add) s.add(p); else s.delete(p); }
  }
  const near = (x, z, out = new Set()) => { const s = grid.get(cellKey(x, z)); if (s) for (const p of s) out.add(p); return out; };
  const matOf = (key) => {
    const M = props.materials;
    return key === 'wood' ? M.wood() : key === 'stone' ? M.block() : key === 'metal' ? M.metal() : key === 'ice' ? M.ice() : M.block();
  };
  function geometryFor(type, d) {
    if (type === 'bench') {
      const g = new THREE.Group(), top = new THREE.Mesh(new THREE.BoxGeometry(d[0], 0.12, d[2]), null); top.position.y = d[1] / 2 - 0.06; g.add(top);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.1, d[1] - 0.12, 0.1), null); l.position.set(sx * (d[0] / 2 - 0.1), -0.06, sz * (d[2] / 2 - 0.1)); g.add(l); }
      const shelf = new THREE.Mesh(new THREE.BoxGeometry(d[0] - 0.2, 0.05, d[2] - 0.2), null); shelf.position.y = -d[1] / 2 + 0.2; g.add(shelf);
      return g;
    }
    const g = new THREE.BoxGeometry(d[0], d[1], d[2]);
    // metric texture coordinates
    const uv = g.attributes.uv, p = g.attributes.position, n = g.attributes.normal;
    for (let i = 0; i < uv.count; i++) { const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)); let u, v; if (ax > 0.5) { u = p.getZ(i); v = p.getY(i); } else if (ay > 0.5) { u = p.getX(i); v = p.getZ(i); } else { u = p.getX(i); v = p.getY(i); } uv.setXY(i, u * 0.6, v * 0.6); }
    return new THREE.Mesh(g, null);
  }
  function quatFor(type, yaw, pitch = 0) { const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(PIECES[type].pitch || pitch, yaw, 0, 'YXZ')); return q; }
  function place(type, mat, pos, yaw, { id = null, quiet = false } = {}) {
    const P = PIECES[type], d = P.dims, q = quatFor(type, yaw);
    const mesh = geometryFor(type, d); const m = matOf(mat);
    mesh.traverse((o) => { if (o.isMesh) { o.material = m; o.castShadow = !lite; o.receiveShadow = true; } });
    mesh.position.copy(pos); mesh.quaternion.copy(q); scene.add(mesh);
    const box = obb(pos, q, new THREE.Vector3(d[0] / 2, d[1] / 2, d[2] / 2));
    const fx = physics.fixed({ shape: { type: 'box', hx: d[0] / 2, hy: d[1] / 2, hz: d[2] / 2 }, pos, quat: q, friction: (SOLID[mat] || SOLID.wood).friction });
    const p = { id: id || 'b' + Date.now().toString(36) + (++seq), type, mat, yaw, pos: pos.clone(), q, mesh, box, fixed: fx, support: 0, grounded: false };
    pieces.set(p.id, p); index(p, true);
    if (!quiet) { steps && steps.play(SOLID[mat]?.step || 'wood', 1.1); if (sync) try { dispatchEvent(new CustomEvent('zen-edit', { detail: { k: 'build', op: 'place', id: p.id, piece: [type, mat, +pos.x, +pos.y, +pos.z, +yaw] } })); } catch (e) { /* */ } }
    dirty = true; return p;
  }
  // a slow tip in the direction of the kick (the top leads), plus a little wobble
  const tipFor = (k) => { const a = new THREE.Vector3((Math.random() - 0.5) * 0.3, 0, (Math.random() - 0.5) * 0.3); if (k) a.add(new THREE.Vector3(k.z, 0, -k.x).multiplyScalar(1.4)); return a; };
  function removePiece(p, fall = false, kick = null) {
    if (!pieces.has(p.id)) return null;
    pieces.delete(p.id); index(p, false); scene.remove(p.mesh); physics.unfix(p.fixed);
    if (sync) try { dispatchEvent(new CustomEvent('zen-edit', { detail: { k: 'build', op: 'remove', id: p.id } })); } catch (e) { /* */ }
    let body = null;
    if (fall) {
      const d = PIECES[p.type].dims, kind = p.type === 'bench' ? 'crate' : PROP_KIND[p.mat] || 'block';
      body = props.spawn(kind, Math.max(d[0], d[1], d[2]), p.pos.clone(), { quat: p.q, dims: kind === 'crate' ? null : [...d], matKey: p.mat, vel: kick || new THREE.Vector3(0, -0.2, 0), ang: tipFor(kick), touched: true });
      if (body) body.data.fragile = true;
    }
    dirty = true; return body;
  }
  // ---- support (recomputed when something changes; a little delay between collapse waves)
  let dirty = false, waveT = 0;
  const _cp = new THREE.Vector3(), _d = new THREE.Vector3(), _l = new THREE.Vector3();
  function grounded(p) {
    const b = p.box, hy = b.h.y;
    // sample the bottom face: corners and centre a little below
    for (const sx of [-0.9, 0, 0.9]) for (const sz of [-0.9, 0, 0.9]) {
      _cp.set(sx * b.h.x, -hy - 0.06, sz * b.h.z).applyQuaternion(b.q).add(b.c);
      if (env.solid(_cp.x, _cp.y, _cp.z)) return true;
    }
    return false;
  }
  function neighbours(p) { const out = new Set(); const r = p.box.r + 0.2; for (let x = p.box.c.x - r; x <= p.box.c.x + r + 1e-6; x += CELL) for (let z = p.box.c.z - r; z <= p.box.c.z + r + 1e-6; z += CELL) near(x, z, out); near(p.box.c.x + r, p.box.c.z + r, out); out.delete(p); return [...out].filter((n) => overlap(p.box, n.box, 0.05)); }
  function solve() {
    const L = [...pieces.values()];
    for (const p of L) { p.nb = neighbours(p); p.grounded = grounded(p); const S = SOLID[p.mat] || SOLID.wood; p.support = p.grounded ? S.maxS : 0; }
    for (let it = 0; it < 40; it++) {
      let change = 0;
      for (const p of L) {
        if (p.grounded) continue;
        const S = SOLID[p.mat] || SOLID.wood, com = p.box.c; let a = 0; const pts = [];
        for (const n of p.nb) {
          const ns = n.support; if (ns <= 0) continue;
          const dist = Math.max(1, com.distanceTo(n.box.c) / 2); // per connection, like Valheim (longer reaches count more)
          const sp = closestPoint(n.box, com, new THREE.Vector3());
          _l.subVectors(sp, com).applyQuaternion(p.box.qi); const h = p.box.h;
          const below = _l.y < -h.y + 0.08, under = below && Math.abs(_l.x) < h.x - 0.06 && Math.abs(_l.z) < h.z - 0.06;
          // resting on it: little loss; hanging off its side (or balanced on an edge): a lot
          a = Math.max(a, ns * (1 - (under ? S.vLoss : S.hLoss) * dist));
          if (below) pts.push([sp, ns * (1 - S.vLoss * dist)]);
        }
        // resting on supports at both sides (a lintel, an arch, a floor between walls)
        for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
          const A = _cp.subVectors(pts[i][0], com).setY(0), B = _d.subVectors(pts[j][0], com).setY(0);
          if (A.lengthSq() > 1e-4 && B.lengthSq() > 1e-4 && A.angleTo(B) >= (100 * Math.PI) / 180) a = Math.max(a, (pts[i][1] + pts[j][1]) / 2);
        }
        const ns = Math.min(a, S.maxS); if (Math.abs(ns - p.support) > 0.01) { change++; p.support = ns; }
      }
      if (!change) break;
    }
    return L.filter((p) => p.support < (SOLID[p.mat] || SOLID.wood).minS);
  }
  let falling = [];
  function update(dt) {
    waveT -= dt;
    if (dirty && waveT <= 0) {
      dirty = false;
      const weak = (typeof autoCollapse === 'function' ? autoCollapse() : autoCollapse) ? solve() : [];
      if (weak.length) {
        // the weakest few go first, then the structure settles again: a slow, readable collapse
        weak.sort((a, b) => a.support - b.support);
        for (const p of weak.slice(0, 3)) {
          // it tips away from whatever still holds it (a lintel swings down off its last pillar)
          const c = new THREE.Vector3(); let n = 0; for (const q of p.nb || []) if (pieces.has(q.id) && q.support > 0 && !weak.includes(q)) { c.add(q.box.c); n++; }
          const kick = new THREE.Vector3(0, -0.3, 0);
          if (n) { c.multiplyScalar(1 / n).sub(p.box.c).setY(0); if (c.lengthSq() > 1e-4) kick.addScaledVector(c.normalize(), -0.7); }
          const b = removePiece(p, true, kick); if (b) falling.push(b); steps && steps.play(SOLID[p.mat]?.step || 'wood', 0.9);
        }
        waveT = 0.18; dirty = true;
      }
      onChange && onChange();
    }
  }
  let onChange = null;
  // ---- queries for walking and rays
  function top(x, z, yFrom) {
    let best = -Infinity; const s = grid.get(cellKey(x, z)); if (!s) return best;
    for (const p of s) {
      if (inside(p.box, x, yFrom, z, 0.0)) { const t = topAt(p.box, x, z); if (t != null) best = Math.max(best, t); continue; }
      const r = rayObb(p.box, x, yFrom, z, 0, -1, 0, 60); if (r) best = Math.max(best, yFrom - r.t);
    }
    return best;
  }
  function solid(x, y, z) { const s = grid.get(cellKey(x, z)); if (!s) return false; for (const p of s) if (inside(p.box, x, y, z)) return true; return false; }
  function raycast(o, d, maxD) {
    let best = null; const seen = new Set();
    for (let t = 0; t <= maxD; t += CELL * 0.5) near(o.x + d.x * t, o.z + d.z * t, seen);
    for (const p of seen) { const r = rayObb(p.box, o.x, o.y, o.z, d.x, d.y, d.z, maxD); if (r && (!best || r.t < best.t)) best = { t: r.t, normal: r.normal, piece: p, point: new THREE.Vector3(o.x + d.x * r.t, o.y + d.y * r.t, o.z + d.z * r.t) }; }
    return best;
  }
  // ---- snapping: match a corner/edge/face point of the new piece to one of the piece aimed at
  const SNAP = []; for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) for (const z of [-1, 0, 1]) if (x || y || z) SNAP.push([x, y, z]);
  function snap(type, yaw, hit) {
    const d = PIECES[type].dims, h = new THREE.Vector3(d[0] / 2, d[1] / 2, d[2] / 2);
    if (!hit) return null;
    if (hit.piece) {
      const T = hit.piece, q = quatFor(type, T.yaw + yaw);
      const ext = Math.abs(h.x * new THREE.Vector3(1, 0, 0).applyQuaternion(q).dot(hit.normal)) + Math.abs(h.y * new THREE.Vector3(0, 1, 0).applyQuaternion(q).dot(hit.normal)) + Math.abs(h.z * new THREE.Vector3(0, 0, 1).applyQuaternion(q).dot(hit.normal));
      const want = hit.point.clone().addScaledVector(hit.normal, ext);
      let best = null, bd = 1.3;
      const tp = new THREE.Vector3(), cp = new THREE.Vector3(), c = new THREE.Vector3();
      for (const s of SNAP) {
        tp.set(s[0] * T.box.h.x, s[1] * T.box.h.y, s[2] * T.box.h.z).applyQuaternion(T.q).add(T.box.c);
        for (const k of SNAP) {
          cp.set(k[0] * h.x, k[1] * h.y, k[2] * h.z).applyQuaternion(q);
          c.subVectors(tp, cp); const dd = c.distanceTo(want);
          if (dd < bd) { const B = obb(c, q, h); if (overlap(B, T.box, -0.03)) continue; bd = dd; best = c.clone(); }
        }
      }
      if (best) return { pos: best, quat: q, yaw: T.yaw + yaw, snapped: true };
    }
    // free on the ground: bottom resting on the hit point, facing where she looks
    const q = quatFor(type, yaw);
    const pos = hit.point.clone(); const up = PIECES[type].pitch ? Math.sin(-PIECES[type].pitch) * d[2] / 2 : 0;
    pos.y += h.y - 0.06 + up;
    return { pos, quat: q, yaw, snapped: false };
  }
  function fits(type, pos, q) {
    const d = PIECES[type].dims, B = obb(pos, q, new THREE.Vector3(d[0] / 2, d[1] / 2, d[2] / 2));
    const s = new Set(); near(pos.x, pos.z, s); near(pos.x + B.r, pos.z + B.r, s); near(pos.x - B.r, pos.z - B.r, s); near(pos.x + B.r, pos.z - B.r, s); near(pos.x - B.r, pos.z + B.r, s);
    for (const p of s) if (overlap(B, p.box, -0.04)) return false;
    // not buried: the centre must be above the ground
    if (env.solid(pos.x, pos.y + d[1] * 0.25, pos.z) && PIECES[type].dims[1] < 1.5) return false;
    return true;
  }
  // ---- ghost preview
  const ghostMat = new THREE.MeshBasicMaterial({ color: '#9fe6b8', transparent: true, opacity: 0.35, depthWrite: false });
  let ghost = null, ghostType = null;
  function showGhost(type, s, ok) {
    if (!s) { if (ghost) ghost.visible = false; return; }
    if (ghostType !== type) { if (ghost) scene.remove(ghost); ghost = geometryFor(type, PIECES[type].dims); ghost.traverse((o) => { if (o.isMesh) { o.material = ghostMat; o.renderOrder = 5; } }); scene.add(ghost); ghostType = type; }
    ghost.visible = true; ghost.position.copy(s.pos); ghost.quaternion.copy(s.quat);
    ghostMat.color.set(ok ? '#9fe6b8' : '#f0a08a');
  }
  // ---- save
  function save() { return [...pieces.values()].map((p) => [p.type, p.mat, +p.pos.x.toFixed(3), +p.pos.y.toFixed(3), +p.pos.z.toFixed(3), +p.yaw.toFixed(4)]); }
  function load(list) { for (const [t, m, x, y, z, yaw] of list || []) if (PIECES[t]) place(t, m, new THREE.Vector3(x, y, z), yaw, { quiet: true }); dirty = true; }
  function clear() { for (const p of [...pieces.values()]) removePiece(p); }
  const stations = () => [...pieces.values()].filter((p) => PIECES[p.type].station);
  return { PIECES, pieces, place, removePiece, update, top, solid, raycast, snap, fits, showGhost, save, load, clear, stations, solve, set onChange(f) { onChange = f; }, get falling() { return falling; } };
}
