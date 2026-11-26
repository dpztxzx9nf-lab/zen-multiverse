// Raked Light: the game's one shared look (see mom-garden-notes/art-bible.md).
// 1) The tonemap. Every world, every material and the garden's OutputPass go through the ACES slot, so
//    the Raked Light curve lives there: ACES's grey response (exposure and brightness stay as tuned), but
//    hue-preserving, saturation that peaks in the mid-tones and falls off into deep shadow and highlights,
//    and highlights that roll to a warm paper white instead of skewing yellow or cyan.
// 2) stylize(material, kind): PBR underneath, with a soft painterly light ramp (wrapped N.L through a soft
//    band), a grazing rim of real sky light (the hemisphere's sky colour), thin-leaf translucency toward the
//    sun, clump normals for foliage (light rolls over a crown like over a stone) and sway in the world's wind.
// Hue is never chosen here: it comes from the lights, sky, fog and albedos the simulation sets.
import * as THREE from 'three';

// ?look=0 turns the whole look off (A/B frame-cost checks, or a quick escape hatch)
export const LOOK_ON = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('look') === '0');
const TM = THREE.ShaderChunk.tonemapping_pars_fragment;
if (LOOK_ON && !TM.includes('zmACESRef')) {
  THREE.ShaderChunk.tonemapping_pars_fragment = TM.replace('vec3 ACESFilmicToneMapping( vec3 color ) {', 'vec3 zmACESRef( vec3 color ) {')
    + `
vec3 ACESFilmicToneMapping( vec3 color ) {
  vec3 a = zmACESRef( color );
  float L = dot( color, vec3( 0.2126, 0.7152, 0.0722 ) );
  float Lt = zmACESRef( vec3( L ) ).g;
  vec3 hp = color * ( Lt / max( L, 1e-6 ) );
  float m = max( hp.r, max( hp.g, hp.b ) );
  if ( m > 1.0 ) hp = vec3( Lt ) + ( hp - vec3( Lt ) ) * ( ( 1.0 - Lt ) / max( m - Lt, 1e-4 ) );
  vec3 c = mix( a, hp, 0.6 );
  float o = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
  float s = 1.0 + 0.12 * smoothstep( 0.02, 0.22, o ) - 0.14 * smoothstep( 0.5, 0.95, o ) - 0.08 * ( 1.0 - smoothstep( 0.0, 0.04, o ) );
  c = mix( vec3( o ), c, s );
  c = mix( c, c * vec3( 1.0, 0.985, 0.955 ), smoothstep( 0.6, 1.0, o ) * 0.5 );
  return saturate( c );
}`;
}

// shared by every stylized material: time and the world's wind (m/s, xz). Worlds call setWind().
export const LOOK = { zmTime: { value: 0 }, zmWind: { value: new THREE.Vector2(1.5, 0.6) } };
export function tickLook(dt) { LOOK.zmTime.value += dt; }
export function setWind(x, z) { LOOK.zmWind.value.set(x, z); }

// per kind: wrap, band (how much of the soft step), rim (sky light at grazing), translucency, wind
export const KINDS = {
  leaf: { wrap: 0.5, band: 0.55, rim: 0.35, trans: 0.6, wind: 1 },
  grass: { wrap: 0.5, band: 0.4, rim: 0.25, trans: 0.4, wind: 1 },
  wood: { wrap: 0.2, band: 0.45, rim: 0.2, trans: 0, wind: 0 },
  terrain: { wrap: 0.12, band: 0.35, rim: 0.12, trans: 0, wind: 0 },
  rock: { wrap: 0.08, band: 0.45, rim: 0.18, trans: 0, wind: 0 },
  skin: { wrap: 0.3, band: 0.5, rim: 0.45, trans: 0, wind: 0 },
  cloth: { wrap: 0.3, band: 0.55, rim: 0.45, trans: 0.08, wind: 0 },
  made: { wrap: 0.15, band: 0.5, rim: 0.3, trans: 0, wind: 0 },
};
const PHYS = THREE.ShaderChunk.lights_physical_pars_fragment;
const NL = 'float dotNL = saturate( dot( geometryNormal, directLight.direction ) );\n\tvec3 irradiance = dotNL * directLight.color;';
const PHYS_RAMP = PHYS.replace(NL, 'float dotNL = saturate( dot( geometryNormal, directLight.direction ) );\n\tvec3 irradiance = zmRamp( dot( geometryNormal, directLight.direction ) ) * directLight.color;');
const f = (x) => (+x).toFixed(4);

// stylize(mat, 'leaf', { clump: Vector3 (object-space crown centre), clumpK: 0..1, height: m, wind: bool, lite })
export function stylize(mat, kind = 'made', o = {}) {
  if (!LOOK_ON || !mat || mat.userData.zmLook || !mat.isMeshStandardMaterial) return mat;
  const K = { ...KINDS[kind], ...(o.k || {}) };
  const wind = o.wind !== undefined ? o.wind : !!K.wind, trans = o.lite ? 0 : K.trans;
  const clump = o.clump && kind === 'leaf';
  const U = { zmClump: { value: clump ? o.clump.clone() : new THREE.Vector3() }, zmH: { value: o.height || 4 } };
  mat.userData.zmLook = { kind, U };
  const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey ? mat.customProgramCacheKey.bind(mat) : () => '';
  mat.onBeforeCompile = function (sh, r) {
    if (prev) prev.call(this, sh, r);
    Object.assign(sh.uniforms, LOOK, U);
    let v = sh.vertexShader, fr = sh.fragmentShader;
    v = v.replace('#include <common>', `#include <common>
      uniform float zmTime; uniform vec2 zmWind; uniform vec3 zmClump; uniform float zmH;`);
    if (clump) v = v.replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
      { vec3 zc = position - zmClump; objectNormal = normalize( mix( objectNormal, normalize( zc + vec3( 0.0, 0.0001, 0.0 ) ), ${f(o.clumpK ?? 0.7)} ) ); }`);
    if (wind) v = v.replace('#include <begin_vertex>', `#include <begin_vertex>
      {
        #ifdef USE_INSTANCING
        vec3 zo = instanceMatrix[3].xyz;
        #else
        vec3 zo = vec3( 0.0 );
        #endif
        zo += modelMatrix[3].xyz;
        float zv = length( zmWind ), zph = dot( zo.xz, vec2( 0.071, 0.053 ) );
        float zy = clamp( position.y / max( zmH, 0.1 ), 0.0, 1.5 );
        // trunk bend ~ wind pressure (v^2), gusting slowly; leaf flutter fast and small
        float zbend = 0.0035 * zv * zv * zy * zy * ( 0.75 + 0.25 * sin( zmTime * 0.9 + zph ) );
        vec2 zd = zv > 0.01 ? zmWind / zv : vec2( 1.0, 0.0 );
        transformed.xz += zd * zbend * zmH * 0.25;
        transformed += normal * ( 0.012 * zv * zy * sin( zmTime * 6.0 + zph * 7.0 + position.x * 3.1 + position.z * 2.3 ) ) ${kind === 'leaf' || kind === 'grass' ? '' : '* 0.0'};
      }`);
    fr = fr.replace('#include <common>', `#include <common>
      float zmRamp( float x ) { float d = clamp( ( x + ${f(K.wrap)} ) / ${f(1 + K.wrap)}, 0.0, 1.0 ); return mix( d, smoothstep( 0.0, 0.7, d ), ${f(K.band)} ); }`)
      .replace('#include <lights_physical_pars_fragment>', PHYS_RAMP)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
      {
        float zfr = pow( 1.0 - abs( dot( geometryNormal, geometryViewDir ) ), 3.0 );
        #if NUM_HEMI_LIGHTS > 0
        reflectedLight.indirectDiffuse += BRDF_Lambert( diffuseColor.rgb ) * hemisphereLights[ 0 ].skyColor * zfr * ${f(K.rim * 1.6)};
        #endif
        #if NUM_DIR_LIGHTS > 0 && ${trans > 0 ? 1 : 0}
        { vec3 zl = directionalLights[ 0 ].direction; float zb = pow( saturate( dot( -geometryViewDir, zl ) ), 4.0 );
          reflectedLight.indirectDiffuse += BRDF_Lambert( diffuseColor.rgb ) * directionalLights[ 0 ].color * zb * ${f(trans)} * ( 1.0 - saturate( dot( geometryNormal, zl ) ) ); }
        #endif
      }`);
    if (clump) fr = fr.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n normal = normalize( vNormal );');
    sh.vertexShader = v; sh.fragmentShader = fr;
  };
  mat.customProgramCacheKey = () => prevKey() + `|zm:${kind}${clump ? 'c' : ''}${wind ? 'w' : ''}${trans > 0 ? 't' : ''}`;
  mat.needsUpdate = true;
  return mat;
}
// a crown centre from a foliage geometry's bounds (object space)
export function clumpOf(geos) {
  const b = new THREE.Box3();
  for (const g of [].concat(geos)) { if (!g.boundingBox) g.computeBoundingBox(); b.union(g.boundingBox); }
  const c = b.getCenter(new THREE.Vector3()); c.y = b.min.y + (b.max.y - b.min.y) * 0.55;
  return { center: c, height: Math.max(0.5, b.max.y) };
}
