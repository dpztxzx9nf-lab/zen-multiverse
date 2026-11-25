// Koi pond: GPU ripple simulation + water shader, a few procedural koi that drift toward taps.
import * as THREE from 'three';
import { placedRock, rockMaterial } from './rocks.js';
import { mulberry32, noise3, smoothstep, mergeGeometries } from './util.js';

// Kidney / bean outline: elongated east-west, with a cove on the south-east
// (the side you see from the stepping stones). Polar radius is metres from (cx, cz).
const CX = 10.2, CZ = 1.2, LEVEL = -0.12;
const UVR = 4.4; // bounding radius used for ripple UVs
function angNorm(a) { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; }
export function pondRadius(theta) {
  const cove = Math.exp(-(angNorm(theta - 1.05) ** 2) / 0.24);
  return 3.15 + 0.52 * Math.cos(theta - 0.12) + 0.20 * Math.cos(2 * theta + 0.4) + 0.10 * Math.sin(3 * theta + 0.9) - 0.72 * cove;
}
export function pondContains(x, z, margin = 0) {
  const dx = x - CX, dz = z - CZ;
  return Math.hypot(dx, dz) < pondRadius(Math.atan2(dz, dx)) + margin;
}
export function pondDist(x, z) {
  const dx = x - CX, dz = z - CZ;
  return Math.hypot(dx, dz) - pondRadius(Math.atan2(dz, dx));
}
export function pondOutline(n = 96, extra = 0) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const th = (i / n) * Math.PI * 2, r = pondRadius(th) + extra;
    pts.push([CX + Math.cos(th) * r, CZ + Math.sin(th) * r, th, r]);
  }
  return pts;
}
const RMAX = (() => { let m = 0; for (let i = 0; i < 64; i++) m = Math.max(m, pondRadius((i / 64) * Math.PI * 2)); return m; })();
export const POND = { cx: CX, cz: CZ, r: RMAX, level: LEVEL, radius: pondRadius, contains: pondContains, dist: pondDist, outline: pondOutline };

function makePolar(radiusFn, { rings = 10, segs = 96, yFn = () => 0, uvR = UVR } = {}) {
  const pos = [], uv = [], shore = [], idx = [];
  pos.push(0, yFn(0, 0), 0); uv.push(0.5, 0.5); shore.push(0);
  for (let j = 1; j <= rings; j++) {
    const f = j / rings;
    for (let i = 0; i < segs; i++) {
      const th = (i / segs) * Math.PI * 2, r = radiusFn(th) * f;
      const x = Math.cos(th) * r, z = Math.sin(th) * r;
      pos.push(x, yFn(f, th), z);
      uv.push(0.5 + x / (2 * uvR), 0.5 - z / (2 * uvR));
      shore.push(f);
    }
  }
  for (let i = 0; i < segs; i++) idx.push(0, 1 + i, 1 + (i + 1) % segs);
  for (let j = 1; j < rings; j++) {
    const a0 = 1 + (j - 1) * segs, b0 = 1 + j * segs;
    for (let i = 0; i < segs; i++) {
      const a = a0 + i, b = a0 + (i + 1) % segs, c = b0 + i, d = b0 + (i + 1) % segs;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aShore', new THREE.Float32BufferAttribute(shore, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}


function makeKoiGeometry(seed, variety) {
  const L = 1.0, NS = 26, NR = 14;
  const rnd = mulberry32(seed);
  const pos = [], col = [], idx = [];
  const white = new THREE.Color(0.96, 0.94, 0.9);
  const palettes = {
    kohaku: [white, new THREE.Color(0.95, 0.22, 0.05)],
    sanke: [white, new THREE.Color(0.95, 0.3, 0.06), new THREE.Color(0.05, 0.05, 0.06)],
    ogon: [new THREE.Color(1.0, 0.78, 0.35), new THREE.Color(1.0, 0.86, 0.5)],
    orange: [new THREE.Color(1.0, 0.45, 0.1), new THREE.Color(1.0, 0.58, 0.2)],
    shiro: [white, new THREE.Color(0.08, 0.08, 0.1)],
  };
  const pal = palettes[variety];
  const o = rnd() * 100;
  const rad = (t) => (t > 0.6 ? Math.sqrt(Math.max(0, 1 - ((t - 0.6) / 0.4) ** 2)) : 0.28 + 0.72 * Math.sin((Math.PI / 2) * (t / 0.6))) * 0.115;
  const colorAt = (x, y, z) => {
    if (y < -0.03) return white.clone().lerp(pal[0], 0.5);
    const n = noise3(x * 7 + o, y * 7, z * 7 + o);
    let c = pal[0].clone();
    if (n > -0.05) c = pal[1].clone();
    if (pal[2] && noise3(x * 11 + o * 2, y * 11, z * 11) > 0.42) c = pal[2].clone();
    return c;
  };
  for (let i = 0; i <= NS; i++) {
    const t = i / NS;
    const x = (t - 0.5) * L;
    const r = rad(t);
    for (let j = 0; j <= NR; j++) {
      const a = (j / NR) * Math.PI * 2;
      const y = Math.sin(a) * r * 0.72, z = Math.cos(a) * r;
      pos.push(x, y, z);
      let c = colorAt(x, y, z);
      // eyes
      if (t > 0.9 && t < 0.95 && Math.abs(y) < r * 0.4 && Math.abs(z) > r * 0.7) c = new THREE.Color(0.02, 0.02, 0.02);
      col.push(c.r, c.g, c.b);
    }
  }
  for (let i = 0; i < NS; i++) for (let j = 0; j < NR; j++) {
    const a = i * (NR + 1) + j, b = a + NR + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const finC = pal[1].clone().lerp(white, 0.45);
  const addTri = (p1, p2, p3, c) => {
    const base = pos.length / 3;
    pos.push(...p1, ...p2, ...p3);
    for (let k = 0; k < 3; k++) col.push(c.r, c.g, c.b);
    idx.push(base, base + 1, base + 2);
  };
  // tail fan (flowing, butterfly-koi style)
  const tx = -0.5;
  const tail = [[-0.86, 0.2], [-0.92, 0.1], [-0.8, 0.0], [-0.92, -0.1], [-0.86, -0.2]];
  for (let k = 0; k < tail.length - 1; k++) {
    addTri([tx + 0.02, 0, 0], [tail[k][0], 0, tail[k][1]], [tail[k + 1][0], 0, tail[k + 1][1]], finC);
  }
  // pectoral fins
  for (const s of [1, -1]) {
    addTri([0.18, -0.03, 0.06 * s], [0.02, -0.04, 0.24 * s], [0.08, -0.03, 0.08 * s], finC);
    addTri([0.08, -0.03, 0.08 * s], [0.02, -0.04, 0.24 * s], [-0.04, -0.035, 0.18 * s], finC);
  }
  // dorsal ridge
  addTri([0.15, 0.08, 0], [-0.22, 0.13, 0], [-0.3, 0.05, 0], finC);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function createPond(scene, renderer, { P }) {
  const { cx, cz, r: R, level } = POND;
  const SIM = P.simSize;
  const group = new THREE.Group();
  group.position.set(cx, 0, cz);
  scene.add(group);

  // ---- ripple sim (ping-pong)
  const rtOpts = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false };
  let rtA = new THREE.WebGLRenderTarget(SIM, SIM, rtOpts);
  let rtB = new THREE.WebGLRenderTarget(SIM, SIM, rtOpts);
  const simMat = new THREE.ShaderMaterial({
    uniforms: { uPrev: { value: null }, uDamp: { value: Math.pow(0.991, 60 / P.simHz) }, uTexel: { value: new THREE.Vector2(1 / SIM, 1 / SIM) }, uDrop: { value: new THREE.Vector4(0, 0, 0, 0.02) } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: /* glsl */ `
      uniform sampler2D uPrev; uniform vec2 uTexel; uniform vec4 uDrop; uniform float uDamp; varying vec2 vUv;
      void main() {
        vec4 c = texture2D(uPrev, vUv);
        float n = texture2D(uPrev, vUv + vec2(uTexel.x, 0.0)).r + texture2D(uPrev, vUv - vec2(uTexel.x, 0.0)).r
                + texture2D(uPrev, vUv + vec2(0.0, uTexel.y)).r + texture2D(uPrev, vUv - vec2(0.0, uTexel.y)).r;
        float h = (n * 0.5 - c.g) * uDamp;
        float d = distance(vUv, uDrop.xy);
        h += uDrop.z * exp(-d * d / (uDrop.w * uDrop.w));
        float rr = length(vUv - 0.5) * 2.0;
        h *= smoothstep(1.0, 0.95, rr);
        gl_FragColor = vec4(h, c.r, 0.0, 1.0);
      }`,
    depthTest: false, depthWrite: false,
  });
  const simScene = new THREE.Scene();
  const simCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), simMat);
  quad.frustumCulled = false;
  simScene.add(quad);
  // clear both targets
  renderer.setRenderTarget(rtA); renderer.setClearColor(0x000000, 1); renderer.clear();
  renderer.setRenderTarget(rtB); renderer.clear();
  renderer.setRenderTarget(null);

  const drops = [];
  function addDrop(u, v, strength = 0.5, radius = 0.014) {
    if (drops.length > 10) drops.shift();
    drops.push([u, v, strength, radius]);
  }

  // ---- water surface
  const wu = {
    uRipple: { value: rtA.texture },
    uTexel: { value: new THREE.Vector2(1 / SIM, 1 / SIM) },
    uTime: { value: 0 },
    uZenith: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3() },
    uMoonDir: { value: new THREE.Vector3() },
    uSunColor: { value: new THREE.Color() },
    uSunI: { value: 1 },
    uNight: { value: 0 },
    uLantern: { value: new THREE.Vector3(7.6, 1.6, -4.6) },
    uLanternI: { value: 0 },
    uHover: { value: new THREE.Vector3(0, 0, 0) },
    uRefl: { value: null }, uReflMat: { value: new THREE.Matrix4() }, uOvercast: { value: 0 },
    ...THREE.UniformsLib.fog,
  };
  const waterMat = new THREE.ShaderMaterial({
    uniforms: wu,
    defines: Object.assign(P.cheapWater ? { CHEAP: 1 } : {}, P.reflections ? { REFL: 1 } : {}),
    transparent: true,
    fog: true,
    depthWrite: false,
    side: THREE.DoubleSide, // makePolar faces down; we look at the water from above
    vertexShader: /* glsl */ `
      attribute float aShore;
      varying vec2 vUv; varying vec3 vWorld; varying float vShore;
      #include <fog_pars_vertex>
      void main() {
        vUv = uv; vShore = aShore;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uRipple; uniform vec2 uTexel; uniform float uTime;
      uniform vec3 uZenith, uHorizon, uSunDir, uMoonDir, uSunColor, uLantern;
      uniform float uSunI, uNight, uLanternI, uOvercast; uniform vec3 uHover;
      uniform sampler2D uRefl; uniform mat4 uReflMat;
      varying vec2 vUv; varying vec3 vWorld; varying float vShore;
      #include <fog_pars_fragment>
      void main() {
        float hL = texture2D(uRipple, vUv - vec2(uTexel.x, 0.0)).r;
        float hR = texture2D(uRipple, vUv + vec2(uTexel.x, 0.0)).r;
        float hD = texture2D(uRipple, vUv - vec2(0.0, uTexel.y)).r;
        float hU = texture2D(uRipple, vUv + vec2(0.0, uTexel.y)).r;
        vec2 g = vec2(hR - hL, hU - hD) * (5.0 * 256.0 * uTexel.x);
        // gentle ambient wavelets
        vec2 p = vWorld.xz;
        float t = uTime;
        g += vec2(cos(p.x * 2.1 + t * 0.9 + p.y * 0.7), cos(p.y * 2.4 - t * 0.8 + p.x * 0.5)) * 0.012;
        #ifndef CHEAP
        g += vec2(cos(p.x * 5.3 - t * 1.4 + p.y * 1.9), cos(p.y * 4.7 + t * 1.2 - p.x * 1.3)) * 0.006;
        #endif
        vec3 n = normalize(vec3(-g.x, 1.0, g.y));
        vec3 V = normalize(cameraPosition - vWorld);
        float ndv = max(dot(n, V), 0.0);
        float fres = 0.03 + 0.97 * pow(1.0 - ndv, 5.0);
        vec3 Rv = reflect(-V, n);
        vec3 sky = mix(uHorizon, uZenith, pow(smoothstep(0.0, 0.8, Rv.y), 0.6));
                #ifdef REFL
        { vec4 rp = uReflMat * vec4(vWorld, 1.0); vec2 ruv = rp.xy / rp.w * 0.5 + 0.5 + g * 0.25;
          vec3 rf = texture2D(uRefl, clamp(ruv, 0.002, 0.998)).rgb;
          rf = min(rf, vec3(1.4));
          sky = mix(sky, rf, 0.8); }
        #endif
        float rr = vShore;
        // clear blue-green, soft depth gradient, no dark well
        vec3 deep = mix(vec3(0.03, 0.20, 0.21), vec3(0.015, 0.05, 0.08), uNight);
        vec3 shallow = mix(vec3(0.10, 0.32, 0.30), vec3(0.04, 0.10, 0.12), uNight);
        vec3 body = mix(deep, shallow, smoothstep(0.45, 1.0, rr));
        body *= 0.9 + 0.1 * min(uSunI / 3.0, 1.0);
        vec3 col = mix(body, sky, fres * mix(0.8, 0.5, uNight));
        float spec = (1.0 - uOvercast) * pow(max(dot(Rv, uSunDir), 0.0), 350.0) * 4.0 + pow(max(dot(Rv, uSunDir), 0.0), 40.0) * 0.08;
        col += uSunColor * spec * min(uSunI, 1.5) * 0.8;
        float ms = pow(max(dot(Rv, uMoonDir), 0.0), 1800.0) * 4.0 + pow(max(dot(Rv, uMoonDir), 0.0), 220.0) * 0.12;
        col += vec3(0.75, 0.82, 1.0) * ms * uNight;
        vec3 Ld = normalize(uLantern - vWorld);
        col += vec3(1.0, 0.6, 0.25) * pow(max(dot(Rv, Ld), 0.0), 300.0) * 2.0 * uLanternI;
        #ifndef CHEAP
        { vec2 hd = vWorld.xz - uHover.xy; col += mix(vec3(0.05, 0.07, 0.07), vec3(0.03, 0.04, 0.07), uNight) * uHover.z * exp(-dot(hd, hd) / 0.5); }
        #endif
        float rip = length(g);
        col += mix(uSunColor * 0.05, vec3(0.1, 0.13, 0.2), uNight) * smoothstep(0.03, 0.25, rip);
        float alpha = clamp(0.8 + fres * 0.16, 0.0, 0.94);
        gl_FragColor = vec4(col, alpha);
        #include <fog_fragment>
      }`,
  });
  const water = new THREE.Mesh(makePolar((th) => pondRadius(th) + 0.03, { rings: 8, segs: 96, yFn: () => 0 }), waterMat);
  water.position.y = level;
  water.renderOrder = 2;
  water.name = 'water';
  group.add(water);

  // ---- pond bowl: a shallow dish with a flat floor (no pointed well)
  const DEPTH = 0.48;
  const bowlY = (f) => {
    // f=0 at the centre, f=1 at the rim
    const floor = DEPTH;
    if (f < 0.28) return level - 0.02 - floor;
    if (f < 0.78) {
      const t = (f - 0.28) / 0.50;
      const s = t * t * (3 - 2 * t);
      return level - 0.02 - floor * (1 - s * 0.70);
    }
    const t = (f - 0.78) / 0.22;
    const s = t * t * (3 - 2 * t);
    return level - 0.02 - floor * 0.30 * (1 - s);
  };
  const bowlGeo = makePolar((th) => pondRadius(th) + 0.08, {
    rings: 12, segs: 72,
    yFn: bowlY,
  });
  const bc = new Float32Array(bowlGeo.attributes.position.count * 3);
  const c = new THREE.Color();
  const bp = bowlGeo.attributes.position;
  for (let i = 0; i < bp.count; i++) {
    const x = bp.getX(i), y = bp.getY(i), z = bp.getZ(i);
    const n = noise3(x * 2.5, y * 2.5, z * 2.5) * 0.5 + noise3(x * 9, y * 9, z * 9) * 0.25;
    c.setHSL(0.14 + n * 0.03, 0.22, 0.22 + n * 0.06 + (y + DEPTH) * 0.08);
    bc[i * 3] = c.r; bc[i * 3 + 1] = c.g; bc[i * 3 + 2] = c.b;
  }
  bowlGeo.setAttribute('color', new THREE.BufferAttribute(bc, 3));
  const causU = { uTime: wu.uTime, uCaus: { value: 1 } };
  const bowlMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.BackSide });
  bowlMat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = causU.uTime; sh.uniforms.uCaus = causU.uCaus;
    sh.vertexShader = 'varying vec3 vWp;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n vWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = 'uniform float uTime; uniform float uCaus; varying vec3 vWp;\n' + sh.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
       { vec2 q = vWp.xz * 1.7; float tt = uTime * 0.5;
         float cs = 0.0;
         for (int i = 0; i < 3; i++) { q = q + vec2(sin(q.y * 1.3 + tt), cos(q.x * 1.1 - tt)) * 0.6; cs += abs(sin(q.x + q.y)); }
         cs = pow(1.0 - cs / 3.0, 5.0);
         totalEmissiveRadiance += vec3(0.5, 0.75, 0.6) * cs * uCaus * 0.35 * smoothstep(-1.4, -0.3, vWp.y); }`
    );
  };
  const bowl = new THREE.Mesh(bowlGeo, bowlMat);
  bowl.receiveShadow = true;
  group.add(bowl);

  // ---- moss and soil bank: rises from the waterline up to grade so the ground hole has no visible rim
  const rnd = mulberry32(99);
  const bankSegs = 96, bankRings = 8;
  const bPos = [], bCol = [], bIdx = [];
  const cWet = new THREE.Color('#3a3c30'), cSoil = new THREE.Color('#4a4638'), cMoss = new THREE.Color('#3f4d30'), cGrass = new THREE.Color('#4a5a34'), bTint = new THREE.Color();
  const bankY = (f) => {
    const rise = smoothstep(0.0, 0.55, f);
    return (level - 0.01) * (1 - rise) + 0.02 * rise - (f > 0.85 ? (f - 0.85) * 0.04 : 0);
  };
  for (let j = 0; j <= bankRings; j++) {
    const f = j / bankRings;
    const y = bankY(f);
    bTint.copy(cWet).lerp(cSoil, smoothstep(0.06, 0.28, f)).lerp(cMoss, smoothstep(0.22, 0.55, f)).lerp(cGrass, smoothstep(0.55, 0.95, f));
    for (let i = 0; i <= bankSegs; i++) {
      const th = (i / bankSegs) * Math.PI * 2;
      const wob = 1 + 0.05 * Math.sin(th * 5.0 + 1.2) + 0.03 * Math.sin(th * 9.0);
      const r = pondRadius(th) * 0.97 + f * 0.70 * wob;
      const bump = 0.016 * Math.sin(th * 6 + f * 4) * f;
      bPos.push(Math.cos(th) * r, y + bump, Math.sin(th) * r);
      bCol.push(bTint.r, bTint.g, bTint.b);
    }
  }
  for (let j = 0; j < bankRings; j++) for (let i = 0; i < bankSegs; i++) {
    const a = j * (bankSegs + 1) + i, b = a + 1, cc = a + bankSegs + 1, d = cc + 1;
    bIdx.push(a, b, cc, b, d, cc);
  }
  const bankG = new THREE.BufferGeometry();
  bankG.setAttribute('position', new THREE.Float32BufferAttribute(bPos, 3));
  bankG.setAttribute('color', new THREE.Float32BufferAttribute(bCol, 3));
  bankG.setIndex(bIdx);
  bankG.computeVertexNormals();
  const bank = new THREE.Mesh(bankG, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide }));
  bank.receiveShadow = true;
  group.add(bank);

  // ---- edge stones: large anchors, medium clusters, sitting on the bank and partly sunk
  const stoneGeos = [], edgeStones = [], gapAngles = [];
  let a = rnd() * 0.3;
  const nSlots = 24;
  for (let i = 0; i < nSlots; i++) {
    a += (0.7 + rnd() * 0.55) * (Math.PI * 2) / nSlots;
    const kind = rnd();
    if (kind < 0.20) { gapAngles.push(a); continue; } // leave a gap of moss and plants
    const s = kind > 0.88 ? 0.50 + rnd() * 0.14 : kind > 0.52 ? 0.30 + rnd() * 0.12 : 0.16 + rnd() * 0.08;
    const fOn = s > 0.45 ? 0.42 + rnd() * 0.22 : s > 0.28 ? 0.32 + rnd() * 0.28 : 0.28 + rnd() * 0.40;
    const wob = 1 + 0.05 * Math.sin(a * 5.0 + 1.2) + 0.03 * Math.sin(a * 9.0);
    const rr = pondRadius(a) * 0.97 + fOn * 0.70 * wob;
    const sy = s * (0.55 + rnd() * 0.28), sx = s * (0.95 + rnd() * 0.35), sz = s * (0.8 + rnd() * 0.4);
    const y = bankY(fOn) - sy * (0.38 + rnd() * 0.16);
    edgeStones.push({ x: cx + Math.cos(a) * rr, z: cz + Math.sin(a) * rr, s, ry: -a + (rnd() - 0.5) * 0.8, y, pebble: s < 0.2 });
    stoneGeos.push(placedRock(200 + i, { sx, sy, sz, moss: 0.45 + rnd() * 0.3, segs: s > 0.25 ? 24 : 14, rough: 0.22 + rnd() * 0.1, flatTop: s > 0.45 ? 0.18 : 0 }, Math.cos(a) * rr, y, Math.sin(a) * rr, -a + rnd()));
  }
  const stones = new THREE.Mesh(mergeGeometries(stoneGeos), rockMaterial());
  stones.castShadow = true; stones.receiveShadow = true;
  group.add(stones);

  // a few reed / iris clumps in the bank gaps
  if (gapAngles.length) {
    const blade = new THREE.PlaneGeometry(0.045, 0.55, 1, 3); blade.translate(0, 0.28, 0);
    const bp = blade.attributes.position;
    for (let i = 0; i < bp.count; i++) bp.setX(i, bp.getX(i) * (0.4 + bp.getY(i) * 0.6));
    blade.computeVertexNormals();
    const nBlades = gapAngles.length * 5;
    const reeds = new THREE.InstancedMesh(blade, new THREE.MeshStandardMaterial({ color: '#4a5c32', roughness: 0.85, side: THREE.DoubleSide }), nBlades);
    const dummy = new THREE.Object3D();
    let bi = 0;
    for (const ga of gapAngles) {
      const br = pondRadius(ga) + 0.18 + rnd() * 0.2;
      const bx = Math.cos(ga) * br, bz = Math.sin(ga) * br;
      for (let k = 0; k < 5; k++) {
        dummy.position.set(bx + (rnd() - 0.5) * 0.16, 0.0, bz + (rnd() - 0.5) * 0.16);
        dummy.rotation.set(0.15 * (rnd() - 0.5), rnd() * 6.28, 0.2 * (rnd() - 0.5), 'YXZ');
        dummy.scale.setScalar(0.7 + rnd() * 0.7);
        dummy.updateMatrix();
        reeds.setMatrixAt(bi++, dummy.matrix);
      }
    }
    reeds.castShadow = false; reeds.receiveShadow = true;
    group.add(reeds);
  }

  // invisible tap target in world space (not parented, so reflection hides don't affect it)
  const hitDisk = new THREE.Mesh(makePolar((th) => pondRadius(th) + (P.touch ? 1.1 : 0.5), { rings: 2, segs: 48 }), new THREE.MeshBasicMaterial({ visible: false }));
  hitDisk.position.set(cx, level + 0.05, cz);
  hitDisk.updateMatrixWorld(true);
  function pointToUv(pt) {
    let x = (pt.x - cx) / (2 * UVR), z = (pt.z - cz) / (2 * UVR);
    const l = Math.hypot(x, z), lim = 0.48;
    if (l > lim) { x *= lim / l; z *= lim / l; }
    return { x: 0.5 + x, y: 0.5 - z };
  }
  let hoverTarget = 0;
  function setHover(pt) { if (pt) { wu.uHover.value.x = pt.x; wu.uHover.value.y = pt.z; hoverTarget = 1; } else hoverTarget = 0; }

  // ---- lily pads
  const padMat = new THREE.MeshStandardMaterial({ color: '#1c3a16', roughness: 0.92, metalness: 0, side: THREE.DoubleSide });
  const pads = [];
  const padSpots = [[1.3, -1.6, 0.42], [1.75, -1.0, 0.3], [-1.9, 1.35, 0.38], [-1.45, 1.9, 0.26], [1.6, 1.45, 0.32], [-0.7, -2.15, 0.28]].slice(0, P.lilies)
    .filter(([x, z, s]) => pondContains(cx + x, cz + z, -s * 0.6));
  for (const [x, z, s] of padSpots) {
    const g = new THREE.CircleGeometry(s, 28, 0.35, Math.PI * 2 - 0.35).rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, padMat);
    m.position.set(x, level + 0.02, z);
    m.rotation.y = rnd() * 6.28;
    m.receiveShadow = true;
    group.add(m);
    pads.push({ m, ph: rnd() * 6 });
  }
  // a single lotus blossom on its own pad: the payoff for a few slow breaths. Petals unfurl layer by
  // layer (outer first), the flower brightens with a soft inner glow, and warm motes drift up.
  const lotus = new THREE.Group();
  const lotusMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, side: THREE.DoubleSide, emissive: '#ff9fc0', emissiveIntensity: 0.06 });
  const petalG = (() => {
    const L = 0.17, W = 0.085, g = new THREE.PlaneGeometry(1, 1, 6, 10), p = g.attributes.position;
    const col = new Float32Array(p.count * 3), base = new THREE.Color('#fff6f2'), tip = new THREE.Color('#f07aa6'), c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const w = p.getX(i), v = p.getY(i) + 0.5; // w across (-0.5..0.5), v base->tip
      const prof = Math.pow(Math.sin(Math.PI * Math.min(1, v * 0.92 + 0.06)), 0.75) * (1 - 0.35 * v * v) + 0.12 * (1 - v);
      const z = w * W * prof * 2;
      const cup = -0.045 * (2 * w) ** 2 * Math.sin(Math.PI * Math.min(1, v + 0.1)) - 0.02 * v * v; // edges curl inward
      p.setXYZ(i, cup, v * L, z);
      c.copy(base).lerp(tip, Math.pow(v, 1.6) * 0.85 + Math.abs(w) * 0.15);
      col.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    return g;
  })();
  const petals = [];
  const LAYERS = [[9, 0.03, 1.0], [8, 0.022, 0.9], [7, 0.014, 0.78], [5, 0.008, 0.62]];
  const NPET = LAYERS.reduce((n, l) => n + l[0], 0);
  const petalIM = new THREE.InstancedMesh(petalG, lotusMat, NPET); // one draw call for the whole flower
  petalIM.castShadow = false; lotus.add(petalIM);
  LAYERS.forEach(([n, r, sc], layer) => {
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + layer * 0.37;
      petals.push({ pos: new THREE.Vector3(Math.cos(a) * r, 0.02, Math.sin(a) * r), sc, a, layer, jit: (k % 3) * 0.04 });
    }
  });
  let lotusO = 0.25, lotusTarget = 0.25, lotusHold = 0;
  const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const pObj = new THREE.Object3D();
  function poseLotus() {
    petals.forEach(({ pos, sc, a, layer, jit }, i) => {
      // outer layers open first and widest; inner ones follow a little later and stay cupped
      const k = sstep(layer * 0.14, 0.55 + layer * 0.14, lotusO);
      const open = 0.12 + [1.32, 1.0, 0.68, 0.36][layer] * k + jit * k;
      pObj.position.copy(pos); pObj.scale.setScalar(sc);
      pObj.rotation.set(0, -a, 0); pObj.rotateZ(-open); pObj.updateMatrix();
      petalIM.setMatrixAt(i, pObj.matrix);
    });
    petalIM.instanceMatrix.needsUpdate = true;
  }
  poseLotus();
  // seed pod + stamens
  const podG = new THREE.CylinderGeometry(0.03, 0.022, 0.03, 14);
  const pod = new THREE.Mesh(podG, new THREE.MeshStandardMaterial({ color: '#d8d26a', emissive: '#ffd860', emissiveIntensity: 0.4, roughness: 0.6 }));
  pod.position.y = 0.045; lotus.add(pod);
  const stamG = new THREE.BufferGeometry(); const sp = [];
  for (let k = 0; k < 40; k++) { const a = k * 2.39996, r = 0.03 + (k % 4) * 0.004; sp.push(Math.cos(a) * r, 0.05 + (k % 3) * 0.006, Math.sin(a) * r); }
  stamG.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  lotus.add(new THREE.Points(stamG, new THREE.PointsMaterial({ color: '#ffd24a', size: 0.012 })));
  // its pad
  const lpad = new THREE.Mesh(new THREE.CircleGeometry(0.36, 32, 0.3, Math.PI * 2 - 0.3).rotateX(-Math.PI / 2), padMat);
  lpad.position.y = 0.012; lpad.receiveShadow = true; lotus.add(lpad);
  // soft glow and rising motes (additive, so bloom picks them up at dusk)
  const glowTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,230,240,1)'); gr.addColorStop(0.35, 'rgba(255,180,210,0.35)'); gr.addColorStop(1, 'rgba(255,160,200,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#ffd6e6', transparent: true, opacity: 0, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending }));
  glow.position.y = 0.09; glow.scale.setScalar(0.7); lotus.add(glow);
  const NM = 18, moteP = new Float32Array(NM * 3), motes = [];
  for (let i = 0; i < NM; i++) motes.push({ t: Math.random() * 6, a: Math.random() * 6.28, r: 0.02 + Math.random() * 0.08, s: 0.04 + Math.random() * 0.05 });
  const moteG = new THREE.BufferGeometry(); moteG.setAttribute('position', new THREE.BufferAttribute(moteP, 3));
  const moteM = new THREE.PointsMaterial({ map: glowTex, color: '#fff0c8', size: 0.035, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  const moteS = new THREE.Points(moteG, moteM); moteS.frustumCulled = false; lotus.add(moteS);
  let lotusNight = 0;
  function updateLotusFx(dt, now) {
    const k = sstep(0.45, 1.0, lotusO);
    lotusMat.emissiveIntensity = 0.04 + k * (0.12 + lotusNight * 0.22);
    pod.material.emissiveIntensity = 0.3 + k * (0.35 + lotusNight * 0.5);
    glow.material.opacity = k * (0.1 + lotusNight * 0.16) * (0.85 + 0.15 * Math.sin(now * 0.9));
    glow.scale.setScalar(0.35 + k * 0.3);
    moteM.opacity = k * 0.75;
    if (k > 0.01) {
      for (let i = 0; i < NM; i++) {
        const m = motes[i]; m.t += dt * m.s * 2.2;
        if (m.t > 6) { m.t = 0; m.a = Math.random() * 6.28; m.r = 0.02 + Math.random() * 0.08; }
        const y = 0.06 + m.t * 0.16, sway = Math.sin(now * 0.6 + i) * 0.03 * m.t;
        moteP[i * 3] = Math.cos(m.a) * (m.r + m.t * 0.03) + sway; moteP[i * 3 + 1] = y; moteP[i * 3 + 2] = Math.sin(m.a) * (m.r + m.t * 0.03);
      }
      moteG.attributes.position.needsUpdate = true;
    }
  }
  lotus.position.set(1.3, level + 0.04, -1.6);
  lotus.scale.setScalar(1.5); // ~0.45 m across in full bloom
  group.add(lotus);

  // ---- koi
  const varieties = ['kohaku', 'ogon', 'sanke', 'orange', 'kohaku', 'shiro', 'ogon'];
  const nKoi = P.koi;
  const koi = [];
  for (let i = 0; i < nKoi; i++) {
    const uniforms = { uSwim: { value: 0 }, uAmp: { value: 1 } };
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.0, side: THREE.DoubleSide });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uSwim = uniforms.uSwim; sh.uniforms.uAmp = uniforms.uAmp;
      sh.vertexShader = 'uniform float uSwim; uniform float uAmp;\n' + sh.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         float wt = smoothstep(0.4, -0.9, position.x);
         transformed.z += sin(position.x * 5.5 - uSwim) * 0.11 * wt * uAmp + sin(uSwim * 0.5) * 0.02;`
      );
    };
    mat.customProgramCacheKey = () => 'koi';
    const mesh = new THREE.Mesh(makeKoiGeometry(1000 + i * 17, varieties[i % varieties.length]), mat);
    const sc = 0.5 + rnd() * 0.2; // koi 0.5-0.7 m
    mesh.scale.setScalar(sc);
    const a = rnd() * 6.28, d = rnd() * 1.8;
    koi.push({
      mesh, uniforms, x: Math.cos(a) * d, z: Math.sin(a) * d, heading: rnd() * 6.28, speed: 0.25,
      depth: -0.36 - rnd() * 0.25, seed: rnd() * 100, target: null, targetUntil: 0, delay: 0, wakeT: rnd() * 3,
    });
    group.add(mesh);
  }

  function attract(lx, lz, now) {
    for (const f of koi) {
      f.target = { x: lx + (Math.random() - 0.5) * 0.8, z: lz + (Math.random() - 0.5) * 0.8 };
      f.delay = 0.3 + Math.random() * 1.5;
      f.targetUntil = now + 7 + Math.random() * 4;
    }
  }

  // rare koi leap: one fish arcs out of the water and slips back in
  let leaping = null;
  function leap() {
    if (leaping) return false;
    const f = koi[Math.floor(Math.random() * koi.length)];
    if (Math.hypot(f.x, f.z) > pondRadius(Math.atan2(f.z, f.x)) - 1.15) return false;
    leaping = { f, t: 0 };
    addDrop(0.5 + f.x / (2 * UVR), 0.5 - f.z / (2 * UVR), 0.5, 0.012);
    return true;
  }
  let onSplash = null;
  function tap(uv, now, strength = 0.55) {
    addDrop(uv.x, uv.y, strength, 0.013);
    const lx = (uv.x - 0.5) * 2 * UVR, lz = -(uv.y - 0.5) * 2 * UVR;
    if (strength > 0.3) attract(lx, lz, now);
  }

  // ---- breathing: hold a finger on the water (4 s in, 6 s out)
  const breath = { on: false, k: 0, t: 0, x: 0, z: 0, count: 0, phase: 'out', fill: 0 };
  let onBreath = null;
  function setBreath(on, uv) {
    if (on && !breath.on) {
      breath.t = 0; breath.count = 0; breath.phase = 'none';
      if (uv) { breath.x = (uv.x - 0.5) * 2 * UVR; breath.z = -(uv.y - 0.5) * 2 * UVR; }
      const bth = Math.atan2(breath.z, breath.x), blim = Math.max(0.4, pondRadius(bth) - 1.1);
      const rr = Math.hypot(breath.x, breath.z); if (rr > blim) { breath.x *= blim / rr; breath.z *= blim / rr; }
    }
    breath.on = on;
  }
  const toUv = (x, z) => [0.5 + x / (2 * UVR), 0.5 - z / (2 * UVR)];
  function updateBreath(dt) {
    breath.k += ((breath.on ? 1 : 0) - breath.k) * Math.min(1, dt * (breath.on ? 0.8 : 0.35));
    if (breath.on) {
      breath.t += dt;
      const c = breath.t % 10, inhale = c < 4;
      const ph = inhale ? 'in' : 'out';
      if (ph !== breath.phase) {
        breath.phase = ph;
        const [u, v] = toUv(breath.x, breath.z);
        addDrop(u, v, inhale ? 0.3 : 0.15, inhale ? 0.07 : 0.05);
        if (!inhale) breath.count++;
        if (breath.count >= 3) lotusTarget = 1;
        if (onBreath) onBreath(inhale, breath.count);
      }
      breath.fill = inhale ? Math.sin((c / 4) * Math.PI / 2) ** 2 : Math.cos(((c - 4) / 6) * Math.PI / 2) ** 2;
      lotusHold = 45;
    } else {
      breath.fill *= Math.exp(-dt * 0.5);
      lotusHold -= dt;
      if (lotusHold < 0) lotusTarget = 0.25;
    }
    water.position.y = level + breath.fill * breath.k * 0.035;
    lotusO += (lotusTarget - lotusO) * Math.min(1, dt * (lotusTarget > lotusO ? 0.12 : 0.04)); // a slow unfurl
    poseLotus();
    updateLotusFx(dt, performance.now() / 1000);
  }

  function shoreR(x, z) { return pondRadius(Math.atan2(z, x)); }
  function clampKoi(x, z, margin = -0.85) {
    const lim = Math.max(0.45, shoreR(x, z) + margin);
    const r = Math.hypot(x, z) || 1e-4;
    if (r > lim) return [x * lim / r, z * lim / r];
    return [x, z];
  }
  let simAcc = 0, ambientT = 2;
  function update(dt, now, ts) {
    lotusNight = Math.max(ts.night, ts.golden * 0.6);
    wu.uTime.value = now;
    updateBreath(dt);
    // koi
    for (const f of koi) {
      let desired;
      let targetSpeed = 0.22 + 0.06 * Math.sin(now * 0.2 + f.seed);
      if (f.target && now < f.targetUntil) {
        if (f.delay > 0) { f.delay -= dt; desired = f.heading + Math.sin(now * 0.3 + f.seed) * 0.3; }
        else {
          const dx = f.target.x - f.x, dz = f.target.z - f.z;
          const dist = Math.hypot(dx, dz);
          desired = Math.atan2(dz, dx);
          targetSpeed = dist > 0.6 ? 0.7 : 0.15 + dist * 0.4;
          if (dist < 0.35) { f.target = null; }
        }
      } else {
        f.target = null;
        desired = f.heading + Math.sin(now * 0.17 + f.seed) * 0.9 + Math.sin(now * 0.07 + f.seed * 3) * 0.5;
      }
      if (breath.k > 0.3 && !(leaping && leaping.f === f)) {
        // gather in a slow circle around the breathing point
        const i = koi.indexOf(f), n = koi.length;
        const ang = now * 0.14 + (i / n) * Math.PI * 2, rad = 0.85 + 0.3 * breath.fill;
        const tx = breath.x + Math.cos(ang) * rad, tz = breath.z + Math.sin(ang) * rad;
        const dx = tx - f.x, dz = tz - f.z, dist = Math.hypot(dx, dz);
        desired = Math.atan2(dz, dx);
        targetSpeed = Math.min(0.5, 0.1 + dist * 0.35);
      }
      const rr = Math.hypot(f.x, f.z);
      const lim = shoreR(f.x, f.z) - 0.85;
      if (rr > lim * 0.75) {
        const toC = Math.atan2(-f.z, -f.x);
        const w = smoothstep(lim * 0.75, lim, rr);
        let d = toC - desired; d = Math.atan2(Math.sin(d), Math.cos(d));
        desired += d * w;
      }
      for (const o of koi) {
        if (o === f) continue;
        const dx = f.x - o.x, dz = f.z - o.z, d2 = dx * dx + dz * dz;
        if (d2 < 0.5 && d2 > 1e-4) {
          const away = Math.atan2(dz, dx);
          let d = away - desired; d = Math.atan2(Math.sin(d), Math.cos(d));
          desired += d * 0.15;
        }
      }
      let diff = desired - f.heading; diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      const maxTurn = (0.6 + f.speed * 1.2) * dt;
      f.heading += Math.max(-maxTurn, Math.min(maxTurn, diff * 1.5 * dt * 3));
      f.speed += (targetSpeed - f.speed) * Math.min(1, dt * 0.8);
      f.x += Math.cos(f.heading) * f.speed * dt;
      f.z += Math.sin(f.heading) * f.speed * dt;
      [f.x, f.z] = clampKoi(f.x, f.z, -0.85);
      f.uniforms.uSwim.value += dt * (2.2 + f.speed * 7);
      f.uniforms.uAmp.value = 0.6 + f.speed * 1.2 + Math.abs(diff) * 0.3;
      f.mesh.position.set(f.x, f.depth + Math.sin(now * 0.3 + f.seed) * 0.04, f.z);
      f.mesh.rotation.set(0, -f.heading, 0);
      if (leaping && leaping.f === f) {
        leaping.t += dt / 1.25;
        const t = Math.min(leaping.t, 1);
        f.speed = 0.9;
        f.mesh.position.y = f.depth * (1 - Math.sin(Math.PI * t)) + Math.sin(Math.PI * t) * 0.7;
        f.mesh.rotation.z = Math.cos(Math.PI * t) * 0.85;
        if (leaping.t >= 1) {
          addDrop(0.5 + f.x / (2 * UVR), 0.5 - f.z / (2 * UVR), 0.75, 0.016);
          if (onSplash) onSplash();
          leaping = null;
        }
      }
      f.wakeT -= dt;
      if (f.wakeT < 0) {
        f.wakeT = 1.2 + Math.random() * 2.5;
        addDrop(0.5 + f.x / (2 * UVR), 0.5 - f.z / (2 * UVR), 0.04 + f.speed * 0.05, 0.02);
      }
    }
    // ambient: an occasional tiny drip
    ambientT -= dt;
    if (ambientT < 0) {
      ambientT = 5 + Math.random() * 9;
      const a = Math.random() * 6.28, d = Math.random() * 0.35;
      addDrop(0.5 + Math.cos(a) * d, 0.5 + Math.sin(a) * d, 0.12, 0.01);
    }
    for (const p of pads) p.m.position.y = level + 0.02 + Math.sin(now * 0.8 + p.ph) * 0.006;
    lotus.rotation.y = Math.sin(now * 0.1) * 0.2;

    // ripple sim at fixed ~60Hz
    wu.uHover.value.z += (hoverTarget - wu.uHover.value.z) * Math.min(1, dt * 4);
    const step = 1 / P.simHz;
    simAcc = Math.min(simAcc + dt, step * 3);
    let steps = 0;
    while (simAcc >= step && steps < 3) {
      simAcc -= step; steps++;
      const d = drops.shift();
      if (d) simMat.uniforms.uDrop.value.set(d[0], d[1], d[2], d[3]);
      else simMat.uniforms.uDrop.value.z = 0;
      simMat.uniforms.uPrev.value = rtA.texture;
      renderer.setRenderTarget(rtB);
      renderer.render(simScene, simCam);
      const tmp = rtA; rtA = rtB; rtB = tmp;
    }
    renderer.setRenderTarget(null);
    wu.uRipple.value = rtA.texture;

    // sky-driven water colors
    wu.uZenith.value.copy(ts.zenith);
    wu.uHorizon.value.copy(ts.horizon);
    wu.uSunDir.value.copy(ts.sunDir);
    wu.uMoonDir.value.copy(ts.moonDir);
    wu.uSunColor.value.copy(ts.lightColor);
    wu.uSunI.value = ts.sunIntensity;
    wu.uNight.value = ts.night;
    causU.uCaus.value = Math.min(ts.sunIntensity / 2.5, 1) * 0.9 + ts.night * 0.1;
  }

  // PC: planar reflection of the garden in the pond (half resolution, pond itself hidden)
  let reflRT = null;
  const reflCam = new THREE.PerspectiveCamera();
  const tmpV = new THREE.Vector3(), tmpT = new THREE.Vector3();
  function renderReflection(renderer, scene, camera, w, h) {
    if (!P.reflections) return;
    const rw = Math.max(64, Math.round(w * 0.5)), rh = Math.max(64, Math.round(h * 0.5));
    if (!reflRT) { reflRT = new THREE.WebGLRenderTarget(rw, rh, { type: THREE.HalfFloatType }); wu.uRefl.value = reflRT.texture; }
    else if (reflRT.width !== rw || reflRT.height !== rh) reflRT.setSize(rw, rh);
    reflCam.copy(camera);
    tmpV.copy(camera.position); tmpV.y = 2 * level - tmpV.y;
    camera.getWorldDirection(tmpT); tmpT.y = -tmpT.y; tmpT.add(tmpV);
    reflCam.position.copy(tmpV); reflCam.up.set(0, -1, 0); reflCam.lookAt(tmpT);
    reflCam.updateMatrixWorld(); reflCam.projectionMatrix.copy(camera.projectionMatrix);
    wu.uReflMat.value.multiplyMatrices(reflCam.projectionMatrix, reflCam.matrixWorldInverse);
    group.visible = false;
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(reflRT);
    renderer.render(scene, reflCam);
    renderer.setRenderTarget(prev);
    group.visible = true;
  }
  function rainDrop(amount) {
    if (Math.random() < amount * 0.6) {
      const a = Math.random() * 6.283, r = Math.sqrt(Math.random()) * 0.44;
      addDrop(0.5 + Math.cos(a) * r, 0.5 + Math.sin(a) * r, 0.05 + Math.random() * 0.05, 0.007);
    }
  }
  return { group, stones, edgeStones, setBreath, breath, set onBreath(fn) { onBreath = fn; }, get lotusOpen() { return lotusO; }, lotus, water, hitDisk, pointToUv, setHover, tap, addDrop, update, leap, rainDrop, renderReflection, set onSplash(fn) { onSplash = fn; }, uniforms: wu };
}
