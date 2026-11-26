// The endless universe: galaxy -> star system -> planet -> moon, all made from hashed coordinates.
// Nothing is stored except what the player changed; any address can be regenerated from scratch.
//
// Coordinates are 64-bit integers (BigInt), so there is no edge and no precision loss at any distance:
//   galaxy cell  g = [gx, gy]   one galaxy per cell, cells are GAL_CELL sectors apart (~2 million ly)
//   sector       s = [sx, sy]   galaxy-local, SECTOR_LY light years square, unlimited in every direction
//   star         i              index inside the sector (or 'home' for the Sun)
//   planet       p, moon m      orbit index around the star, moon index around the planet
// An address is a plain object { g:[BigInt,BigInt], s:[BigInt,BigInt], star, planet?, moon? } with a
// string form 'g0,0/s3,-2/5/1/0' (addrKey) for saves. Light-year distances are computed from BigInt
// differences, so two stars a quadrillion sectors from home are still exactly 3.2 ly apart.
import { rng, hash, makeName } from '../game/names.js';

export const SECTOR_LY = 10;          // a sector is 10 x 10 light years
export const GAL_CELL = 200000n;      // galaxies sit ~2 million ly apart (Andromeda is 2.5 Mly away)
const M64 = (1n << 64n) - 1n;
// splitmix64 over any mix of numbers / BigInts / strings
export function hash64(...parts) {
  let h = 0x9e3779b97f4a7c15n;
  for (let v of parts) {
    if (typeof v === 'string') { let x = 0n; for (let i = 0; i < v.length; i++) x = (x * 131n + BigInt(v.charCodeAt(i))) & M64; v = x; }
    v = BigInt.asUintN(64, BigInt(v));
    h = (h ^ v) & M64; h = (h + 0x9e3779b97f4a7c15n) & M64;
    let z = h; z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & M64; z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & M64; h = z ^ (z >> 31n);
  }
  return h;
}
export const seed31 = (h) => Number(h % 2147483646n) + 1;   // world seeds for makePlanet / rng
export const rngOf = (...parts) => rng(seed31(hash64(...parts)));

// ---------------------------------------------------------------- addresses
export const HOME = Object.freeze({ g: [0n, 0n], s: [0n, 0n], star: 'home' });
export function addrKey(a) {
  let k = `g${a.g[0]},${a.g[1]}/s${a.s[0]},${a.s[1]}/${a.star}`;
  if (a.planet != null) k += `/${a.planet}`; if (a.moon != null) k += `/${a.moon}`;
  return k;
}
export function parseAddr(k) {
  const m = /^g(-?\d+),(-?\d+)\/s(-?\d+),(-?\d+)\/(\w+)(?:\/(\d+))?(?:\/(\d+))?$/.exec(k || '');
  if (!m) return null;
  return { g: [BigInt(m[1]), BigInt(m[2])], s: [BigInt(m[3]), BigInt(m[4])], star: m[5] === 'home' ? 'home' : +m[5], planet: m[6] != null ? +m[6] : undefined, moon: m[7] != null ? +m[7] : undefined };
}
export const sameSystem = (a, b) => a && b && a.g[0] === b.g[0] && a.g[1] === b.g[1] && a.s[0] === b.s[0] && a.s[1] === b.s[1] && a.star === b.star;

// ---------------------------------------------------------------- galaxies
const GAL_KINDS = ['spiral', 'barred spiral', 'elliptical', 'lenticular', 'irregular', 'dwarf'];
export function galaxy(gx, gy) {
  gx = BigInt(gx); gy = BigInt(gy);
  const r = rngOf('gal', gx, gy), home = gx === 0n && gy === 0n;
  const kind = home ? 'barred spiral' : GAL_KINDS[Math.floor(r() * GAL_KINDS.length)];
  const radius = home ? 5000 : Math.round((kind === 'dwarf' ? 300 : kind === 'irregular' ? 1200 : 2500) * (0.6 + r() * 1.2)); // sectors
  const arms = kind.includes('spiral') ? 2 + Math.floor(r() * 3) : 0;
  return {
    g: [gx, gy], kind, radius, arms, twist: 2 + r() * 3, rot: r() * 6.283,
    // our Sun sits ~27,000 ly out in a spiral arm: home sector (0,0) is offset from the core
    core: home ? [-2700n, 0n] : [0n, 0n],
    metallicity: home ? 1 : 0.3 + r() * 1.4,
    name: home ? 'The Milky Way' : makeName(seed31(hash64('galname', gx, gy)), 3) + ' ' + (kind === 'dwarf' ? 'Dwarf' : 'Galaxy'),
    col: kind === 'elliptical' || kind === 'lenticular' ? '#ffd9a8' : kind === 'irregular' ? '#b9d4ff' : '#dfe6ff',
  };
}
// star density (expected stars per sector, before arm structure) at a galaxy-local sector
export function density(G, sx, sy) {
  const dx = Number(BigInt(sx) - G.core[0]), dy = Number(BigInt(sy) - G.core[1]);
  const d = Math.hypot(dx, dy) / G.radius;
  let k = Math.exp(-d * 2.2) * 5 + 0.15;  // a dense core falling off into the disk
  if (G.arms) { const a = Math.atan2(dy, dx), w = Math.cos(G.arms * (a - Math.log(d + 0.05) * G.twist - G.rot)); k *= 0.55 + 0.75 * Math.max(0, w); }
  if (d > 1) k = 0.15 * Math.exp(-(d - 1) * 3) + 0.004; // the halo thins out but never to zero: rogue stars everywhere
  return k;
}

// ---------------------------------------------------------------- stars
// main-sequence classes with rough real masses / luminosities; the weights follow the initial mass function
const CLASSES = [
  ['M', 0.6, 0.1, 0.45, 0.0008, 0.07, '#ffb38a', 3000], ['K', 0.2, 0.5, 0.8, 0.08, 0.6, '#ffd2a1', 4500], ['G', 0.12, 0.8, 1.04, 0.6, 1.5, '#fff1d6', 5600],
  ['F', 0.06, 1.04, 1.4, 1.5, 5, '#f4f2ff', 6700], ['A', 0.018, 1.4, 2.1, 5, 25, '#dfe8ff', 8500], ['B', 0.002, 2.1, 12, 25, 20000, '#a9c4ff', 15000],
];
function starFrom(seed, extra = {}) {
  const r = rng(seed ^ 0x5bd1e995);
  let u = r(), C = CLASSES[0];
  for (const c of CLASSES) { if (u < c[1]) { C = c; break; } u -= c[1]; }
  const t = r(), mass = C[2] + (C[3] - C[2]) * t, lum = Math.pow(mass, mass < 0.43 ? 2.3 : 4) * (0.8 + r() * 0.4);
  const life = 10 * mass / lum; // main-sequence lifetime, Gyr
  const age = Math.min(life * 0.9, 0.3 + r() * Math.min(12, life)); // Gyr
  return { cls: C[0], mass: +mass.toFixed(3), lum: +lum.toFixed(4), temp: Math.round(C[7] * (0.9 + t * 0.2)), col: C[6], age: +age.toFixed(2), life: +life.toFixed(2), ...extra };
}
export const SUN = Object.freeze({ cls: 'G', mass: 1, lum: 1, temp: 5772, col: '#fff1d6', age: 4.6, life: 10 });

// all stars in one sector. Galaxy (0,0) row sy = 0 keeps the original star-map seeds so old saves still match.
export function starsIn(g, sx, sy) {
  sx = BigInt(sx); sy = BigInt(sy);
  const G = galaxy(g[0], g[1]), out = [];
  const legacy = G.g[0] === 0n && G.g[1] === 0n && sy === 0n && sx > -1000000n && sx < 1000000n;
  if (G.g[0] === 0n && G.g[1] === 0n && sx === 0n && sy === 0n) out.push({ id: 'home', star: 'home', name: 'The Sun', home: true, x: 0.5, y: 0.62, seed: 0, ...SUN, planets: 8 });
  const R = legacy ? rng(hash(Number(sx), 77)) : rngOf('pos', g[0], g[1], sx, sy);
  const n = legacy ? 13 : Math.min(18, Math.floor(density(G, sx, sy) * 3 + R()));
  for (let i = 0; i < n; i++) {
    const seed = legacy ? hash(Number(sx), i, 991) % 1000000 : seed31(hash64('star', g[0], g[1], sx, sy, i));
    let x, y, ok = false;
    for (let k = 0; k < 30 && !ok; k++) { x = 0.1 + R() * 0.8; y = 0.2 + R() * 0.62; ok = out.every((s) => Math.hypot(s.x - x, (s.y - y) * 0.7) > 0.1); }
    const lr = rng(seed); lr(); lr(); const legacyWorlds = 1 + Math.floor(lr() * 3);
    const st = starFrom(seed, { metallicity: G.metallicity });
    out.push({ id: seed, star: i, seed, name: makeName(seed), x, y, ...st, planets: legacy ? legacyWorlds : 1 + Math.floor(rng(seed ^ 77)() * 7), legacy });
  }
  return out;
}
export function starAt(a) { return starsIn(a.g, a.s[0], a.s[1]).find((s) => s.star === a.star) || null; }

// ---------------------------------------------------------------- planets and moons
const HOME_PLANETS = [
  { name: 'Mercury', au: 0.39, mass: 0.055, radius: 0.38, kind: 'rocky', preset: { day: 4223,  P: 0 } }, { name: 'Venus', au: 0.72, mass: 0.815, radius: 0.95, kind: 'rocky', preset: { day: 2802,  P: 9200, comp: { N2: 0.035, CO2: 0.965, SO2: 0.00015, O2: 0, CH4: 0, H2O: 0 }, life: 'none' } },
  { name: 'Earth', au: 1, mass: 1, radius: 1, kind: 'ocean', world: 'earth', preset: { day: 24,  P: 101.3, comp: { N2: 0.78, O2: 0.209, Ar: 0.0093, CO2: 0.0004, CH4: 0, H2O: 0.004, SO2: 0 }, life: 'complex' } }, { name: 'Mars', au: 1.52, mass: 0.107, radius: 0.53, kind: 'rocky', preset: { day: 24.6,  P: 0.6, comp: { CO2: 0.95, N2: 0.028, Ar: 0.02, O2: 0.0017, CH4: 0, H2O: 0, SO2: 0 }, life: 'none' } },
  { name: 'Jupiter', au: 5.2, mass: 317.8, radius: 11.2, kind: 'gas' }, { name: 'Saturn', au: 9.5, mass: 95.2, radius: 9.45, kind: 'gas' },
  { name: 'Uranus', au: 19.2, mass: 14.5, radius: 4, kind: 'ice giant' }, { name: 'Neptune', au: 30.1, mass: 17.1, radius: 3.9, kind: 'ice giant' },
];
const HOME_MOONS = { 2: [{ name: 'The Moon', mass: 0.0123, radius: 0.27, world: 'moon', preset: { day: 708,  P: 0 } }], 4: [{ name: 'Europa', mass: 0.008, radius: 0.245, kind: 'icy', preset: { P: 0 } }, { name: 'Ganymede', mass: 0.025, radius: 0.41, kind: 'icy', preset: { P: 0 } }], 5: [{ name: 'Titan', mass: 0.0225, radius: 0.40, kind: 'icy', preset: { day: 383,  P: 146.7, comp: { N2: 0.95, CH4: 0.049, O2: 0, CO2: 0, H2O: 0, SO2: 0 }, life: 'none' } }] };
// planets of a star: Titius-Bode-like spacing from a seeded inner orbit; mass from a log-uniform draw;
// radius from a mass-radius relation (rocky R ~ M^0.27, gas giants flatten near 11 Earth radii)
export function planetsOf(star) {
  if (star.home) return HOME_PLANETS.map((p, i) => ({ ...p, index: i, seed: hash(0, i, 3) % 1000000, moons: (HOME_MOONS[i] || []).length }));
  const r = rng(star.seed ^ 0x2545f491), n = star.planets, out = [];
  let au = (0.2 + r() * 0.3) * Math.sqrt(star.lum);
  for (let i = 0; i < n; i++) {
    const frost = 2.7 * Math.sqrt(star.lum), beyond = au > frost;
    let mass = Math.exp(Math.log(0.05) + r() * Math.log(beyond ? 6000 : 200)); // 0.05 .. 300 / 10 Earth masses
    if (!beyond) mass = Math.min(mass, 12);
    const kind = mass > 50 ? 'gas' : mass > 10 ? 'ice giant' : beyond && r() < 0.5 ? 'icy' : r() < 0.25 ? 'ocean' : 'rocky';
    const radius = kind === 'gas' ? 9 + r() * 3 : kind === 'ice giant' ? 3.5 + r() : Math.pow(mass, 0.27) * (kind === 'icy' || kind === 'ocean' ? 1.15 : 1);
    // legacy worlds (the original star map) keep their seeds so journals and saves still line up
    const seed = star.legacy ? hash(star.seed, i, 3) % 1000000 : seed31(hash64('planet', star.seed, i));
    out.push({ index: i, name: makeName(seed), seed, au: +au.toFixed(3), mass: +mass.toFixed(3), radius: +radius.toFixed(3), kind, moons: kind === 'gas' ? 1 + Math.floor(r() * 4) : kind === 'ice giant' ? Math.floor(r() * 3) : r() < 0.4 ? 1 : 0 });
    au *= 1.4 + r() * 0.6;
  }
  // legacy stars had only landable worlds: make sure their first ones stay walkable
  if (star.legacy) for (const p of out) if (p.kind === 'gas' || p.kind === 'ice giant') { p.kind = 'rocky'; p.mass = Math.min(p.mass, 4); p.radius = +Math.pow(p.mass, 0.27).toFixed(3); }
  return out;
}
export function moonsOf(star, planet) {
  if (star.home && HOME_MOONS[planet.index]) return HOME_MOONS[planet.index].map((m, i) => ({ ...m, index: i, au: planet.au, seed: hash(0, planet.index, i, 7) % 1000000, kind: m.kind || 'moon', mass: m.mass }));
  const r = rng(planet.seed ^ 0x68e31da4), out = [];
  for (let i = 0; i < planet.moons; i++) {
    const mass = Math.min(planet.mass * 0.02, 0.003 + r() * r() * 0.05), seed = seed31(hash64('moon', planet.seed, i));
    out.push({ index: i, name: makeName(seed), seed, au: planet.au, mass: +mass.toFixed(4), radius: +Math.pow(mass, 0.3).toFixed(3), kind: 'moon' });
  }
  return out;
}
export const landable = (b) => b && b.kind !== 'gas' && b.kind !== 'ice giant';

// ---------------------------------------------------------------- distances
// light years between two systems, exact to the BigInt sector and then float inside it
export function lyBetween(a, b) {
  const ga = galaxyPos(a), gb = galaxyPos(b);
  const dx = Number(gb[0] - ga[0]) * SECTOR_LY, dy = Number(gb[1] - ga[1]) * SECTOR_LY;
  const sa = a.star === 'home' ? { x: 0.5, y: 0.62 } : starAt(a) || { x: 0.5, y: 0.5 }, sb = b.star === 'home' ? { x: 0.5, y: 0.62 } : starAt(b) || { x: 0.5, y: 0.5 };
  return Math.hypot(dx + (sb.x - sa.x) * SECTOR_LY, dy + (sb.y - sa.y) * SECTOR_LY);
}
// absolute sector position in the universe (BigInt): galaxy cell * GAL_CELL + local sector
export const galaxyPos = (a) => [a.g[0] * GAL_CELL + a.s[0], a.g[1] * GAL_CELL + a.s[1]];
export const intergalactic = (a, b) => a.g[0] !== b.g[0] || a.g[1] !== b.g[1];
