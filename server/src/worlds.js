// World keys, limits and access rules shared by the Worker and the World Durable Object.
export const DIMS = ['prime', 'amber', 'tidal', 'velvet'];
const AID = /^[0-9a-f]{32}$/;
// home:<owner>  = the owner's Earth garden (private: owner, friends, invite holders)
// moon:<owner>  = the owner's moon base   (same rules)
// planet:<dim>:<seed> = a procedural planet (public, sharded 32 per shard)
export function parseWorld(key) {
  if (typeof key !== 'string' || key.length > 80) return null;
  const p = key.split(':');
  if ((p[0] === 'home' || p[0] === 'moon') && p.length === 2 && AID.test(p[1])) return { kind: p[0], owner: p[1], key };
  if (p[0] === 'planet' && p.length === 3 && DIMS.includes(p[1]) && /^\d{1,10}$/.test(p[2]) && +p[2] < 2 ** 31) return { kind: 'planet', dim: p[1], seed: +p[2], key };
  return null;
}
// Movement rules per world kind, from the client's own tuning (js/game/move-config.js MOVE, g7 controller:
// walk 4.6, sprint 7.4 m/s, sprint cap after a dash x1.15 = 8.5, slides up to 10.8 for a moment, double jump,
// mantle 2.1 m). maxH = sustained speed allowed, burst = extra metres a slide/dash may borrow (refills at maxH).
// Earth fence r 58 around (1.5,-0.5); moon r 420. Voxel building can raise the ground, so y limits are loose.
export const RULES = {
  home: { cap: 12, maxH: 9, burst: 5, center: [1.5, -0.5], r: 64, yMin: -40, yMax: 120 },
  moon: { cap: 12, maxH: 9, burst: 5, center: [0, 0], r: 430, yMin: -400, yMax: 400 },
  planet: { cap: 32, maxH: 9, burst: 5, center: [0, 0], r: 60000, yMin: -2000, yMax: 6000 },
};
export const SHARDS = 16;
