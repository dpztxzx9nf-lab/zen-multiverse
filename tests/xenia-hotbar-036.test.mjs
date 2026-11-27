// 0.2.36: the hotbar is hands, pick, axe, shovel, plus the M4 when Dev is on.
// Fire and Water are deleted, not hidden.
import { readFileSync } from 'node:fs';

const ok = (c, m) => { if (!c) throw new Error(m); passed++; };
let passed = 0;
const src = (p) => readFileSync(p, 'utf8');

const sim = src('js/game/sim/world.js');
ok(!/equip\.register\(\{ id: 'drill'/.test(sim), 'the fire drill is not registered as a hotbar item');
ok(!/equip\.register\(\{ id: 'skin'/.test(sim), 'the water skin is not registered as a hotbar item');
ok(!/label: 'fire'/.test(sim) && !/label: \(\) => 'water /.test(sim), 'Fire and Water labels are gone from the sim');
ok(!/t\.tools\.drill = 1/.test(sim) && !/t\.tools\.skin = 1/.test(sim), 'debug no longer grants the fire drill or water skin');

const craft = src('js/game/g7/craft.js');
ok(!/name: 'Fire drill'/.test(craft), 'the Fire drill recipe is gone');
ok(!/name: 'Water skin'/.test(craft), 'the Water skin recipe is gone');

const m4 = src('js/game/m4.js');
ok(/id:\s*'m4'/.test(m4) && /devOn\(\)/.test(m4), 'the M4 still registers only when Dev mode is on');

const sb = src('js/game/g7/sandbox.js');
ok(/const BAR = \['hands', 'pick', 'axe', 'shovel'\]/.test(sb), 'the kept tools are still hands, pick, axe and shovel');

console.log(`ok ${passed}`);
