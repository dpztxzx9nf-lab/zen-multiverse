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
  const hueShift = dim.hueShift, satK = dim.sat;
  // what grows here: plausible pigments (green, olive, rust-red, burgundy, blue-green), never neon
  const FOL = [0.27, 0.2, 0.03, 0.95, 0.42], hue = FOL[Math.floor(R() * FOL.length)] + (R() - 0.5) * 0.03;
  const C = (h, s, l) => new THREE.Color().setHSL((((h + hueShift * 0.25) % 1) + 1) % 1, Math.min(0.42, s * 0.55 * Math.min(1, satK)), Math.min(0.66, Math.max(0.12, l * 0.85)));
  // ground palettes: real geology (salt pans, forest soils, red sandstone or basalt, snow and blue ice,
  // pale or black sand), nudged a little per planet. The alien twist is in what grows and in the sky,
  // never candy colours: dimensions shift hue only gently.
  const X = (hex, dh = 0, ds = 0, dl = 0) => {
    const c = new THREE.Color(hex), hsl = {}; c.getHSL(hsl);
    return c.setHSL((((hsl.h + dh + hueShift * 0.25) % 1) + 1) % 1, Math.min(1, Math.max(0, (hsl.s + ds) * Math.min(1, satK))), Math.min(1, Math.max(0, hsl.l + dl)));
  };
  const j = () => (R() - 0.5) * 0.04;
  const desert = R() < 0.6 ? ['#a8674a', '#7a4a36'] : ['#4a4743', '#33312f']; // red sandstone, or basalt
  const sand = R() < 0.7 ? ['#cbb894', '#a8946f'] : ['#55504a', '#3c3936'];   // pale quartz sand, or black volcanic
  const soil = ['#5a4a36', '#3e3426'];
  const pal = {
    salt: [X(R() < 0.25 ? '#e3d3cf' : '#ddd8cc', j()), X('#b9b0a0', j())],
    forest: [X(soil[0], j()), X(soil[1], j())],
    crystal: [X(desert[0], j()), X(desert[1], j())],
    ice: [X('#e9eef2', 0, 0, -0.02), X('#a9bccb', j())],
    shore: [X(sand[0], j()), X(sand[1], j())],
    deep: X('#22302f', j()),
  };
  // sky: Rayleigh blue for most worlds; some pale teal, some dusty butterscotch (Mars-like), a few violet haze
  const sk = R();
  const SKY = sk < 0.55 ? ['#3f72b5', '#b9cfe3'] : sk < 0.75 ? ['#3f828c', '#c3d9d5'] : sk < 0.9 ? ['#9c8062', '#d6c1a2'] : ['#5f6493', '#c8c8d8'];
  const skyHue = new THREE.Color(SKY[0]).getHSL({}).h;
  const sky = {
    zenith: X(SKY[0], j() * 0.5), horizon: X(SKY[1], j() * 0.5), sun: X(sk >= 0.75 && sk < 0.9 ? '#fff1dc' : '#fff7ea'), ground: X(soil[1]),
    sunElev: 0.3 + R() * 0.55, sunAz: R() * Math.PI * 2, moons: Math.floor(R() * 3),
  };
  if (dim.sky) { const t = new THREE.Color(dim.sky); sky.horizon.lerp(t, 0.2); sky.zenith.lerp(t.clone().multiplyScalar(0.5), 0.15); }
  const water = sk >= 0.75 && sk < 0.9 ? { shallow: X('#5d6f5a'), deep: X('#1d2a24') } : { shallow: X('#2f6d72', j()), deep: X('#0d2630', j()) };
  void C;

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
  const ROCK = X(desert === undefined ? '#6b6258' : '#6f665c', j());
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
    out.lerp(tmp.copy(ROCK), sstep(0.45, 0.8, slope) * 0.6);
    if (hasSea && h < sea) out.lerp(pal.deep, sstep(0, 6, sea - h));
    return out;
  }
  return { seed, dimKey, dim, name, height, biomesAt, dominant, groundColor, sea, hasSea, gravity, sky, water, pal, C, hue, R: rng(seed * 3 + 1) };
}
