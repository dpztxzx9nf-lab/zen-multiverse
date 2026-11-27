// Xenia city hub on the home Earth globe: greybox layout, spawn, collision boxes and
// height pads. Pure data (no Three), shared by the game and the server.
// Coordinates: unless noted, x/z are metres in the Earth spawn-tile frame (tile 1:1:1),
// the same frame the client sends while walking the home globe. Garden-local metres
// (js/places.js) convert with gardenToPlanet / planetToGarden.
import { makeFrame, transfer } from './universe/sphere.js';

export const EARTH_SITE = Object.freeze({
  tile: '1:1:1',
  x: 366.98038325377115,
  z: 160.9598060102228,
  h: 7.268806655308169, // lawn / city pad; sea is 4.5
});
export const HUB_PAD_Y = EARTH_SITE.h;
export const SEA_Y = 4.5;
export const GARDEN_CX = 1.5;
export const GARDEN_CZ = -0.5;
export const SEAWARD_YAW = 310 * Math.PI / 180; // city 'along' axis, toward the bay
const FX = Math.sin(SEAWARD_YAW), FZ = Math.cos(SEAWARD_YAW);
const RX = Math.cos(SEAWARD_YAW), RZ = -Math.sin(SEAWARD_YAW);

export function gardenToPlanet(lx, lz) {
  return { x: EARTH_SITE.x + lx - GARDEN_CX, z: EARTH_SITE.z + lz - GARDEN_CZ };
}
export function planetToGarden(x, z) {
  return { x: x - EARTH_SITE.x + GARDEN_CX, z: z - EARTH_SITE.z + GARDEN_CZ };
}
export function cityToGarden(along, lat) {
  return { x: GARDEN_CX + FX * along + RX * lat, z: GARDEN_CZ + FZ * along + RZ * lat };
}
export function cityToPlanet(along, lat) {
  const g = cityToGarden(along, lat);
  return gardenToPlanet(g.x, g.z);
}
export function planetToCity(x, z) {
  const g = planetToGarden(x, z);
  const dx = g.x - GARDEN_CX, dz = g.z - GARDEN_CZ;
  return { along: dx * FX + dz * FZ, lat: dx * RX + dz * RZ };
}

// New players land in the plaza, looking at the bay. y is the pad height.
const plaza = cityToPlanet(95, 0);
export const HUB_SPAWN = Object.freeze({
  x: plaza.x, z: plaza.z, y: HUB_PAD_Y, yaw: SEAWARD_YAW, tile: EARTH_SITE.tile,
});
// Arrival stone in garden-local metres (used to convert old saves and garden layout data).
export const GARDEN_ARRIVAL = Object.freeze({ x: 3.5, z: 9.8, yaw: Math.PI * 0.92 });
// Same radius the garden used when it was its own frame (js/universe/basesite.js GARDEN.out).
export const GARDEN_R = 60;

export function isLegacyGardenTile(tile) {
  return tile == null || tile === '';
}

// Player or object pose in garden-local metres (and local y, lawn = 0). Null if it is not in the garden.
export function gardenLocal(p) {
  if (!p || p.x == null || p.z == null) return null;
  if (isLegacyGardenTile(p.tile)) return { x: p.x, z: p.z, y: p.y };
  if (p.tile === EARTH_SITE.tile) {
    const g = planetToGarden(p.x, p.z);
    return { x: g.x, z: g.z, y: p.y != null ? p.y - HUB_PAD_Y : p.y };
  }
  return null;
}

export function inGardenArea(p, r = GARDEN_R) {
  const g = gardenLocal(p);
  return !!(g && Math.hypot(g.x - GARDEN_CX, g.z - GARDEN_CZ) <= r);
}

// Lift a leftover garden-frame pose (no tile) onto the Earth globe next to the city.
export function liftGardenPose(p) {
  if (!p || !isLegacyGardenTile(p.tile)) return p;
  const xz = gardenToPlanet(p.x, p.z);
  const out = { ...p, x: xz.x, z: xz.z, tile: EARTH_SITE.tile };
  if (p.y != null && Number.isFinite(p.y)) out.y = p.y + HUB_PAD_Y;
  return out;
}

export const GARDEN_ARRIVAL_PLANET = Object.freeze(liftGardenPose({
  x: GARDEN_ARRIVAL.x, z: GARDEN_ARRIVAL.z, y: 0, yaw: GARDEN_ARRIVAL.yaw,
}));

function boxAt(along, lat, halfAlong, halfLat, bottom, top, name, extra = {}) {
  const p = cityToPlanet(along, lat);
  return {
    type: 'box', kind: 'solid', x: p.x, z: p.z, hw: halfLat, hd: halfAlong,
    ry: SEAWARD_YAW, bottom, top, h: top - bottom, name, tag: 'hub', ...extra,
  };
}
function gardenBox(lx, lz, hw, hd, bottom, top, name, ry = 0, extra = {}) {
  const p = gardenToPlanet(lx, lz);
  return {
    type: 'box', kind: 'solid', x: p.x, z: p.z, hw, hd, ry, bottom, top, h: top - bottom, name, tag: 'hub', ...extra,
  };
}

const PAD = HUB_PAD_Y;
const BOXES = [];

// ---- dense street blocks (2–4 storeys), leaving the plaza, streets and beach open
// Main street runs along lat=0; cross street at along=95. Street half-width ~4 m.
const BLOCKS = [
  // inland of the plaza (toward the garden)
  [78, -20, 8, 10, 8, 'block-inland-w'],
  [78, 20, 8, 10, 7, 'block-inland-e'],
  [70, -20, 6, 8, 6, 'block-gate-w'],
  [70, 20, 6, 8, 6, 'block-gate-e'],
  // either side of the plaza, mid-block
  [95, -32, 9, 10, 5, 'block-mid-w'],
  [95, 32, 8, 10, 8, 'block-mid-e'],
  // seaward of the plaza, before the beach
  [112, -20, 8, 10, 7, 'block-sea-w'],
  [112, 20, 7, 9, 6, 'block-sea-e'],
  [112, -40, 6, 8, 5, 'block-sea-w2'],
  [112, 42, 6, 7, 5, 'block-sea-e2'],
  // a few more to thicken the grid
  [82, 20, 5, 7, 5, 'block-side-e'],
  [82, -48, 5, 7, 5, 'block-side-w'],
];
for (const [al, lat, ha, hl, storeys, name] of BLOCKS) {
  BOXES.push(boxAt(al, lat, ha, hl, PAD - 0.4, PAD + storeys * 3.2, name));
}

// Hong Kong–style sharp hero tower (Bank of China silhouette, rough).
// 'bank-tower' stays the named solid. Mid-west block is kept lower so this reads from the plaza.
BOXES.push(boxAt(82, -32, 8, 8, PAD - 0.4, PAD + 18, 'bank-tower'));
BOXES.push(boxAt(82, -32, 6.2, 6.2, PAD + 16, PAD + 30, 'bank-shaft'));
BOXES.push(boxAt(82, -32, 7.2, 2.4, PAD + 18, PAD + 44, 'bank-blade-a', { ry: SEAWARD_YAW + 0.55 }));
BOXES.push(boxAt(82, -32, 7.2, 2.4, PAD + 22, PAD + 48, 'bank-blade-b', { ry: SEAWARD_YAW - 0.55 }));
BOXES.push(boxAt(82, -32, 2.4, 2.4, PAD + 46, PAD + 56, 'bank-crown'));
BOXES.push(boxAt(82, -32, 1.0, 1.0, PAD + 55, PAD + 64, 'bank-spire'));

// Singapore hawker / Hoi An lantern market: a low plaza of colorful stalls.
// Centre and the seaward side stay open so the bay stays in sight from spawn.
const stalls = [
  [95, 16, 2.0, 5, 2.6, 'stall-n'],
  [88, 16, 2.0, 4, 2.3, 'stall-n2'],
  [102, 16, 2.0, 4, 2.8, 'stall-n3'],
  [95, -16, 2.0, 5, 2.5, 'stall-s'],
  [88, -16, 2.0, 4, 2.8, 'stall-s2'],
  [102, -16, 2.0, 4, 2.4, 'stall-s3'],
  [86, 0, 5, 2.0, 2.4, 'stall-w'],
  [86, 8, 4, 2.0, 2.7, 'stall-w2'],
  [86, -8, 4, 2.0, 2.3, 'stall-w3'],
];
for (const [al, lat, ha, hl, h, name] of stalls) BOXES.push(boxAt(al, lat, ha, hl, PAD, PAD + h, name));
const lanterns = [
  [90, 11.6, 'market-lantern-r'], [95, 11.6, 'market-lantern-y'], [100, 11.6, 'market-lantern-t'],
  [90, -11.6, 'market-lantern-y'], [95, -11.6, 'market-lantern-p'], [100, -11.6, 'market-lantern-r'],
  [86, 4.5, 'market-lantern-t'], [86, -4.5, 'market-lantern-p'],
];
for (const [al, lat, name] of lanterns) BOXES.push(boxAt(al, lat, 0.35, 0.35, PAD + 2.65, PAD + 3.2, name));

// Rio-style beach bay: a Sugarloaf-like headland at the west hook, and a low curved promenade.
// The beach stays low so the water stays in sight from the plaza. The old high canopy is gone.
BOXES.push(boxAt(138, -36, 9, 11, SEA_Y, PAD + 8, 'sugarloaf-base'));
BOXES.push(boxAt(137, -36, 6, 7, PAD + 6, PAD + 16, 'sugarloaf-mid'));
BOXES.push(boxAt(136, -36, 3.2, 3.8, PAD + 14, PAD + 26, 'sugarloaf-peak'));
// low curb along a shallow curve (does not wall off the bay)
for (const lat of [-28, -20, -12, -4, 4, 12, 20, 28]) {
  const al = 126 + 6 * Math.cos((lat / 32) * Math.PI * 0.5);
  BOXES.push(boxAt(al, lat, 0.55, 4.2, PAD - 0.2, PAD + 0.45, 'bay-curb'));
}
for (const lat of [-24, -8, 8, 24]) {
  const al = 126 + 6 * Math.cos((lat / 32) * Math.PI * 0.5);
  BOXES.push(boxAt(al - 1.2, lat, 0.22, 0.22, PAD - 0.1, PAD + 3.2, 'bay-lamp'));
}

// Cape Town-style harbor: warehouses and cranes on a walkable pier, under a flat-top mountain.
// The deck itself is a height pad, not a wall; thin lips keep you on the pier.
BOXES.push(boxAt(124, 48, 6, 8, PAD - 0.4, PAD + 8, 'dock-warehouse'));
BOXES.push(boxAt(124, 60, 5, 5, PAD - 0.4, PAD + 5.5, 'dock-shed'));
BOXES.push(boxAt(114, 74, 8, 6, PAD - 0.4, PAD + 16, 'table-mtn-base'));
BOXES.push(boxAt(114, 74, 6.5, 5, PAD + 15, PAD + 22, 'table-mtn-top'));
BOXES.push(boxAt(140, 46, 0.45, 0.45, 6.1, 22.1, 'dock-crane-mast'));
BOXES.push(boxAt(140, 50.2, 4.6, 0.4, 20.3, 22.1, 'dock-crane-jib'));
BOXES.push(boxAt(134, 56, 0.45, 0.45, 6.1, 18.5, 'dock-crane-mast-2'));
BOXES.push(boxAt(134, 52.4, 4.2, 0.4, 16.8, 18.5, 'dock-crane-jib-2'));
BOXES.push(boxAt(136, 48, 1.2, 1.2, 6.1, 7.4, 'dock-crate'));
BOXES.push(boxAt(133, 53, 1.0, 1.6, 6.1, 7.2, 'dock-crate'));
// pier edge lips (thin, so you can walk the deck)
BOXES.push(boxAt(138, 42, 8, 0.35, 5.6, 6.5, 'pier-lip-s'));
BOXES.push(boxAt(138, 58, 8, 0.35, 5.6, 6.5, 'pier-lip-n'));
BOXES.push(boxAt(146, 50, 0.35, 8.4, 5.6, 6.5, 'pier-lip-end'));

// Mansion row on the NE hill (garden-local pads, flattened in applyHubHeight)
export const MANSIONS = [
  { lx: 216, lz: 132, padY: 13.2, hw: 6, hd: 7, name: 'mansion-1' },
  { lx: 232, lz: 118, padY: 11.8, hw: 6, hd: 7, name: 'mansion-2' },
  { lx: 240, lz: 110, padY: 13.4, hw: 6, hd: 7, name: 'mansion-3' },
  { lx: 250, lz: 100, padY: 16.5, hw: 6, hd: 7, name: 'mansion-4' },
];
for (const m of MANSIONS) {
  BOXES.push(gardenBox(m.lx, m.lz, m.hw, m.hd, m.padY - 0.3, m.padY + 8, m.name, 0.55));
}

export const HUB_BOXES = BOXES;

export const LANDMARKS = [
  { id: 'hub-beach', name: 'Beach Bay', along: 130, lat: 0, what: 'The main hangout, like Looty Bay. Shops and pricey plots nearby.' },
  { id: 'hub-bank', name: 'Bank Tower', along: 82, lat: -32, what: 'The big heist downtown.' },
  { id: 'hub-docks', name: 'The Docks', along: 138, lat: 50, what: 'Shipping jobs, smuggling and the first ships.' },
  { id: 'hub-market', name: 'Night Market', along: 95, lat: 0, what: 'Player shops and trading stalls.' },
  { id: 'hub-mansions', name: 'Mansion Row', lx: 232, lz: 118, what: 'Hilltop houses for players who have made it.' },
].map((L) => {
  const p = L.lx != null ? gardenToPlanet(L.lx, L.lz) : cityToPlanet(L.along, L.lat);
  return { id: L.id, name: L.name, what: L.what, x: p.x, z: p.z };
});

export const PLOTS = [
  { id: 'hub-plot-bay-1', name: 'Bay Plot 1', along: 120, lat: -28 },
  { id: 'hub-plot-bay-2', name: 'Bay Plot 2', along: 120, lat: 28 },
  { id: 'hub-plot-bay-3', name: 'Bay Plot 3', along: 128, lat: -8 },
  { id: 'hub-plot-plaza-1', name: 'Plaza Plot 1', along: 95, lat: -20 },
  { id: 'hub-plot-plaza-2', name: 'Plaza Plot 2', along: 104, lat: 14 },
  { id: 'hub-plot-bank', name: 'Bank Lot', along: 82, lat: -18 },
  { id: 'hub-plot-hill-1', name: 'Hill Plot 1', lx: 222, lz: 124 },
  { id: 'hub-plot-hill-2', name: 'Hill Plot 2', lx: 244, lz: 106 },
].map((P) => {
  const p = P.lx != null ? gardenToPlanet(P.lx, P.lz) : cityToPlanet(P.along, P.lat);
  const hill = P.lx != null;
  return { id: P.id, name: P.name, x: p.x, z: p.z, hill, along: P.along, lat: P.lat, lx: P.lx, lz: P.lz };
});

// Street slabs (visual only): [along, lat, halfAlong, halfLat]
export const STREETS = [
  [100, 0, 32, 4],     // main street, garden to bay
  [95, 0, 4, 40],      // cross at the plaza
  [78, 0, 4, 36],      // inland cross
  [112, 0, 4, 36],     // seaward cross
];

// Height pads: flatten the terrace and grade the beach / docks / mansion terraces.
const TERRACE = { along0: 66, along1: 136, lat0: -56, lat1: 56, blend: 8 };
const BEACH = { along0: 118, along1: 144, lat0: -40, lat1: 40 };
const DOCK_DECK = { along0: 130, along1: 148, lat0: 40, lat1: 60, y: 6.0 };

function sstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
function edgeK(x, x0, x1, blend) {
  return Math.min(sstep(x0, x0 + blend, x), 1 - sstep(x1 - blend, x1, x));
}
function padK(along, lat, a0, a1, l0, l1, blend) {
  return Math.max(0, Math.min(edgeK(along, a0, a1, blend), edgeK(lat, l0, l1, blend)));
}

export function applyHubHeight(h, x, z, tile = EARTH_SITE.tile) {
  // only the spawn-tile frame holds the hub; callers convert first if needed
  if (tile && tile !== EARTH_SITE.tile) return h;
  const c = planetToCity(x, z);
  let out = h;
  const tk = padK(c.along, c.lat, TERRACE.along0, TERRACE.along1, TERRACE.lat0, TERRACE.lat1, TERRACE.blend);
  if (tk > 0) out = out + (PAD - out) * tk;
  if (c.along > BEACH.along0 && c.along < BEACH.along1 && c.lat > BEACH.lat0 && c.lat < BEACH.lat1) {
    const t = sstep(BEACH.along0, BEACH.along1, c.along);
    const want = PAD + (SEA_Y + 0.35 - PAD) * t;
    const bk = padK(c.along, c.lat, BEACH.along0, BEACH.along1, BEACH.lat0, BEACH.lat1, 6);
    if (bk > 0) out = out + (want - out) * bk;
  }
  const dk = padK(c.along, c.lat, DOCK_DECK.along0, DOCK_DECK.along1, DOCK_DECK.lat0, DOCK_DECK.lat1, 3);
  if (dk > 0) out = out + (DOCK_DECK.y - out) * dk;
  for (const m of MANSIONS) {
    const p = gardenToPlanet(m.lx, m.lz);
    const d = Math.hypot(x - p.x, z - p.z);
    const k = 1 - sstep(m.hw + 1, m.hw + 8, d);
    if (k > 0) out = out + (m.padY - out) * k;
  }
  return out;
}

export function installHubHeight(W) {
  if (!W || W.site?.kind !== 'earth' || W._hubHeight) return W;
  const raw = W.height.bind(W);
  W.height = (x, z) => {
    let sx = x, sz = z, tile = W.tile;
    if (W.frame && W.tile && W.tile !== EARTH_SITE.tile) {
      const t = transfer(W.frame, makeFrame(W.radius, EARTH_SITE.tile), x, z, 0);
      sx = t.x; sz = t.z; tile = EARTH_SITE.tile;
    }
    return applyHubHeight(raw(x, z), sx, sz, tile);
  };
  W._hubHeight = true;
  return W;
}

// flora / rocks stay out of the street grid and mansion terraces
export function inHub(x, z, tile = EARTH_SITE.tile) {
  if (tile && tile !== EARTH_SITE.tile) return false;
  const c = planetToCity(x, z);
  if (c.along > 64 && c.along < 150 && c.lat > -62 && c.lat < 68) return true;
  for (const m of MANSIONS) {
    const p = gardenToPlanet(m.lx, m.lz);
    if (Math.hypot(x - p.x, z - p.z) < 16) return true;
  }
  return false;
}

export function hubForSolids() {
  return HUB_BOXES.map((b) => ({
    type: 'box', kind: 'solid', x: +b.x.toFixed(4), z: +b.z.toFixed(4),
    hw: +b.hw.toFixed(4), hd: +b.hd.toFixed(4), ry: +b.ry.toFixed(6),
    bottom: +b.bottom.toFixed(4), top: +b.top.toFixed(4), name: b.name, tag: 'hub',
  }));
}

export function homeEarthArg(home) {
  const h = home.homeBody('earth');
  return { site: 'earth', seed: h.body.seed, star: 0, index: 2, addr: h.addr, dim: 'prime' };
}

export async function enterHub(worlds, pos = HUB_SPAWN, extra = {}) {
  const at = pos && isLegacyGardenTile(pos.tile) && pos.x != null ? liftGardenPose(pos) : (pos || HUB_SPAWN);
  const home = await import('./universe/home.js');
  return worlds.go('planet', {
    ...homeEarthArg(home), from: 'hub',
    x: at.x, z: at.z, yaw: at.yaw ?? SEAWARD_YAW, tile: at.tile || EARTH_SITE.tile,
    ...extra,
  });
}
