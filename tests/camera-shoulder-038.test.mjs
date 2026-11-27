// 0.2.38: the third-person camera sits far enough over the right shoulder that a held gun is visible.
import { readFileSync } from 'node:fs';

const ok = (c, m) => { if (!c) throw new Error(m); passed++; };
let passed = 0;
const src = readFileSync('js/game/avatar/camera.js', 'utf8');
ok(/0\.82 \* sh \* blend/.test(src), 'the over-the-shoulder side offset is wide enough to show the gun');
ok(/zen\.state\.shoulder === 'left' \? -1 : 1/.test(src), 'right is still the default shoulder');
ok(/settings\.camera\.shoulder/.test(readFileSync('js/game/settings.js', 'utf8')) || /shoulder: 'right'/.test(readFileSync('js/game/settings.js', 'utf8')), 'settings default to the right shoulder');
console.log(`ok ${passed} camera-shoulder-038`);
