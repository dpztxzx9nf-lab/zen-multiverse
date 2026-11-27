// Cave systems, the Hollow, and ores by depth. Pure functions of (x, y, z, seed, surfaceY)
// so the mesher, the walker and the tests all see the same ground. City / POI ground can
// pass blocked() to keep cave mouths from opening under it.
const fl = Math.floor;
const h3 = (x, y, z, s) => { let h = (x * 374761393 + y * 668265263 + z * 2147483647 + s * 1442695041) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
function vnoise3(x, y, z, s) {
  const xi = fl(x), yi = fl(y), zi = fl(z), fx = x - xi, fy = y - yi, fz = z - zi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const L = (a, b, t) => a + (b - a) * t;
  return L(L(L(h3(xi, yi, zi, s), h3(xi + 1, yi, zi, s), u), L(h3(xi, yi + 1, zi, s), h3(xi + 1, yi + 1, zi, s), u), v),
    L(L(h3(xi, yi, zi + 1, s), h3(xi + 1, yi, zi + 1, s), u), L(h3(xi, yi + 1, zi + 1, s), h3(xi + 1, yi + 1, zi + 1, s), u), v), w);
}

// 0 = solid, 1 = fully open. A thin roof is kept so the surface doesn't collapse everywhere.
export function caveOpen(x, y, z, seed, surfaceY, blocked) {
  const depth = surfaceY - y;
  if (depth < 1.6 || depth > 90) return 0;
  if (blocked && blocked(x, z) && depth < 14) return 0; // no mouths under the city, garden or landmarks
  // winding tunnels
  const tunnels = vnoise3(x * 0.035, y * 0.05, z * 0.035, seed + 41);
  const tunnels2 = vnoise3(x * 0.08, y * 0.07, z * 0.08, seed + 43);
  const worm = 1 - Math.abs(tunnels * 2 - 1);
  let open = 0;
  if (worm > 0.78 && tunnels2 > 0.32) open = Math.max(open, (worm - 0.78) / 0.22);
  // big Hollow caverns deeper down
  if (depth > 18) {
    const cavern = vnoise3(x * 0.012, y * 0.02, z * 0.012, seed + 47);
    if (cavern > 0.62) open = Math.max(open, (cavern - 0.62) / 0.25);
  }
  // rarer mouths near the surface so you can walk in
  if (depth < 8) {
    const mouth = vnoise3(x * 0.02, y * 0.04, z * 0.02, seed + 53);
    if (mouth > 0.88) open = Math.max(open, (mouth - 0.88) / 0.12);
    else open *= depth > 4 ? 1 : (depth - 1.6) / 2.4;
  }
  return Math.max(0, Math.min(1, open));
}

export function inHollow(x, y, z, seed, surfaceY) {
  const depth = surfaceY - y;
  if (depth < 20) return false;
  return vnoise3(x * 0.012, y * 0.02, z * 0.012, seed + 47) > 0.55;
}

// Minecraft-style depth bands. Each ore has a purpose on the Xenia loop (guns, parts, Resonite).
// Returns a MAT id from materials.js, or 0 to keep the base stone/soil.
export const ORE_TABLE = [
  { id: 'scrap', mat: 9, minD: 2, maxD: 12, rare: 0.84, purpose: 'Common gun and tool parts' },
  { id: 'ore', mat: 5, minD: 8, maxD: 28, rare: 0.88, purpose: 'Smelted into Halvorsen parts and metal tools' },
  { id: 'crystal', mat: 6, minD: 10, maxD: 32, rare: 0.90, purpose: 'Glasswood plates and Choirworks energy cells' },
  { id: 'resonite', mat: 10, minD: 18, maxD: 55, rare: 0.91, purpose: 'Stores sound and energy for relic craft and claims' },
  { id: 'deep-resonite', mat: 11, minD: 40, maxD: 90, rare: 0.94, purpose: 'The loudest grade, used for Relic catalysts and the Bell' },
];

export function oreAt(x, y, z, seed, surfaceY) {
  const depth = surfaceY - y;
  if (depth < 2) return 0;
  // later bands overwrite earlier ones when they hit, so deeper ores can appear in their range
  let hit = 0;
  for (const o of ORE_TABLE) {
    if (depth < o.minD || depth > o.maxD) continue;
    const n = vnoise3(x * 0.19, y * 0.28, z * 0.19, seed + 60 + o.mat);
    if (n > o.rare) hit = o.mat;
  }
  return hit;
}
