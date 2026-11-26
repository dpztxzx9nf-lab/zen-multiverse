// Getting somewhere costs something. Ship range and fuel come from what you have built and flown:
//   - the active ship (fleet.js) sets the drive's jump range (light years per jump) and tank size
//   - the rocket you built on Earth adds its tanks once all five parts are on
//   - leaving a world costs fuel by its gravity and air (real delta-v: heavier, thicker worlds cost more)
//   - each jump costs fuel by distance; another galaxy needs a void drive
//   - time travel needs a Chronometer (crafted) and a lot of energy
// Propellant ('propellant' items; 'fuel' in craft costs is burnable wood for fires and jet boots) is made by electrolysing ice into hydrogen and oxygen at a workbench, or from
// methane seas where they exist. It is loaded into the tank when you board.
import { game, ITEMS } from '../game/store.js';
import { RECIPES } from '../game/g7/craft.js';
import { activeShip, fleetData } from '../game/fleet.js';
import { parseAddr, starAt, planetsOf, moonsOf, legacyStar, lyBetween, intergalactic, HOME } from './universe.js';

// items and recipes this module adds (kept here so craft.js / store.js stay untouched)
Object.assign(ITEMS, {
  propellant: { name: 'Propellant', icon: 'crystal', color: '#9fe3ff', group: 'Ship' },
  'device:chrono': { name: 'Chronometer', icon: 'star', color: '#ffd38a', group: 'Ship' },
  'device:void': { name: 'Void drive', icon: 'star', color: '#c9a8ff', group: 'Ship' },
});
const ADD = [
  { id: 'fuel-ice', name: 'Propellant (electrolysis)', desc: 'Split ice into hydrogen and oxygen with a crystal cell: 2 ice, 1 crystal -> 3 propellant', cost: { 'mat:ice': 2, 'mat:crystal': 1 }, give: { item: ['propellant', 3] }, station: true, needs: { react: 'electrolysis' } },
  { id: 'fuel-moonice', name: 'Propellant (moon ice)', desc: 'Moon ice electrolysed at the bench: 2 moon ice, 1 crystal -> 3 propellant', cost: { ice: 2, 'mat:crystal': 1 }, give: { item: ['propellant', 3] }, station: true },
  { id: 'fuel-methane', name: 'Propellant (methane)', desc: 'Liquid methane from a cryo sea, with oxygen split from ice', cost: { 'mat:ice': 1, 'mat:crystal': 1 }, give: { item: ['propellant', 5] }, station: true, needs: { react: 'cryoliquids' } },
  { id: 'chrono', name: 'Chronometer', desc: 'Folds a world\'s own past and future into reach: travel to its primordial or far-future era (each shift burns 6 propellant)', cost: { 'mat:crystal': 6, 'mat:metal': 4, 'mat:ore': 2 }, give: { item: ['device:chrono', 1] }, station: true, unique: true, needs: { worlds: 3, tool: ['pick', 2] } },
  { id: 'void', name: 'Void drive', desc: 'A drive that survives the gulf between galaxies (a jump to another galaxy burns 40 propellant)', cost: { 'mat:crystal': 12, 'mat:metal': 10, 'mat:ore': 6 }, give: { item: ['device:void', 1] }, station: true, unique: true, needs: { worlds: 8, tool: ['pick', 2] } },
];
for (const r of ADD) if (!RECIPES.some((x) => x.id === r.id)) RECIPES.push(r);

const DRIVE = { skiff: { ly: 12, tank: 8 }, lantern: { ly: 35, tank: 14 }, heron: { ly: 90, tank: 22 }, ark: { ly: 250, tank: 40 } };
export function shipStats() {
  const S = activeShip(), d = DRIVE[S.id] || DRIVE.skiff;
  const rocketDone = ((game.data.rocket && game.data.rocket.parts) || []).length >= 5;
  return { id: S.id, name: S.name, jumpLy: d.ly, tank: d.tank + (rocketDone ? 2 : 0), dims: S.dims, void: game.count('device:void') > 0, chrono: game.count('device:chrono') > 0 };
}
export function fuelState() {
  const F = fleetData();
  if (F.fuel == null) F.fuel = shipStats().tank; // existing saves start with a full tank
  return F;
}
// load propellant from the bag into the tank (when boarding)
export function refuel() {
  const F = fuelState(), cap = shipStats().tank, have = game.count('propellant'), n = Math.min(have, Math.max(0, cap - F.fuel));
  if (n > 0) { game.pay({ propellant: n }); F.fuel += n; game.save(); }
  return n;
}
// leaving a surface: delta-v to orbit grows with sqrt(g R) and air drag; 1 unit ~ Earth-like
export function launchCost(rules) {
  if (!rules) return 1;
  const dv = Math.sqrt(rules.gravity * rules.body.radius * 6.371e6) / 7900; // fraction of Earth's orbital speed
  return Math.max(1, Math.round(dv * 2 + Math.min(3, rules.atmosphere.pressureKPa / 300)));
}
export function jumpCost(ly, { era = false, galaxy = false } = {}) {
  if (galaxy) return 40;
  return Math.max(1, Math.ceil(ly / 10)) + (era ? 6 : 0);
}
// can this trip be made right now? returns { ok, cost, why }
export function tripCheck(from, to, { rules = null, eraShift = false } = {}) {
  const st = shipStats(), F = fuelState();
  const gal = from && to && intergalactic(from, to);
  if (gal && !st.void) return { ok: false, why: 'Another galaxy: only a void drive survives the crossing.' };
  if (eraShift && !st.chrono) return { ok: false, why: 'Moving through time needs a Chronometer (craft one at a workbench).' };
  const ly = from && to ? lyBetween(from, to) : 0;
  if (!gal && ly > st.jumpLy) return { ok: false, why: `${ly.toFixed(1)} ly is beyond the ${st.name}'s ${st.jumpLy} ly jump. Hop through nearer stars, or fly a bigger ship.` };
  const cost = launchCost(rules) + (ly > 0.01 || gal ? jumpCost(ly, { galaxy: gal }) : 0) + (eraShift ? 6 : 0);
  if (cost > F.fuel) return { ok: false, cost, ly, why: `Needs ${cost} propellant; the tank holds ${F.fuel}. Make propellant at a workbench (ice + crystal).` };
  return { ok: true, cost, ly };
}
export function spend(n) { const F = fuelState(); F.fuel = Math.max(0, F.fuel - n); game.save(); }

// where a travel argument points: the body (mass, radius, orbit) and its star, for WorldRules
export function bodyForTravel(arg = {}) {
  if (arg.addr) {
    const a = typeof arg.addr === 'string' ? parseAddr(arg.addr) : arg.addr;
    const st = a && starAt(a);
    if (st) {
      const p = planetsOf(st)[a.planet || 0];
      const b = a.moon != null && p ? moonsOf(st, p)[a.moon] : p;
      if (b) return { body: { ...b }, star: st, addr: typeof arg.addr === 'string' ? arg.addr : null };
    }
  }
  // legacy: star seed + planet index from the original star map
  if (arg.star != null && arg.index != null) {
    const st = legacyStar(+arg.star), p = planetsOf(st)[+arg.index];
    if (p && p.seed === +arg.seed) return { body: { ...p }, star: st, addr: null };
  }
  return { body: null, star: null, addr: null };
}
export { HOME };
