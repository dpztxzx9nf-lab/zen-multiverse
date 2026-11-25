// Soft rain streaks and drifting snow, both moved entirely on the GPU and pushed by the
// shared wind. Plus a helper that dusts upward-facing surfaces with snow in winter.
import * as THREE from 'three';
import { mulberry32 } from './util.js';

export function addSnowCover(material, uSnow, { strength = 1 } = {}) {
  const prev = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey ? material.customProgramCacheKey.bind(material) : () => '';
  material.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    sh.uniforms.uSnow = uSnow;
    sh.vertexShader = 'varying vec3 vSnowN; varying vec3 vSnowP;\n' + sh.vertexShader.replace('#include <beginnormal_vertex>',
      '#include <beginnormal_vertex>\n vSnowN = normalize(mat3(modelMatrix) * objectNormal);')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n vSnowP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = 'uniform float uSnow; varying vec3 vSnowN; varying vec3 vSnowP;\n' + sh.fragmentShader.replace('#include <color_fragment>',
      `#include <color_fragment>
       { // smooth value noise (no blocky cells up close at eye level)
         vec2 sp = vSnowP.xz * 2.5 + vSnowP.y * 1.3, si = floor(sp), sf = fract(sp); sf = sf * sf * (3.0 - 2.0 * sf);
         #define SH(o) fract(sin(dot(si + o, vec2(12.9898, 78.233))) * 43758.5453)
         float n = mix(mix(SH(vec2(0, 0)), SH(vec2(1, 0)), sf.x), mix(SH(vec2(0, 1)), SH(vec2(1, 1)), sf.x), sf.y);
         #undef SH
         float k = smoothstep(0.35, 0.85, vSnowN.y + (n - 0.5) * 0.35) * uSnow * ${strength.toFixed(2)};
         diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.95, 1.0), k); }`);
  };
  material.customProgramCacheKey = () => prevKey() + 'snow';
  return material;
}

export function createWeather(scene, { P, sway, center }) {
  const group = new THREE.Group();
  scene.add(group);
  const AREA = new THREE.Vector3(44, 16, 34);
  const u = {
    uTime: sway.uTime, uWind: sway.uWind, uWindDir: sway.uWindDir,
    uAmt: { value: 0 }, uCenter: { value: new THREE.Vector3(center.x, 0, center.y) }, uArea: { value: AREA },
    uScale: { value: 300 }, uColor: { value: new THREE.Color('#cfd9e6') }, uLight: { value: 1 },
  };
  const rnd = mulberry32(77);

  // ---- rain: short streaks (line segments), only on when it rains
  const NR = P.cls === 'pc' ? 4200 : P.cls === 'tablet' ? 1800 : 1100;
  const rg = new THREE.BufferGeometry();
  const rp = new Float32Array(NR * 6), rs = new Float32Array(NR * 2), re = new Float32Array(NR * 2);
  for (let i = 0; i < NR; i++) {
    const x = rnd(), y = rnd(), z = rnd(), sd = rnd();
    for (let k = 0; k < 2; k++) { rp.set([x, y, z], (i * 2 + k) * 3); rs[i * 2 + k] = sd; re[i * 2 + k] = k; }
  }
  rg.setAttribute('position', new THREE.BufferAttribute(rp, 3));
  rg.setAttribute('aSeed', new THREE.BufferAttribute(rs, 1));
  rg.setAttribute('aEnd', new THREE.BufferAttribute(re, 1));
  const rainMat = new THREE.ShaderMaterial({
    uniforms: u, transparent: true, depthWrite: false,
    vertexShader: `uniform float uTime, uWind, uAmt; uniform vec2 uWindDir; uniform vec3 uCenter, uArea; attribute float aSeed, aEnd; varying float vA;
      void main() {
        float sp = 9.0 + aSeed * 3.0;
        float y = fract(position.y - uTime * sp / uArea.y);
        vec3 p = uCenter + (position - 0.5) * uArea; p.y = y * uArea.y;
        vec2 drift = uWindDir * (0.8 + uWind * 0.9);
        p.xz += drift * (1.0 - y) * 1.5;
        p.y += aEnd * 0.85; p.xz -= drift * aEnd * 0.14;
        vA = uAmt * step(aSeed, uAmt) * (0.18 + 0.3 * aEnd) * smoothstep(0.0, 0.08, y);
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `uniform vec3 uColor; uniform float uLight; varying float vA; void main() { gl_FragColor = vec4(uColor * uLight, vA); }`,
  });
  const rain = new THREE.LineSegments(rg, rainMat);
  rain.frustumCulled = false; rain.visible = false;
  group.add(rain);

  // ---- snow: soft round flakes that wander on the wind
  const NS = P.cls === 'pc' ? 2600 : P.cls === 'tablet' ? 1200 : 750;
  const sg = new THREE.BufferGeometry();
  const sp = new Float32Array(NS * 3), ss = new Float32Array(NS);
  for (let i = 0; i < NS; i++) { sp.set([rnd(), rnd(), rnd()], i * 3); ss[i] = rnd(); }
  sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  sg.setAttribute('aSeed', new THREE.BufferAttribute(ss, 1));
  const snowMat = new THREE.ShaderMaterial({
    uniforms: u, transparent: true, depthWrite: false,
    vertexShader: `uniform float uTime, uWind, uAmt, uScale; uniform vec2 uWindDir; uniform vec3 uCenter, uArea; attribute float aSeed; varying float vA;
      void main() {
        float sp = 0.55 + aSeed * 0.5;
        float y = fract(position.y - uTime * sp / uArea.y);
        vec3 p = uCenter + (position - 0.5) * uArea; p.y = y * uArea.y;
        float ph = uTime * (0.5 + aSeed) + aSeed * 40.0;
        p.x += sin(ph) * 0.6 + uWindDir.x * uWind * (1.0 - y) * 3.0;
        p.z += cos(ph * 0.8) * 0.5 + uWindDir.y * uWind * (1.0 - y) * 3.0;
        vec4 mv = viewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = min(uScale * (0.035 + 0.03 * aSeed) / -mv.z, 14.0);
        vA = uAmt * step(aSeed, uAmt) * smoothstep(0.0, 0.05, y) * 0.85;
      }`,
    fragmentShader: `uniform float uLight; varying float vA; void main() { vec2 c = gl_PointCoord - 0.5; float d = dot(c, c); if (d > 0.25) discard; gl_FragColor = vec4(vec3(0.97, 0.98, 1.0) * uLight, vA * smoothstep(0.25, 0.05, d)); }`,
  });
  const snow = new THREE.Points(sg, snowMat);
  snow.frustumCulled = false; snow.visible = false;
  group.add(snow);

  let rainT = 0, snowT = 0, rainA = 0, snowA = 0, first = true;
  function set({ rain: r, snow: s }) { rainT = r; snowT = s; if (first) { rainA = r; snowA = s; first = false; } }
  function update(dt, ts) {
    rainA += (rainT - rainA) * Math.min(1, dt * 0.3);
    snowA += (snowT - snowA) * Math.min(1, dt * 0.3);
    rain.visible = rainA > 0.01; snow.visible = snowA > 0.01;
    u.uLight.value = 0.35 + 0.65 * (1 - ts.night);
    return { rain: rainA, snow: snowA };
  }
  function setPointScale(px) { u.uScale.value = px; }
  // rain amount drives both visibility (u.uAmt) per material
  rain.onBeforeRender = () => { u.uAmt.value = rainA; };
  snow.onBeforeRender = () => { u.uAmt.value = snowA; };
  return { set, update, setPointScale, get rain() { return rainA; }, get snow() { return snowA; } };
}
