// Getting home when the ship can't: the home beacon, the escape pod, the wreck and the ship's hold.
//   - Every player starts with a home beacon at their spawn (the garden). More beacons are crafted and
//     planted by hand (beacons.js); later ones are built at player bases.
//   - Every ship carries one escape pod. Launching it (or the ship being destroyed) flies her back to the
//     home beacon with what she carries on her body. The ship stays where it was as a wreck, with whatever
//     is in its hold and tank. A ship burned in a star or crushed in a giant leaves nothing to recover.
//   - A spare pod is crafted from real parts and fitted the next time she boards.
//   - The wreck is recovered in place: repair it with a rebuild kit (keeps its hold), or salvage its hold
//     and tank into the ship she came in. A rebuild kit at home also builds a replacement hull.
// Single-player save data only: nothing here talks to the multiplayer server.
// save: G.fleet.pod (false once used), G.fleet.hold = { item: n }, G.universe.wreck = { ship, name, why,
//   at: { addr, dim, era, tile, x, z, yaw } | null, space: { sys, focus, p } | null, hold, fuel, lost, t }
import { game, ITEMS } from '../game/store.js';
import { RECIPES } from '../game/g7/craft.js';
import { fleetData, activeShip } from '../game/fleet.js';
import { shipStats } from './travel.js';

Object.assign(ITEMS, { escapepod: { name: 'Escape pod', icon: 'star', color: '#ffcf8a', group: 'Ship' } });
const ADD = [
  { id: 'escapepod', name: 'Escape pod', desc: 'One-use lifeboat for any ship: a heat-shielded metal shell (4 metal), a woven parachute (4 fibre), a guidance cell that homes on your home beacon (1 crystal) and a small motor (2 propellant). Fitted the next time you board.', cost: { 'mat:metal': 4, fibre: 4, 'mat:crystal': 1, propellant: 2 }, give: { item: ['escapepod', 1] }, station: true },
];
for (const r of ADD) if (!RECIPES.some((x) => x.id === r.id)) RECIPES.push(r);

export { homeBeacon } from './beacons.js';

// ---- the pod
export const podFitted = () => fleetData().pod !== false;
export function usePod() { const F = fleetData(); if (F.pod === false) return false; F.pod = false; game.save(); return true; }
export function fitSparePod() {
  const F = fleetData();
  if (F.pod !== false || game.count('escapepod') <= 0) return false;
  game.pay({ escapepod: 1 }); F.pod = true; game.save(); return true;
}

// ---- the hold: what stays with the ship (the bag stays on her body)
const STOW = (k) => k.startsWith('mat:') || k.startsWith('sample:') || k === 'ice';
export function hold() { const F = fleetData(); return (F.hold = F.hold || {}); }
export const holdCount = (h = hold()) => Object.values(h).reduce((a, b) => a + b, 0);
export function stowAll() {
  const H = hold(), inv = game.data.inv; let n = 0;
  for (const k of Object.keys(inv)) if (STOW(k) && inv[k] > 0) { H[k] = (H[k] || 0) + inv[k]; n += inv[k]; delete inv[k]; }
  if (n) game.save(); return n;
}
export function takeAll(h = hold()) {
  let n = 0; for (const [k, v] of Object.entries(h)) { if (v > 0) { game.add(k, v); n += v; } delete h[k]; }
  if (n) game.save(); return n;
}

// ---- the wreck
export const wreck = () => (game.data.universe && game.data.universe.wreck) || null;
export function wreckShip({ at = null, space = null, why = 'pod', lost = false } = {}) {
  const U = (game.data.universe = game.data.universe || {}), F = fleetData(), S = activeShip();
  const h = hold();
  U.wreck = lost ? null : { ship: S.id, name: S.name, why, at, space, hold: { ...h }, fuel: Math.max(0, +(F.fuel || 0).toFixed(2)), t: Date.now() };
  for (const k of Object.keys(h)) delete h[k];
  F.fuel = 0; F.hull = 0; F.wrecked = true;
  game.save();
  return U.wreck;
}
// repair the wreck where it lies with a rebuild kit: her ship again, hold and tank as they were
export function repairWreck() {
  const w = wreck(), F = fleetData(); if (!w || game.count('shipkit') <= 0) return false;
  game.pay({ shipkit: 1 });
  const H = hold(); for (const [k, v] of Object.entries(w.hold || {})) H[k] = (H[k] || 0) + v;
  F.fuel = Math.min(shipStats().tank, w.fuel || 0); F.hull = 1; F.wrecked = false;
  game.data.universe.wreck = null; game.save();
  return true;
}
// strip the wreck into the ship she came in: the hold moves over, propellant fills the tank (the rest is lost)
export function salvageWreck() {
  const w = wreck(), F = fleetData(); if (!w || F.wrecked) return null;
  const H = hold(); let items = 0; for (const [k, v] of Object.entries(w.hold || {})) { H[k] = (H[k] || 0) + v; items += v; }
  const room = Math.max(0, shipStats().tank - (F.fuel || 0)), fuel = Math.min(room, w.fuel || 0); F.fuel = (F.fuel || 0) + fuel;
  game.data.universe.wreck = null; game.save();
  return { items, fuel };
}
