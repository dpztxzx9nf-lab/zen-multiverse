// How the living ground looks: everything the field knows shows up on the ground and in the air.
// Two small data textures over the sim window drive the terrain shader (wet and glossy, mud,
// scorch, ash, embers that glow, snow and frost, trampled trails, bare soil where plants are gone),
// a water surface that follows the field, instanced flames, smoke and steam, a rain curtain,
// footprint decals, charring props, and the look of electrical pieces (lamps, switches, wheels).
import * as THREE from 'three';
import { TC } from './field.js';

const hash = (a, b) => { let h = (a * 374761393 + b * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const NOISE = 'float sh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); } float sn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(sh(i), sh(i + vec2(1, 0)), f.x), mix(sh(i + vec2(0, 1)), sh(i + vec2(1, 1)), f.x), f.y); }';

export function createSimView({ scene, terrainMat, P }) {
  const lite = P.cls !== 'pc';
  let field = null, N = 0, texA = null, texB = null, dataA = null, dataB = null, clock = 0;
  const U = { uSimA: { value: null }, uSimB: { value: null }, uSimO: { value: new THREE.Vector2() }, uSimS: { value: 1 }, uSimOn: { value: 0 }, uSimT: { value: 0 } };
  // ---------- the terrain shader patch (chained after the planet's own)
  {
    const prev = terrainMat.onBeforeCompile;
    terrainMat.onBeforeCompile = (sh, r) => {
      if (prev) prev(sh, r);
      Object.assign(sh.uniforms, U);
      sh.fragmentShader = 'uniform sampler2D uSimA, uSimB; uniform vec2 uSimO; uniform float uSimS, uSimOn, uSimT;\n' + NOISE + '\n' + sh.fragmentShader
        .replace('#include <color_fragment>', `#include <color_fragment>
        float simWet = 0.0, simSnow = 0.0, simGlow = 0.0, simMud = 0.0;
        if (uSimOn > 0.5) {
          vec2 suv = (vPbrW.xz - uSimO) / uSimS; vec2 ed = min(suv, 1.0 - suv);
          float sIn = smoothstep(0.0, 0.05, min(ed.x, ed.y));
          if (sIn > 0.0) {
            vec4 sA = texture2D(uSimA, suv) * sIn, sB = texture2D(uSimB, suv) * sIn;
            float up = clamp(vPbrN.y * 1.4 - 0.2, 0.0, 1.0);
            float nz = sn(vPbrW.xz * 3.1) * 0.6 + sn(vPbrW.xz * 9.0) * 0.4;
            float bare = smoothstep(0.15 + nz * 0.3, 0.55 + nz * 0.3, sB.r) * up;
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.30, 0.22, 0.15) * (0.75 + 0.5 * nz), bare * 0.8);
            simWet = smoothstep(0.1, 0.7, sA.r + (nz - 0.5) * 0.15);
            diffuseColor.rgb *= 1.0 - 0.42 * simWet;
            simMud = smoothstep(0.15 + nz * 0.25, 0.6 + nz * 0.2, sA.a) * up;
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.13, 0.085, 0.05) * (0.8 + 0.4 * nz), simMud * 0.75);
            float trail = smoothstep(0.08, 0.6, sB.a + (nz - 0.5) * 0.2) * up;
            diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.72, 0.66, 0.6), trail * 0.7);
            float sc = smoothstep(0.12 + nz * 0.35, 0.45 + nz * 0.35, sA.g);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.03, 0.027, 0.025), sc * 0.9);
            float ash = smoothstep(0.2 + nz * 0.5, 0.6 + nz * 0.4, sB.b);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.40, 0.39, 0.37) * (0.85 + 0.3 * nz), ash * 0.75);
            simSnow = smoothstep(0.08 + nz * 0.25, 0.4 + nz * 0.2, sA.b) * (0.4 + 0.6 * up);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.90, 0.93, 0.97), simSnow);
            float g = sB.g; simGlow = g * g * (0.55 + 0.45 * sn(vPbrW.xz * 4.0 + uSimT * 0.7)) * smoothstep(0.25, 0.75, nz + g * 0.4);
          }
        }`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += vec3(1.0, 0.32, 0.06) * simGlow * 4.0;
        roughnessFactor = mix(roughnessFactor, 0.12, max(simWet * 0.75, simMud * 0.85));
        roughnessFactor = mix(roughnessFactor, 0.55, simSnow);`);
    };
    const pk = terrainMat.customProgramCacheKey ? terrainMat.customProgramCacheKey.bind(terrainMat) : () => '';
    terrainMat.customProgramCacheKey = () => pk() + 'sim1';
    terrainMat.needsUpdate = true;
  }
  function attach(f) {
    field = f;
    if (!f) { U.uSimOn.value = 0; water.visible = false; return; }
    if (N !== f.N) {
      N = f.N; dataA = new Uint8Array(N * N * 4); dataB = new Uint8Array(N * N * 4);
      texA && texA.dispose(); texB && texB.dispose();
      const mk = (d) => { const t = new THREE.DataTexture(d, N, N, THREE.RGBAFormat); t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter; t.needsUpdate = true; return t; };
      texA = mk(dataA); texB = mk(dataB); U.uSimA.value = texA; U.uSimB.value = texB;
      buildWater();
    }
    U.uSimOn.value = 1; U.uSimS.value = N * f.cell;
  }
  function writeTextures() {
    const F = field.f, n = N * N;
    U.uSimO.value.set(field.ox * field.cell, field.oz * field.cell);
    for (let k = 0; k < n; k++) {
      const o = k * 4, m = F.mat[k];
      const wet = Math.min(1, F.M[k] * 0.9 + (F.W[k] > 0.002 ? 0.6 : 0)) * (m === 3 || m === 6 ? 0.5 : 1);
      const soil = m === 1 || m === 7 || m === 2;
      dataA[o] = wet * 255; dataA[o + 1] = Math.min(1, F.Sc[k]) * 255;
      dataA[o + 2] = Math.min(1, F.S[k] * 9 + F.I[k] * 40 * (F.W[k] < 0.01 ? 1 : 0)) * 255;
      dataA[o + 3] = soil ? Math.max(0, Math.min(1, (F.M[k] - 0.58) / 0.25)) * 255 : 0;
      dataB[o] = Math.max(0, Math.min(1, (F.Vc[k] - F.V[k]) * 1.6)) * 255 * (F.sea[k] ? 0 : 1);
      dataB[o + 1] = Math.max(0, Math.min(1, (F.T[k] - 420) / 600)) * 255;
      dataB[o + 2] = Math.min(1, F.Ash[k]) * 255;
      dataB[o + 3] = Math.min(1, F.Pr[k] * 0.6 + F.C[k] * 0.9) * 255;
    }
    texA.needsUpdate = true; texB.needsUpdate = true;
  }

  // ---------- water surface
  const ripple = (() => {
    const S = 64, d = new Uint8Array(S * S * 4), h = new Float32Array(S * S);
    for (let k = 0; k < 5; k++) { const fx = 1 + ((k * 7) % 4), fz = 1 + ((k * 3) % 5), ph = k * 1.7; for (let i = 0; i < S * S; i++) { const x = i % S, z = (i / S) | 0; h[i] += Math.sin(((x * fx + z * fz) / S) * Math.PI * 2 + ph) / (k + 1); } }
    for (let i = 0; i < S * S; i++) { const x = i % S, z = (i / S) | 0; const dx = h[z * S + ((x + 1) % S)] - h[z * S + ((x + S - 1) % S)], dz = h[((z + 1) % S) * S + x] - h[((z + S - 1) % S) * S + x]; const v = new THREE.Vector3(-dx * 0.5, 1, -dz * 0.5).normalize(); d[i * 4] = (v.x * 0.5 + 0.5) * 255; d[i * 4 + 1] = (v.z * 0.5 + 0.5) * 255; d[i * 4 + 2] = v.y * 255; d[i * 4 + 3] = 255; }
    const t = new THREE.DataTexture(d, S, S); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true; return t;
  })();
  const waterMat = new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, roughness: 0.05, metalness: 0, normalMap: ripple, normalScale: new THREE.Vector2(0.3, 0.3), depthWrite: false });
  const WU = { uFlowT: { value: 0 } };
  waterMat.onBeforeCompile = (sh) => { Object.assign(sh.uniforms, WU); sh.vertexShader = 'uniform float uFlowT;\n' + sh.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_NORMALMAP\n vNormalMapUv = (modelMatrix * vec4(position, 1.)).xz * 0.35 + vec2(uFlowT * 0.03, uFlowT * 0.021);\n#endif'); };
  const water = new THREE.Mesh(new THREE.BufferGeometry(), waterMat); water.frustumCulled = false; water.renderOrder = 2; water.name = 'sim-water'; scene.add(water); water.visible = false;
  let wPos = null, wCol = null, wIdx = null, wetMask = null;
  const shallow = new THREE.Color('#5b8f86'), silt = new THREE.Color('#7a5c3e'), iceC = new THREE.Color('#dfeef6');
  function buildWater() {
    const g = new THREE.BufferGeometry(); wPos = new Float32Array(N * N * 3); wCol = new Float32Array(N * N * 4); wIdx = new Uint32Array((N - 1) * (N - 1) * 6); wetMask = new Uint8Array(N * N);
    const nor = new Float32Array(N * N * 3); for (let i = 0; i < N * N; i++) nor[i * 3 + 1] = 1;
    g.setAttribute('position', new THREE.BufferAttribute(wPos, 3).setUsage(THREE.DynamicDrawUsage)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(wCol, 4).setUsage(THREE.DynamicDrawUsage)); g.setIndex(new THREE.BufferAttribute(wIdx, 1).setUsage(THREE.DynamicDrawUsage));
    water.geometry.dispose(); water.geometry = g;
  }
  function writeWater() {
    const F = field.f, c = field.cell, ox = field.ox, oz = field.oz;
    let any = 0;
    for (let k = 0; k < N * N; k++) { const w = (F.W[k] > 0.004 || F.I[k] > 0.004) && !F.sea[k] ? 1 : 0; wetMask[k] = w; any += w; }
    water.visible = any > 0; if (!any) return;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = j * N + i, o = k * 3, q = k * 4;
      wPos[o] = (ox + i + 0.5) * c; wPos[o + 2] = (oz + j + 0.5) * c;
      if (wetMask[k]) {
        wPos[o + 1] = F.H[k] + F.I[k] + F.W[k] + 0.01;
        const silty = Math.min(1, (F.Sed[k] / Math.max(0.002, F.W[k])) * 40), ice = F.I[k] > 0.004 && F.W[k] < 0.01;
        const col = ice ? iceC : shallow, sk = ice ? 0 : silty * 0.8;
        wCol[q] = col.r + (silt.r - col.r) * sk; wCol[q + 1] = col.g + (silt.g - col.g) * sk; wCol[q + 2] = col.b + (silt.b - col.b) * sk;
        wCol[q + 3] = ice ? 0.92 : Math.min(0.85, 0.25 + F.W[k] * 6 + silty * 0.3);
      } else {
        let lv = 1e9, n = 0;
        if (i > 0 && wetMask[k - 1]) { lv = Math.min(lv, F.H[k - 1] + F.I[k - 1] + F.W[k - 1]); n++; }
        if (i < N - 1 && wetMask[k + 1]) { lv = Math.min(lv, F.H[k + 1] + F.I[k + 1] + F.W[k + 1]); n++; }
        if (j > 0 && wetMask[k - N]) { lv = Math.min(lv, F.H[k - N] + F.I[k - N] + F.W[k - N]); n++; }
        if (j < N - 1 && wetMask[k + N]) { lv = Math.min(lv, F.H[k + N] + F.I[k + N] + F.W[k + N]); n++; }
        wPos[o + 1] = n ? Math.min(F.H[k] - 0.03, lv) : F.H[k] - 0.1;
        wCol[q] = shallow.r; wCol[q + 1] = shallow.g; wCol[q + 2] = shallow.b; wCol[q + 3] = 0;
      }
    }
    let m = 0;
    for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) {
      const k = j * N + i; if (!(wetMask[k] | wetMask[k + 1] | wetMask[k + N] | wetMask[k + N + 1])) continue;
      wIdx[m++] = k; wIdx[m++] = k + N; wIdx[m++] = k + 1; wIdx[m++] = k + 1; wIdx[m++] = k + N; wIdx[m++] = k + N + 1;
    }
    const g = water.geometry; g.setDrawRange(0, m); g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true; g.index.needsUpdate = true;
  }

  // ---------- flames
  const MAXF = lite ? 220 : 900;
  const flameGeo = new THREE.PlaneGeometry(1, 1); flameGeo.translate(0, 0.5, 0);
  const seeds = new Float32Array(MAXF); for (let i = 0; i < MAXF; i++) seeds[i] = hash(i, 91);
  flameGeo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
  const FU = { uTime: { value: 0 }, uWind: { value: new THREE.Vector2() } };
  const flameMat = new THREE.ShaderMaterial({ uniforms: FU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: `attribute float aSeed; uniform vec2 uWind; uniform float uTime; varying vec2 vUv; varying float vSeed, vCoal;
      void main(){ vUv = uv; vSeed = aSeed;
        vec3 c = (instanceMatrix * vec4(0., 0., 0., 1.)).xyz; float s = length(instanceMatrix[0].xyz), h = length(instanceMatrix[1].xyz); vCoal = length(instanceMatrix[2].xyz);
        vec3 right = normalize(vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]));
        float y = position.y; vec3 p = c + right * position.x * s + vec3(0., 1., 0.) * y * h;
        p.xz += uWind * 0.06 * y * y * h + vec2(sin(uTime * 3. + aSeed * 30.), cos(uTime * 2.3 + aSeed * 17.)) * 0.05 * y * h;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.); }`,
    fragmentShader: `uniform float uTime; varying vec2 vUv; varying float vSeed, vCoal; ${NOISE}
      void main(){ float t = uTime * 2.6 + vSeed * 9.;
        float n = sn(vec2(vUv.x * 4. + vSeed * 13., vUv.y * 3.2 - t)) * 0.65 + sn(vec2(vUv.x * 9., vUv.y * 7. - t * 1.7)) * 0.35;
        float w = mix(0.95, 0.08, pow(vUv.y, 0.8)); float d = abs(vUv.x - 0.5) * 2. + (n - 0.5) * 0.55 * (0.2 + vUv.y);
        float body = smoothstep(w, w * 0.25, d) * smoothstep(0.0, 0.1, vUv.y) * (1. - smoothstep(0.35 + n * 0.55, 1.0, vUv.y));
        vec3 col = mix(vec3(1.0, 0.92, 0.6), vec3(1.0, 0.42, 0.08), smoothstep(0.05, 0.55, vUv.y + (n - 0.5) * 0.3));
        col = mix(col, vec3(0.55, 0.1, 0.02), smoothstep(0.55, 0.95, vUv.y)); col = mix(col, vec3(1.0, 0.35, 0.1), vCoal);
        gl_FragColor = vec4(col * body * 1.5, body); }` });
  const flames = new THREE.InstancedMesh(flameGeo, flameMat, MAXF); flames.frustumCulled = false; flames.count = 0; flames.renderOrder = 4; flames.name = 'sim-flames'; scene.add(flames);
  const _m = new THREE.Matrix4();

  // ---------- smoke, steam, splash (one particle pool, billboards)
  const MAXP = lite ? 260 : 1100;
  const pGeo = new THREE.PlaneGeometry(1, 1);
  const pA = new Float32Array(MAXP * 4); pGeo.setAttribute('aP', new THREE.InstancedBufferAttribute(pA, 4).setUsage(THREE.DynamicDrawUsage)); // alpha, kind, seed, age
  const partMat = new THREE.ShaderMaterial({ uniforms: { uTime: FU.uTime }, transparent: true, depthWrite: false,
    vertexShader: `attribute vec4 aP; varying vec2 vUv; varying vec4 vP;
      void main(){ vUv = uv; vP = aP; vec3 c = (instanceMatrix * vec4(0., 0., 0., 1.)).xyz; float s = length(instanceMatrix[0].xyz);
        vec3 r = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]), u = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        float a = aP.z * 6.28 + aP.w * 0.3; vec2 q = mat2(cos(a), -sin(a), sin(a), cos(a)) * position.xy;
        gl_Position = projectionMatrix * viewMatrix * vec4(c + (r * q.x + u * q.y) * s, 1.); }`,
    fragmentShader: `varying vec2 vUv; varying vec4 vP; ${NOISE}
      void main(){ vec2 d = vUv - 0.5; float r = length(d) * 2.; float n = sn(vUv * 4. + vP.z * 10.) * 0.5 + sn(vUv * 9. - vP.z * 7.) * 0.5;
        float a = smoothstep(1.0, 0.2, r + (n - 0.5) * 0.5) * vP.x;
        vec3 col = vP.y < 0.5 ? mix(vec3(0.22, 0.21, 0.2), vec3(0.55, 0.54, 0.52), n) : vP.y < 1.5 ? vec3(0.94, 0.95, 0.97) : vec3(0.75, 0.85, 0.9);
        gl_FragColor = vec4(col, a); }` });
  const parts = new THREE.InstancedMesh(pGeo, partMat, MAXP); parts.frustumCulled = false; parts.count = 0; parts.renderOrder = 5; parts.name = 'sim-smoke'; scene.add(parts);
  const P_ = [];
  let rs = 1; const rnd = () => { rs = (rs * 16807) % 2147483647; return rs / 2147483647; };
  function emit(x, y, z, kind, o = {}) {
    if (P_.length >= MAXP) P_.shift();
    P_.push({ x, y, z, vx: o.vx || 0, vy: o.vy ?? (kind === 0 ? 1.2 : kind === 1 ? 1.6 : 1.5), vz: o.vz || 0, age: 0, life: o.life || (kind === 0 ? 5 + rnd() * 3 : kind === 1 ? 1.6 : 0.6), size: o.size || (kind === 0 ? 0.8 : kind === 1 ? 0.6 : 0.25), grow: o.grow ?? (kind === 0 ? 0.9 : kind === 1 ? 1.4 : 0.6), kind, alpha: o.alpha || (kind === 0 ? 0.45 : kind === 1 ? 0.5 : 0.7), seed: rnd(), g: kind === 2 ? 9.81 : 0 });
  }

  // ---------- lights: fire glow, lamps
  const lights = []; for (let i = 0; i < (lite ? 1 : 2); i++) { const L = new THREE.PointLight('#ff9a4a', 0, 26, 2); scene.add(L); lights.push(L); }
  const lampLights = []; if (!lite) for (let i = 0; i < 2; i++) { const L = new THREE.PointLight('#ffd9a0', 0, 14, 2); scene.add(L); lampLights.push(L); }

  // ---------- rain curtain
  const MAXR = lite ? 450 : 1600;
  const rPos = new Float32Array(MAXR * 6); const rGeo = new THREE.BufferGeometry(); rGeo.setAttribute('position', new THREE.BufferAttribute(rPos, 3).setUsage(THREE.DynamicDrawUsage));
  const rain = new THREE.LineSegments(rGeo, new THREE.LineBasicMaterial({ color: '#c8d4dc', transparent: true, opacity: 0.32, depthWrite: false })); rain.frustumCulled = false; rain.visible = false; rain.name = 'sim-rain'; scene.add(rain);
  const drops = []; for (let i = 0; i < MAXR; i++) drops.push({ x: (rnd() - 0.5) * 40, y: rnd() * 22, z: (rnd() - 0.5) * 40 });

  // ---------- footprints
  const MAXFP = lite ? 120 : 400;
  const fpTex = (() => {
    const c = document.createElement('canvas'); c.width = 64; c.height = 128; const g = c.getContext('2d');
    const blob = (x, y, rx, ry) => { const gr = g.createRadialGradient(0, 0, 0, 0, 0, 1); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.75, 'rgba(255,255,255,0.85)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.save(); g.translate(x, y); g.scale(rx, ry); g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 1, 0, 7); g.fill(); g.restore(); };
    blob(32, 100, 16, 22); blob(31, 46, 20, 36);
    g.globalCompositeOperation = 'destination-out'; g.fillStyle = 'rgba(0,0,0,0.55)'; for (let i = 0; i < 6; i++) g.fillRect(10, 22 + i * 11, 44, 3); for (let i = 0; i < 3; i++) g.fillRect(14, 90 + i * 9, 36, 2);
    return new THREE.CanvasTexture(c);
  })();
  const fpMat = new THREE.MeshStandardMaterial({ color: '#2a2018', alphaMap: fpTex, transparent: true, depthWrite: false, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide });
  fpMat.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n#ifdef USE_INSTANCING_COLOR\n diffuseColor.rgb = mix(diffuse, vec3(0.55, 0.62, 0.74), vColor.g); diffuseColor.a *= vColor.r;\n#endif'); };
  const fpGeo = new THREE.PlaneGeometry(0.12, 0.28); fpGeo.rotateX(-Math.PI / 2);
  const fps = new THREE.InstancedMesh(fpGeo, fpMat, MAXFP); fps.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAXFP * 3), 3); fps.count = 0; fps.frustumCulled = false; fps.renderOrder = 1; fps.receiveShadow = true; fps.name = 'sim-prints'; scene.add(fps);
  const prints = []; let fpi = 0;
  function footprint(x, z, yaw, left, s, k) {
    if (!s || !field) return; const deep = s.snow > 0.03 ? 1 : s.mud > 0.3 ? 0.95 : s.mat === 2 ? 0.7 : s.mat === 8 ? 1 : s.mat === 1 ? 0.3 : s.mat === 7 ? 0.15 : 0;
    if (deep <= 0.05 || s.water > 0.03) return;
    const kk = field.idxAt(x, z); const y = kk >= 0 ? field.f.H[kk] : 0;
    const pr = { x, y, z, yaw, left, deep: deep * Math.min(1, k), snow: s.snow > 0.03 ? 1 : 0, born: clock };
    if (prints.length < MAXFP) prints.push(pr); else { prints[fpi] = pr; fpi = (fpi + 1) % MAXFP; }
  }
  const _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _e = new THREE.Euler();
  let top = null;
  function writePrints() {
    let n = 0; const F = field.f;
    for (const p of prints) {
      const k = field.idxAt(p.x, p.z); if (k < 0) continue;
      const a = p.deep * Math.min(1, F.Pr[k] * 1.6 + 0.15) * Math.min(1, (clock - p.born) * 4);
      if (a < 0.03) continue;
      const y = top ? top(p.x, p.z, p.y + 1) : p.y;
      _p.set(p.x, y + 0.012, p.z); _q.setFromEuler(_e.set(0, p.yaw, 0)); _s.set(p.left ? -1 : 1, 1, 1);
      _m.compose(_p, _q, _s); fps.setMatrixAt(n, _m); fps.instanceColor.setXYZ(n, a * 0.75, p.snow, 0); n++;
    }
    fps.count = n; fps.instanceMatrix.needsUpdate = true; fps.instanceColor.needsUpdate = true;
  }

  // ---------- props: charring, glowing metal
  const black = new THREE.Color('#141110');
  function charProp(b, k) {
    if (!b.mesh) return;
    b.mesh.traverse((o) => {
      if (!o.isMesh) return;
      if (!o.userData.simMat) { o.material = o.material.clone(); o.userData.simMat = o.material; o.userData.simCol = o.material.color.clone(); }
      const m = o.userData.simMat; m.color.copy(o.userData.simCol).lerp(black, Math.min(1, k * 1.2));
      if (m.emissive) { m.emissive.set('#ff4a10'); m.emissiveIntensity = b.data.burning ? (0.3 + 0.5 * rnd()) * k : 0; }
    });
  }
  const glowing = new Set();
  function glow(b, k) { if (!b || !b.mesh) return; b.mesh.traverse((o) => { if (!o.isMesh) return; o.material = o.material.clone(); if (o.material.emissive) { o.material.emissive.set('#ff6a20'); o.material.emissiveIntensity = 2 * k; } }); glowing.add({ b, t: 0 }); }

  // ---------- electrical pieces: how they look and show what they are doing
  const M = {
    copper: new THREE.MeshStandardMaterial({ color: '#b8703f', metalness: 1, roughness: 0.35 }),
    dark: new THREE.MeshStandardMaterial({ color: '#2b2d30', metalness: 0.6, roughness: 0.5 }),
    panel: new THREE.MeshStandardMaterial({ color: '#1b2a4a', metalness: 0.3, roughness: 0.15, emissive: '#0b1630', emissiveIntensity: 0.3 }),
    wood: new THREE.MeshStandardMaterial({ color: '#8a6440', roughness: 0.8 }),
    hidden: new THREE.MeshBasicMaterial({ visible: false }),
  };
  const rotors = new Set();
  function decorate(p) {
    if (p.mesh.userData.deco) return; const d = new THREE.Group(); p.mesh.userData.deco = d; const t = p.type;
    const box = (w, h, dd, m, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, dd), m); o.position.set(x, y, z); o.castShadow = !lite; d.add(o); return o; };
    if (t === 'wire') { p.mesh.material = M.copper; }
    else if (t === 'lamp') { p.mesh.material = M.hidden; box(0.3, 0.12, 0.3, M.dark, 0, -0.16); const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 10), new THREE.MeshStandardMaterial({ color: '#fff3d6', emissive: '#ffcf7a', emissiveIntensity: 0, roughness: 0.2 })); bulb.position.y = 0.02; d.add(bulb); d.userData.bulb = bulb; }
    else if (t === 'heater') { p.mesh.material = M.hidden; box(0.4, 0.06, 0.4, M.dark, 0, -0.1); const coil = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.025, 8, 24), new THREE.MeshStandardMaterial({ color: '#6a4a3a', emissive: '#ff3a0a', emissiveIntensity: 0, metalness: 0.8, roughness: 0.4 })); coil.rotation.x = Math.PI / 2; coil.position.y = -0.04; d.add(coil); d.userData.coil = coil; }
    else if (t === 'switch') { p.mesh.material = M.hidden; box(0.26, 0.36, 0.08, M.dark, 0, 0, -0.03); const lev = box(0.05, 0.22, 0.05, M.copper, 0, -0.02, 0.04); lev.geometry.translate(0, 0.1, 0); d.userData.lever = lev; }
    else if (t === 'relay') { p.mesh.material = M.dark; const led = new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 8), new THREE.MeshStandardMaterial({ color: '#222', emissive: '#ff3030', emissiveIntensity: 1.5 })); led.position.set(0, 0.14, 0.12); d.add(led); d.userData.led = led; const ar = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.16, 3), M.copper); ar.rotation.x = Math.PI / 2; ar.position.set(0, 0.13, 0.02); d.add(ar); }
    else if (t === 'solar') { p.mesh.material = M.dark; box(0.96, 0.02, 0.96, M.panel, 0, 0.05); }
    else if (t === 'battery') { p.mesh.material = M.dark; const bars = []; for (let i = 0; i < 4; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.02), new THREE.MeshStandardMaterial({ color: '#222', emissive: '#40ff80', emissiveIntensity: 0 })); b.position.set(-0.12 + i * 0.08, 0.05, 0.21); d.add(b); bars.push(b); } d.userData.bars = bars; }
    else if (t === 'wheel' || t === 'vane') {
      p.mesh.material = M.hidden; const hub = new THREE.Group(); d.add(hub); d.userData.rotor = hub; box(0.14, 0.14, 0.14, M.dark);
      const n = t === 'wheel' ? 8 : 3;
      for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; const arm = new THREE.Mesh(t === 'wheel' ? new THREE.BoxGeometry(0.28, 0.62, 0.05) : new THREE.BoxGeometry(0.04, 0.9, 0.16), t === 'wheel' ? M.wood : M.copper); arm.position.set(0, Math.cos(a) * 0.5, Math.sin(a) * 0.5); arm.rotation.x = -a; arm.castShadow = !lite; hub.add(arm); }
      rotors.add(d);
    }
    p.mesh.add(d);
  }
  const litLamps = [];
  function pieceState(p, s) {
    const d = p.mesh.userData.deco; if (!d) return;
    if (d.userData.bulb) { d.userData.bulb.material.emissiveIntensity = 6 * s.level * (s.level < 0.6 ? 0.8 + 0.2 * rnd() : 1); if (s.level > 0.05) litLamps.push({ p, k: s.level }); }
    if (d.userData.coil) d.userData.coil.material.emissiveIntensity = 3 * s.level;
    if (d.userData.lever) d.userData.lever.rotation.x = s.on ? 0.6 : -0.6;
    if (d.userData.led) d.userData.led.material.emissive.set(s.out ? '#40ff60' : '#ff3030');
    if (d.userData.bars) d.userData.bars.forEach((b, i) => { b.material.emissiveIntensity = s.charge / 36000 > (i + 0.5) / 4 ? 1.5 : 0; });
    if (d.userData.rotor) d.userData.spin = Math.min(12, Math.sqrt(Math.max(0, s.watts)) * 0.6);
  }

  // ---------- per frame
  function update(dt, o) {
    clock += dt; FU.uTime.value = clock; U.uSimT.value = clock; WU.uFlowT.value = clock;
    if (!field) { flames.count = 0; parts.count = 0; rain.visible = false; return; }
    if (o.ticked) { writeTextures(); writeWater(); }
    FU.uWind.value.set(o.wind[0], o.wind[1]);
    const F = field.f, Nn = field.N, cam = o.camera;
    let n = 0, lx = 0, ly = 0, lz = 0, lw = 0;
    const cx = cam ? cam.position.x : 0, cz = cam ? cam.position.z : 0;
    // flames from burning cells: more and taller with more fuel; low red tongues on charcoal
    for (let t = 0; t < field.NT * field.NT && n < MAXF; t++) {
      if (!field.awake[t]) continue; const tx = t % field.NT, tz = (t / field.NT) | 0;
      for (let j = tz * TC; j < tz * TC + TC && n < MAXF; j++) for (let i = tx * TC; i < tx * TC + TC && n < MAXF; i++) {
        const k = j * Nn + i, fi = F.Fi[k]; if (fi < 0.06) continue;
        const x = field.cellX(k) + (hash(i, j) - 0.5) * 0.35, z = field.cellZ(k) + (hash(j, i) - 0.5) * 0.35;
        const fuel = F.Fu[k] + F.V[k] * 0.5, coal = F.Ch[k] > fuel;
        const h = coal ? 0.2 + fi * 0.25 : 0.35 + fi * (0.5 + Math.min(1.6, fuel * 2.2)) * (0.8 + 0.4 * hash(k, 3));
        _m.makeScale(0.5 + fi * 0.45, h, coal ? 1 : 0.001); _m.setPosition(x, F.H[k] - 0.03, z); flames.setMatrixAt(n++, _m);
        const dd = Math.hypot(x - cx, z - cz), w = fi / (1 + dd * 0.15); lx += x * w; ly += (F.H[k] + 0.8) * w; lz += z * w; lw += w;
        if (o.ticked && (k + field.env.tick) % (lite ? 23 : 9) === 0) emit(x, F.H[k] + h * 0.9, z, 0, { vx: o.wind[0] * 0.25, vz: o.wind[1] * 0.25, size: 0.6 + fi * 0.6 });
      }
    }
    for (const B of (o.burningTrees || new Map()).values()) {
      const [x, z] = B.tr, k = field.idxAt(x, z); if (k < 0) continue; const y0 = F.H[k], hh = B.h * Math.min(1, B.t / 6);
      for (let s = 0; s < 7 && n < MAXF; s++) { const y = y0 + (s / 7) * hh, w = 1.5 * (1 - s / 8); _m.makeScale(w, 1.6 + hash(s, k) * 0.9, 0.001); _m.setPosition(x + (hash(s, 7) - 0.5) * 0.7, y, z + (hash(7, s) - 0.5) * 0.7); flames.setMatrixAt(n++, _m); }
      lx += x * 3; ly += (y0 + hh * 0.5) * 3; lz += z * 3; lw += 3;
      if (o.ticked && rnd() < 0.5) emit(x, y0 + hh, z, 0, { vx: o.wind[0] * 0.3, vz: o.wind[1] * 0.3, size: 1.6, life: 8, alpha: 0.5 });
    }
    for (const [b, s] of (o.propT || new Map())) {
      if (!s.burn || n >= MAXF || !b.mesh) continue; const r = Math.min(1.2, b.radius);
      for (let q = 0; q < 3 && n < MAXF; q++) { _m.makeScale(r * 1.3, r * (1.4 + q * 0.4), 0.001); _m.setPosition(b.pos.x + (hash(q, b.id) - 0.5) * r, b.pos.y - r * 0.3, b.pos.z + (hash(b.id, q) - 0.5) * r); flames.setMatrixAt(n++, _m); }
      lx += b.pos.x; ly += b.pos.y + 0.5; lz += b.pos.z; lw += 1;
      if (o.ticked && rnd() < 0.4) emit(b.pos.x, b.pos.y + r, b.pos.z, 0, { vx: o.wind[0] * 0.25, vz: o.wind[1] * 0.25 });
    }
    flames.count = n; flames.instanceMatrix.needsUpdate = true;
    if (lights[0]) { const L = lights[0]; if (lw > 0) { L.position.set(lx / lw, ly / lw + 0.6, lz / lw); L.intensity = Math.min(260, 25 + n * 1.6) * (0.85 + 0.15 * Math.sin(clock * 17) * Math.sin(clock * 7.3)); } else L.intensity = 0; }
    if (lights[1]) lights[1].intensity = 0;
    if (cam) litLamps.sort((a, b) => a.p.pos.distanceToSquared(cam.position) - b.p.pos.distanceToSquared(cam.position));
    lampLights.forEach((L, i) => { const e = litLamps[i]; if (e) { L.position.copy(e.p.pos); L.position.y += 0.1; L.intensity = 14 * e.k; } else L.intensity = 0; });
    litLamps.length = 0;
    if (o.ticked) {
      for (const k of field.events.steam) emit(field.cellX(k), F.H[k] + F.W[k] + 0.05, field.cellZ(k), 1, { vx: o.wind[0] * 0.15, vz: o.wind[1] * 0.15 });
      for (const k of field.events.sizzle) for (let q = 0; q < 3; q++) emit(field.cellX(k), F.H[k] + 0.1, field.cellZ(k), 1, { size: 0.9, vy: 2.2 });
    }
    let m = 0;
    for (let i = P_.length - 1; i >= 0; i--) {
      const p = P_[i]; p.age += dt; if (p.age > p.life) { P_.splice(i, 1); continue; }
      p.vy -= p.g * dt; const drift = p.kind === 0 ? 0.35 * (p.age / p.life) : 0;
      p.x += (p.vx + o.wind[0] * drift) * dt; p.y += p.vy * dt; p.z += (p.vz + o.wind[1] * drift) * dt;
      if (p.kind === 0) p.vy *= 1 - dt * 0.15;
    }
    for (const p of P_) {
      if (m >= MAXP) break; const u = p.age / p.life, s = p.size * (1 + p.grow * u * 3);
      _m.makeScale(s, s, s); _m.setPosition(p.x, p.y, p.z); parts.setMatrixAt(m, _m);
      pA[m * 4] = p.alpha * Math.min(1, u * 6) * (1 - u); pA[m * 4 + 1] = p.kind; pA[m * 4 + 2] = p.seed; pA[m * 4 + 3] = p.age; m++;
    }
    parts.count = m; parts.instanceMatrix.needsUpdate = true; pGeo.attributes.aP.needsUpdate = true;
    rain.visible = o.rain > 0.03 && !!cam;
    if (rain.visible) {
      const cnt = Math.floor(MAXR * Math.min(1, o.rain * 1.2)), sl = 0.06;
      for (let i = 0; i < MAXR; i++) {
        const d = drops[i], o6 = i * 6;
        if (i >= cnt) { rPos.fill(0, o6, o6 + 6); continue; }
        d.y -= 11 * dt; d.x += o.wind[0] * dt * 0.6; d.z += o.wind[1] * dt * 0.6;
        if (d.y < -2 || Math.abs(d.x) > 22 || Math.abs(d.z) > 22) { d.y = 16 + rnd() * 6; d.x = (rnd() - 0.5) * 40; d.z = (rnd() - 0.5) * 40; }
        const x = cam.position.x + d.x, y = cam.position.y + d.y - 6, z = cam.position.z + d.z;
        rPos[o6] = x; rPos[o6 + 1] = y; rPos[o6 + 2] = z; rPos[o6 + 3] = x - o.wind[0] * sl; rPos[o6 + 4] = y + 0.55; rPos[o6 + 5] = z - o.wind[1] * sl;
      }
      rGeo.attributes.position.needsUpdate = true;
    }
    if (o.ticked) writePrints();
    for (const d of rotors) d.userData.rotor.rotation.x += dt * (d.userData.spin || 0);
    for (const g of [...glowing]) { g.t += dt; if (!g.b.mesh) { glowing.delete(g); continue; } g.b.mesh.traverse((q) => { if (q.isMesh && q.material.emissive) q.material.emissiveIntensity = Math.max(0, 2 * (1 - g.t / 20)); }); if (g.t > 20) glowing.delete(g); }
  }
  return {
    attach, update, footprint, charProp, glow, decorate, pieceState,
    setTop(fn) { top = fn; }, setWaterColor(c) { shallow.copy(c); },
    steamAt: (x, y, z, n = 6) => { for (let i = 0; i < n; i++) emit(x + (rnd() - 0.5) * 0.4, y, z + (rnd() - 0.5) * 0.4, 1); },
    smokePuff: (x, y, z, s = 0.4) => emit(x, y, z, 0, { size: s, life: 2.5, alpha: 0.35, vy: 0.6 }),
    splash: (x, y, z, k = 1) => { for (let i = 0; i < 6 * k; i++) emit(x, y + 0.05, z, 2, { vx: (rnd() - 0.5) * 2, vz: (rnd() - 0.5) * 2, vy: 1.5 + rnd() * 1.5, size: 0.12 }); },
    get counts() { return { flames: flames.count, parts: parts.count, prints: fps.count, waterQuads: water.visible ? water.geometry.drawRange.count / 6 : 0 }; },
  };
}
