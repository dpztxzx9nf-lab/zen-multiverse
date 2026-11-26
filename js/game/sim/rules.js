// The laws a world runs on, turned into the numbers the sim needs. Reads core.worldRules (a
// per-world, seed-driven API from main: gravity, atmosphere, temperature, chemistry, biology, era)
// and falls back to Earth until that lands. Everything else in js/game/sim derives from this, so a
// thin cold CO2 world, a dense hot one or an airless moon behave differently from the same rules:
//   - fire needs oxygen (partial pressure, not just "has air"); it burns hotter and faster in more
//   - water boils where the pressure says (Clausius-Clapeyron); below the triple point there is no
//     liquid at all: spilt water flashes off, ice sublimates, rain never falls
//   - air carries heat away in proportion to its density (no convection in a vacuum)
//   - plants grow only where the biology profile allows them, within its temperature window, and
//     need CO2 to photosynthesise and liquid water to drink
//   - gravity sets how fast water runs, how hard things press into soft ground, how hard they hit
//   const R = worldRules(core, W)  ->  { g, pKPa, o2, co2, boilC, liquid, conv, evap, airC, ... }
//   R.allows('combustion')  R.summary
const EARTH = {
  gravity: 9.81, pressure: 101.325, composition: { N2: 0.78, O2: 0.209, Ar: 0.0093, CO2: 0.0004, H2O: 0.01 },
  temperature: { mean: 14, swing: 10 }, insolation: 1361, chemistry: null,
  biology: { plants: 1, animals: 1, microbes: 1, tMin: 0, tMax: 45 }, era: 'wild',
};
const P_O2_EARTH = EARTH.pressure * EARTH.composition.O2; // 21.2 kPa
const P_CO2_EARTH = EARTH.pressure * EARTH.composition.CO2; // 0.04 kPa
const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
const pick = (o, ...ks) => { for (const k of ks) if (o && o[k] != null) return o[k]; return undefined; };

// accept the likely shapes: a function (W) -> rules, an object with get(W)/forWorld(W), or a plain object
function readRaw(core, W) {
  const src = (core && core.worldRules) || (typeof window !== 'undefined' && window.__garden && window.__garden.worldRules) || null;
  try {
    if (typeof src === 'function') return src(W) || null;
    if (src && typeof src.get === 'function') return src.get(W) || null;
    if (src && typeof src.forWorld === 'function') return src.forWorld(W) || null;
    if (src && typeof src === 'object') return src;
  } catch (e) { /* fall back to Earth */ }
  return null;
}

export function worldRules(core, W) {
  const raw = readRaw(core, W);
  const r = raw || {};
  // gravity: m/s2, or a multiple of Earth's (values under 4 read as g)
  let g = num(pick(r, 'gravity', 'g'), EARTH.gravity); if (g && typeof g === 'object') g = num(g.ms2 ?? g.value, EARTH.gravity); if (g < 4 && g > 0 && !(r.gravityUnit === 'ms2')) g *= 9.81;
  const atm = pick(r, 'atmosphere', 'air') || {};
  // pressure: pressureKPa / kPa / pressurePa are absolute; plain pressure / atm / bar are in Earth atmospheres (1 = Earth)
  let p = pick(atm, 'pressureKPa', 'kPa'); if (p == null && atm.pressurePa != null) p = atm.pressurePa / 1000;
  if (p == null) { const pa = pick(atm, 'pressure', 'atm', 'bar'); p = pa == null ? (atm.none || atm.vacuum ? 0 : EARTH.pressure) : pa * 101.325; }
  p = Math.max(0, num(p, EARTH.pressure));
  const comp = pick(atm, 'composition', 'gases', 'mix') || (raw ? {} : EARTH.composition);
  const frac = (k) => { const v = comp[k] ?? comp[k.toLowerCase()]; return num(v, 0) > 1 ? num(v, 0) / 100 : num(v, 0); };
  const O2 = Object.keys(comp).length ? frac('O2') : EARTH.composition.O2, CO2 = Object.keys(comp).length ? frac('CO2') : EARTH.composition.CO2;
  const pO2 = p * O2, pCO2 = p * CO2;
  const temp = pick(r, 'temperature', 'climate') || {};
  const tMean = num(typeof temp === 'number' ? temp : pick(temp, 'mean', 'meanC', 'surfaceC'), EARTH.temperature.mean);
  const tSwing = num(pick(temp, 'swing', 'dayNight', 'range'), EARTH.temperature.swing);
  const chem = pick(r, 'chemistry', 'reactions');
  const allows = (name) => {
    if (name === 'combustion' && pO2 < 13) return false;              // below ~13 kPa O2 nothing flames (limiting oxygen)
    if (!chem) return true;
    if (Array.isArray(chem)) return chem.includes(name);
    if (Array.isArray(chem.available)) return chem.available.includes(name);
    if (typeof chem === 'object' && name in chem) return !!chem[name];
    return true;
  };
  const bioRaw = pick(r, 'biology', 'life') || (raw ? {} : EARTH.biology);
  const bio = typeof bioRaw === 'string'
    ? ({ none: { plants: 0, animals: 0, microbes: 0 }, microbial: { plants: 0, animals: 0, microbes: 1 }, plants: { plants: 1, animals: 0, microbes: 1 }, full: EARTH.biology, earth: EARTH.biology }[bioRaw] || EARTH.biology)
    : bioRaw;
  const plants = Math.max(0, Math.min(1.5, num(pick(bio, 'plants', 'flora', 'vegetation'), raw && Object.keys(bio).length ? 0 : 1)));
  const animals = Math.max(0, Math.min(1.5, num(pick(bio, 'animals', 'fauna'), raw && Object.keys(bio).length ? 0 : 1)));
  const microbes = Math.max(0, Math.min(1.5, num(pick(bio, 'microbes', 'decay', 'decomposers'), plants > 0 ? 1 : raw ? 0 : 1)));
  // water: triple point 0.611 kPa; boiling point from Clausius-Clapeyron (L = 40.66 kJ/mol)
  const liquid = p > 0.62;
  const boilC = liquid ? 1 / (1 / 373.15 - (8.314 * Math.log(p / 101.325)) / 40660) - 273.15 : 0;
  const rho = p / 101.325;                                             // air density relative to Earth (same molar mass-ish)
  return {
    raw: !!raw, g, pKPa: p,
    o2: pO2 / P_O2_EARTH,                                              // oxygen relative to Earth: fire rate and heat follow it
    co2: pCO2 / (pCO2 + 0.02) / (P_CO2_EARTH / (P_CO2_EARTH + 0.02)), // photosynthesis (saturating), Earth = 1
    pO2, pCO2, boilC, liquid,
    conv: Math.sqrt(rho),                                              // convective cooling and wind push scale with density
    evap: liquid ? Math.min(6, 1 / Math.max(0.15, rho)) : 50,          // thin air evaporates faster; none boils it off
    windK: Math.sqrt(rho), airC: tMean - EARTH.temperature.mean, swing: tSwing / EARTH.temperature.swing,
    sun: num(pick(r, 'insolation', 'solar', 'sunlight'), EARTH.insolation) / EARTH.insolation,
    rain: liquid ? Math.min(1.5, num(pick(atm, 'humidity', 'water', 'H2O'), raw ? frac('H2O') / 0.01 : 1)) : 0,
    plants, animals, microbes, lifeTMin: num(pick(bio, 'tMin', 'minC'), 0), lifeTMax: num(pick(bio, 'tMax', 'maxC'), 45),
    era: pick(r, 'era', 'tech') || EARTH.era,
    allows,
    get summary() { return `g ${(g / 9.81).toFixed(2)}x · ${p.toFixed(1)} kPa · O2 ${pO2.toFixed(1)} kPa${allows('combustion') ? '' : ' (too little to burn)'} · water ${liquid ? 'boils at ' + boilC.toFixed(0) + ' °C' : 'cannot stay liquid'} · plants ${plants ? 'yes' : 'no'}${raw ? '' : ' (Earth defaults)'}`; },
  };
}
export const EARTH_RULES = worldRules(null, null);
