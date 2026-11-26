// Avatar animation: a locomotion blend tree on an AnimationMixer (idle / walk / run / sprint phase-synced
// by speed, crouch pair), full-body states that cross-fade over it (jump, fall, land, slide, mantle,
// climb, glide, swim, sit), masked overlay layers evaluated straight from the clips (carry, throw, dig,
// build, hold, water, drink, wave...), then procedural passes: look toward the crosshair, lower-body
// twist toward the move direction, lean into turns, two-bone foot IK on slopes.
//
// Movement code drives it either way:
//   anim.drive({ speed, grounded, vy, sliding, gliding, mantling, climbing, crouching, swimming, moveYaw })
//   anim.set('glide')  -> force a base state until anim.set(null)
//   anim.play('throw') -> one-shot overlay (returns a promise); anim.play('carry', { loop: true }); anim.stop('carry')
import * as THREE from 'three';

export const STATES = ['idle', 'walk', 'run', 'sprint', 'jump', 'fall', 'land', 'slide', 'climb', 'mantle', 'glide', 'carry', 'throw', 'dig', 'build', 'swim', 'crouch', 'sit', 'roll'];
// authored ground speed (m/s) of each loop at timeScale 1, used to keep feet planted
// first-person arm carry (radians): forward raise of the upper arm, inward swing, elbow bend
export const FP_ARM = { raise: 1.15, inward: 0.2, bend: 0.35, holdRaise: 0.9, holdInward: 0.05, holdBend: 0.5, holdWrist: 0.9 };
const PACE = { walk: 1.45, run: 3.6, sprint: 6.4, crouch_walk: 1.2, swim: 1.3 };
// overlay actions: clip, bone mask, loop, how fast to fade
const ACTIONS = {
  carry: { clip: 'carry', mask: 'arms', loop: true },
  hold: { clip: 'hold', mask: 'arm_r', loop: true },
  lantern: { clip: 'lantern', mask: 'arm_l', loop: true },
  throw: { clip: 'throw', mask: 'upper' },
  dig: { clip: 'dig', mask: 'full', loop: true },
  chop: { clip: 'dig', mask: 'upper', loop: true },
  build: { clip: 'build', mask: 'full', loop: true },
  water: { clip: 'water', mask: 'full' },
  plant: { clip: 'plant', mask: 'full' },
  harvest: { clip: 'harvest', mask: 'full' },
  pickup: { clip: 'pickup', mask: 'full' },
  interact: { clip: 'interact', mask: 'upper' },
  drink: { clip: 'drink', mask: 'upper' },
  open: { clip: 'open', mask: 'full' },
  push: { clip: 'push', mask: 'upper', loop: true },
  yes: { clip: 'yes', mask: 'upper' },
  no: { clip: 'no', mask: 'upper' },
  wave: { clip: 'interact', mask: 'arm_r' },
  dance: { clip: 'dance', mask: 'full', loop: true },
  fold: { clip: 'idle_fold', mask: 'upper', loop: true },
  focus: { clip: 'focus', mask: 'upper', loop: true },
  sit: { clip: 'sit', mask: 'full', loop: true },
  talk: { clip: 'talk', mask: 'upper', loop: true },
  bump: { clip: 'bump', mask: 'upper' },
  knock: { clip: 'knock', mask: 'full' },
  roll: { clip: 'roll', mask: 'full' },
  wake: { clip: 'wake', mask: 'full' },
};
export const EMOTES = ['wave', 'yes', 'no', 'dance', 'fold', 'focus', 'sit', 'drink', 'talk'];
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const wrap = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };

function maskSet(bones, kind) {
  const out = new Set();
  const under = (name) => { const b = bones[name]; if (!b) return; b.traverse((o) => { if (o.isBone) out.add(o.name); }); };
  if (kind === 'full') { for (const n in bones) out.add(n); return out; }
  if (kind === 'upper') { under('spine_01'); return out; }
  if (kind === 'arms') { under('clavicle_l'); under('clavicle_r'); return out; }
  if (kind === 'arm_r') { under('clavicle_r'); return out; }
  if (kind === 'arm_l') { under('clavicle_l'); return out; }
  return out;
}

export function createAnimator(rig, clips, { ground = null } = {}) {
  const B = rig.bones;
  const mixer = new THREE.AnimationMixer(rig.root);
  const act = {};
  const mk = (name, loop = true) => {
    const c = clips[name]; if (!c) return null;
    const a = mixer.clipAction(c); a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity); a.clampWhenFinished = !loop;
    a.enabled = true; a.setEffectiveWeight(0); a.play(); act[name] = a; return a;
  };
  for (const n of ['idle', 'walk', 'run', 'sprint', 'crouch', 'crouch_walk', 'fall', 'glide', 'slide', 'swim', 'swim_idle']) mk(n, true);
  for (const n of ['jump', 'jump2', 'land', 'land_hard', 'slide_start', 'slide_exit', 'mantle', 'roll']) mk(n, false);
  // weights we steer toward (base layer); everything normalises inside the mixer
  const W = {}; for (const k in act) W[k] = 0; W.idle = 1; act.idle.setEffectiveWeight(1);
  const T = {}; // targets
  let fpArms = 0, fpT = 0, fpSwing = 0;
  let phase = 0, forced = null, oneShot = null, oneT = 0, landT = 0, prevGrounded = true, airT = 0, slideWas = false, peakFall = 0;
  const drv = { speed: 0, grounded: true, vy: 0, sliding: false, gliding: false, mantling: false, climbing: false, crouching: false, swimming: false, moveYaw: 0, bodyYaw: 0, turnRate: 0, aimYaw: 0, aimPitch: 0, fp: false };
  // overlay layers
  const layers = new Map();
  const interps = new Map(); // clip -> [{ bone, q: interpolant, p?: interpolant }]
  function interpFor(clipName) {
    if (interps.has(clipName)) return interps.get(clipName);
    const c = clips[clipName]; const list = [];
    if (c) {
      const byBone = {};
      for (const tr of c.tracks) {
        const [node, prop] = tr.name.split('.'); const b = B[node]; if (!b) continue;
        (byBone[node] = byBone[node] || { bone: b, name: node })[prop === 'quaternion' ? 'q' : 'p'] = tr.createInterpolant();
      }
      list.push(...Object.values(byBone));
    }
    interps.set(clipName, list); return list;
  }
  const masks = {};
  const getMask = (k) => masks[k] || (masks[k] = maskSet(B, k));
  function play(name, { loop, speed = 1, fade = 0.18, weight = 1 } = {}) {
    const def = ACTIONS[name]; if (!def || !clips[def.clip]) return Promise.resolve(false);
    const L = layers.get(name) || { name, def, t: 0, w: 0, target: 0 };
    L.t = 0; L.speed = speed; L.loop = loop != null ? loop : !!def.loop; L.target = weight; L.fade = fade; L.mask = getMask(def.mask); L.list = interpFor(def.clip); L.dur = clips[def.clip].duration;
    layers.set(name, L);
    return new Promise((res) => { L.done = res; });
  }
  function stop(name, fade = 0.25) { const L = layers.get(name); if (L) { L.target = 0; L.fade = fade; } }
  const q = new THREE.Quaternion(), qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), v3 = new THREE.Vector3();
  const qBuf = new Float32Array(4), pBuf = new Float32Array(3);
  function applyLayers(dt) {
    for (const L of layers.values()) {
      L.w = damp(L.w, L.target, 1 / Math.max(0.04, L.fade) * 2.2, dt);
      L.t += dt * L.speed;
      if (!L.loop && L.t >= L.dur - L.fade) L.target = 0;
      if (L.target === 0 && L.w < 0.01) { layers.delete(L.name); if (L.done) L.done(true); continue; }
      const t = L.loop ? L.t % L.dur : Math.min(L.t, L.dur);
      const w = Math.min(1, L.w);
      for (const e of L.list) {
        if (!L.mask.has(e.name)) continue;
        if (e.q) { const r = e.q.evaluate(t); q.fromArray(r); e.bone.quaternion.slerp(q, w); }
        if (e.p && e.name === 'pelvis' && L.def.mask === 'full') { const r = e.p.evaluate(t); v3.fromArray(r); e.bone.position.lerp(v3, w); }
      }
    }
    void qBuf; void pBuf;
  }
  // ---- base state choice
  function chooseBase(dt) {
    for (const k in T) T[k] = 0;
    const d = drv, sp = d.speed;
    if (!d.grounded && prevGrounded) { airT = 0; peakFall = 0; }
    if (d.grounded && !prevGrounded) {
      // landing: a soft dip unless she was barely airborne
      if (airT > 0.35 && !d.sliding) { oneShot = peakFall < -9 ? 'land_hard' : 'land'; oneT = 0; act[oneShot].reset().play(); }
    }
    if (!d.grounded) { airT += dt; peakFall = Math.min(peakFall, d.vy); }
    prevGrounded = d.grounded;
    if (d.sliding && !slideWas) { oneShot = 'slide_start'; oneT = 0; act.slide_start.reset().play(); }
    if (!d.sliding && slideWas && d.grounded) { oneShot = 'slide_exit'; oneT = 0; act.slide_exit.reset().play(); }
    slideWas = d.sliding;
    const st = forced || (d.swimming ? (sp > 0.3 ? 'swim' : 'swim_idle') : d.mantling ? 'mantle' : d.climbing ? 'climb' : d.gliding ? 'glide' : d.sliding ? 'slide'
      : !d.grounded ? (airT < 0.42 && d.vy > 0 ? 'jump' : 'fall') : 'loco');
    if (st === 'mantle' && W.mantle < 0.05) act.mantle.reset().play();
    if (st === 'jump' && airT < dt * 1.5) { (act.jump).reset().play(); }
    if (oneShot) {
      oneT += dt; const a = act[oneShot], dur = a.getClip().duration;
      const lim = oneShot.startsWith('land') ? Math.min(dur, 0.5) : oneShot === 'slide_start' ? Math.min(dur, 0.45) : Math.min(dur, 0.4);
      if (oneT > lim || (oneShot.startsWith('land') && sp > 2.5 && oneT > 0.18) || (oneShot.startsWith('slide') && !d.grounded)) oneShot = null;
    }
    if (oneShot && (st === 'loco' || st === 'slide')) { T[oneShot] = 1; return; }
    switch (st) {
      case 'loco': {
        const crouch = d.crouching;
        if (crouch) { const k = THREE.MathUtils.clamp(sp / 0.9, 0, 1); T.crouch = 1 - k; T.crouch_walk = k; break; }
        // 1D blend tree over speed
        const pts = [['idle', 0], ['walk', PACE.walk], ['run', PACE.run], ['sprint', PACE.sprint]];
        if (sp <= 0.05) { T.idle = 1; break; }
        for (let i = 0; i < pts.length - 1; i++) {
          const [a, sa] = pts[i], [b, sb] = pts[i + 1];
          if (sp <= sb || i === pts.length - 2) { const k = THREE.MathUtils.clamp((sp - sa) / (sb - sa), 0, 1); T[a] = 1 - k; T[b] = k; break; }
        }
        break;
      }
      case 'climb': T.mantle = 1; break;
      default: if (act[st]) T[st] = 1; else T.idle = 1;
    }
  }
  function applyBase(dt) {
    const fadeK = 9;
    let total = 0;
    for (const k in act) { W[k] = damp(W[k], T[k] || 0, fadeK, dt); if (W[k] < 0.002) W[k] = 0; total += W[k]; }
    if (total < 0.01) { W.idle = 1; total = 1; }
    for (const k in act) act[k].setEffectiveWeight(W[k] / total);
    // phase-synced locomotion: one shared phase advanced by the dominant loop's rate
    const sp = Math.max(0.0, drv.speed);
    const rate = (W.walk * sp / PACE.walk / act.walk.getClip().duration + W.run * sp / PACE.run / act.run.getClip().duration + W.sprint * sp / PACE.sprint / act.sprint.getClip().duration) / Math.max(1e-3, W.walk + W.run + W.sprint);
    const back = drv.backward ? -1 : 1;
    if (W.walk + W.run + W.sprint > 0.01) phase = (phase + rate * dt * back + 1) % 1;
    for (const k of ['walk', 'run', 'sprint']) { const a = act[k]; a.timeScale = 0; a.time = phase * a.getClip().duration; }
    const cw = act.crouch_walk; cw.timeScale = Math.max(0.3, sp / PACE.crouch_walk) * back;
    act.swim.timeScale = Math.max(0.5, sp / PACE.swim);
    act.mantle.timeScale = forced === 'climb' || drv.climbing ? 0.0 : 1.35;
    if (drv.climbing) { climbPh = (climbPh + dt * Math.max(0.2, Math.abs(drv.vy)) * 0.5) % 1; act.mantle.time = 0.05 + Math.abs(Math.sin(climbPh * Math.PI)) * 0.3; }
  }
  let climbPh = 0;
  // ---- procedural passes
  const up = new THREE.Vector3(0, 1, 0), right = new THREE.Vector3();
  const pq = new THREE.Quaternion(), pqi = new THREE.Quaternion(), wq = new THREE.Quaternion();
  // rotate a bone by a world-space rotation R (bone's parent world matrices must be current)
  function rotWorld(bone, R) {
    bone.parent.getWorldQuaternion(pq); pqi.copy(pq).invert();
    wq.copy(pqi).multiply(R).multiply(pq); bone.quaternion.premultiply(wq);
    bone.updateMatrixWorld(true);
  }
  let twist = 0, lean = 0, lookYaw = 0, lookPitch = 0, pelvisDrop = 0;
  const ikState = { l: 0, r: 0 };
  function procedural(dt) {
    const d = drv;
    rig.root.updateMatrixWorld(true);
    // lower body twist toward the move direction (first person / strafing), upper body counter-twists
    const wantTwist = d.twist || 0;
    twist = damp(twist, wantTwist, 8, dt);
    if (Math.abs(twist) > 1e-3 && B.pelvis && B.spine_01) {
      qa.setFromAxisAngle(up, twist); rotWorld(B.pelvis, qa);
      qb.setFromAxisAngle(up, -twist * 0.85); rotWorld(B.spine_01, qb);
    }
    // lean into turns
    const wantLean = THREE.MathUtils.clamp(-d.turnRate * Math.min(1, d.speed / 4) * 0.08, -0.22, 0.22) * (d.grounded ? 1 : 0.5);
    lean = damp(lean, wantLean, 5, dt);
    if (Math.abs(lean) > 1e-3 && B.pelvis) {
      right.set(Math.sin(d.bodyYaw), 0, Math.cos(d.bodyYaw)); qa.setFromAxisAngle(right, lean); rotWorld(B.pelvis, qa);
    }
    // look at the crosshair: yaw spread over spine_03 / neck / head, pitch too (more spine while holding things)
    const ly = THREE.MathUtils.clamp(wrap(d.aimYaw - d.bodyYaw - twist * 0.15), -1.25, 1.25);
    const lp = THREE.MathUtils.clamp(d.aimPitch, -1.0, 0.95);
    lookYaw = damp(lookYaw, d.lookOff ? 0 : ly, 10, dt); lookPitch = damp(lookPitch, d.lookOff ? 0 : lp, 10, dt);
    const spineK = d.fp ? (d.holding ? 0.62 : 0.4) : (d.holding ? 0.45 : 0.22);
    const chain = [[B.spine_02, 0.12, spineK * 0.4], [B.spine_03, 0.18, spineK * 0.6], [B.neck_01, 0.3, (1 - spineK) * 0.4], [B.Head, 0.4, (1 - spineK) * 0.6]];
    right.set(Math.cos(d.bodyYaw), 0, -Math.sin(d.bodyYaw)); // body right (yaw 0 faces +z)
    for (const [b, ky, kp] of chain) {
      if (!b) continue;
      qa.setFromAxisAngle(up, lookYaw * ky);
      qb.setFromAxisAngle(right, -lookPitch * kp);
      qa.multiply(qb); rotWorld(b, qa);
    }
    // first person: carry the arms a little forward and bent so her hands sit at the bottom of the view
    // (the walk / run swing still plays through); full-body moves and two-handed tools take over
    const wantFp = d.fp && !d.swimming && !d.mantling && !d.gliding && !busyArms() ? 1 : 0;
    fpArms = damp(fpArms, wantFp, 6, dt); fpT += dt;
    fpSwing = damp(fpSwing, d.grounded && !d.sliding ? Math.min(1, (d.speed || 0) / 5) : 0.15, 5, dt);
    if (fpArms > 1e-3) {
      right.set(Math.cos(d.bodyYaw), 0, -Math.sin(d.bodyYaw));
      for (const s of ['l', 'r']) {
        const ua = B['upperarm_' + s], la = B['lowerarm_' + s];
        if (!ua || !la) continue;
        const side = s === 'l' ? -1 : 1;
        // the tool hand already holds its tool forward (hold layer): only nudge it into view
        const hk = s === 'r' && d.holding;
        // alive, not bolted on: a slow breathing sway at rest and an opposite-arm swing with the stride
        const ph = fpT * (1.3 + fpSwing * 5.2) + (s === 'l' ? Math.PI : 0);
        const sway = (0.022 * Math.sin(fpT * 1.1 + side) + fpSwing * 0.16 * Math.sin(ph)) * (hk ? 0.4 : 1);
        const roll = 0.03 * Math.sin(fpT * 0.7 + side * 0.9) * (1 - fpSwing);
        qa.setFromAxisAngle(right, -(hk ? FP_ARM.holdRaise : FP_ARM.raise) * fpArms + sway * fpArms); qb.setFromAxisAngle(up, side * ((hk ? FP_ARM.holdInward : FP_ARM.inward) + roll) * fpArms); qa.premultiply(qb); rotWorld(ua, qa);
        qa.setFromAxisAngle(right, -(hk ? FP_ARM.holdBend : FP_ARM.bend) * fpArms); rotWorld(la, qa);
        // tip the tool away from the eye so it reads as held, not poked into the lens
        if (hk && B.hand_r) { qa.setFromAxisAngle(right, FP_ARM.holdWrist * fpArms); rotWorld(B.hand_r, qa); }
      }
    }
    // foot IK on uneven ground
    if (ground && d.grounded && !d.sliding && !d.mantling && !d.swimming && B.foot_l && B.foot_r) footIK(dt);
    else pelvisDrop = damp(pelvisDrop, 0, 10, dt);
  }
  const A = new THREE.Vector3(), Bk = new THREE.Vector3(), C = new THREE.Vector3(), Tg = new THREE.Vector3(), tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
  const ANKLE = 0.085;
  function footIK(dt) {
    const rootY = rig.root.position.y;
    const offs = {};
    for (const s of ['l', 'r']) {
      B['foot_' + s].getWorldPosition(C);
      const gy = ground(C.x, C.z);
      // how far above the floor plane this foot is in the authored pose (stance foot ~ ANKLE)
      const lift = C.y - rootY - ANKLE * rig.root.scale.y;
      offs[s] = { gy, lift, dy: gy - rootY };
    }
    const drop = Math.min(0, offs.l.dy, offs.r.dy);
    pelvisDrop = damp(pelvisDrop, Math.max(-0.35, drop), 12, dt);
    if (Math.abs(pelvisDrop) > 1e-4) { B.pelvis.getWorldPosition(tmp); tmp.y += pelvisDrop; B.pelvis.parent.worldToLocal(tmp); B.pelvis.position.copy(tmp); B.pelvis.updateMatrixWorld(true); }
    for (const s of ['l', 'r']) {
      const o = offs[s];
      const want = o.dy - pelvisDrop; // raise this foot by the ground step under it
      ikState[s] = damp(ikState[s], o.lift < 0.12 ? want : want * Math.max(0, 1 - (o.lift - 0.12) / 0.2), 14, dt);
      if (Math.abs(ikState[s]) < 0.004) continue;
      const th = B['thigh_' + s], ca = B['calf_' + s], fo = B['foot_' + s];
      th.getWorldPosition(A); ca.getWorldPosition(Bk); fo.getWorldPosition(C);
      Tg.copy(C); Tg.y += ikState[s];
      twoBone(th, ca, A, Bk, C, Tg);
    }
  }
  const ax = new THREE.Vector3();
  function twoBone(th, ca, a, b, c, t) {
    const lab = a.distanceTo(b), lcb = b.distanceTo(c);
    const lat = THREE.MathUtils.clamp(a.distanceTo(t), 0.01, (lab + lcb) * 0.999);
    const acab0 = Math.acos(THREE.MathUtils.clamp(tmp.subVectors(c, a).normalize().dot(tmp2.subVectors(b, a).normalize()), -1, 1));
    const babc0 = Math.acos(THREE.MathUtils.clamp(tmp.subVectors(a, b).normalize().dot(tmp2.subVectors(c, b).normalize()), -1, 1));
    const acab1 = Math.acos(THREE.MathUtils.clamp((lcb * lcb - lab * lab - lat * lat) / (-2 * lab * lat), -1, 1));
    const babc1 = Math.acos(THREE.MathUtils.clamp((lat * lat - lab * lab - lcb * lcb) / (-2 * lab * lcb), -1, 1));
    ax.crossVectors(tmp.subVectors(c, a), tmp2.subVectors(b, a)).normalize();
    if (ax.lengthSq() < 1e-6) return;
    qa.setFromAxisAngle(ax, acab1 - acab0); rotWorld(th, qa);
    qb.setFromAxisAngle(ax, babc1 - babc0); rotWorld(ca, qb);
    // then swing the whole leg so the foot lands on the target
    ca.getWorldPosition(b); ca.children.length; const fo = ca.children.find((o) => o.isBone);
    if (fo) fo.getWorldPosition(c);
    tmp.subVectors(c, a).normalize(); tmp2.subVectors(t, a).normalize();
    qa.setFromUnitVectors(tmp, tmp2); rotWorld(th, qa);
  }
  function busyArms() { for (const L of layers.values()) if (L.target > 0 && L.name !== 'hold' && /^(full|upper|arms)$/.test(L.def.mask)) return true; return false; }
  const api = {
    mixer, actions: act, layers, inputs: drv,
    // feed the movement state every frame (all fields optional)
    drive(o) { Object.assign(drv, o); },
    set(state) { forced = state && STATES.includes(state) ? (state === 'carry' || state === 'throw' || state === 'dig' || state === 'build' ? null : state) : null; if (state === 'carry') play('carry'); if (state === 'throw') play('throw'); if (state === 'dig') play('dig'); if (state === 'build') play('build'); },
    get state() { return forced || currentState(); },
    play, stop,
    playing(name) { return layers.has(name) && layers.get(name).target > 0; },
    update(dt) {
      chooseBase(dt); applyBase(dt);
      mixer.update(dt);
      applyLayers(dt);
      procedural(dt);
    },
    // compact network snapshot of what the animation is doing
    net() { const o = []; for (const L of layers.values()) if (L.target > 0) o.push(L.name); return { s: currentState(), a: o }; },
  };
  function currentState() {
    let best = 'idle', w = 0; for (const k in W) if (W[k] > w) { w = W[k]; best = k; }
    return best;
  }
  return api;
}
