// Earth (the home garden) as a place to walk and tend: the gardener, raised flower beds, the rake,
// koi feeding, finds, the bonsai, and (phase 2) the workshop + rocket. Ambient drift stays available.
import * as THREE from 'three';
import { createPlayer } from './player.js';
import { createInteractor, lookInput, addPressHandler } from './interact.js';
import { createSteps } from './steps.js';
import { getHud, setActive, getActive } from './session.js';
import { game, SPECIES, itemInfo, dayKey, UNLOCK_ALL } from './store.js';
import { buildPlant } from './plants.js';
import { buildRake } from './character.js';
import { createColliders } from '../colliders.js';
import { bakeSolids, passable, solid } from '../solids-bake.js';
import { icon } from './icons.js';
import { mergeGeometries } from '../util.js';
import { createEarthRocket } from './earth-rocket.js';
import { isGameWorld } from './flags.js';
import { bagTab } from './skills.js';
import { openStarMap } from './starmap.js';
import { GARDEN } from '../universe/basesite.js';
import { WORLD_SPAWN } from '../spawn.js';
import { lookoutHeight } from '../places.js';
import { createPlaces } from './places.js';
import { createFaunaView } from './fauna-view.js';
import { createCove } from './cove.js';
import { createFishing } from './water/fishing.js';
import { createGardenBuild } from './garden-build.js';
import { equip } from './equip.js';
import { atCove } from '../places.js';
import { COVE, inside as coveInside, headTop } from '../cove.js';

const DAY = 86400000;
// beds: three cedar raised beds on the front lawn, four planting spots each
export const BEDS = [{ x: -6.6, z: 10.7, ry: 0.06 }, { x: -3.5, z: 10.95, ry: 0 }, { x: -0.4, z: 10.7, ry: -0.06 }];
export const BED_ZONE = { x0: -8.4, x1: 1.4, z0: 9.6, z1: 12.1 };
const RACK = { x: 4.85, z: -2.3 };

let api_away = null;
export function createEarthGame(E) {
  const { scene, camera, P, params, audio, colliders, sand, SAND, pond, POND, bonsai, bonsaiPos, finds, snaps, gardenState, growOverride, tending, canvas } = E;
  const hud = getHud(P);
  const G = game.data;
  const clockRef = { t: 0 };

  // ---- player colliders: the garden's list, but the pond follows its real outline (+ bank stones)
  const pc = createColliders();
  for (const c of colliders.list) if (c.name !== 'pond') pc.list.push(c);
  pc.shape((x, z) => POND.dist(x, z) - 0.42, { h: 0.4, kind: 'water', name: 'pond' });
  const ground = (x, z) => (Math.abs(x - SAND.cx) < SAND.w / 2 && Math.abs(z - SAND.cz) < SAND.d / 2 ? 0.09 : lookoutHeight(x, z)); // + the lookout hill (js/places.js)

  // footsteps: sand in the raked garden, stone on the stepping-stone path and the pad, grass elsewhere
  const steps = createSteps(audio);
  const surfaceAt = (x, z) => {
    if (Math.abs(x - SAND.cx) < SAND.w / 2 && Math.abs(z - SAND.cz) < SAND.d / 2) return 'sand';
    if (x > -8.9 && x < 6.7 && Math.abs(z - (6.9 + 0.35 * Math.sin(x * 0.42))) < 0.36) return 'stone';
    if (Math.hypot(x - 34, z - 1) < 4.2) return 'stone';
    return 'grass';
  };
  const player = createPlayer({ scene, camera, hud, P, colliders: pc, ground, start: WORLD_SPAWN, bounds: { cx: 1.5, cz: -0.5, r: isGameWorld() ? GARDEN.out + 40 : 58 } /* the game garden has no wall: past GARDEN.out she walks on onto the whole Earth */, speedScale: 0.8, onStep: (p, k) => steps.play(surfaceAt(p.x, p.z), k) });
  // her own body + third-person camera
  let avatarPc = null;
  import('./avatar/index.js').then((m) => { avatarPc = m.attachAvatar({ scene, camera, player, world: 'earth', ground, colliders: pc, P }); api.avatar = avatarPc; }).catch((e) => console.warn('[avatar]', e));
  const interact = createInteractor({ hud, player });
  const places = createPlaces({ scene, pc, interact, hud, game, ground }); // points of interest around the spawn
  // the salt cove and the sea cave (js/cove.js): carved bank, still water to swim and dive, the headland cave
  const cove = createCove({ scene, camera, hud, lite: !!(P && P.lite) });
  // its shore stones and driftwood stop you where you see them (the headland and cave are solid through cove.env)
  bakeSolids(cove.root, pc, { ground: (x, z) => cove.env({ ground }).top(x, z, 50), tag: 'cove' });
  scene.traverse((o) => { if (o.name === 'sealife') passable(o, 'kelp, seagrass and fish move aside'); });
  // building (g7/build.js) in the garden; shared and checked by the server online (server/src/builds.js)
  // the garden's held items (hands, build, spear, rod) belong to the garden only while it is the live world:
  // on a planet the sandbox has its own hands and build, and both rows used to show (hands x2, build x2)
  let liveApi = null; // set once activeApi exists below
  const here = () => !!liveApi && walking && getActive() === liveApi; // false until the garden is built (no TDZ on walking)
  const gb = createGardenBuild({ scene, camera, P, renderer: E.renderer, steps, player, hud, game, equip, walking: here,
    send: (m) => window.__zenPlacesNet && window.__zenPlacesNet.send(m), baseEnv: () => cove.env({ ground }) });
  window.__zenBuild = gb; for (const m of (window.__zenBuildQ || []).splice(0)) gb.onServer(m);
  player.setEnv(gb.env(cove.env({ ground })));
  // the garden animals (js/fauna.js): hares and a fox; the server runs them online (server/src/fauna.js)
  const faunaEnv = cove.env({ ground });
  const fauna = createFaunaView({ scene, interact, hud, game, player, walking: () => walking, ground: (x, z) => faunaEnv.top(x, z, 40),
    send: () => window.__zenPlacesNet && ((m) => window.__zenPlacesNet.send(m)), me: () => (window.__zenMe ? window.__zenMe() : null) });
  // fishing at the cove (water/fishing.js): spear and rod from the workshop bench; the fish are the cove's schools.
  // Online the stock is shared and a catch is a real fish in your hands (js/game/places.js onCatch -> server).
  const fishing = createFishing({ scene, player, sealife: cove.life, ocean: cove.ocean, hud, audio, lite: !!(P && P.lite),
    solid: (x, y, z) => cove.env({ ground }).solid(x, y, z), ground: (x, z) => cove.env({ ground }).top(x, z, 50), T7: () => game.data.g7 || {},
    active: () => here() && atCove(player.position.x, player.position.z, 14), idSuffix: '-cove' });
  fishing.on('catch', () => { if (places.onCatch()) game.pay({ fish: 1 }); }); // online: the fish is the server's object in your hands, not a bag count
  const fishTool = () => { const c = equip.current; return c && (c.id === 'spear-cove' || c.id === 'rod-cove') ? c : null; };
  // a small tool row at the cove (hands, spear, rod): tap a slot, or 1-3 / the mouse wheel on a computer
  const atCoveNow = () => atCove(player.position.x, player.position.z, 14);
  const hasFishTools = () => { const t = (game.data.g7 && game.data.g7.tools) || {}; return !!(t.spear || t.rod); };
  setTimeout(() => equip.register({ id: 'hands-cove', order: 17, glyph: '✋', label: 'hands', available: () => here() && ((atCoveNow() && hasFishTools()) || !!((game.data.g7 && game.data.g7.tools) || {}).build) }), 0); // after 'walking' exists
  let coveBar = null;
  import('./g7/hotbar.js').then((m) => { coveBar = m.createHotbar({ touch: false }); window.__zenGardenBar = coveBar; coveBar.onPick = (i) => { const sl = coveSlots()[i]; if (sl) equip.select(sl.id); }; coveBar.show(false); }).catch(() => {});
  const coveSlots = () => equip.list().filter((it) => /-cove$|^build-garden$/.test(it.id)).map((it) => ({ id: it.id, glyph: it.glyph, label: typeof it.label === 'function' ? it.label() : it.label }));
  function coveBarTick() {
    if (!coveBar) return;
    const on = walking && !hud.panelOpen && coveSlots().length > 1;
    coveBar.show(on); if (!on) return;
    const sl = coveSlots(), c = equip.current; coveBar.set(sl, Math.max(0, sl.findIndex((x) => c && x.id === c.id)));
  }
  addEventListener('keydown', (e) => {
    if (e.repeat || !walking || hud.panelOpen || coveSlots().length < 2 || (e.target && /INPUT|TEXTAREA/.test(e.target.tagName))) return;
    if (gb.key(e)) return;
    const m = /^Digit([1-3])$/.exec(e.code); if (m) { const sl = coveSlots()[+m[1] - 1]; if (sl) equip.select(sl.id); }
  });
  addEventListener('wheel', (e) => { if (!walking || hud.panelOpen || !e.deltaY || coveSlots().length < 2) return; if (gb.wheel(e.deltaY)) return; const sl = coveSlots(); if (sl.length < 2) return; const c = equip.current, i = sl.findIndex((x) => c && x.id === c.id); equip.select(sl[(i + Math.sign(e.deltaY) + sl.length) % sl.length].id); }, { passive: true });
  addPressHandler({
    down(b) {
      if (b !== 0 && b !== 2) return false;
      if (gb.isTool() && walking && !hud.panelOpen) return b === 0 ? gb.primary(true) : gb.secondary(true);
      if (!fishTool() || !atCove(player.position.x, player.position.z, 14)) return false; return b === 0 ? equip.primary(true) : equip.secondary(true);
    },
    up(b) { if (gb.isTool()) return; if (b === 0) equip.primary(false); else if (b === 2) equip.secondary(false); },
  });
  // the hidden vault joins the map once the server has shown it to you (js/compete.js sets window.__zenVault)
  interact.add({ id: 'place-vault', at: () => (window.__zenVault && window.__zenVault()) || { x: NaN, z: NaN }, r: 0.01, priority: 0, enabled: () => !!(window.__zenVault && window.__zenVault()), actions: () => [] });
  interact.add({ id: 'place-spawn', at: () => ({ x: WORLD_SPAWN.x, y: 0, z: WORLD_SPAWN.z }), r: 0.01, priority: 0, enabled: () => true, actions: () => [] });

  // ---- raised beds
  const cedar = new THREE.MeshStandardMaterial({ color: '#8c7259', roughness: 0.85 });
  const cedarDark = new THREE.MeshStandardMaterial({ color: '#6b5643', roughness: 0.9 });
  const soilTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
    g.fillStyle = '#4a3527'; g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 900; i++) { const l = 18 + Math.random() * 22; g.fillStyle = `hsl(${22 + Math.random() * 12},${25 + Math.random() * 15}%,${l}%)`; g.fillRect(Math.random() * 128, Math.random() * 128, 1 + Math.random() * 2.5, 1 + Math.random() * 2.5); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2, 1); return t;
  })();
  const soil = new THREE.MeshStandardMaterial({ map: soilTex, roughness: 1 });
  const BW = 2.3, BD = 0.95, BH = 0.3;
  // each bed's soil darkens when watered (and stays a little darker the rest of that day)
  const bedSoil = [];
  const dryCol = new THREE.Color('#ffffff'), wetCol = new THREE.Color('#8a7f78');
  const spots = [];
  const plankGeos = { light: [], dark: [] };
  BEDS.forEach((b, bi) => {
    const grp = new THREE.Group(); grp.position.set(b.x, 0, b.z); grp.rotation.y = b.ry; scene.add(grp);
    grp.updateMatrixWorld(true);
    const plank = (w, h, d, x, y, z, m = cedar) => { (m === cedar ? plankGeos.light : plankGeos.dark).push(new THREE.BoxGeometry(w, h, d).translate(x, y, z).applyMatrix4(grp.matrixWorld)); };
    plank(BW, BH, 0.06, 0, BH / 2, BD / 2 - 0.03); plank(BW, BH, 0.06, 0, BH / 2, -BD / 2 + 0.03);
    plank(0.06, BH, BD - 0.12, BW / 2 - 0.03, BH / 2, 0); plank(0.06, BH, BD - 0.12, -BW / 2 + 0.03, BH / 2, 0);
    plank(BW + 0.06, 0.035, 0.1, 0, BH + 0.017, BD / 2 - 0.03, cedarDark); plank(BW + 0.06, 0.035, 0.1, 0, BH + 0.017, -BD / 2 + 0.03, cedarDark);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) plank(0.08, BH + 0.06, 0.08, sx * (BW / 2 - 0.02), (BH + 0.06) / 2, sz * (BD / 2 - 0.02), cedarDark);
    const top = new THREE.Mesh(new THREE.PlaneGeometry(BW - 0.12, BD - 0.12, 8, 4).rotateX(-Math.PI / 2), soil.clone());
    bedSoil[bi] = { mat: top.material, wet: 0, target: 0 };
    { const p = top.geometry.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, Math.sin(p.getX(i) * 9) * 0.008 + Math.cos(p.getZ(i) * 13 + p.getX(i) * 3) * 0.008); top.geometry.computeVertexNormals(); }
    top.position.y = BH - 0.04; top.receiveShadow = true; grp.add(top);
    for (let i = 0; i < 4; i++) {
      const lx = -BW / 2 + 0.36 + i * ((BW - 0.72) / 3);
      const holder = new THREE.Group(); holder.position.set(lx, BH - 0.04, 0); grp.add(holder);
      spots.push({ bed: bi, i, holder, grp, key: `${bi}:${i}`, mesh: null, stage: -2 });
    }
  });
  for (const [k, list] of Object.entries(plankGeos)) { const o = new THREE.Mesh(mergeGeometries(list), k === 'light' ? cedar : cedarDark); o.castShadow = true; o.receiveShadow = true; solid(o, { name: 'raised bed' }); scene.add(o); bakeSolids(o, pc, { ground, tag: 'beds-' + k }); }
  grpUpdateWorld();
  function grpUpdateWorld() { for (const s of spots) s.grp.updateMatrixWorld(true); }
  const spotWorld = (s) => s.holder.getWorldPosition(new THREE.Vector3());
  const plantOf = (s) => G.beds.find((b) => b && b.k === s.key);
  // Growth runs on real days. Water keeps it going: after ~2 dry days a plant goes thirsty, droops and
  // stops growing until the bed is watered again; each watered day also nudges it along (+0.5 day).
  const dayStart = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d).getTime(); };
  function lastWaterAt(p) { let t = Math.max(p.at, p.re || 0); for (const k of p.w || []) t = Math.max(t, dayStart(k) + DAY * 0.5); return Math.min(t, Date.now()); }
  function dryDays(p, now = Date.now()) {
    const ts = [p.at, ...(p.w || []).map((k) => dayStart(k) + DAY * 0.5)].filter((t) => t <= now).sort((a, b) => a - b); ts.push(now);
    let dry = 0; for (let i = 1; i < ts.length; i++) dry += Math.max(0, (ts[i] - ts[i - 1]) / DAY - 2); return dry;
  }
  function growthDays(p) {
    const days = (Date.now() - (p.re || p.at)) / DAY + growOverride - (p.re ? 0 : dryDays(p));
    return days + (p.re ? 2.4 : Math.min(new Set(p.w || []).size, 6) * 0.5);
  }
  const stageOf = (p) => { if (!p) return -1; const d = growthDays(p); return d < 0.35 ? 0 : d < 1.2 ? 1 : d < 2.4 ? 2 : d < 3.2 ? 3 : 4; };
  const thirsty = (p) => !!p && (Date.now() - lastWaterAt(p)) / DAY > 1.5 && stageOf(p) >= 1 && stageOf(p) < 4;
  // care shows in the harvest: watered days and pinched tips each add a stem or two
  const careBonus = (p) => Math.min(2, Math.floor(new Set(p.w || []).size / 2)) + Math.min(2, new Set(p.pin || []).size);
  const PERENNIAL = { lavender: true, columbine: true }; // picked, they rest and bloom again
  // a little wooden stake with a coloured tag marks each planted spot
  const stakeGeo = new THREE.BoxGeometry(0.018, 0.16, 0.01).translate(0, 0.08, 0);
  const tagGeo = new THREE.BoxGeometry(0.05, 0.035, 0.012).translate(0, 0.15, 0.002);
  const stakeMat = new THREE.MeshStandardMaterial({ color: '#c9a77a', roughness: 0.9 });
  const tagMats = {};
  function refreshSpot(s, force = false) {
    const p = plantOf(s), st = stageOf(p); s.thirsty = thirsty(p);
    if (st === s.stage && !force) return;
    s.stage = st;
    if (s.mesh) { s.holder.remove(s.mesh); s.mesh.geometry.dispose(); s.mesh = null; }
    if (s.stake) { s.holder.remove(s.stake); s.stake = null; }
    if (!p) return;
    s.mesh = buildPlant(p.sp, st, p.seed);
    s.holder.add(s.mesh);
    if (st < 3) {
      const g = new THREE.Group(); g.add(new THREE.Mesh(stakeGeo, stakeMat));
      tagMats[p.sp] = tagMats[p.sp] || new THREE.MeshStandardMaterial({ color: SPECIES[p.sp].color, roughness: 0.7 });
      g.add(new THREE.Mesh(tagGeo, tagMats[p.sp])); g.position.set(0.11, 0, -0.12); g.rotation.y = 0.3; s.holder.add(g); s.stake = g;
    }
  }
  // debug: ?beds=bloom fills every bed (not saved)
  if (params.get('beds')) {
    const sp = Object.keys(SPECIES); const stg = { seed: 0.1, sprout: 0.8, leafy: 1.8, bud: 2.8, bloom: 6, thirsty: 4.2 }[params.get('beds')] ?? 6;
    const thirstyBeds = params.get('beds') === 'thirsty';
    G.beds = spots.map((s, i) => {
      if (thirstyBeds) return { k: s.key, sp: sp[i % sp.length], at: Date.now() - (stg - growOverride) * DAY, seed: 100 + i * 7, w: [] };
      // watered every day: find the planting age that lands on the wanted growth
      let el = 0; for (let k = 0; k < 40; k++) { const n = Math.ceil(el) + 1; el = Math.max(0, stg - growOverride - 0.5 * Math.min(n, 6)); }
      const w = []; for (let d = 0; d <= Math.ceil(el); d++) w.push(dayKey(new Date(Date.now() - d * DAY)));
      return { k: s.key, sp: sp[i % sp.length], at: Date.now() - el * DAY, seed: 100 + i * 7, w };
    });
  }
  spots.forEach((s) => refreshSpot(s, true));
  let refreshT = 0, seenT = 0;
  // welcome back: one calm line about what changed in the beds while she was away
  function awaySummary() {
    const last = G.lastSeen || 0; G.lastSeen = Date.now();
    if (!last || Date.now() - last < 3 * 3600e3 || UNLOCK_ALL) return null;
    const bloomed = [], thirst = [];
    for (const s of spots) { const p = plantOf(s); if (!p) continue; if (stageOf(p) >= 4) bloomed.push(SPECIES[p.sp].plural.toLowerCase()); else if (thirsty(p)) thirst.push(SPECIES[p.sp].plural.toLowerCase()); }
    const uniq = (a) => [...new Set(a)];
    const bits = [];
    if (bloomed.length) bits.push(`${uniq(bloomed).slice(0, 2).join(' and ')} ${bloomed.length > 1 ? 'are' : 'is'} in bloom`);
    if (thirst.length) bits.push(`the ${uniq(thirst).slice(0, 2).join(' and ')} could use water`);
    return bits.length ? 'While you were away, ' + bits.join(', and ') : null;
  }
  api_away = awaySummary;

  // ---- rake rack beside the sand
  const rack = new THREE.Group(); rack.position.set(RACK.x, 0, RACK.z); rack.rotation.y = -0.4; scene.add(rack);
  {
    const w = cedarDark;
    for (const sx of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.1, 0.06), w); p.position.set(sx * 0.3, 0.55, 0); p.castShadow = true; rack.add(p); }
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.05, 0.07), w); bar.position.y = 1.02; bar.castShadow = true; rack.add(bar);
  }
  const rackRake = buildRake(); rackRake.position.set(0, 0.06, 0.13); rackRake.rotation.set(0.16, 0, Math.PI); rackRake.position.y = 1.55; rack.add(rackRake);
  solid(rack, { name: 'rake rack' }); bakeSolids(rack, pc, { ground, tag: 'rack' });

  // ---- little sprinkles (watering, koi food)
  const NSPR = 80;
  const sprG = new THREE.BufferGeometry();
  const sprPos = new Float32Array(NSPR * 3), sprVel = new Float32Array(NSPR * 3), sprLife = new Float32Array(NSPR);
  sprG.setAttribute('position', new THREE.BufferAttribute(sprPos, 3));
  const sprites = new THREE.Points(sprG, new THREE.PointsMaterial({ color: '#cfe8ff', size: 0.035, transparent: true, opacity: 0.85, depthWrite: false }));
  sprites.frustumCulled = false; scene.add(sprites);
  let sprN = 0;
  function sprinkle(from, dir, n = 30, spread = 0.25, speed = 1.2, color = '#cfe8ff') {
    sprites.material.color.set(color);
    for (let k = 0; k < n; k++) {
      const i = sprN++ % NSPR;
      sprPos[i * 3] = from.x; sprPos[i * 3 + 1] = from.y; sprPos[i * 3 + 2] = from.z;
      sprVel[i * 3] = dir.x * speed + (Math.random() - 0.5) * spread; sprVel[i * 3 + 1] = dir.y * speed + Math.random() * 0.3; sprVel[i * 3 + 2] = dir.z * speed + (Math.random() - 0.5) * spread;
      sprLife[i] = 0.6 + Math.random() * 0.5 + k * 0.012;
    }
  }
  function updateSprinkles(dt) {
    for (let i = 0; i < NSPR; i++) {
      if (sprLife[i] <= 0) { sprPos[i * 3 + 1] = -50; continue; }
      sprLife[i] -= dt; sprVel[i * 3 + 1] -= 9.8 * dt;
      sprPos[i * 3] += sprVel[i * 3] * dt; sprPos[i * 3 + 1] += sprVel[i * 3 + 1] * dt; sprPos[i * 3 + 2] += sprVel[i * 3 + 2] * dt;
      if (sprPos[i * 3 + 1] < 0) sprLife[i] = 0;
    }
    sprG.attributes.position.needsUpdate = true;
  }
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const hand = new THREE.Vector3();
  const fwd = () => new THREE.Vector3(Math.sin(player.heading), 0, Math.cos(player.heading));
  // water falls onto the thing from about where a can's rose would be (no hand drawn: first person)
  function canSprinkle(n = 26, at = null) {
    player.character.handWorld(hand); const f = fwd();
    if (at) { hand.lerp(new THREE.Vector3(at.x, at.y + 0.75, at.z), 0.75); f.set(at.x - hand.x, 0, at.z - hand.z).normalize(); }
    else hand.addScaledVector(f, 0.28).y += 0.05;
    sprinkle(hand, f.multiplyScalar(0.35).setY(-0.4), n, 0.22, 1);
    steps.pour(0.42);
  }

  // ---- interactions
  const ry = () => player.heading;
  void ry;
  interact.add({
    id: 'bonsai', at: () => bonsaiPos, r: 1.9, priority: 0.2,
    actions: () => {
      const st = bonsai.state || {};
      const today = new Date(); const dk = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      const watered = (st.watered || []).includes(dk), pruned = (st.pruned || []).includes(dk);
      return [
        { label: watered ? 'Give the bonsai a little more water' : 'Water the bonsai', icon: 'water', run: async () => {
          const pr = player.act('water', 2.2, bonsaiPos);
          for (let k = 0; k < 4; k++) { await wait(380); canSprinkle(14, bonsaiPos); }
          bonsai.water(clockRef.t); audio.chime(); tending.log('water');
          await pr;
          if (!watered) hud.toast('The bonsai drinks it in', 'water');
        } },
        { label: pruned ? 'Shape it a little more' : 'Prune the bonsai', icon: 'prune', run: async () => {
          const pr = player.act('prune', 2.4, bonsaiPos);
          await wait(900); bonsai.prune && bonsai.prune(clockRef.t); audio.place(); tending.log('prune');
          await pr;
          if (!pruned) { game.add('clipping', 2); hud.toast('A few clippings for your bag', 'leaf'); }
        } },
      ];
    },
  });
  // beds: one interactable per planting spot
  for (const s of spots) {
    interact.add({
      id: 'spot' + s.key, at: () => spotWorld(s), r: 1.25,
      actions: () => {
        const p = plantOf(s), st = stageOf(p);
        const out = [];
        if (p && st >= 4) out.push({ label: `Pick the ${SPECIES[p.sp].plural.toLowerCase()}`, icon: 'flower', run: () => harvest(s, p) });
        if (!p) {
          const sp = seedChoice();
          if (sp) out.push({ label: `Plant ${SPECIES[sp].name.toLowerCase()} seeds`, icon: 'seed', run: () => plant(s, sp) });
          else out.push({ label: 'No seeds left (pick flowers for more)', icon: 'seed', run: async () => hud.toast('Bloomed flowers give back seeds', 'seed') });
          const kinds = Object.keys(SPECIES).filter((k) => game.count(`seed:${k}`) > 0);
          if (kinds.length > 1) out.push({ label: 'Other seeds', icon: 'seed', run: async () => { G.seedSel = kinds[(kinds.indexOf(sp) + 1) % kinds.length]; game.save(); } });
        } else if (st < 4) {
          const wt = (p.w || []).includes(dayKey());
          if (!wt) out.push({ label: thirsty(p) ? 'It looks thirsty: water the bed' : 'Water the bed', icon: 'water', run: () => waterBed(s.bed) });
          if (st >= 2 && !(p.pin || []).includes(dayKey())) out.push({ label: 'Pinch back the tips', icon: 'prune', run: () => pinch(s, p) });
          if (wt && out.length === 0) out.push({ label: ['Seeds are resting', 'A sprout', 'Growing leaves', 'Buds are coming'][Math.max(0, st)], icon: 'eye', run: async () => hud.toast(growHint(p), 'leaf', 3200) });
        }
        return out;
      },
    });
  }
  async function pinch(s, p) {
    const pr = player.act('prune', 1.6, spotWorld(s));
    await wait(800);
    p.pin = p.pin || []; if (!p.pin.includes(dayKey())) p.pin.push(dayKey());
    game.add('clipping', 1); game.save(); audio.place(); tending.log('pinch', p.sp);
    await pr;
    hud.toast(new Set(p.pin).size <= 2 ? 'Pinched back: it will branch and bloom fuller' : 'Tidied. It is as full as it will get', 'prune', 3000);
  }
  function growHint(p) { const d = growthDays(p); const left = Math.max(0, 3.2 - d); return left < 0.6 ? 'It should bloom later today' : `About ${Math.ceil(left)} more day${Math.ceil(left) > 1 ? 's' : ''} until it blooms`; }
  function seedChoice() {
    const have = Object.keys(SPECIES).filter((k) => game.count(`seed:${k}`) > 0);
    if (!have.length) return null;
    if (G.seedSel && have.includes(G.seedSel)) return G.seedSel;
    return have.includes('snapdragon') ? 'snapdragon' : have[0];
  }
  async function plant(s, sp) {
    const pr = player.act('kneel', 1.8, spotWorld(s));
    await wait(900);
    if (!game.take(`seed:${sp}`)) return;
    G.beds = G.beds.filter((b) => b && b.k !== s.key);
    G.beds.push({ k: s.key, sp, at: Date.now(), seed: Math.floor(Math.random() * 1e6), w: [] });
    game.save(); refreshSpot(s, true); audio.place(); tending.log('plant', sp);
    await pr;
    hud.toast(`${SPECIES[sp].name} planted. Water it to help it along`, 'seed', 3200);
  }
  async function waterBed(bi) {
    const s0 = spots.find((s) => s.bed === bi && plantOf(s));
    const pr = player.act('water', 2.2, s0 ? spotWorld(s0) : null);
    const bs = spots.filter((s) => s.bed === bi);
    for (let k = 0; k < 4; k++) { await wait(380); canSprinkle(16, spotWorld(bs[k % bs.length])); if (bedSoil[bi]) bedSoil[bi].target = Math.min(1, bedSoil[bi].target + 0.3); }
    const dk = dayKey();
    for (const s of spots) if (s.bed === bi) { const p = plantOf(s); if (p) { p.w = p.w || []; if (!p.w.includes(dk)) p.w.push(dk); } }
    game.save(); audio.plink(0.5, 0.05); tending.log('water-bed');
    await pr;
    for (const s of spots) if (s.bed === bi) refreshSpot(s);
  }
  async function harvest(s, p) {
    const pr = player.act('kneel', 1.6, spotWorld(s));
    await wait(800);
    const per = PERENNIAL[p.sp], bonus = careBonus(p);
    if (per) { p.re = Date.now(); p.w = []; p.pin = []; p.picks = (p.picks || 0) + 1; } // rests, then buds again
    else G.beds = G.beds.filter((b) => b && b.k !== s.key);
    game.save(); refreshSpot(s, true);
    const n = (p.sp === 'sunflower' ? 1 : 3) + bonus, seeds = 1 + Math.min(2, bonus);
    game.add(`flower:${p.sp}`, n); game.add(`seed:${p.sp}`, seeds); if (!per) game.add('fibre', 2);
    G.harvests = (G.harvests || 0) + 1;
    audio.pickup(0); tending.log('harvest', p.sp);
    await pr;
    const what = n > 1 ? `${n} ${SPECIES[p.sp].plural.toLowerCase()}` : `A ${SPECIES[p.sp].name.toLowerCase()}`;
    hud.toast(`${what}, ${seeds} seed packet${seeds > 1 ? 's' : ''}${per ? '. It will bloom again' : ' and stems for fibre'}`, 'flower', 3600);
  }
  // the rake
  interact.add({
    id: 'rack', at: () => RACK, r: 1.5,
    actions: () => [player.character.holding === 'rake'
      ? { label: 'Hang up the rake', icon: 'rake', run: async () => setRake(false) }
      : { label: 'Take the rake', icon: 'rake', run: async () => setRake(true) }],
  });
  function setRake(on) {
    player.character.hold(on ? 'rake' : null); rackRake.visible = !on;
    hud.setTool(on ? { icon: 'rake', label: P.touch ? 'Raking · tap to put away' : 'Raking · Q to put away' } : null);
    if (on) hud.toast('Walk through the sand to rake it', 'rake');
    if (!on) { sand.rakeEnd(); audio.rake(0); }
    audio.place();
  }
  // koi: feed from the nearest bit of shore
  const shore = new THREE.Vector3();
  function nearestShore() {
    const p = player.position, a = Math.atan2(p.z - POND.cz, p.x - POND.cx), r = POND.radius(a) + 0.3;
    return shore.set(POND.cx + Math.cos(a) * r, 0, POND.cz + Math.sin(a) * r);
  }
  interact.add({
    id: 'koi', at: nearestShore, r: 1.3,
    actions: () => [{ label: 'Feed the koi', icon: 'fish', run: async () => {
      const sh = nearestShore().clone();
      const pr = player.act('toss', 1.3, new THREE.Vector3(POND.cx, 0, POND.cz));
      await wait(450);
      const a = Math.atan2(sh.z - POND.cz, sh.x - POND.cx), r = POND.radius(a) - 1.2;
      const into = new THREE.Vector3(POND.cx + Math.cos(a) * r, POND.level, POND.cz + Math.sin(a) * r);
      player.character.handWorld(hand);
      sprinkle(hand, into.clone().sub(hand).setY(0).normalize().multiplyScalar(0.9).setY(0.6), 18, 0.35, 1.6, '#d9a45a');
      await wait(600);
      const uv = pond.pointToUv(into);
      pond.tap(uv, clockRef.t, 0.6);
      for (let k = 0; k < 5; k++) pond.addDrop(uv.x + (Math.random() - 0.5) * 0.05, uv.y + (Math.random() - 0.5) * 0.05, 0.12, 0.006);
      audio.plink(uv.x, 0.04); tending.log('koi');
      await pr;
    } }],
  });
  // finds in the sand and along the shore
  function syncFinds() {
    for (const w of finds.world) {
      const id = 'find' + w.id;
      if (w.__reg) continue; w.__reg = true;
      interact.add({
        id, at: () => w.obj.position, r: 1.3, priority: 0.5, enabled: () => w.lift < 0,
        actions: () => [{ label: `Pick up the ${w.type}`, icon: w.type === 'shell' ? 'shell' : w.type === 'arrowhead' ? 'arrowhead' : w.type === 'crystal' ? 'crystal' : 'stone', run: async () => {
          const pr = player.act('kneel', 1.4, w.obj.position);
          await wait(750);
          finds.collect(w, audio); tending.log('find'); game.add(`find:${w.type}`);
          await pr; interact.remove(id);
          hud.toast(`A ${w.type} for the shelf`, w.type === 'shell' ? 'shell' : 'stone');
        } }],
      });
    }
  }
  syncFinds();
  interact.add({ id: 'shelf', at: () => ({ x: 5.0, z: 5.0 }), r: 1.6, actions: () => [{ label: 'Look at your collection', icon: 'eye', run: async () => openBag('shelf') }] });
  // snapdragons: squeeze to make them chomp
  snaps[0].clusters.forEach(([x, z], ci) => {
    interact.add({
      id: 'snap' + ci, at: () => ({ x, z }), r: 1.35,
      actions: () => [{ label: 'Squeeze a snapdragon', icon: 'hand', run: async () => {
        const pr = player.act('reach', 1.0, { x, z });
        await wait(420);
        const sd = snaps[0]; const p = player.position;
        const order = sd.centers.map((c, i) => [i, Math.hypot(c.x - p.x, c.z - p.z)]).sort((a, b) => a[1] - b[1]).slice(0, 2);
        for (const [i] of order) { const r = sd.chomp({ spike: i, point: sd.centers[i] }, clockRef.t); if (r) audio.chomp(r.deg, r.winter ? 0.015 : 0.03); }
        await pr;
      } }],
    });
  });

  // ---- bag panel
  function collectionHtml() {
    const fs = gardenState.data.finds || [];
    const by = {}; for (const f of fs) by[f.type] = (by[f.type] || 0) + 1;
    const rows = Object.entries(by).map(([t, n]) => { const inf = itemInfo('find:' + t); return `<div class="item"><span class="ic" style="color:${inf.color}">${icon(inf.icon)}</span><span>${inf.name}</span><span class="n">${n}</span></div>`; }).join('');
    return `<h3>On the shelf</h3>${rows ? `<div class="grid">${rows}</div>` : '<p class="muted">Finds you pick up rest on the wooden shelf by the snapdragons.</p>'}<p class="muted" style="margin-top:14px">${fs.length} found in all. The shelf shows the latest twelve.</p>`;
  }
  const extraTabs = [];
  function openBag(which) {
    hud.openPanel([
      { id: 'bag', label: 'Bag', icon: 'bag', render: (b) => { b.innerHTML = hud.itemsHtml(); } },
      { id: 'shelf', label: 'Shelf', icon: 'shell', render: (b) => { b.innerHTML = collectionHtml(); } },
      bagTab(),
      ...extraTabs,
    ], which);
  }

  // ---- modes: walk (the game) or ambient drift (the original calm garden)
  let walking = G.mode !== 'ambient';
  if (params.get('mode') === 'ambient') walking = false;
  if (params.get('mode') === 'walk') walking = true;
  if (params.has('cam') || params.has('camt')) walking = false; // debug framings and the old drift shots
  function applyMode() {
    hud.setMode(walking ? 'walk' : 'ambient');
    player.setVisible(walking);
    if (!walking && player.character.holding) setRake(false);
  }
  applyMode();
  // raking: the tines draw into the sand while she walks
  const tip = new THREE.Vector3();
  let rakeSegs = 0;
  function rakeStep() {
    if (!walking || player.character.holding !== 'rake') return;
    player.character.rakeTip(tip);
    const inSand = Math.abs(tip.x - SAND.cx) < SAND.w / 2 - 0.15 && Math.abs(tip.z - SAND.cz) < SAND.d / 2 - 0.15;
    if (inSand && player.speed > 0.1) {
      const d = sand.rakeMove({ x: (tip.x - (SAND.cx - SAND.w / 2)) / SAND.w, y: (SAND.cz + SAND.d / 2 - tip.z) / SAND.d });
      audio.rake(d * 60); if (d > 0) rakeSegs++;
    } else if (sand.raking) { sand.rakeEnd(); audio.rake(0); }
  }
  const api = {
    places, get cove() { return cove; }, get fishing() { return fishing; }, get fauna() { return fauna; },
    // tests: walk with a virtual stick, raking as she goes
    sim(x, y, secs, runK = 0) { const dt = 1 / 30; for (let t = 0; t < secs; t += dt) { player.step(dt, x, y, runK); rakeStep(); } for (let k = 0; k < 15; k++) { player.step(dt, 0, 0); rakeStep(); } },
    setRake,
    player, interact, hud, spots, extraTabs, colliders: pc, sprinkle, wait, ground, clock: clockRef, bonsaiPos, spotWorld, steps,
    get walking() { return walking; },
    setWalking(on) { walking = on; G.mode = on ? 'walk' : 'ambient'; game.save(); applyMode(); if (on) player.snapCamera(); },
    look(dx, dy) { player.look(dx, dy); },
    openBag,
    update(dt, clock, ts) {
      clockRef.t = clock;
      rocket.update(dt, clock, ts);
      api.fogK += ((rocket.launching ? 1 + Math.max(0, rocket.rocket.group.position.y - 40) / 60 : 1) - api.fogK) * Math.min(1, dt * (rocket.launching ? 0.25 : 2));
      if (api.cinematic) return;
      if (walking && !hud.panelOpen && !hud.dialogOpen) player.update(dt);
      else player.character.update(dt, {});
      if (walking) { places.update(dt, player.position); cove.update(dt, player); if (fishTool() || gb.isTool()) { equip.bindView(camera, player); equip.update(dt); } fishing.update(dt); coveBarTick(); gb.update(dt); fauna.update(dt); }
      if (GAME && walking && !rocket.launching && !rocket.landing) gardenEdge();
      if (api.dig) { api.digSync(); api.dig.setActive(walking && !rocket.launching && !rocket.landing); api.dig.update(dt); }
      if (avatarPc) { avatarPc.setHidden(rocket.launching || rocket.landing); avatarPc.update(dt, { forceThird: !walking }); }
      interact.update();
      hud.tick(dt, player.speed > 0.2);
      updateSprinkles(dt);
      for (let bi = 0; bi < bedSoil.length; bi++) {
        const b = bedSoil[bi]; if (!b) continue;
        const today = G.beds.some((p) => p && p.k.startsWith(bi + ':') && (p.w || []).includes(dayKey()));
        b.target = Math.max(today ? 0.7 : 0, b.target - dt * 0.004);
        if (Math.abs(b.wet - b.target) > 0.002) { b.wet += (b.target - b.wet) * Math.min(1, dt * 1.2); b.mat.color.copy(dryCol).lerp(wetCol, b.wet); b.mat.roughness = 1 - b.wet * 0.35; }
      }
      rakeStep();
      refreshT += dt;
      if (refreshT > 20) { refreshT = 0; spots.forEach((s) => refreshSpot(s)); syncFinds(); }
      seenT += dt; if (seenT > 60) { seenT = 0; G.lastSeen = Date.now(); game.save(); }
      // beds sway a touch in the breeze
      const t = clock;
      for (const s of spots) if (s.mesh) {
        const dr = s.thirsty ? 1 : 0; s.droop = (s.droop || 0) + (dr - (s.droop || 0)) * Math.min(1, dt * 0.5);
        s.mesh.rotation.z = Math.sin(t * 1.3 + s.i * 1.7 + s.bed) * 0.035 * (1 - s.droop * 0.6) + s.droop * 0.16; s.mesh.rotation.x = Math.sin(t * 0.9 + s.i) * 0.02 + s.droop * 0.12;
        s.mesh.scale.y = 1 - s.droop * 0.12;
      }
      void ts;
    },
    updateCamera(dt, lift) { player.updateCamera(dt, { lift }); if (avatarPc) avatarPc.updateCamera(dt); },
    info() { const p = player.position; return { mode: walking ? 'walk' : 'ambient', pos: [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)], heading: +player.heading.toFixed(2), prompt: interact.current ? interact.current.id : null, holding: player.character.holding, inv: G.inv, beds: G.beds.length, rakeSegs, tip: [+tip.x.toFixed(2), +tip.z.toFixed(2)], unlockAll: UNLOCK_ALL }; },
  };
  // HUD + keys route here while Earth is active
  const activeApi = {
    primary: () => { if (hud.dialogOpen) return; if (walking) interact.run(0); },
    secondary: () => walking && interact.run(1),
    jump: () => walking && player.jump(),
    bag: () => walking && openBag(),
    mode: () => api.setWalking(!walking),
    tool: () => { if (player.character.holding) setRake(false); },
    map: () => api.onMap && api.onMap(),
  };
  liveApi = activeApi;
  api.onExit = () => { if (coveBar) coveBar.show(false); }; // the garden's tool row stays behind when she leaves (it only updates while the garden runs)
  api.activate = () => { setActive(activeApi); hud.showJump(false); hud.showMap(game.unlocked('warp')); hud.setMode(walking ? 'walk' : 'ambient'); };
  api.activate();
  // phase 2: workshop, gathering, rocket and launch — only on the game host / ?game=1
  api.cinematic = false; api.fogK = 1;
  const GAME = isGameWorld();
  if (GAME) { const msg = api_away && api_away(); game.save(); if (msg) setTimeout(() => hud.toast(msg, 'leaf', 6000), 2600); }
  const rocket = GAME ? createEarthRocket(api, E) : {
    update() {}, reset() {}, launching: false,
    rocket: { group: { position: { y: 0 } } },
    cinematicCamera() {},
  };
  api.rocket = rocket;
  // the Moon is a delta-v away, not a free trip: what the classic stage still has once in orbit (the
  // workshop flight model, vacuum) has to cover leaving orbit for the Moon and braking down onto it
  const MOON_TRIP_DV = (() => { const mu = 9.81 * 6.371e6 ** 2, r1 = 6.571e6, r2 = 384.4e6, v1 = Math.sqrt(mu / r1); return Math.round(v1 * (Math.sqrt(2 * r2 / (r1 + r2)) - 1) + Math.sqrt(800 ** 2 + 2 * 1.62 * 1.7374e6)); })();
  api.moonTripDv = MOON_TRIP_DV;
  if (GAME) rocket.onLaunched = async () => {
    let dv = 0, sim = null;
    try { sim = await import('./rocket-sim.js'); const d = sim.designFrom(G.rocket || {}), r = sim.readout(d, { ...sim.EARTH_RULES, rho0: 0 }); dv = r.dv;
      if (dv >= MOON_TRIP_DV && r.stages.length) { const st = r.stages[r.stages.length - 1], m1 = st.mass - st.fuel * sim.LOAD_KG, ve = st.dv / Math.log(st.mass / m1), after = st.mass * Math.exp(-MOON_TRIP_DV / ve); G.rocket.fuel = Math.max(0, Math.floor((after - m1) / sim.LOAD_KG * 100) / 100); game.save(); }
    } catch (e) { console.warn('[rocket] moon dv', e); }
    if (dv < MOON_TRIP_DV) {
      hud.toast(`In orbit with ${Math.round(dv)} m/s left. The Moon needs about ${MOON_TRIP_DV} m/s from here (out of orbit, then braking down onto it). She comes home under the parachute: build for more delta-v.`, 'star', 9000);
      rocket.reset(); walking = true; applyMode(); player.snapCamera(); api.activate(); hud.fadeTo(0, 1500); return;
    }
    return E.worlds.go('space', { from: 'earth', to: 'moon' });
  };
  // diggable ground around the garden (the garden, pad, shed and anything standing stay untouched)
  if (GAME) import('./g7/dig-ground.js').then((m) => {
    const gm = scene.getObjectByName('ground'); if (!gm) return;
    const host = gm.material;
    const vm = m.voxelCopy(host, (sh) => {
      // tops near the old surface keep the lawn / salt look; cut walls and pit floors show the ground itself
      sh.vertexShader = 'varying float vDigY; varying float vDigN;\n' + sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
        vDigY = (modelMatrix * vec4(transformed, 1.0)).y; vDigN = normalize(mat3(modelMatrix) * objectNormal).y;`);
      sh.fragmentShader = 'varying float vDigY; varying float vDigN;\n' + sh.fragmentShader
        .replace('#include <color_fragment>', `vec3 lawnC = diffuseColor.rgb;
        #include <color_fragment>
        diffuseColor.rgb = lawnC;`)
        .replace('#include <lights_physical_fragment>', `{ float lawnK = smoothstep(0.72, 0.9, vDigN) * smoothstep(-0.28, -0.1, vDigY);
          diffuseColor.rgb = mix(vColor.rgb, diffuseColor.rgb, lawnK); totalEmissiveRadiance *= lawnK; }
        #include <lights_physical_fragment>`);
    });
    vm.aoMap = null; // the garden AO bake rides uv2, which voxels do not have
    vm.userData.uvScale = [1, -1]; // the ground disc's uv is (x, -z) in metres
    const soil = new THREE.Color('#5e4330');
    const dig = m.createDigGround({
      key: 'home:earth', scene, camera, P, player, hud, interact, height: () => 0, soilDepth: 1.6,
      // lawn soil near the garden, then the salt flat (crust and lake sediment, pale and loose), bedrock below
      biome: (x, z) => (Math.hypot((x - 1.5) * 0.85, z + 0.5) > 30 ? 'salt' : 'forest'),
      groundColor: (x, z, y, slope, col) => col.copy(soil),
      groundMats: [host], voxMat: vm, tint: { 2: '#b9ad97' }, // salt-flat sediment: pale clay, not beach sand
      area: { cx: 1.5, cz: -0.5, half: 64 }, fibre: true,
      noDig: (x, z) => {
        if (Math.hypot((x - 1.5) * 0.85, z + 0.5) < 26) return 'The garden stays as it is. Dig out past the lawn';
        if (Math.hypot(x - 34, z - 1) < 7) return 'Not under the launch pad';
        if (coveInside(x, z) > -COVE.bank - 1.2 || headTop(x, z) != null) return 'The cove\'s banks are wet and loose: nothing to dig here';
        if (x > 15 && x < 26 && z > -4 && z < 9) return 'Too close to the shed';
        if (pc.distance(x, z) < 1.4) return 'Something stands here';
        return null;
      },
      sound: (k) => steps.play && steps.play(k, 1),
    });
    dig.wrapEnv(gb.env(cove.env({ ground })));
    player.setEnv(dig.env);
    // leaf litter and petals resting on the old surface would hang over a pit
    for (const n of ['fallingLeaves', 'physicsPetals']) { const o = scene.getObjectByName(n); if (o && o.material) dig.maskMaterial(o.material, 0.12); }
    // and the lawn's grass blades (their own shader places them; same mask, blade height)
    scene.traverse((o) => { const mt = o.isMesh && o.material; if (mt && mt.customProgramCacheKey && /^grass/.test(String(mt.customProgramCacheKey()))) dig.maskMaterial(mt, 0.7); });
    api.dig = dig;
    // the scanned lawn arrives later: keep the voxel copy on the same textures
    api.digSync = () => { if (vm.map !== host.map) { vm.map = host.map; vm.normalMap = host.normalMap; vm.roughnessMap = host.roughnessMap; vm.normalScale.copy(host.normalScale); vm.color.copy(host.color); vm.aoMap = null; vm.needsUpdate = true; } };
  }).catch((e) => console.warn('[dig] earth', e));
  // no wall: past the salt flat the garden is one place on the whole Earth (the sphere world, made ready
  // while she walks out; same spot and heading, no fade). Walking back in returns here.
  let edgeBusy = false, edgePrep = false;
  const earthArg = (m) => { const h = m.homeBody('earth'); return { site: 'earth', seed: h.body.seed, star: 0, index: 2, addr: h.addr, dim: 'prime' }; };
  function gardenEdge() {
    const q = player.position, r = Math.hypot(q.x - GARDEN.cx, q.z - GARDEN.cz);
    if (r > GARDEN.out - 14 && !edgePrep) { edgePrep = true; import('../universe/home.js').then((m) => E.worlds.prepare && E.worlds.prepare('planet', { ...earthArg(m), x: q.x, z: q.z })).catch((e) => console.warn('[garden] prepare', e)); }
    if (r < GARDEN.out - 24) edgePrep = false;
    if (r > GARDEN.out && !edgeBusy) {
      edgeBusy = true;
      import('../universe/home.js').then((m) => E.worlds.go('planet', { ...earthArg(m), from: 'walk', x: q.x, z: q.z, yaw: player.heading }))
        .catch((e) => { console.warn('[garden] walk out', e); const k = (GARDEN.out - 3) / r; player.teleport(GARDEN.cx + (q.x - GARDEN.cx) * k, GARDEN.cz + (q.z - GARDEN.cz) * k, player.heading); })
        .finally(() => { edgeBusy = false; edgePrep = false; });
    }
  }
  // a beacon at the garden: the only way to jump home from the ship (crafted and planted by hand)
  if (GAME) import('../universe/beacons.js').then((B) => interact.add({ id: 'garden-beacon', at: () => ({ x: 30, y: 0, z: -6 }), r: 3.5, priority: 0.2, enabled: () => B.hasBeaconItem() && !B.gardenBeacon(),
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
    scene.add(g);
    solid(post, { name: 'spawn lantern post' }); bakeSolids(g, pc, { ground, tag: 'spawn' });
    interact.add({ id: 'spawn', at: () => ({ x: WORLD_SPAWN.x, y: 0, z: WORLD_SPAWN.z }), r: 1.6, priority: 0.05, enabled: () => true,
      actions: () => [{ label: 'The arrival stone (world spawn)', icon: 'star', run: () => hud.toast('This is the world spawn. New players arrive here, your home beacon brings you back here, and friends you invite land here when you are offline.', 'star', 6500) }] });
  }
  api.onEnter = async (arg) => {
    if (arg.from === 'walk' && arg.x != null) { rocket.reset(); walking = true; applyMode(); player.teleport(arg.x, arg.z, arg.yaw || 0); player.snapCamera(); api.activate(); hud.fadeTo(0, 1); return; }
    if (arg.from === 'beacon') { rocket.reset(); walking = true; applyMode(); const b = arg.beacon; if (!b || b.home) player.teleport(WORLD_SPAWN.x, WORLD_SPAWN.z, WORLD_SPAWN.yaw); else player.teleport(28, -4, Math.PI * 0.9); player.snapCamera(); api.activate(); hud.fadeTo(0, 700); return; }
    if (arg.from === 'space' && G.rocket.parts.length >= 5 && rocket.land) {
      walking = true; applyMode();
      const landed = rocket.land(); hud.fadeTo(0, 1500); await landed;
      player.snapCamera(); api.activate(); hud.fadeTo(0, 1500); return;
    }
    if (arg.from === 'space' || arg.from === 'moon' || arg.from === 'warp') { rocket.reset(); walking = true; applyMode(); player.snapCamera(); }
    api.activate();
    hud.fadeTo(0, 1500);
  };
  api.onMap = () => {
    if (!game.unlocked('warp')) return;
    return openStarMap({ current: 'earth', onTravel: (d) => { if (d.world === 'earth') return; E.worlds.go(d.world, { ...d, from: 'warp' }).catch((e) => { console.warn('[G] warp failed', e); hud.toast('That world is still forming', 'star'); }); } });
  };
  api.activeApi = activeApi;
  api.where = () => { if (!GAME || !walking || rocket.launching || rocket.landing) return null; const q = player.position; return { world: 'earth', x: +q.x.toFixed(2), z: +q.z.toFixed(2), yaw: +(player.cam.yaw - Math.PI).toFixed(3) }; };
  api.restoreWhere = (w) => { if (!GAME || !w || w.world !== 'earth' || !walking) return; player.teleport(w.x, w.z, w.yaw || 0); player.snapCamera(); };
  // first-person pointer: drag looks, a still tap acts on what she is looking at (else falls to the world)
  api.input = lookInput({ player, tap: (e) => { if (interact.current) activeApi.primary(); else if (api.onEmptyTap) api.onEmptyTap(e); } });
  return api;
}
