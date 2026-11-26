// The ship you fly: thrust, mass and propellant, from what you built.
//   - With the rocket workshop's flight model on this build (../game/rocket-sim.js, BMSG-11) and a built
//     rocket, the ship's engines and dry mass are that rocket's upper (classic) stage: copper / pump /
//     vacuum engine thrust, hull + capsule + nose + fins mass. Its drive (specific impulse) and tank are
//     the fleet ship's (skiff .. ark): the ship is what makes the rocket reusable between worlds.
//   - Otherwise each fleet ship has its own engine.
// Units: thrust in newtons, mass in kg, real accelerations (m/s^2) applied to game metres (= km), so the
// thrust-to-weight ratio is exactly real. Propellant burns at the real mass flow T / (Isp g0), times
// DV_SCALE: every delta-v in the game is the real one / sqrt(1000) (orbits are 250 m/s, not 7.9 km/s),
// so a tank buys the same fraction of an orbit it would for real.
import { game } from '../game/store.js';
import { activeShip } from '../game/fleet.js';
import { DV_SCALE } from './system.js';
import { shipStats, fuelState } from './travel.js';

const G0 = 9.80665;
// fleet drives: a high-Isp drive (nuclear-thermal .. fusion-like) is what makes one stage enough to land
// and leave worlds; heat: what the hull takes (Sutton-Graves heat flux, W/m^2) before it glows
export const DRIVES = {
  skiff:   { thrust: 210e3, dry: 7000,  isp: 4500, unitKg: 500, heat: 4.5e6, name: 'Skiff' },
  lantern: { thrust: 420e3, dry: 12000, isp: 5500, unitKg: 600, heat: 6e6,   name: 'Lantern' },
  heron:   { thrust: 700e3, dry: 18000, isp: 7000, unitKg: 700, heat: 8e6,   name: 'Heron' },
  ark:     { thrust: 1.6e6, dry: 42000, isp: 9000, unitKg: 900, heat: 1.2e7, name: 'Seed Ark' },
};
let sim = null, simTried = false;
// the workshop flight model is optional (another worker's module): load it if this build has it
export function loadRocketSim() {
  if (simTried) return Promise.resolve(sim); simTried = true;
  return import('../game/rocket-sim.js').then((m) => (sim = m)).catch(() => null);
}
export function shipPhysics() {
  const S = activeShip(), D = DRIVES[S.id] || DRIVES.skiff, st = shipStats();
  const out = { id: S.id, name: S.name, thrust: D.thrust, dry: D.dry, isp: D.isp, unitKg: D.unitKg, tank: st.tank, heat: D.heat, from: 'ship' };
  const R = game.data.rocket;
  if (sim && R && (R.parts || []).includes('engine')) {
    try {
      const design = sim.designFrom(R), up = design.stages[design.stages.length - 1], E = sim.ENGINES[up.engine];
      if (E && up.engines) {
        // the classic stage with empty tanks (its own propellant is carried in the ship's tank)
        const dryUpper = sim.props({ stages: [{ ...up, fuel: 0 }] }, 0).mass;
        out.thrust = Math.max(D.thrust * 0.5, E.tVac * up.engines); out.thrustSL = E.tSL * up.engines;
        out.dry = Math.max(3000, dryUpper + D.dry * 0.35); out.from = 'rocket';
      }
    } catch (e) { /* design not understood: fleet defaults */ }
  }
  return out;
}
// one physics step's burn: returns acceleration (m/s^2) and propellant used (tank units)
export function burn(phys, throttle, dt, rhoK = 0) {
  const F = fuelState(); if (F.fuel <= 0 || throttle <= 0) return { a: 0, used: 0, mass: phys.dry + Math.max(0, F.fuel) * phys.unitKg };
  const T = (phys.thrustSL != null ? phys.thrust - (phys.thrust - phys.thrustSL) * rhoK : phys.thrust) * throttle;
  const mass = phys.dry + F.fuel * phys.unitKg;
  const mdot = T / (phys.isp * G0) * DV_SCALE; // kg/s at game scale
  const used = Math.min(F.fuel, mdot * dt / phys.unitKg);
  F.fuel -= used;
  return { a: T / mass, used, mass };
}
// readout: delta-v left (game m/s) and thrust-to-weight at a gravity
export function readout(phys, g = 9.81) {
  const F = fuelState(), m0 = phys.dry + F.fuel * phys.unitKg;
  return { dv: phys.isp * G0 * Math.log(m0 / phys.dry) / DV_SCALE, twr: phys.thrust / (m0 * g), acc: phys.thrust / m0, mass: m0, fuel: F.fuel, tank: phys.tank };
}
