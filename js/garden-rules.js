// Where things may be set down, spawn or graze in the garden (tile null): one rule for the server's spawns and
// placements (server/src/garden.js) and the animals (js/fauna.js). Nothing here is a hand copy of the layout:
//   solid    - the garden's own baked solids (js/solids-data.js, generated from the visible meshes)
//   pond     - the pond outline (js/garden-shapes.js) plus its bank
//   sand     - the raked bed (js/garden-shapes.js)
//   cove     - the cove water (js/cove.js)
//   path     - the stepping stones (js/garden-shapes.js)
//   beds     - the raised beds' footprint (js/garden-shapes.js)
//   place:*  - the points of interest (js/places.js)
//   spawn    - the arrival spot (js/spawn.js)
// m = clearance in metres (an object's radius). Returns why a spot is not open, or null.
import { SOLIDS } from './solids-data.js';
import { nearest, cellBits } from './solids.js';
import { pondDist, POND_BANK, SAND, STEP_PATH, BED_ZONE } from './garden-shapes.js';
import { inside as coveInside } from './cove.js';
import { PLACES } from './places.js';
import { WORLD_SPAWN } from './spawn.js';

const MARGIN = { pond: 0.7, sand: 1.2, beds: 0.6, path: 0.6, spawn: 1.2 }; // design clearances (keep the way and the views clear)
let G = null;
const grids = () => G || (G = SOLIDS.garden.map((c) => { cellBits(c); return { c, bb: [c.x0, c.z0, c.x0 + c.nx * c.cs, c.z0 + c.nz * c.cs] }; }));
export function solidNear(x, z, m = 0) {
  for (const { c, bb } of grids()) {
    if (x < bb[0] - m - 0.1 || x > bb[2] + m + 0.1 || z < bb[1] - m - 0.1 || z > bb[3] + m + 0.1) continue;
    if (nearest([c], x, z) < m) return c.name;
  }
  return null;
}
export function gardenNoGo(x, z, m = 0) {
  if (pondDist(x, z) < POND_BANK + MARGIN.pond + m) return 'pond';
  if (Math.abs(x - SAND.cx) < SAND.w / 2 + MARGIN.sand + m && Math.abs(z - SAND.cz) < SAND.d / 2 + MARGIN.sand + m) return 'sand';
  if (coveInside(x, z) > -m) return 'cove';
  const s = solidNear(x, z, m); if (s) return s;
  for (const [px, pz, r] of STEP_PATH) if (Math.hypot(x - px, z - pz) < r + MARGIN.path + m) return 'path';
  if (x > BED_ZONE.x0 - MARGIN.beds - m && x < BED_ZONE.x1 + MARGIN.beds + m && z > BED_ZONE.z0 - MARGIN.beds - m && z < BED_ZONE.z1 + MARGIN.beds + m) return 'beds';
  for (const p of PLACES) if (Math.hypot(x - p.x, z - p.z) < p.r * 0.8 + m) return 'place:' + p.id; // camps, ruins, the hill, the wreck
  if (Math.hypot(x - WORLD_SPAWN.x, z - WORLD_SPAWN.z) < MARGIN.spawn + m) return 'spawn';
  return null;
}
