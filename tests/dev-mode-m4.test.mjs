// The M4 is no longer parented to the walk camera (that looked glued to the
// screen). First person is a dedicated viewmodel with its own camera / FOV and
// procedural motion; third person uses a world model on the rig.
import { readFileSync } from 'node:fs';
import { REST, SPRINT, createMotion, stepMotion, VM_FOV } from '../js/game/viewmodel-motion.js';

let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const near = (a, b, e = 1e-4) => Math.abs(a - b) <= e;

ok(VM_FOV >= 45 && VM_FOV <= 70, 'viewmodel FOV is a dedicated, tighter lens than a typical world camera');
ok(REST.z < 0 && SPRINT.z < 0, 'the rifle sits in front of the viewmodel camera');
ok(SPRINT.y < REST.y && SPRINT.x > REST.x, 'the sprint pose drops the rifle and carries it off to the side');

const idle = createMotion();
const p0 = stepMotion(idle, { dt: 1 / 60, speed: 0, yaw: 0, pitch: 0 });
ok(near(p0.x, REST.x, 0.02) && near(p0.y, REST.y, 0.02), 'at rest the pose stays near the hip-fire hold');

// idle sway is a slow wander, not zero
let maxSway = 0;
const sw = createMotion();
for (let i = 0; i < 180; i++) {
  const p = stepMotion(sw, { dt: 1 / 60, speed: 0, yaw: 0, pitch: 0 });
  maxSway = Math.max(maxSway, Math.abs(p.x - REST.x), Math.abs(p.y - REST.y));
}
ok(maxSway > 0.002 && maxSway < 0.04, 'idle sway is a small wander, not a static overlay');

// walk bob is larger than idle sway in Y
const walk = createMotion();
let maxBob = 0;
for (let i = 0; i < 180; i++) {
  const p = stepMotion(walk, { dt: 1 / 60, speed: 5, yaw: 0, pitch: 0 });
  maxBob = Math.max(maxBob, Math.abs(p.y - REST.y));
}
ok(maxBob > maxSway, 'walk bob moves the rifle more than idle sway');

// turn lag: a sudden yaw leaves the rifle behind, then it settles
const lag = createMotion();
stepMotion(lag, { dt: 1 / 60, yaw: 0, pitch: 0 });
const turned = stepMotion(lag, { dt: 1 / 60, yaw: 0.4, pitch: 0 });
ok(turned.ry < REST.ry, 'a right turn lags the rifle so it trails the new heading');
let settled = turned;
for (let i = 0; i < 90; i++) settled = stepMotion(lag, { dt: 1 / 60, yaw: 0.4, pitch: 0 });
ok(Math.abs(settled.ry - REST.ry) < Math.abs(turned.ry - REST.ry), 'turn lag eases back out when the heading holds still');

// recoil kick pitches the rifle up, then decays
const rec = createMotion();
const kicked = stepMotion(rec, { dt: 1 / 60, yaw: 0, pitch: 0, kick: 0.03 });
ok(kicked.rx > REST.rx, 'recoil kick pitches the viewmodel up');
let after = kicked;
for (let i = 0; i < 90; i++) after = stepMotion(rec, { dt: 1 / 60, yaw: 0, pitch: 0, kick: 0 });
ok(after.rx < kicked.rx, 'recoil kick decays after the shot');

// sprint pose
const sp = createMotion();
let sprintPose;
for (let i = 0; i < 90; i++) sprintPose = stepMotion(sp, { dt: 1 / 60, speed: 8, yaw: 0, pitch: 0, sprinting: true });
ok(sprintPose.x > REST.x && sprintPose.y < REST.y, 'sprinting blends toward the lowered sprint pose');


// world model: the gun stays in the right hand with the hold pose (idle left it hanging at the hip)
{
  const src = (p) => readFileSync(p, 'utf8');
  const av = src('js/game/avatar/index.js');
  ok(av.includes("heldPose !== 'hold'") && av.includes("av.play('hold')"), 'the world M4 keeps the right-arm hold pose so the gun sits in the hand, not hanging at the hip');
  const m4 = src('js/game/m4.js');
  ok(/frustumCulled = false/.test(m4) && /av.attach\(slot.hold, 'hand_r'/.test(m4), 'the world-model gun is attached to the right hand and is not frustum-culled off the bone');
}

console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
