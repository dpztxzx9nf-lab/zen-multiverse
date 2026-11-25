// Scanned stones for the garden (Poly Haven CC0, cut to LODs in Blender: grock_moss = mossy rock set,
// grock_b = granite boulder, grock_c = boulder cluster, pebbles, stones). They replace the stylised kit
// rocks: the karesansui stones, pond edge stones, granite stepping stones, and scattered set dressing
// (pebble drifts at edges, loose stones in the lawn) so the ground reads lived-in.
import * as THREE from 'three';
import { loadModel } from './game/models.js';
import { mulberry32 } from './util.js';
import { addSnowCover } from './weather.js';

const NAMES = ['grock_moss', 'grock_b', 'grock_c', 'pebbles', 'stones'];
// scanned trees (Poly Haven CC0, rebuilt as leaf cards by mom-garden-tools/blender/tree_build.py)
export async function loadGardenTrees() {
  const names = ['gtree_maple', 'gtree_niwaki', 'gtree_fir', 'gtree_fir2'];
  const ms = await Promise.all(names.map((n) => loadModel(n)));
  if (ms.some((m) => !m)) return null;
  return { maple: ms[0], niwaki: ms[1], fir: ms[2], fir2: ms[3] };
}

export async function loadGardenRocks() {
  const sets = await Promise.all(NAMES.map((n) => loadModel(n)));
  const out = {}; NAMES.forEach((n, i) => { out[n] = sets[i]; });
  return sets.every(Boolean) ? out : null;
}

export function placeGardenRocks(scene, S, { P, sandRocks, extraRocks, pondStones, stepStones, free, uSnow, center }) {
  const pc = P.cls === 'pc';
  const rnd = mulberry32(5150);
  const group = new THREE.Group(); scene.add(group);
  const mats = new Map();
  const matFor = (m) => { if (!mats.has(m)) { const c = m.clone(); c.roughness = Math.max(0.75, c.roughness); if (uSnow) addSnowCover(c, uSnow, { strength: 0.7 }); mats.set(m, c); } return mats.get(m); };
  // items: [variantIndex, x, yBase, z, sx, sy, sz, ry]
  const lists = new Map();
  const add = (name, v, x, y, z, sx, sy, sz, ry, lod = 0) => { const k = `${name}|${v}|${lod}`; if (!lists.has(k)) lists.set(k, []); lists.get(k).push([x, y, z, sx, sy, sz, ry]); };
  const size = (name, v) => S[name].variants[v % S[name].variants.length].lods[0].size;
  const nv = (name) => S[name].variants.length;

  // karesansui stones: mossy rocks, a third buried, uniform scale so they keep their own shape
  sandRocks.forEach((r, i) => {
    const v = (i * 2 + 1) % nv('grock_moss'), sz = size('grock_moss', v);
    const s = (r.r * 2.1) / Math.max(sz.x, sz.z);
    add('grock_moss', v, r.x, -sz.y * s * 0.22, r.z, s, s * (0.75 + (r.sy || 0.8) * 0.4), s, r.seed * 1.7);
  });
  (extraRocks || []).forEach((r, i) => {
    const big = r.r > 0.65, name = big ? 'grock_b' : 'grock_moss', v = i % nv(name), sz = size(name, v);
    const s = (r.r * 2.0) / Math.max(sz.x, sz.z);
    add(name, v, r.x, -sz.y * s * 0.25, r.z, s, s * 0.8, s, r.seed);
  });
  // pond edge: anchors from the granite, the rest mossy; sit them into the bank
  pondStones.forEach((st, i) => {
    const anchor = st.s > 0.45, name = anchor ? 'grock_b' : st.pebble ? 'pebbles' : 'grock_moss';
    const v = (i * 3) % nv(name), sz = size(name, v);
    const s = (st.s * 2.0) / Math.max(sz.x, sz.z);
    add(name, v, st.x, st.y - st.s * 0.35, st.z, s, s * (anchor ? 0.7 : 0.85), s, st.ry, !pc && !anchor ? 1 : 0);
  });
  // stepping stones: flat granite slabs, about 12 cm thick, tops ~4 cm proud of the lawn
  stepStones.forEach(([x, z, r], i) => {
    const v = 0, sz = size('grock_b', v);
    const s = (r * 2.3) / Math.max(sz.x, sz.z);
    add('grock_b', v, x, -0.08, z, s, 0.12 / sz.y, s * 0.85, i * 2.1 + rnd(), pc ? 0 : 1);
  });
  // set dressing: pebble drifts along edges, loose stones in the lawn
  let tries = 0, drifts = 0;
  const nDrift = pc ? 70 : 35, nLoose = pc ? 140 : 60;
  while (drifts < nDrift && tries++ < 4000) {
    const a = rnd() * 6.283, rr = 3 + Math.sqrt(rnd()) * 19, x = center.x + Math.cos(a) * rr, z = center.y + Math.sin(a) * rr;
    if (!free(x, z)) continue;
    // drifts gather where something stops them: near (but not on) blocked ground
    let edge = false; for (const [dx, dz] of [[0.7, 0], [-0.7, 0], [0, 0.7], [0, -0.7]]) if (!free(x + dx, z + dz)) edge = true;
    if (!edge && rnd() > 0.15) continue;
    const n = 2 + Math.floor(rnd() * 4);
    for (let k = 0; k < n; k++) { const v = Math.floor(rnd() * nv('pebbles')), sz = size('pebbles', v), s = (0.12 + rnd() * 0.22) / Math.max(sz.x, sz.z); add('pebbles', v, x + (rnd() - 0.5) * 0.6, -sz.y * s * 0.3, z + (rnd() - 0.5) * 0.6, s, s, s, rnd() * 6.28, 1); }
    drifts++;
  }
  tries = 0; let loose = 0;
  while (loose < nLoose && tries++ < 4000) {
    const a = rnd() * 6.283, rr = 2 + Math.sqrt(rnd()) * 20, x = center.x + Math.cos(a) * rr, z = center.y + Math.sin(a) * rr;
    if (!free(x, z)) continue;
    const sz = size('stones', 0), s = (0.05 + rnd() * 0.12) / Math.max(sz.x, sz.z);
    add('stones', 0, x, -sz.y * s * 0.35, z, s, s, s, rnd() * 6.28, 1); loose++;
  }
  // build one InstancedMesh per (asset, variant, lod, material part)
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), pv = new THREE.Vector3(), sv = new THREE.Vector3();
  let tris = 0;
  for (const [k, items] of lists) {
    const [name, v, lod] = k.split('|'); const variant = S[name].variants[+v % nv(name)];
    const L = variant.lods[Math.min(+lod, variant.lods.length - 1)];
    for (const part of L.parts) {
      const im = new THREE.InstancedMesh(part.geometry, matFor(part.material), items.length);
      items.forEach(([x, y, z, sx, sy, sz, ry], i) => { e.set(0, ry, 0); q.setFromEuler(e); m4.compose(pv.set(x, y, z), q, sv.set(sx, sy, sz)); im.setMatrixAt(i, m4); });
      const big = name !== 'pebbles' && name !== 'stones';
      im.castShadow = big; im.receiveShadow = true; im.computeBoundingSphere();
      group.add(im); tris += (part.geometry.index ? part.geometry.index.count / 3 : part.geometry.attributes.position.count / 3) * items.length;
    }
  }
  return { group, tris };
}
