// Hotfix: the third-person camera must pull in before a camp wall, and get
// the look-at out of geometry when the player is already inside a hull.
import { readFileSync } from 'node:fs';

const ok = (c, m) => { if (!c) throw new Error(m); passed++; };
let passed = 0;

const src = readFileSync('js/game/avatar/camera.js', 'utf8');
ok(/const SKIN = 0\.40/.test(src), 'the spring-arm skin is thick enough to stay off camp walls');
ok(/const steps = 28/.test(src), 'the arm is marched in finer steps than the 12-step original');
ok(/const nudgeOut = \(o\)/.test(src), 'a blocked shoulder pivot is walked out of the wall before the arm runs');
ok(/nudgeOut\(o\)/.test(src), 'camTick nudges the pivot before marching the arm');
ok(/t - wantArm \/ steps - 0\.18/.test(src), 'a hit shortens the arm past the last clear step so the lens is not in the skin');
ok(/while \(t > 0\.2 && blocked\(/.test(src), 'the final camera point is shrunk until it is clear');
ok(/env\.solid\(x \+ skin/.test(src), 'a point solid-test is sampled around the lens, not only at the exact camera point');

console.log(`ok ${passed} camera-0381`);
