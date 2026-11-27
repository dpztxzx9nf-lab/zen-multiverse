// 0.2.38: a Rattler camp always has 3–5 people who notice by sight or noise, take cover and flank.
import { campRoster, canSee, canHear, pickCover, flankPoint, stepToward, SIGHT_RANGE, coverPoints } from '../js/game/rattlers.js';
import { hash } from '../js/game/guns.js';

const ok = (c, m) => { if (!c) throw new Error(m); passed++; };
let passed = 0;

const a = campRoster(1, 2, 3);
const b = campRoster(1, 2, 3);
ok(a.length === b.length && a[0].dx === b[0].dx, 'the same camp seed always spawns the same roster');
ok(a.length >= 3 && a.length <= 5, 'a camp has 3 to 5 Rattlers');
const sizes = new Set();
for (let i = 0; i < 30; i++) sizes.add(campRoster(hash(i), 0, i).length);
ok(sizes.has(3) && sizes.has(4) && sizes.has(5), 'different camps can be 3, 4 or 5 strong');

const me = { x: 0, z: 0 };
ok(canSee(me, { x: 0, z: 10 }, 0), 'a Rattler sees someone in front of them');
ok(!canSee(me, { x: 0, z: 10 }, Math.PI), 'they do not see someone behind them');
ok(!canSee(me, { x: 0, z: SIGHT_RANGE + 5 }, 0), 'sight has a limited range');
ok(canHear(me, { x: 10, z: 0 }, 20), 'a nearby gunshot is heard');
ok(!canHear(me, { x: 80, z: 0 }, 20), 'a far gunshot is not heard');

const pts = coverPoints(0, 0);
ok(pts.length >= 4, 'a camp has cover points around its rooms');
const cover = pickCover({ x: 8, z: 8 }, { x: 0, z: 0 }, pts);
ok(Number.isFinite(cover.x) && Number.isFinite(cover.z), 'they pick a cover point when they notice you');
const fl = flankPoint({ x: 8, z: 0 }, { x: 0, z: 0 }, pts);
ok(Math.abs(fl.z) > 1 || Math.abs(fl.x + 8) > 1, 'a flank point is not the same spot they already stand in');

const step = stepToward({ x: 0, z: 0, yaw: 0 }, { x: 10, z: 0 }, 1, 3.2);
ok(step.x > 0 && Math.abs(step.z) < 0.01 && step.x <= 3.2, 'they walk toward cover at a walking pace');

console.log(`ok ${passed} rattlers-038`);
