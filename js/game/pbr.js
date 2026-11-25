// Photographic ground materials from CC0 scans (Poly Haven; see CREDITS.md), as small WebP sets:
// assets/pbr/<id>/<1k|2k>_{diff,nor,arm}.webp (arm = AO, roughness, metal). Phones get 1K, computers 2K.
// all-rock (boulders): groundMaterial({ ground: id, rock: id, slope: [2, 3] }) is triplanar everywhere.
//   const mat = await groundMaterial({ ground: 'moon_dusted_02', rock: 'dark_rock', scale: 0.33, vertexTint: true, P, renderer })
// The ground is projected from above in world space (no seams across terrain chunks), sampled at two
// rotated scales to hide tiling, and steep slopes blend into a rock set projected from the sides.
// vertexTint keeps the terrain's own vertex colours and uses the scan only for detail (normalised by its
// mean colour), so procedural planets keep their palettes but read photographic.
import * as THREE from 'three';

const loader = new THREE.TextureLoader();
const cache = new Map();
let index = null;
async function getIndex() {
  if (!index) index = fetch(new URL('../../assets/pbr/index.json', import.meta.url)).then((r) => r.json()).catch(() => ({}));
  return index;
}
export const pbrRes = (P) => (P && P.cls === 'pc' ? '2k' : '1k');
function tex(id, res, map, renderer) {
  const key = `${id}/${res}_${map}`;
  if (cache.has(key)) return cache.get(key);
  const p = new Promise((resolve) => {
    loader.load(new URL(`../../assets/pbr/${key}.webp`, import.meta.url).href, (t) => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = map === 'diff' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = renderer ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 4;
      resolve(t);
    }, undefined, () => resolve(null));
  });
  cache.set(key, p);
  return p;
}
export async function loadSet(id, P, renderer) {
  const res = pbrRes(P);
  const [diff, nor, arm, idx] = await Promise.all([tex(id, res, 'diff', renderer), tex(id, res, 'nor', renderer), tex(id, res, 'arm', renderer), getIndex()]);
  const m = (idx[id] && idx[id].mean) || [0.2, 0.2, 0.2];
  return { id, diff, nor, arm, mean: new THREE.Vector3(...m) };
}

export async function groundMaterial({ ground, rock = null, scale = 0.3, rockScale = 0.18, vertexTint = false, detail = 1, normalK = 1, roughK = 1, aoK = 0.8, slope = [0.72, 0.86], rockTint = '#ffffff', tint = '#ffffff', P, renderer, base = {} }) {
  const g = await loadSet(ground, P, renderer);
  const r = rock ? await loadSet(rock, P, renderer) : null;
  const mat = new THREE.MeshStandardMaterial({ color: tint, roughness: 1, metalness: 0, vertexColors: vertexTint, ...base });
  const U = {
    gDiff: { value: g.diff }, gNor: { value: g.nor }, gArm: { value: g.arm }, gMean: { value: g.mean },
    rDiff: { value: r ? r.diff : g.diff }, rNor: { value: r ? r.nor : g.nor }, rArm: { value: r ? r.arm : g.arm }, rMean: { value: r ? r.mean : g.mean },
    uScale: { value: scale }, uRockScale: { value: rockScale }, uDetail: { value: detail }, uNormalK: { value: normalK }, uRoughK: { value: roughK }, uAoK: { value: aoK },
    uSlope: { value: new THREE.Vector2(...slope) }, uRockTint: { value: new THREE.Color(rockTint) },
  };
  mat.userData.pbr = U;
  mat.customProgramCacheKey = () => `pbr-${vertexTint ? 1 : 0}-${r ? 1 : 0}`;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.defines = sh.defines || {};
    if (r) sh.defines.PBR_ROCK = '';
    if (vertexTint) sh.defines.PBR_TINT = '';
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPbrW; varying vec3 vPbrN;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
  { vec4 pw = vec4(transformed, 1.0); vec3 on = objectNormal;
  #ifdef USE_INSTANCING
    pw = instanceMatrix * pw; on = mat3(instanceMatrix) * on;
  #endif
    vPbrW = (modelMatrix * pw).xyz; vPbrN = normalize(mat3(modelMatrix) * on); }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vPbrW; varying vec3 vPbrN;
uniform sampler2D gDiff, gNor, gArm, rDiff, rNor, rArm; uniform vec3 gMean, rMean, uRockTint;
uniform float uScale, uRockScale, uDetail, uNormalK, uRoughK, uAoK; uniform vec2 uSlope;
vec3 pbrAlb; vec3 pbrNor; vec3 pbrArm;
const mat2 PBR_R = mat2(0.8, -0.6, 0.6, 0.8);
void pbrSample(){
  vec2 uA = vPbrW.xz * uScale, uB = PBR_R * vPbrW.xz * uScale * 0.37 + 0.31;
  // a slow mask decides which scale shows where, so no repeat lines up
  float m = smoothstep(0.35, 0.65, texture2D(gArm, vPbrW.xz * uScale * 0.043).g);
  m = 0.3 + 0.4 * m;
  vec3 aA = texture2D(gDiff, uA).rgb, aB = texture2D(gDiff, uB).rgb;
  vec3 alb = mix(aA, aB, m) / max(gMean, vec3(0.001));
  vec3 nA = texture2D(gNor, uA).xyz * 2. - 1., nB = texture2D(gNor, uB).xyz * 2. - 1.;
  vec3 n = vec3(mix(nA.xy, PBR_R * nB.xy, m), 1.);
  vec3 arm = mix(texture2D(gArm, uA).rgb, texture2D(gArm, uB).rgb, m);
  vec3 tn = vec3(n.x, n.y, n.z);
  float k = 0.;
#ifdef PBR_ROCK
  vec3 wn = normalize(vPbrN);
  k = 1. - smoothstep(uSlope.x, uSlope.y, wn.y);
  if (k > 0.001) {
    vec3 w = pow(abs(wn), vec3(4.)); w /= (w.x + w.y + w.z);
    vec2 ux = vPbrW.zy * uRockScale, uz = vPbrW.xy * uRockScale, uy = vPbrW.xz * uRockScale;
    vec3 ra = (texture2D(rDiff, ux).rgb * w.x + texture2D(rDiff, uz).rgb * w.z + texture2D(rDiff, uy).rgb * w.y) / max(rMean, vec3(0.001));
    vec3 rr = texture2D(rArm, ux).rgb * w.x + texture2D(rArm, uz).rgb * w.z + texture2D(rArm, uy).rgb * w.y;
    alb = mix(alb, ra * uRockTint * (rMean / max(gMean, vec3(0.001))), k);
    arm = mix(arm, rr, k);
    n.xy *= 1. - k * 0.7;
  }
#endif
  pbrAlb = alb; pbrNor = n; pbrArm = arm;
}`)
      .replace('#include <map_fragment>', `pbrSample();
#ifdef PBR_TINT
  diffuseColor.rgb *= mix(vec3(1.), clamp(pbrAlb, 0., 3.), uDetail);
#else
  diffuseColor.rgb *= pbrAlb * gMean;
#endif`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = clamp(roughness * pbrArm.g * uRoughK, 0.04, 1.);')
      .replace('#include <normal_fragment_maps>', `{
  // ground projected from above: tangent = world +X, bitangent = world -Z, in view space
  vec3 T = normalize((viewMatrix * vec4(1., 0., 0., 0.)).xyz), B = normalize((viewMatrix * vec4(0., 0., -1., 0.)).xyz);
  T = normalize(T - normal * dot(normal, T)); B = normalize(B - normal * dot(normal, B));
  vec3 n = pbrNor; n.xy *= uNormalK;
  normal = normalize(T * n.x + B * n.y + normal * n.z);
}`)
      .replace('#include <aomap_fragment>', `{
  float ambientOcclusion = mix(1., pbrArm.r, uAoK);
  reflectedLight.indirectDiffuse *= ambientOcclusion;
  #if defined( USE_CLEARCOAT ) || defined( USE_SHEEN )
  #endif
}`);
  };
  return mat;
}

// a plain PBR material from a set with ordinary UVs (rocks, bark, panels): map + normal + roughness/AO
export async function surfaceMaterial(id, { P, renderer, repeat = 1, color = '#ffffff', normalScale = 1, roughness = 1, ...rest } = {}) {
  const s = await loadSet(id, P, renderer);
  const clone = (t) => { if (!t) return null; const c = t.clone(); c.repeat.set(repeat, repeat); c.needsUpdate = true; return c; };
  return new THREE.MeshStandardMaterial({ map: clone(s.diff), normalMap: clone(s.nor), normalScale: new THREE.Vector2(normalScale, normalScale), roughnessMap: clone(s.arm), aoMap: clone(s.arm), aoMapIntensity: 0.8, roughness, color, ...rest });
}

// swap the ground ('g') or rock ('r') scan of a groundMaterial in place (e.g. when a new planet loads)
export async function swapSet(mat, which, id, P, renderer) {
  const U = mat.userData.pbr; if (!U) return;
  const s = await loadSet(id, P, renderer);
  U[which + 'Diff'].value = s.diff; U[which + 'Nor'].value = s.nor; U[which + 'Arm'].value = s.arm; U[which + 'Mean'].value = s.mean;
}
// which scan suits a planet biome (Earth analogues)
export const BIOME_SET = { forest: 'forest_ground_04', shore: 'coast_sand_01', salt: 'dry_ground_01', ice: 'snow_02', crystal: 'cracked_red_ground' };
export const BIOME_ROCK = { forest: 'rock_boulder_dry', shore: 'rock_boulder_dry', salt: 'rock_boulder_dry', ice: 'dark_rock', crystal: 'dark_rock' };
