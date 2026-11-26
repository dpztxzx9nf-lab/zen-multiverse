// Game walker: first person, forward is wherever the crosshair points. Built on the feel of
// Titanfall/Apex (ground accel + friction, air strafing, sprint, slide with slope speed, slide
// jumps keep momentum, coyote time, jump buffering, double jump, wall climb, mantle), Mirror's
// Edge (auto-mantle, landing dip, camera weight) and Breath of the Wild (glide). Every number is
// in MOVE (move-config.js); player-facing knobs are moveSettings (sensitivity, FOV, bob...).
//
// The world gives the walker its shape through `env`:
//   top(x, z, yFrom)  -> surface height under yFrom (if yFrom is inside something solid, its top)
//   solid(x, y, z)    -> is this point inside rock, a wall, a slab...
// Plain heightfield worlds just pass ground(x, z); the voxel terrain and builds add caves, walls
// and floors you can stand on.
import * as THREE from 'three';
import { keyDown, EYE, moveKeys, lookPrefs } from './player-calm.js';
import { settings } from './settings.js';
import { MOVE, moveSettings } from './move-config.js';
import { pad } from './g7/pad.js';
import { tick as haptic } from '../haptics.js';
import { applyMoveAbilities } from './skills.js';

const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const wrap = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
const clamp = THREE.MathUtils.clamp;
const easeOut = (t) => 1 - (1 - t) ** 3, easeIn = (t) => t * t;
// horizontal FOV setting (at 16:9) -> vertical lens; phones held upright keep at least 75° vertical
const vFov = (h, w, hgt) => { const v = 2 * Math.atan(Math.tan((h * Math.PI) / 360) / (16 / 9)) * 180 / Math.PI; return hgt > w ? Math.max(75, v) : v; };

export function createGamePlayer({ camera, hud, colliders = null, ground = () => 0, env = null, gravity = 9.81, start = { x: 0, z: 0, yaw: 0 }, bounds = null, solidKinds = ['solid', 'water'], onStep = null, speedScale = 1, jumpScale = 1 }) {
  const M = MOVE;
  let E = env || {};
  const top = (x, z, y) => (E.top ? E.top(x, z, y) : ground(x, z));
  const solid = (x, y, z) => (E.solid ? E.solid(x, y, z) : false);
  const pos = new THREE.Vector3(start.x, top(start.x, start.z, 1e4), start.z);
  const vel = new THREE.Vector3();
  const look = { yaw: start.yaw || 0, pitch: -0.08, ty: start.yaw || 0, tp: -0.08, smooth: 0 };
  const cam = { get yaw() { return look.yaw + Math.PI; }, get pitch() { return -look.pitch; }, t: 0 };
  const S = { grounded: true, coyote: 0, jumpBuf: 0, airJumps: M.airJumps, crouch: false, sliding: false, slideCd: 0, mantle: null, climbT: 0, gliding: false,
    sprintOn: false, dash: null, dashCharges: 2, dashT: 0, blocked: false, lastVy: 0, stepOff: 0, fall: 0, jumpHeld: false, jumpHeldT: 0 };
  let enabled = true, lock = 0, gesture = null, gestureT = 0, gestureDur = 0, gestureDone = null, firstCam = true;
  let eye = EYE, eyeTarget = EYE, bobPhase = 0, bobAmp = 0, strideAcc = 0, dip = 0, dipV = 0, roll = 0, fovKick = 0, fovSet = 0, speed = 0, burden = 1;
  const abilities = { glide: false, dash: false, doubleJump: false, climb: false };
  const listeners = {};
  const emit = (k, a) => { for (const fn of listeners[k] || []) { try { fn(a); } catch (e) { console.warn(e); } } };
  const holder = { holding: null };
  const character = {
    group: new THREE.Group(), head: new THREE.Group(), blob: null, height: EYE,
    get holding() { return holder.holding; }, hold(t) { holder.holding = t; }, update() {},
    rakeTip(out) { return out.set(pos.x + Math.sin(look.yaw) * 0.95, pos.y, pos.z + Math.cos(look.yaw) * 0.95); },
    handWorld(out) { return out.set(pos.x + Math.sin(look.yaw) * 0.45, pos.y + eye - 0.45, pos.z + Math.cos(look.yaw) * 0.45); },
  };
  // ---- input
  let virtual = null, crouchLatch = false, ext = { x: 0, y: 0 };
  // own listener (session.bindKeys clears onKey handlers whenever the keys are remapped)
  const anyKey = (list) => (list || []).some((c) => keyDown(c));
  addEventListener('keydown', (e) => {
    if (e.repeat || (e.target && /INPUT|TEXTAREA/.test(e.target.tagName))) return;
    if ((moveKeys.crouch || []).includes(e.code) && moveSettings.get('crouchToggle')) crouchLatch = !crouchLatch;
    if ((moveKeys.run || []).includes(e.code) && moveSettings.get('sprintToggle')) S.sprintOn = !S.sprintOn;
  });
  const padBtn = (a, d) => { const b = (settings.pad && settings.pad.buttons) || (settings.controls && settings.controls.pad && settings.controls.pad.buttons); return b && b[a] != null ? b[a] : d; };
  const padJump = () => padBtn('jump', 0);
  let lastPoll = performance.now();
  // the pause menu (BMSG-9's menu.js) is open: sticks drive the menu, and the mouse is let go
  const menuOpen = () => { const m = typeof document !== 'undefined' && document.getElementById('zen-menu'); const o = !!(m && !m.classList.contains('hidden')); if (o && document.pointerLockElement) { try { document.exitPointerLock(); } catch (e) { /* */ } } return o; };
  function input() {
    if (virtual) return { x: virtual.x, y: virtual.y, sprint: virtual.runK > 0.5, crouch: !!virtual.crouch, jump: !!virtual.jump };
    { const t = performance.now(); pad.poll((t - lastPoll) / 1000); lastPoll = t; }
    const padOn = pad.connected && !menuOpen();
    let x = 0, y = 0;
    if (anyKey(moveKeys.forward)) y += 1;
    if (anyKey(moveKeys.back)) y -= 1;
    if (anyKey(moveKeys.left)) x -= 1;
    if (anyKey(moveKeys.right)) x += 1;
    let l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; }
    let sprint = moveSettings.get('sprintToggle') ? S.sprintOn : anyKey(moveKeys.run);
    let crouch = moveSettings.get('crouchToggle') ? crouchLatch : anyKey(moveKeys.crouch);
    let jump = keyDown('Space');
    if (padOn && (pad.move.x || pad.move.y)) { x = pad.move.x; y = pad.move.y; }
    if (padOn) { if (pad.pressed('L3')) S.sprintOn = !S.sprintOn; if (pad.down('L3') || (S.sprintOn && Math.hypot(pad.move.x, pad.move.y) > 0.3)) sprint = true; if (pad.downIdx(padBtn('crouch', 1))) crouch = true; if (pad.downIdx(padJump())) jump = true; } // the jump press itself arrives as the 'jump' action (gamepad.js)
    if (hud && (hud.joy.x || hud.joy.y)) {
      x = hud.joy.x; y = hud.joy.y; l = Math.hypot(x, y);
      if (l < 0.12) { x = y = 0; } else if (l > 0.88) sprint = true; // push to the rim to run
    }
    if (ext.x || ext.y) { x = ext.x; y = ext.y; }
    if (touch.crouch) crouch = true;
    if (touch.jump) jump = true;
    if (moveSettings.get('autoSprint')) sprint = true;
    if (Math.hypot(x, y) < 0.1) S.sprintOn = S.sprintOn && moveSettings.get('sprintToggle') && !pad.connected ? S.sprintOn : false;
    return { x, y, sprint, crouch, jump };
  }
  const touch = { crouch: false, jump: false };
  // ---- collision helpers
  const blockedAt = (x, z, yFeet, rise) => {
    const t = top(x, z, yFeet + rise);
    if (t > yFeet + rise + 1e-3) return true;
    if (solid(x, yFeet + Math.max(rise, 0.55) + 0.05, z) || solid(x, yFeet + 1.15, z) || solid(x, yFeet + M.height - 0.05, z)) return true;
    return false;
  };
  const tryMove = (dx, dz, rise) => {
    let any = false;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.22));
    const sx = dx / steps, sz = dz / steps;
    for (let i = 0; i < steps; i++) {
      const r = M.radius, ox = Math.sign(sx) * r * 0.7, oz = Math.sign(sz) * r * 0.7;
      if (!blockedAt(pos.x + sx + ox, pos.z + sz + oz, pos.y, rise)) { pos.x += sx; pos.z += sz; continue; }
      any = true;
      if (sx && !blockedAt(pos.x + sx + ox, pos.z, pos.y, rise)) { pos.x += sx; vel.z *= 0.85; continue; }
      if (sz && !blockedAt(pos.x, pos.z + sz + oz, pos.y, rise)) { pos.z += sz; vel.x *= 0.85; continue; }
      vel.x *= 0.2; vel.z *= 0.2; break;
    }
    return any;
  };
  let envK = 1;
  const wish = new THREE.Vector3(), fwdFlat = new THREE.Vector3();
  function accelerate(wishSpeed, accel, dt, cap = Infinity) {
    const ws = Math.min(wishSpeed, cap);
    const cur = vel.x * wish.x + vel.z * wish.z, add = ws - cur;
    if (add <= 0) return;
    const a = Math.min(add, accel * wishSpeed * dt);
    vel.x += wish.x * a; vel.z += wish.z * a;
  }
  function friction(f, dt) {
    const sp = Math.hypot(vel.x, vel.z); if (sp < 1e-4) { vel.x = vel.z = 0; return; }
    const drop = Math.max(sp, M.stopSpeed) * f * dt, ns = Math.max(0, sp - drop) / sp;
    vel.x *= ns; vel.z *= ns;
  }
  const jumpV = () => Math.sqrt(2 * gravity * M.jumpHeight * jumpScale * Math.min(2.4, Math.sqrt(9.81 / gravity)));
  function doJump(k = 1) { vel.y = jumpV() * k; S.grounded = false; S.coyote = 0; S.jumpBuf = 0; onStep && onStep(pos, 0.7); }
  function startMantle(t, ax, az) {
    const rise = t - pos.y;
    S.mantle = { t: 0, dur: M.mantleTime * (0.55 + 0.45 * rise / M.mantleMax), x0: pos.x, y0: pos.y, z0: pos.z, x1: ax, y1: t, z1: az, keep: Math.max(Math.hypot(vel.x, vel.z) * 0.85, M.walk * speedScale * 0.75) };
    vel.set(0, 0, 0); S.sliding = false; S.gliding = false; S.climbT = 0;
    onStep && onStep(pos, 1.0); emit('mantle', { rise }); rumble(0.25, 0.1, 70);
  }
  // can she pull herself up onto something ahead? (a ledge between knee and above-head height)
  function ledgeAhead(maxRise) {
    const ax = pos.x + fwdFlat.x * (M.radius + 0.45), az = pos.z + fwdFlat.z * (M.radius + 0.45);
    const t = top(ax, az, pos.y + maxRise + 0.15);
    const rise = t - pos.y;
    if (!(rise > M.maxStep * 0.6 && rise <= maxRise)) return null;
    // a real ledge has room to stand and is roughly flat beyond the lip
    if (solid(ax, t + 0.5, az) || solid(ax, t + 1.5, az) || solid(pos.x, t + 1.5, pos.z)) return null;
    const t2 = top(ax + fwdFlat.x * 0.5, az + fwdFlat.z * 0.5, t + 0.6);
    if (t2 > t + 0.55) return null;
    return { t, ax: ax + fwdFlat.x * 0.12, az: az + fwdFlat.z * 0.12 };
  }
  function rumble(w, s, ms) { pad.rumble(w, s, ms); }
  // ---- main step
  function update(dt) {
    dt = Math.min(dt, 0.05);
    cam.t += dt; pad.poll(dt);
    if (pad.connected && !menuOpen()) look.ty -= pad.lookV.x * dt, look.tp = clamp(look.tp - pad.lookV.y * dt, -1.45, 1.42), (pad.lookV.x || pad.lookV.y) && (look.smooth = 0);
    const inp = enabled && lock <= 0 ? input() : { x: 0, y: 0, sprint: false, crouch: false, jump: false };
    if (lock > 0) lock -= dt;
    const jumpEdge = inp.jump && !S.jumpHeld; S.jumpHeldT = inp.jump ? S.jumpHeldT + dt : 0; S.jumpHeld = inp.jump;
    if (jumpEdge) S.jumpBuf = M.jumpBuffer;
    const h = look.yaw; fwdFlat.set(Math.sin(h), 0, Math.cos(h));
    // camera-relative wish direction: W is the crosshair's heading on the ground
    const iy = inp.y * (inp.y < 0 ? M.backK : 1), ix = inp.x * M.strafeK;
    wish.set(Math.sin(h) * iy - Math.cos(h) * ix, 0, Math.cos(h) * iy + Math.sin(h) * ix);
    const wl = Math.min(1, wish.length()); if (wl > 1e-3) wish.normalize();
    const sprinting = inp.sprint && inp.y > 0.3 && !S.crouch && !S.sliding;
    // mantle in progress: a short scripted pull-up
    if (S.mantle) {
      const m = S.mantle; m.t += dt / m.dur; const k = Math.min(1, m.t);
      pos.y = m.y0 + (m.y1 - m.y0) * easeOut(Math.min(1, k * 1.25));
      pos.x = m.x0 + (m.x1 - m.x0) * easeIn(k); pos.z = m.z0 + (m.z1 - m.z0) * easeIn(k);
      if (k >= 1) { vel.x = fwdFlat.x * m.keep; vel.z = fwdFlat.z * m.keep; vel.y = 0; S.mantle = null; S.grounded = true; S.airJumps = M.airJumps; onStep && onStep(pos, 0.8); }
      finishFrame(dt, false); return;
    }
    if (S.dash) { S.dash.t -= dt; if (S.dash.t <= 0) { const sp = Math.hypot(vel.x, vel.z), cap = M.sprint * speedScale * 1.15; if (sp > cap) { vel.x *= cap / sp; vel.z *= cap / sp; } S.dash = null; } }
    S.dashT = Math.max(0, S.dashT - dt); if (S.dashT === 0 && S.dashCharges < 2) { S.dashCharges++; if (S.dashCharges < 2) S.dashT = 1.4; }
    S.slideCd = Math.max(0, S.slideCd - dt);
    const g0 = top(pos.x, pos.z, pos.y + 0.05);
    // ---- crouch / slide
    const hsp = Math.hypot(vel.x, vel.z);
    if (inp.crouch && S.grounded && !S.sliding && hsp > M.slideMin * speedScale * 0.9 && S.slideCd <= 0 && !S.crouch) {
      S.sliding = true; S.slideCd = M.slideCooldown;
      const nsp = Math.min(M.slideCap * speedScale, hsp + M.slideBoost * speedScale);
      vel.x *= nsp / hsp; vel.z *= nsp / hsp; emit('slide', { speed: nsp }); rumble(0.2, 0.05, 120);
    }
    if (S.sliding && (!inp.crouch || Math.hypot(vel.x, vel.z) < M.crouch * speedScale + 0.5 || !S.grounded)) { S.sliding = false; S.crouch = inp.crouch && S.grounded; }
    if (!S.sliding) {
      const wantCrouch = inp.crouch && S.grounded;
      if (wantCrouch) S.crouch = true; else if (S.crouch && !solid(pos.x, pos.y + M.height + 0.05, pos.z)) S.crouch = false;
    }
    // ---- ground and air movement
    // the ground itself: mud slows and slips, ice skates, snow drags, water wades (sim/world.js feel())
    const GF = S.grounded && E.feel ? E.feel(pos.x, pos.z) : null;
    const grip = GF ? GF.friction : 1, gSpeed = GF ? GF.speed : 1, gAcc = GF ? GF.accel * Math.min(1, grip + 0.25) : 1;
    S.sink = GF ? GF.sink : 0;
    const base = (S.crouch ? M.crouch : sprinting ? M.sprint : M.walk) * speedScale * burden * gSpeed * envK; // envK: the world's air drag and cold (WorldRules.move)
    if (S.grounded) {
      if (S.sliding) {
        friction(M.slideFriction * Math.min(1.5, grip), dt);
        // slopes feed the slide: downhill keeps it going (and faster), uphill bleeds it off
        const gx = (top(pos.x + 0.6, pos.z, pos.y + 0.8) - top(pos.x - 0.6, pos.z, pos.y + 0.8)) / 1.2;
        const gz = (top(pos.x, pos.z + 0.6, pos.y + 0.8) - top(pos.x, pos.z - 0.6, pos.y + 0.8)) / 1.2;
        vel.x -= gx * gravity * 0.75 * dt; vel.z -= gz * gravity * 0.75 * dt;
        if (wl > 0) accelerate(0.8, 4, dt);
      } else if (!S.dash) {
        friction(M.friction * grip, dt);
        if (wl > 0) accelerate(base * wl, M.groundAccel * gAcc, dt);
      }
      if (S.jumpBuf > 0 && lock <= 0) { const wasSlide = S.sliding; S.sliding = false; S.crouch = false; doJump(); if (wasSlide) { const sp = Math.hypot(vel.x, vel.z) || 1; const k = Math.min(M.slideCap * speedScale * 1.05, sp + 0.6) / sp; vel.x *= k; vel.z *= k; } emit('jump', {}); }
    } else {
      // air: Source-style air acceleration (a small wish cap keeps momentum but lets her steer)
      if (wl > 0 && !S.dash) accelerate(base * wl, M.airAccel, dt, M.airWishCap);
      // coyote jump / double jump (redirects toward the stick like Titanfall's)
      if (S.jumpBuf > 0 && S.coyote > 0) { doJump(); emit('jump', {}); }
      else if (jumpEdge && abilities.doubleJump && S.airJumps > 0 && !S.gliding && !(S.blocked && inp.y > 0.3)) {
        if (abilities.spendJumpFuel && !abilities.spendJumpFuel()) { /* no fuel, no second jump */ }
        else {
          S.airJumps--; const sp = Math.max(Math.hypot(vel.x, vel.z), wl > 0 ? M.walk * speedScale : 0);
          if (wl > 0) { vel.x = wish.x * sp; vel.z = wish.z * sp; }
          doJump(M.doubleJumpK); emit('doubleJump', {}); rumble(0.15, 0.05, 60);
        }
      }
      // glide: hold jump while falling (once unlocked)
      const wantGlide = abilities.glide && inp.jump && vel.y < -0.5 && (S.airJumps === 0 || S.jumpHeldT > 0.25) && !S.climbing;
      if (wantGlide !== S.gliding) { S.gliding = wantGlide; emit(wantGlide ? 'glideStart' : 'glideEnd', {}); }
    }
    S.coyote = Math.max(0, S.coyote - dt); S.jumpBuf = Math.max(0, S.jumpBuf - dt);
    // ---- gravity
    if (!S.grounded) {
      if (S.gliding) {
        vel.y = Math.max(vel.y - gravity * 0.25 * dt, -1.7);
        const gs = 8.5 * speedScale, sp = Math.hypot(vel.x, vel.z);
        const dir = Math.atan2(vel.x, vel.z), want = look.yaw, nd = dir + wrap(want - dir) * (1 - Math.exp(-2.2 * dt));
        const ns = damp(sp, gs, 0.9, dt); vel.x = Math.sin(nd) * ns; vel.z = Math.cos(nd) * ns;
      } else if (!S.dash || !S.dash.air) vel.y -= gravity * dt;
    }
    // ---- move horizontally (walls stop her; low steps and walkable slopes don't)
    const hx = vel.x * dt, hz = vel.z * dt;
    const rise = S.grounded ? M.maxStep + Math.hypot(hx, hz) * M.maxSlope : 0.12;
    const yBefore = pos.y;
    S.blocked = (hx || hz) ? tryMove(hx, hz, rise) : false;
    if (colliders) { const ox = pos.x, oz = pos.z; colliders.resolve(pos, M.radius, solidKinds); if (Math.abs(pos.x - ox) + Math.abs(pos.z - oz) > 1e-4 && (inp.y > 0.3)) S.blocked = true; }
    if (bounds) { const dx = pos.x - bounds.cx, dz = pos.z - bounds.cz, d = Math.hypot(dx, dz); if (d > bounds.r) { pos.x = bounds.cx + (dx / d) * bounds.r; pos.z = bounds.cz + (dz / d) * bounds.r; } }
    // ---- mantle / wall climb
    if (inp.y > 0.3 && lock <= 0 && (S.blocked || !S.grounded)) {
      const auto = moveSettings.get('autoMantle');
      const L = (inp.jump || (!S.grounded && auto) || (S.blocked && auto && hsp > 1)) ? ledgeAhead(S.grounded ? Math.min(M.mantleMax, 1.3) + (inp.jump ? M.mantleMax - 1.3 : 0) : M.mantleMax) : null;
      if (L && (!S.grounded || inp.jump || L.t - pos.y < 1.35)) { startMantle(L.t, L.ax, L.az); finishFrame(dt, true); return; }
      // Apex-style wall climb: hold jump into a wall, she scrambles up a couple of metres
      if (!S.grounded && S.blocked && inp.jump && abilities.climb && S.climbT < M.climbTime && vel.y < M.climbSpeed) { S.climbT += dt; vel.y = M.climbSpeed; S.climbing = true; if (S.gliding) { S.gliding = false; emit('glideEnd', {}); } }
      else S.climbing = false;
    } else S.climbing = false;
    // ---- vertical: land, stick to slopes going down, step up smoothly
    const ny = pos.y + vel.y * dt;
    const g = top(pos.x, pos.z, Math.max(pos.y, ny) + (S.grounded ? M.maxStep + 0.05 : 0.08));
    if (S.grounded && vel.y <= 0) {
      const snap = 0.35 + Math.hypot(hx, hz) * 1.25;
      if (g >= pos.y - snap && g <= pos.y + rise + 0.05) { pos.y = g; vel.y = 0; }
      else { S.grounded = false; S.coyote = M.coyote; pos.y = ny; }
    } else if (ny <= g) {
      const impact = -vel.y;
      pos.y = g;
      if (!S.grounded) land(impact);
      vel.y = 0;
    } else {
      pos.y = ny;
      if (vel.y > 0 && solid(pos.x, pos.y + (S.crouch ? 1.2 : M.height) + 0.05, pos.z)) vel.y = Math.min(0, vel.y); // ceiling
    }
    // a step up becomes a smooth rise of the eye rather than a pop
    if (S.grounded) S.stepOff = clamp(S.stepOff + (yBefore - pos.y) * (pos.y > yBefore ? 1 : 0), -0.6, 0);
    void g0;
    finishFrame(dt, false);
  }
  function land(impact) {
    S.grounded = true; S.airJumps = M.airJumps; S.climbT = 0; S.climbing = false;
    if (S.gliding) { S.gliding = false; emit('glideEnd', {}); }
    if (impact > 2) {
      if (moveSettings.get('landDip')) dipV -= Math.min(3.2, impact * 0.32);
      onStep && onStep(pos, Math.min(1.8, 0.8 + impact * 0.12));
      if (impact > 6) { if (moveSettings.get('haptics')) haptic(impact > 10 ? 18 : 10); rumble(Math.min(1, impact / 14), Math.min(0.8, impact / 18), 90); }
      // landing while holding crouch at speed rolls straight into a slide
      emit('land', { impact });
    }
  }
  function finishFrame(dt, mantleStart) {
    void mantleStart;
    speed = Math.hypot(vel.x, vel.z);
    if (S.grounded && !S.sliding && speed > 0.4) {
      const stride = 0.72 + speed * 0.085;
      strideAcc += speed * dt; bobPhase += (speed * dt / stride) * Math.PI;
      if (strideAcc >= stride) { strideAcc -= stride; onStep && onStep(pos, Math.min(1.3, speed / (M.walk * speedScale))); }
    } else strideAcc = Math.min(strideAcc, 0.3);
    bobAmp = damp(bobAmp, S.grounded && !S.sliding && speed > 0.4 ? Math.min(1.2, speed / 4.5) : 0, 6, dt);
    // eye height: crouch / slide lower it; the step offset and landing dip spring back
    eyeTarget = (gesture === 'kneel' ? 1.05 : S.sliding ? M.slideEye : S.crouch ? M.crouchEye : EYE) - (S.sink || 0);
    eye = damp(eye, eyeTarget, S.sliding ? 14 : 9, dt);
    S.stepOff = damp(S.stepOff, 0, 16, dt);
    const k = 140, c = 2 * Math.sqrt(k) * 0.62; dipV += (-k * dip - c * dipV) * dt; dip += dipV * dt; dip = clamp(dip, -0.32, 0.12);
    // FOV kick: sprint, slide, dash, falling fast
    const fk = moveSettings.get('fovKick');
    const want = (S.dash ? M.fovDash : S.sliding ? M.fovSlide : speed > M.walk * speedScale + 0.5 ? M.fovSprint * Math.min(1, (speed - M.walk * speedScale) / 2.5) : 0) + (S.gliding ? 4 : 0);
    fovKick = damp(fovKick, want * fk, want > fovKick ? 7 : 4, dt);
    // lean: a touch of roll into strafes and slides
    const side = -(vel.x * Math.cos(look.yaw) - vel.z * Math.sin(look.yaw));
    const wantRoll = moveSettings.get('lean') ? clamp(-side / 9, -1, 1) * 0.018 + (S.sliding ? 0.045 : 0) : 0;
    roll = damp(roll, wantRoll, 6, dt);
    if (gesture) { gestureT += dt; if (gestureT >= gestureDur) { const d = gestureDone; gesture = null; gestureDone = null; if (d) d(); } }
  }
  const fwd = new THREE.Vector3();
  function updateCamera(dt) {
    const s = firstCam || look.smooth <= 0 ? 1 : 1 - Math.exp(-look.smooth * dt);
    look.yaw += wrap(look.ty - look.yaw) * s; look.pitch += (look.tp - look.pitch) * s;
    firstCam = false;
    let by = 0, bx = 0;
    const bobK = moveSettings.get('bob') ? (moveSettings.get('bobK') ?? 1) : 0; // head-bob strength from the settings
    if (bobK) { by = Math.abs(Math.sin(bobPhase)) * 0.022 * bobAmp * bobK; bx = Math.sin(bobPhase) * 0.012 * bobAmp * bobK; }
    const cx = Math.cos(look.yaw), sx = Math.sin(look.yaw);
    camera.position.set(pos.x + cx * bx, pos.y + eye + by + dip + S.stepOff, pos.z - sx * bx);
    fwd.set(Math.sin(look.yaw) * Math.cos(look.pitch), Math.sin(look.pitch), Math.cos(look.yaw) * Math.cos(look.pitch));
    camera.up.set(0, 1, 0);
    camera.lookAt(camera.position.x + fwd.x, camera.position.y + fwd.y, camera.position.z + fwd.z);
    let r = roll; if (bobK && bobAmp > 0.01) r += Math.sin(bobPhase) * 0.003 * bobAmp * bobK;
    if (r) camera.rotateZ(r);
    const w = innerWidth || 16, hh = innerHeight || 9;
    const fv = moveSettings.get('fovV'); // the settings screen's FOV is vertical degrees
    const f = (fv ? (hh > w ? Math.max(75, fv) : fv) : vFov(moveSettings.get('fov'), w, hh)) + fovKick;
    if (Math.abs(f - fovSet) > 0.01) { camera.fov = f; fovSet = f; camera.updateProjectionMatrix(); }
    void dt;
  }
  // gaze test kept from the calm walker (interactables are vertical cylinders)
  const Ep = new THREE.Vector3(), D = new THREE.Vector3();
  function gazeHit(a, gr = 0.5, gh = 0.8, reach = 3) {
    Ep.set(pos.x, pos.y + eye, pos.z);
    D.set(Math.sin(look.yaw) * Math.cos(look.pitch), Math.sin(look.pitch), Math.cos(look.yaw) * Math.cos(look.pitch));
    const ay = a.y != null ? a.y : ground(a.x, a.z);
    const hx = Math.hypot(D.x, D.z) || 1e-4, cxp = a.x - Ep.x, czp = a.z - Ep.z;
    const t = Math.max(0, (cxp * D.x + czp * D.z) / (hx * hx));
    const px = D.x * t - cxp, pz = D.z * t - czp, dxz = Math.hypot(px, pz), y = Ep.y + D.y * t;
    let hit = null;
    if (dxz < gr && y > ay - 0.25 && y < ay + gh + 0.15) hit = t * Math.hypot(hx, D.y);
    if (D.y < -0.05) { const tg = (Ep.y - ay) / -D.y; const gx = Ep.x + D.x * tg - a.x, gz = Ep.z + D.z * tg - a.z; if (Math.hypot(gx, gz) < gr + 0.12) { if (hit == null || tg < hit) hit = tg; } }
    if (hit == null) return null;
    if (Math.hypot(cxp, czp) > reach + gr) return null;
    return hit;
  }
  const api = {
    character, position: pos, velocity: vel, cam, abilities, state: S, touch,
    get heading() { return look.yaw; }, get pitch() { return look.pitch; }, get lookT() { return { yaw: look.ty, pitch: look.tp }; }, get speed() { return speed; }, get airborne() { return !S.grounded; },
    get busy() { return lock > 0 || !!gesture; }, get eye() { return eye; },
    get sliding() { return S.sliding; }, get gliding() { return S.gliding; }, get mantling() { return !!S.mantle; }, get crouching() { return S.crouch; },
    get fovKick() { return fovKick; },
    get burden() { return burden; }, set burden(v) { burden = Number.isFinite(+v) ? Math.max(0.4, Math.min(1, +v)) : 1; },
    ground, update, updateCamera, gazeHit,
    on(k, fn) { (listeners[k] = listeners[k] || []).push(fn); return () => { listeners[k] = listeners[k].filter((f) => f !== fn); }; },
    emit,
    setEnv(e) { E = e || {}; },
    get env() { return { top, solid }; },
    // drag look (touch / unlocked mouse): lightly smoothed. raw: pointer lock / gamepad, no lag.
    look(dx, dy, raw = false) { if (!raw) { dx *= lookPrefs.sens; dy *= lookPrefs.sens * (lookPrefs.invertY ? -1 : 1); } look.smooth = raw ? 0 : 26; look.ty -= dx; look.tp = clamp(look.tp - dy, -1.45, 1.42); },
    zoom() {},
    jump() { S.jumpBuf = M.jumpBuffer; if (!S.grounded) { S._tapJump = true; } },
    // a world or ability can push her: wind dash, grapple pull, launch pads
    impulse(x, y, z) { vel.x += x; vel.y += y; vel.z += z; if (y > 0.5) { S.grounded = false; S.coyote = 0; } },
    dash() {
      if (!abilities.dash || S.dashCharges <= 0 || S.mantle) return false;
      S.dashCharges--; if (S.dashT === 0) S.dashT = 1.4;
      const ix = (anyKey(moveKeys.right) ? 1 : 0) - (anyKey(moveKeys.left) ? 1 : 0), iy = (anyKey(moveKeys.forward) ? 1 : 0) - (anyKey(moveKeys.back) ? 1 : 0);
      let dx = wish.x, dz = wish.z; if (!ix && !iy && !(pad.move.x || pad.move.y) && !(hud && (hud.joy.x || hud.joy.y))) { dx = fwdFlat.x; dz = fwdFlat.z; }
      const sp = 14 * speedScale; vel.x = dx * sp; vel.z = dz * sp; const air = !S.grounded; if (air) vel.y = Math.max(vel.y, 1.2);
      S.dash = { t: 0.2, air }; S.sliding = false; emit('dash', { dx, dz }); rumble(0.3, 0.25, 110); return true;
    },
    get dashCharges() { return S.dashCharges; },
    setMoveInput(x, y) { ext.x = x; ext.y = y; },
    act(name, dur = 1.4) { gesture = name; gestureT = 0; gestureDur = dur * 0.75; lock = dur * 0.6; return new Promise((r) => { gestureDone = r; }); },
    teleport(x, z, yaw = look.yaw) { pos.set(x, top(x, z, 1e4), z); vel.set(0, 0, 0); S.mantle = null; S.grounded = true; look.yaw = look.ty = yaw; firstCam = true; },
    teleport3(x, y, z) { pos.set(x, y, z); vel.set(0, 0, 0); S.mantle = null; S.grounded = false; },
    setEnabled(on) { enabled = on; },
    step(dt, x, y, runK = 0, extra = {}) { virtual = { x, y, runK, ...extra }; update(dt); virtual = null; },
    sim(x, y, secs, runK = 0, dt = 1 / 30, extra = {}) { virtual = { x, y, runK, ...extra }; for (let t = 0; t < secs; t += dt) update(dt); virtual = null; for (let k = 0; k < 20; k++) update(dt); },
    aim(yaw, pitch = look.pitch) { look.yaw = look.ty = yaw; look.pitch = look.tp = pitch; firstCam = true; },
    lookAtPoint(x, y, z) { const dx = x - pos.x, dz = z - pos.z, dy = y - (pos.y + eye); look.yaw = look.ty = Math.atan2(dx, dz); look.pitch = look.tp = Math.atan2(dy, Math.hypot(dx, dz)); firstCam = true; },
    setCam(yaw, pitch = 0.2) { look.yaw = look.ty = yaw - Math.PI; look.pitch = look.tp = -pitch * 0.5; firstCam = true; },
    setVisible() {}, snapCamera() { firstCam = true; },
    setGravity(g) { gravity = g; }, get gravity() { return gravity; },
    setEnvSpeed(k) { envK = k; }, get envSpeed() { return envK; },
    facingDot(p) { const dx = p.x - pos.x, dz = p.z - pos.z, l = Math.hypot(dx, dz) || 1; return (dx * Math.sin(look.yaw) + dz * Math.cos(look.yaw)) / l; },
    // where the crosshair points (unit vector) and the eye position, for rays
    aimDir(out = new THREE.Vector3()) { return out.set(Math.sin(look.yaw) * Math.cos(look.pitch), Math.sin(look.pitch), Math.cos(look.yaw) * Math.cos(look.pitch)); },
    eyePos(out = new THREE.Vector3()) { return out.set(pos.x, pos.y + eye, pos.z); },
  };
  applyMoveAbilities(api);
  return api;
}
