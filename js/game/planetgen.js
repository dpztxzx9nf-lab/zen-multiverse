// A planet from a seed: terrain height, blended biomes, colours, sky and physics.
// Everything is a pure function of (seed, dimension, era), so a world is the same every visit.
// The planet is a full sphere (radius rules.sphereR): height and biomes are sampled at the point on the
// globe, so there are no edges anywhere. The scene works in one tile's local frame at a time (see
// ../universe/sphere.js); W.setFrame(frame) re-bases height(x, z) etc. onto another tile.
//   const W = makePlanet(seed, 'prime', { rules }); W.height(x, z); W.biomesAt(x, z, h) -> weights
import * as THREE from 'three';
import { rng, hash, makeName, DIMENSIONS } from './names.js';
import { perlin3, fbm3 } from '../universe/noise3.js';
import { makeFrame, tileOf } from '../universe/sphere.js';

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

export function makePlanet(seed, dimKey = 'prime', { rules = null, site: siteOpt = null } = {}) {
  let site = null; // a home site (garden / moon base) at the arrival spot: ground matched to the hand-built world
  const dim = DIMENSIONS[dimKey] || DIMENSIONS.prime;
  const R = rng(seed * 7 + 13);
  const n1 = perlin(seed), n2 = perlin(seed + 1), n3 = perlin(seed + 2), n4 = perlin(seed + 3);
  void n1;
  const q1 = perlin3(seed), q2 = perlin3(seed + 1), q3 = perlin3(seed + 2), q4 = perlin3(seed + 3);
  const Rg = rules ? rules.sphereR : 6400;
  let frame = null; const dv = [0, 0, 0];
  // local (x, z) -> metres on the globe (p = dir * R), through the current tile frame
  const P3 = (x, z) => { frame.toDir(x, z, dv); return dv; };
  const fbm = (n, x, z, o) => { let s = 0, a = 0.5, f = 1; for (let i = 0; i < o; i++) { s += a * n(x * f, z * f); f *= 2.02; a *= 0.5; } return s; };
  const name = makeName(seed, 0);
  // ---- character of this world
  const A = 9 + R() * 20, rough = 0.45 + R() * 0.2;
  const hasSea = R() < 0.8, sea = hasSea ? -3 - R() * 5 : -1e9;
  const tBias = (R() - 0.5) * 0.5, mBias = (R() - 0.5) * 0.5; // hot/cold, wet/dry world
  const gravity = 9.81 * (0.72 + R() * 0.38) * dim.gravity;
  const hueShift = dim.hueShift, satK = dim.sat;
  // the world's laws decide: liquid water makes a sea, temperature tilts the climate, gravity is physics
  let gravityR = gravity, hasSeaR = hasSea, seaR = sea, tBiasR = tBias;
  if (rules) {
    gravityR = rules.gravity;
    hasSeaR = rules.water.liquid; seaR = hasSeaR ? rules.water.seaLevel : -1e9; // no liquid water, no sea
    tBiasR = Math.max(-0.75, Math.min(0.75, (rules.temperature.meanC - 12) / 45));
  }
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
  let sk = R();
  // sky colour from the air itself: Rayleigh blue under thick N2/O2, butterscotch dust under thin CO2,
  // orange haze under methane, pale yellow under sulfur, black where there is no air at all
  let SKYR = null;
  if (rules) {
    const a = rules.atmosphere, c = a.comp;
    if (a.pressureKPa < 0.5) SKYR = ['#02030a', '#14151c'];
    else if (c.CH4 > 0.02) SKYR = ['#8a5a2c', '#d9a86a'];
    else if (c.SO2 > 0 || a.pressureKPa > 2000) SKYR = ['#b9a46a', '#e8dcb0'];
    else if (a.pressureKPa < 20 || c.CO2 > 0.5) { sk = 0.8; SKYR = a.pressureKPa < 3 ? ['#3a3330', '#c9a27c'] : null; }
    else if (sk >= 0.75 && sk < 0.9) sk = 0.3;
  }
  const SKY = SKYR || (sk < 0.55 ? ['#3f72b5', '#b9cfe3'] : sk < 0.75 ? ['#3f828c', '#c3d9d5'] : sk < 0.9 ? ['#9c8062', '#d6c1a2'] : ['#5f6493', '#c8c8d8']); // (airless worlds were getting a blue sky)
  const skyHue = new THREE.Color(SKY[0]).getHSL({}).h;
  const sky = {
    zenith: X(SKY[0], j() * 0.5), horizon: X(SKY[1], j() * 0.5), sun: X(sk >= 0.75 && sk < 0.9 ? '#fff1dc' : '#fff7ea'), ground: X(soil[1]),
    sunElev: 0.3 + R() * 0.55, sunAz: R() * Math.PI * 2, moons: Math.floor(R() * 3),
    star: rules ? new THREE.Color(rules.star.col) : null, haze: rules ? Math.min(1, rules.atmosphere.pressureKPa / 101.3) : 1,
  };
  if (rules && sky.star) sky.sun.lerp(sky.star, 0.6);
  if (dim.sky) { const t = new THREE.Color(dim.sky); sky.horizon.lerp(t, 0.2); sky.zenith.lerp(t.clone().multiplyScalar(0.5), 0.15); }
  // what the ground is made of follows the world: airless worlds are grey regolith and basalt, thin CO2
  // worlds rust-red dust, scorching ones dark basalt, frozen ones ice and frost
  if (rules) {
    const life = rules.biology.life, Pk = rules.atmosphere.pressureKPa, tC = rules.temperature.meanC;
    const set = (k, a, b) => { pal[k] = [X(a, j()), X(b, j())]; };
    if (Pk < 0.5 && life === 'none') { set('salt', '#a9a8a4', '#8d8c88'); set('forest', '#7d7b77', '#5f5d5a'); set('crystal', '#55534f', '#3e3d3b'); set('shore', '#9a9893', '#76746f'); set('ice', '#b4b2ad', '#93918c'); }
    else if (Pk < 20 && rules.atmosphere.comp.CO2 > 0.5) { set('salt', '#c99a72', '#a8774f'); set('forest', '#9c5a3a', '#7a4128'); set('crystal', '#7a4a36', '#5a3424'); set('shore', '#b9825c', '#93603f'); set('ice', '#d8b8a4', '#b8957f'); }
    else if (tC > 120) { set('salt', '#6a625a', '#4c4640'); set('forest', '#3f3b37', '#2c2926'); set('crystal', '#4a4743', '#33312f'); set('shore', '#5a544e', '#433f3a'); }
    if (life === 'none' || life === 'microbial') pal.forest = [pal.forest[0].clone().lerp(pal.crystal[0], 0.4), pal.forest[1].clone().lerp(pal.crystal[1], 0.4)];
  }
  const water = sk >= 0.75 && sk < 0.9 ? { shallow: X('#5d6f5a'), deep: X('#1d2a24') } : { shallow: X('#2f6d72', j()), deep: X('#0d2630', j()) };
  void C;

  function climate(x, z) { return climateDir(P3(x, z)); }
  function climateDir(p) {
    const X = p[0] * Rg, Y = p[1] * Rg, Z = p[2] * Rg;
    // latitude: the poles are colder (spin axis = +y), plus the world's own warm or cold bias
    const lat = Math.abs(p[1]);
    const t = 0.5 + fbm3(q3, X / 1100, Y / 1100, Z / 1100, 3) * 1.1 + tBiasR - Math.pow(lat, 2.2) * 0.75 + 0.18;
    const m = 0.5 + fbm3(q4, X / 1000 + 9, Y / 1000, Z / 1000, 3) * 1.1 + mBias;
    return [t, m];
  }
  const CENT = { salt: [0.82, 0.18], forest: [0.62, 0.8], crystal: [0.32, 0.22], ice: [0.08, 0.6] };
  const w4 = { salt: 0, forest: 0, crystal: 0, ice: 0 };
  function landWeights(x, z) { return landWeightsDir(P3(x, z)); }
  function landWeightsDir(p) {
    const [t, m] = climateDir(p); let s = 0;
    for (const k in CENT) { const dx = t - CENT[k][0], dm = m - CENT[k][1]; const w = Math.exp(-(dx * dx + dm * dm) / 0.035); w4[k] = w; s += w; }
    for (const k in w4) w4[k] /= s || 1;
    return w4;
  }
  function height(x, z) { return heightDir(P3(x, z)); }
  function heightDir(p) {
    const X = p[0] * Rg, Y = p[1] * Rg, Z = p[2] * Rg;
    const wx = X + q2(X / 420, Y / 420, Z / 420) * 45, wy = Y + q2(X / 420 + 5.2, Y / 420, Z / 420) * 45, wz = Z + q2(X / 420, Y / 420 + 3.1, Z / 420 - 1.7) * 45;
    let h = fbm3(q1, wx / 300, wy / 300, wz / 300, 5) * A * 2 + fbm3(q1, wx / 60, wy / 60, wz / 60, 3) * A * 0.12 * rough;
    // continents: a very low-frequency swell lifts land out of the sea and sinks ocean basins
    h += fbm3(q4, X / 2600 + 3, Y / 2600, Z / 2600, 2) * A * 1.6;
    const w = landWeightsDir([p[0], p[1], p[2]]);
    // salt flats lie dead flat; crystal fields push up sharp ridges; ice rolls in smooth domes
    const flat = (hasSeaR ? seaR + 1.2 : -2) + q2(X / 40, Y / 40, Z / 40) * 0.15;
    h = h + (flat - h) * sstep(0.35, 0.8, w.salt) * (hasSeaR ? sstep(seaR - 1, seaR + 3, h) : 1); // salt pans on land, never filling a sea basin
    const ridge = Math.pow(1 - Math.abs(q2(wx / 140, wy / 140, wz / 140)), 4) * 22;
    h += ridge * w.crystal;
    h += (q3(X / 90, Y / 90, Z / 90) * 0.5 + 0.5) * 7 * w.ice;
    if (site) {
      const c = p[0] * site.d[0] + p[1] * site.d[1] + p[2] * site.d[2];
      if (c > site.cmin) {
        const dist = Math.acos(Math.min(1, c)) * Rg, k = sstep(site.r0, site.r1, dist);
        if (k < 1) { let hs = site.h; if (site.local) { const xz = site.fr.fromDir(p); hs += site.local(xz[0] - site.x, xz[1] - site.z); } h = hs + (h - hs) * k; }
      }
    }
    return h;
  }
  function biomesAt(x, z, h) {
    const w = { ...landWeights(x, z), shore: 0 };
    if (hasSeaR) { const s = 1 - sstep(1.2, 4, h - seaR); w.shore = s; const k = 1 - s; for (const b of ['salt', 'forest', 'crystal', 'ice']) w[b] *= k; }
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
    if (hasSeaR && h < seaR) out.lerp(pal.deep, sstep(0, 6, seaR - h));
    return out;
  }
  // whole-globe colour for the view from orbit (no micro detail): biome blend, rock, sea, polar ice
  const tmp3 = new THREE.Color();
  function colorDir(d, out) {
    const h = heightDir(d), w = { ...landWeightsDir(d), shore: 0 };
    if (hasSeaR) { const sh = 1 - sstep(1.2, 4, h - seaR); w.shore = sh; for (const b of ['salt', 'forest', 'crystal', 'ice']) w[b] *= 1 - sh; }
    out.setRGB(0, 0, 0);
    for (const k of BIOMES) { if (w[k] < 0.01) continue; tmp3.copy(pal[k][0]).lerp(pal[k][1], 0.4); out.r += tmp3.r * w[k]; out.g += tmp3.g * w[k]; out.b += tmp3.b * w[k]; }
    if (hasSeaR && h < seaR) out.copy(water.deep).lerp(water.shallow, sstep(-12, 0, h - seaR) * 0.5);
    return { h, c: out };
  }
  // arrival: a deterministic dry, gentle spot on the globe (searched from seeded directions)
  function setFrame(fr) { frame = fr; W.frame = fr; W.tile = fr.id; W.lseed = W.tile === W.spawnTile ? seed : hash(seed, ...fr.id.split(':').map(Number), 4093); }
  function findSpawn() {
    const r = rng(seed * 11 + 5);
    for (let k = 0; k < 64; k++) {
      const u = r() * 2 - 1, ph = r() * Math.PI * 2, c = Math.sqrt(1 - u * u), d = [c * Math.cos(ph), u * 0.7, c * Math.sin(ph)];
      const l = Math.hypot(...d); d[0] /= l; d[1] /= l; d[2] /= l;
      const id = tileOf(Rg, d); setFrame(makeFrame(Rg, id));
      const [x, z] = frame.fromDir(d), h = height(x, z);
      const slope = Math.abs(height(x + 4, z) - height(x - 4, z)) + Math.abs(height(x, z + 4) - height(x, z - 4));
      if ((!hasSeaR || h > seaR + 2) && slope < 2.5) return { tile: id, x, z };
    }
    return { tile: frame.id, x: 0, z: 0 };
  }
  const W = { seed, dimKey, dim, name, height, biomesAt, dominant, groundColor, sea: seaR, hasSea: hasSeaR, gravity: gravityR, sky, water, pal, C, hue, R: rng(seed * 3 + 1),
    rules, radius: Rg, setFrame, heightDir, colorDir, frame: null, tile: null, lseed: seed, spawnTile: null, spawn: null };
  W.spawn = findSpawn(); W.spawnTile = W.spawn.tile; setFrame(makeFrame(Rg, W.spawn.tile));
  if (siteOpt) {
    const fr = makeFrame(Rg, W.spawnTile), d = fr.toDir(W.spawn.x, W.spawn.z), h0 = height(W.spawn.x, W.spawn.z);
    const base = Math.max(h0, hasSeaR ? seaR + 2.5 : -1e9) + (siteOpt.lift || 0);
    site = { d, fr, x: W.spawn.x, z: W.spawn.z, h: base, r0: siteOpt.r0, r1: siteOpt.r1, local: siteOpt.local || null, cmin: Math.cos(siteOpt.r1 / Rg) };
    W.site = { kind: siteOpt.kind, tile: W.spawnTile, x: W.spawn.x, z: W.spawn.z, h: base, dir: d };
  }
  return W;
}
