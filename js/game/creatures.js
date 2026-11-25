// Planet animals: three body plans sculpted, rigged and walk-cycled in Blender
// (/workspace/mom-garden-tools/blender/creatures_build.py): an antelope-like grazer, an emu-like
// strider and a monitor-like crawler. Each species tints the shared baked coat (a luminance bake)
// with natural colours and countershading, and varies size and proportion a little. They wander,
// graze and move off if she comes close too fast. None are hostile; none chase.
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { loadModel } from './models.js';
import { rng, hash, makeName } from './names.js';

const PLANS = ['quad', 'strider', 'crawler'];
const FILE = { quad: 'creature_grazer', strider: 'creature_strider', crawler: 'creature_crawler' };
const PACE = { quad: 1.25, strider: 1.1, crawler: 0.9 }; // m/s of the authored walk cycle at scale 1
const PLAN_LABEL = { quad: 'four-legged grazer', strider: 'long-legged strider', crawler: 'low crawler' };
// back / belly pairs from real animals (antelope, emu, monitor, ibex, rhea, iguana...) with a few
// slightly off-Earth ones (slate blue-grey, olive-bronze) for the alien twist
const COATS = [
  ['#7a5a3a', '#d8c7a8'], ['#8c6a45', '#e6d8bd'], ['#5b4a3a', '#b9a68c'], ['#6e6a5c', '#cfc8b4'],
  ['#4d4740', '#a59b8a'], ['#8a5a36', '#e2cfae'], ['#5e5e58', '#b8b2a2'], ['#5a6266', '#b4b8b2'],
  ['#5f5a3c', '#bdb48e'], ['#3e3a34', '#8f8574'], ['#9a7c55', '#efe3c8'], ['#6b4c3b', '#c9ae92'],
];
let kit = null;
export function preloadCreatures() {
  if (!kit) kit = Promise.all(PLANS.map((p) => loadModel(FILE[p]))).then((ms) => { const o = {}; PLANS.forEach((p, i) => { o[p] = ms[i]; }); kit = o; return o; });
  return kit;
}
const ready = () => kit && !(kit instanceof Promise);

function coatMaterial(src, back, belly, alien) {
  const m = src.clone(); m.color = new THREE.Color(back); m.roughness = 0.85; m.metalness = 0;
  const b = new THREE.Color(back), l = new THREE.Color(belly);
  const ratio = { r: l.r / Math.max(b.r, 0.01), g: l.g / Math.max(b.g, 0.01), b: l.b / Math.max(b.b, 0.01) };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uBelly = { value: new THREE.Vector3(ratio.r, ratio.g, ratio.b) }; sh.uniforms.uAlien = { value: alien };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vObjN; varying vec3 vObjP;')
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvObjN = objectNormal; vObjP = position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vObjN; varying vec3 vObjP; uniform vec3 uBelly; uniform float uAlien;')
      .replace('#include <map_fragment>', `#include <map_fragment>
      float up = normalize(vObjN).y;
      diffuseColor.rgb *= mix(uBelly, vec3(1.0), smoothstep(-0.45, 0.3, up));       // pale belly
      diffuseColor.rgb *= mix(1.0, 0.78, smoothstep(0.55, 0.95, up));              // darker dorsal line
      // faint banding along the body for some species (the alien part, kept quiet)
      diffuseColor.rgb *= 1.0 - uAlien * 0.16 * smoothstep(0.2, 0.8, sin(vObjP.z * 22.0 + vObjP.y * 6.0)) * smoothstep(-0.1, 0.4, up);`);
  };
  m.customProgramCacheKey = () => 'coat';
  return m;
}

export function makeSpecies(W, { lite }) {
  void lite; preloadCreatures();
  const r0 = rng(hash(W.seed, 41));
  const n = 2 + Math.floor(r0() * 3); // 2-4: fewer, better
  const style = W.dim.creature; // dimension style: soft / tall / round / many
  const order = [...PLANS].sort(() => r0() - 0.5), list = [];
  for (let i = 0; i < n; i++) {
    const r = rng(hash(W.seed, 43, i));
    const plan = order[i % order.length];
    const [back, belly] = COATS[Math.floor(r() * COATS.length)];
    const shade = 0.85 + r() * 0.3;
    const size = (plan === 'strider' ? 0.75 + r() * 0.45 : plan === 'crawler' ? 0.55 + r() * 0.7 : 0.6 + r() * 0.6) * (style === 'tall' ? 1.15 : style === 'round' ? 0.9 : 1);
    const biomes = ['forest', 'shore', 'salt', 'crystal', 'ice'].filter(() => r() < 0.55);
    if (!biomes.length) biomes.push('forest');
    list.push({ i, plan, size, back: new THREE.Color(back).multiplyScalar(shade), belly: new THREE.Color(belly), alien: r() < 0.35 ? 1 : 0,
      lean: 0.92 + r() * 0.16, speed: (plan === 'crawler' ? 0.6 : plan === 'strider' ? 1.2 : 1.0) * (0.85 + r() * 0.3), shy: 5 + r() * 6, biomes,
      name: makeName(hash(W.seed, 47, i)), label: PLAN_LABEL[plan], herd: plan === 'quad' ? 2 + Math.floor(r() * 3) : plan === 'strider' ? 1 + Math.floor(r() * 2) : 1, mats: null });
  }
  return list;
}

// one animal: a skinned clone with its own mixer; null until the models are loaded
export function buildCreature(S) {
  if (!ready()) return null;
  const src = kit[S.plan]; if (!src) return null;
  const root = new THREE.Group();
  const body = cloneSkinned(src.scene); root.add(body);
  const meshes = []; body.traverse((o) => { if (o.isSkinnedMesh) meshes.push(o); });
  meshes.sort((a, b) => b.geometry.index.count - a.geometry.index.count); // lod0 first
  if (!S.mats) S.mats = meshes.map((m) => coatMaterial(m.material, S.back, S.belly, S.alien));
  meshes.forEach((m, k) => { m.material = S.mats[k]; m.castShadow = k === 0; m.receiveShadow = false; m.frustumCulled = false; m.visible = k === 0; });
  const v = 0.94 + Math.random() * 0.12; // individuals differ a little
  root.scale.set(S.size * v * S.lean, S.size * v, S.size * v * (2 - S.lean));
  const mixer = new THREE.AnimationMixer(body), acts = {};
  for (const clip of src.animations) { const a = mixer.clipAction(clip); a.play(); a.setEffectiveWeight(clip.name === 'idle' ? 1 : 0); acts[clip.name] = a; }
  mixer.update(Math.random() * 4);
  return { root, parts: { meshes, mixer, acts, lod: 0 } };
}

function weigh(P, want, dt) {
  const k = Math.min(1, dt * 3);
  for (const [n, a] of Object.entries(P.acts)) a.setEffectiveWeight(a.getEffectiveWeight() + ((want[n] || 0) - a.getEffectiveWeight()) * k);
}
// one animal's life: wander / graze / move off. Mutates `a`.
export function stepCreature(a, dt, t, ctx) {
  const S = a.S, p = a.root.position, P = a.parts;
  const dx = ctx.player.x - p.x, dz = ctx.player.z - p.z, dist = Math.hypot(dx, dz);
  if (dist < S.shy * (ctx.playerSpeed > 2 ? 1.5 : 1) && ctx.playerSpeed > 0.3 && a.state !== 'flee') { a.state = 'flee'; a.timer = 3 + Math.random() * 2; const k = 14 / (dist || 1); a.tx = p.x - dx * k; a.tz = p.z - dz * k; }
  a.timer -= dt;
  if (a.timer <= 0) {
    if (a.state === 'walk' || a.state === 'flee') { a.state = Math.random() < 0.6 ? 'graze' : 'idle'; a.timer = 3 + Math.random() * 6; }
    else { a.state = 'walk'; a.timer = 5 + Math.random() * 7; const ang = Math.random() * 6.283, d = 4 + Math.random() * 12; a.tx = a.home.x + Math.cos(ang) * d; a.tz = a.home.z + Math.sin(ang) * d; }
  }
  let speed = 0;
  if (a.state === 'walk' || a.state === 'flee') {
    const ex = a.tx - p.x, ez = a.tz - p.z, d = Math.hypot(ex, ez);
    if (d < 0.5) a.timer = 0;
    else {
      const want = Math.atan2(ex, ez);
      let dh = want - a.heading; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      a.heading += dh * Math.min(1, dt * 1.6);
      speed = S.speed * (a.state === 'flee' ? 1.9 : 1) * S.size;
      const nx = p.x + Math.sin(a.heading) * a.speedNow * dt, nz = p.z + Math.cos(a.heading) * a.speedNow * dt;
      if (ctx.walkable(nx, nz)) { p.x = nx; p.z = nz; } else { a.timer = 0; a.state = 'idle'; }
    }
  }
  a.speedNow += (speed - a.speedNow) * Math.min(1, dt * 2);
  // ground follow, eased so steps on rough ground don't pop
  const gy = ctx.height(p.x, p.z); p.y += (gy - p.y) * Math.min(1, dt * 10);
  a.root.rotation.y = a.heading;
  if (!P.mixer) return;
  // LOD by distance; far animals update their pose less often
  const lod = dist > (ctx.lite ? 18 : 30) ? 1 : 0;
  if (lod !== P.lod) { P.lod = lod; P.meshes.forEach((m, k) => { m.visible = k === lod; }); }
  const moving = a.speedNow > 0.08;
  weigh(P, moving ? { walk: 1 } : a.state === 'graze' ? { graze: 1 } : { idle: 1 }, dt);
  if (P.acts.walk) P.acts.walk.timeScale = Math.max(0.3, a.speedNow / (PACE[S.plan] * S.size));
  P.acc = (P.acc || 0) + dt;
  if (lod === 0 || P.acc > 0.1) { P.mixer.update(P.acc); P.acc = 0; }
}
