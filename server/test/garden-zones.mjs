// node server/test/garden-zones.mjs: the server's garden no-go zones come from the garden itself (js/garden-rules.js:
// its baked solids, its pond / sand / path / bed shapes), the same rule the animals use
import { gardenBlock, openGround } from '../src/garden.js';
let ok = 0, bad = 0; const t = (c, m) => { if (c) ok++; else { bad++; console.log('FAIL', m); } };
t(gardenBlock(10.2, 1.2) === 'pond', 'pond centre');
t(gardenBlock(-2.5, 0.5) === 'sand', 'sand centre');
t(gardenBlock(1.5, -7.2) === 'bonsai', 'bonsai');
const { SOLIDS } = await import('../../js/solids-data.js'), { cellBits } = await import('../../js/solids.js');
const onIt = (name) => { const c = SOLIDS.garden.find((g) => g.name === name); const b = cellBits({ ...c }); const k = b.indexOf(1); return [c.x0 + (k % c.nx + 0.5) * c.cs, c.z0 + (Math.floor(k / c.nx) + 0.5) * c.cs]; };
t(gardenBlock(...onIt('shed')) === 'shed', 'a spot on the shed\'s own wall');
t(gardenBlock(20, 2.6) === null, 'inside the open shed is open ground (it is open at the front)');
for (const n of ['wall', 'ruin', 'clipped azaleas', 'shore stone']) t(gardenBlock(...onIt(n)) === n, `a spot on the ${n} (from its baked mesh)`);
t(gardenBlock(0, -12.6) === 'wall', 'wall');
t(gardenBlock(-3, 11) === 'beds', 'beds');
t(gardenBlock(0, 7) === 'path', 'path');
t(gardenBlock(15.02, -14.25, 3.8) !== null, 'old vault spot by the wall is blocked with its radius');
t(gardenBlock(10, -6) === null, 'open lawn east of the bonsai');
t(openGround({ x: 10.2, z: 1.2, tile: 'f1:3:4' }), 'other tiles are not the garden');
t(!openGround({ x: 10.2, z: 1.2, tile: null }), 'garden pond blocked');
const { WORLD_SPAWN } = await import('../../js/spawn.js');
const { gardenBlock: gb } = await import('../src/garden.js');
t(gb(WORLD_SPAWN.x, WORLD_SPAWN.z, 0.9) === 'spawn', 'the world spawn is open ground apart from its own arrival stone');
t(gb(-24, -36) !== null && gb(30, -34) === 'place:lookout', 'nothing gets placed inside the ruins or on the lookout hill');
const { walkable } = await import('../../js/fauna.js');
t(!walkable(...onIt('shed')) && !walkable(10.2, 1.2) && walkable(22, -12), 'the animals keep to the same rule (no walking through the shed wall or the pond)');
console.log(`garden-zones: ${ok} ok, ${bad} failed`); process.exit(bad ? 1 : 0);
