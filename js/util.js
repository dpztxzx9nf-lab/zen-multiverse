// Small shared helpers: seeded random, value noise, merging geometry.
import * as THREE from 'three';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash3(x, y, z) {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const fade = (t) => t * t * (3 - 2 * t);
export function noise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = fade(xf), v = fade(yf), w = fade(zf);
  const l = (a, b, t) => a + (b - a) * t;
  const c000 = hash3(xi, yi, zi), c100 = hash3(xi + 1, yi, zi);
  const c010 = hash3(xi, yi + 1, zi), c110 = hash3(xi + 1, yi + 1, zi);
  const c001 = hash3(xi, yi, zi + 1), c101 = hash3(xi + 1, yi, zi + 1);
  const c011 = hash3(xi, yi + 1, zi + 1), c111 = hash3(xi + 1, yi + 1, zi + 1);
  return l(l(l(c000, c100, u), l(c010, c110, u), v), l(l(c001, c101, u), l(c011, c111, u), v), w) * 2 - 1;
}
export function fbm3(x, y, z, oct = 4) {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += a * noise3(x * f, y * f, z * f); f *= 2.03; a *= 0.5; }
  return s;
}

export const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;

// Merge geometries (converted to non-indexed) that share position/normal (+ optional color/uv).
export function mergeGeometries(geoms) {
  const parts = geoms.map((g) => (g.index ? g.toNonIndexed() : g));
  const names = ['position', 'normal', 'color', 'uv'].filter((n) => parts.every((p) => p.attributes[n]));
  const out = new THREE.BufferGeometry();
  for (const n of names) {
    const size = parts[0].attributes[n].itemSize;
    let len = 0; for (const p of parts) len += p.attributes[n].array.length;
    const arr = new Float32Array(len);
    let off = 0;
    for (const p of parts) { arr.set(p.attributes[n].array, off); off += p.attributes[n].array.length; }
    out.setAttribute(n, new THREE.BufferAttribute(arr, size));
  }
  return out;
}

export function paintColor(geom, color) {
  const n = geom.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = color.r; arr[i * 3 + 1] = color.g; arr[i * 3 + 2] = color.b; }
  geom.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geom;
}

// Add gentle wind sway to a standard material. Sway is applied in model space after instancing,
// scaled by height above `base` relative to `height`.
// One shared wind field for everything that moves in the breeze: a gust front that rolls
// across the garden along uWindDir (two mismatched octaves, biased downwind) plus a little
// flutter. windGust() below is the same formula in JS (falling leaves, audio swells).
export const WIND_GLSL = `
uniform float uTime; uniform float uWind; uniform vec2 uWindDir;
float windGust(vec2 p) {
  float a = dot(p, uWindDir);
  float n = sin(p.x * 0.21 + uTime * 0.13) * sin(p.y * 0.17 - uTime * 0.11);
  float g = 0.5 + 0.5 * sin(a * 0.16 - uTime * 0.85 + n * 1.5);
  float g2 = 0.5 + 0.5 * sin(a * 0.07 - uTime * 0.23 + 2.0);
  return 0.3 + pow(g, 1.6) * 0.7 + g2 * 0.35;
}
vec3 windOffset(vec3 wp, float k) {
  float g = windGust(wp.xz) * uWind;
  float fl = sin(uTime * 2.3 + wp.x * 0.9 + wp.z * 0.7) * 0.18 + sin(uTime * 3.7 + wp.z * 1.3) * 0.08;
  vec2 perp = vec2(-uWindDir.y, uWindDir.x);
  vec2 d = uWindDir * (g + fl * 0.5) + perp * fl * 0.6;
  return vec3(d.x, -0.15 * g * g, d.y) * k;
}
`;
export function windGust(x, z, t, dir) {
  const a = x * dir.x + z * dir.y;
  const n = Math.sin(x * 0.21 + t * 0.13) * Math.sin(z * 0.17 - t * 0.11);
  const g = 0.5 + 0.5 * Math.sin(a * 0.16 - t * 0.85 + n * 1.5);
  const g2 = 0.5 + 0.5 * Math.sin(a * 0.07 - t * 0.23 + 2.0);
  return 0.3 + Math.pow(g, 1.6) * 0.7 + g2 * 0.35;
}

// Gentle wind sway for any material (instanced or not) driven by the shared wind field.
export function addSway(material, uniforms, { height = 3, amp = 0.15, base = 0, extra = null } = {}) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uWind = uniforms.uWind;
    shader.uniforms.uWindDir = uniforms.uWindDir;
    if (uniforms.uSnow) shader.uniforms.uSnow = uniforms.uSnow;
    shader.vertexShader = WIND_GLSL + shader.vertexShader.replace(
      '#include <project_vertex>',
      `vec4 mvPosition = vec4( transformed, 1.0 );
      #ifdef USE_INSTANCING
        mvPosition = instanceMatrix * mvPosition;
      #endif
      {
        vec4 wp = modelMatrix * mvPosition;
        float hh = max(mvPosition.y - ${base.toFixed(3)}, 0.0) / ${height.toFixed(3)};
        mvPosition.xyz += windOffset(wp.xyz, hh * hh * ${amp.toFixed(3)});
      }
      mvPosition = modelViewMatrix * mvPosition;
      gl_Position = projectionMatrix * mvPosition;`
    );
    if (extra) extra(shader);
  };
  material.customProgramCacheKey = () => 'sway' + height + amp + base + (extra ? 'x' : '');
  return material;
}

// Icosphere with smooth (radial) normals: soft blobs even at very low detail.
export function softBlob(detail) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position, n = g.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), l = Math.hypot(x, y, z) || 1;
    n.setXYZ(i, x / l, y / l, z / l);
  }
  return g;
}
