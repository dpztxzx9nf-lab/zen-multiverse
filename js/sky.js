// Real-time sky: sun/moon from the local clock, gradient sky dome with clouds and stars,
// and the lighting state that drives the rest of the garden.
import * as THREE from 'three';
import { smoothstep, clamp, lerp } from './util.js';

const KEYS = [
  // sun elevation (deg), zenith, horizon, light color, light intensity, hemi sky, hemi ground, hemi intensity, fog density, exposure
  { e: -90, z: '#03050f', h: '#0a1028', l: '#8ea6ff', li: 0.0, hs: '#24335e', hg: '#090c16', hi: 0.55, f: 0.0085, x: 1.25 },
  { e: -14, z: '#050a20', h: '#121a3c', l: '#8ea6ff', li: 0.0, hs: '#26375f', hg: '#0a0d18', hi: 0.55, f: 0.0085, x: 1.25 },
  { e: -7, z: '#141c48', h: '#4a3a66', l: '#ff9a6a', li: 0.0, hs: '#3a3f72', hg: '#141220', hi: 0.6, f: 0.0055, x: 1.15 },
  { e: -2, z: '#2a3f7c', h: '#e0805a', l: '#ff8a50', li: 0.0, hs: '#6a6aa0', hg: '#2a2020', hi: 0.7, f: 0.005, x: 1.05 },
  { e: 2, z: '#4a6fb0', h: '#ffa468', l: '#ff9858', li: 1.2, hs: '#9aa0c8', hg: '#3a3024', hi: 0.8, f: 0.0048, x: 1.0 },
  { e: 9, z: '#4f86cc', h: '#f6cfa6', l: '#ffc48a', li: 2.2, hs: '#b0c4e0', hg: '#4a4030', hi: 0.9, f: 0.0052, x: 1.0 },
  { e: 22, z: '#2f72d0', h: '#93c0e8', l: '#fff0d8', li: 3.4, hs: '#a8c8ec', hg: '#55503c', hi: 0.8, f: 0.0055, x: 1.0 },
  { e: 90, z: '#2a6ccc', h: '#9cc6ec', l: '#ffffff', li: 3.6, hs: '#b0d0f0', hg: '#5a5640', hi: 0.85, f: 0.005, x: 1.0 },
].map((k) => ({ ...k, z: new THREE.Color(k.z), h: new THREE.Color(k.h), l: new THREE.Color(k.l), hs: new THREE.Color(k.hs), hg: new THREE.Color(k.hg) }));

const DEG = Math.PI / 180;

export function computeTime(hour, date) {
  const start = new Date(date.getFullYear(), 0, 0);
  const doy = (date - start) / 86400000;
  const lat = 40;
  const decl = 23.44 * Math.sin((2 * Math.PI * (doy - 81)) / 365);
  const maxElev = clamp(90 - lat + decl, 15, 80);
  const dayLen = 12 + 2.9 * Math.sin((2 * Math.PI * (doy - 81)) / 365);
  const noon = 12.6;
  const rise = noon - dayLen / 2, set = noon + dayLen / 2;
  let phi;
  if (hour >= rise && hour <= set) phi = (Math.PI * (hour - rise)) / dayLen;
  else {
    const nightLen = 24 - dayLen;
    const since = (hour - set + 24) % 24;
    phi = Math.PI + (Math.PI * since) / nightLen;
  }
  const s = Math.sin(phi);
  const elev = s >= 0 ? Math.asin(s * Math.sin(maxElev * DEG)) / DEG : Math.asin(s * Math.sin(60 * DEG)) / DEG;
  // the garden faces the low sun: sunrise and sunset sit just inside the view, behind the bamboo
  const ax = Math.cos(phi) * 0.85, az = -0.55 - 0.75 * (1 - Math.max(s, 0));
  const al = Math.hypot(ax, az);
  const ce = Math.cos(elev * DEG);
  const sunDir = new THREE.Vector3((ax / al) * ce, Math.sin(elev * DEG), (az / al) * ce).normalize();

  // Moon: rides high across the night sky, opposite-ish to the sun.
  // (visual moon stays low over the back wall so it can be seen; its light comes from higher up)
  const mphi = phi - Math.PI;
  const ms = Math.sin(mphi);
  const melev = Math.max(ms, -0.3) * 9 + 3.5;
  const mx = Math.cos(mphi) * 0.55, mz = -1.0;
  const ml = Math.hypot(mx, mz), mce = Math.cos(melev * DEG);
  const moonDir = new THREE.Vector3((mx / ml) * mce, Math.sin(melev * DEG), (mz / ml) * mce).normalize();
  const moonLightDir = new THREE.Vector3(mx / ml * 0.6, 0.75, -0.45).normalize();

  // Interpolate palette by elevation
  let i = 0;
  while (i < KEYS.length - 2 && elev > KEYS[i + 1].e) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const t = smoothstep(a.e, b.e, elev);
  const mix = (k) => a[k].clone().lerp(b[k], t);
  const night = smoothstep(-3, -12, elev);
  return {
    hour, elev, sunDir, moonDir, moonLightDir, night,
    zenith: mix('z'), horizon: mix('h'), lightColor: mix('l'),
    sunIntensity: lerp(a.li, b.li, t) * smoothstep(-1.5, 3, elev),
    hemiSky: mix('hs'), hemiGround: mix('hg'), hemiIntensity: lerp(a.hi, b.hi, t),
    fog: lerp(a.f, b.f, t), exposure: lerp(a.x, b.x, t),
    golden: smoothstep(14, 3, elev) * smoothstep(-8, 0, elev),
  };
}

export function createSky(scene, segs = [48, 24]) {
  const uniforms = {
    uZenith: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uMoonDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color() },
    uNight: { value: 0 },
    uSunVis: { value: 1 },
    uGolden: { value: 0 },
    uTime: { value: 0 },
    uOvercast: { value: 0 },
    // photographic sky (skyphoto.js): upper-hemisphere equirect, sRGB-ish LDR scaled by uPhotoWhite
    uPhoto: { value: null }, uPhotoK: { value: 0 }, uPhotoRot: { value: 0 }, uPhotoWhite: { value: 1 }, uPhotoGain: { value: 1 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position + cameraPosition, 1.0);
        gl_Position = vec4(p.xy, p.w * 0.99995, p.w);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uZenith, uHorizon, uSunDir, uMoonDir, uSunColor;
      uniform float uNight, uSunVis, uGolden, uTime, uOvercast;
      uniform sampler2D uPhoto; uniform float uPhotoK, uPhotoRot, uPhotoWhite, uPhotoGain;
      varying vec3 vDir;
      float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vnoise(vec2 p) {
        vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash2(i), hash2(i + vec2(1, 0)), f.x), mix(hash2(i + vec2(0, 1)), hash2(i + vec2(1, 1)), f.x), f.y);
      }
      float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * vnoise(p); p *= 2.07; a *= 0.5; } return s; }
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        float g = pow(smoothstep(-0.02, 0.5, h), 0.5);
        vec3 col = mix(uHorizon, uZenith, g);
        float sd = max(dot(d, uSunDir), 0.0);
        // warm band hugging the horizon on the sun's side at sunrise/sunset
        float side = pow(max(dot(normalize(vec3(d.x, 0.0, d.z)), normalize(vec3(uSunDir.x, 0.0, uSunDir.z))), 0.0), 2.0);
        col += uSunColor * uGolden * side * exp(-max(h, 0.0) * 9.0) * 0.45;
        col += uSunColor * (pow(sd, 6.0) * 0.22 + pow(sd, 48.0) * 0.45) * uSunVis;
        col += uSunColor * smoothstep(0.99935, 0.9997, sd) * 10.0 * uSunVis;
        // clouds
        if (h > 0.0 && uPhotoK < 0.999) {
          vec2 cp = d.xz / (h + 0.12) * 1.6 + vec2(uTime * 0.004, uTime * 0.0015);
          float c = fbm(cp);
          float cRaw = c;
          c = smoothstep(mix(0.47, 0.18, uOvercast), mix(0.78, 0.7, uOvercast), c) * smoothstep(0.0, 0.18, h);
          // Ghibli-ish cumulus: bright sunlit cores, soft blue-grey undersides
          float core = smoothstep(0.55, 0.95, cRaw);
          vec3 cloudDay = mix(mix(uZenith, uHorizon, 0.5) * 1.1 + vec3(0.12), vec3(1.25, 1.22, 1.15), core) + uSunColor * pow(sd, 3.0) * 0.35;
          vec3 cloudNight = uZenith * 1.8 + vec3(0.02, 0.025, 0.05);
          vec3 cc = mix(cloudDay, cloudNight, uNight);
          cc = mix(cc, uSunColor * 0.9 + uHorizon * 0.3, uGolden * 0.6);
          cc = mix(cc, mix(vec3(dot(cc, vec3(0.33))) * 0.92, cc, 0.4), uOvercast);
          col = mix(col, cc, c * mix(0.65, 0.92, uOvercast));
        }
        // photographic sky over the procedural one (clouds, real gradient); sun/moon/stars stay procedural
        if (uPhotoK > 0.001) {
          float ang = atan(d.z, d.x) + uPhotoRot;
          vec2 puv = vec2(ang / 6.2831853 + 0.5, asin(clamp(h, 0.0, 1.0)) / 1.5707963);
          vec3 ph = pow(texture2D(uPhoto, puv).rgb, vec3(2.2)) * uPhotoWhite * uPhotoGain;
          ph = ph / (1.0 + max(max(ph.r, ph.g), ph.b) * 0.35); // keep bright cloud tops under the bloom threshold
          // under the horizon the photo has no ground: keep the procedural haze there
          col = mix(col, ph, uPhotoK * smoothstep(-0.01, 0.025, h));
          col += uSunColor * smoothstep(0.99935, 0.9997, sd) * 10.0 * uSunVis * uPhotoK;
        }
        // moon
        float md = dot(d, uMoonDir);
        float moon = smoothstep(0.99925, 0.99945, md);
        vec3 mn = normalize(d - uMoonDir * md);
        float shade = 0.85 + 0.15 * (vnoise(mn.xy * 3000.0) );
        col = mix(col, vec3(1.0, 0.97, 0.9) * 1.45 * shade, moon * uNight);
        col += vec3(0.35, 0.45, 0.8) * (pow(max(md, 0.0), 300.0) * 0.32 + pow(max(md, 0.0), 30.0) * 0.08) * uNight;
        // stars
        if (uNight > 0.01 && h > 0.0) {
          vec3 sp = d * 170.0;
          vec3 cell = floor(sp);
          float r = hash(cell);
          if (r > 0.9) {
            vec3 off = vec3(hash(cell + 7.1), hash(cell + 3.3), hash(cell + 1.9)) * 0.6 + 0.2;
            float dist = length(fract(sp) - off);
            float tw = 0.55 + 0.45 * sin(uTime * (1.0 + r * 3.0) + r * 91.0);
            float big = smoothstep(0.985, 1.0, r);
            float st = smoothstep(0.28 + big * 0.14, 0.0, dist) * tw * (0.8 + big * 2.5);
            vec3 sc = mix(vec3(0.8, 0.88, 1.0), vec3(1.0, 0.9, 0.75), hash(cell + 5.0));
            col += sc * st * uNight * smoothstep(0.0, 0.06, h) * 1.6;
          }
          // faint milky band
          float band = exp(-pow(dot(d, normalize(vec3(0.5, 0.3, 0.8))) * 4.0, 2.0));
          col += vec3(0.08, 0.09, 0.14) * band * fbm(d.xy * 9.0 + d.z * 4.0) * uNight * smoothstep(0.0, 0.3, h);
        }
        // alpha > 1.5 marks open sky for the god-ray pass (opaque scene pixels write 1.0)
        gl_FragColor = vec4(col, 3.0);
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(400, segs[0], segs[1]), mat);
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  scene.add(sky);

  function update(ts, time) {
    uniforms.uZenith.value.copy(ts.zenith);
    uniforms.uHorizon.value.copy(ts.horizon);
    uniforms.uSunDir.value.copy(ts.sunDir);
    uniforms.uMoonDir.value.copy(ts.moonDir);
    uniforms.uSunColor.value.copy(ts.lightColor);
    uniforms.uNight.value = ts.night;
    uniforms.uSunVis.value = smoothstep(-4, 1, ts.elev) * (1 - 0.85 * (ts.overcast || 0));
    uniforms.uOvercast.value = ts.overcast || 0;
    uniforms.uGolden.value = ts.golden;
    uniforms.uTime.value = time;
  }
  return { mesh: sky, update, uniforms };
}
