// Xenia's Home Valley hub: everything that used to live in the separate garden world, now on the planet
// itself, in the hub frame (js/xenia/xenia.js: tile 'hub', x east, z south, metres from the old garden's
// middle, so every old garden coordinate is still the same spot). planet.js mounts it on Xenia and shows it
// only while the scene is in the hub frame.
//   Mom's pond, the raked sand and the bonsai (the garden's heart, at the middle of the spawn town)
//   the places (js/game/places.js): ruins, lookout hill, wreck, cove, sea cave, the camps' seals
//   the salt cove and the sea cave (js/game/cove.js) at the head of the sound, with its own still water
//   fishing at the cove (shared stock online), the hares and the fox (js/game/fauna-view.js)
// The Wardens, the Reavers (js/factions/client.js) and Ula's walk / the vault (js/compete.js) are global
// overlays: they show themselves whenever the scene is in the hub frame.
import * as THREE from 'three';
import { createColliders } from '../colliders.js';
import { createPlaces } from '../game/places.js';
import { createCove } from '../game/cove.js';
import { createFishing } from '../game/water/fishing.js';
import { createFaunaView } from '../game/fauna-view.js';
import { atCove } from '../places.js';
import { COVE, HEAD } from '../cove.js';
import { WORLD_SPAWN } from '../spawn.js';
import { HUB_PADS } from './xenia.js';

const GARDEN_R = 60; // the old garden's footprint around its middle: no wild flora in here

export async function createHub({ scene, camera, P, renderer, hud, interact, player, game, audio, equip, ground, colliders }) {
  const lite = !!(P && P.lite) || P.cls !== 'pc';
  const hc = createColliders();
  let on = false;
  // ---- the garden's heart: Mom's pond, the raked sand, the bonsai on its stand
  const [{ createPond, POND }, { createSand, SAND }, { createBonsai }] = await Promise.all([import('../pond.js'), import('../sand.js'), import('../bonsai.js')]);
  const garden = new THREE.Group(); garden.name = 'hub-garden'; scene.add(garden);
  const before = new Set(scene.children);
  const sand = createSand(scene, { P, renderer });
  const pond = createPond(scene, renderer, { P });
  const bonsai = createBonsai(scene, { position: new THREE.Vector3(1.5, 0, -7.2), scale: 0.36, standH: 0.8, detail: P.bonsaiDetail, hitBoost: P.touch ? 1.4 : 1.05 });
  for (const o of [...scene.children]) if (!before.has(o) && o !== garden) garden.attach(o); // keep them together (one switch)
  pond.stones.visible = true;
  if (pond.setReflection) pond.setReflection(false);
  hc.shape((x, z) => POND.dist(x, z) - 0.42, { h: 0.4, kind: 'water', name: 'pond' });
  hc.circle(1.5, -7.2, 1.2, { h: 1.2, name: 'bonsai' });
  const SAND_GROUND = (x, z) => (Math.abs(x - SAND.cx) < SAND.w / 2 && Math.abs(z - SAND.cz) < SAND.d / 2 ? 0.09 : null);

  // ---- places, the cove, fishing, animals
  const places = createPlaces({ scene, pc: hc, interact, hud, game, ground });
  const cove = createCove({ scene, camera, hud, lite });
  { const bed = cove.root.getObjectByName('cove-bed'); if (bed) bed.visible = false; } // the planet's own ground is the cove's bed now
  const coveEnv = (base) => {
    const e = cove.env(base);
    return { ...base, top: e.top, solid: e.solid, liquid: (x, z) => e.liquid(x, z) || (base.liquid ? base.liquid(x, z) : null) };
  };
  const fishing = createFishing({ scene, player, sealife: cove.life, ocean: cove.ocean, hud, audio, lite,
    solid: (x, y, z) => cove.env({ ground }).solid(x, y, z), ground: (x, z) => cove.env({ ground }).top(x, z, 50), T7: () => game.data.g7 || {},
    active: () => on && atCove(player.position.x, player.position.z, 14), idSuffix: '-cove' });
  fishing.on && fishing.on('catch', () => { if (places.onCatch()) game.pay({ fish: 1 }); });
  const faunaEnv = cove.env({ ground });
  const fauna = createFaunaView({ scene, interact, hud, game, player, walking: () => on, ground: (x, z) => faunaEnv.top(x, z, 40),
    send: () => window.__zenPlacesNet && ((m) => window.__zenPlacesNet.send(m)), me: () => (window.__zenMe ? window.__zenMe() : null) });
  // map seals that are not places: the arrival stone and the vault once the server has shown it to you
  interact.add({ id: 'place-spawn', at: () => (on ? { x: WORLD_SPAWN.x, y: 0, z: WORLD_SPAWN.z } : { x: NaN, z: NaN }), r: 0.01, priority: 0, enabled: () => on, actions: () => [] });
  interact.add({ id: 'place-vault', at: () => (on && window.__zenVault && window.__zenVault()) || { x: NaN, z: NaN }, r: 0.01, priority: 0, enabled: () => on && !!(window.__zenVault && window.__zenVault()), actions: () => [] });
  const roots = [garden, cove.root, scene.getObjectByName('places'), scene.getObjectByName('garden-fauna')].filter(Boolean);

  function setOn(v) {
    if (v === on) return; on = v;
    for (const r of roots) r.visible = v;
    if (v) { for (const c of hc.list) if (!colliders.list.includes(c)) colliders.list.push(c); }
    else for (let i = colliders.list.length - 1; i >= 0; i--) if (hc.list.includes(colliders.list[i])) colliders.list.splice(i, 1);
  }
  setOn(true); setOn(false);
  let clock = 0;
  const TS = { night: 0, golden: 0 };
  return {
    get on() { return on; }, places, cove, fishing, fauna, pond, sand, bonsai,
    setOn,
    // the walker's view of the hub: the cove's water and the headland's cave over the planet's own ground
    env: (base) => coveEnv(base),
    groundAt: (x, z) => SAND_GROUND(x, z),
    atCove: () => on && atCove(player.position.x, player.position.z, 14),
    // no wild trees or bushes in the garden, the cove, the pads under the camps and sites
    noFlora(x, z, big) {
      if (Math.hypot(x - 1.5, z + 0.5) < GARDEN_R + (big ? 15 : 0)) return true;
      if (Math.hypot(x - COVE.x, z - (COVE.z + HEAD.z) / 2) < 26 + (big ? 6 : 0)) return true;
      for (const p of HUB_PADS) if (Math.hypot(x - p.x, z - p.z) < p.r + (big ? 10 : 0)) return true;
      return false;
    },
    update(dt, { night = 0, golden = 0 } = {}) {
      if (!on) return;
      clock += dt; TS.night = night; TS.golden = golden;
      const p = player.position, near = Math.hypot(p.x - 6, p.z) < 260;
      garden.visible = near && Math.hypot(camera.position.x - 6, camera.position.z) < 320; // the pond's water skips the horizon drop: only show it close up
      if (near) { pond.update(dt, clock, TS); sand.update(dt); bonsai.update(dt, clock); }
      cove.update(dt, player);
      fishing.update(dt);
      fauna.update && fauna.update(dt);
      places.update(dt, p);
    },
  };
}
