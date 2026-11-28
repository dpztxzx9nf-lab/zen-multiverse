// Greybox Rattlers and the gun drops they leave. The server owns health, shots
// and loot ids; this just draws what it tells us and asks to pick a gun up.
import * as THREE from 'three';
import { gunSend, onGunNetOpen } from './gun-net.js';
import { addGun } from './gunplay.js';
import { rarityById } from './guns.js';

export function startRattlers({ scene, interact, hud } = {}) {
  const root = new THREE.Group(); root.name = 'rattlers';
  if (scene) scene.add(root);
  const rats = new Map();
  const drops = new Map();
  const sites = new Map();
  const mats = {};
  const mat = (hex, extra = {}) => { const k = hex + JSON.stringify(extra); return mats[k] || (mats[k] = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.78, metalness: 0.2, ...extra })); };

  function bodyMesh() {
    const g = new THREE.Group(); g.name = 'rattler';
    const cloth = mat('#5a3a28');
    const dark = mat('#2a2220');
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), cloth);
    head.position.y = 1.55;
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.55, 6, 8), cloth);
    torso.position.y = 1.05;
    const legs = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.5, 5, 8), dark);
    legs.position.y = 0.42;
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.55), dark);
    gun.position.set(0.22, 1.15, 0.2);
    for (const m of [head, torso, legs, gun]) { m.castShadow = true; m.frustumCulled = false; g.add(m); }
    return g;
  }

  function upsertRat(r) {
    let rec = rats.get(r.id);
    if (!rec) {
      rec = { m: r, g: bodyMesh() };
      root.add(rec.g);
      rats.set(r.id, rec);
    }
    rec.m = r;
    rec.g.position.set(r.x, r.y || 0, r.z);
    rec.g.rotation.y = r.yaw || 0;
    rec.g.visible = r.st !== 'dead';
    if (r.st === 'dead') rec.g.visible = false;
  }

  function dropKey(d) { return d.id; }
  function upsertDrop(d) {
    const k = dropKey(d);
    let rec = drops.get(k);
    if (d.claimed) {
      if (rec) {
        if (interact && rec.id) interact.remove(rec.id);
        if (rec.g && rec.g.parent) rec.g.parent.remove(rec.g);
        drops.delete(k);
      }
      return;
    }
    if (!rec) {
      const color = (d.gun && rarityById(d.gun.rarity).color) || '#c45c26';
      const g = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.22, 0.85), mat(color, { emissive: color, emissiveIntensity: 0.18, roughness: 0.5 }));
      g.castShadow = g.receiveShadow = true;
      g.name = 'gun-drop';
      root.add(g);
      const id = 'gun-drop-' + k;
      rec = { d, g, id };
      drops.set(k, rec);
      if (interact) {
        interact.add({
          id, at: () => g.position, r: 2.2, priority: 0.7,
          enabled: () => !!g.parent,
          actions: () => [{
            label: d.gun ? `Take ${d.gun.name}` : 'Take gun',
            icon: 'bag',
            run: () => { gunSend({ t: 'rt', k: 'loot', id: k }); },
          }],
        });
      }
    }
    rec.d = d;
    rec.g.position.set(d.x, (d.y || 0) + 0.2, d.z);
  }

  function applyDrops(list) {
    const keep = new Set();
    for (const d of list || []) { keep.add(d.id); upsertDrop(d); }
    for (const [k, rec] of [...drops]) if (!keep.has(k)) upsertDrop({ id: k, claimed: true });
  }

  function onMsg(m) {
    if (!m || m.t !== 'rt') return;
    if (m.k === 'st' || m.k === 'p') {
      const keep = new Set();
      for (const r of m.rats || []) { keep.add(r.id); upsertRat(r); }
      if (m.k === 'st') {
        for (const [id, rec] of [...rats]) if (!keep.has(id)) { if (rec.g.parent) rec.g.parent.remove(rec.g); rats.delete(id); }
      }
    }
    if (m.k === 'drops') applyDrops(m.drops);
    if (m.k === 'inv' && m.guns && window.__guns) window.__guns.setInv(m.guns);
    if (m.k === 'loot') {
      if (m.ok && m.gun) {
        addGun(m.gun);
        if (hud && hud.toast) hud.toast(`You pick up ${m.gun.name}.`, 'bag', 4200);
      } else if (m.why === 'taken' && hud && hud.toast) hud.toast('Someone already took that.', 'bag', 2800);
    }
  }

  function campPayload(site) {
    return {
      t: 'rt', k: 'camp',
      cx: site.cx, cz: site.cz, x: site.x, y: site.y || 0, z: site.z,
      tile: site.tile || null,
      starter: !!site.starter, type: site.type || 'rattler',
    };
  }

  function announce(site) {
    if (!site || (site.type !== 'rattler' && !site.starter)) return;
    const key = `${site.cx},${site.cz}`;
    sites.set(key, site);
    gunSend(campPayload(site));
  }

  function reannounce() {
    for (const site of sites.values()) gunSend(campPayload(site));
  }

  function attach(s) { if (s && !root.parent) s.add(root); }
  function clear() {
    for (const rec of rats.values()) if (rec.g.parent) rec.g.parent.remove(rec.g);
    for (const rec of drops.values()) {
      if (interact && rec.id) interact.remove(rec.id);
      if (rec.g && rec.g.parent) rec.g.parent.remove(rec.g);
    }
    rats.clear(); drops.clear(); sites.clear();
  }
  function dispose() {
    clear();
    if (root.parent) root.parent.remove(root);
    for (const m of Object.values(mats)) m.dispose();
  }

  const api = { onMsg, announce, reannounce, attach, clear, dispose, get rats() { return rats; } };
  onGunNetOpen(() => api.reannounce());
  window.__rattlers = api;
  return api;
}
