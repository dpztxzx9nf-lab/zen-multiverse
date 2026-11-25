// Realistic assets made in Blender (see game-build.md: /workspace/mom-garden-tools/blender) and
// compressed with gltf-transform (meshopt + WebP; a .k.glb twin carries KTX2 textures, see js/ktx2.js). Each GLB holds meshes named <asset>_v<i>_lod<k>.
//   const set = await loadModel('moonrock_a'); set.variants[0].lods[0] -> { geometry, material, size }
import * as THREE from 'three';
import { loadGLB } from '../ktx2.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

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
      resolve({ name, variants: variants.filter(Boolean), scene: g.scene, animations: g.animations });
    }).catch((e) => { console.warn('[G] model failed', name, e && e.message); resolve(null); });
  });
  cache.set(name, p);
  return p;
}
