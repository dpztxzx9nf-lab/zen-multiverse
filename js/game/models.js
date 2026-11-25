// Realistic assets made in Blender (see game-build.md: /workspace/mom-garden-tools/blender) and
// compressed with gltf-transform (meshopt + WebP). Each GLB holds meshes named <asset>_v<i>_lod<k>.
//   const set = await loadModel('moonrock_a'); set.variants[0].lods[0] -> { geometry, material, size }
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
const cache = new Map();
export function loadModel(name) {
  if (cache.has(name)) return cache.get(name);
  const p = new Promise((resolve) => {
    loader.load(new URL(`../../assets/models/${name}.glb`, import.meta.url).href, (g) => {
      const variants = [];
      g.scene.updateMatrixWorld(true);
      g.scene.traverse((o) => {
        if (!o.isMesh) return;
        const m = /_v(\d+)_lod(\d+)/.exec(o.name) || /_v(\d+)_lod(\d+)/.exec(o.parent ? o.parent.name : '') || [0, 0, 0];
        const vi = +m[1], li = +m[2];
        const geometry = o.geometry.clone().applyMatrix4(o.matrixWorld);
        geometry.computeBoundingBox();
        const size = geometry.boundingBox.getSize(new THREE.Vector3());
        (variants[vi] = variants[vi] || { lods: [], parts: [] });
        // a variant can have several materials (bark + leaves): keep them as parts per LOD
        const lod = variants[vi].lods[li] || (variants[vi].lods[li] = { parts: [], size: new THREE.Vector3() });
        lod.parts.push({ geometry, material: o.material });
        lod.size.max(size);
        if (!lod.geometry) { lod.geometry = geometry; lod.material = o.material; }
      });
      resolve({ name, variants: variants.filter(Boolean), scene: g.scene, animations: g.animations });
    }, undefined, (e) => { console.warn('[G] model failed', name, e && e.message); resolve(null); });
  });
  cache.set(name, p);
  return p;
}
