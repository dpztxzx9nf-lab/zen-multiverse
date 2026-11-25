// Camera rig: one place that decides where the eye is. Modes:
//   'drift'  - (now) a slow walk at eye height along a looping garden path, gazing at what's nearby
//   'follow' - (later) attached to a character: rig.follow(obj, { distance, height, eye }) for third
//              person, or { firstPerson: true } to ride at the character's eye height
//   'fixed'  - a debug/cinematic framing: rig.fix(position, target)
// Everything is metres. The user may nudge the gaze (look()) but never steers the walk.
import * as THREE from 'three';

const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));

export function createCameraRig(camera, { path, pois = () => [], eye = 1.6, speed = 0.32, colliders = null, start = 0 } = {}) {
  const curve = new THREE.CatmullRomCurve3(path.map(([x, z]) => new THREE.Vector3(x, 0, z)), true, 'centripetal', 0.5);
  const length = curve.getLength();
  let mode = 'drift', u = start, frozen = false;
  const pos = new THREE.Vector3(), look = new THREE.Vector3(), tmp = new THREE.Vector3(), tan = new THREE.Vector3();
  let first = true, spd = speed;
  const nudge = { yaw: 0, pitch: 0 };
  let followT = null, followOpt = {};
  const fixed = { p: new THREE.Vector3(), t: new THREE.Vector3() };
  const rig = {
    pitchBias: 0, // e.g. portrait screens look a touch higher (less empty lawn)
    get mode() { return mode; }, get u() { return u; }, length, curve, nudge,
    setU(v, freeze = false) { u = ((v % 1) + 1) % 1; frozen = freeze; first = true; },
    drift() { mode = 'drift'; },
    follow(obj, opt = {}) { mode = 'follow'; followT = obj; followOpt = opt; },
    fix(p, t) { mode = 'fixed'; fixed.p.copy(p); fixed.t.copy(t); },
    look(dyaw, dpitch) { nudge.yaw = THREE.MathUtils.clamp(nudge.yaw + dyaw, -0.7, 0.7); nudge.pitch = THREE.MathUtils.clamp(nudge.pitch + dpitch, -0.25, 0.35); },
    // gaze: { lift } raises the gaze (stars at night, arrival); { intro } 0..1 arrival from the sky
    update(dt, now, { lift = 0, dragging = false, preferYaw = null, preferK = 0 } = {}) {
      if (!dragging) { const k = Math.exp(-dt / 25); nudge.yaw *= k; nudge.pitch *= k; }
      if (mode === 'fixed') { camera.position.copy(fixed.p); camera.lookAt(fixed.t); return; }
      if (mode === 'follow' && followT) {
        const o = followOpt;
        followT.getWorldPosition(tmp);
        if (o.firstPerson) { pos.set(tmp.x, tmp.y + (o.eye ?? eye), tmp.z); look.set(0, 0, -1).applyQuaternion(followT.quaternion).add(pos); }
        else {
          const back = new THREE.Vector3(0, 0, 1).applyQuaternion(followT.quaternion).multiplyScalar(o.distance ?? 4);
          pos.lerp(tmp.clone().add(back).setY(tmp.y + (o.height ?? 2.2)), first ? 1 : 1 - Math.exp(-4 * dt));
          look.set(tmp.x, tmp.y + 1.2, tmp.z);
        }
        if (colliders) colliders.resolve(pos, 0.25, ['solid']);
        camera.position.copy(pos); camera.lookAt(look); first = false; return;
      }
      // ---- drift: slow down to linger when something lovely is close
      const ps = pois();
      let near = 0;
      curve.getPointAt(u, tmp);
      // what's interesting nearby: a weighted average of *directions* (not points, which would
      // collapse onto the ground at her feet when things surround her) plus a weighted gaze pitch
      let fx = 0, fz = 0, fp = 0, wsum = 0;
      for (const p of ps) {
        const dx = p.x - tmp.x, dz = p.z - tmp.z, d = Math.hypot(dx, dz) || 0.001;
        const w = (p.w ?? 1) / (d * d + 3);
        fx += (dx / d) * w; fz += (dz / d) * w;
        fp += Math.atan2((p.y ?? 0.3) - eye, Math.max(d, 1.2)) * w; wsum += w;
        near = Math.max(near, (p.w ?? 1) * Math.exp(-d / 2.2) * (p.linger ?? 0.5));
      }
      spd = damp(spd, speed * (1 - 0.6 * Math.min(1, near)), 0.5, dt);
      if (!frozen) u = (u + (spd * dt) / length) % 1;
      curve.getPointAt(u, tmp);
      curve.getTangentAt(u, tan);
      // eye height with a barely-there walking breath
      const bob = Math.sin(now * 1.9) * 0.008 + Math.sin(now * 0.31) * 0.02;
      const target = tmp.clone().setY(eye + bob);
      if (colliders) colliders.resolve(target, 0.45);
      if (first) pos.copy(target); else { pos.x = damp(pos.x, target.x, 2, dt); pos.y = damp(pos.y, target.y, 2, dt); pos.z = damp(pos.z, target.z, 2, dt); }
      // gaze: mostly toward what's interesting, a little along the walk
      const fl = Math.hypot(fx, fz) || 1;
      const gx = tan.x * 0.3 + (fx / fl) * 0.7, gz = tan.z * 0.3 + (fz / fl) * 0.7;
      let yaw = Math.atan2(gx, gz) + nudge.yaw;
      if (preferK > 0 && preferYaw != null) {
        let dy = preferYaw - yaw; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
        yaw += dy * Math.min(1, preferK);
      }
      const basePitch = THREE.MathUtils.clamp(wsum > 0 ? fp / wsum : -0.2, -0.38, 0.05);
      const pitch = THREE.MathUtils.clamp(basePitch + rig.pitchBias + nudge.pitch + lift, -0.6, 1.15);
      // smooth the angles (not the point) so turns stay slow and level
      if (first) { rig._yaw = yaw; rig._pitch = pitch; }
      let dy = yaw - rig._yaw; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
      rig._yaw += dy * (1 - Math.exp(-0.6 * dt));
      rig._pitch = damp(rig._pitch, pitch, 0.8, dt);
      look.set(Math.sin(rig._yaw) * Math.cos(rig._pitch), Math.sin(rig._pitch), Math.cos(rig._yaw) * Math.cos(rig._pitch)).add(pos);
      camera.position.copy(pos);
      camera.lookAt(look);
      first = false;
    },
    get position() { return pos; },
  };
  return rig;
}
