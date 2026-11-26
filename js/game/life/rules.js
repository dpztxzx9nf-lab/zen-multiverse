// The physical facts a living world grows out of. The universe work publishes these as
// core.worldRules / W.rules (seed-driven gravity, atmosphere, temperature, chemistry, biology, era);
// until that lands everywhere, rulesOf() derives the same shape from the planet generator, so the
// life system only ever reads this one normalised object.
//   { g, pressure, o2, co2, tempC, swing, water, toxic, radiation, ageGyr, richness, biochem, era, magField }
// All units are real ones: g in m/s², pressure in atm, o2/co2 as partial pressure in atm, tempC in °C.
import { rng, hash } from '../names.js';

const num = (...v) => { for (const x of v) if (typeof x === 'number' && isFinite(x)) return x; return undefined; };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// core.worldRules may be a plain object, a function (W) -> rules, or { get(W) } / { forWorld(W) } (the sim
// worker reads it the same way). Its shape may be the universe worker's: pressure in kPa with a
// composition of gas fractions, temperature { mean, swing }, biology { plants, animals, microbes }.
function readSrc(core, W) {
  let src = (core && core.worldRules) || (typeof window !== 'undefined' && window.__garden && window.__garden.worldRules) || (W && (W.rules || W.worldRules)) || null;
  try {
    if (typeof src === 'function') src = src(W);
    else if (src && typeof src.get === 'function') src = src.get(W);
    else if (src && typeof src.forWorld === 'function') src = src.forWorld(W);
  } catch (e) { src = null; }
  if (!src || typeof src !== 'object') return null;
  // normalise the kPa + composition shape into atm partial pressures
  const comp = src.composition || (src.atmosphere && src.atmosphere.composition);
  if (comp && typeof src.pressure === 'number') {
    const atm = src.pressure / 101.325;
    return { ...src, pressure: atm, o2: atm * (comp.O2 || 0), co2: atm * (comp.CO2 || 0),
      tempC: src.temperature && typeof src.temperature === 'object' ? src.temperature.mean : src.tempC,
      swing: src.temperature && typeof src.temperature === 'object' ? src.temperature.swing : src.swing,
      biology: src.biology ? { ...src.biology, richness: src.biology.richness ?? (src.biology.animals != null ? src.biology.animals : undefined) } : undefined };
  }
  return src;
}

export function rulesOf(W, core) {
  const src = readSrc(core, W);
  const r = rng(hash(W ? W.seed : 1, 0x11fe));
  // fallback: a plausible world from the generator's own facts (gravity, sea, sky type)
  const g = num(src && src.gravity, src && src.g, W && W.gravity) ?? 9.81;
  const gk = g / 9.81;
  // thin worlds hold less air: atmosphere retention grows with gravity (escape velocity) and a magnetic field
  const mag = num(src && src.magField, src && src.magnetosphere) ?? r();
  const pressure = num(src && src.pressure, src && src.atm && src.atm.pressure, src && src.atmosphere && src.atmosphere.pressure)
    ?? clamp(Math.pow(gk, 2.2) * (0.25 + mag * 1.4) * (0.5 + r()), 0, 6);
  const dusty = W && W.sky && W.sky.zenith && W.sky.zenith.r > W.sky.zenith.b; // butterscotch skies: CO2-heavy
  const o2frac = num(src && src.o2Frac, src && src.atmosphere && src.atmosphere.o2) ?? (dusty ? r() * 0.08 : 0.08 + r() * 0.22);
  const o2 = num(src && src.o2, src && src.atm && src.atm.o2) ?? pressure * o2frac;
  const co2 = num(src && src.co2, src && src.atmosphere && src.atmosphere.co2) ?? pressure * (dusty ? 0.6 + r() * 0.35 : r() * 0.02);
  const tempC = num(src && src.tempC, src && src.temperature, src && src.temp) ?? (-30 + r() * 70 + co2 * 25);
  const swing = num(src && src.swing, src && src.dayNightSwing) ?? clamp(40 / (0.3 + pressure), 4, 140);
  const water = num(src && src.water, src && src.hydrosphere) ?? (W && W.hasSea ? 0.4 + r() * 0.6 : r() * 0.3);
  const toxic = num(src && src.toxic, src && src.chemistry && src.chemistry.toxic) ?? (r() < 0.2 ? r() * 0.8 : r() * 0.1);
  const radiation = num(src && src.radiation) ?? clamp((1 - mag) * (1 - Math.min(1, pressure)) * 1.2, 0, 1);
  const ageGyr = num(src && src.ageGyr, src && src.age) ?? (0.8 + r() * 8);
  const bio = (src && (src.biology || src.bio)) || {};
  // liquid water, a usable temperature band, shielding and time make life likely; otherwise it is rare
  const liquid = tempC > -15 && tempC < 85 && pressure > 0.05;
  const richness = num(bio.richness, src && src.lifeRichness) ??
    clamp((liquid ? 1 : 0.05) * water * (1 - radiation * 0.8) * (1 - toxic * 0.6) * clamp(ageGyr / 3, 0, 1.2) * (0.5 + r() * 0.7), 0, 1);
  const biochem = bio.biochem || bio.chemistry || (tempC < -60 ? 'ammonia' : toxic > 0.5 ? 'sulfur' : 'carbon-water');
  const era = (src && src.era) || 'present';
  return { g, pressure, o2, co2, tempC, swing, water, toxic, radiation, ageGyr, richness, biochem, era, magField: mag, from: src ? 'worldRules' : 'fallback' };
}

// can a body like ours breathe and stay warm here without gear? (used by NPC needs and the history)
export function breathable(R) { return R.o2 > 0.12 && R.o2 < 0.6 && R.co2 < 0.05 && R.toxic < 0.4; }
export function describeRules(R) {
  const air = R.pressure < 0.02 ? 'no air to speak of' : breathable(R) ? 'breathable air' : R.o2 < 0.12 ? 'thin, oxygen-poor air' : 'air that burns the lungs';
  return `${(R.g / 9.81).toFixed(2)} g, ${R.pressure.toFixed(2)} atm of ${air}, ${Math.round(R.tempC)} °C`;
}
