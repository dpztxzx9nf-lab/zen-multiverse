// Low-poly M4. First person is a dedicated arms+gun viewmodel drawn in its own
// pass with its own FOV so it never clips the world, plus procedural sway, bob,
// turn lag, recoil, and a sprint pose. Third person and other players use a
// world model mounted at the shoulder (stock in the pocket, barrel forward)
// with both hands IK'd to the grip and foregrip. Hitscan fire still goes
// through the signed ticket; the server ignores shots unless this session is
// dev-flagged.
import * as THREE from 'three';
import { zen } from './settings.js';
import { devOn, devFire, devRtt, onDevChange, onDevHit } from './dev-mode.js';
import { createMotion, stepMotion, VM_FOV } from './viewmodel-motion.js';
import { setViewmodelPass } from './viewmodel-pass.js';
import { setRifleOut, rifleUseViewmodel, setRifleAiming, setRifleFiring } from './rifle-state.js';
import { equip } from './equip.js';
import { setHotbarAmmo } from './g7/hotbar.js';

const MAG = 30, RELOAD = 1.8, RATE = 8, RECOIL = 0.028;

// World-model length is a short carbine (~0.9 m). Positions are in metres, origin at the pistol grip.
// +Z is toward the stock, -Z is toward the muzzle (Three.js camera convention).
export const RIFLE_STOCK_Z = 0.28;
export const RIFLE_MUZZLE_Z = -0.62;
export const RIFLE_LENGTH = RIFLE_STOCK_Z - RIFLE_MUZZLE_Z; // 0.90
export const RIFLE_FORE_Z = -0.28;

const _grip = new THREE.Vector3();
const _fore = new THREE.Vector3();
const _sh = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _qWorld = new THREE.Quaternion();
const _qLocal = new THREE.Quaternion();
const _mat = new THREE.Matrix4();
const _pocket = new THREE.Vector3();
const worldSlots = new WeakMap();

export function makeM4({ scale = 1 } = {}) {
  const g = new THREE.Group(); g.name = 'm4';
  const s = scale;
  const mat = (c) => new THREE.MeshLambertMaterial({ color: c });
  const box = (w, h, d, c, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w * s, h * s, d * s), mat(c));
    m.position.set(x * s, y * s, z * s); m.castShadow = false; m.frustumCulled = false; g.add(m); return m;
  };
  // mid greys so the rifle stays readable against a light suit and a bright sky
  box(0.07, 0.08, 0.28, 0x5a5e58, 0, 0.04, -0.02);           // receiver
  box(0.03, 0.03, 0.38, 0x4a4e4a, 0, 0.05, -0.43);           // barrel
  box(0.06, 0.07, 0.26, 0x6a6864, 0, 0.03, 0.16);            // stock
  box(0.035, 0.13, 0.05, 0x3a3e36, 0, -0.08, 0.02);          // mag
  box(0.03, 0.10, 0.055, 0x4a4c46, 0, -0.09, 0.0);           // pistol grip
  box(0.016, 0.03, 0.10, 0x3a3c38, 0, 0.10, -0.04);          // sight
  box(0.045, 0.045, 0.22, 0x4e524c, 0, 0.02, -0.28);         // handguard
  const grip = new THREE.Object3D(); grip.name = 'm4-grip'; grip.position.set(0, -0.10 * s, 0); g.add(grip);
  const fore = new THREE.Object3D(); fore.name = 'm4-foregrip'; fore.position.set(0, -0.03 * s, RIFLE_FORE_Z * s); g.add(fore);
  g.userData.grip = grip; g.userData.foregrip = fore;
  g.userData.stockZ = RIFLE_STOCK_Z * s;
  g.userData.muzzleZ = RIFLE_MUZZLE_Z * s;
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

function placeOnShoulder(av, hold, gun, { aim = false, pitch = 0 } = {}) {
  const bones = av.rig && av.rig.bones;
  const group = av.group;
  if (!bones || !group) return false;
  const shoulder = bones.clavicle_r || bones.upperarm_r || bones.spine_03;
  if (!shoulder) return false;
  group.updateMatrixWorld(true);
  if (hold.parent !== group) group.add(hold);
  hold.scale.set(1, 1, 1);
  shoulder.getWorldPosition(_sh);
  const root = av.rig.root || group;
  _fwd.set(0, 0, 1).transformDirection(root.matrixWorld).normalize();
  const usePitch = aim ? pitch : (Math.min(pitch, 0) * 0.25 - 0.12);
  _fwd.multiplyScalar(Math.cos(usePitch)).addScaledVector(_up, Math.sin(usePitch)).normalize();
  // stock pocket: at the right clavicle, a little forward and down
  _pocket.copy(_sh).addScaledVector(_fwd, aim ? 0.07 : 0.05).addScaledVector(_up, aim ? 0.04 : 0.0);
  // hold origin is the pistol grip; the stock end sits STOCK_Z along +Z of the gun, so
  // +Z of the gun points from muzzle to stock = opposite the aim direction.
  _z.copy(_fwd).negate();
  _x.crossVectors(_up, _z);
  if (_x.lengthSq() < 1e-6) _x.set(1, 0, 0);
  else _x.normalize();
  _y.crossVectors(_z, _x).normalize();
  _mat.makeBasis(_x, _y, _z);
  _qWorld.setFromRotationMatrix(_mat);
  const stockZ = (gun.userData.stockZ || RIFLE_STOCK_Z);
  _grip.copy(_pocket).addScaledVector(_z, -stockZ);
  group.worldToLocal(_grip);
  hold.position.copy(_grip);
  group.getWorldQuaternion(_qLocal);
  hold.quaternion.copy(_qLocal.invert()).multiply(_qWorld);
  hold.updateMatrixWorld(true);
  return true;
}

// World-space rifle on a body rig: stock at the right shoulder, barrel forward,
// both hands IK'd to the pistol grip and foregrip. Used for the local third-person
// view and for remotes.
export function bindWorldRifle(av, on, opts = {}) {
  if (!av) return;
  let slot = worldSlots.get(av);
  if (!on) {
    if (slot) {
      try { if (slot.hold.parent) slot.hold.removeFromParent(); } catch (e) { /* */ }
      worldSlots.delete(av);
    }
    return;
  }
  if (!slot) {
    const gun = makeM4();
    gun.traverse((o) => { if (o.isMesh) { o.frustumCulled = false; o.castShadow = true; } });
    const hold = new THREE.Group(); hold.name = 'm4-world'; hold.frustumCulled = false;
    // origin of the hold group is the pistol grip
    const grip = gun.userData.grip;
    gun.position.copy(grip.position).multiplyScalar(-1);
    hold.add(gun);
    slot = { hold, gun };
    worldSlots.set(av, slot);
  }
  const attach = () => {
    try {
      placeOnShoulder(av, slot.hold, slot.gun, opts);
      if (av.reach) {
        if (slot.gun.userData.grip) {
          slot.gun.userData.grip.getWorldPosition(_grip);
          av.reach('r', _grip);
        }
        if (slot.gun.userData.foregrip) {
          slot.gun.userData.foregrip.getWorldPosition(_fore);
          av.reach('l', _fore);
        }
      }
    } catch (e) { /* */ }
  };
  if (av.ready && typeof av.ready.then === 'function' && !(av.rig && av.rig.bones)) av.ready.then(attach);
  else attach();
}

export function startM4({ getCamera, getPlayer, getScene } = {}) {
  const root = new THREE.Group(); root.name = 'm4-viewmodel'; root.frustumCulled = false;
  const arms = makeArms();
  const gun = makeM4({ scale: 0.5 });
  gun.position.set(0, 0, 0);
  root.add(arms, gun);
  const vmScene = new THREE.Scene();
  vmScene.add(new THREE.AmbientLight(0xffffff, 0.75));
  const key = new THREE.DirectionalLight(0xfff2d8, 0.9); key.position.set(0.4, 0.8, 0.6); vmScene.add(key);
  vmScene.add(root);
  const vmCam = new THREE.PerspectiveCamera(VM_FOV, 1, 0.04, 3);
  const motion = createMotion();
  let ammo = MAG, reloading = 0, last = 0, holding = false, pendingKick = 0, equipped = false, registered = false;
  const size = new THREE.Vector2();

  function paint() {
    setHotbarAmmo('m4', equipped ? (reloading > 0 ? '…' : `${ammo}/${MAG}`) : '');
  }

  function setEquipped(on) {
    equipped = !!on && devOn();
    root.visible = equipped;
    setRifleOut(equipped);
    if (!equipped) { setRifleAiming(false); setRifleFiring(false); }
    paint();
  }

  function reload() {
    if (!equipped || reloading > 0 || ammo >= MAG) return;
    reloading = RELOAD;
    paint();
  }

  function fire() {
    if (!equipped || reloading > 0 || ammo <= 0) { if (equipped && ammo <= 0) reload(); return; }
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

  function register() {
    if (registered) return;
    registered = true;
    equip.register({
      id: 'm4', order: 40, glyph: 'M4', label: 'M4',
      available: () => devOn(),
      ammo: () => (reloading > 0 ? '…' : `${ammo}/${MAG}`),
      equip() { setEquipped(true); },
      unequip() { holding = false; setEquipped(false); },
      primary(down) { holding = !!down && equipped; setRifleFiring(holding); if (holding) fire(); return true; },
      secondary(down) { if (!equipped) return false; setRifleAiming(!!down); return true; },
    });
  }

  function tick(dt) {
    if (devOn()) register();
    const want = devOn() && equip.current && equip.current.id === 'm4';
    if (equipped !== want) setEquipped(want);
    else setRifleOut(want);
    if (!want) { setRifleAiming(false); setRifleFiring(false); setHotbarAmmo('m4', ''); return; }
    setRifleFiring(!!holding);
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
  }

  function draw(renderer) {
    if (!rifleUseViewmodel() || !root.visible) return;
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

  function hitmarker() { if (zen.hitmarker) zen.hitmarker('hit'); }

  zen.onAction((name, down) => {
    if (!equipped) {
      if (name === 'use2') setRifleAiming(false);
      if (name === 'use1') setRifleFiring(false);
      return;
    }
    if (name === 'use1') { holding = !!down; setRifleFiring(holding); if (holding) fire(); }
    if (name === 'use2') setRifleAiming(!!down);
    if (name === 'alt' && down) reload();
  });
  addEventListener('keydown', (e) => {
    if (!equipped || e.repeat) return;
    if (e.code === 'KeyR') { e.preventDefault(); reload(); }
  });
  onDevChange(({ on }) => {
    if (on) { register(); ammo = MAG; reloading = 0; if (!equip.current || equip.current.id !== 'm4') equip.select('m4'); paint(); }
    else { holding = false; setRifleAiming(false); setRifleFiring(false); setEquipped(false); }
  });
  onDevHit(() => hitmarker());
  if (devOn()) register();

  setViewmodelPass(draw);

  let prev = performance.now();
  const loop = (now) => {
    try { tick(Math.min(0.05, (now - prev) / 1000)); } catch (e) { console.warn('[m4]', e); }
    prev = now; requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  return { gun, root, tick, fire, reload, hitmarker, draw, get ammo() { return ammo; } };
}
