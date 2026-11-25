// Earth (the home garden) as a place to walk and tend: the gardener, raised flower beds, the rake,
// koi feeding, finds, the bonsai, and (phase 2) the workshop + rocket. Ambient drift stays available.
import * as THREE from 'three';
import { createPlayer } from './player.js';
import { createInteractor } from './interact.js';
import { getHud, setActive } from './session.js';
import { game, SPECIES, itemInfo, dayKey, UNLOCK_ALL } from './store.js';
import { buildPlant } from './plants.js';
import { buildRake } from './character.js';
import { createColliders } from '../colliders.js';
import { icon } from './icons.js';
import { mergeGeometries } from '../util.js';

const DAY = 86400000;
// beds: three cedar raised beds on the front lawn, four planting spots each
export const BEDS = [{ x: -6.6, z: 10.7, ry: 0.06 }, { x: -3.5, z: 10.95, ry: 0 }, { x: -0.4, z: 10.7, ry: -0.06 }];
export const BED_ZONE = { x0: -8.4, x1: 1.4, z0: 9.6, z1: 12.1 };
const RACK = { x: 4.85, z: -2.3 };

export function createEarthGame(E) {
  const { scene, camera, P, params, audio, colliders, sand, SAND, pond, POND, bonsai, bonsaiPos, finds, snaps, gardenState, growOverride, tending, canvas } = E;
  const hud = getHud(P);
  const G = game.data;
  const clockRef = { t: 0 };

  // ---- player colliders: the garden's list, but the pond follows its real outline (+ bank stones)
  const pc = createColliders();
  for (const c of colliders.list) if (c.name !== 'pond') pc.list.push(c);
  pc.shape((x, z) => POND.dist(x, z) - 0.42, { h: 0.4, kind: 'water', name: 'pond' });
  for (const [x, z] of snaps[0].clusters) pc.circle(x, z, 0.42, { h: 0.6, name: 'snaps' });
  pc.circle(RACK.x, RACK.z, 0.3, { h: 1.2, name: 'rack' });
  const ground = (x, z) => (Math.abs(x - SAND.cx) < SAND.w / 2 && Math.abs(z - SAND.cz) < SAND.d / 2 ? 0.09 : 0);

  const player = createPlayer({ scene, camera, hud, P, colliders: pc, ground, start: { x: -2.6, z: 8.3, yaw: Math.PI * 0.92 }, bounds: { cx: 1.5, cz: -0.5, r: 58 } });
  const interact = createInteractor({ hud, player });

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
    const top = new THREE.Mesh(new THREE.PlaneGeometry(BW - 0.12, BD - 0.12, 8, 4).rotateX(-Math.PI / 2), soil);
    { const p = top.geometry.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, Math.sin(p.getX(i) * 9) * 0.008 + Math.cos(p.getZ(i) * 13 + p.getX(i) * 3) * 0.008); top.geometry.computeVertexNormals(); }
    top.position.y = BH - 0.04; top.receiveShadow = true; grp.add(top);
    pc.box(b.x, b.z, BW / 2 + 0.02, BD / 2 + 0.02, { ry: b.ry, h: BH, name: 'bed' });
    for (let i = 0; i < 4; i++) {
      const lx = -BW / 2 + 0.36 + i * ((BW - 0.72) / 3);
      const holder = new THREE.Group(); holder.position.set(lx, BH - 0.04, 0); grp.add(holder);
      spots.push({ bed: bi, i, holder, grp, key: `${bi}:${i}`, mesh: null, stage: -2 });
    }
  });
  for (const [k, list] of Object.entries(plankGeos)) { const o = new THREE.Mesh(mergeGeometries(list), k === 'light' ? cedar : cedarDark); o.castShadow = true; o.receiveShadow = true; scene.add(o); }
  grpUpdateWorld();
  function grpUpdateWorld() { for (const s of spots) s.grp.updateMatrixWorld(true); }
  const spotWorld = (s) => s.holder.getWorldPosition(new THREE.Vector3());
  const plantOf = (s) => G.beds.find((b) => b && b.k === s.key);
  function growthDays(p) {
    const days = (Date.now() - p.at) / DAY + growOverride;
    return days + Math.min(new Set(p.w || []).size, 6) * 0.5;
  }
  const stageOf = (p) => { if (!p) return -1; const d = growthDays(p); return d < 0.35 ? 0 : d < 1.2 ? 1 : d < 2.4 ? 2 : d < 3.2 ? 3 : 4; };
  // a little wooden stake with a coloured tag marks each planted spot
  const stakeGeo = new THREE.BoxGeometry(0.018, 0.16, 0.01).translate(0, 0.08, 0);
  const tagGeo = new THREE.BoxGeometry(0.05, 0.035, 0.012).translate(0, 0.15, 0.002);
  const stakeMat = new THREE.MeshStandardMaterial({ color: '#c9a77a', roughness: 0.9 });
  const tagMats = {};
  function refreshSpot(s, force = false) {
    const p = plantOf(s), st = stageOf(p);
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
    const sp = Object.keys(SPECIES); const stg = { seed: 0.1, sprout: 0.8, leafy: 1.8, bud: 2.8, bloom: 6 }[params.get('beds')] ?? 6;
    G.beds = spots.map((s, i) => ({ k: s.key, sp: sp[i % sp.length], at: Date.now() - (stg - growOverride) * DAY, seed: 100 + i * 7, w: [] }));
  }
  spots.forEach((s) => refreshSpot(s, true));
  let refreshT = 0;

  // ---- rake rack beside the sand
  const rack = new THREE.Group(); rack.position.set(RACK.x, 0, RACK.z); rack.rotation.y = -0.4; scene.add(rack);
  {
    const w = cedarDark;
    for (const sx of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.1, 0.06), w); p.position.set(sx * 0.3, 0.55, 0); p.castShadow = true; rack.add(p); }
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.05, 0.07), w); bar.position.y = 1.02; bar.castShadow = true; rack.add(bar);
  }
  const rackRake = buildRake(); rackRake.position.set(0, 0.06, 0.13); rackRake.rotation.set(0.16, 0, Math.PI); rackRake.position.y = 1.55; rack.add(rackRake);

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
  function canSprinkle(n = 26) {
    player.character.handWorld(hand); const f = fwd();
    hand.addScaledVector(f, 0.28).y += 0.05;
    sprinkle(hand, f.multiplyScalar(0.6).setY(-0.2), n, 0.18, 1);
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
          for (let k = 0; k < 4; k++) { await wait(380); canSprinkle(14); }
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
          if (!wt) out.push({ label: 'Water the bed', icon: 'water', run: () => waterBed(s.bed) });
          else out.push({ label: ['Seeds are resting', 'A sprout', 'Growing leaves', 'Buds are coming'][Math.max(0, st)], icon: 'eye', run: async () => hud.toast(growHint(p), 'leaf', 3200) });
        }
        return out;
      },
    });
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
    for (let k = 0; k < 4; k++) { await wait(380); canSprinkle(16); }
    const dk = dayKey();
    for (const s of spots) if (s.bed === bi) { const p = plantOf(s); if (p) { p.w = p.w || []; if (!p.w.includes(dk)) p.w.push(dk); } }
    game.save(); audio.plink(0.5, 0.05); tending.log('water-bed');
    await pr;
    for (const s of spots) if (s.bed === bi) refreshSpot(s);
  }
  async function harvest(s, p) {
    const pr = player.act('kneel', 1.6, spotWorld(s));
    await wait(800);
    G.beds = G.beds.filter((b) => b && b.k !== s.key); game.save();
    refreshSpot(s, true);
    const n = p.sp === 'sunflower' ? 1 : 3;
    game.add(`flower:${p.sp}`, n); game.add(`seed:${p.sp}`, 2);
    audio.pickup(0); tending.log('harvest', p.sp);
    await pr;
    hud.toast(`${n > 1 ? SPECIES[p.sp].plural : 'A ' + SPECIES[p.sp].name.toLowerCase()} and 2 seed packets for your bag`, 'flower');
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
    // tests: walk with a virtual stick, raking as she goes
    sim(x, y, secs, runK = 0) { const dt = 1 / 30; for (let t = 0; t < secs; t += dt) { player.step(dt, x, y, runK); rakeStep(); } for (let k = 0; k < 15; k++) { player.step(dt, 0, 0); rakeStep(); } },
    setRake,
    player, interact, hud, spots, extraTabs, colliders: pc, sprinkle, wait, ground, clock: clockRef,
    get walking() { return walking; },
    setWalking(on) { walking = on; G.mode = on ? 'walk' : 'ambient'; game.save(); applyMode(); if (on) player.snapCamera(); },
    look(dx, dy) { player.look(dx, dy); },
    openBag,
    update(dt, clock, ts) {
      clockRef.t = clock;
      if (walking && !hud.panelOpen && !hud.dialogOpen) player.update(dt);
      else player.character.update(dt, {});
      interact.update();
      hud.tick(dt, player.speed > 0.2);
      updateSprinkles(dt);
      rakeStep();
      refreshT += dt;
      if (refreshT > 20) { refreshT = 0; spots.forEach((s) => refreshSpot(s)); syncFinds(); }
      // beds sway a touch in the breeze
      const t = clock;
      for (const s of spots) if (s.mesh) { s.mesh.rotation.z = Math.sin(t * 1.3 + s.i * 1.7 + s.bed) * 0.035; s.mesh.rotation.x = Math.sin(t * 0.9 + s.i) * 0.02; }
      void ts;
    },
    updateCamera(dt, lift) { player.updateCamera(dt, { lift }); },
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
  api.activate = () => { setActive(activeApi); hud.showJump(false); hud.showMap(game.unlocked('warp')); };
  api.activate();
  api.activeApi = activeApi;
  canvas.addEventListener('wheel', (e) => { if (walking) player.zoom(e.deltaY > 0 ? 1.08 : 1 / 1.08); }, { passive: true });
  return api;
}
