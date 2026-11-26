// Representative solids the collision test walks into (tools/ci/collision.py). Read from the live collider
// list, so the test follows the content instead of a list of hand-copied numbers. For each tall baked solid:
// a point that is really solid (the grid cell nearest its middle) and how far out to start walking.
import { cellBits } from './solids.js';
export function walkTargets(w, max = 16) {
  const out = [], seen = new Set();
  const g = w.debug && [w.debug.game, w.debug.core].find((o) => o && o.player && o.player.colliders), pl = g && g.player, cols = pl && pl.colliders; // the garden's game or the planet's walker (Xenia)
  if (!cols) return out;
  for (const c of cols.list) {
    if (c.kind !== 'solid' || !c.src || seen.has(c.name) || (c.h || 0) < 1.0) continue;
    let x, z, r;
    if (c.type === 'cells') {
      const bits = cellBits(c), mx = c.x0 + (c.nx * c.cs) / 2, mz = c.z0 + (c.nz * c.cs) / 2; let best = Infinity;
      for (let j = 0; j < c.nz; j++) for (let i = 0; i < c.nx; i++) {
        if (!bits[j * c.nx + i]) continue;
        const cx = c.x0 + (i + 0.5) * c.cs, cz = c.z0 + (j + 0.5) * c.cs, d = Math.hypot(cx - mx, cz - mz);
        if (d < best) { best = d; x = cx; z = cz; }
      }
      r = Math.hypot(c.nx, c.nz) * c.cs / 2 + best;
    } else if (c.type === 'box' || c.type === 'circle') { x = c.x; z = c.z; r = c.type === 'box' ? Math.hypot(c.hw, c.hd) : c.r; }
    else continue;
    if (x == null) continue;
    seen.add(c.name);
    out.push({ name: c.name, x: +x.toFixed(2), z: +z.toFixed(2), d: +(r + 2).toFixed(2) });
    if (out.length >= max) break;
  }
  return out;
}
