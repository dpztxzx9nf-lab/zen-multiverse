// The home garden's no-go ground, server side (tile null = the garden frame).
// Mirrors the client layout so server-placed things (the vault, the geode, contest stones)
// land on solid open ground, never in the pond, the raked sand, the beds, the shed or the wall.
// Sources: js/pond.js (POND), js/sand.js (SAND, SAND_ROCKS), js/worlds/earth.js (freeSpot, bonsai),
// js/game/earth-game.js (BED_ZONE). Kept as a copy: pond.js and sand.js pull in three.js.
const POND_C = { x: 10.2, z: 1.2 };
const angNorm = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
export function pondRadius(th) {
  const cove = Math.exp(-(angNorm(th - 1.05) ** 2) / 0.24);
  return 3.15 + 0.52 * Math.cos(th - 0.12) + 0.20 * Math.cos(2 * th + 0.4) + 0.10 * Math.sin(3 * th + 0.9) - 0.72 * cove;
}
export const SAND = { cx: -2.5, cz: 0.5, w: 13, d: 8.5 };
const SAND_ROCKS = [[-6.26, -1.07, 1.13], [-5.10, -0.22, 0.58], [-5.72, -2.05, 0.39], [0.72, 2.00, 0.82], [-2.57, 3.05, 0.47]];
const BONSAI = { x: 1.5, z: -7.2, r: 3.4 };
const BEDS = { x0: -8.4, x1: 1.4, z0: 9.6, z1: 12.1 };
const box = (x, z, x0, x1, z0, z1, m) => x > x0 - m && x < x1 + m && z > z0 - m && z < z1 + m;

// why a garden spot is not open ground (null = fine). m = clearance in metres (an object's radius).
export function gardenBlock(x, z, m = 0) {
  const dx = x - POND_C.x, dz = z - POND_C.z;
  if (Math.hypot(dx, dz) < pondRadius(Math.atan2(dz, dx)) + 1.4 + m) return 'pond';
  if (Math.abs(x - SAND.cx) < SAND.w / 2 + 1.2 + m && Math.abs(z - SAND.cz) < SAND.d / 2 + 1.2 + m) return 'sand';
  for (const [rx, rz, r] of SAND_ROCKS) if (Math.hypot(x - rx, z - rz) < r + m) return 'rock';
  if (Math.hypot(x - BONSAI.x, z - BONSAI.z) < BONSAI.r + m) return 'bonsai';
  if (box(x, z, -9.4, 7.0, 6.0, 8.0, m)) return 'path';
  if (z < -11.6 + m && z > -13.6 - m && Math.abs(x) < 17.5 + m) return 'wall'; // js/wall.js: 35 m long at z -12.6
  if (box(x, z, 17.5, 23, -0.5, 5.8, m)) return 'shed';
  if (box(x, z, BEDS.x0, BEDS.x1, BEDS.z0, BEDS.z1, 0.6 + m)) return 'beds';
  if (Math.hypot(x - 4.85, z + 2.3) < 1.0 + m) return 'rack';
  return null;
}
// p = {x, z, tile}: open ground anywhere off the garden frame; inside it, clear of the no-go zones
export const openGround = (p, m = 0) => !!p && ((p.tile || null) !== null || !gardenBlock(p.x, p.z, m));
