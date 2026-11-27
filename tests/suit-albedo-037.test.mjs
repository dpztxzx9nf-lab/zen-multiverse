// 0.2.37: the space-suit shell was blowing out to flat white under painted sun + ACES.
import { readFileSync } from 'node:fs';

const ok = (c, m) => { if (!c) throw new Error(m); passed++; };
let passed = 0;
const rig = readFileSync('js/game/avatar/rig.js', 'utf8');
ok(rig.includes('mix(1.0, 0.62, shell)'), 'the suit shell albedo is compressed so folds stay visible');
ok(rig.includes('#define ZM_RIMK 0.16'), 'the painted sun rim is reduced on the suit');
ok(/roughness = 0\.82/.test(rig), 'the suit is rougher than a blown-out plastic');
console.log(`ok ${passed} suit-albedo-037`);
