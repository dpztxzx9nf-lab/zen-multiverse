// A planet from a seed: terrain height, blended biomes, colours, sky and physics.
// Everything is a pure function of (seed, dimension), so a world is the same every visit.
//   const W = makePlanet(seed, 'prime'); W.height(x, z); W.biomes(x, z) -> weights; W.ground colour
import * as THREE from 'three';
import { rng, makeName, DIMENSIONS } from './names.js';

export const BIOMES = ['salt', 'forest', 'crystal', 'ice', 'shore'];
export const BIOME_NAMES = { salt: 'salt flats', forest: 'alien forest', crystal: 'crystal fields', ice: 'ice fields', shore: 'ocean shore' };

function perlin(seed) {
  const r = rng(seed), p = new Uint8Array(512), g = new Float32Array(512);
  const base = [...Array(256).keys()];
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [base[i], base[j]] = [base[j], base[i]]; }
  for (let i = 0; i < 512; i++) { p[i] = base[i & 255]; g[i] = r() * Math.PI * 2; }
  const gx = new Float32Array(512), gz = new Float32Array(512); for (let i = 0; i < 512; i++) { gx[i] = Math.cos(g[i]); gz[i] = Math.sin(g[i]); }
  return (x, z) => {
    const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz, X = ix & 255, Z = iz & 255;
    const a = p[p[X] + Z], b = p[p[X + 1] + Z], c = p[p[X] + Z + 1], d = p[p[X + 1] + Z + 1];
    const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10), v = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
    const na = gx[a] * fx + gz[a] * fz, nb = gx[b] * (fx - 1) + gz[b] * fz, nc = gx[c] * fx + gz[c] * (fz - 1), nd = gx[d] * (fx - 1) + gz[d] * (fz - 1);
    return (na + (nb - na) * u + (nc - na) * v + (na - nb - nc + nd) * u * v) * 1.4; // ~[-1, 1]
  };
}
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function makePlanet(seed, dimKey = 'prime') {
  const dim = DIMENSIONS[dimKey] || DIMENSIONS.prime;
  const R = rng(seed * 7 + 13);
  const n1 = perlin(seed), n2 = perlin(seed + 1), n3 = perlin(seed + 2), n4 = perlin(seed + 3);
  const fbm = (n, x, z, o) => { let s = 0, a = 0.5, f = 1; for (let i = 0; i < o; i++) { s += a * n(x * f, z * f); f *= 2.02; a *= 0.5; } return s; };
  const name = makeName(seed, 0);
  // ---- character of this world
  const A = 9 + R() * 20, rough = 0.45 + R() * 0.2;
  const hasSea = R() < 0.8, sea = hasSea ? -3 - R() * 5 : -1e9;
  const tBias = (R() - 0.5) * 0.5, mBias = (R() - 0.5) * 0.5; // hot/cold, wet/dry world
  const gravity = 9.81 * (0.72 + R() * 0.38) * dim.gravity;
  const hue = R(), hueShift = dim.hueShift, satK = dim.sat;
  const C = (h, s, l) => new THREE.Color().setHSL((((h + hueShift) % 1) + 1) % 1, Math.min(1, s * satK), l);
  // ground palettes (biome base colours drift with the planet's hue)
  const pal = {
    salt: [C(0.09 + hue * 0.08, 0.3, 0.78), C(0.06, 0.28, 0.62)],
    forest: [C(hue, 0.5, 0.33), C(hue + 0.07, 0.55, 0.22)],
    crystal: [C(hue + 0.55, 0.3, 0.46), C(hue + 0.6, 0.35, 0.32)],
    ice: [C(0.56, 0.3, 0.74), C(0.6, 0.38, 0.52)],
    shore: [C(0.1 + hue * 0.05, 0.38, 0.7), C(0.08, 0.3, 0.55)],
    deep: C(hue + 0.5, 0.35, 0.22),
  };
  const skyHue = (hue + 0.45 + R() * 0.2) % 1;
  const sky = {
    zenith: C(skyHue, 0.6, 0.45), horizon: C(skyHue + 0.04, 0.42, 0.74), sun: C(0.1, 0.5, 0.92), ground: C(hue, 0.25, 0.3),
    sunElev: 0.35 + R() * 0.5, sunAz: R() * Math.PI * 2, moons: Math.floor(R() * 3),
  };
  if (dim.sky) { const t = new THREE.Color(dim.sky); sky.horizon.lerp(t, 0.45); sky.zenith.lerp(t.clone().multiplyScalar(0.5), 0.4); }
  const water = { shallow: C(skyHue - 0.02, 0.55, 0.55), deep: C(skyHue + 0.02, 0.6, 0.25) };

  function climate(x, z) {
    const t = 0.5 + fbm(n3, x / 1100, z / 1100, 3) * 1.1 + tBias;
    const m = 0.5 + fbm(n4, x / 1000 + 9, z / 1000, 3) * 1.1 + mBias;
    return [t, m];
  }
  const CENT = { salt: [0.82, 0.18], forest: [0.62, 0.8], crystal: [0.32, 0.22], ice: [0.08, 0.6] };
  const w4 = { salt: 0, forest: 0, crystal: 0, ice: 0 };
  function landWeights(x, z) {
    const [t, m] = climate(x, z); let s = 0;
    for (const k in CENT) { const dx = t - CENT[k][0], dm = m - CENT[k][1]; const w = Math.exp(-(dx * dx + dm * dm) / 0.035); w4[k] = w; s += w; }
    for (const k in w4) w4[k] /= s || 1;
    return w4;
  }
  function height(x, z) {
    const wx = x + n2(x / 420, z / 420) * 45, wz = z + n2(x / 420 + 5.2, z / 420) * 45;
    let h = fbm(n1, wx / 300, wz / 300, 5) * A * 2 + fbm(n1, wx / 60, wz / 60, 3) * A * 0.12 * rough;
    const w = landWeights(x, z);
    // salt flats lie dead flat; crystal fields push up sharp ridges; ice rolls in smooth domes
    const flat = (hasSea ? sea + 1.2 : -2) + n2(x / 40, z / 40) * 0.15;
    h = h + (flat - h) * sstep(0.35, 0.8, w.salt);
    const ridge = Math.pow(1 - Math.abs(n2(wx / 140, wz / 140)), 4) * 22;
    h += ridge * w.crystal;
    h += (n3(x / 90, z / 90) * 0.5 + 0.5) * 7 * w.ice;
    // always arrive on dry land
    const r2 = x * x + z * z;
    if (hasSea) { const lift = Math.exp(-r2 / (70 * 70)); h = h + Math.max(0, sea + 3 - h) * lift; }
    return h + (1 - Math.exp(-r2 / (40 * 40))) * 0 + 0;
  }
  function biomesAt(x, z, h) {
    const w = { ...landWeights(x, z), shore: 0 };
    if (hasSea) { const s = 1 - sstep(1.2, 4, h - sea); w.shore = s; const k = 1 - s; for (const b of ['salt', 'forest', 'crystal', 'ice']) w[b] *= k; }
    return w;
  }
  function dominant(w) { let best = 'forest', bv = -1; for (const k in w) if (w[k] > bv) { bv = w[k]; best = k; } return best; }
  const tmp = new THREE.Color(), tmp2 = new THREE.Color();
  function groundColor(x, z, h, slope, out) {
    const w = biomesAt(x, z, h);
    out.setRGB(0, 0, 0);
    const v = n2(x / 6, z / 6) * 0.5 + 0.5, v2 = n3(x / 23, z / 23) * 0.5 + 0.5;
    for (const k of BIOMES) {
      if (w[k] < 0.01) continue;
      tmp.copy(pal[k][0]).lerp(pal[k][1], v * 0.6 + v2 * 0.4);
      if (k === 'salt') { const cell = Math.abs(n4(x / 3.2, z / 3.2)); tmp.multiplyScalar(cell < 0.06 ? 0.82 : 1); }
      if (k === 'ice') tmp.multiplyScalar(0.9 + 0.1 * Math.sin(x * 0.7 + n2(x / 30, z / 30) * 6));
      if (k === 'crystal') tmp.lerp(tmp2.setRGB(0.95, 0.9, 1), Math.pow(Math.max(0, n2(x / 2, z / 2)), 3) * 0.6);
      out.r += tmp.r * w[k]; out.g += tmp.g * w[k]; out.b += tmp.b * w[k];
    }
    // steep slopes show bare rock; underwater sand darkens toward the deep
    out.lerp(tmp.copy(pal.crystal[1]).multiplyScalar(0.8), sstep(0.45, 0.8, slope) * 0.6);
    if (hasSea && h < sea) out.lerp(pal.deep, sstep(0, 6, sea - h));
    return out;
  }
  return { seed, dimKey, dim, name, height, biomesAt, dominant, groundColor, sea, hasSea, gravity, sky, water, pal, C, hue, R: rng(seed * 3 + 1) };
}
