// Raked Light, second brush ("bold"): the game's one shared look (see mom-garden-notes/art-bible.md).
// The world is real. The brush is ours. Physics, light direction, shadows and the sim's colours stay true;
// how they are painted is ours, and it reaches every lit material in every world:
// 1) The tonemap (the ACES slot every world goes through): hue-preserving, saturation that blooms in the
//    mid-tones and falls off into deep shadow and toward warm paper-white highlights.
// 2) Painted light for EVERY standard material (a ShaderChunk patch, so characters, fauna, camps and props
//    get it without opting in): the sun's N.L goes through three soft brush bands (shadow / half-tone /
//    lit), the key light runs warm and the sky fill cool (shadows are cool ink, never black), and a crisp
//    rim of sunlight wraps silhouettes when the sun is behind them.
// 3) Aerial perspective: fog shifts hue with distance (near haze bluer, far haze the sky's own colour).
// 4) stylize(material, kind): per-kind band shapes, sky rim, leaf translucency, clump normals, wind sway,
//    a soft root-to-tip gradient for foliage and grass, and flatter faceted planes for rock.
// Outlines are a screen pass (js/ink.js); the painted sky is in js/sky.js and the planet's sky dome.
import * as THREE from 'three';

// ?look=0 turns the whole look off (A/B frame-cost checks, or a quick escape hatch)
export const LOOK_ON = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('look') === '0');
const CH = THREE.ShaderChunk;
const TM = CH.tonemapping_pars_fragment;
if (LOOK_ON && !TM.includes('zmACESRef')) {
  CH.tonemapping_pars_fragment = TM.replace('vec3 ACESFilmicToneMapping( vec3 color ) {', 'vec3 zmACESRef( vec3 color ) {')
    + `
vec3 ACESFilmicToneMapping( vec3 color ) {
  vec3 a = zmACESRef( color );
  float L = dot( color, vec3( 0.2126, 0.7152, 0.0722 ) );
  float Lt = zmACESRef( vec3( L ) ).g;
  vec3 hp = color * ( Lt / max( L, 1e-6 ) );
  float m = max( hp.r, max( hp.g, hp.b ) );
  if ( m > 1.0 ) hp = vec3( Lt ) + ( hp - vec3( Lt ) ) * ( ( 1.0 - Lt ) / max( m - Lt, 1e-4 ) );
  vec3 c = mix( a, hp, 0.7 );
  float o = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
  // painted saturation: rich mid-tones, chalky highlights, shadows that keep their hue (lifted off black)
  float s = 1.0 + 0.34 * smoothstep( 0.02, 0.25, o ) - 0.2 * smoothstep( 0.55, 0.97, o ) - 0.06 * ( 1.0 - smoothstep( 0.0, 0.04, o ) );
  c = mix( vec3( o ), c, s );
  c = mix( c, c * vec3( 1.0, 0.98, 0.94 ), smoothstep( 0.6, 1.0, o ) * 0.5 );
  c = c * 0.955 + vec3( 0.03, 0.032, 0.045 ) * ( 1.0 - smoothstep( 0.0, 0.3, o ) );
  return saturate( c );
}`;
}

// ---- painted light, for every MeshStandard/Physical material (stylize() only tunes it per kind)
// Defaults are for things people made and for bodies; stylize() defines ZM_* before the chunk.
const RAMP = `
#ifndef ZM_WRAP
#define ZM_WRAP 0.22
#endif
#ifndef ZM_BAND
#define ZM_BAND 0.5
#endif
#ifndef ZM_TOON
#define ZM_TOON 0.82
#endif
// soft ramp -> three brush bands. Values: core shadow 0, half-tone 0.58, lit 1. Each edge is a short soft
// stroke (never an aliased cel line); ZM_TOON mixes the bands over the plain soft ramp.
float zmRamp( float x ) {
  float d = clamp( ( x + ZM_WRAP ) / ( 1.0 + ZM_WRAP ), 0.0, 1.0 );
  float soft = mix( d, smoothstep( 0.0, 0.7, d ), ZM_BAND );
  float bands = 0.58 * smoothstep( 0.14, 0.24, d ) + 0.42 * smoothstep( 0.47, 0.6, d );
  return mix( soft, bands, ZM_TOON );
}
`;
const DIFF = 'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );';
const PHYS = CH.lights_physical_pars_fragment;
if (LOOK_ON && !PHYS.includes('zmRamp')) {
  if (!PHYS.includes(DIFF)) console.warn('[look] ramp hook not found in this three.js version');
  // only the diffuse term takes the bands: specular keeps the true N.L (a wrapped N.L under GGX at grazing
  // angles blows up to white)
  CH.lights_physical_pars_fragment = RAMP + PHYS.replace(DIFF, 'reflectedLight.directDiffuse += zmRamp( dot( geometryNormal, directLight.direction ) ) * directLight.color * BRDF_Lambert( material.diffuseColor );');
}
// warm key, cool fill, and the sun rim. ZM_RIMK (sun rim) / ZM_COOL (fill tint strength) per kind.
const END = CH.lights_fragment_end;
if (LOOK_ON && !END.includes('zmRimK')) {
  CH.lights_fragment_end = END + `
#if defined( RE_Direct ) && !defined( ZM_PLAIN )
{
  #ifndef ZM_RIMK
  #define ZM_RIMK 0.55
  #endif
  #ifndef ZM_COOL
  #define ZM_COOL 1.0
  #endif
  const float zmRimK = ZM_RIMK;
  reflectedLight.indirectDiffuse *= mix( vec3( 1.0 ), vec3( 0.84, 0.96, 1.2 ), ZM_COOL );
  reflectedLight.directDiffuse *= mix( vec3( 1.0 ), vec3( 1.08, 1.0, 0.88 ), ZM_COOL );
  #if NUM_DIR_LIGHTS > 0
  {
    vec3 zl = directionalLights[ 0 ].direction;
    float znv = saturate( dot( geometryNormal, geometryViewDir ) );
    float zback = saturate( dot( -geometryViewDir, zl ) * 0.5 + 0.5 );
    float zrim = smoothstep( 0.62, 0.8, 1.0 - znv ) * smoothstep( -0.35, 0.25, dot( geometryNormal, zl ) );
    reflectedLight.directDiffuse += directionalLights[ 0 ].color * ( diffuseColor.rgb * 0.6 + 0.12 ) * zrim * zback * zmRimK * RECIPROCAL_PI;
  }
  #endif
}
#endif
`;
}
// softer photo detail on every lit opaque surface: scans sample about one mip softer, so grit reads as brushwork
// (not cut-out cards: their soft mips bleed the dark transparent texels into the leaf colour)
const MAPF = CH.map_fragment;
if (LOOK_ON && !MAPF.includes('ZM_SHARP')) {
  CH.map_fragment = MAPF.replace('texture2D( map, vMapUv )', `texture2D( map, vMapUv
  #if defined( RE_Direct ) && !defined( ZM_SHARP ) && !defined( USE_ALPHATEST ) && !defined( USE_ALPHAHASH ) && !defined( USE_TRANSMISSION )
  , 1.2
  #endif
  )`);
}
// aerial perspective: nearer haze leans blue, far haze is the fog's (the sky's) own colour
const FOG = CH.fog_fragment;
if (LOOK_ON && !FOG.includes('zmFogC')) {
  CH.fog_fragment = FOG.replace('gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );',
    `vec3 zmFogC = mix( fogColor * vec3( 0.78, 0.9, 1.16 ), fogColor, smoothstep( 0.15, 0.85, fogFactor ) );
	gl_FragColor.rgb = mix( gl_FragColor.rgb, zmFogC, fogFactor );`);
}

// shared by every stylized material: time and the world's wind (m/s, xz). Worlds call setWind().
export const LOOK = { zmTime: { value: 0 }, zmWind: { value: new THREE.Vector2(1.5, 0.6) } };
export function tickLook(dt) { LOOK.zmTime.value += dt; }
export function setWind(x, z) { LOOK.zmWind.value.set(x, z); }

// per kind: wrap, band (soft step), toon (how much of the three bands), rim (sky light at grazing),
// sun (sun rim), translucency, wind, grad (root-to-tip value), facet (flat planes, rock)
export const KINDS = {
  leaf: { wrap: 0.45, band: 0.55, toon: 0.85, rim: 0.35, sun: 0.8, trans: 0.6, wind: 1, grad: 0.4 },
  grass: { wrap: 0.6, band: 0.4, toon: 0.35, rim: 0.25, sun: 0.5, trans: 0.4, wind: 1, grad: 0.35 },
  wood: { wrap: 0.2, band: 0.45, toon: 0.8, rim: 0.2, sun: 0.5, trans: 0, wind: 0 },
  terrain: { wrap: 0.12, band: 0.35, toon: 0.15, rim: 0.1, sun: 0.0, trans: 0, wind: 0 },
  rock: { wrap: 0.08, band: 0.45, toon: 0.9, rim: 0.18, sun: 0.45, trans: 0, wind: 0, facet: 0.55 },
  skin: { wrap: 0.3, band: 0.5, toon: 0.85, rim: 0.45, sun: 0.9, trans: 0, wind: 0 },
  cloth: { wrap: 0.3, band: 0.55, toon: 0.85, rim: 0.45, sun: 0.8, trans: 0.08, wind: 0 },
  made: { wrap: 0.15, band: 0.5, toon: 0.85, rim: 0.3, sun: 0.6, trans: 0, wind: 0 },
};
const f = (x) => (+x).toFixed(4);

// stylize(mat, 'leaf', { clump: Vector3 (object-space crown centre), clumpK: 0..1, height: m, wind: bool, lite })
export function stylize(mat, kind = 'made', o = {}) {
  if (!LOOK_ON || !mat || mat.userData.zmLook || !mat.isMeshStandardMaterial) return mat;
  const K = { ...KINDS[kind], ...(o.k || {}) };
  const wind = o.wind !== undefined ? o.wind : !!K.wind, trans = o.lite ? 0 : K.trans;
  const clump = o.clump && kind === 'leaf';
  const grad = K.grad || 0, facet = K.facet || 0;
  const U = { zmClump: { value: clump ? o.clump.clone() : new THREE.Vector3() }, zmH: { value: o.height || 4 } };
  mat.userData.zmLook = { kind, U };
  const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey ? mat.customProgramCacheKey.bind(mat) : () => '';
  mat.onBeforeCompile = function (sh, r) {
    if (prev) prev.call(this, sh, r);
    Object.assign(sh.uniforms, LOOK, U);
    let v = sh.vertexShader, fr = sh.fragmentShader;
    v = v.replace('#include <common>', `#include <common>
      uniform float zmTime; uniform vec2 zmWind; uniform vec3 zmClump; uniform float zmH;${grad ? ' varying float zmGy;' : ''}`);
    if (grad) v = v.replace('#include <begin_vertex>', `#include <begin_vertex>
      zmGy = clamp( position.y / max( zmH, 0.05 ), 0.0, 1.0 );`);
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
    // the per-kind band shape: macros read by the shared ramp (they must come before the lights chunk)
    fr = `#define ZM_WRAP ${f(K.wrap)}\n#define ZM_BAND ${f(K.band)}\n#define ZM_TOON ${f(K.toon ?? 0.8)}\n#define ZM_RIMK ${f(K.sun ?? 0.5)}\n` + fr;
    fr = fr.replace('#include <common>', `#include <common>${grad ? '\n varying float zmGy;' : ''}`)
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
    // foliage: darker, cooler at the root, lighter and warmer toward the tips (one soft gradient per clump)
    if (grad) fr = fr.replace('#include <color_fragment>', `#include <color_fragment>
      { float zl = dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) ); diffuseColor.rgb = max( mix( vec3( zl ), diffuseColor.rgb, 1.3 ), 0.0 ); }
      diffuseColor.rgb *= mix( ${f(1 - grad * 0.4)}, ${f(1 + grad * 0.5)}, zmGy );
      diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 1.18, 1.14, 0.72 ), smoothstep( 0.55, 1.0, zmGy ) * ${f(grad * 0.8)} );`);
    if (clump) fr = fr.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n normal = normalize( vNormal );');
    // rock: flatter, faceted planes (chiselled light instead of photo bumps)
    if (facet) fr = fr.replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
      { vec3 zfn = normalize( cross( dFdx( vViewPosition ), dFdy( vViewPosition ) ) ); if ( dot( zfn, normal ) < 0.0 ) zfn = -zfn; normal = normalize( mix( normal, zfn, ${f(facet)} ) ); }`);
    sh.vertexShader = v; sh.fragmentShader = fr;
  };
  mat.customProgramCacheKey = () => prevKey() + `|zm2:${kind}${clump ? 'c' : ''}${wind ? 'w' : ''}${trans > 0 ? 't' : ''}${grad ? 'g' : ''}${facet ? 'f' : ''}`;
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

// De-lighting scans (art bible 9, steps 3-4). Photo scans carry the light of the day they were shot:
// baked shadows between pebbles, sun-bleached tops, and pixel-sharp grit. The sim lights the world, so
// the scan may only say what the ground is made of. zmDelight() squeezes the scan's luminance toward its
// own mean (hue and the large tonal shapes stay, baked shading mostly goes); ZM_DL_BIAS samples one mip
// softer, so grit becomes brushwork (and phones read less texture memory per pixel).
export const DELIGHT = { k: 0.7, bias: 1.5, normalK: 0.5 };
export const DELIGHT_GLSL = `
vec3 zmDelight( vec3 c, vec3 mean, float k ) {
  const vec3 W = vec3( 0.2126, 0.7152, 0.0722 );
  float L = max( dot( c, W ), 1e-4 ), M = max( dot( mean, W ), 1e-4 );
  return c * ( M * pow( L / M, 1.0 - k ) / L );
}`;
// for a material that uses a standard .map scan (e.g. the garden lawn): mean = the scan's average colour
export function delightMap(mat, mean, o = {}) {
  if (!LOOK_ON || !mat || mat.userData.zmDelight) return mat;
  const k = o.k ?? DELIGHT.k, bias = o.bias ?? DELIGHT.bias;
  const U = { zmDlMean: { value: new THREE.Vector3(...mean) } };
  mat.userData.zmDelight = U;
  const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey ? mat.customProgramCacheKey.bind(mat) : () => '';
  mat.onBeforeCompile = function (sh, r) {
    if (prev) prev.call(this, sh, r);
    Object.assign(sh.uniforms, U);
    const chunk = THREE.ShaderChunk.map_fragment
      .replace('texture2D( map, vMapUv )', `texture2D( map, vMapUv, ${f(bias)} )`)
      .replace('diffuseColor *= sampledDiffuseColor;', `sampledDiffuseColor.rgb = zmDelight( sampledDiffuseColor.rgb, zmDlMean, ${f(k)} );\n diffuseColor *= sampledDiffuseColor;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform vec3 zmDlMean;\n${DELIGHT_GLSL}`)
      .replace('#include <map_fragment>', chunk)
      .replace(/vec4 b = texture2D\(\s*map,\s*q\s*\);/, `vec4 b = texture2D( map, q, ${f(bias)} ); b.rgb = zmDelight( b.rgb, zmDlMean, ${f(k)} );`);
  };
  mat.customProgramCacheKey = () => prevKey() + '|zmdl';
  mat.needsUpdate = true;
  return mat;
}
