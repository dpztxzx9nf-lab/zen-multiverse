// Photographic sky: Poly Haven pure-sky HDRIs (CC0) matched to the sun's real elevation.
// Each set has a sharp LDR upper-hemisphere photo for the sky dome (blended with the real-time
// sky so sun, moon, stars and weather still work) and a small sun-clamped HDR that lights the
// garden through PMREM. Both are rotated so the photo's sun sits where the real sun is.
// Built by /workspace/mom-garden-tools/hdri/convert.py.
import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { smoothstep } from './util.js';

// lowest sun elevation (deg) each photo is used from, high to low
const SETS = [
  { id: 'kloofendal_48d_partly_cloudy_puresky', from: 36 },
  { id: 'rustig_koppie_puresky', from: 19 },
  { id: 'table_mountain_1_puresky', from: 9 },
  { id: 'qwantani_sunset_puresky', from: 1.5 },
  { id: 'qwantani_dusk_2_puresky', from: -90 },
];
const base = new URL('../assets/sky/', import.meta.url).href;

export async function createSkyPhoto({ renderer, P }) {
  const index = await fetch(base + 'index.json').then((r) => r.json()).catch(() => null);
  if (!index) return null;
  const tier = P.cls === 'pc' ? 'pc' : 'phone';
  const texLoader = new THREE.TextureLoader(), hdrLoader = new RGBELoader();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const cache = new Map();
  function load(id) {
    if (cache.has(id)) return cache.get(id);
    const p = Promise.all([
      texLoader.loadAsync(`${base}${id}-${tier}.webp`),
      hdrLoader.loadAsync(`${base}${id}-env.hdr`),
    ]).then(([photo, hdr]) => {
      photo.colorSpace = THREE.NoColorSpace; photo.wrapS = THREE.RepeatWrapping; photo.wrapT = THREE.ClampToEdgeWrapping;
      photo.anisotropy = 4; photo.generateMipmaps = true; photo.minFilter = THREE.LinearMipmapLinearFilter;
      hdr.mapping = THREE.EquirectangularReflectionMapping;
      const env = pmrem.fromEquirectangular(hdr).texture; hdr.dispose();
      return { id, photo, env, info: index[id] };
    }).catch((e) => { console.warn('[sky] photo failed', id, e && e.message); return null; });
    cache.set(id, p); return p;
  }
  let cur = null, wanted = null;
  const pick = (elev) => SETS.find((s) => elev >= s.from) || SETS[SETS.length - 1];
  const horizon = new THREE.Color(), zenith = new THREE.Color();
  return {
    get ready() { return !!cur; },
    // after a WebGL context loss the PMREM env maps are gone: load them again
    restore() { cache.clear(); cur = null; wanted = null; },
    // call when the time of day changes; mutates ts colours toward the photo so fog and light match it
    update(ts, sky, scene) {
      const s = pick(ts.elev);
      // hysteresis: only switch when well inside the next band (time moves slowly anyway)
      if (!cur || (s.id !== cur.id && (!wanted || wanted !== s.id))) {
        if (!cur || Math.abs(ts.elev - s.from) > 0.6 || ts.elev < s.from) {
          wanted = s.id;
          load(s.id).then((d) => { if (d && wanted === d.id) { cur = d; this.apply(ts, sky, scene); } });
        }
      }
      if (cur) this.apply(ts, sky, scene);
      return ts;
    },
    apply(ts, sky, scene) {
      if (!cur) return;
      const info = cur.info;
      const rot = info.az - Math.atan2(ts.sunDir.z, ts.sunDir.x);
      const k = smoothstep(-9, -3, ts.elev) * (1 - (ts.overcast || 0) * 0.85);
      const U = sky.uniforms;
      U.uPhoto.value = cur.photo; U.uPhotoK.value = k; U.uPhotoRot.value = rot; U.uPhotoWhite.value = info.white;
      // dusk photo dims as the sun sinks further
      U.uPhotoGain.value = (ts.elev < 1.5 ? 0.35 + 0.65 * smoothstep(-8, 1.5, ts.elev) : 1) * 0.55;
      scene.environment = cur.env;
      scene.environmentRotation.set(0, rot, 0);
      scene.environmentIntensity = k * (ts.elev < 1.5 ? 0.25 + 0.5 * smoothstep(-8, 1.5, ts.elev) : 0.75);
      horizon.setRGB(...info.horizon).multiplyScalar(U.uPhotoGain.value);
      zenith.setRGB(...info.zenith).multiplyScalar(U.uPhotoGain.value);
      // fog and the procedural sky lean to the photo's colours so far hills sit in the same air
      ts.horizon.lerp(horizon.multiplyScalar(0.75), k * 0.6);
      ts.zenith.lerp(zenith, k * 0.75);
      ts.photoK = k;
    },
  };
}
