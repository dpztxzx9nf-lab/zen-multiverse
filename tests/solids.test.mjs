// node tests/solids.test.mjs : the shared collision shapes (js/solids.js) that client and server both use
import { shapeDist, crossesSolid, cellsFrom, cellsToJSON, cellsDist, placeShapes, VAULT, vaultBlocks, vaultShapes, BODY } from '../js/solids.js';
import { createColliders } from '../js/colliders.js';
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;

// a box turned like three.js turns a mesh (rotation.y = +90deg sends local +x to world -z)
{ const b = { type: 'box', x: 0, z: 0, hw: 2, hd: 0.25, ry: Math.PI / 2 };
  ok(shapeDist(b, 0, -1.9) < 0 && shapeDist(b, 1.9, 0) > 0, 'box rotation matches three.js (long side along world z after +90deg)');
  ok(near(shapeDist(b, 1, 0), 0.75), 'box distance from the side is exact'); }
// placeShapes uses the same convention
{ const [p] = placeShapes([{ type: 'box', x: 1, z: 0, hw: 0.1, hd: 0.1 }], 0, 0, Math.PI / 2);
  ok(near(p.x, 0) && near(p.z, -1), 'placeShapes turns local +x to world -z at +90deg, like three.js'); }

// occupancy grids: a closed ring of thin walls fills; a U shape stays open
const wall = (x0, z0, x1, z1) => [[x0, z0], [x1, z1], [x1 + 1e-3, z1 + 1e-3]];
{ const ring = cellsFrom([wall(0, 0, 4, 0), wall(4, 0, 4, 4), wall(4, 4, 0, 4), wall(0, 4, 0, 0)]);
  ok(cellsDist(ring, 2, 2) < 0, 'a closed room of thin walls is solid inside (no standing in a sealed box)');
  ok(cellsDist(ring, 5, 2) > 0.5, 'and open outside');
  const u = cellsFrom([wall(0, 0, 4, 0), wall(4, 0, 4, 4), wall(0, 4, 0, 0)]);
  ok(cellsDist(u, 2, 2) > 0.5, 'a U-shaped wall (open front) stays walkable inside');
  ok(cellsDist(u, 2, 0) <= 0.05, 'its back wall itself is solid');
  const j = cellsToJSON(u), back = { ...j }; ok(typeof j.bits === 'string', 'grids serialise to JSON (base64) for the server');
  ok(near(cellsDist(back, 2, 2), cellsDist(u, 2, 2)) && near(cellsDist(back, 2, 0.02), cellsDist(u, 2, 0.02)), 'and read back identically'); }

// walking: the sweep can't tunnel a thin wall even in one huge frame
{ const c = createColliders(); c.add({ ...cellsFrom([wall(0, -3, 0, 3)]), name: 'panel' });
  const p = { x: 3, z: 0 }; c.sweep(-3, 0, p, BODY.radius);
  ok(p.x < 0, `a 3 m/frame step stops at a 1 cm panel (x=${p.x.toFixed(2)})`);
  ok(crossesSolid(c.list, { x: -3, z: 0 }, { x: 3, z: 0 }) && !crossesSolid(c.list, { x: -3, z: 0 }, { x: -3, z: 2 }), 'crossesSolid: through the wall yes, along it no'); }

// the vault: the stones the client draws are the shapes both sides block on
{ const blocks = vaultBlocks(), shapes = vaultShapes();
  ok(blocks.length === VAULT.n - 1, 'vault ring has a doorway gap');
  ok(shapes.filter((s) => s.name === 'vault-wall').length === blocks.length && shapes.some((s) => s.name === 'vault-slab'), 'every drawn stone and the slab are solid');
  const P = placeShapes(shapes, 10, 20, 0), at = (x, z) => ({ x: 10 + x, z: 20 + z });
  ok(crossesSolid(P, at(0, 0), at(5, 0)), 'shut slab: walking out the door is refused');
  ok(!crossesSolid(placeShapes(vaultShapes({ slabShut: false }), 10, 20, 0), at(0, 0), at(5, 0)), 'slab up: out the door is fine');
  ok(crossesSolid(P, at(0, 0), at(0, 5)) && crossesSolid(P, at(0, 0), at(-5, 0)), 'the side and back walls are solid');
  ok(!crossesSolid(placeShapes(vaultShapes({ tunnel: true }), 10, 20, 0), at(0, 0), at(-5, 0)), 'the dug tunnel opens the back wall only');
  // no gap between neighbouring stones a body could squeeze through
  let gap = 0; for (let a = 0.6; a < Math.PI * 2 - 0.6; a += 0.01) { const d = Math.min(...shapes.map((s) => shapeDist(s, Math.cos(a) * VAULT.R, Math.sin(a) * VAULT.R))); if (d > 0) gap = Math.max(gap, d); }
  ok(gap < BODY.radius, `no squeeze-through gaps between the stones (widest ${gap.toFixed(2)} m)`); }

if (fails) { console.log(`${fails} FAILED`); process.exit(1); }
