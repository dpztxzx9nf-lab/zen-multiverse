// GPU-compressed KTX2 (Basis) textures with a WebP fallback. KTX2 stays compressed on the GPU
// (ASTC/ETC2 on iPhone, about 4-8x less memory than a decoded WebP). Converted files are listed in
// assets/ktx2.json (mom-garden-tools/ktx2/convert.py); they are pre-flipped to match the WebP's flipY.
// ?noktx2 forces the WebP path (before/after checks).
import * as THREE from 'three';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';

const ROOT = new URL('../assets/', import.meta.url).href;
const OFF = typeof location !== 'undefined' && new URLSearchParams(location.search).has('noktx2');
let ktx = null, list = null;
const webp = new THREE.TextureLoader();
export const ktx2Stats = { ktx2: 0, webp: 0, failed: 0 };

export function initKtx2(renderer) {
  if (OFF || ktx) return;
  try {
    ktx = new KTX2Loader().setTranscoderPath(new URL('../vendor/addons/libs/basis/', import.meta.url).href).setWorkerLimit(2).detectSupport(renderer);
  } catch (e) { ktx = null; }
}
const manifest = () => list || (list = fetch(ROOT + 'ktx2.json').then((r) => (r.ok ? r.json() : { files: [] })).then((j) => new Set(j.files)).catch(() => new Set()));

// path under assets/ without the extension, e.g. 'pbr/dark_rock/1k_diff'
export async function loadTexture(path, { flipY = true } = {}) {
  if (ktx && (await manifest()).has(path + '.ktx2')) {
    try {
      const t = await ktx.loadAsync(ROOT + path + '.ktx2');
      ktx2Stats.ktx2++;
      return t;
    } catch (e) { ktx2Stats.failed++; console.warn('[ktx2] using WebP for', path, e && e.message); }
  }
  const t = await webp.loadAsync(ROOT + path + '.webp');
  t.flipY = flipY; ktx2Stats.webp++;
  return t;
}

// a GLB with KTX2 textures (<name>.k.glb, made by mom-garden-tools/ktx2-glb.mjs) when listed, else the WebP one.
// load(url) is the caller's GLTF load; a failed .k.glb falls back to the WebP GLB.
export async function loadGLB(loader, path, load = (u) => loader.loadAsync(u)) {
  const k = path.replace(/\.glb$/, '.k.glb');
  if (ktx && (await manifest()).has(k)) {
    loader.setKTX2Loader(ktx);
    try { const g = await load(ROOT + k); ktx2Stats.ktx2++; return g; } catch (e) { ktx2Stats.failed++; console.warn('[ktx2] using WebP GLB for', path, e && e.message); }
  }
  ktx2Stats.webp++;
  return load(ROOT + path);
}
if (typeof window !== 'undefined') window.__ktx2 = ktx2Stats;
