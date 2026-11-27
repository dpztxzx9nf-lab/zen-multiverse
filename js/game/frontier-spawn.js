// A walkable spawn in a frontier biome (Rustmesa forest or Shatter Coast), used
// instead of the old greybox city plaza. Pure in (W, near) -> {x,z,y,yaw,tile,biome}.
const PREFER = ['forest', 'shore', 'salt'];

export function pickFrontierSpawn(W, near = { x: 294.21, z: 222.02 }, tile = '1:1:1') {
  if (!W || !W.height || !W.dominant) return { x: near.x, z: near.z, y: 8, yaw: 0, tile, biome: 'forest' };
  const sea = W.hasSea ? W.sea : -1e9;
  const tried = [];
  for (const want of PREFER) {
    for (let r = 80; r <= 420; r += 30) {
      const n = Math.max(8, Math.round(r / 16));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + 0.7;
        const x = near.x + Math.sin(a) * r, z = near.z + Math.cos(a) * r;
        const y = W.height(x, z);
        if (!(y > sea + 2.5)) continue;
        const slope = Math.abs(W.height(x + 4, z) - W.height(x - 4, z)) + Math.abs(W.height(x, z + 4) - W.height(x, z - 4));
        if (slope > 2.8) continue;
        const b = String(W.dominant(W.biomesAt(x, z, y)) || '');
        tried.push(b);
        if (b !== want) continue;
        const yaw = Math.atan2(near.x - x, near.z - z);
        return { x, z, y, yaw, tile: W.tile || tile, biome: b };
      }
    }
  }
  const y = W.height(near.x, near.z);
  return { x: near.x, z: near.z, y, yaw: 0, tile: W.tile || tile, biome: tried[0] || 'forest' };
}
