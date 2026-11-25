// Procedural garden flowers at five growth stages (0 seeded, 1 sprout, 2 leafy, 3 bud, 4 bloom).
// One merged, vertex-coloured mesh per plant (a few hundred to ~2k triangles).
//   buildPlant('snapdragon', stage, seed) -> THREE.Mesh (origin at the soil)
import * as THREE from 'three';
import { mulberry32, mergeGeometries } from '../util.js';

const MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, side: THREE.DoubleSide });
const col = new THREE.Color();
function paint(g, c, jitter = 0, rnd = Math.random) {
  g = g.index ? g.toNonIndexed() : g;
  const n = g.attributes.position.count, a = new Float32Array(n * 3);
  col.set(c); if (jitter) col.offsetHSL((rnd() - 0.5) * jitter * 0.1, 0, (rnd() - 0.5) * jitter * 0.12);
  for (let i = 0; i < n; i++) { a[i * 3] = col.r; a[i * 3 + 1] = col.g; a[i * 3 + 2] = col.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  if (g.attributes.uv) g.deleteAttribute('uv');
  return g;
}
const STEM = '#4f7a3a', LEAF = '#5e8f45', LEAF2 = '#4a7a3a';
const e = new THREE.Euler(), q = new THREE.Quaternion(), m4 = new THREE.Matrix4(), v3 = new THREE.Vector3(), s3 = new THREE.Vector3();
function place(g, x, y, z, rx = 0, ry = 0, rz = 0, s = 1) {
  m4.compose(v3.set(x, y, z), q.setFromEuler(e.set(rx, ry, rz, 'YXZ')), s3.set(s, s, s));
  return g.applyMatrix4(m4);
}
// a curved stem from (x,0,z) up to height h, leaning by (lx, lz)
function stem(parts, x, z, h, lx, lz, r = 0.006) {
  const pts = []; for (let i = 0; i <= 4; i++) { const t = i / 4; pts.push(new THREE.Vector3(x + lx * t * t, h * t, z + lz * t * t)); }
  const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 5, r, 4, false);
  parts.push(paint(g, STEM));
  return pts[4];
}
function leaf(parts, x, y, z, ry, len = 0.12, w = 0.035, tilt = 0.9, c = LEAF, rnd) {
  const g = new THREE.SphereGeometry(1, 6, 3).scale(w, 0.006, len / 2).translate(0, 0, len / 2);
  parts.push(paint(place(g, x, y, z, -Math.PI / 2 + tilt, ry, 0), c, 1, rnd));
}
const petalG = (l, w) => new THREE.SphereGeometry(1, 5, 3).scale(w, 0.005, l / 2).translate(0, 0, l / 2);

const BUILD = {
  snapdragon(parts, rnd, k) {
    const cols = ['#d9558f', '#f0a3c0', '#f3cf4a', '#e86a6a', '#f6eedf', '#b84a9a'];
    const c = cols[Math.floor(rnd() * cols.length)];
    for (let s = 0; s < 5; s++) {
      const a = s * 1.3 + rnd(), r = 0.03 + rnd() * 0.05, x = Math.cos(a) * r, z = Math.sin(a) * r;
      const h = (0.38 + rnd() * 0.14) * k.h;
      const top = stem(parts, x, z, h, (rnd() - 0.5) * 0.05, (rnd() - 0.5) * 0.05, 0.007);
      for (let i = 0; i < 3; i++) leaf(parts, x, h * (0.15 + i * 0.12), z, a + i * 2.3, 0.09, 0.016, 1.0, LEAF, rnd);
      const nf = k.bloom ? 9 : k.bud ? 6 : 0;
      for (let i = 0; i < nf; i++) {
        const u = i / nf, y = h * (0.55 + u * 0.45), phi = i * 2.4;
        const fs = (k.bloom ? 0.026 : 0.013) * (1 - u * 0.45);
        const fx = x + (top.x - x) * u + Math.sin(phi) * fs * 0.8, fz = z + (top.z - z) * u + Math.cos(phi) * fs * 0.8;
        const fc = k.bloom && u < 0.8 ? c : '#6f9a4a';
        parts.push(paint(place(new THREE.SphereGeometry(fs, 6, 4).scale(1, 0.85, 1.25), fx, y, fz, 0, phi), fc, 1, rnd));
        if (k.bloom && u < 0.8) parts.push(paint(place(new THREE.SphereGeometry(fs * 0.6, 5, 3), fx + Math.sin(phi) * fs * 0.7, y - fs * 0.4, fz + Math.cos(phi) * fs * 0.7), '#f6d24a'));
      }
    }
  },
  columbine(parts, rnd, k) {
    const sep = rnd() < 0.7 ? '#7f9be0' : '#b28ad9';
    for (let i = 0; i < 9; i++) leaf(parts, 0, 0.02, 0, i * 0.7, 0.11, 0.04, 1.25, '#6a9a6a', rnd); // ferny basal leaves
    const n = 5 + Math.floor(rnd() * 2);
    for (let s = 0; s < n; s++) {
      const a = s * 2.4 + rnd(), h = (0.32 + rnd() * 0.12) * k.h;
      const top = stem(parts, 0, 0, h, Math.cos(a) * 0.1, Math.sin(a) * 0.1, 0.005);
      if (!k.bud && !k.bloom) continue;
      const fl = []; const sc = k.bloom ? 1 : 0.45;
      for (let p = 0; p < 5; p++) fl.push(paint(place(petalG(0.05 * sc, 0.014 * sc), 0, 0, 0, -0.6, p * 1.2566), k.bloom ? sep : '#7ea36a'));
      if (k.bloom) {
        for (let p = 0; p < 5; p++) fl.push(paint(place(petalG(0.03, 0.012), 0, 0.006, 0, -1.1, p * 1.2566 + 0.63), '#f7f4ee'));
        fl.push(paint(new THREE.ConeGeometry(0.006, 0.02, 5).translate(0, -0.006, 0), '#f3d54a'));
      }
      const f = mergeGeometries(fl);
      parts.push(place(f, top.x, top.y, top.z, 2.4, a, 0)); // nodding
    }
  },
  cosmos(parts, rnd, k) {
    const cols = ['#f19ab8', '#f6f0f3', '#d6417f', '#f4b9cc'];
    const n = 6 + Math.floor(rnd() * 3);
    for (let s = 0; s < n; s++) {
      const a = s * 1.3 + rnd() * 0.6, h = (0.5 + rnd() * 0.25) * k.h;
      const top = stem(parts, Math.cos(a) * 0.03, Math.sin(a) * 0.03, h, Math.cos(a) * 0.12, Math.sin(a) * 0.12, 0.004);
      for (let i = 0; i < 2; i++) leaf(parts, Math.cos(a) * 0.04, h * (0.25 + i * 0.25), Math.sin(a) * 0.04, a + i * 3, 0.08, 0.008, 0.6, LEAF, rnd);
      if (!k.bud && !k.bloom) continue;
      const fl = [];
      if (k.bloom) {
        const c = cols[Math.floor(rnd() * cols.length)];
        for (let p = 0; p < 8; p++) fl.push(paint(place(petalG(0.055, 0.02), 0, 0, 0, 0.12, p * 0.785), c, 0.6, rnd));
        fl.push(paint(new THREE.SphereGeometry(0.012, 6, 4).scale(1, 0.6, 1), '#f2c230'));
      } else fl.push(paint(new THREE.SphereGeometry(0.014, 6, 4), '#6f9a4a'));
      parts.push(place(mergeGeometries(fl), top.x, top.y, top.z, -0.35, a, 0));
    }
  },
  poppy(parts, rnd, k) {
    const c = rnd() < 0.75 ? '#e8613a' : '#f09a3a';
    for (let i = 0; i < 6; i++) leaf(parts, 0, 0.02, 0, i * 1.1, 0.11, 0.03, 1.2, '#7a9a6a', rnd);
    const n = 5;
    for (let s = 0; s < n; s++) {
      const a = s * 1.3 + rnd(), h = (0.35 + rnd() * 0.15) * k.h;
      const top = stem(parts, 0, 0, h, Math.cos(a) * 0.09, Math.sin(a) * 0.09, 0.0045);
      if (!k.bud && !k.bloom) continue;
      const fl = [];
      if (k.bloom) {
        for (let p = 0; p < 4; p++) {
          const g = new THREE.SphereGeometry(0.05, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.5).scale(0.95, 0.85, 0.6).rotateX(-0.25).translate(0, 0, 0.018);
          fl.push(paint(place(g, 0, 0, 0, 0, p * 1.5708 + 0.3), c, 0.4, rnd));
        }
        fl.push(paint(new THREE.SphereGeometry(0.011, 6, 4).translate(0, 0.012, 0), '#2a2a2a'));
      } else fl.push(paint(new THREE.SphereGeometry(0.016, 6, 4).scale(1, 1.4, 1), '#7a9a5a'));
      parts.push(place(mergeGeometries(fl), top.x, top.y, top.z, -0.1, a, 0));
    }
  },
  lavender(parts, rnd, k) {
    const c = '#8f74c9';
    const n = 22;
    for (let s = 0; s < n; s++) {
      const a = s * 2.399, r = 0.02 + (s / n) * 0.06, h = (0.3 + rnd() * 0.12) * k.h;
      const top = stem(parts, Math.cos(a) * r * 0.4, Math.sin(a) * r * 0.4, h, Math.cos(a) * r * 1.6, Math.sin(a) * r * 1.6, 0.0035);
      leaf(parts, Math.cos(a) * r * 0.3, 0.03, Math.sin(a) * r * 0.3, a, 0.09, 0.008, 0.5, '#8aa58a', rnd);
      if (!k.bud && !k.bloom) continue;
      for (let i = 0; i < 6; i++) {
        const y = top.y - i * 0.012;
        parts.push(paint(new THREE.SphereGeometry(k.bloom ? 0.0075 : 0.005, 4, 3).translate(top.x, y, top.z), k.bloom ? c : '#8a9a8a', 0.8, rnd));
      }
    }
  },
  sunflower(parts, rnd, k) {
    const h = 1.35 * k.h;
    const top = stem(parts, 0, 0, h, 0.03, 0.06, 0.014);
    for (let i = 0; i < 6; i++) leaf(parts, top.x * (i / 6), h * (0.15 + i * 0.12), top.z * (i / 6), i * 2.2, 0.2 - i * 0.015, 0.075 - i * 0.006, 1.0, LEAF2, rnd);
    if (!k.bud && !k.bloom) return;
    const fl = [];
    if (k.bloom) {
      for (let p = 0; p < 22; p++) fl.push(paint(place(petalG(0.08, 0.02), 0, 0, 0, 0.1 + (p % 2) * 0.12, p * 0.2856), '#f2c230', 0.5, rnd));
      fl.push(paint(new THREE.CylinderGeometry(0.075, 0.07, 0.03, 16), '#5a3a1e'));
    } else fl.push(paint(new THREE.SphereGeometry(0.05, 8, 6).scale(1, 0.6, 1), '#6f9a4a'));
    parts.push(place(mergeGeometries(fl), top.x, top.y, top.z, -1.15, 0.0, 0));
  },
};

export function buildPlant(species, stage, seed = 1) {
  const rnd = mulberry32(seed);
  const parts = [];
  // seeded: a little mound with a wooden marker stake (colour-tagged)
  if (stage <= 0) {
    parts.push(paint(new THREE.SphereGeometry(0.07, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.35, 1), '#4a3526'));
  } else if (stage === 1) {
    for (let i = 0; i < 3; i++) {
      const a = i * 2.1 + rnd(), x = Math.cos(a) * 0.03, z = Math.sin(a) * 0.03;
      stem(parts, x, z, 0.04, 0, 0, 0.003);
      leaf(parts, x, 0.04, z, a, 0.025, 0.012, 1.3, '#7fb05a', rnd);
      leaf(parts, x, 0.04, z, a + Math.PI, 0.025, 0.012, 1.3, '#7fb05a', rnd);
    }
  } else {
    const k = { h: stage === 2 ? 0.45 : stage === 3 ? 0.9 : 1, bud: stage === 3, bloom: stage >= 4 };
    // a leafy base so every plant reads as a full clump, not a few stems
    if (species !== 'lavender' && species !== 'sunflower') for (let i = 0; i < 7; i++) leaf(parts, (rnd() - 0.5) * 0.04, 0.015, (rnd() - 0.5) * 0.04, i * 0.9 + rnd(), 0.1 + rnd() * 0.04, 0.03, 1.15 + rnd() * 0.2, i % 2 ? LEAF : LEAF2, rnd);
    BUILD[species](parts, rnd, k);
  }
  const g = mergeGeometries(parts);
  if (stage >= 2 && species !== 'sunflower') g.scale(1.25, 1.25, 1.25);
  const m = new THREE.Mesh(g, MAT);
  m.castShadow = stage >= 2; m.receiveShadow = true;
  return m;
}
