// Beacons: the only fast travel. Everyone starts with a home beacon at the garden; every other beacon is crafted (real costs) and planted by hand next to the ship
// somewhere she has flown to in person; from then on, sitting in the ship (only there), she can jump
// to any of her beacons. Apart from the home beacon, nothing is free.
// Also: the warp coil, the crafted drive for interstellar flight (pilot.js flies it).
// save: G.universe.beacons = [{ id, name, world: 'planet'|'earth'|'moon', seed, star, index, addr, dim, era, tile, x, z, sys }]
import { game, ITEMS } from '../game/store.js';
import { RECIPES } from '../game/g7/craft.js';
import { fuelState } from './travel.js';

Object.assign(ITEMS, {
  beacon: { name: 'Beacon', icon: 'star', color: '#9fe3ff', group: 'Ship' },
  'device:warp': { name: 'Warp coil', icon: 'star', color: '#b9d4ff', group: 'Ship' },
});
const ADD = [
  { id: 'beacon', name: 'Beacon', desc: 'A homing beacon. Plant it beside your ship; from inside the ship you can then jump back to it from anywhere (2 propellant a jump).', cost: { 'mat:metal': 3, 'mat:crystal': 2, 'mat:ore': 1 }, give: { item: ['beacon', 1] }, station: true },
  { id: 'warpcoil', name: 'Warp coil', desc: 'Interstellar drive. Fly past the edge of a system, pick a star on the nav map, engage: you fly the light years yourself (propellant by distance).', cost: { 'mat:crystal': 8, 'mat:metal': 6, 'mat:ore': 4 }, give: { item: ['device:warp', 1] }, station: true, unique: true, needs: { worlds: 2 } },
];
for (const r of ADD) if (!RECIPES.some((x) => x.id === r.id)) RECIPES.push(r);

export const FAST_COST = 2;
// every player starts with a home beacon at their spawn (the garden's beacon spot); a garden beacon she
// planted before this existed simply becomes her home beacon
export const HOME_SPOT = { x: 30, z: -6 };
export function beaconList() {
  const U = (game.data.universe = game.data.universe || {}), list = (U.beacons = U.beacons || []);
  if (!list.some((b) => b.home)) { const g = list.find((b) => b.world === 'earth'); if (g) g.home = true; else list.unshift({ id: 'home', home: true, world: 'earth', name: 'Home (the garden)', ...HOME_SPOT }); }
  return list;
}
export const homeBeacon = () => beaconList().find((b) => b.home);
export const hasBeaconItem = () => game.count('beacon') > 0;
export function plantBeacon(rec) {
  if (!hasBeaconItem()) return null;
  const list = beaconList();
  if (list.some((b) => b.world === rec.world && b.addr === rec.addr && b.tile === rec.tile && Math.hypot((b.x || 0) - (rec.x || 0), (b.z || 0) - (rec.z || 0)) < 40)) return null;
  game.pay({ beacon: 1 });
  const b = { id: 'b' + Date.now().toString(36), ...rec };
  list.push(b); game.save();
  return b;
}
export function beaconsNear(world, addr, tile) { return beaconList().filter((b) => b.world === world && (b.addr || null) === (addr || null) && (b.tile || null) === (tile || null)); }
export const gardenBeacon = () => beaconList().find((b) => b.world === 'earth') || null;
// pay for a jump (from inside the ship)
export function payJump() { const F = fuelState(); if (F.fuel < FAST_COST) return false; F.fuel -= FAST_COST; game.save(); return true; }
