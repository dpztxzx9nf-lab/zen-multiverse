// The 0.2.34 world reset drops old voxel digs once, then keeps new ones.
import { WORLD_GEN } from '../js/world-gen.js';
import { readFileSync } from 'node:fs';
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
ok(WORLD_GEN === 34, 'WORLD_GEN is 34');
const sb = readFileSync(new URL('../js/game/g7/sandbox.js', import.meta.url), 'utf8');
ok(/rec\.gen \|\| 0\) < WORLD_GEN/.test(sb) && /rec\.vox = \{\}/.test(sb), 'the client drops voxel diffs from an older generation');
const w = readFileSync(new URL('../server/src/world.js', import.meta.url), 'utf8');
ok(/wipeStaleTerrain\(this\.sql\)/.test(w), 'the live world runs the wipe on boot');
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
