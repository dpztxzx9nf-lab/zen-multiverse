// The sea, as one system: the waves (waves.js) drive the water surface the player sees, the buoyancy she
// feels, the water's motion that sways kelp and carries fish, and the splashes she throws up. Under the
// surface the light is absorbed by the water itself (red first, then green, blue last: Beer-Lambert per
// channel from liquidOf), so the deeper she goes the darker and bluer it gets and the shorter she sees.
//
//   const ocean = createOcean({ scene, camera, water, waterMat, lite })
//   ocean.load(W)                       per world (gravity, air density, sea level, the sea's own liquid)
//   ocean.liquid(x, z)                  for the walker: { surf, still, rho, pAtmKPa, breathable, flow(x,y,z) } or null
//   ocean.update(dt, { wind, swimmers })  waves follow the wind; splashes and wakes for every swimmer
//   ocean.underwater({ fog, sun, hemi, sky }) after the world set its light: tints it if the camera is under
import * as THREE from 'three';
import { createWaves } from './waves.js';
import { liquidOf } from './swim-phys.js';

// a grid that is dense near the middle (where she swims) and coarse far out: u -> sign(u) |u|^2.2
export function gradedPlane(size, segs) {
  const g = new THREE.PlaneGeometry(1, 1, segs, segs).rotateX(-Math.PI / 2), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i) * 2, z = p.getZ(i) * 2; p.setX(i, Math.sign(x) * Math.pow(Math.abs(x), 2.2) * size / 2); p.setZ(i, Math.sign(z) * Math.pow(Math.abs(z), 2.2) * size / 2); }
  const uv = g.attributes.uv; for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / size + 0.5, 0.5 - p.getZ(i) / size);
  g.computeBoundingSphere(); g.computeBoundingBox(); return g;
}

const WAVE_GLSL = `uniform vec4 uWA, uWK, uWDX, uWDZ, uWPH;
float zmWave(vec2 p, out vec2 sl) { float h = 0.0; sl = vec2(0.0);
  for (int i = 0; i < 4; i++) { float th = uWK[i] * (uWDX[i] * p.x + uWDZ[i] * p.y) - uWPH[i]; h += uWA[i] * sin(th); sl += uWA[i] * uWK[i] * cos(th) * vec2(uWDX[i], uWDZ[i]); }
  return h; }
`;
export function patchWaterMaterial(mat, U) {
  const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey ? mat.customProgramCacheKey.bind(mat) : null;
  mat.side = THREE.DoubleSide;
  mat.onBeforeCompile = function (sh, r) {
    if (prev) prev.call(this, sh, r);
    Object.assign(sh.uniforms, U);
    sh.vertexShader = WAVE_GLSL + sh.vertexShader
      .replace('#include <beginnormal_vertex>', `vec4 zmW = modelMatrix * vec4(position, 1.0); vec2 zmSl; float zmFade = 1.0 - smoothstep(120.0, 420.0, distance(zmW.xz, cameraPosition.xz));
        float zmH = zmWave(zmW.xz, zmSl) * zmFade; zmSl *= zmFade; vec3 objectNormal = normalize(vec3(-zmSl.x, 1.0, -zmSl.y));
        #ifdef USE_TANGENT
        vec3 objectTangent = vec3(tangent.xyz);
        #endif`)
      .replace('#include <begin_vertex>', 'vec3 transformed = vec3(position); transformed.y += zmH;');
  };
  mat.customProgramCacheKey = () => (prevKey ? prevKey() : '') + '|zmwave';
  mat.needsUpdate = true;
}

export function createOcean({ scene, camera, water = null, waterMat = null, lite = false }) {
  const U = { uWA: { value: new THREE.Vector4() }, uWK: { value: new THREE.Vector4() }, uWDX: { value: new THREE.Vector4() }, uWDZ: { value: new THREE.Vector4() }, uWPH: { value: new THREE.Vector4() } };
  if (waterMat) patchWaterMaterial(waterMat, U);
  let waves = createWaves(), still = null, liq = null, W = null, t0 = 0;
  const flowOut = [0, 0, 0];
  const L = { surf: 0, still: 0, rho: 1025, pAtmKPa: 101.325, breathable: true, flow: null };
  L.flow = (x, y, z) => { waves.orbital(x, z, L.still - y, flowOut); return flowOut; };
  // ---- splashes and wakes: droplets (points) and rings (instanced flat discs) on the surface
  const NP = lite ? 160 : 420, NR = lite ? 24 : 48;
  const dp = new Float32Array(NP * 3), dv = new Float32Array(NP * 3), dl = new Float32Array(NP), dsz = new Float32Array(NP);
  const dGeo = new THREE.BufferGeometry(); dGeo.setAttribute('position', new THREE.BufferAttribute(dp, 3)); dGeo.setAttribute('aLife', new THREE.BufferAttribute(dl, 1)); dGeo.setAttribute('aSize', new THREE.BufferAttribute(dsz, 1));
  const dMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { uCol: { value: new THREE.Color('#eef6f8') }, uScale: { value: 300 } },
    vertexShader: 'attribute float aLife; attribute float aSize; varying float vL; uniform float uScale; void main(){ vL = aLife; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = aLife > 0.0 ? min(18.0, aSize * uScale / max(0.5, -mv.z)) : 0.0; gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'uniform vec3 uCol; varying float vL; void main(){ vec2 c = gl_PointCoord - 0.5; float r = dot(c,c); if (r > 0.25) discard; gl_FragColor = vec4(uCol, clamp(vL, 0.0, 1.0) * 0.85 * (1.0 - r * 3.0)); }' });
  const drops = new THREE.Points(dGeo, dMat); drops.frustumCulled = false; drops.name = 'splash'; drops.userData.noCurve = true; scene.add(drops);
  const ringGeo = new THREE.RingGeometry(0.7, 1, lite ? 20 : 32).rotateX(-Math.PI / 2);
  const ringMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.32, depthWrite: false, blending: THREE.AdditiveBlending });
  const rings = new THREE.InstancedMesh(ringGeo, ringMat, NR); rings.name = 'wake'; rings.frustumCulled = false; rings.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  rings.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(NR * 3), 3); scene.add(rings);
  const R = Array.from({ length: NR }, () => ({ x: 0, z: 0, r: 0, grow: 0, life: 0, max: 1 }));
  let dI = 0, rI = 0;
  const m4 = new THREE.Matrix4(), q0 = new THREE.Quaternion(), vS = new THREE.Vector3(), vP = new THREE.Vector3();
  function splash(x, y, z, power = 1, spread = 0.4) {
    const n = Math.min(NP / 3, Math.round(6 + power * 22));
    for (let i = 0; i < n; i++) { const k = dI++ % NP, a = Math.random() * 6.283, s = (0.4 + Math.random()) * (0.8 + power * 0.9);
      dp[k * 3] = x + Math.sin(a) * spread * Math.random(); dp[k * 3 + 1] = y; dp[k * 3 + 2] = z + Math.cos(a) * spread * Math.random();
      dv[k * 3] = Math.sin(a) * s * 0.6; dv[k * 3 + 1] = (1.2 + Math.random() * 2.2) * (0.6 + power * 0.7); dv[k * 3 + 2] = Math.cos(a) * s * 0.6; dl[k] = 1; dsz[k] = 0.03 + Math.random() * 0.05 * (0.6 + power * 0.4); }
  }
  function ring(x, z, r0 = 0.3, grow = 1.2, life = 1.6) { const o = R[rI++ % NR]; o.x = x; o.z = z; o.r = r0; o.grow = grow; o.life = life; o.max = life; }
  const prevS = new Map(); // per swimmer: wake/stroke bookkeeping
  let gGrav = 9.81;
  const api = {
    get waves() { return waves; }, get liquidInfo() { return liq; }, get still() { return still; }, uniforms: U,
    load(w) {
      W = w; still = w && w.hasSea ? w.sea : null;
      const rules = w && w.rules; liq = still != null ? (liquidOf(rules) || liquidOf({ water: { liquid: true } })) : null;
      const P = rules && rules.atmosphere ? rules.atmosphere.pressureKPa || 0 : 101.325;
      gGrav = (w && w.gravity) || 9.81;
      waves = createWaves({ gravity: gGrav, airK: P / 101.325, seed: (w && w.seed) || 1 });
      waves.setWind(4, 0.6);
      if (liq) { L.rho = liq.rho; L.pAtmKPa = P; L.breathable = liq.breathable; }
      L.still = still ?? 0;
      if (water) water.visible = still != null;
      prevS.clear();
    },
    liquid(x, z) { if (still == null) return null; L.surf = still + waves.height(x, z); L.still = still; return L; },
    surfaceAt(x, z) { return still == null ? null : still + waves.height(x, z); },
    splash, ring,
    update(dt, { wind = null, swimmers = [] } = {}) {
      if (still == null) { drops.visible = rings.visible = false; return; }
      drops.visible = rings.visible = true;
      if (wind) waves.setWind(Math.hypot(wind[0], wind[1]), Math.atan2(wind[0], wind[1]), dt);
      t0 = Date.now() / 1000; waves.tick(t0);
      const S = waves.state; U.uWA.value.fromArray(S.a); U.uWK.value.fromArray(S.k); U.uWDX.value.fromArray(S.dx); U.uWDZ.value.fromArray(S.dz); U.uWPH.value.fromArray(S.ph);
      // swimmers and waders: entry splashes, stroke splashes, a wake behind a moving body, rings on the still ones
      for (const s of swimmers) {
        const surf = still + waves.height(s.x, s.z), d = surf - s.y; let ps = prevS.get(s.id); if (!ps) prevS.set(s.id, (ps = { d, t: 0, strokes: s.strokes || 0, x: s.x, z: s.z }));
        const sp = Math.hypot(s.x - ps.x, s.z - ps.z) / Math.max(1e-3, dt); ps.x = s.x; ps.z = s.z;
        if (ps.d <= 0.05 && d > 0.05) { const imp = Math.max(0.4, Math.min(3, (s.impact || 2) / 3)); splash(s.x, surf, s.z, imp, 0.5); ring(s.x, s.z, 0.3, 1.8, 1.8); ring(s.x, s.z, 0.1, 1.1, 1.4); }
        const atSurf = d > 0.05 && d < (s.swimming ? 1.9 : 1.6) && !(s.swimming && s.headUnder && d > 1.9);
        if (atSurf) {
          ps.t -= dt;
          if (s.strokes != null && s.strokes !== ps.strokes && s.swimming && !s.headUnder) { const side = (s.strokes % 2 ? 1 : -1) * 0.4; splash(s.x + Math.sin(s.yaw) * 0.7 + Math.cos(s.yaw) * side, surf, s.z + Math.cos(s.yaw) * 0.7 - Math.sin(s.yaw) * side, 0.3 + (s.sprint ? 0.3 : 0), 0.15); }
          if (ps.t <= 0) { ps.t = sp > 0.5 ? 0.22 : 1.3; ring(s.x - Math.sin(s.yaw) * 0.4, s.z - Math.cos(s.yaw) * 0.4, sp > 0.5 ? 0.35 : 0.5, sp > 0.5 ? 0.9 : 0.55, sp > 0.5 ? 1.4 : 2.2); if (!s.swimming && sp > 1) splash(s.x, surf, s.z, 0.25, 0.25); }
        }
        ps.strokes = s.strokes; ps.d = d;
      }
      const g = gGrav;
      for (let k = 0; k < NP; k++) { if (dl[k] <= 0) continue; dv[k * 3 + 1] -= g * dt; dp[k * 3] += dv[k * 3] * dt; dp[k * 3 + 1] += dv[k * 3 + 1] * dt; dp[k * 3 + 2] += dv[k * 3 + 2] * dt; dl[k] -= dt * 1.1; if (dp[k * 3 + 1] < still + waves.height(dp[k * 3], dp[k * 3 + 2]) - 0.05 && dv[k * 3 + 1] < 0) dl[k] = 0; }
      dGeo.attributes.position.needsUpdate = true; dGeo.attributes.aLife.needsUpdate = true; dGeo.attributes.aSize.needsUpdate = true;
      dMat.uniforms.uScale.value = (innerHeight || 720) * 0.5 / Math.tan((camera.fov * Math.PI) / 360);
      for (let i = 0; i < NR; i++) {
        const o = R[i]; if (o.life > 0) { o.life -= dt; o.r += o.grow * dt; }
        const k = Math.max(0, o.life / o.max);
        vS.set(o.r, 1, o.r); vP.set(o.x, still + waves.height(o.x, o.z) + 0.03, o.z); m4.compose(vP, q0, k > 0 ? vS : vS.set(0, 0, 0)); rings.setMatrixAt(i, m4);
        rings.instanceColor.setXYZ(i, k * k, k * k, k * k);
      }
      rings.instanceMatrix.needsUpdate = true; rings.instanceColor.needsUpdate = true;
    },
    // where the camera is under the surface: depth below the wave over it (<= 0 above water)
    cameraDepth() { if (still == null) return 0; return still + waves.height(camera.position.x, camera.position.z) - camera.position.y; },
    dispose() { scene.remove(drops, rings); dGeo.dispose(); dMat.dispose(); ringGeo.dispose(); ringMat.dispose(); rings.dispose(); },
  };
  return api;
}

// Under the surface: the light that reaches depth d is I0 * exp(-a d) per channel (a from the water's own
// clarity); what she sees at distance r is scattered back the same way, so the fog is the water's colour at
// her depth and its density the green attenuation. Returns the 0..1 'how far under' for the HUD and audio.
const _c = new THREE.Color(), _base = new THREE.Color();
export function createUnderwater() {
  let on = false, saved = null; const bgCol = new THREE.Color();
  return {
    get on() { return on; },
    apply({ depth, liquid, waterColor, fog, scene, sun, hemi, sky, sunK = 1, bg = null }) {
      const under = depth > 0.02 && !!liquid;
      if (under && !on) { on = true; saved = { fogCol: fog ? fog.color.clone() : null, bg: scene.background, sky: sky ? sky.visible : true }; }
      if (!under && on) { on = false; if (saved) { if (fog && saved.fogCol) fog.color.copy(saved.fogCol); scene.background = saved.bg; if (sky) sky.visible = saved.sky; } saved = null; }
      if (!on) return 0;
      const a = liquid.absorb, d = Math.max(0, depth);
      _base.copy(waterColor || _c.set('#2a6f86'));
      // the colour of the water at her depth: sunlight that made it down, scattered by the water
      _c.setRGB(_base.r * Math.exp(-a[0] * d) * 0.9, _base.g * Math.exp(-a[1] * d), _base.b * Math.exp(-a[2] * d)).multiplyScalar(0.25 + 0.75 * sunK);
      if (fog) { fog.color.copy(_c); fog.density = a[1] * 1.15; }
      bgCol.copy(_c); scene.background = bgCol; void bg;
      if (sky) sky.visible = false;
      const k = Math.exp(-a[1] * d);
      if (sun) sun.intensity *= k * 0.85; if (hemi) hemi.intensity *= 0.6 + 0.4 * k;
      return Math.min(1, 0.4 + d / 6);
    },
  };
}
