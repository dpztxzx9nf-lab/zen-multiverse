// Photographic detail on any MeshStandardMaterial: a Poly Haven scan set sampled triplanar in world
// space (no UVs needed, no seams across instances) and layered on top of the material's own look:
// albedo detail normalised by the scan's mean colour (optionally luminance only, so the base tint stays),
// scan roughness, and scan normals blended into the shading normal.
//   applyDetail(mat, await loadSet('granite_tile', P, renderer), { scale: 0.8, k: 1, lum: false, nK: 1, rK: 1 })
import * as THREE from 'three';

export function applyDetail(mat, set, { scale = 1, k = 1, lum = false, nK = 1, rK = 1, key = '' } = {}) {
  if (!set || !set.diff) return mat;
  const U = { tDD: { value: set.diff }, tDN: { value: set.nor }, tDA: { value: set.arm }, uDMean: { value: set.mean }, uDScale: { value: scale }, uDK: { value: k }, uDNK: { value: nK }, uDRK: { value: rK } };
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vDW; varying vec3 vDWN;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        { vec4 dw = vec4(transformed, 1.0); vec3 dn = objectNormal;
          #ifdef USE_INSTANCING
          dw = instanceMatrix * dw; dn = mat3(instanceMatrix) * dn;
          #endif
          vDW = (modelMatrix * dw).xyz; vDWN = normalize(mat3(modelMatrix) * dn); }`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vDW; varying vec3 vDWN;
      uniform sampler2D tDD, tDN, tDA; uniform vec3 uDMean; uniform float uDScale, uDK, uDNK, uDRK;
      vec3 dTri(sampler2D t, vec3 w) {
        vec3 p = vDW * uDScale;
        return texture2D(t, p.zy).rgb * w.x + texture2D(t, p.xz).rgb * w.y + texture2D(t, p.xy).rgb * w.z; }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec3 dWt = pow(abs(normalize(vDWN)), vec3(4.0)); dWt /= dWt.x + dWt.y + dWt.z;
        { vec3 dc = dTri(tDD, dWt); vec3 det = dc / max(uDMean, vec3(0.02));
          ${lum ? 'det = vec3(dot(dc, vec3(0.2126, 0.7152, 0.0722)) / max(dot(uDMean, vec3(0.2126, 0.7152, 0.0722)), 0.02));' : ''}
          diffuseColor.rgb *= mix(vec3(1.0), det, uDK); }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, roughnessFactor * dTri(tDA, dWt).g * 1.25, uDRK);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        { vec3 nw = normalize(vDWN); vec3 p = vDW * uDScale;
          vec3 tx = texture2D(tDN, p.zy).xyz * 2.0 - 1.0, ty = texture2D(tDN, p.xz).xyz * 2.0 - 1.0, tz = texture2D(tDN, p.xy).xyz * 2.0 - 1.0;
          // whiteout-style triplanar: swizzle each tangent normal into world space around its axis
          vec3 wx = vec3(tx.z * sign(nw.x), tx.y, tx.x), wy = vec3(ty.x, ty.z * sign(nw.y), ty.y), wz = vec3(tz.x, tz.y, tz.z * sign(nw.z));
          vec3 nd = normalize(wx * dWt.x + wy * dWt.y + wz * dWt.z);
          vec3 nv = normalize((viewMatrix * vec4(nd, 0.0)).xyz);
          normal = normalize(mix(normal, nv, 0.6 * uDNK)); }`);
  };
  const pk = mat.customProgramCacheKey ? mat.customProgramCacheKey.bind(mat) : () => '';
  mat.customProgramCacheKey = () => pk() + 'detail' + (lum ? 'L' : '') + key;
  mat.needsUpdate = true;
  return mat;
}
