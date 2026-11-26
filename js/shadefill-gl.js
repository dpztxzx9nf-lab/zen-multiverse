// The shader side of the shade fill (maths in js/shadefill.js). One small patch to three's lighting chunks:
// the environment's diffuse light keeps its brightness (the photo's luminance) but takes its colour from the
// real sky above and the real ground bounce below, weighted by how much of each a surface faces:
//   hue(n) = mix(ground, sky, (1 + n.y) / 2)        (the sky and ground view factors of a tilted face)
// Reflections (specular) are untouched, so water and glossy things still mirror the blue sky.
// The uniforms are shared plain objects (three copies Vector3s per material, but passes plain {x,y,z} by
// reference), so every standard/physical material follows them. Only scenes that switch it on are affected:
// the garden sets strength in scene.onBeforeRender and puts it back to 0 after (planets keep their own look).
// Coordination note (art branch, js/look.js): look.js replaces the tonemapping chunk and adds a sky rim in
// stylize() onBeforeCompile; this patch touches lights_fragment_maps and envmap_physical_pars_fragment only.
import * as THREE from 'three';

export const SHADE_FILL = { sky: { x: 0, y: 0, z: 0 }, ground: { x: 0, y: 0, z: 0 }, k: { x: 0, y: 0, z: 0 } };
let installed = false;
export function installShadeFill() {
  if (installed) return; installed = true;
  const C = THREE.ShaderChunk;
  C.envmap_physical_pars_fragment = 'uniform vec3 zmFillSky;\nuniform vec3 zmFillGround;\nuniform vec3 zmFillK;\n' + C.envmap_physical_pars_fragment;
  const from = 'iblIrradiance += getIBLIrradiance( geometryNormal );';
  if (!C.lights_fragment_maps.includes(from)) { console.warn('[shadefill] three chunk changed; shade fill off'); return; }
  C.lights_fragment_maps = C.lights_fragment_maps.replace(from, `{
      vec3 zmIrr = getIBLIrradiance( geometryNormal );
      if ( zmFillK.x > 0.0 ) {
        vec3 zmN = inverseTransformDirection( geometryNormal, viewMatrix );
        vec3 zmHue = mix( zmFillGround, zmFillSky, clamp( 0.5 + 0.5 * zmN.y, 0.0, 1.0 ) );
        const vec3 zmW = vec3( 0.2126, 0.7152, 0.0722 );
        float zmL = dot( zmIrr, zmW ), zmH = max( 1e-5, dot( zmHue, zmW ) );
        zmIrr = mix( zmIrr, zmHue * ( zmL / zmH ), zmFillK.x );
      }
      iblIrradiance += zmIrr;
    }`);
  for (const id of ['standard', 'physical']) {
    const U = THREE.ShaderLib[id] && THREE.ShaderLib[id].uniforms; if (!U) continue;
    U.zmFillSky = { value: SHADE_FILL.sky }; U.zmFillGround = { value: SHADE_FILL.ground }; U.zmFillK = { value: SHADE_FILL.k };
  }
}
// a scene opts in: strength k while it renders, 0 again after
export function useShadeFill(scene, k = 0.85) {
  const pb = scene.onBeforeRender, pa = scene.onAfterRender;
  scene.onBeforeRender = function (...a) { SHADE_FILL.k.x = k; return pb.apply(this, a); };
  scene.onAfterRender = function (...a) { SHADE_FILL.k.x = 0; return pa.apply(this, a); };
}
export function setShadeFill(sky, ground) {
  SHADE_FILL.sky.x = sky[0]; SHADE_FILL.sky.y = sky[1]; SHADE_FILL.sky.z = sky[2];
  SHADE_FILL.ground.x = ground[0]; SHADE_FILL.ground.y = ground[1]; SHADE_FILL.ground.z = ground[2];
}
