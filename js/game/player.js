// The walking player: input (keyboard + joystick + drag-look), movement with colliders, gravity and
// jumps (low gravity on the moon), the character's animation, and a smooth third-person follow camera.
//   const pl = createPlayer({ scene, camera, hud, P, colliders, ground: (x, z) => y, gravity, start })
//   pl.update(dt) each frame (movement); pl.updateCamera(dt, { lift }) to drive the camera
import * as THREE from 'three';
import { createCharacter } from './character.js';

const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const wrap = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };

// one shared keyboard (all worlds)
const keys = new Set();
const keyHandlers = new Map();
let keyboardBound = false;
function bindKeyboard() {
  if (keyboardBound) return; keyboardBound = true;
  addEventListener('keydown', (e) => {
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    if (!e.repeat) { const h = keyHandlers.get(e.code); if (h) { h(e); } }
    keys.add(e.code);
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
  });
  addEventListener('keyup', (e) => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());
}
export function onKey(code, fn) { bindKeyboard(); keyHandlers.set(code, fn); }
export const keyDown = (c) => keys.has(c);

export function createPlayer({ scene, camera, hud, P, colliders = null, ground = () => 0, gravity = 9.81, start = { x: 0, z: 0, yaw: 0 }, bounds = null, radius = 0.28, walk = 1.45, run = 3.4, jumpV = 3.3, palette, solidKinds = ['solid', 'water'] }) {
  bindKeyboard();
  const ch = createCharacter({ palette });
  scene.add(ch.group);
  const pos = new THREE.Vector3(start.x, ground(start.x, start.z), start.z);
  const vel = new THREE.Vector3();
  let vy = 0, airborne = false, heading = start.yaw || 0, speed = 0;
  // camera orbit (yaw around the player, pitch looking down a little)
  const cam = { yaw: heading + Math.PI, pitch: 0.2, dist: P.cls === 'phone' ? 4.4 : 4.0, lastLook: -10, t: 0 };
  const camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), tmp = new THREE.Vector3();
  let firstCam = true;
  let gesture = null, gestureT = 0, gestureDur = 0, gestureDone = null;
  let lock = 0; // movement locked while kneeling/watering
  let jumpQueued = false;
  let enabled = true;

  let virtual = null; // tests: { x, y, runK }
  function input() {
    if (virtual) return virtual;
    let x = 0, y = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) y += 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) y -= 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) x -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) x += 1;
    let l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; }
    let runK = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 1 : 0;
    if (hud && (hud.joy.x || hud.joy.y)) {
      x = hud.joy.x; y = hud.joy.y; l = Math.hypot(x, y);
      if (l < 0.12) { x = y = 0; } // dead zone
      runK = Math.max(0, (l - 0.75) / 0.25); // push to the rim to hurry
    }
    return { x, y, runK };
  }

  function update(dt) {
    cam.t += dt;
    const inp = enabled && lock <= 0 ? input() : { x: 0, y: 0, runK: 0 };
    if (lock > 0) lock -= dt;
    // camera-relative movement
    const fwdYaw = cam.yaw + Math.PI; // the direction the camera looks
    const mx = Math.sin(fwdYaw) * inp.y + Math.sin(fwdYaw - Math.PI / 2) * inp.x;
    const mz = Math.cos(fwdYaw) * inp.y + Math.cos(fwdYaw - Math.PI / 2) * inp.x;
    const ml = Math.hypot(mx, mz);
    const target = ml > 0.01 ? (walk + (run - walk) * inp.runK) * Math.min(1, ml) : 0;
    const accel = airborne ? 2.2 : 9;
    const tvx = ml > 0.01 ? (mx / ml) * target : 0, tvz = ml > 0.01 ? (mz / ml) * target : 0;
    vel.x = damp(vel.x, tvx, accel, dt); vel.z = damp(vel.z, tvz, accel, dt);
    pos.x += vel.x * dt; pos.z += vel.z * dt;
    if (colliders) colliders.resolve(pos, radius, solidKinds);
    if (bounds) {
      const dx = pos.x - bounds.cx, dz = pos.z - bounds.cz, d = Math.hypot(dx, dz);
      if (d > bounds.r) { pos.x = bounds.cx + (dx / d) * bounds.r; pos.z = bounds.cz + (dz / d) * bounds.r; }
    }
    // gravity + jumping
    const gy = ground(pos.x, pos.z);
    if (jumpQueued && !airborne && lock <= 0) { vy = jumpV; airborne = true; }
    jumpQueued = false;
    if (airborne || pos.y > gy + 0.02) {
      vy -= gravity * dt; pos.y += vy * dt;
      if (pos.y <= gy) { pos.y = gy; vy = 0; airborne = false; }
      else airborne = true;
    } else {
      // follow the ground smoothly (steps up/down gently)
      pos.y = damp(pos.y, gy, 18, dt);
      if (pos.y > gy + 0.25) airborne = true;
    }
    speed = Math.hypot(vel.x, vel.z);
    if (speed > 0.15) heading += wrap(Math.atan2(vel.x, vel.z) - heading) * (1 - Math.exp(-10 * dt));
    ch.group.position.copy(pos);
    ch.group.rotation.y = heading;
    if (gesture) {
      gestureT += dt;
      if (gestureT >= gestureDur) { const done = gestureDone; gesture = null; gestureDone = null; if (done) done(); }
    }
    ch.update(dt, { speed, airborne, gesture, gestureT, vy });
    ch.group.updateMatrixWorld();
    // the camera slowly swings behind her while she walks (unless the user is steering the view)
    if (speed > 0.3 && cam.t - cam.lastLook > 1.2) {
      const behind = heading + Math.PI;
      cam.yaw += wrap(behind - cam.yaw) * (1 - Math.exp(-0.55 * dt * Math.min(1, speed / 1.4)));
    }
  }

  // ---- camera: orbit around a point at her shoulders, kept out of walls and above the ground
  const marchKinds = ['solid'];
  function updateCamera(dt, { lift = 0, fovPortrait = false, minY = 0.35 } = {}) {
    const pivot = tmp.set(pos.x, pos.y + 1.35, pos.z);
    const pitch = cam.pitch;
    const cp = Math.cos(pitch);
    let d = cam.dist;
    const dir = new THREE.Vector3(Math.sin(cam.yaw) * cp, Math.sin(pitch), Math.cos(cam.yaw) * cp);
    // pull in if something tall is in the way
    if (colliders) {
      for (let s = 0.6; s <= cam.dist; s += 0.2) {
        const px = pivot.x + dir.x * s, pz = pivot.z + dir.z * s, py = pivot.y + dir.y * s;
        if (colliders.distanceH && colliders.distanceH(px, pz, py, marchKinds) < 0.25) { d = Math.max(0.6, s - 0.25); break; }
      }
    }
    const want = new THREE.Vector3().copy(pivot).addScaledVector(dir, d);
    const gy = ground(want.x, want.z) + minY;
    if (want.y < gy) want.y = gy;
    if (firstCam) { camPos.copy(want); firstCam = false; }
    else camPos.lerp(want, 1 - Math.exp(-7 * dt));
    camLook.set(pivot.x, pivot.y - 0.05, pivot.z);
    camera.position.copy(camPos);
    camera.lookAt(camLook);
    if (lift) camera.rotateX(lift);
    void fovPortrait;
  }

  return {
    character: ch, position: pos, cam,
    get heading() { return heading; }, get speed() { return speed; }, get airborne() { return airborne; },
    get busy() { return lock > 0 || !!gesture; },
    update, updateCamera,
    look(dx, dy) { cam.yaw -= dx; cam.pitch = THREE.MathUtils.clamp(cam.pitch + dy, -0.25, 1.1); cam.lastLook = cam.t; },
    zoom(k) { cam.dist = THREE.MathUtils.clamp(cam.dist * k, 2.2, 9); },
    jump() { jumpQueued = true; },
    // play a gesture; movement pauses for its length. resolves when done.
    act(name, dur = 1.4, faceTo = null) {
      if (faceTo) heading = Math.atan2(faceTo.x - pos.x, faceTo.z - pos.z);
      gesture = name; gestureT = 0; gestureDur = dur; lock = dur * 0.85;
      return new Promise((r) => { gestureDone = r; });
    },
    teleport(x, z, yaw = heading) { pos.set(x, ground(x, z), z); vel.set(0, 0, 0); heading = yaw; cam.yaw = yaw + Math.PI; firstCam = true; },
    setEnabled(on) { enabled = on; },
    // tests: walk with a fixed stick for `secs` of simulated time
    step(dt, x, y, runK = 0) { virtual = { x, y, runK }; update(dt); virtual = null; },
    sim(x, y, secs, runK = 0, dt = 1 / 30) { virtual = { x, y, runK }; for (let t = 0; t < secs; t += dt) update(dt); virtual = null; for (let k = 0; k < 20; k++) update(dt); },
    setCam(yaw, pitch = cam.pitch, dist = cam.dist) { cam.yaw = yaw; cam.pitch = pitch; cam.dist = dist; cam.lastLook = cam.t + 1e3; firstCam = true; },
    setVisible(on) { ch.group.visible = on; },
    snapCamera() { firstCam = true; },
    facingDot(p) { const dx = p.x - pos.x, dz = p.z - pos.z, l = Math.hypot(dx, dz) || 1; return (dx * Math.sin(heading) + dz * Math.cos(heading)) / l; },
  };
}
