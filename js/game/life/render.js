// Drawing the peoples cheaply: every building, ruin stone and person is one instance in a handful of
// InstancedMeshes (about eight draw calls for every settlement in view). Near people get a body and a
// head; people further off share a 4-sided stand-in (the crowd impostor), and past that only the
// settlement's buildings remain while its people are simulated as numbers.
import * as THREE from 'three';
import { rng, hash } from '../names.js';

const MAT_COL = { timber: '#7d5f43', 'cut stone': '#a59c8e', fieldstone: '#867d71', 'salt brick': '#d9d1c2', 'packed ice': '#c3d6e0', 'mud brick': '#94704f' };
const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(), tmpP = new THREE.Vector3(), tmpE = new THREE.Euler(), tmpC = new THREE.Color();

function IM(geo, mat, n, name) { const m = new THREE.InstancedMesh(geo, mat, n); m.name = name; m.count = 0; m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.setColorAt(0, tmpC.set('#fff')); return m; }

export function createLifeRender(scene, { lite, shadows }) {
  const cap = lite ? 700 : 1800;
  const std = (o = {}) => new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0, ...o });
  const box = new THREE.BoxGeometry(1, 1, 1); box.translate(0, 0.5, 0);
  const cone4 = new THREE.ConeGeometry(0.75, 1, 4, 1); cone4.rotateY(Math.PI / 4); cone4.translate(0, 0.5, 0);
  const tent = new THREE.ConeGeometry(1, 1, 7, 1, true); tent.translate(0, 0.5, 0);
  const dome = new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  const col = new THREE.CylinderGeometry(0.5, 0.55, 1, 7); col.translate(0, 0.5, 0);
  const L = {
    walls: IM(box, std(), cap, 'life-walls'), roofs: IM(cone4, std({ roughness: 0.8 }), cap, 'life-roofs'), tents: IM(tent, std({ side: THREE.DoubleSide }), 200, 'life-tents'),
    domes: IM(dome, std({ roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.55 }), 200, 'life-domes'), cols: IM(col, std(), 600, 'life-cols'),
  };
  const body = new THREE.CylinderGeometry(0.17, 0.25, 1, 7); body.translate(0, 0.5, 0);
  const head = new THREE.IcosahedronGeometry(0.5, 1);
  const stand = new THREE.CylinderGeometry(0.2, 0.2, 1, 4, 1); stand.translate(0, 0.5, 0);
  const NP = lite ? 40 : 90;
  const C = { body: IM(body, std(), NP, 'life-body'), head: IM(head, std({ roughness: 0.7 }), NP, 'life-head'), far: IM(stand, std(), NP, 'life-far') };
  for (const m of [...Object.values(L), ...Object.values(C)]) { m.castShadow = shadows && m !== L.domes; m.receiveShadow = false; scene.add(m); }

  // ---- buildings and ruins (rebuilt when the set of places in range changes)
  function put(m, x, y, z, sx, sy, sz, ry, color, rx = 0, rz = 0) {
    if (m.count >= m.instanceMatrix.count) return;
    tmpE.set(rx, ry, rz); tmpQ.setFromEuler(tmpE); tmpM.compose(tmpP.set(x, y, z), tmpQ, tmpS.set(sx, sy, sz));
    m.setMatrixAt(m.count, tmpM); m.setColorAt(m.count, tmpC.set(color)); m.count++;
  }
  // a settlement's plan: deterministic from its seed, shaped by tier, culture and the ground
  function layout(st, P, ground) {
    const r = rng(hash(st.seed, 0xb1d)), c = P.culture, out = [];
    const wall = new THREE.Color(MAT_COL[c.material] || '#8a7a66'), roof = new THREE.Color().setHSL(c.hue, 0.28, 0.32);
    const n = st.tier === 'camp' ? 3 + Math.floor(r() * 3) : st.tier === 'village' ? 6 + Math.floor(r() * 8) : st.tier === 'sealed' ? 3 + Math.floor(r() * 3) : 18 + Math.floor(r() * 18);
    const R0 = st.tier === 'camp' ? 7 : st.tier === 'village' ? 12 : 16;
    for (let i = 0; i < n; i++) {
      const a = i * 2.39996 + r() * 0.4, d = R0 * Math.sqrt((i + 1) / n) * (st.tier === 'city' ? 3.2 : 2) + 4;
      const x = st.x + Math.cos(a) * d, z = st.z + Math.sin(a) * d;
      const y = ground(x, z), slope = Math.abs(ground(x + 3, z) - y) + Math.abs(ground(x, z + 3) - y);
      if (slope > 2.2 || (st.sea != null && y < st.sea + 0.5)) continue;
      const w = (st.tier === 'city' ? 5 : 3.6) + r() * 2.5, dd = w * (0.8 + r() * 0.5), h = st.tier === 'city' ? 3.5 + r() * 5 * (1 + P.tech * 0.15) : 2.4 + r() * 0.9;
      out.push({ x, y, z, w, d: dd, h, ry: st.tier === 'city' ? Math.round(a / 1.5708) * 1.5708 : a, wall: wall.getHex(), roof: roof.clone().offsetHSL(0, 0, (r() - 0.5) * 0.08).getHex() });
    }
    return out;
  }
  let builtKey = '';
  function rebuild(places, ground, key) {
    if (key === builtKey) return; builtKey = key;
    for (const m of Object.values(L)) m.count = 0;
    for (const { st, P } of places.settlements) {
      const c = P.culture;
      for (const b of layout(st, P, ground)) {
        if (st.tier === 'camp') { put(L.tents, b.x, b.y - 0.1, b.z, b.w * 0.55, 2.4, b.w * 0.55, b.ry, b.roof); continue; }
        if (st.tier === 'sealed') { put(L.domes, b.x, b.y - 0.3, b.z, b.w * 1.6, b.w * 1.1, b.w * 1.6, 0, '#cfe0ea'); put(L.walls, b.x, b.y, b.z, b.w, 2.2, b.d, b.ry, b.wall); continue; }
        put(L.walls, b.x, b.y - 0.4, b.z, b.w, b.h + 0.4, b.d, b.ry, b.wall);
        if (c.roof > 0.66) put(L.roofs, b.x, b.y + b.h, b.z, b.w * 1.42, 1.2 + c.roof * 1.6, b.d * 1.42, b.ry, b.roof);
        else if (c.roof > 0.33) put(L.domes, b.x, b.y + b.h - 0.2, b.z, b.w * 0.55, b.w * 0.4, b.d * 0.55, 0, b.roof);
        else put(L.walls, b.x, b.y + b.h, b.z, b.w + 0.3, 0.25, b.d + 0.3, b.ry, b.roof);
      }
      // the heart of the place: a well or hearth where the market is
      const y = ground(st.x, st.z);
      put(L.cols, st.x, y - 0.2, st.z, 1.8, 0.9, 1.8, 0, st.tier === 'camp' ? '#3b2f28' : '#7a7368');
      if (st.tier === 'city') for (let k = 0; k < 28; k++) { const a = k / 28 * 6.283, x = st.x + Math.cos(a) * 62, z = st.z + Math.sin(a) * 62, yy = ground(x, z); if (st.sea == null || yy > st.sea + 0.3) put(L.walls, x, yy - 0.5, z, 1.4, 4.5, 14, -a, '#7d766b'); }
    }
    for (const ru of places.ruins) {
      const r = rng(hash(ru.seed, 0x7a1)); const wall = new THREE.Color(MAT_COL[ru.culture.material] || '#8a7a66').multiplyScalar(0.72).getHex();
      const n = 8 + Math.floor(r() * 10) + Math.floor(ru.tech * 3);
      for (let i = 0; i < n; i++) {
        const a = r() * 6.283, d = 4 + r() * (14 + ru.tech * 6), x = ru.x + Math.cos(a) * d, z = ru.z + Math.sin(a) * d, y = ground(x, z);
        if (ru.sea != null && y < ru.sea + 0.3) continue;
        const h = 0.3 + r() * r() * (2 + ru.tech);
        if (r() < 0.3 && ru.tech >= 1) put(L.cols, x, y - 0.3, z, 0.55, r() < 0.5 ? h + 1 : 4, 0.55, 0, wall, r() < 0.4 ? 1.5 : 0, 0);
        else put(L.walls, x, y - 0.3, z, 0.6 + r() * 0.5, h, 2 + r() * 5, a + 1.57, wall, (r() - 0.5) * 0.15, (r() - 0.5) * 0.2);
      }
      // the stone that remembers: a carved stele beside the old centre
      const y = ground(ru.x + 2, ru.z);
      put(L.walls, ru.x + 2, y - 0.2, ru.z, 0.9, 2.6, 0.35, 0.3, '#6a645c');
    }
    for (const m of Object.values(L)) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
  }

  // ---- people: called every frame with the active agents
  function people(agents, cam, t) {
    C.body.count = C.head.count = C.far.count = 0;
    for (const a of agents) {
      const d = Math.hypot(a.x - cam.x, a.z - cam.z);
      const bob = a.moving ? Math.abs(Math.sin(t * 7 + a.phase)) * 0.05 : 0;
      if (d < 45) {
        put(C.body, a.x, a.y + bob, a.z, a.wide, a.h * 0.78, a.wide, a.heading, a.cloth);
        put(C.head, a.x, a.y + a.h * 0.86 + bob, a.z, a.h * 0.17, a.h * 0.19, a.h * 0.17, a.heading, a.skin);
      } else put(C.far, a.x, a.y, a.z, a.wide, a.h, a.wide, a.heading, a.cloth);
    }
    for (const m of Object.values(C)) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
  }
  function dispose() { for (const m of [...Object.values(L), ...Object.values(C)]) { scene.remove(m); m.dispose(); } builtKey = ''; }
  function clear() { for (const m of [...Object.values(L), ...Object.values(C)]) m.count = 0; builtKey = ''; }
  return { rebuild, people, dispose, clear, meshes: { ...L, ...C } };
}
