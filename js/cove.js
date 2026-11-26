// The salt cove and the sea cave in its headland (pure geometry: the game, the ground and the server all use it).
// On Xenia the cove sits at the head of the sound, south of the spawn town (hub frame metres, y up, the town's
// lawn at y = 0, sea level -0.35): a shelving bank, then deep water, a sand bar, then the sound running south to
// the Warm Sea (js/xenia/xenia.js). The headland is one big river stone; under it a tunnel (its roof about a
// metre under the surface, so you have to dive) leads into a round air chamber with a dry ledge at the back.
// A crack in the roof lets a little daylight in. (It was 365 m further north, beside the old garden.)
export const COVE_SHIFT = 365;
const S = COVE_SHIFT;
export const COVE = { x: 2, z: -35 + S, a: 10, b: 8.5, sea: -0.35, depth: 4.4, bank: 2.2 };
export const HEAD = { x: 2, z: -47.5 + S, sx: 1.15, R: 6.0, base: 0.5, top: 4.0, floor: -5.6 };   // the headland stone
export const CHAMBER = { x: 2, y: -1.0, z: -49.0 + S, r: 3.8 };                                   // the air chamber
export const TUNNEL = { x: 2, y: -2.4, r: 1.1, z0: -41.2 + S, z1: -47.6 + S };                    // under the lip
export const LEDGE = { top: 0.1, dz: -1.5 };                                                      // dry shelf at the back
export const CRACK = { x: 2.6, z: -48.4 + S, r: 0.32 };                                           // daylight through a crack in the roof (too narrow for a person)

const ss = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
// shoreline radius at angle th (from the cove's middle, x = sin, z = cos), with a few slow wobbles
export function shoreR(th) {
  const e = 1 / Math.hypot(Math.sin(th) / COVE.a, Math.cos(th) / COVE.b);
  return e * (1 + 0.09 * Math.sin(3 * th + 0.7) + 0.05 * Math.sin(5 * th + 2.1));
}
// metres inside the shoreline (negative = outside on land)
export function inside(x, z) {
  const dx = x - COVE.x, dz = z - COVE.z, th = Math.atan2(dx, dz);
  return shoreR(th) - Math.hypot(dx, dz);
}
export function shoreline(n = 96, grow = 0) {
  const out = []; for (let i = 0; i < n; i++) { const th = (i / n) * Math.PI * 2, r = shoreR(th) + grow; out.push([COVE.x + Math.sin(th) * r, COVE.z + Math.cos(th) * r]); }
  return out;
}
// the open-air ground of the cove: bank sloping to the water's edge, then the bed shelving to full depth
export function coveGround(x, z) {
  const d = inside(x, z);
  if (d < -COVE.bank) return null;                      // not the cove: the world's own ground
  const edge = COVE.sea + 0.08;
  if (d < 0) return edge * ss(-COVE.bank, 0, d);
  const bed = edge - COVE.depth * ss(0, 5.5, d);
  // a deep channel scoured along the bed to the tunnel mouth under the headland
  const k = (1 - ss(1.4, 2.6, Math.abs(x - TUNNEL.x))) * (1 - ss(TUNNEL.z0 + 1, TUNNEL.z0 + 7, z));
  return Math.min(bed, bed + (TUNNEL.y - TUNNEL.r - 0.1 - bed) * k);
}
// ---- the headland stone: an elliptic river stone, vertical sides below 'base', a dome above
const hl = (x, z) => Math.hypot((x - HEAD.x) / HEAD.sx, z - HEAD.z);
export function headTop(x, z) {
  const e = hl(x, z); if (e >= HEAD.R) return null;
  return HEAD.base + (HEAD.top - HEAD.base) * Math.pow(1 - (e / HEAD.R) ** 2, 0.4545);
}
export function inCrack(x, z) { return Math.hypot(x - CRACK.x, z - CRACK.z) < CRACK.r; }
export function inChamber(x, y, z) { return Math.hypot(x - CHAMBER.x, y - CHAMBER.y, z - CHAMBER.z) < CHAMBER.r; }
export function inTunnel(x, y, z) { return z < TUNNEL.z0 && z > TUNNEL.z1 && Math.hypot(x - TUNNEL.x, y - TUNNEL.y) < TUNNEL.r; }
const onLedge = (x, z) => z - CHAMBER.z < LEDGE.dz;
export function inCave(x, y, z) { return (inChamber(x, y, z) && !(onLedge(x, z) && y < LEDGE.top)) || inTunnel(x, y, z); }
export function headSolid(x, y, z) {
  const t = headTop(x, z); if (t == null || y > t || y < HEAD.floor) return false;
  return !inCave(x, y, z);
}
// the floor under a point inside the cave (chamber bowl, the ledge, the tunnel), or null
function caveFloor(x, z, y) {
  let best = null;
  const dc = Math.hypot(x - CHAMBER.x, z - CHAMBER.z);
  if (dc < CHAMBER.r) {
    const lo = CHAMBER.y - Math.sqrt(CHAMBER.r ** 2 - dc * dc), hi = CHAMBER.y + Math.sqrt(CHAMBER.r ** 2 - dc * dc);
    if (y < hi && y >= lo - 0.05) best = onLedge(x, z) ? LEDGE.top : lo;
  }
  if (z < TUNNEL.z0 && z > TUNNEL.z1 && Math.abs(x - TUNNEL.x) < TUNNEL.r) {
    const h = Math.sqrt(TUNNEL.r ** 2 - (x - TUNNEL.x) ** 2), lo = TUNNEL.y - h, hi = TUNNEL.y + h;
    if (y < hi && y >= lo - 0.05 && (best == null || lo > best)) best = lo;
  }
  return best;
}
// the surface under height y at (x, z), given the world's own ground there: what the walker stands on
export function coveTop(x, z, y, ground) {
  const cg = coveGround(x, z), base = cg == null ? ground : Math.min(ground, cg);
  const t = headTop(x, z); if (t == null) return base;
  if (y >= t) return t;
  const f = caveFloor(x, z, y);
  if (f != null) return f;
  return t; // inside the rock: its top
}
export const coveSolid = (x, y, z) => headSolid(x, y, z);
// still water: the cove itself, the tunnel and the chamber
export function wet(x, z) {
  if (inside(x, z) > 0.0 && headTop(x, z) == null) return true;
  if (z < TUNNEL.z0 + 0.6 && z > TUNNEL.z1 && Math.abs(x - TUNNEL.x) < TUNNEL.r + 0.2) return true;
  return Math.hypot(x - CHAMBER.x, z - CHAMBER.z) < CHAMBER.r;
}
// for places and the server: where a person is, in the chamber's air (above the water, under the roof)
export function inChamberAir(x, y, z) { return Math.hypot(x - CHAMBER.x, z - CHAMBER.z) < CHAMBER.r - 0.3 && y > COVE.sea - 1.2 && y < CHAMBER.y + CHAMBER.r; }
// The outline of everything carved out of the flat ground here (the cove with its bank, and the footprint of
// the headland, whose cave reaches above the lawn's level): rays from a point inside both, out to the last
// carved point. The ground mesh leaves this hole; the cove's own bed mesh fills it (at lawn level where uncut).
export const HOLE_C = { x: 2, z: -43 };
const carved = (x, z) => inside(x, z) > -(COVE.bank + 0.1) || hl(x, z) < HEAD.R - 0.2;
export function holeR(th) { let last = 0; for (let r = 0; r < 34; r += 0.1) if (carved(HOLE_C.x + Math.sin(th) * r, HOLE_C.z + Math.cos(th) * r)) last = r; return last; }
export function holeOutline(n = 160, grow = 0) {
  const out = []; for (let i = 0; i < n; i++) { const th = (i / n) * Math.PI * 2, r = holeR(th) + grow; out.push([HOLE_C.x + Math.sin(th) * r, HOLE_C.z + Math.cos(th) * r]); }
  return out;
}
// things on the shore (shared by the drawing and the server's extraction nodes): driftwood logs on the north
// beach and reed clumps on the west bank, placed by angle around the cove and distance out from the shoreline
const shoreAt = (th, out) => { const r = shoreR(th) + out; return { x: +(COVE.x + Math.sin(th) * r).toFixed(2), z: +(COVE.z + Math.cos(th) * r).toFixed(2) }; };
export const DRIFT = [[0.25, 0.9, 2.2, 0.16], [-0.35, 1.3, 1.6, 0.12], [0.6, 0.7, 1.2, 0.1]].map(([th, out, L, r]) => ({ ...shoreAt(th, out), th, L, r }));
export const REEDS = [-1.75, -1.95, -2.15].map((th) => ({ ...shoreAt(th, -0.2), th }));
