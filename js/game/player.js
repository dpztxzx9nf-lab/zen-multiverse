// First-person walker: she is the camera, at real eye height, with no visible body.
// Keyboard + floating joystick to move, drag to look (lightly smoothed), eased acceleration, a very
// subtle head bob (G.settings.bob, ?bob=0), gravity and jumps, footstep callbacks per stride, and a
// gaze ray (gazeHit) used by the interactor: looking at a thing and tapping/clicking/E tends it.
//   const pl = createPlayer({ camera, hud, P, colliders, ground: (x, z) => y, gravity, start, onStep })
import * as THREE from 'three';

const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const wrap = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };

// one shared keyboard (all worlds)
const keys = new Set();
const keyHandlers = new Map();
let keyboardBound = false;
function bindKeyboard() {
  if (keyboardBound) return; keyboardBound = true;
  addEventListener('keydown', (e) => {
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName) && e.target.id !== 'haptic-surface') return;
    if (!e.repeat) { const h = keyHandlers.get(e.code); if (h) { h(e); } }
    keys.add(e.code);
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
  });
  addEventListener('keyup', (e) => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());
}
export function onKey(code, fn) { bindKeyboard(); keyHandlers.set(code, fn); }
export const keyDown = (c) => keys.has(c);

export const EYE = 1.6;
// lens: about 70° on a computer, 75° on a phone held upright (vertical field of view)
// the game's settings can widen it (view.fov = landscape degrees; portrait gets +5)
export const view = { fov: null };
export const fpFov = (w, h) => (view.fov ? view.fov + (h > w ? 5 : 0) : (h > w ? 75 : 70));
// remappable movement keys + gamepad sticks + look feel (the game's settings write these; defaults = the garden's)
export const moveKeys = { forward: ['KeyW', 'ArrowUp'], back: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'], run: ['ShiftLeft', 'ShiftRight'] };
export const pad = { x: 0, y: 0, run: 0, lx: 0, ly: 0 };
export const lookPrefs = { sens: 1, invertY: false, touchSens: 1, padSens: 1, padInvertY: false };
const anyKey = (list) => list.some((c) => keys.has(c));
export function clearKeyHandlers() { keyHandlers.clear(); }
const params = new URLSearchParams(location.search);
export const prefs = (() => { let p = {}; try { p = JSON.parse(localStorage.getItem('garden-prefs') || '{}'); } catch (e) { /* */ } if (params.get('bob') === '0') p.bob = false; if (p.bob === undefined) p.bob = true; return p; })();
export function setPref(k, v) { prefs[k] = v; try { localStorage.setItem('garden-prefs', JSON.stringify(prefs)); } catch (e) { /* */ } }

export function createPlayer({ camera, hud, P, colliders = null, ground = () => 0, gravity = 9.81, start = { x: 0, z: 0, yaw: 0 }, bounds = null, radius = 0.3, walk = 1.35, run = 3.0, jumpV = 3.3, solidKinds = ['solid', 'water'], onStep = null }) {
  bindKeyboard();
  const pos = new THREE.Vector3(start.x, ground(start.x, start.z), start.z);
  const vel = new THREE.Vector3();
  let vy = 0, airborne = false, speed = 0;
  // look: target angles (from input) and the smoothed ones the camera uses
  const look = { yaw: start.yaw || 0, pitch: -0.08, ty: start.yaw || 0, tp: -0.08 };
  const cam = { get yaw() { return look.yaw + Math.PI; }, get pitch() { return -look.pitch; }, t: 0 }; // legacy shape
  let firstCam = true, gestureDone = null, gestureT = 0, gestureDur = 0, gesture = null, lock = 0, jumpQueued = false, enabled = true;
  let eye = EYE, eyeTarget = EYE, bobPhase = 0, bobAmp = 0, strideAcc = 0, landT = 0;
  const holder = { holding: null };
  const character = {
    group: new THREE.Group(), head: new THREE.Group(), blob: null, height: EYE,
    get holding() { return holder.holding; }, hold(t) { holder.holding = t; },
    update() {},
    // where a held rake's tines would meet the ground: a little ahead of her feet
    rakeTip(out) { return out.set(pos.x + Math.sin(look.yaw) * 0.95, pos.y, pos.z + Math.cos(look.yaw) * 0.95); },
    // where water or a toss starts from: just below and in front of her eyes
    handWorld(out) { return out.set(pos.x + Math.sin(look.yaw) * 0.45, pos.y + eye - 0.45, pos.z + Math.cos(look.yaw) * 0.45); },
  };
  let virtual = null;
  function input() {
    if (virtual) return virtual;
    let x = 0, y = 0;
    if (anyKey(moveKeys.forward)) y += 1;
    if (anyKey(moveKeys.back)) y -= 1;
    if (anyKey(moveKeys.left)) x -= 1;
    if (anyKey(moveKeys.right)) x += 1;
    let l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; }
    let runK = anyKey(moveKeys.run) ? 1 : 0;
    if (pad.x || pad.y) { x = pad.x; y = pad.y; l = Math.hypot(x, y); runK = Math.max(pad.run, Math.max(0, (l - 0.92) / 0.08)); }
    if (hud && (hud.joy.x || hud.joy.y)) {
      x = hud.joy.x; y = hud.joy.y; l = Math.hypot(x, y);
      if (l < 0.14) { x = y = 0; }
      runK = Math.max(0, (l - 0.8) / 0.2);
    }
    return { x, y, runK };
  }
  function update(dt) {
    cam.t += dt;
    const inp = enabled && lock <= 0 ? input() : { x: 0, y: 0, runK: 0 };
    // right stick looks (rate-based: radians per second)
    if (enabled && (pad.lx || pad.ly)) { look.ty -= pad.lx * 2.6 * lookPrefs.padSens * dt; look.tp = THREE.MathUtils.clamp(look.tp - pad.ly * 1.9 * lookPrefs.padSens * (lookPrefs.padInvertY ? -1 : 1) * dt, -1.35, 1.3); }
    if (lock > 0) lock -= dt;
    const h = look.yaw;
    // forward is where she looks; strafing is a little slower, as it is on foot
    const mx = Math.sin(h) * inp.y - Math.cos(h) * inp.x * 0.8;
    const mz = Math.cos(h) * inp.y + Math.sin(h) * inp.x * 0.8;
    const ml = Math.hypot(mx, mz);
    const target = ml > 0.01 ? (walk + (run - walk) * inp.runK) * Math.min(1, ml) : 0;
    const tvx = ml > 0.01 ? (mx / ml) * target : 0, tvz = ml > 0.01 ? (mz / ml) * target : 0;
    // eased: gentle to start, a touch quicker to stop; little control in the air
    const k = airborne ? 1.2 : (target > speed ? 4.2 : 6.5);
    vel.x = damp(vel.x, tvx, k, dt); vel.z = damp(vel.z, tvz, k, dt);
    pos.x += vel.x * dt; pos.z += vel.z * dt;
    if (colliders) colliders.resolve(pos, radius, solidKinds);
    if (bounds) { const dx = pos.x - bounds.cx, dz = pos.z - bounds.cz, d = Math.hypot(dx, dz); if (d > bounds.r) { pos.x = bounds.cx + (dx / d) * bounds.r; pos.z = bounds.cz + (dz / d) * bounds.r; } }
    const gy = ground(pos.x, pos.z);
    if (jumpQueued && !airborne && lock <= 0) { vy = jumpV; airborne = true; }
    jumpQueued = false;
    if (airborne || pos.y > gy + 0.02) {
      vy -= gravity * dt; pos.y += vy * dt;
      if (pos.y <= gy) { pos.y = gy; if (airborne && vy < -1.5) { landT = 1; onStep && onStep(pos, 1.4); } vy = 0; airborne = false; } else airborne = true;
    } else { pos.y = damp(pos.y, gy, 14, dt); if (pos.y > gy + 0.3) airborne = true; }
    speed = Math.hypot(vel.x, vel.z);
    // strides: footstep sounds and the bob share one phase
    if (!airborne && speed > 0.25) {
      const stride = 0.68 + speed * 0.1;
      strideAcc += speed * dt;
      bobPhase += (speed * dt / stride) * Math.PI;
      if (strideAcc >= stride) { strideAcc -= stride; onStep && onStep(pos, Math.min(1.2, speed / walk)); }
    } else strideAcc = Math.min(strideAcc, 0.3);
    bobAmp = damp(bobAmp, !airborne && speed > 0.25 ? Math.min(1, speed / 2.2) : 0, 5, dt);
    landT = Math.max(0, landT - dt * 3);
    if (gesture) { gestureT += dt; if (gestureT >= gestureDur) { const d = gestureDone; gesture = null; gestureDone = null; eyeTarget = EYE; if (d) d(); } }
    eye = damp(eye, eyeTarget, 3.2, dt);
  }
  const fwd = new THREE.Vector3();
  function updateCamera(dt) {
    // light look smoothing (a head has a little inertia)
    const s = firstCam ? 1 : 1 - Math.exp(-20 * dt);
    look.yaw += wrap(look.ty - look.yaw) * s; look.pitch += (look.tp - look.pitch) * s;
    firstCam = false;
    let by = 0, bx = 0;
    if (prefs.bob) { by = Math.abs(Math.sin(bobPhase)) * 0.014 * bobAmp - landT * landT * 0.05; bx = Math.sin(bobPhase) * 0.006 * bobAmp; }
    const cx = Math.cos(look.yaw), sx = Math.sin(look.yaw);
    camera.position.set(pos.x + cx * bx, pos.y + eye + by, pos.z - sx * bx);
    fwd.set(Math.sin(look.yaw) * Math.cos(look.pitch), Math.sin(look.pitch), Math.cos(look.yaw) * Math.cos(look.pitch));
    camera.up.set(0, 1, 0);
    camera.lookAt(camera.position.x + fwd.x, camera.position.y + fwd.y, camera.position.z + fwd.z);
    if (prefs.bob && bobAmp > 0.01) camera.rotateZ(Math.sin(bobPhase) * 0.0025 * bobAmp);
  }
  // does her gaze rest on a thing? a vertical cylinder (radius gr, height gh) standing at a, within reach
  const E = new THREE.Vector3(), D = new THREE.Vector3();
  function gazeHit(a, gr = 0.5, gh = 0.8, reach = 3) {
    E.set(pos.x, pos.y + eye, pos.z);
    D.set(Math.sin(look.yaw) * Math.cos(look.pitch), Math.sin(look.pitch), Math.cos(look.yaw) * Math.cos(look.pitch));
    const ay = a.y != null ? a.y : ground(a.x, a.z);
    const hx = Math.hypot(D.x, D.z) || 1e-4;
    const cxp = a.x - E.x, czp = a.z - E.z;
    // closest approach of the ray to the axis, measured on the ground plane
    const t = Math.max(0, (cxp * D.x + czp * D.z) / (hx * hx));
    const px = D.x * t - cxp, pz = D.z * t - czp, dxz = Math.hypot(px, pz), y = E.y + D.y * t;
    let hit = null;
    if (dxz < gr && y > ay - 0.25 && y < ay + gh + 0.15) hit = t * Math.hypot(hx, D.y);
    // or the ray meets the ground right around it (low things: seeds, finds, soil)
    if (D.y < -0.05) {
      const tg = (E.y - ay) / -D.y;
      const gx = E.x + D.x * tg - a.x, gz = E.z + D.z * tg - a.z;
      if (Math.hypot(gx, gz) < gr + 0.12) { const d = tg; if (hit == null || d < hit) hit = d; }
    }
    if (hit == null) return null;
    const flat = Math.hypot(cxp, czp);
    if (flat > reach + gr) return null;
    return hit;
  }
  return {
    character, position: pos, cam,
    get heading() { return look.yaw; }, get pitch() { return look.pitch; }, get speed() { return speed; }, get airborne() { return airborne; },
    get busy() { return lock > 0 || !!gesture; },
    get eye() { return eye; },
    ground,
    update, updateCamera, gazeHit,
    look(dx, dy) { dx *= lookPrefs.sens; dy *= lookPrefs.sens * (lookPrefs.invertY ? -1 : 1); look.ty -= dx; look.tp = THREE.MathUtils.clamp(look.tp - dy, -1.35, 1.3); },
    zoom() {},
    jump() { jumpQueued = true; },
    // an action takes a moment; kneeling lowers her eyes toward the ground. resolves when done.
    act(name, dur = 1.4, faceTo = null) {
      void faceTo;
      gesture = name; gestureT = 0; gestureDur = dur * 0.75; lock = dur * 0.6;
      if (name === 'kneel') eyeTarget = 1.05;
      return new Promise((r) => { gestureDone = r; });
    },
    teleport(x, z, yaw = look.yaw) { pos.set(x, ground(x, z), z); vel.set(0, 0, 0); look.yaw = look.ty = yaw; firstCam = true; },
    setEnabled(on) { enabled = on; },
    step(dt, x, y, runK = 0) { virtual = { x, y, runK }; update(dt); virtual = null; },
    sim(x, y, secs, runK = 0, dt = 1 / 30) { virtual = { x, y, runK }; for (let t = 0; t < secs; t += dt) update(dt); virtual = null; for (let k = 0; k < 20; k++) update(dt); },
    // tests: aim the view. yaw = direction she faces, pitch in radians (negative looks down)
    aim(yaw, pitch = look.pitch) { look.yaw = look.ty = yaw; look.pitch = look.tp = pitch; firstCam = true; },
    lookAtPoint(x, y, z) { const dx = x - pos.x, dz = z - pos.z, dy = y - (pos.y + eye); const yaw = Math.atan2(dx, dz), pitch = Math.atan2(dy, Math.hypot(dx, dz)); look.yaw = look.ty = yaw; look.pitch = look.tp = pitch; firstCam = true; },
    // legacy third-person framing from older tests: yaw was the camera's side, so face the other way
    setCam(yaw, pitch = 0.2) { look.yaw = look.ty = yaw - Math.PI; look.pitch = look.tp = -pitch * 0.5; firstCam = true; },
    setVisible() {},
    snapCamera() { firstCam = true; },
    setGravity(g) { gravity = g; },
    facingDot(p) { const dx = p.x - pos.x, dz = p.z - pos.z, l = Math.hypot(dx, dz) || 1; return (dx * Math.sin(look.yaw) + dz * Math.cos(look.yaw)) / l; },
  };
}
