// Camera modes for the game walker: 'first' (the player's own eye camera, body visible below),
// 'third' (over-the-shoulder spring arm with collision, shoulder swap, sprint pull-back) and
// 'photo' (free orbit around the avatar, movement paused, zoom, roll-free). Runs after
// player.updateCamera(dt), which has already put the camera at the eye looking down the crosshair.
//   cam.mode / cam.setMode('third') / cam.toggle() (V, gamepad right-stick click) / cam.swapShoulder() (Z)
//   photo mode: the normal look input orbits (the body holds still), wheel / pinch zooms
//   cam.photo(true) / cam.zoom(delta) / cam.aimPoint(out) (where the crosshair lands, for rays from the camera)
import * as THREE from 'three';
import { get as getSetting } from '../settings.js';
import { slice, persist } from '../../save.js';

const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
export const CAMERA_MODES = ['first', 'third', 'photo'];
const prefs = slice('avatarCam', () => ({ mode: 'first', shoulder: 1, dist: 2.7, height: 0.0, smooth: 1 }));

export function createAvatarCamera({ camera, player, ground = () => 0, colliders = null, env = null }) {
  let mode = CAMERA_MODES.includes(prefs.mode) && prefs.mode !== 'photo' ? prefs.mode : 'first';
  let blend = mode === 'third' ? 1 : 0; // 0 first .. 1 third
  let shoulder = prefs.shoulder >= 0 ? 1 : -1, sh = shoulder;
  let arm = prefs.dist, armNow = arm, liftNow = 0; // spring arm length now (collision shortens it at once, grows back slowly)
  let photoOn = false, photoDist = 3.2, prevMode = mode;
  const listeners = new Set();
  const pivot = new THREE.Vector3(), pivotS = new THREE.Vector3(), fwd = new THREE.Vector3(), rightV = new THREE.Vector3(), want = new THREE.Vector3(), probe = new THREE.Vector3();
  let firstFrame = true;
  const blocked = (x, y, z) => {
    if (env && env.solid && env.solid(x, y, z)) return true;
    if (colliders && colliders.distanceH && colliders.distanceH(x, z, y, ['solid']) < 0.22) return true;
    return false;
  };
  function emit() { for (const fn of listeners) { try { fn(api.mode); } catch (e) { /* */ } } }
  const api = {
    get mode() { return photoOn ? 'photo' : mode; },
    get blend() { return blend; },
    get shoulder() { return shoulder; },
    get armNow() { return blend > 0.001 ? armNow : 0; },
    get firstPerson() { return !photoOn && blend < 0.5; },
    setMode(m) {
      if (m === 'photo') return api.photo(true);
      if (photoOn) api.photo(false);
      if (!CAMERA_MODES.includes(m) || m === mode) return;
      mode = m; prefs.mode = m; persist(400); emit();
    },
    toggle() { api.setMode(api.mode === 'first' ? 'third' : 'first'); },
    swapShoulder() { shoulder = -shoulder; prefs.shoulder = shoulder; persist(400); },
    setDistance(d) { arm = THREE.MathUtils.clamp(d, 1.4, 5); prefs.dist = arm; persist(400); },
    zoom(dz) { if (photoOn) photoDist = THREE.MathUtils.clamp(photoDist * (1 + dz), 0.8, 12); else if (mode === 'third') api.setDistance(arm * (1 + dz)); },
    photo(on, opts = {}) {
      on = !!on;
      if (on === photoOn) return;
      photoOn = on;
      if (on) {
        prevMode = mode; photoDist = opts.dist || 3.0;
        player.setEnabled && player.setEnabled(false);
      } else { player.setEnabled && player.setEnabled(true); mode = prevMode; }
      emit();
    },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    snap() { firstFrame = true; },
    // where the crosshair points from the camera (for third-person aiming rays)
    aimRay(origin = new THREE.Vector3(), dir = new THREE.Vector3()) { origin.copy(camera.position); camera.getWorldDirection(dir); return { origin, dir }; },
    update(dt, { eyeY = 1.6, sprinting = false, holding = false, lockedFP = false } = {}) {
      const target = !lockedFP && (photoOn || mode === 'third') ? 1 : 0;
      blend = firstFrame ? target : damp(blend, target, 7, dt);
      if (Math.abs(blend - target) < 1e-3) blend = target;
      sh = damp(sh, shoulder, 6, dt);
      if (blend <= 0.001) { firstFrame = false; return; } // pure first person: leave the player's camera alone
      const p = player.position;
      camera.getWorldDirection(fwd);
      rightV.set(-fwd.z, 0, fwd.x).normalize();
      // pivot: just above the shoulder; smoothed vertically so footsteps/bob don't shake the frame
      pivot.set(p.x, p.y + eyeY * (photoOn ? 0.62 : 0.97), p.z);
      if (firstFrame) pivotS.copy(pivot);
      pivotS.x = pivot.x; pivotS.z = pivot.z; pivotS.y = damp(pivotS.y, pivot.y, 14, dt);
      const side = photoOn ? 0 : 0.42 * sh * blend;
      const wantArm = photoOn ? photoDist : (arm + (sprinting ? 0.45 : 0) - (holding ? 0.35 : 0)) * blend;
      // collision: march from the pivot out to the wanted camera spot
      const o = probe.copy(pivotS).addScaledVector(rightV, side);
      // rising ground behind her lifts the camera over the slope (up to 1.4 m) instead of pulling it into her back;
      // only solid things (walls, rocks, trees) shorten the arm
      let free = wantArm, lift = 0;
      const steps = 12;
      for (let i = 1; i <= steps; i++) {
        const t = (wantArm * i) / steps;
        const x = o.x - fwd.x * t, z = o.z - fwd.z * t;
        const gy = ground(x, z) + 0.32 - (o.y - fwd.y * t + 0.08 * blend);
        if (gy > lift) lift = Math.min(1.4, gy);
        const y = o.y - fwd.y * t + 0.08 * blend + lift;
        if (blocked(x, y, z) || gy > 1.4) { free = Math.max(0.25, t - wantArm / steps - 0.1); break; }
      }
      armNow = free < armNow || firstFrame ? free : damp(armNow, free, 3, dt);
      liftNow = lift > liftNow || firstFrame ? lift : damp(liftNow, lift, 3, dt);
      want.set(o.x - fwd.x * armNow, o.y - fwd.y * armNow + 0.08 * blend + liftNow * blend, o.z - fwd.z * armNow);
      // blend from the eye camera (already placed) to the arm spot
      camera.position.lerp(want, blend);
      if (photoOn) camera.lookAt(pivotS.x, pivotS.y, pivotS.z);
      else {
        // keep the crosshair on the same world point the eye was aiming at (~25 m ahead)
        probe.set(p.x, p.y + eyeY, p.z); camera.getWorldDirection(fwd);
        camera.lookAt(probe.x + fwd.x * 25, probe.y + fwd.y * 25, probe.z + fwd.z * 25);
      }
      firstFrame = false;
    },
  };
  // keys (remappable in Settings > Controls): V toggles first / third, Z swaps shoulder, wheel zooms the arm / photo
  const keysFor = (a, def) => { const k = getSetting('controls.keys.' + a); return Array.isArray(k) && k.length ? k : def; };
  addEventListener('keydown', (e) => {
    if (e.repeat || (e.target && /input|textarea|select/i.test(e.target.tagName))) return;
    const isCam = keysFor('camera', ['KeyV']).includes(e.code);
    if (photoOn && (isCam || e.code === 'Escape')) { api.photo(false); e.stopImmediatePropagation(); return; }
    if (isCam) api.toggle();
    else if (keysFor('shoulder', ['KeyZ']).includes(e.code) && api.mode === 'third') api.swapShoulder();
  }, true);
  addEventListener('wheel', (e) => { if (api.mode !== 'first' && !(e.target && e.target.closest && e.target.closest('#hud .panel, #zen-menu, #av-creator'))) api.zoom(Math.sign(e.deltaY) * 0.08); }, { passive: true });
  // gamepad: right-stick click toggles (standard mapping button 11, remappable)
  let padPrev = false;
  api.pollPad = () => {
    const gp = navigator.getGamepads ? [...navigator.getGamepads()].find((g) => g && g.connected) : null;
    const pad = getSetting('controls.pad'); const b = pad && pad.buttons && Number.isInteger(pad.buttons.camera) ? pad.buttons.camera : 11;
    const down = !!(gp && (!pad || pad.enabled !== false) && gp.buttons[b] && gp.buttons[b].pressed);
    if (down && !padPrev) api.toggle();
    padPrev = down;
  };
  return api;
}
