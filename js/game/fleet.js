// Her fleet: ships she can fly through the star map. Each reaches further (sectors from home) and into
// more dimensions. The first comes with the guide; the others are commissioned from what she has
// gathered on her travels. save: G.fleet = { owned: [ids], active: id }
import { game } from './store.js';

export const SHIPS = [
  { id: 'skiff', name: 'Skiff', desc: 'The little ship Ilo left for you. Steady, close to home.', range: 1, dims: ['prime', 'amber'], accent: '#7fe0d0', scale: 0.8, cost: null },
  { id: 'lantern', name: 'Lantern', desc: 'A warm-lit cruiser that rides the tides between worlds.', range: 3, dims: ['prime', 'amber', 'tidal'], accent: '#ffd38a', scale: 1, cost: { sample: 4, moonglass: 3, herb: 2 }, worlds: 2 },
  { id: 'heron', name: 'Heron', desc: 'Long and quiet, with wings that fold. It knows the velvet dusk.', range: 8, dims: ['prime', 'amber', 'tidal', 'velvet'], accent: '#c9a8ff', scale: 1.15, cost: { sample: 9, 'flower:any': 6, fibre: 4 }, worlds: 4 },
  { id: 'ark', name: 'Seed Ark', desc: 'A great slow garden ship. It can go anywhere at all.', range: Infinity, dims: ['prime', 'amber', 'tidal', 'velvet'], accent: '#a6e39a', scale: 1.35, cost: { sample: 16, herb: 6, 'flower:any': 10, 'find:any': 4 }, worlds: 7 },
];
export const shipById = (id) => SHIPS.find((s) => s.id === id) || SHIPS[0];
export function fleetData() {
  const G = game.data;
  if (!G.fleet) G.fleet = { owned: game.unlocked('warp') ? ['skiff'] : [], active: 'skiff' };
  return G.fleet;
}
export const activeShip = () => shipById(fleetData().active);
export const worldsVisited = () => Object.keys(game.data.journal.planets || {}).length;
// samples are many items ('sample:<world> <biome>'); a ship's sample cost spends any of them
export function canCommission(s) {
  if (!s.cost) return false;
  if (worldsVisited() < (s.worlds || 0)) return false;
  const { sample = 0, ...rest } = s.cost;
  return game.total('sample:') >= sample && game.has(rest);
}
export function commission(id) {
  const s = shipById(id), F = fleetData();
  if (F.owned.includes(id) || !canCommission(s)) return false;
  const { sample = 0, ...rest } = s.cost;
  if (!game.pay(rest)) return false;
  let left = sample; const G = game.data;
  for (const k of Object.keys(G.inv).filter((k) => k.startsWith('sample:')).sort((a, b) => G.inv[b] - G.inv[a])) { const t = Math.min(left, G.inv[k]); game.take(k, t); left -= t; if (!left) break; }
  F.owned.push(id); F.active = id; game.save();
  return true;
}
export function setActive(id) { const F = fleetData(); if (F.owned.includes(id)) { F.active = id; game.save(); } }
