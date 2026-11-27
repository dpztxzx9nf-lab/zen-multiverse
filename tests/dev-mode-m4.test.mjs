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


// world model: a 0.9 m rifle at the shoulder, both hands IK'd, readable in third person
{
  const src = (p) => readFileSync(p, 'utf8');
const m4src = src('js/game/m4.js');
  const av = src('js/game/avatar/index.js');
  const st = src('js/game/rifle-state.js');
  ok(/export const RIFLE_LENGTH = /.test(m4src) && /0\.90/.test(m4src), 'the world rifle is authored at about 0.9 m');
  ok(m4src.includes('placeOnShoulder') && m4src.includes('clavicle_r'), 'the world rifle is placed at the right shoulder, not parented into the fist');
  ok(m4src.includes("av.reach('r'") && m4src.includes("av.reach('l'"), 'both hands are IK\'d to the grip and the foregrip');
  ok(!/av.attach\(slot.hold, 'hand_r'/.test(m4src), 'the world rifle is no longer attached to hand_r with the tool grip pose');
  ok(av.includes('rifleBusy()') && av.includes('placeOnShoulder') === false, 'the avatar asks for an aim pose when firing without playing the tool hold clip');
  ok(!av.includes("av.play('hold')") || av.includes("Do not play the one-handed tool"), 'the one-handed tool hold clip is not used for the rifle');
  ok(st.includes('export const rifleUseViewmodel = () => out && fp'), 'the viewmodel is only used in first person; aiming stays in third person');
  ok(/frustumCulled = false/.test(m4src), 'the world-model gun is not frustum-culled');
}

console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
