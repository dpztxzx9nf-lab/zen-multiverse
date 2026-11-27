// Low-poly M4. First person is a dedicated arms+gun viewmodel drawn in its own
// pass with its own FOV so it never clips the world, plus procedural sway, bob,
// turn lag, recoil, and a sprint pose. Third person and other players use a
// world model on the body rig with two-hand IK on the grip and foregrip.
// Hitscan fire still goes through the signed ticket; the server ignores shots
// unless this session is dev-flagged.
import * as THREE from 'three';
import { zen } from './settings.js';
import { devOn, devFire, devRtt, onDevChange, onDevHit } from './dev-mode.js';
import { gripIn } from './avatar/tools.js';
import { createMotion, stepMotion, VM_FOV } from './viewmodel-motion.js';
import { setViewmodelPass } from './viewmodel-pass.js';
import { setRifleOut, rifleOut, rifleFirstPerson } from './rifle-state.js';

const MAG = 30, RELOAD = 1.8, RATE = 8, RECOIL = 0.028;
const _fore = new THREE.Vector3();
const worldSlots = new WeakMap();

export function makeM4() {
  const g = new THREE.Group(); g.name = 'm4';
  const mat = (c) => new THREE.MeshLambertMaterial({ color: c });
  const box = (w, h, d, c, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(c));
    m.position.set(x, y, z); m.castShadow = false; g.add(m); return m;
  };
  box(0.06, 0.07, 0.22, 0x2a2d28, 0, 0, 0);          // receiver
  box(0.04, 0.04, 0.32, 0x3a3d38, 0, 0.01, -0.24);   // barrel
  box(0.05, 0.06, 0.14, 0x1c1e1b, 0, -0.01, 0.16);   // stock
  box(0.03, 0.1, 0.04, 0x252820, 0, -0.07, 0.04);    // mag
  box(0.02, 0.03, 0.06, 0x1a1c18, 0.0, -0.05, -0.02); // grip
  box(0.012, 0.02, 0.08, 0x111, 0, 0.05, -0.02);     // sight
  const grip = new THREE.Object3D(); grip.name = 'm4-grip'; grip.position.set(0, -0.08, 0.02); g.add(grip);
  const fore = new THREE.Object3D(); fore.name = 'm4-foregrip'; fore.position.set(0, -0.02, -0.18); g.add(fore);
  g.userData.grip = grip; g.userData.foregrip = fore;
  return g;
}

function makeArms(skin = 0xe3a985) {
  const g = new THREE.Group(); g.name = 'vm-arms';
  const mat = new THREE.MeshLambertMaterial({ color: skin });
  const limb = (w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = false; m.frustumCulled = false; g.add(m);
    return m;
  };
  // camera at the origin looking down -Z; gun rest sits around (0.16, -0.15, -0.42)
  limb(0.07, 0.07, 0.28, 0.22, -0.22, -0.26, 0.35, 0.15, 0.08);   // right forearm
  limb(0.055, 0.045, 0.08, 0.18, -0.16, -0.40, 0.1, 0, 0.2);       // right hand
  limb(0.065, 0.065, 0.26, -0.04, -0.20, -0.34, 0.25, -0.2, -0.15); // left forearm
  limb(0.05, 0.045, 0.07, 0.00, -0.15, -0.50, 0.1, 0, -0.15);      // left hand
  return g;
}

function hud() {
  let el = document.getElementById('zen-m4-hud');
  if (el) return el;
  el = document.createElement('div'); el.id = 'zen-m4-hud';
  el.innerHTML = '<i class="hm"></i><b class="ammo"></b>';
  document.body.appendChild(el);
  return el;
}

// World-space rifle on a body rig: right hand on the pistol grip, left hand
// IK'd to the foregrip. Used for the local third-person view and for remotes.
export function bindWorldRifle(av, on) {
  if (!av) return;
  let slot = worldSlots.get(av);
  if (!on) {
    if (slot) {
      try { av.detach(slot.hold); } catch (e) { /* */ }
      worldSlots.delete(av);
    }
    return;
  }
  if (!slot) {
    const gun = makeM4();
    const hold = new THREE.Group(); hold.name = 'm4-world';
    const grip = gun.userData.grip;
    gun.position.copy(grip.position).multiplyScalar(-1);
    hold.add(gun);
    slot = { hold, gun };
    worldSlots.set(av, slot);
    const pose = gripIn('r');
    const attach = () => { try { av.attach(hold, 'hand_r', pose); } catch (e) { /* */ } };
    if (av.ready && typeof av.ready.then === 'function') av.ready.then(attach);
    else attach();
  }
  if (av.reach && slot.gun.userData.foregrip) {
    try {
      if (av.group && av.group.updateMatrixWorld) av.group.updateMatrixWorld(true);
      slot.gun.userData.foregrip.getWorldPosition(_fore);
      av.reach('l', _fore);
    } catch (e) { /* */ }
  }
}

export function startM4({ getCamera, getPlayer, getScene } = {}) {
  const root = new THREE.Group(); root.name = 'm4-viewmodel'; root.frustumCulled = false;
  const arms = makeArms();
  const gun = makeM4();
  gun.position.set(0, 0, 0);
  root.add(arms, gun);
  const vmScene = new THREE.Scene();
  vmScene.add(new THREE.AmbientLight(0xffffff, 0.75));
  const key = new THREE.DirectionalLight(0xfff2d8, 0.9); key.position.set(0.4, 0.8, 0.6); vmScene.add(key);
  vmScene.add(root);
  const vmCam = new THREE.PerspectiveCamera(VM_FOV, 1, 0.04, 3);
  const motion = createMotion();
  let ammo = MAG, reloading = 0, last = 0, hm = 0, holding = false, pendingKick = 0;
  const ui = hud();
  const size = new THREE.Vector2();

  function show(v) {
    root.visible = !!v;
    ui.classList.toggle('on', !!v);
    setRifleOut(!!v);
    if (v) paint(); else ui.querySelector('.hm').classList.remove('flash');
  }

  function paint() {
    const a = ui.querySelector('.ammo');
    a.textContent = reloading > 0 ? '…' : `${ammo} / ${MAG}`;
  }

  function reload() {
    if (!devOn() || reloading > 0 || ammo >= MAG) return;
    reloading = RELOAD;
    paint();
  }

  function fire() {
    if (!devOn() || reloading > 0 || ammo <= 0) { if (devOn() && ammo <= 0) reload(); return; }
    const now = performance.now();
    if (now - last < 1000 / RATE) return;
    last = now;
    ammo--;
    pendingKick = RECOIL;
    const p = getPlayer && getPlayer();
    const cam = getCamera && getCamera();
    let dx = 0, dy = 0, dz = -1;
    const d = new THREE.Vector3();
    if (cam) { cam.getWorldDirection(d); dx = d.x; dy = d.y; dz = d.z; }
    else if (p) {
      const yaw = p.heading || 0, pit = p.pitch || 0;
      dx = Math.sin(yaw) * Math.cos(pit); dy = Math.sin(pit); dz = Math.cos(yaw) * Math.cos(pit);
    }
    if (p && p.aim) p.aim((p.heading || 0) + (Math.random() - 0.5) * 0.012, (p.pitch || 0) + RECOIL);
    devFire({ dx, dy, dz, ago: Math.min(1000, devRtt() / 2) });
    paint();
    if (ammo <= 0) reload();
  }

  function tick(dt) {
    const want = devOn();
    if (root.visible !== want) show(want);
    else setRifleOut(want);
    if (!want) return;
    if (reloading > 0) {
      reloading -= dt;
      if (reloading <= 0) { reloading = 0; ammo = MAG; }
      paint();
    }
    if (holding) fire();
    const p = getPlayer && getPlayer();
    const pose = stepMotion(motion, {
      dt,
      speed: p && p.speed || 0,
      yaw: p && p.heading || 0,
      pitch: p && p.pitch || 0,
      sprinting: !!(p && (p.sprinting || p.speed > 6)),
      kick: pendingKick,
    });
    pendingKick = 0;
    root.position.set(pose.x, pose.y, pose.z);
    root.rotation.set(pose.rx, pose.ry, pose.rz);
    if (hm > 0) { hm -= dt; if (hm <= 0) ui.querySelector('.hm').classList.remove('flash'); }
  }

  function draw(renderer) {
    if (!rifleOut() || !rifleFirstPerson() || !root.visible) return;
    const cam = getCamera && getCamera();
    if (cam && cam.aspect) vmCam.aspect = cam.aspect;
    else {
      renderer.getDrawingBufferSize(size);
      if (size.y) vmCam.aspect = size.x / size.y;
    }
    vmCam.updateProjectionMatrix();
    const prevAuto = renderer.autoClear;
    const prevColor = renderer.autoClearColor;
    const prevDepth = renderer.autoClearDepth;
    const shadows = renderer.shadowMap && renderer.shadowMap.enabled;
    renderer.autoClear = false;
    renderer.autoClearColor = false;
    renderer.autoClearDepth = false;
    if (renderer.shadowMap) renderer.shadowMap.enabled = false;
    renderer.clearDepth();
    renderer.render(vmScene, vmCam);
    renderer.autoClear = prevAuto;
    renderer.autoClearColor = prevColor;
    renderer.autoClearDepth = prevDepth;
    if (renderer.shadowMap) renderer.shadowMap.enabled = shadows;
  }

  function hitmarker() {
    hm = 0.25;
    ui.querySelector('.hm').classList.add('flash');
  }

  zen.onAction((name, down) => {
    if (name === 'use1') { holding = !!down && devOn(); if (holding) fire(); }
    if (!devOn()) return;
    if ((name === 'alt' || name === 'use2') && down) reload();
  });
  addEventListener('keydown', (e) => {
    if (!devOn() || e.repeat) return;
    if (e.code === 'KeyR') { e.preventDefault(); reload(); }
  });
  onDevChange(({ on }) => { if (on) { ammo = MAG; reloading = 0; paint(); } else holding = false; show(on); });
  onDevHit(() => hitmarker());

  setViewmodelPass(draw);

  let prev = performance.now();
  const loop = (now) => {
    try { tick(Math.min(0.05, (now - prev) / 1000)); } catch (e) { console.warn('[m4]', e); }
    prev = now; requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  return { gun, root, tick, fire, reload, hitmarker, draw, get ammo() { return ammo; } };
}
