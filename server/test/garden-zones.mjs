// node server/test/garden-zones.mjs: the server's garden no-go zones match the client layout
import { gardenBlock, openGround } from '../src/garden.js';
let ok = 0, bad = 0; const t = (c, m) => { if (c) ok++; else { bad++; console.log('FAIL', m); } };
t(gardenBlock(10.2, 1.2) === 'pond', 'pond centre');
t(gardenBlock(-2.5, 0.5) === 'sand', 'sand centre');
t(gardenBlock(1.5, -7.2) === 'bonsai', 'bonsai');
t(gardenBlock(20, 2) === 'shed', 'shed');
t(gardenBlock(0, -12.6) === 'wall', 'wall');
t(gardenBlock(-3, 11) === 'beds', 'beds');
t(gardenBlock(0, 7) === 'path', 'path');
t(gardenBlock(15.02, -14.25, 3.8) === 'wall', 'old vault spot by the wall is blocked with its radius');
t(gardenBlock(10, -6) === null, 'open lawn east of the bonsai');
t(openGround({ x: 10.2, z: 1.2, tile: 'f1:3:4' }), 'other tiles are not the garden');
t(!openGround({ x: 10.2, z: 1.2, tile: null }), 'garden pond blocked');
const { WORLD_SPAWN } = await import('../../js/spawn.js');
const { gardenBlock: gb } = await import('../src/garden.js');
t(gb(WORLD_SPAWN.x, WORLD_SPAWN.z, 0.9) === 'spawn', 'the world spawn is open ground apart from its own arrival stone');
t(gb(-24, -36) === 'place:ruins' && gb(30, -34) === 'place:lookout', 'nothing gets placed inside the ruins or on the lookout hill');
console.log(`garden-zones: ${ok} ok, ${bad} failed`); process.exit(bad ? 1 : 0);
