// World keys, capacity and access rules shared by the Worker and the World Durable Object.
import { moveRules } from './physics.js';
export const DIMS = ['prime', 'amber', 'tidal', 'velvet'];
const AID = /^[0-9a-f]{32}$/;
// home:<owner>  = the owner's Earth (garden and, once they walk out, the rest of the sphere)
// moon:<owner>  = the owner's Moon (base and the rest of the sphere)
// planet:<dim>:<seed> = a procedural planet (public, sharded 32 per shard)
export function parseWorld(key) {
  if (typeof key !== 'string' || key.length > 80) return null;
  const p = key.split(':');
  if ((p[0] === 'home' || p[0] === 'moon') && p.length === 2 && AID.test(p[1])) return { kind: p[0], owner: p[1], key };
  if (p[0] === 'planet' && p.length === 3 && DIMS.includes(p[1]) && /^\d{1,10}$/.test(p[2]) && +p[2] < 2 ** 31) return { kind: 'planet', dim: p[1], seed: +p[2], key };
  return null;
}
// No world borders (no garden fence, no moon r430, no flat ±60 km). Movement is checked on
// sphere-surface distance and per-tile coordinates; the budget follows this world's gravity
// and the abilities/gear the player has earned. Dash/glide/free double jump are not allowed.
export function rulesFor(w) {
  return moveRules(w.kind, w.seed, w.dim);
}
// leftover name used by older comments; prefer rulesFor(parsedWorld)
export const RULES = {
  home: { cap: 12 },
  moon: { cap: 12 },
  planet: { cap: 32 },
};
export const SHARDS = 16;
export const PIECE_TYPES = ['wall', 'floor', 'beam', 'post', 'block', 'ramp', 'bench', 'wire', 'solar', 'wheel', 'vane', 'battery', 'lamp', 'heater', 'switch', 'relay'];
export const PIECE_MATS = ['wood', 'stone', 'metal', 'ice', 'crystal'];
