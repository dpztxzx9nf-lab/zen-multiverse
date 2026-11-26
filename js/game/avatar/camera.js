// Camera modes for the game walker: 'first' (the player's own eye camera, body visible below),
// 'third' (over-the-shoulder spring arm with collision, shoulder swap, sprint pull-back) and
// 'photo' (free orbit around the avatar, movement paused, zoom, roll-free). Runs after
// player.updateCamera(dt), which has already put the camera at the eye looking down the crosshair.
//   cam.mode / cam.setMode('third') / cam.toggle() / cam.swapShoulder(). The view and shoulder follow
//   zenSettings.state.view / .shoulder (settings.js), which the input layer flips on the 'view' (V, R3)
//   and 'shoulder' (X) actions; the arm length is settings camera.distance.
//   photo mode: the normal look input orbits (the body holds still), wheel / pinch zooms
//   cam.photo(true) / cam.zoom(delta) / cam.aimPoint(out) (where the crosshair lands, for rays from the camera)
import * as THREE from 'three';
import { zen, settings, set as setSetting } from '../settings.js';

const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
export const CAMERA_MODES = ['first', 'third', 'photo'];

export function createAvatarCamera({ camera, player, ground = () => 0, colliders = null, env = null }) {
  const zView = () => (zen.state.view === 'third' ? 'third' : 'first');
  const zShoulder = () => (zen.state.shoulder === 'left' ? -1 : 1);
  const zDist = () => THREE.MathUtils.clamp(+settings.camera.distance || 3.2, 1.4, 5);
  let mode = zView();
  let blend = mode === 'third' ? 1 : 0; // 0 first .. 1 third
  let shoulder = zShoulder(), sh = shoulder;
  let arm = zDist(), armNow = arm, liftNow = 0; // spring arm length now (collision shortens it at once, grows back slowly)
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
      mode = m; zen.state.view = m; emit();
    },
    toggle() { api.setMode(api.mode === 'first' ? 'third' : 'first'); },
    swapShoulder() { shoulder = -shoulder; zen.state.shoulder = shoulder < 0 ? 'left' : 'right'; },
    setDistance(d) { arm = THREE.MathUtils.clamp(d, 1.4, 5); setSetting('camera.distance', Math.round(arm * 10) / 10); },
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
    // same ray as equip.ray() (js/game/equip.js), which tools should use: it also carries ray.start (where her eye is along it)
    aimRay(origin = new THREE.Vector3(), dir = new THREE.Vector3()) { origin.copy(camera.position); camera.getWorldDirection(dir); return { origin, dir }; },
    update(dt, { eyeY = 1.6, sprinting = false, holding = false, lockedFP = false } = {}) {
      // follow the shared view state (V / R3 / the settings page flip it)
      if (!photoOn && zView() !== mode) { mode = zView(); emit(); }
      shoulder = zShoulder(); arm = zDist();
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
      let side = photoOn ? 0 : 0.42 * sh * blend;
      // the shoulder offset may not reach into a wall beside her either
      for (let i = 1; i <= 4; i++) { const k = (side * i) / 4; if (blocked(pivotS.x + rightV.x * k, pivotS.y, pivotS.z + rightV.z * k)) { side = (side * (i - 1)) / 4; break; } }
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
        if (blocked(x, y, z) || gy > 1.4) { free = Math.max(0, t - wantArm / steps - 0.1); break; } // last clear spot: never inside what you can see
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
  // photo mode: Esc or the view key steps back out (and the view key doesn't also flip first / third)
  addEventListener('keydown', (e) => {
    if (!photoOn || e.repeat || (e.target && /input|textarea|select/i.test(e.target.tagName))) return;
    if (e.code === 'Escape' || (settings.keys.view || []).includes(e.code)) { api.photo(false); e.stopImmediatePropagation(); e.preventDefault(); }
  }, true);
  // the wheel belongs to the hotbar / build pieces; it zooms only in photo mode or with Alt held
  addEventListener('wheel', (e) => { if ((photoOn || (mode === 'third' && e.altKey)) && !(e.target && e.target.closest && e.target.closest('#hud .panel, #zen-menu, #av-creator'))) api.zoom(Math.sign(e.deltaY) * 0.08); }, { passive: true });
  api.pollPad = () => {}; // the gamepad 'view' button arrives through input.js like the keyboard
  return api;
}
