// WorldRules: the laws of one world at one time, derived from its seed and its place in the universe.
// Everything is a pure function of (body, star, era, dimension), so the same world is always the same,
// and the numbers hang together the way real ones do:
//   mass + radius -> surface gravity and escape velocity -> whether air is kept at all
//   star luminosity + orbit (+ the star's age at that era) -> temperature, with a greenhouse from the air
//   temperature + pressure -> liquid water or not -> life or not -> oxygen in the air or not -> breathable
//   chemistry follows from what's in the ground and the air (no oxygen, no fire; no water, no rust)
// Every system reads the same object: physics (gravity), survival (breathable, temperature, radiation),
// creatures and flora (biology), weather (wind, precipitation), crafting (chemistry), time travel (era).
// See /workspace/mom-garden-notes/universe.md for the API and how other systems should hook in.
import { rng } from '../game/names.js';

export const G0 = 9.81;
export const ERAS = {
  primordial: { name: 'Primordial', dt: -1, hint: 'a young, violent world' },   // dt is resolved per star (see eraOffset)
  present: { name: 'Present', dt: 0, hint: 'the world as it is' },
  future: { name: 'Far future', dt: 1, hint: 'a brighter, older sun' },
};
export const ERA_ORDER = ['primordial', 'present', 'future'];
// how far an era sits from now, in billions of years, for this star
export function eraOffset(era, star) {
  if (era === 'primordial') return -Math.max(0.2, star.age - 0.25);  // ~250 million years after formation
  if (era === 'future') return Math.max(0.3, Math.min(2.5, (star.life - star.age) * 0.7));
  return 0;
}
// stars brighten as they age (the young Sun was ~30% fainter): L(t) = L_now / (1 + 0.4 (1 - t / t_now))
const lumAt = (star, tAge) => star.lum / (1 + 0.4 * (1 - tAge / Math.max(0.3, star.age)));

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const K = (c) => c + 273.15;

export function makeWorldRules({ seed, body = null, star = null, era = 'present', dim = null } = {}) {
  const r = rng((seed >>> 0) ^ 0x7f4a7c15);
  // ---- the body: real units (Earth masses / radii), invented from the seed when we only have a seed
  const b = body || { mass: Math.exp(Math.log(0.08) + r() * Math.log(60)), kind: 'rocky', au: 0.7 + r() * 1.2 };
  b.mass = Math.min(b.mass, 20);
  const mass = b.mass, radius = b.radius || Math.pow(mass, 0.27);
  const s = star || { cls: 'G', mass: 1, lum: 1, temp: 5772, age: 4.6, life: 10, col: '#fff1d6' };
  const dimG = dim && dim.gravity ? dim.gravity : 1;
  const gravity = G0 * mass / (radius * radius) * dimG;          // m/s^2
  const vEsc = 11.19 * Math.sqrt(mass / radius);                  // km/s
  // ---- time
  const dtGyr = eraOffset(era, s), tAge = Math.max(0.05, s.age + dtGyr);
  const lum = lumAt(s, tAge);
  const au = b.au || 1;
  const yearDays = 365.25 * Math.sqrt(au * au * au / s.mass);
  const locked = au < 0.12 * Math.sqrt(s.mass) || (s.cls === 'M' && au < 0.3);
  const dayHours = b.preset && b.preset.day ? b.preset.day * (era === 'primordial' ? 0.25 : era === 'future' ? 1.2 : 1) : locked ? yearDays * 24 : Math.exp(Math.log(9) + r() * Math.log(7)) * (era === 'primordial' ? 0.4 : era === 'future' ? 1.3 : 1); // tides slow every world's spin
  // ---- temperature without air (equilibrium), then air, then greenhouse
  const albedo0 = b.kind === 'icy' ? 0.55 : 0.3;
  const Teq = 278.6 * Math.pow(lum, 0.25) / Math.sqrt(au) * Math.pow(1 - albedo0, 0.25);  // Earth: 255 K before greenhouse
  const vTh = 0.5 * Math.sqrt(Teq / 300);                         // N2 thermal speed, km/s
  const keepsAir = vEsc > 6 * vTh * 1.0 && (b.kind !== 'moon' || r() < 0.12);
  const water0 = clamp((b.kind === 'ocean' ? 1 : b.kind === 'icy' ? 0.9 : r() * 0.9) + (dim && dim.waterK ? dim.waterK : 0), 0, 1);   // water inventory, 0..1
  let P = 0;                                                     // surface pressure, kPa
  const preset = b.preset || null;            // real bodies (Earth, Mars, Venus, Titan...) start from measured values
  if (preset) P = preset.P * (era === 'primordial' ? 1.5 : era === 'future' ? 0.7 : 1);
  else if (keepsAir) P = 101.3 * Math.pow(mass, 1.4) * Math.exp((r() - 0.5) * 3.2) * (era === 'primordial' ? 1.5 : era === 'future' ? 0.7 : 1);
  if (dim && dim.airK) P *= dim.airK;
  P = Math.min(P, 12000);
  // composition: young worlds breathe out CO2, N2 and water from volcanoes; life later turns CO2 into O2
  const comp = { N2: 0, O2: 0, CO2: 0, CH4: 0, Ar: 0.01, H2O: 0, SO2: 0 };
  // greenhouse: dT = 35 K * log2(1 + p_atm * (1 + 40*CO2 + 40*CH4))  (tuned: Earth +35, Venus ~+410, Mars ~+11)
  const greenhouse = (p, co2, ch4) => (p > 0 ? 35 * Math.log2(1 + (p / 101.3) * (1 + 40 * co2 + 40 * ch4)) : 0);
  let T = Teq, liquid = false, life = 'none', o2 = 0;
  if (P > 0) {
    const cold = Teq < 200;
    if (preset && preset.comp) {
      Object.assign(comp, preset.comp);
      if (era === 'primordial') { comp.O2 = 0; comp.CO2 = Math.max(comp.CO2, 0.15); comp.CH4 = Math.max(comp.CH4, 0.02); }
    } else {
      comp.CO2 = cold ? 0.02 : (era === 'primordial' ? 0.15 : 0.002 + r() * r() * 0.5);
      comp.CH4 = cold ? 0.05 + r() * 0.1 : era === 'primordial' ? 0.05 : 0;
      comp.SO2 = Teq > 330 && r() < 0.5 ? 0.002 : 0;
    }
    // first pass: is there liquid water to host life?
    T = Teq + greenhouse(P, comp.CO2, comp.CH4);
    const boil = 1 / (1 / 373.15 - (8.314 * Math.log(Math.max(0.6, P) / 101.3)) / 40700);
    liquid = water0 > 0.15 && P > 0.61 && T > 273.15 && T < boil;
    // life: needs liquid water and time. It goes microbial -> plants (oxygen) -> animals
    const lifeAge = tAge - 0.6;
    if (liquid && lifeAge > 0 && T > 255 && T < 345 && (dim ? dim.life !== false : true)) {
      life = lifeAge < 1.4 ? 'microbial' : lifeAge < 2.4 ? 'plants' : 'complex';
      // the great oxidation: photosynthesis slowly fills the air with oxygen and pulls CO2 down
      o2 = clamp((lifeAge - 1.2) / 1.5, 0, 1) * (0.14 + r() * 0.16);
      if (!(preset && preset.comp)) { comp.CO2 *= 1 - clamp((lifeAge - 1) / 1.5, 0, 0.995); comp.CH4 *= o2 > 0.05 ? 0.01 : 1; }
    }
    if (preset && preset.comp) { if (era === 'present') life = preset.life || life; else if (era === 'future') comp.O2 *= 0.65; }
    else comp.O2 = o2;
    comp.H2O = liquid ? 0.01 : 0;
    if (!(preset && preset.comp)) comp.N2 = Math.max(0, 1 - comp.O2 - comp.CO2 - comp.CH4 - comp.Ar - comp.H2O - comp.SO2);
    T = Teq + greenhouse(P, comp.CO2, comp.CH4);
    liquid = water0 > 0.15 && P > 0.61 && T > 273.15 && T < boil;
    if (!liquid && life !== 'none') life = T > 273.15 && T < 360 ? life : 'microbial'; // a warming world sterilises its surface
  }
  // a brightening star boils oceans away: the far future of a warm world is dry and hot
  if (era === 'future' && T > 330) { liquid = false; if (life !== 'none') life = 'microbial'; }
  const meanC = T - 273.15;
  // day/night swing: thin air and slow spin make it brutal (the Moon swings ~300 K)
  const swing = (8 + 200 * Math.exp(-P / 0.8) + 40 * Math.exp(-P / 25)) * (0.35 + 0.65 * Math.sqrt(Math.min(dayHours, 24) / 24)) + (dayHours > 48 && P < 1 ? 40 : 0); // Earth ~8 K, Mars ~140 K, the Moon ~290 K
  const pO2 = P * comp.O2, pCO2 = P * comp.CO2;
  const reasons = [];
  if (P < 50) reasons.push(P < 1 ? 'no air' : 'air too thin');
  if (P > 400) reasons.push('air too dense');
  if (pO2 < 16) reasons.push(pO2 < 6 ? 'no oxygen' : 'too little oxygen');
  if (pO2 > 50) reasons.push('oxygen toxic');
  if (pCO2 > 3) reasons.push('CO2 poisoning');
  if (comp.SO2 > 0) reasons.push('sulfur dioxide');
  if (comp.CH4 > 0.05) reasons.push('methane');
  const breathable = reasons.length === 0;
  const hypoxic = !breathable && reasons.length === 1 && reasons[0] === 'too little oxygen' && pO2 >= 10;
  // radiation: a weak field (small or slow-spinning world) and thin air let the star's particles through
  const field = clamp(mass * (24 / Math.max(8, Math.min(dayHours, 2400))), 0, 3);
  const starUV = { M: 1.6, K: 0.8, G: 1, F: 1.6, A: 3, B: 6 }[s.cls] || 1;
  const radiation = clamp(starUV * lum / (au * au) * Math.exp(-P / 30) * (1.2 - Math.min(1, field)), 0, 10); // 1 = the bare Moon
  // ---- chemistry: what the ground holds and which reactions work here
  const rc = rng((seed >>> 0) ^ 0x1337);
  const metal = s.metallicity == null ? 1 : s.metallicity;
  const elements = ['O', 'Si', 'Fe', 'Mg', 'Al', 'Ca', 'Na', 'C', 'S'];
  for (const [el, p] of [['Cu', 0.5], ['Ni', 0.5], ['Ti', 0.4], ['Sn', 0.3], ['Au', 0.15], ['Pt', 0.1], ['U', 0.12], ['Li', 0.35], ['P', 0.6]]) if (rc() < p * metal) elements.push(el);
  if (water0 > 0.15) elements.push('H');
  if (P > 0 && comp.N2 > 0.1) elements.push('N');
  const ice = water0 > 0.15 && (T < 273.15 || T - swing / 2 < 273.15);
  const reactions = {
    combustion: pO2 >= 15,                 // fire needs oxygen (~15 kPa partial pressure)
    smelting: pO2 >= 15 || false,          // a furnace burns fuel in air; otherwise needs a sealed, powered furnace
    rusting: pO2 > 2 && (liquid || comp.H2O > 0),
    electrolysis: water0 > 0.15,           // water (or ice) + power -> hydrogen + oxygen (rocket fuel, breathing air)
    photosynthesis: life === 'plants' || life === 'complex',
    fermentation: life !== 'none',
    evaporites: liquid && T > 285,         // salt pans dry out of warm seas
    cryoliquids: T < 112 && P > 10,        // methane / ethane seas, like Titan
    sublimation: P < 1 && ice,             // ice turns straight to vapour in near-vacuum sunlight
    acidRain: comp.SO2 > 0 && liquid,
  };
  // ---- biology profile: what life is like, if any
  const bio = { life, complexity: { none: 0, microbial: 1, plants: 2, complex: 3 }[life],
    // the sim's reader wants these: 0..1 presence and the temperature window life here tolerates
    microbes: life === 'none' ? 0 : 1, plants: life === 'plants' || life === 'complex' ? 1 : 0, animals: life === 'complex' ? 1 : 0,
    tMin: Math.round(Math.min(0, meanC - 25)), tMax: Math.round(Math.max(45, meanC + 25)) };
  if (life !== 'none') {
    const pigment = { M: 'near-black', K: 'red-purple', G: 'green', F: 'blue-green', A: 'blue', B: 'violet' }[s.cls] || 'green';
    bio.pigment = pigment;
    bio.sizeK = clamp(Math.pow(G0 / gravity, 0.5), 0.5, 2.2);            // light worlds grow tall and big
    bio.legsK = gravity > 13 ? 'many short legs' : gravity < 6 ? 'long thin legs' : 'four legs';
    bio.flyers = P > 60 && gravity < 12;                                   // dense air and light gravity favour flight
    bio.breathes = comp.O2 > 0.05 ? 'O2' : comp.CO2 > 0.05 ? 'CO2' : 'CH4';
    bio.predators = life === 'complex' && r() < 0.65;
    bio.nocturnal = dayHours > 40 || swing > 60;
    bio.coldAdapted = meanC < 0;
  }
  // ---- era / tech: who lived here and when (ruins of the future, fossils of the past)
  const rt = rng((seed >>> 0) ^ 0xbeef);
  const civ = life === 'complex' ? (rt() < 0.3 ? 'natives' : rt() < 0.5 ? 'ruins' : 'none') : 'none';
  const tech = era === 'primordial' ? { level: 0, label: 'before any life' }
    : era === 'future' ? { level: civ !== 'none' || rt() < 0.3 ? 4 : 0, label: civ !== 'none' ? 'ruins of whoever came after' : 'empty' }
    : civ === 'natives' ? { level: 1 + Math.floor(rt() * 3), label: 'living natives' } : civ === 'ruins' ? { level: 2, label: 'ancient ruins' } : { level: 0, label: 'untouched' };
  // ---- weather hooks
  const weather = {
    wind: clamp(Math.sqrt(P / 101.3) * (0.4 + swing / 60) * (0.6 + r() * 0.8), 0, 4),   // 1 = an ordinary breezy Earth day
    precipitation: P < 1 ? 'none' : reactions.cryoliquids ? 'methane rain' : reactions.acidRain ? 'acid rain' : liquid ? (meanC < 2 ? 'snow' : 'rain') : P < 20 && !liquid ? 'dust storms' : 'none',
    clouds: clamp(comp.H2O * 60 + (comp.SO2 ? 1 : 0) + (P > 1000 ? 1 : 0), 0, 1),
  };
  // ---- survival: what standing here unprotected does (seconds until each bar empties; Infinity = harmless)
  const coldC = meanC - swing / 2, hotC = meanC + swing / 2;
  const tempHarm = (c) => (c < -30 ? 40 + 600 / (1 + (-30 - c) / 10) : c > 50 ? 30 + 500 / (1 + (c - 50) / 10) : Infinity);
  const survival = {
    vacuum: P < 6.3, breathable, hypoxic, reasons,
    o2Empty: breathable ? Infinity : P < 6.3 ? 52 : hypoxic ? 240 : 75,      // seconds of breath (vacuum ~ a held breath)
    coldEmpty: tempHarm(meanC),
    heatEmpty: meanC > 50 ? tempHarm(meanC) : Infinity,
    radFull: radiation > 0.2 ? 140 / radiation : Infinity,
    crush: P > 2000,                                                       // Venus-like: no suit of cloth survives this
    hazard: breathable && meanC > -30 && meanC < 50 && radiation <= 0.2 ? null : 'vacuum', // survive.js treats any non-null hazard as hostile
  };
  // air drag and cold on the body: thick air is like wading; bitter cold stiffens you without warm gear
  const move = {
    speedK: clamp(1 / (1 + 0.12 * Math.log(Math.max(1, P / 101.3))), 0.55, 1) * (meanC < -30 ? 0.85 : 1) * (meanC > 50 ? 0.9 : 1),
    airDensity: P > 0 ? (P * 1000 * 0.029) / (8.314 * T) : 0,              // kg/m^3 (ideal gas, ~N2/O2 mix)
  };
  const rules = {
    v: 1, seed, era, dimLaws: dim || null, eraName: (ERAS[era] || ERAS.present).name, ageGyr: +tAge.toFixed(2), dtGyr: +dtGyr.toFixed(2), dim: dim ? dim.name : 'Prime',
    body: { kind: b.kind, mass: +mass.toFixed(3), radius: +radius.toFixed(3), au: +au.toFixed(3), name: b.name || null },
    star: { cls: s.cls, lum: +lum.toFixed(3), temp: s.temp, col: s.col },
    gravity: +gravity.toFixed(3), g: +(gravity / G0).toFixed(3), escapeKmS: +vEsc.toFixed(2),
    // game-scale sphere radius in metres: 1 game metre per real km (Earth ~6.4 km round: walkable, never edged)
    sphereR: Math.round(clamp(radius * 6400, 1800, 16000)),
    // field names follow the sim's reader (js/game/sim/rules.js): pressureKPa is absolute, plain pressure is in Earth atmospheres
    atmosphere: (() => { const c = Object.fromEntries(Object.entries(comp).map(([k, v]) => [k, +v.toFixed(4)])); return { pressureKPa: +P.toFixed(2), pressure: +(P / 101.325).toFixed(4), vacuum: P < 0.05, comp: c, composition: c, humidity: liquid ? +Math.min(1.5, 0.3 + water0).toFixed(2) : 0, pO2: +pO2.toFixed(2), breathable, hypoxic, reasons }; })(),
    temperature: { meanC: +meanC.toFixed(1), mean: +meanC.toFixed(1), minC: +coldC.toFixed(1), maxC: +hotC.toFixed(1), swingC: +swing.toFixed(1), swing: +swing.toFixed(1) },
    insolation: Math.round(1361 * lum / (au * au)),   // W/m^2 at the top of the air (Earth 1361)
    day: { hours: +dayHours.toFixed(2), yearDays: +yearDays.toFixed(1), locked },
    water: { inventory: +water0.toFixed(2), liquid, ice, seaLevel: liquid ? +(-8 + water0 * 12.5).toFixed(2) : null }, // no sea where water cannot stay liquid
    radiation: +radiation.toFixed(2),
    chemistry: { elements, reactions, available: Object.keys(reactions).filter((k) => reactions[k]), ...reactions },
    biology: bio,
    tech, weather, survival, move,
  };
  // temperature right now: latitude-free model of the day cycle plus a lapse rate with height
  rules.tempAt = (dayFrac = 0.5, heightM = 0) => {
    const sun = Math.sin((dayFrac - 0.25) * Math.PI * 2);   // 1 at noon, -1 at midnight
    return meanC + sun * swing / 2 - (P > 1 ? 6.5 : 0) * heightM / 1000;
  };
  rules.can = (reaction) => !!reactions[reaction];
  rules.summary = () => summarize(rules);
  return rules;
}

export function summarize(R) {
  const a = R.atmosphere, t = R.temperature;
  const air = a.pressureKPa < 0.05 ? 'no air' : `${a.pressureKPa < 10 ? a.pressureKPa.toFixed(1) : Math.round(a.pressureKPa)} kPa ${dominantGas(a.comp)}${a.breathable ? ', breathable' : a.hypoxic ? ', thin (hypoxic)' : ', not breathable'}`;
  const life = R.biology.life === 'none' ? 'lifeless' : R.biology.life === 'complex' ? 'animals and plants' : R.biology.life === 'plants' ? 'plants, no animals' : 'microbes only';
  return `${R.g.toFixed(2)} g · ${air} · ${Math.round(t.minC)} to ${Math.round(t.maxC)} °C · ${R.day.locked ? 'tidally locked' : `${R.day.hours.toFixed(0)} h day`} · ${life}`;
}
export function dominantGas(c) { let k = 'N2', v = -1; for (const [g, f] of Object.entries(c)) if (f > v) { v = f; k = g; } return ({ N2: 'nitrogen', O2: 'oxygen', CO2: 'CO2', CH4: 'methane', Ar: 'argon', H2O: 'steam', SO2: 'sulfur' })[k]; }
