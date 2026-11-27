// 0.2.38: starter pistol and looted guns on the shared hotbar. Firing is
// server-authoritative (js/game/gun-net.js). The world model uses the same
// two-handed shoulder hold as the M4, with a rough maker-coloured mesh.
import * as THREE from 'three';
import { equip } from './equip.js';
import { setHotbarAmmo } from './g7/hotbar.js';
import { gunFire, gunRtt } from './gun-net.js';
import { publicGun, rarityById, MAKERS, GUN_TYPES, gunStats } from './guns.js';
import { bindWorldRifle, RIFLE_STOCK_Z, RIFLE_FORE_Z } from './m4.js';
import { setRifleOut, setRifleFiring, setRifleAiming, rifleBusy, rifleUseViewmodel } from './rifle-state.js';

const MAG_FALLBACK = 12;
const _sh = new THREE.Vector3(), _fwd = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
const _pocket = new THREE.Vector3(), _z = new THREE.Vector3(), _x = new THREE.Vector3(), _y = new THREE.Vector3();
const _mat = new THREE.Matrix4(), _qWorld = new THREE.Quaternion(), _qLocal = new THREE.Quaternion(), _grip = new THREE.Vector3(), _fore = new THREE.Vector3();
const worldSlots = new WeakMap();
const items = new Map(); // id -> { gun, ammo, reloading, last }
let holding = false, registered = false;

export function makeGunMesh(gun, { scale = 1 } = {}) {
  const g = new THREE.Group(); g.name = 'loot-gun';
  const typ = gun.type || 'pistol';
  const mk = MAKERS[gun.maker] || MAKERS.Scrapwright;
  const rare = rarityById(gun.rarity);
  const s = scale;
  const len = typ === 'shotgun' ? 0.62 : typ === 'rifle' ? 0.90 : 0.36;
  const stockZ = typ === 'pistol' ? 0.10 : typ === 'shotgun' ? 0.18 : RIFLE_STOCK_Z;
  const muzzleZ = stockZ - len;
  const col = new THREE.Color(mk.color);
  const metal = new THREE.MeshStandardMaterial({ color: col, roughness: 0.55, metalness: typ === 'Choirworks' ? 0.4 : 0.25, emissive: new THREE.Color(rare.color), emissiveIntensity: 0.08 });
  const dark = new THREE.MeshStandardMaterial({ color: '#2a2622', roughness: 0.8, metalness: 0.15 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.05 * s, typ === 'pistol' ? 0.08 * s : 0.10 * s, len * 0.55 * s), metal);
  body.position.set(0, 0.01 * s, (stockZ + muzzleZ) * 0.5 * s);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry((typ === 'shotgun' ? 0.018 : 0.012) * s, 0.012 * s, Math.max(0.12, len * 0.5) * s, 8), dark);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.02 * s, (muzzleZ + (typ === 'pistol' ? 0.04 : 0.08)) * s);
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.03 * s, 0.10 * s, 0.05 * s), dark);
  mag.position.set(0, -0.08 * s, 0);
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.02 * s, 0.03 * s, 0.04 * s), metal);
  sight.position.set(0, 0.07 * s, (stockZ + muzzleZ) * 0.2 * s);
  const grip = new THREE.Object3D(); grip.name = 'gun-grip'; grip.position.set(0, -0.08 * s, 0);
  const fore = new THREE.Object3D(); fore.name = 'gun-fore'; fore.position.set(0, -0.02 * s, typ === 'pistol' ? muzzleZ * 0.2 * s : RIFLE_FORE_Z * s);
  for (const m of [body, barrel, mag, sight]) { m.castShadow = true; m.frustumCulled = false; g.add(m); }
  g.add(grip); g.add(fore);
  g.userData.grip = grip; g.userData.foregrip = fore; g.userData.stockZ = stockZ;
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
  _pocket.copy(_sh).addScaledVector(_fwd, aim ? 0.07 : 0.05).addScaledVector(_up, aim ? 0.04 : 0.0);
  _z.copy(_fwd).negate();
  _x.crossVectors(_up, _z);
  if (_x.lengthSq() < 1e-6) _x.set(1, 0, 0); else _x.normalize();
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

function bindLoot(av, on, opts = {}) {
  if (!av) return;
  let slot = worldSlots.get(av);
  if (!on) {
    if (slot) { try { if (slot.hold.parent) slot.hold.removeFromParent(); } catch (e) { /* */ } worldSlots.delete(av); }
    return;
  }
  const gun = currentGun();
  if (!gun) { bindLoot(av, false); return; }
  if (!slot || slot.gid !== gun.id) {
    if (slot && slot.hold.parent) try { slot.hold.removeFromParent(); } catch (e) { /* */ }
    const mesh = makeGunMesh(gun);
    mesh.traverse((o) => { if (o.isMesh) { o.frustumCulled = false; o.castShadow = true; } });
    const hold = new THREE.Group(); hold.name = 'loot-world'; hold.frustumCulled = false;
    const grip = mesh.userData.grip;
    if (grip) mesh.position.copy(grip.position).multiplyScalar(-1);
    hold.add(mesh);
    slot = { hold, gun: mesh, gid: gun.id };
    worldSlots.set(av, slot);
  }
  const attach = () => {
    try {
      placeOnShoulder(av, slot.hold, slot.gun, opts);
      if (av.reach) {
        if (slot.gun.userData.grip) { slot.gun.userData.grip.getWorldPosition(_grip); av.reach('r', _grip); }
        if (slot.gun.userData.foregrip && gun && gun.type !== 'pistol') { slot.gun.userData.foregrip.getWorldPosition(_fore); av.reach('l', _fore); }
      }
    } catch (e) { /* */ }
  };
  if (av.ready && typeof av.ready.then === 'function' && !(av.rig && av.rig.bones)) av.ready.then(attach);
  else attach();
}

export function bindHeldGun(av, on, opts = {}) {
  // remotes only know that a gun is out, not which one; use the M4 hold as a stand-in
  const loot = on && !opts.remote && currentIsLoot();
  if (loot) { bindWorldRifle(av, false); bindLoot(av, true, opts); }
  else { bindLoot(av, false); bindWorldRifle(av, on, opts); }
}

function currentGun() {
  const c = equip.current;
  if (!c || !c.gun) return null;
  return c.gun;
}
function currentIsLoot() { const g = currentGun(); return !!(g && g.id && g.id !== 'm4'); }

function fire(gun, rec) {
  if (!gun || rec.reloading > 0 || rec.ammo <= 0) { if (gun && rec.ammo <= 0) reload(gun, rec); return; }
  const now = performance.now();
  const minMs = gun.stats && gun.stats.rpm ? Math.max(80, 1000 / gun.stats.rpm) : 120;
  if (now - rec.last < minMs) return;
  rec.last = now;
  rec.ammo--;
  paint(gun);
  const cam = window.__zenCam || null;
  // direction comes from the equip ray (camera through the crosshair)
  const ray = equip.ray();
  gunFire({ dx: ray.dir.x, dy: ray.dir.y, dz: ray.dir.z, ago: Math.min(1000, gunRtt() / 2), gun: gun.id });
  setRifleFiring(true);
  if (rec.ammo <= 0) reload(gun, rec);
}

function reload(gun, rec) {
  if (rec.reloading > 0) return;
  const mag = (gun.stats && gun.stats.mag) || MAG_FALLBACK;
  rec.reloading = (gun.stats && gun.stats.reload) || 1.5;
  paint(gun);
  setTimeout(() => { rec.reloading = 0; rec.ammo = mag; paint(gun); }, rec.reloading * 1000);
}

function paint(gun) {
  const rec = items.get(gun.id);
  if (!rec) return;
  const text = rec.reloading > 0 ? '…' : `${rec.ammo}/${(gun.stats && gun.stats.mag) || MAG_FALLBACK}`;
  setHotbarAmmo(gun.id, text);
}

function slotOf(gun) {
  const typ = GUN_TYPES[gun.type] || GUN_TYPES.pistol;
  const rare = rarityById(gun.rarity);
  const rec = items.get(gun.id) || { gun, ammo: (gun.stats && gun.stats.mag) || typ.mag, reloading: 0, last: 0 };
  rec.gun = gun; rec.stats = gun.stats || gunStats(gun);
  items.set(gun.id, rec);
  return {
    id: gun.id,
    order: gun.starter ? 20 : 21,
    glyph: typ.glyph || 'GN',
    label: () => gun.name || 'Gun',
    gun,
    ammo: () => (rec.reloading > 0 ? '…' : `${rec.ammo}/${rec.stats.mag}`),
    color: rare.color,
    available: () => true,
    equip() { setRifleOut(true); paint(gun); },
    unequip() { holding = false; setRifleFiring(false); setRifleAiming(false); if (!equip.list().some((it) => it.gun || it.id === 'm4')) setRifleOut(false); },
    primary(down) { holding = !!down; setRifleFiring(holding); if (holding) fire(gun, rec); return true; },
    update() { if (holding) fire(gun, rec); },
  };
}

export function setInventory(guns) {
  const keep = new Set((guns || []).map((g) => g.id));
  for (const id of [...items.keys()]) {
    if (!keep.has(id)) { equip.unregister(id); items.delete(id); }
  }
  for (const raw of guns || []) {
    const g = publicGun(raw);
    if (!g || !g.id) continue;
    if (!g.stats) g.stats = gunStats(g);
    if (!items.has(g.id)) {
      const rec = { gun: g, ammo: g.stats.mag, reloading: 0, last: 0 };
      items.set(g.id, rec);
      equip.register(slotOf(g));
    } else {
      const rec = items.get(g.id); rec.gun = g; rec.stats = g.stats;
      const it = equip.list().find((x) => x.id === g.id);
      if (it) it.gun = g;
    }
  }
  registered = true;
}

export function addGun(g) {
  if (!g) return;
  setInventory([...[...items.values()].map((r) => r.gun).filter((x) => x.id !== g.id), g]);
}

export function startGunplay() {
  window.__guns = { setInv: setInventory, add: addGun, items };
  return { setInventory, addGun, bindHeldGun };
}
