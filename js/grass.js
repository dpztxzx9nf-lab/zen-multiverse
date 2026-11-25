// A real lawn: dense grass blades around her (PC) or soft crossed cards (phones), laid on a world-locked
// grid that follows the camera, so it costs the same anywhere in the garden. Where grass grows comes
// from a top-down mask (not on the sand, pond, beds, path, stones), so edges stay clean. The blades
// bend with the shared wind and shade from a dark, damp base to sunlit, slightly yellowed tips.
import * as THREE from 'three';
import { WIND_GLSL, mulberry32 } from './util.js';

const MASK_SIZE = 64; // metres covered by the mask, centred on the garden

function bladePatch(cell, blades, segs, rnd, { width, card }) {
  const pos = [], idx = [], rb = [], uv = [];
  let v0 = 0;
  for (let b = 0; b < blades; b++) {
    const x = rnd() * cell, z = rnd() * cell, a = rnd() * Math.PI, r = rnd();
    const ca = Math.cos(a), sa = Math.sin(a);
    const w = width * (0.7 + rnd() * 0.6), lean = (rnd() - 0.5) * 0.07, leanA = rnd() * 6.283;
    if (card) {
      // one crossed pair of quads per "blade" slot (phones): textured with drawn blades
      for (const q of [0, Math.PI / 2]) {
        const c = Math.cos(a + q), s = Math.sin(a + q);
        for (const [u, t] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
          const off = (u - 0.5) * w;
          pos.push(x + c * off + Math.cos(leanA) * lean * t * 0.2, t, z + s * off + Math.sin(leanA) * lean * t * 0.2);
          rb.push(r); uv.push(u, t);
        }
        idx.push(v0, v0 + 1, v0 + 2, v0 + 2, v0 + 1, v0 + 3); v0 += 4;
      }
      continue;
    }
    for (let i = 0; i <= segs; i++) {
      const t = i / segs, ww = w * (1 - t * 0.85) * 0.5;
      const bx = x + Math.cos(leanA) * lean * t * t, bz = z + Math.sin(leanA) * lean * t * t;
      if (i < segs) {
        pos.push(bx - ca * ww, t, bz - sa * ww, bx + ca * ww, t, bz + sa * ww); rb.push(r, r); uv.push(0, t, 1, t);
      } else { pos.push(bx, t, bz); rb.push(r); uv.push(0.5, 1); }
    }
    for (let i = 0; i < segs - 1; i++) { const k = v0 + i * 2; idx.push(k, k + 1, k + 2, k + 2, k + 1, k + 3); }
    const k = v0 + (segs - 1) * 2; idx.push(k, k + 1, k + 2);
    v0 += segs * 2 + 1;
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aRnd', new THREE.Float32BufferAttribute(rb, 1));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

export function cardTexture() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 128; const g = c.getContext('2d');
  const r = mulberry32(77);
  for (let i = 0; i < 26; i++) {
    const x = 6 + r() * 116, h = 50 + r() * 76, w = 2 + r() * 3, bend = (r() - 0.5) * 30;
    g.beginPath(); g.moveTo(x - w, 128); g.quadraticCurveTo(x + bend * 0.3, 128 - h * 0.6, x + bend, 128 - h); g.quadraticCurveTo(x + bend * 0.3 + w * 0.3, 128 - h * 0.6, x + w, 128); g.closePath();
    const l = 0.75 + r() * 0.25; g.fillStyle = `rgba(${Math.round(255 * l)},${Math.round(255 * l)},${Math.round(255 * l)},1)`; g.fill();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.generateMipmaps = true; return t;
}

export function createGrass(scene, { P, sway, free, center, uSnow, season = 'summer' }) {
  const pc = P.cls === 'pc';
  // ---- where grass grows (r) and how tall (g), top-down over MASK_SIZE m
  const N = 256, cv = document.createElement('canvas'); cv.width = cv.height = N;
  const ctx = cv.getContext('2d'), img = ctx.createImageData(N, N), rnd = mulberry32(9090);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = center.x + (i / N - 0.5) * MASK_SIZE, z = center.y + (j / N - 0.5) * MASK_SIZE;
    const sd = Math.hypot((x - center.x) * 0.85, z - center.y);
    let d = free(x, z) ? 1 : 0;
    d *= 1 - Math.min(1, Math.max(0, (sd - 17) / 8));
    const k = (j * N + i) * 4;
    img.data[k] = d * 255; img.data[k + 1] = 128 + (rnd() - 0.5) * 60; img.data[k + 2] = 0; img.data[k + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  // soften the edges (grass thins out toward stones and sand instead of stopping on a line)
  const cv2 = document.createElement('canvas'); cv2.width = cv2.height = N; const c2 = cv2.getContext('2d');
  c2.filter = 'blur(1.5px)'; c2.drawImage(cv, 0, 0);
  const mask = new THREE.CanvasTexture(cv2); mask.colorSpace = THREE.NoColorSpace; mask.flipY = false;

  const U = {
    uMask: { value: mask }, uMaskMin: { value: new THREE.Vector2(center.x - MASK_SIZE / 2, center.y - MASK_SIZE / 2) },
    uMaskSize: { value: MASK_SIZE }, uSnow: uSnow || { value: 0 },
    uDry: { value: { summer: 0.12, spring: 0.05, autumn: 0.45, winter: 0.7 }[season] ?? 0.15 },
  };
  const layers = [];
  const mk = ({ cell, R, R0 = 0, blades, segs, width, height, card }) => {
    const n = Math.ceil((R * 2) / cell);
    const geo = bladePatch(cell, blades, segs, mulberry32(cell * 1000 + blades), { width, card });
    const offs = [];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const ox = (i + 0.5) * cell - R, oz = (j + 0.5) * cell - R, d = Math.hypot(ox, oz);
      if (d < R + cell && d > R0 - cell * 1.5) offs.push(i * cell, j * cell);
    }
    geo.setAttribute('aOff', new THREE.InstancedBufferAttribute(new Float32Array(offs), 2));
    geo.instanceCount = offs.length / 2;
    const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85, side: THREE.DoubleSide, alphaTest: card ? 0.5 : 0, map: card ? cardTexture() : null });
    if (card) mat.alphaToCoverage = true;
    const L = { cell, R, R0, n, height, uLayer: { value: new THREE.Vector4(R, R0, height, cell) }, uOrigin: { value: new THREE.Vector2() } };
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U, { uTime: sway.uTime, uWind: sway.uWind, uWindDir: sway.uWindDir, uLayer: L.uLayer, uOrigin: L.uOrigin });
      sh.vertexShader = `attribute vec2 aOff; attribute float aRnd;
        uniform vec2 uOrigin, uMaskMin; uniform float uMaskSize, uSnow, uDry; uniform sampler2D uMask; uniform vec4 uLayer;
        varying float vT; varying float vR; varying float vDry; varying float vAO;
        float gHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        ${WIND_GLSL}\n` + sh.vertexShader
        .replace('#include <beginnormal_vertex>', `vec3 objectNormal = vec3(0.0, 1.0, 0.0);`)
        .replace('#include <begin_vertex>', `
          vec2 cellW = uOrigin + aOff;
          float h1 = gHash(cellW), h2 = gHash(cellW + 17.3);
          // rotate the whole patch per cell so the repeat never lines up
          float an = h1 * 6.2831853; float ca = cos(an), sa = sin(an);
          vec2 lp = position.xz - vec2(uLayer.w * 0.5);
          lp = vec2(ca * lp.x - sa * lp.y, sa * lp.x + ca * lp.y) + vec2(uLayer.w * 0.5);
          vec2 wp = cellW + lp;
          vec4 m = texture2D(uMask, (wp - uMaskMin) / uMaskSize);
          float dist = length(wp - cameraPosition.xz);
          float fade = 1.0 - smoothstep(uLayer.x * 0.72, uLayer.x, dist);
          fade *= smoothstep(uLayer.y - uLayer.w, uLayer.y + uLayer.w * 0.5, dist + (uLayer.y > 0.0 ? 0.0 : 1e3));
          // density: thin out by dropping blades whose random number is above the local density
          float dens = m.r * fade * (1.0 - smoothstep(0.35, 0.8, uSnow));
          float keep = step(aRnd, dens * (0.75 + 0.25 * h2));
          float ht = uLayer.z * (0.55 + 0.9 * m.g) * (0.75 + aRnd * 0.5) * mix(1.0, 0.6, uDry * step(0.6, aRnd));
          vec3 transformed = vec3(wp.x, position.y * ht * keep, wp.y);
          float t = position.y;
          transformed += windOffset(transformed, t * t * ht * 0.9) * keep;
          vT = t; vR = aRnd; vDry = step(1.0 - uDry * 0.6, fract(aRnd * 7.31 + h2)); vAO = 0.45 + 0.55 * t;
        `);
      sh.fragmentShader = `varying float vT; varying float vR; varying float vDry; varying float vAO;\n` + sh.fragmentShader
        .replace('#include <color_fragment>', `#include <color_fragment>
          vec3 base = vec3(0.025, 0.045, 0.012), mid = vec3(0.065, 0.12, 0.028), tip = vec3(0.13, 0.19, 0.05);
          vec3 gc = mix(base, mid, smoothstep(0.0, 0.5, vT)); gc = mix(gc, tip, smoothstep(0.45, 1.0, vT));
          gc *= 0.8 + 0.4 * vR;
          gc = mix(gc, vec3(0.34, 0.29, 0.16) * (0.7 + 0.5 * vT), vDry * 0.85);
          diffuseColor.rgb *= gc * vAO * 1.7;`)
        .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
          normal = normalize(mix(normal, (viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz, 0.6));`);
    };
    mat.customProgramCacheKey = () => 'grass' + (card ? 'c' : 'b');
    const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; mesh.receiveShadow = true; mesh.castShadow = false;
    scene.add(mesh); layers.push(L);
    return mesh;
  };
  if (pc) {
    mk({ cell: 0.5, R: 7, blades: 130, segs: 3, width: 0.018, height: 0.12 });
    mk({ cell: 0.8, R: 20, R0: 7, blades: 70, segs: 2, width: 0.03, height: 0.11 });
  } else {
    mk({ cell: 0.8, R: 9, blades: 7, segs: 1, width: 0.32, height: 0.12, card: true });
  }
  const tmp = new THREE.Vector3();
  return {
    update(camera) {
      camera.getWorldPosition(tmp);
      // each layer's grid snaps to its own cell size, so blades stay put in the world as she walks
      for (const L of layers) L.uOrigin.value.set(Math.floor((tmp.x - L.R) / L.cell) * L.cell, Math.floor((tmp.z - L.R) / L.cell) * L.cell);
    },
  };
}
