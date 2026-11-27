// Draw and collide jigsaw-grown POIs around the walker, and let you take the basic loot in them.
import * as THREE from 'three';
import { solid, bakeSolids, unbake } from '../solids-bake.js';
import { sitesNear, structureAt, clearJigsawCache, inFootprint } from './jigsaw.js';
import { itemInfo } from './store.js';

const PAINT = {
  halvorsen: { wall: '#c47a2a', trim: '#4a3a30', floor: '#6a4a32' },
  rattler: { wall: '#5a3a28', trim: '#2a2420', floor: '#3a2e24' },
  choir: { wall: '#2a8a92', trim: '#8a48a0', floor: '#1e3a42' },
  wreck: { wall: '#4a4540', trim: '#7a4a32', floor: '#3c3936' },
};

function rot(x, z, yaw) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return [x * c - z * s, x * s + z * c];
}

function fmtItems(items) {
  return Object.entries(items).map(([id, n]) => `${n} ${itemInfo(id).name.toLowerCase()}`).join(', ');
}

export function createJigsawView({ scene, colliders, interact, hud, game, ground, blocked, world, hub, lite }) {
  const root = new THREE.Group(); root.name = 'jigsaw'; scene.add(root);
  const live = new Map();
  const mats = {};
  const mat = (hex, extra = {}) => { const k = hex + JSON.stringify(extra); return mats[k] || (mats[k] = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.82, metalness: 0.18, ...extra })); };
  let announced = '';

  function hooks() {
    const W = world(); if (!W) return null;
    const h = hub && hub();
    return {
      ground, blocked, height: ground,
      biome: (x, z, y) => W.dominant(W.biomesAt(x, z, y)),
      hasSea: W.hasSea, sea: W.sea,
      hubX: h ? h.x : null, hubZ: h ? h.z : null,
    };
  }

  function lootKey(site, i) { return `${site.seed || ''}:${site.cx},${site.cz}:${i}`; }
  function taken(key) { const d = game.data.jigsawLoot || (game.data.jigsawLoot = {}); return !!d[key]; }
  function markTaken(key) { const d = game.data.jigsawLoot || (game.data.jigsawLoot = {}); d[key] = Date.now(); game.save && game.save(); }

  function build(site) {
    const pal = PAINT[site.type] || PAINT.rattler;
    const g = new THREE.Group(); g.name = `jigsaw-${site.type}-${site.cx}-${site.cz}`;
    for (const part of site.parts) {
      for (const b of part.piece.boxes) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(b.sx, b.sy, b.sz), mat(b.role === 'floor' ? pal.floor : b.role === 'spire' ? pal.trim : pal.wall));
        const [wx, wz] = rot(b.x, b.z, part.yaw);
        m.position.set(part.x + wx, part.y + b.y, part.z + wz);
        m.rotation.y = part.yaw;
        m.castShadow = m.receiveShadow = true;
        g.add(m);
      }
    }
    const crates = [];
    for (const loot of site.loot || []) {
      const key = lootKey(site, loot.i);
      if (taken(key)) continue;
      const crate = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.5, 0.55), mat(pal.trim));
      crate.position.set(loot.x, loot.y, loot.z);
      crate.castShadow = crate.receiveShadow = true;
      crate.name = 'jigsaw-loot';
      g.add(crate);
      const id = `jig-loot-${site.cx}-${site.cz}-${loot.i}`;
      interact.add({
        id, at: () => crate.position, r: 2.1, priority: 0.55,
        enabled: () => crate.parent === g,
        actions: () => [{
          label: `Take ${fmtItems(loot.items)}`,
          icon: 'bag',
          run: async () => {
            if (taken(key) || crate.parent !== g) return;
            for (const [item, n] of Object.entries(loot.items)) if (n) game.add(item, n);
            markTaken(key);
            g.remove(crate);
            const tag = `jigsaw-${site.cx}-${site.cz}`;
            unbake(colliders, tag);
            bakeSolids(g, colliders, { ground, tag });
            if (hud && hud.toast) hud.toast(`You take ${fmtItems(loot.items)}.`, 'bag', 4200);
          },
        }],
      });
      crates.push(id);
    }
    solid(g, { name: `jigsaw-${site.type}` });
    root.add(g);
    g.updateMatrixWorld(true);
    bakeSolids(g, colliders, { ground, tag: `jigsaw-${site.cx}-${site.cz}` });
    return { g, crates, site };
  }

  function drop(rec) {
    for (const id of rec.crates) if (interact.remove) interact.remove(id);
    unbake(colliders, `jigsaw-${rec.site.cx}-${rec.site.cz}`);
    root.remove(rec.g);
    rec.g.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); } });
  }

  function update(px, pz) {
    const W = world(), hks = hooks();
    if (!W || !hks) return;
    const want = sitesNear(W, px, pz, lite ? 140 : 200, hks);
    const keys = new Set(want.map((s) => `${s.cx},${s.cz}`));
    for (const [k, rec] of [...live]) if (!keys.has(k)) { drop(rec); live.delete(k); }
    for (const site of want) {
      const k = `${site.cx},${site.cz}`;
      if (!live.has(k)) live.set(k, build(site));
      if (inFootprint(site, px, pz) && announced !== k) {
        announced = k;
        const label = site.starter ? 'a Rattler camp' : (site.type === 'rattler' ? 'a Rattler camp' : site.type === 'choir' ? 'a Choir shrine' : site.type === 'wreck' ? 'a wreck' : 'a Halvorsen post');
        if (hud && hud.toast) hud.toast(`You reach ${label}.`, 'star', 4200);
      }
    }
  }

  function occupies(x, z) {
    const W = world(), hks = hooks();
    if (!W || !hks) return null;
    return structureAt(W, x, z, hks);
  }

  function clear() {
    for (const rec of live.values()) drop(rec);
    live.clear();
    clearJigsawCache();
    announced = '';
  }

  function dispose() {
    clear();
    scene.remove(root);
    for (const m of Object.values(mats)) m.dispose();
  }

  return { update, occupies, clear, dispose, get live() { return live; } };
}
