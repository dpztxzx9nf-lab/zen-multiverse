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

const EYE_MAT = new THREE.MeshPhysicalMaterial({ color: '#0b0705', roughness: 0.06, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.02 });
function coatMaterial(src, back, belly, alien, plan = 'quad') {
  const scaly = plan === 'crawler';
  const m = src.clone(); m.color = new THREE.Color(back); m.roughness = 0.85; m.metalness = 0;
  const b = new THREE.Color(back), l = new THREE.Color(belly);
  const ratio = { r: l.r / Math.max(b.r, 0.01), g: l.g / Math.max(b.g, 0.01), b: l.b / Math.max(b.b, 0.01) };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uBelly = { value: new THREE.Vector3(ratio.r, ratio.g, ratio.b) }; sh.uniforms.uAlien = { value: alien };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vObjN; varying vec3 vObjP;')
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvObjN = objectNormal; vObjP = position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vObjN; varying vec3 vObjP; uniform vec3 uBelly; uniform float uAlien;
      float cH(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
      float cN(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(cH(i), cH(i + vec3(1, 0, 0)), f.x), mix(cH(i + vec3(0, 1, 0)), cH(i + vec3(1, 1, 0)), f.x), f.y),
                   mix(mix(cH(i + vec3(0, 0, 1)), cH(i + vec3(1, 0, 1)), f.x), mix(cH(i + vec3(0, 1, 1)), cH(i + vec3(1, 1, 1)), f.x), f.y), f.z); }
      // coat micro-relief: combed fur strands (long along the body), feather vanes or overlapping scales.
      // Every octave fades to its mean once its cells shrink below ~a pixel (fp = object-space pixel
      // footprint): unfiltered sub-pixel noise was what made coats read as a speckled mosaic.
      float cF(float fp, float f) { return 1.0 - smoothstep(0.18, 0.55, fp * f); }
      float cO(vec3 p, float fp, float f) { return mix(0.5, cN(p), cF(fp, f)); }
      float coatH(float fp) {
        ${scaly ? `vec2 q = vObjP.zx * vec2(34.0, 40.0); q.y += 0.5 * floor(q.x); vec2 c = fract(q) - 0.5;
        return mix(0.45, smoothstep(0.5, 0.05, length(c * vec2(1.0, 1.4))), cF(fp, 40.0)) * 0.8 + cO(vObjP * 90.0, fp, 90.0) * 0.2;`
        : plan === 'strider' ? `vec2 q = vObjP.xz * vec2(26.0, 18.0); q.x += 0.5 * floor(q.y); vec2 c = fract(q) - vec2(0.5, 0.2);
        return mix(0.4, smoothstep(0.65, 0.0, length(c * vec2(1.3, 0.8))), cF(fp, 26.0)) * 0.7 + cO(vObjP * vec3(110.0, 110.0, 30.0), fp, 110.0) * 0.3;`
        : `return cO(vObjP * vec3(160.0, 160.0, 30.0), fp, 160.0) * 0.65 + cO(vObjP * vec3(320.0, 320.0, 60.0), fp, 320.0) * 0.35;`}
      }
      vec3 coatPerturb(vec3 sp, vec3 n, vec2 dH) {
        vec3 sx = dFdx(sp), sy = dFdy(sp); vec3 r1 = cross(sy, n), r2 = cross(n, sx); float det = dot(sx, r1);
        return normalize(abs(det) * n - sign(det) * (dH.x * r1 + dH.y * r2)); }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
      float up = normalize(vObjN).y;
      diffuseColor.rgb *= mix(uBelly, vec3(1.0), smoothstep(-0.45, 0.3, up));       // pale belly
      diffuseColor.rgb *= mix(1.0, 0.78, smoothstep(0.55, 0.95, up));              // darker dorsal line
      // faint banding along the body for some species (the alien part, kept quiet)
      diffuseColor.rgb *= 1.0 - uAlien * 0.16 * smoothstep(0.2, 0.8, sin(vObjP.z * 22.0 + vObjP.y * 6.0)) * smoothstep(-0.1, 0.4, up);
      float coatFp = length(fwidth(vObjP)); float coatHv = coatH(coatFp); float coatFade = cF(coatFp, ${scaly ? '40.0' : plan === 'strider' ? '26.0' : '160.0'});
      diffuseColor.rgb *= mix(1.0, ${scaly ? '0.9 + 0.14 * coatHv' : '0.93 + 0.1 * coatHv'}, coatFade);   // tips catch light, roots darker`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      { float k = ${scaly ? '0.9' : '1.4'} * coatFade; normal = coatPerturb(-vViewPosition, normal, vec2(dFdx(coatHv), dFdy(coatHv)) * k); }`);
  };
  m.customProgramCacheKey = () => 'coat' + plan;
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
      curious: r() < (plan === 'strider' ? 0.6 : 0.35), nocturnal: r() < 0.22,
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
  // each LOD may be several primitives (coat + glossy eyes); the LOD comes from the node name
  const lodOf = (m) => (/lod1/.test(m.name + ' ' + (m.parent ? m.parent.name : '')) ? 1 : 0);
  meshes.sort((a, b) => lodOf(a) - lodOf(b) || b.geometry.index.count - a.geometry.index.count);
  if (!S.mats) S.mats = meshes.map((m) => (/eye/i.test(m.material.name || '') ? EYE_MAT : coatMaterial(m.material, S.back, S.belly, S.alien, S.plan)));
  meshes.forEach((m, k) => { m.userData.lod = lodOf(m); m.material = S.mats[k]; m.castShadow = m.userData.lod === 0 && m.material !== EYE_MAT; m.receiveShadow = false; m.frustumCulled = false; m.visible = m.userData.lod === 0; });
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
// one animal's life. States: graze / idle / walk / flee / rest / curious. Mutates `a`.
//   herds: walk targets gather round the herd's centre, and a fright spreads to herd-mates nearby
//   rest: diurnal species doze at night (her clock), nocturnal ones by day; lying low and still
//   curious: some species come over, slowly, when she stands still for a while, then look at her
// ctx: { player, playerSpeed, stillT, night, herd(a) -> { x, z, n, flee }, height, walkable, lite }
export function stepCreature(a, dt, t, ctx) {
  const S = a.S, p = a.root.position, P = a.parts;
  const dx = ctx.player.x - p.x, dz = ctx.player.z - p.z, dist = Math.hypot(dx, dz);
  const H = ctx.herd ? ctx.herd(a) : null;
  const sleepy = S.nocturnal ? 1 - (ctx.night || 0) : (ctx.night || 0);
  const startFlee = (fx, fz) => { a.state = 'flee'; a.timer = 3 + Math.random() * 2; a.tx = p.x + fx * 14; a.tz = p.z + fz * 14; a.note = 'flee'; };
  if (a.state !== 'flee') {
    const scared = dist < S.shy * (ctx.playerSpeed > 2 ? 1.5 : 1) * (a.state === 'rest' ? 0.6 : 1) && ctx.playerSpeed > 0.3;
    if (scared) startFlee(-dx / (dist || 1), -dz / (dist || 1));
    else if (H && H.flee && Math.hypot(H.flee.x - p.x, H.flee.z - p.z) < 14) startFlee(H.flee.dx, H.flee.dz); // herd-mates bolt together
  }
  // curiosity: she has been still a while, and this one is the curious sort
  if (S.curious && a.state !== 'flee' && a.state !== 'curious' && a.state !== 'rest' && ctx.stillT > 2.5 && dist < 16 && dist > 3.5 + S.size * 1.5 && !a.curiousDone) {
    a.state = 'curious'; a.timer = 14; a.note = 'curious';
  }
  if (a.state === 'curious') {
    if (ctx.playerSpeed > 0.6) { a.state = 'idle'; a.timer = 2; a.curiousDone = true; }
    const stop = 3 + S.size * 1.5;
    a.tx = ctx.player.x - (dx / (dist || 1)) * stop; a.tz = ctx.player.z - (dz / (dist || 1)) * stop;
    if (dist < stop + 0.4) { a.look = (a.look || 0) + dt; if (a.look > 6) { a.state = 'idle'; a.timer = 3; a.curiousDone = true; a.look = 0; } }
  }
  a.timer -= dt;
  if (a.timer <= 0) {
    if (a.state === 'walk' || a.state === 'flee' || a.state === 'curious') { a.state = Math.random() < 0.6 ? 'graze' : 'idle'; a.timer = 3 + Math.random() * 6; if (a.state === 'graze') a.note = 'graze'; }
    else if (a.state !== 'rest' && Math.random() < sleepy * 0.7) { a.state = 'rest'; a.timer = 12 + Math.random() * 18; a.note = 'rest'; }
    else {
      a.state = 'walk'; a.timer = 5 + Math.random() * 7;
      // herd animals drift as a group: aim near the herd's centre, the centre itself wanders from home
      const cx = H && H.n > 1 ? H.x * 0.7 + a.home.x * 0.3 : a.home.x, cz = H && H.n > 1 ? H.z * 0.7 + a.home.z * 0.3 : a.home.z;
      const ang = Math.random() * 6.283, d = H && H.n > 1 ? 2 + Math.random() * 5 : 4 + Math.random() * 12;
      a.tx = cx + Math.cos(ang) * d + (H && H.n > 1 ? Math.sin(t * 0.05 + a.seed) * 4 : 0); a.tz = cz + Math.sin(ang) * d;
      if (H && H.n > 1) a.note = 'herd';
    }
  }
  let speed = 0;
  if (a.state === 'walk' || a.state === 'flee' || a.state === 'curious') {
    const ex = a.tx - p.x, ez = a.tz - p.z, d = Math.hypot(ex, ez);
    if (d < 0.5) { if (a.state !== 'curious') a.timer = 0; else { let dh = Math.atan2(dx, dz) - a.heading; dh = Math.atan2(Math.sin(dh), Math.cos(dh)); a.heading += dh * Math.min(1, dt * 1.2); } }
    else {
      const want = Math.atan2(ex, ez);
      let dh = want - a.heading; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      a.heading += dh * Math.min(1, dt * 1.6);
      speed = S.speed * (a.state === 'flee' ? 1.9 : a.state === 'curious' ? 0.55 : 1) * S.size;
      const nx = p.x + Math.sin(a.heading) * a.speedNow * dt, nz = p.z + Math.cos(a.heading) * a.speedNow * dt;
      if (ctx.walkable(nx, nz)) { p.x = nx; p.z = nz; } else { a.timer = 0; a.state = 'idle'; }
    }
  }
  a.speedNow += (speed - a.speedNow) * Math.min(1, dt * 2);
  // ground follow, eased so steps on rough ground don't pop
  a.low = (a.low || 0) + ((a.state === 'rest' ? 1 : 0) - (a.low || 0)) * Math.min(1, dt * 0.8);
  const gy = ctx.height(p.x, p.z) - a.low * 0.22 * S.size; p.y += (gy - p.y) * Math.min(1, dt * 10);
  a.root.rotation.y = a.heading;
  if (!P.mixer) return;
  // LOD by distance; far animals update their pose less often
  const lod = dist > (ctx.lite ? 18 : 30) ? 1 : 0;
  if (lod !== P.lod) { P.lod = lod; P.meshes.forEach((m) => { m.visible = m.userData.lod === lod; }); }
  const moving = a.speedNow > 0.08;
  weigh(P, moving ? { walk: 1 } : a.state === 'graze' ? { graze: 1 } : { idle: 1 }, dt);
  if (P.acts.idle) P.acts.idle.timeScale = a.state === 'rest' ? 0.35 : 1; // slow breathing while dozing
  if (P.acts.walk) P.acts.walk.timeScale = Math.max(0.3, a.speedNow / (PACE[S.plan] * S.size));
  P.acc = (P.acc || 0) + dt;
  if (lod === 0 || P.acc > 0.1) { P.mixer.update(P.acc); P.acc = 0; }
  // soft spatial calls: a startle when the herd bolts, a murmur when one walks up, the odd call at graze
  if (ctx.audio && ctx.audio.creature) {
    const pos = { x: p.x, y: p.y, z: p.z, size: S.size, seed: a.seed || 0 };
    if (a.note === 'flee' && a._sfx !== 'flee') { ctx.audio.creature(S.plan, { mood: 'startle', ...pos }); a._sfx = 'flee'; }
    else if (a.note === 'curious' && a._sfx !== 'curious') { ctx.audio.creature(S.plan, { mood: 'curious', ...pos }); a._sfx = 'curious'; }
    else if (a.state !== 'flee' && a.state !== 'rest' && dist < 28) {
      a.callT = (a.callT || 8 + Math.random() * 16) - dt;
      if (a.callT <= 0) { a.callT = 10 + Math.random() * 20; if (Math.random() < 0.4) ctx.audio.creature(S.plan, { mood: 'call', ...pos }); }
    }
    if (a.state !== 'flee' && a._sfx === 'flee') a._sfx = null;
  }
}
