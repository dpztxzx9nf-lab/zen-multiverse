// Low-poly M4 test rifle. Hitscan fire goes through the signed ticket; the server
// ignores shots unless this session is dev-flagged. Recoil, reload, and a hitmarker
// live here so combat can be tried without a full gun system.
import * as THREE from 'three';
import { zen } from './settings.js';
import { devOn, devFire, devRtt, onDevChange, onDevHit } from './dev-mode.js';

const MAG = 30, RELOAD = 1.8, RATE = 8, RECOIL = 0.028;

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

export function startM4({ getCamera, getPlayer } = {}) {
  const gun = makeM4();
  gun.visible = false;
  let parent = null, ammo = MAG, reloading = 0, last = 0, kick = 0, hm = 0, holding = false;
  const ui = hud();

  function attach() {
    const cam = getCamera && getCamera();
    if (cam && cam !== parent) {
      if (parent) parent.remove(gun);
      cam.add(gun);
      gun.position.set(0.22, -0.18, -0.48);
      gun.rotation.set(0.04, 0.08, 0);
      parent = cam;
    }
  }

  function show(v) {
    gun.visible = !!v;
    ui.classList.toggle('on', !!v);
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
    kick = RECOIL;
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
    attach();
    const want = devOn();
    if (gun.visible !== want) show(want);
    if (!want) return;
    if (reloading > 0) {
      reloading -= dt;
      if (reloading <= 0) { reloading = 0; ammo = MAG; }
      paint();
    }
    if (holding) fire();
    kick *= Math.max(0, 1 - dt * 12);
    gun.position.y = -0.18 + kick * 0.6;
    gun.rotation.x = 0.04 + kick;
    if (hm > 0) { hm -= dt; if (hm <= 0) ui.querySelector('.hm').classList.remove('flash'); }
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

  let prev = performance.now();
  const loop = (now) => { tick(Math.min(0.05, (now - prev) / 1000)); prev = now; requestAnimationFrame(loop); };
  requestAnimationFrame(loop);

  return { gun, tick, fire, reload, hitmarker, get ammo() { return ammo; } };
}
