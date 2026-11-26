// The garden's ground shapes as plain data and math (no three.js), so the server, the animals and the drawing code
// all read the same outline: js/pond.js draws the pond from these, js/sand.js the raked bed, and the server's
// spawn rules (server/src/garden.js) and walls (server/src/solids.js) use them as they are.

// Kidney / bean outline: elongated east-west, with a cove on the south-east
// (the side you see from the stepping stones). Polar radius is metres from (cx, cz).
const CX = 10.2, CZ = 1.2, LEVEL = -0.12;
function angNorm(a) { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; }
export function pondRadius(theta) {
  const cove = Math.exp(-(angNorm(theta - 1.05) ** 2) / 0.24);
  return 3.15 + 0.52 * Math.cos(theta - 0.12) + 0.20 * Math.cos(2 * theta + 0.4) + 0.10 * Math.sin(3 * theta + 0.9) - 0.72 * cove;
}
export function pondContains(x, z, margin = 0) {
  const dx = x - CX, dz = z - CZ;
  return Math.hypot(dx, dz) < pondRadius(Math.atan2(dz, dx)) + margin;
}
export function pondDist(x, z) {
  const dx = x - CX, dz = z - CZ;
  return Math.hypot(dx, dz) - pondRadius(Math.atan2(dz, dx));
}
export function pondOutline(n = 96, extra = 0) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const th = (i / n) * Math.PI * 2, r = pondRadius(th) + extra;
    pts.push([CX + Math.cos(th) * r, CZ + Math.sin(th) * r, th, r]);
  }
  return pts;
}
const RMAX = (() => { let m = 0; for (let i = 0; i < 64; i++) m = Math.max(m, pondRadius((i / 64) * Math.PI * 2)); return m; })();
export const POND = { cx: CX, cz: CZ, r: RMAX, level: LEVEL, radius: pondRadius, contains: pondContains, dist: pondDist, outline: pondOutline };

export const SAND = { cx: -2.5, cz: 0.5, w: 13, d: 8.5 }; // metres: a residential karesansui bed
export const SAND_ROCKS = [
  { x: -6.26, z: -1.07, r: 1.13, seed: 11, sy: 0.85 },
  { x: -5.10, z: -0.22, r: 0.58, seed: 23, sy: 0.7 },
  { x: -5.72, z: -2.05, r: 0.39, seed: 31, sy: 0.6 },
  { x: 0.72, z: 2.00, r: 0.82, seed: 47, sy: 0.95 },
  { x: -2.57, z: 3.05, r: 0.47, seed: 59, sy: 0.6 },
];

// where walking stops at the pond: its outline plus the bank stones (a body keeps BODY.radius on top of this)
export const POND_BANK = 0.7;
export const GARDEN_WATER = { name: 'pond', sdf: (x, z) => pondDist(x, z) - POND_BANK };
