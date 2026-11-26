// Mom's garden on Xenia: the old garden world's scenery, built into the planet scene in the hub frame (the
// hub frame's origin is the old garden's, so every position here is the one js/worlds/earth.js used). Pond,
// sand and bonsai come from js/xenia/hub.js; this adds the rest: the stepping stones and rocks, the groves,
// maples, shrubs and the back wall with its stone lantern (js/flora.js), the stylized nature and scanned rocks,
// the lawn grass, the snapdragons, the finds and their shelf, the horned lizard on its sunning stone, and the
// shared gifts and visit signs. Not ported: the flat world's sky, mountains, weather, light shafts and baked
// lightmaps (the planet lights it), and the physics pebbles (js/life.js).
// Every solid here has a collider (the garden's own list, js/worlds/earth.js): if you can see it, it is real.
//   const g = await createGarden({ scene, P, renderer, sand, SAND, pond, POND, hc })
//   g.update(dt, clock, ts)   g.root   g.hit(ray)   g.surfaceAt(x, z)
import * as THREE from 'three';
import { createFlora, CENTER } from '../flora.js';
import { placedRock, rockMaterial, rockQuality } from '../rocks.js';
import { computeSeason } from '../season.js';
import { loadNature, placeNature } from '../nature.js';
import { createSnapdragons } from '../snapdragon.js';
import { createFinds } from '../finds.js';
import { createLizard } from '../lizard.js';
import { createState } from '../state.js';
import { createGrass } from '../grass.js';
import { loadGardenRocks, placeGardenRocks, loadGardenTrees } from '../gardenrocks.js';
import { addSnowCover } from '../weather.js';
import { SAND_ROCKS } from '../sand.js';
import { COVE, inside as coveInside } from '../cove.js';
import { mulberry32, smoothstep } from '../util.js';

export const BED_ZONE = { x0: -8.4, x1: 1.4, z0: 9.6, z1: 12.1 }; // js/game/earth-game.js (the raised beds)
const GIFT_SPOTS = [[-5.6, -7.4], [5.6, -8.6], [-10.6, 5.8], [13.8, 7.4], [-7.0, 9.2], [8.2, -7.8]];
const BASK = { x: 1.05, z: 3.50, r: 0.26 };

export async function createGarden({ scene, P, renderer, SAND, POND, hc, params = new URLSearchParams() }) {
  rockQuality.segs = P.rockSegs;
  const SEASON = computeSeason(new Date(), params);
  const uSnow = { value: SEASON.snowCover };
  addSnowCover(rockMaterial(), uSnow, { strength: 0.9 });
  const sway = { uTime: { value: 0 }, uWind: { value: 1 }, uWindDir: { value: new THREE.Vector2(0.86, 0.5) } };
  const root = new THREE.Group(); root.name = 'hub-garden-scenery';
  const before = new Set(scene.children);
  // stepping stones along the front of the bed, and a few extra rocks
  const STEP_STONES = [], EXTRA_ROCKS = [];
  {
    const extra = [[-12.4, 11.9, 0.7, 801], [-10.6, 12.8, 0.4, 802], [11.0, 11.2, 0.6, 803], [16.5, 9.6, 0.8, 804]];
    const pts = [];
    for (let x = -8.6, i = 0; x < 6.4; x += 0.74, i++) pts.push([x, 6.9 + 0.35 * Math.sin(x * 0.42) + (i % 2 ? 0.16 : -0.16)]);
    STEP_STONES.push(...pts.map(([x, z], i) => [x, z, 0.3 + (i % 3) * 0.04]));
    EXTRA_ROCKS.push(...extra.map(([x, z, s, seed]) => ({ x, z, r: s, seed })));
    // (the asset stones draw them: placeNature / placeGardenRocks below)
  }
  const [NATURE, ROCKS, TREES] = await Promise.all([loadNature(P), loadGardenRocks(), loadGardenTrees({ far: P.cls !== 'pc' })]);
  const bonsaiPos = new THREE.Vector3(1.5, 0, -7.2);
  const flora = createFlora(scene, { P, sway, useAssets: true, renderer, season: SEASON, uSnow, blocked: [[bonsaiPos.x, bonsaiPos.z, 3.2], [7.6, -4.6, 0.8], [7.0, 6.0, 1.5]] });
  const freeSpot = (x, z) => {
    const inSand = Math.abs(x - SAND.cx) < SAND.w / 2 + 1.2 && Math.abs(z - SAND.cz) < SAND.d / 2 + 1.2;
    const inPondA = POND.contains(x, z, 1.4);
    const nearBonsai = Math.hypot(x - bonsaiPos.x, z - bonsaiPos.z) < 3.4;
    const onPath = z > 6.0 && z < 8.0 && x > -9.4 && x < 7.0;
    const wall = z < -11.6 && z > -13.6;
    const shed = x > 17.5 && x < 23 && z > -0.5 && z < 5.8;
    const beds = x > BED_ZONE.x0 - 0.6 && x < BED_ZONE.x1 + 0.6 && z > BED_ZONE.z0 - 0.6 && z < BED_ZONE.z1 + 0.6;
    const rack = Math.hypot(x - 4.85, z + 2.3) < 1.0;
    if (coveInside(x, z) > -COVE.bank - 0.6) return false;
    return !(inSand || inPondA || nearBonsai || onPath || wall || beds || rack || shed);
  };
  const grass = createGrass(scene, { P, sway, free: freeSpot, center: CENTER, uSnow, season: SEASON.season, mirrorZone: { x: POND.cx, z: POND.cz, r: POND.r + 1.0 } });
  const nature = placeNature(scene, NATURE, { P, season: SEASON, sway, uSnow, sandRocks: [...SAND_ROCKS, ...EXTRA_ROCKS], pondStones: [], stepStones: STEP_STONES, free: freeSpot, scanRocks: !!ROCKS, scanTrees: TREES });
  const gardenRocks = ROCKS ? placeGardenRocks(scene, ROCKS, { P, sandRocks: SAND_ROCKS, extraRocks: EXTRA_ROCKS, pondStones: [], stepStones: STEP_STONES, free: freeSpot, uSnow, center: CENTER }) : null;
  const gardenState = createState();
  const snaps = [createSnapdragons(scene, { P, season: SEASON, sway, uSnow, touch: P.touch })];
  const finds = createFinds(scene, { P, state: gardenState, sand: SAND, sandRocks: SAND_ROCKS, pond: POND, shelfAt: { x: 5.0, z: 5.0, ry: 0.25 }, params, touch: P.touch });
  const baskMesh = new THREE.Mesh(placedRock(91, { sx: 0.18, sy: 0.13, sz: 0.14, flatTop: 0.78, moss: 0.10, rough: 0.16, segs: 28 }, BASK.x, 0.08, BASK.z, 0.4), rockMaterial());
  baskMesh.castShadow = true; baskMesh.receiveShadow = true; scene.add(baskMesh);
  const downRay = new THREE.Raycaster();
  const baskY = (x, z) => { downRay.set(new THREE.Vector3(x, 30, z), new THREE.Vector3(0, -1, 0)); const h = downRay.intersectObject(baskMesh, true)[0]; return h ? h.point.y : 0.10; };
  const lizard = createLizard(scene, { rock: BASK, surfaceY: baskY, params, sand: SAND });
  // shared gifts (flowers, paper lanterns) and visit signs (a raked spiral, the lantern lit)
  const giftLanterns = []; let visitGlow = 0;
  const giftRnd = (id) => mulberry32([...String(id)].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261) >>> 0);
  function applyShared(items, sand) {
    for (const it of items) {
      const r = giftRnd(it.id); const [gx, gz] = GIFT_SPOTS[Math.floor(r() * GIFT_SPOTS.length)];
      if (it.kind === 'gifts' && it.type === 'flower') {
        const s = createSnapdragons(scene, { P, season: SEASON, sway, uSnow, touch: P.touch, clusters: [[gx + (r() - 0.5), gz + (r() - 0.5), 4]], seed: Math.floor(r() * 1e6) });
        snaps.push(s); for (const m of s.meshes || []) if (m.parent) root.attach(m);
        hc.circle(gx, gz, 0.42, { h: 0.6, name: 'snaps' });
      } else if (it.kind === 'gifts' && it.type === 'lantern') {
        const lan = new THREE.Group();
        const paper = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.5, 12), new THREE.MeshStandardMaterial({ color: '#f4e6cc', emissive: '#ffb860', emissiveIntensity: 0.0, roughness: 0.9 }));
        paper.position.y = 0.55; lan.add(paper);
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.32, 6), new THREE.MeshStandardMaterial({ color: '#4a3424' })); post.position.y = 0.16; lan.add(post);
        lan.position.set(gx, 0, gz); root.add(lan); giftLanterns.push(paper.material);
        hc.circle(gx, gz, 0.26, { h: 0.8, name: 'gift lantern' });
      } else if (it.kind === 'visits' && it.type === 'rake' && sand) {
        const cx0 = 0.25 + r() * 0.5, cy0 = 0.3 + r() * 0.4;
        sand.rakeStart({ x: cx0, y: cy0 });
        for (let k = 1; k < 90; k++) { const a = k * 0.16, rr = 0.012 + k * 0.0014; sand.rakeMove({ x: cx0 + Math.cos(a) * rr * 0.7, y: cy0 + Math.sin(a) * rr }); }
        sand.rakeEnd();
      } else if (it.kind === 'visits' && it.type === 'lantern-lit') visitGlow = 1;
    }
  }
  // everything just made goes under one root (one switch for the hub)
  for (const o of [...scene.children]) if (!before.has(o)) root.attach(o);
  scene.add(root);
  // colliders: the garden's own list (js/worlds/earth.js) — the wall, the lantern, the shelf, the bonsai stand,
  // every rock and tree, the snapdragon clumps and the rake rack
  hc.box(bonsaiPos.x, bonsaiPos.z, 0.55, 0.35, { h: 0.8, name: 'bonsai stand' })
    .circle(7.6, -4.6, 0.55, { h: 1.6, name: 'lantern' })
    .box(5.0, 5.0, 0.8, 0.2, { ry: 0.25, h: 0.8, name: 'shelf' })
    .box(0, -12.6, 17.5, 0.35, { h: 2.0, name: 'wall' });
  for (const r of [...SAND_ROCKS, ...EXTRA_ROCKS]) hc.circle(r.x, r.z, r.r * 0.9, { h: r.r, name: 'rock' });
  for (const t of nature.trees || []) hc.circle(t.x, t.z, t.r, { h: t.h, name: t.name });
  for (const [x, z] of snaps[0].clusters) hc.circle(x, z, 0.42, { h: 0.6, name: 'snaps' });
  return {
    root, flora, grass, nature, gardenRocks, snaps, finds, lizard, gardenState, SEASON, BED_ZONE,
    // shared garden state (gifts, visits) arrives later: apply what is there now and what comes
    share(sand) {
      applyShared(gardenState.allShared().filter((x) => x.kind === 'gifts'), sand);
      applyShared(gardenState.takeUnapplied().filter((x) => x.kind === 'visits'), sand);
      gardenState.onChange(() => applyShared(gardenState.takeUnapplied(), sand));
      window.garden = { mergeShared: (remote) => gardenState.mergeShared(remote) };
    },
    // what a look ray hits: a find, the lizard, a snapdragon (for the walker's gaze actions)
    hit(ray) {
      let best = null;
      for (const c of [finds.hit(ray), lizard.hit(ray, P.touch), ...snaps.map((s, i) => { const h = s.hit(ray); if (h) h.snaps = i; return h; })]) if (c && (!best || c.d < best.d)) best = c;
      return best;
    },
    update(dt, clock, ts, camera, audio) {
      sway.uTime.value = clock;
      grass.update(camera);
      for (const s of snaps) s.update(dt, clock);
      finds.update(dt, clock, ts, audio);
      lizard.update(dt, clock, ts, SEASON);
      visitGlow = Math.max(0, visitGlow - dt / 600); flora.lanternBoost = visitGlow;
      for (const m of giftLanterns) m.emissiveIntensity = smoothstep(0, 0.8, ts.night + ts.golden * 0.3) * 1.6;
      flora.update(dt, clock, ts);
    },
  };
}
