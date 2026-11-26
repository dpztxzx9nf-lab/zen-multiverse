// A star system laid out in real space, at the game's scale: 1 game metre = 1 real kilometre, time is
// not scaled. Planets are balls of their real radius (sphereR), 1 AU is 1.496e8 game metres, the Moon
// is 384,400 m from Earth. Positions are float64 metres in the system's inertial frame, the star at the
// origin, planets in the ecliptic (y = 0) at a seeded angle (static: no orbital motion yet).
// Galaxy-plane directions map onto the system frame: galaxy x -> system +X, galaxy y -> system +Z, so a
// ship leaving toward a star on the star map leaves this system on that side.
// Gravity: GM = g R^2 for every body (real surface gravity at the real radius in km), star GM from its
// mass (GM_sun = 1.327e20 m^3/s^2 real = 1.327e11 km^3/s^2 -> 1.327e14 in game units, since game
// lengths are km and time is seconds: a game metre cubed per second squared is 1e9 real m^3/s^2... see
// below). Spheres of influence (patched conics): r_soi = a (m / M)^0.4.
import { planetsOf, moonsOf, landable, starAt, addrKey, HOME } from './universe.js';
import { makeWorldRules } from './rules.js';
import { hash } from '../game/names.js';

export const AU = 1.496e8;                 // game metres (= km)
export const LY = 9.4607e12;               // game metres in a light year
export const C_LIGHT = 299792.458;          // game m/s (real km/s)
const EARTH_KG = 5.972e24, SUN_EARTHS = 332946;
// GM in game units (km^3/s^2): Earth 3.986e5, Sun 1.327e11. A body's game gravity g (m/s^2 real) at its
// game radius R (km-sized metres) would give g R^2 = 3.98e8 for Earth: game accelerations are real m/s^2
// over km-sized distances, so orbits are sqrt(1000) slower than real ones (250 m/s round Earth instead of
// 7.9 km/s) and every delta-v is scaled the same way (DV_SCALE in ship.js). The star uses the same rule.
export const DV_SCALE = Math.sqrt(1000);

const cache = new Map();
// all bodies of a system, with rules made on demand
export function systemOf(sys) {
  const key = addrKey(sys);
  if (cache.has(key)) return cache.get(key);
  const star = sys.star === 'home' ? { ...starAt(HOME), home: true } : starAt(sys);
  if (!star) return null;
  const Rstar = 696000 * Math.pow(star.mass || 1, 0.8);             // game metres (km)
  const gStar = 274 * (star.mass || 1) / Math.pow(Rstar / 696000, 2);  // surface gravity, m/s^2
  const S = { key, sys: { g: sys.g, s: sys.s, star: sys.star }, star, bodies: [], R: Rstar, GM: gStar * Rstar * Rstar, edge: AU * 40 * Math.min(2, Math.max(0.6, Math.sqrt(star.lum || 1))) };
  const Mstar = (star.mass || 1) * SUN_EARTHS;
  planetsOf(star).forEach((p, pi) => {
    const th = (hash(star.seed || 0, pi, 811) % 10000) / 10000 * Math.PI * 2;
    const a = p.au * AU;
    const pos = [Math.cos(th) * a, 0, Math.sin(th) * a];
    const b = mkBody(S, { ...p }, { pi, mi: -1, pos, parent: null, soi: a * Math.pow(p.mass / Mstar, 0.4) });
    S.bodies.push(b);
    moonsOf(star, p).forEach((m, mi) => {
      const pr = b.R;
      // moon distance: the Moon is 60 Earth radii out; others 20..80 planet radii, seeded
      const k = star.home && p.index === 2 ? 384400 / 6371 : 20 + (hash(m.seed, 3) % 60);
      const dist = k * (p.radius * 6371);
      const t2 = (hash(m.seed, 5) % 10000) / 10000 * Math.PI * 2;
      const mpos = [pos[0] + Math.cos(t2) * dist, Math.sin(t2 * 3) * dist * 0.05, pos[2] + Math.sin(t2) * dist];
      S.bodies.push(mkBody(S, { ...m }, { pi, mi, pos: mpos, parent: b, soi: dist * Math.pow(m.mass / p.mass, 0.4) }));
      void pr;
    });
  });
  cache.set(key, S);
  if (cache.size > 6) cache.delete(cache.keys().next().value);
  return S;
}
function mkBody(S, body, { pi, mi, pos, parent, soi }) {
  const R = Math.round(Math.min(16000, Math.max(1800, body.radius * 6400))) * (landable(body) ? 1 : 1);
  const giant = !landable(body);
  const Rg = giant ? Math.round(body.radius * 6371) : R; // giants keep their true size (scenery: no surface)
  const addr = addrKey({ ...S.sys, planet: pi, moon: mi >= 0 ? mi : undefined });
  const b = {
    id: addr, addr, pi, mi, body, name: body.name, kind: body.kind, landable: !giant, giant,
    pos, R: Rg, parent, soi: Math.max(soi, Rg * 3),
    rules: null, GM: 0, atmTop: 0, H: 1, rho0: 0,
    // the legacy travel arg (seed / star / index) the planet world and saves understand
    arg: { seed: body.seed, star: S.star.home ? 0 : S.star.seed, index: mi >= 0 ? (pi + 1) * 100 + mi : pi, addr },
  };
  if (S.star.home && body.world) b.home = body.world;
  b.ensureRules = () => {
    if (!b.rules) {
      b.rules = makeWorldRules({ seed: body.seed, body: { ...body }, star: S.star, era: 'present' });
      const g = b.rules.gravity;
      b.GM = g * b.R * b.R;
      b.rho0 = b.rules.move.airDensity || 0;
      // the atmosphere is drawn and flown at a game thickness: top ~8% of the radius, scale height ~1.2%
      // (real air is thinner than that relative to the planet; at this scale it would be metres thick)
      b.atmTop = b.rho0 > 0.001 ? b.R * 0.08 : 0; b.H = b.R * 0.012;
    }
    return b.rules;
  };
  if (giant) { b.ensureRules(); b.GM = 9.81 * Math.pow(body.mass, 1) / Math.pow(body.radius, 2) * Rg * Rg; b.rho0 = 1.2; b.atmTop = Rg * 0.02; b.H = Rg * 0.004; }
  return b;
}
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
// which body's sphere of influence holds this point (moons before planets), or null (the star's)
export function soiAt(S, p) {
  let best = null;
  for (const b of S.bodies) {
    const d = len(sub(p, b.pos));
    if (d < b.soi && (!best || b.soi < best.soi)) best = b;
  }
  return best;
}
// the nearest surface (body or star) and its distance; drives the cruise speed limit
export function nearestSurface(S, p) {
  let best = { b: null, d: len(p) - S.R };
  for (const b of S.bodies) { const d = len(sub(p, b.pos)) - b.R - (b.atmTop || 0); if (d < best.d) best = { b, d }; }
  return best;
}
export function bodyByAddr(S, addr) { return S.bodies.find((b) => b.addr === addr) || null; }
