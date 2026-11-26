// Xenia's Home Valley hub: everything that used to live in the separate garden world, now on the planet
// itself, in the hub frame (js/xenia/xenia.js: tile 'hub', x east, z south, metres from the old garden's
// middle, so every old garden coordinate is still the same spot). planet.js mounts it on Xenia and shows it
// only while the scene is in the hub frame.
//   Mom's pond, the raked sand and the bonsai (the garden's heart, at the middle of the spawn town)
//   the rest of the garden's scenery (js/xenia/garden.js) and tending it: beds, rake, koi, finds (js/xenia/tend.js)
//   the workshop shed and the rocket pad (js/game/earth-rocket.js): the bench, the rocket, the launch to the Moon
//   the places (js/game/places.js): ruins, lookout hill, wreck, cove, sea cave, the camps' seals
//   the salt cove and the sea cave (js/game/cove.js) at the head of the sound, with its own still water
//   fishing at the cove (shared stock online), the hares and the fox (js/game/fauna-view.js)
// The Rangers, the Raiders (js/factions/client.js) and Ula's walk / the vault (js/compete.js) are global
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
import { createGarden } from './garden.js';
import { createTend } from './tend.js';
import { createTending } from '../tending.js';
import { createSteps } from '../game/steps.js';

const GARDEN_R = 60; // the old garden's footprint around its middle: no wild flora in here

export async function createHub({ scene, camera, P, renderer, hud, interact, player, game, audio, ground, colliders, params = new URLSearchParams(location.search), core }) {
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
  // the rest of the garden, and tending it
  const gscene = await createGarden({ scene, P, renderer, SAND, POND, hc, params });
  const steps = createSteps(audio);
  const tending = createTending({ world: 'earth' });
  const tend = createTend({ scene, P, params, player, interact, hud, game, audio, steps, bonsai, bonsaiPos: new THREE.Vector3(1.5, 0, -7.2), pond, POND, sand,
    SAND, finds: gscene.finds, snaps: gscene.snaps, gardenState: gscene.gardenState, tending, colliders: hc });
  gscene.share(sand);
  // the workshop shed, the launch pad and the rocket (phase 2 of the old garden game)
  // the Moon is a delta-v away (js/game/earth-game.js): leaving orbit for the Moon and braking down onto it
  const MOON_TRIP_DV = (() => { const mu = 9.81 * 6.371e6 ** 2, r1 = 6.571e6, r2 = 384.4e6, v1 = Math.sqrt(mu / r1); return Math.round(v1 * (Math.sqrt(2 * r2 / (r1 + r2)) - 1) + Math.sqrt(800 ** 2 + 2 * 1.62 * 1.7374e6)); })();
  // the rocket talks to the planet's walker (js/game/walkcore.js): its bag tabs, its cinematic switch
  const EG = { player, interact, hud, colliders: hc, wait: tend.wait,
    get extraTabs() { return core.extraTabs; }, openBag: (w) => core.openBag(w),
    get cinematic() { return !!core.cinematic; }, set cinematic(v) { core.cinematic = v; } };
  if (core.extraTabs && !core.extraTabs.some((t) => t.id === 'shelf')) core.extraTabs.push(tend.shelfTab);
  const rocket = (await import('../game/earth-rocket.js')).createEarthRocket(EG, { scene, P, params, audio, nature: gscene.nature, POND, core, name: 'earth' });
  for (const o of [...scene.children]) if (!before.has(o) && o !== garden && o !== gscene.root) garden.attach(o); // the beds, shed, pad: same switch

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
  // a beacon at the garden: the only way to jump home from the ship (crafted and planted by hand)
  import('../universe/beacons.js').then((B) => interact.add({ id: 'garden-beacon', at: () => ({ x: 30, y: 0, z: -6 }), r: 3.5, priority: 0.2, enabled: () => B.hasBeaconItem() && !B.gardenBeacon(),
    actions: () => [{ label: 'Plant a beacon at the garden', icon: 'star', run: async () => { const b = B.plantBeacon({ world: 'earth', name: 'The garden', x: 30, z: -6 }); hud.toast(b ? 'Beacon planted. From inside the ship you can jump home to it from anywhere (2 propellant).' : 'There is already a beacon here.', 'star', 5200); } }] })).catch(() => {});
  // the world spawn: a flat arrival stone with a small lantern post beside it (new players, the home beacon
  // and invite joins with the inviter offline all land here)
  {
    const g = new THREE.Group(); g.position.set(WORLD_SPAWN.x, 0, WORLD_SPAWN.z); g.name = 'spawn';
    const stone = new THREE.MeshStandardMaterial({ color: '#8d8a82', roughness: 0.92 });
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.92, 0.07, 28), stone); disc.position.y = 0.03; disc.receiveShadow = true; g.add(disc);
    // an ensō brushed into the stone in ink (art bible: the open ring marks home; gold is only for earned things):
    // one stroke, heavy where the brush lands, thinning to a dry tail, the circle left open
    const eg = new THREE.TorusGeometry(0.6, 0.034, 5, 64, Math.PI * 1.84), ep = eg.attributes.position;
    for (let i = 0; i < ep.count; i++) { const x = ep.getX(i), y = ep.getY(i), z = ep.getZ(i), a = Math.atan2(y, x), k = a < 0 ? a + Math.PI * 2 : a, w = 1.15 - 0.75 * (k / (Math.PI * 1.84)), r = Math.hypot(x, y), d = r - 0.6; const r2 = 0.6 + d * w; ep.setXYZ(i, x / r * r2, y / r * r2, z * Math.max(0.25, w) * 0.5); }
    eg.computeVertexNormals();
    const ring = new THREE.Mesh(eg, new THREE.MeshStandardMaterial({ color: '#2e2b27', roughness: 0.75 })); ring.rotation.set(-Math.PI / 2, 0, 0.9); ring.position.y = 0.068; g.add(ring);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.9, 0.1), new THREE.MeshStandardMaterial({ color: '#5a4632', roughness: 0.85 })); post.position.set(1.15, 0.45, 0.2); post.castShadow = true; g.add(post);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), new THREE.MeshStandardMaterial({ color: '#f3d9a0', emissive: '#ffcf80', emissiveIntensity: 0.9 })); lamp.position.set(1.15, 0.98, 0.2); g.add(lamp);
    garden.add(g);
    hc.circle(WORLD_SPAWN.x + 1.15, WORLD_SPAWN.z + 0.2, 0.12, { h: 1.1, name: 'spawn-post' });
    interact.add({ id: 'spawn', at: () => ({ x: WORLD_SPAWN.x, y: 0, z: WORLD_SPAWN.z }), r: 1.6, priority: 0.05, enabled: () => true,
      actions: () => [{ label: 'The arrival stone (world spawn)', icon: 'star', run: () => hud.toast('This is the world spawn. New players arrive here, your home beacon brings you back here, and friends you invite land here when you are offline.', 'star', 6500) }] });
  }
  const roots = [garden, gscene.root, cove.root, scene.getObjectByName('places'), scene.getObjectByName('garden-fauna')].filter(Boolean);

  function setOn(v) {
    if (v === on) return; on = v;
    for (const r of roots) r.visible = v;
    if (v) { for (const c of hc.list) if (!colliders.list.includes(c)) colliders.list.push(c); }
    else for (let i = colliders.list.length - 1; i >= 0; i--) if (hc.list.includes(colliders.list[i])) colliders.list.splice(i, 1);
  }
  setOn(true); setOn(false);
  let clock = 0;
  const TS = { night: 0, golden: 0, elev: 0.6, overcast: 0, lightColor: new THREE.Color('#ffffff') };
  return {
    get on() { return on; }, places, cove, fishing, fauna, pond, sand, bonsai, garden: gscene, tend, rocket,
    onLaunched(fn) { rocket.onLaunched = fn; }, moonTripDv: MOON_TRIP_DV,
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
    update(dt, { night = 0, golden = 0, elev = 0.6, lightColor = null } = {}) {
      if (!on) return;
      clock += dt; TS.night = night; TS.golden = golden; TS.elev = elev; TS.overcast = 0; if (lightColor) TS.lightColor = lightColor;
      const p = player.position, near = Math.hypot(p.x - 6, p.z) < 260;
      garden.visible = gscene.root.visible = near && Math.hypot(camera.position.x - 6, camera.position.z) < 320; // the pond's water skips the horizon drop: only show it close up
      if (near) { pond.update(dt, clock, TS); sand.update(dt); bonsai.update(dt, clock); gscene.update(dt, clock, TS, camera, audio); }
      tend.update(dt, clock, near);
      rocket.update(dt, clock, TS);
      cove.update(dt, player);
      fishing.update(dt);
      fauna.update && fauna.update(dt);
      places.update(dt, p);
    },
  };
}
