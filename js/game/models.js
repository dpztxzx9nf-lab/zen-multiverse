// Realistic assets made in Blender (Blender build scripts, kept outside the repo) and
// compressed with gltf-transform (meshopt + WebP; a .k.glb twin carries KTX2 textures, see js/ktx2.js). Each GLB holds meshes named <asset>_v<i>_lod<k>.
//   const set = await loadModel('moonrock_a'); set.variants[0].lods[0] -> { geometry, material, size }
import * as THREE from 'three';
import { loadGLB } from '../ktx2.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
const cache = new Map();
// meshopt/quantized attributes are normalized ints: baking a node transform into them would clamp to
// [-1, 1], so turn position/normal/tangent back into floats first (UVs can stay quantized)
function dequantize(g) {
  for (const k of ['position', 'normal', 'tangent']) {
    const a = g.attributes[k]; if (!a || (a.array instanceof Float32Array && !a.normalized && !a.isInterleavedBufferAttribute)) continue;
    const out = new Float32Array(a.count * a.itemSize);
    for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) out[i * a.itemSize + c] = a.getComponent(i, c);
    g.setAttribute(k, new THREE.BufferAttribute(out, a.itemSize));
  }
  return g;
}
// Some decimated far LODs lost the foot of the trunk (broadleaf LOD1 starts 3.4 m up, fir 1.3 m), so a
// tree past ~60 m hung in the air over its own spot. Seat such a LOD: add a plain trunk stub from where
// LOD0 meets the ground up into the LOD's trunk (sized from both, coloured from the LOD's own bark).
const lowAt = (g, y0, dy) => { // centre, mean radius and mean uv of the vertices within dy of y0
  const P = g.attributes.position, U = g.attributes.uv; let n = 0, x = 0, z = 0, u = 0, v = 0;
  for (let i = 0; i < P.count; i++) if (P.getY(i) < y0 + dy) { n++; x += P.getX(i); z += P.getZ(i); if (U) { u += U.getX(i); v += U.getY(i); } }
  if (!n) return null; x /= n; z /= n; let r = 0;
  for (let i = 0; i < P.count; i++) if (P.getY(i) < y0 + dy) r += Math.hypot(P.getX(i) - x, P.getZ(i) - z);
  return { x, z, r: r / n, u: u / n, v: v / n };
};
function floatAttrs(g) { // stub merging needs plain float attributes everywhere
  for (const k of Object.keys(g.attributes)) {
    const a = g.attributes[k]; if (a.array instanceof Float32Array && !a.normalized && !a.isInterleavedBufferAttribute) continue;
    const out = new Float32Array(a.count * a.itemSize);
    for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) out[i * a.itemSize + c] = a.getComponent(i, c);
    g.setAttribute(k, new THREE.BufferAttribute(out, a.itemSize));
  }
  return g;
}
export function seatLods(v) {
  const L0 = v.lods[0]; if (!L0 || !L0.parts.length) return 0;
  const minY = (p) => p.geometry.boundingBox.min.y, mname = (p) => (p.material && p.material.name) || '';
  const trunk0 = L0.parts.reduce((a, p) => (minY(p) < minY(a) ? p : a));
  const g0 = minY(trunk0); let fixed = 0;
  for (let li = 1; li < v.lods.length; li++) {
    const L = v.lods[li]; if (!L) continue;
    const k0 = L0.parts.indexOf(trunk0);
    const part = L.parts.find((p) => mname(p) && mname(p) === mname(trunk0)) || L.parts[k0];
    if (!part || (part.material && part.material.alphaTest > 0)) continue;
    const top = minY(part); if (top - g0 < 0.4) continue;
    const a = lowAt(trunk0.geometry, g0, 0.5), b = lowAt(part.geometry, top, 0.5); if (!a || !b) continue;
    const h = top - g0 + 0.3, rb = Math.max(0.05, a.r), rt = Math.max(0.04, Math.min(rb, b.r || rb));
    const g = floatAttrs(part.geometry);
    const stub = new THREE.CylinderGeometry(rt, rb, h, 7, 1, true); stub.translate(0, g0 + h / 2, 0);
    // lean from the root to where the LOD's trunk starts
    const P = stub.attributes.position; for (let i = 0; i < P.count; i++) { const t = (P.getY(i) - g0) / h; P.setXYZ(i, P.getX(i) + a.x + (b.x - a.x) * t, P.getY(i), P.getZ(i) + a.z + (b.z - a.z) * t); }
    for (const k of Object.keys(g.attributes)) {
      if (k === 'position' || k === 'normal') continue;
      const src = g.attributes[k], n = P.count, arr = new Float32Array(n * src.itemSize);
      const fill = k === 'uv' || k === 'uv1' ? [b.u, b.v] : k === 'tangent' ? [1, 0, 0, 1] : k === 'color' ? [1, 1, 1, 1] : [0, 0, 0, 0];
      for (let i = 0; i < n; i++) for (let c = 0; c < src.itemSize; c++) arr[i * src.itemSize + c] = fill[c] ?? 0;
      stub.setAttribute(k, new THREE.BufferAttribute(arr, src.itemSize));
    }
    for (const k of Object.keys(stub.attributes)) if (!g.attributes[k]) stub.deleteAttribute(k);
    const geo = mergeGeometries(g.index ? [g, stub] : [g, stub.toNonIndexed()], false);
    if (!geo) continue;
    geo.computeBoundingBox(); geo.computeBoundingSphere();
    if (L.geometry === part.geometry) L.geometry = geo;
    part.geometry = geo; fixed++;
  }
  return fixed;
}
export function loadModel(name) {
  if (cache.has(name)) return cache.get(name);
  const p = new Promise((resolve) => {
    loadGLB(loader, `models/${name}.glb`).then((g) => {
      const variants = [];
      g.scene.updateMatrixWorld(true);
      g.scene.traverse((o) => {
        if (!o.isMesh) return;
        const m = /_v(\d+)_lod(\d+)/.exec(o.name) || /_v(\d+)_lod(\d+)/.exec(o.parent ? o.parent.name : '') || [0, 0, 0];
        const vi = +m[1], li = +m[2];
        const geometry = dequantize(o.geometry.clone()).applyMatrix4(o.matrixWorld);
        geometry.computeBoundingBox();
        const size = geometry.boundingBox.getSize(new THREE.Vector3());
        (variants[vi] = variants[vi] || { lods: [], parts: [] });
        // a variant can have several materials (bark + leaves): keep them as parts per LOD
        const lod = variants[vi].lods[li] || (variants[vi].lods[li] = { parts: [], size: new THREE.Vector3() });
        // scanned/baked assets carry a packed ARM texture whose blue channel is not real metal:
        // with metalnessFactor 1 that rendered rocks near-black. Only named metals keep metalness.
        for (const mm of [].concat(o.material)) if (mm && mm.metalness > 0 && !/metal|steel|chrome/i.test(mm.name || '')) { mm.metalness = 0; mm.metalnessMap = null; mm.needsUpdate = true; }
        lod.parts.push({ geometry, material: o.material });
        lod.size.max(size);
        if (!lod.geometry) { lod.geometry = geometry; lod.material = o.material; }
      });
      for (const v of variants) if (v) seatLods(v);
      resolve({ name, variants: variants.filter(Boolean), scene: g.scene, animations: g.animations });
    }).catch((e) => { console.warn('[G] model failed', name, e && e.message); resolve(null); });
  });
  cache.set(name, p);
  return p;
}
