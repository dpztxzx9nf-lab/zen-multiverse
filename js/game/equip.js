// Held items: one shared slot system (the hotbar) that any world or feature plugs items into:
// tools now, weapons later. One item is equipped at a time; primary / secondary input (mouse
// buttons, pad triggers, touch buttons) goes to it together with the aim ray.
//
// The aim ray always starts at the camera and goes through the crosshair at screen centre, so it
// works unchanged in first person and with a third-person camera: `ray.start` is how far along
// the ray the player's eye is (ignore hits nearer than that: they are between camera and player),
// and reach is measured from there.
//
//   import { equip } from './equip.js';
//   equip.bindView(camera, player);
//   equip.register({ id: 'bow', label: 'bow', glyph: '🏹', order: 50, available: () => true,
//     primary(down, ray) { ... return true /* claimed */ }, secondary(down, ray) {}, update(dt, ray) {},
//     equip() {}, unequip() {}, held: optional THREE.Object3D for a view model / third-person hand });
//   equip.select('bow'); equip.cycle(+1); equip.on((cur) => ...);
import * as THREE from 'three';

const items = new Map();
const listeners = new Set();
let cur = null, camera = null, player = null;
const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Vector3();
const ray = { origin: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, 1), start: 0, eye: new THREE.Vector3() };
const emit = () => { for (const fn of listeners) { try { fn(cur); } catch (e) { /* */ } } };
const avail = (it) => !it.available || it.available() !== false;

export const equip = {
  register(item) { items.set(item.id, { order: 100, ...item }); if (!cur && avail(item)) equip.select(item.id); return item; },
  unregister(id) { const it = items.get(id); if (!it) return; if (cur === it) { it.unequip && it.unequip(); cur = null; } items.delete(id); emit(); },
  // the items you can hold right now, in hotbar order
  list() { return [...items.values()].filter(avail).sort((a, b) => a.order - b.order); },
  get current() { if (cur && !avail(cur)) { cur = null; } if (!cur) { const l = equip.list(); if (l.length) equip.select(l[0].id, true); } return cur; },
  get index() { return Math.max(0, equip.list().indexOf(equip.current)); },
  select(idOrIndex, quiet = false) {
    const l = equip.list(); const it = typeof idOrIndex === 'number' ? l[Math.max(0, Math.min(l.length - 1, idOrIndex))] : items.get(idOrIndex);
    if (!it || it === cur || !avail(it)) return cur;
    if (cur && cur.unequip) cur.unequip();
    cur = it; if (cur.equip) cur.equip();
    if (!quiet) emit(); return cur;
  },
  cycle(d) { const l = equip.list(); if (!l.length) return cur; const i = l.indexOf(equip.current); return equip.select(l[(i + d + l.length) % l.length].id); },
  on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  // the crosshair ray (camera centre), valid for first and third person
  bindView(cam, pl) { camera = cam; player = pl; },
  ray() {
    if (camera) { camera.updateMatrixWorld(); camera.getWorldPosition(_o); camera.getWorldDirection(_d); }
    else if (player) { player.eyePos(_o); player.aimDir(_d); }
    ray.origin.copy(_o); ray.dir.copy(_d).normalize();
    if (player && player.eyePos) { player.eyePos(_e); ray.eye.copy(_e); ray.start = Math.max(0, _e.sub(_o).dot(ray.dir)); } else { ray.eye.copy(_o); ray.start = 0; }
    return ray;
  },
  primary(down) { const c = equip.current; return !!(c && c.primary && c.primary(down, equip.ray())); },
  secondary(down) { const c = equip.current; return !!(c && c.secondary && c.secondary(down, equip.ray())); },
  update(dt) { const c = equip.current; if (c && c.update) c.update(dt, equip.ray()); },
};
