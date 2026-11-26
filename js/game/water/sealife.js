// Life under the sea, grown from the same physics as the rest of the world.
//
// Plants: sunlight reaching the bed falls off as exp(-a d) (a = the water's own green attenuation), so
//   seagrass carpets bright shallow sand, kelp anchors on rock where at least ~8% of the light gets down and
//   grows up toward the surface, and reef builders (warm water only) crowd the bright warm shallows. Their
//   colour is the world's pigment (a red-dwarf world has dark red-purple kelp). They sway with the water's
//   real motion under the waves (waves.orbital), so a swell sends the whole forest leaning in time.
// Fish: schools are boids (separation, alignment, cohesion) that keep between the bed and the surface,
//   scatter from predators and from her (more when she moves fast; and they learn: a place where fish were
//   taken stays feared, and fewer come back). Species, size, colour, school size, depth and wariness come
//   from the world (gravity, temperature, pigment) and the stretch of coast (each 300 m region differs).
//
//   const life = createSeaLife({ scene, ocean, lite, ground })
//   life.load(W, key, store)   life.update(dt, { player, camera })   life.fishNear(p, r)   life.take(fish, why)
import * as THREE from 'three';

const hash = (a, b, c = 0) => { let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const PIG = { 'near-black': '#2b2a24', 'red-purple': '#6b2f4a', green: '#4f7a3a', 'blue-green': '#2f7a66', blue: '#3c5a86', violet: '#5b3f86' };

// species from the world and the region: a deterministic draw, so both players meet the same fish
export function seaSpecies(rules, seed, rx, rz) {
  const B = (rules && rules.biology) || {}, T = rules && rules.temperature ? rules.temperature.meanC : 15;
  if (!B.animals) return [];
  const sizeK = B.sizeK || 1, out = [];
  const n = 2 + Math.floor(hash(seed, rx, rz) * 2);
  for (let i = 0; i < n; i++) {
    const r = (k) => hash(seed * 7 + i, rx * 13 + k, rz * 17 + k);
    const warm = T > 18, cold = T < 8;
    const kind = r(1) < 0.55 ? 'school' : r(2) < 0.6 ? 'grazer' : 'loner';
    const len = (kind === 'school' ? 0.12 + r(3) * 0.18 : kind === 'grazer' ? 0.25 + r(3) * 0.3 : 0.4 + r(3) * 0.5) * sizeK;
    // counter-shaded silver in open water; bright reef colours in warm, clear shallows
    const hue = warm ? r(4) : 0.5 + r(4) * 0.15, sat = warm && kind !== 'school' ? 0.7 : 0.18 + r(5) * 0.25, lit = warm ? 0.55 : 0.6;
    out.push({ id: `${rx}:${rz}:${i}`, kind, len: +len.toFixed(2), color: new THREE.Color().setHSL(hue, sat, lit),
      count: kind === 'school' ? 18 + Math.floor(r(6) * 26) : kind === 'grazer' ? 4 + Math.floor(r(6) * 6) : 1 + Math.floor(r(6) * 2),
      speed: (0.6 + r(7) * 0.7) * Math.sqrt(len / 0.2), // cruising body lengths per second fall with size
      depth: kind === 'grazer' ? [0.6, 10] : kind === 'school' ? [1.2, 30] : [2, 40],
      wary: 0.4 + r(8) * 0.6, tight: kind === 'school' ? 0.6 + r(9) * 0.4 : 0.15, cold });
  }
  if (B.predators) { const r = (k) => hash(seed * 11, rx * 19 + k, rz * 23 + k); out.push({ id: `${rx}:${rz}:p`, kind: 'predator', len: (0.9 + r(1) * 0.9) * sizeK, color: new THREE.Color().setHSL(0.58, 0.12, 0.42), count: r(2) < 0.6 ? 1 : 2, speed: 1.6, depth: [2, 40], wary: 0.3, tight: 0 }); }
  return out;
}

function fishGeometry() {
  // a spindle body along +z (head at +z), length 1, with a forked tail and a back fin; vertex colour = counter-shading
  const pos = [], col = [], idx = [];
  const rings = [[0.5, 0.0], [0.4, 0.07], [0.22, 0.11], [0.0, 0.1], [-0.25, 0.07], [-0.4, 0.035]], S = 6;
  for (const [z, r] of rings) for (let k = 0; k < S; k++) { const a = (k / S) * Math.PI * 2, y = Math.cos(a) * r * 1.25, x = Math.sin(a) * r * 0.55; pos.push(x, y, z); const c = y > 0 ? 0.55 : 1.15; col.push(c, c, c); }
  for (let i = 0; i < rings.length - 1; i++) for (let k = 0; k < S; k++) { const a = i * S + k, b = i * S + (k + 1) % S, c = (i + 1) * S + k, d = (i + 1) * S + (k + 1) % S; idx.push(a, c, b, b, c, d); }
  const t0 = pos.length / 3; pos.push(0, 0, -0.4, 0, 0.16, -0.58, 0, -0.16, -0.58, 0, 0, -0.5); col.push(0.7, 0.7, 0.7, 0.7, 0.7, 0.7, 0.7, 0.7, 0.7, 0.7, 0.7, 0.7);
  idx.push(t0, t0 + 1, t0 + 3, t0, t0 + 3, t0 + 2, t0, t0 + 3, t0 + 1, t0, t0 + 2, t0 + 3);
  const f0 = pos.length / 3; pos.push(0, 0.13, 0.12, 0, 0.22, -0.05, 0, 0.1, -0.18); col.push(0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5); idx.push(f0, f0 + 1, f0 + 2, f0, f0 + 2, f0 + 1);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
}
function bladeGeometry(segs = 6, w = 0.08) {
  // two crossed ribbons, height 1 (scaled per instance); tapering tip
  const pos = [], idx = [], uv = [];
  for (let p = 0; p < 2; p++) { const base = pos.length / 3, ax = p ? 0 : 1, az = p ? 1 : 0;
    for (let i = 0; i <= segs; i++) { const y = i / segs, ww = w * (1 - y * 0.7); pos.push(-ww * ax, y, -ww * az, ww * ax, y, ww * az); uv.push(0, y, 1, y); }
    for (let i = 0; i < segs; i++) { const a = base + i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals(); return g;
}
// a branching reef colony: a few tapered branches leaning out from a low base
function coralGeometry() {
  const parts = [], base = new THREE.SphereGeometry(0.22, 6, 4); base.scale(1, 0.45, 1); parts.push(base);
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + (i % 2) * 0.4, tilt = 0.25 + (i % 3) * 0.18, L = 0.45 + (i % 3) * 0.15;
    const b = new THREE.CylinderGeometry(0.018, 0.05, L, 5, 1); b.translate(0, L / 2, 0); b.rotateZ(tilt); b.rotateY(a); b.translate(Math.cos(a) * 0.06, 0.04, -Math.sin(a) * 0.06); parts.push(b); }
  // merge by hand (no addons import): positions + normals + indices
  let n = 0, ni = 0; for (const g of parts) { n += g.attributes.position.count; ni += g.index.count; }
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), idx = new Uint16Array(ni); let o = 0, oi = 0;
  for (const g of parts) { pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); for (let k = 0; k < g.index.count; k++) idx[oi + k] = g.index.array[k] + o; o += g.attributes.position.count; oi += g.index.count; g.dispose(); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setIndex(new THREE.BufferAttribute(idx, 1)); return g;
}

// sway: the tip follows the water's orbital displacement under the waves at its depth (same wave trains as the sea)
const SWAY = `uniform vec4 uWA, uWK, uWDX, uWDZ, uWPH; uniform vec3 uCur; uniform float uSea, uStiff;
vec2 zmOrbit(vec3 p) { vec2 o = vec2(0.0); float d = max(0.0, uSea - p.y);
  for (int i = 0; i < 4; i++) { float th = uWK[i] * (uWDX[i] * p.x + uWDZ[i] * p.z) - uWPH[i]; o += uWA[i] * exp(-uWK[i] * d) * cos(th) * vec2(uWDX[i], uWDZ[i]); }
  // the steady current bends them downstream: drag ~ v^2, so a slack tide leaves them upright
  vec2 c = uCur.xy * exp(-d / uCur.z); o += c * min(1.2, length(c) * 14.0);
  return o; }
`;
function swayMaterial(mat, U, stiff) {
  const SU = { uSea: { value: 0 }, uStiff: { value: stiff } };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U, SU);
    sh.vertexShader = SWAY + sh.vertexShader.replace('#include <begin_vertex>', `vec3 transformed = vec3(position);
      { vec3 b = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz; float L = length(instanceMatrix[1].xyz); float hy = position.y;
        vec2 o = zmOrbit(b + vec3(0.0, hy * L, 0.0)) * pow(hy, 1.6) * uStiff;
        float sx = max(0.01, length(instanceMatrix[0].xyz)); transformed.xz += o / sx; transformed.y -= dot(o, o) * 0.5 / max(0.2, L) * hy; }`);
  };
  mat.customProgramCacheKey = () => 'zmsway' + stiff;
  return SU;
}

export function createSeaLife({ scene, ocean, lite = false, ground }) {
  const U = ocean.uniforms;
  const root = new THREE.Group(); root.name = 'sealife'; scene.add(root);
  // ---- plants
  const NB = lite ? 1800 : 5200, NK = lite ? 260 : 700, NC = lite ? 160 : 420;
  const grassMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.8, side: THREE.DoubleSide });
  const kelpMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.7, side: THREE.DoubleSide });
  const grassSU = swayMaterial(grassMat, U, 1.0), kelpSU = swayMaterial(kelpMat, U, 1.0);
  const grass = new THREE.InstancedMesh(bladeGeometry(3, 0.035), grassMat, NB); grass.name = 'seagrass';
  const kelp = new THREE.InstancedMesh(bladeGeometry(lite ? 7 : 12, 0.16), kelpMat, NK); kelp.name = 'kelp';
  const coralMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85 });
  const coral = new THREE.InstancedMesh(coralGeometry(), coralMat, NC); coral.name = 'coral';
  for (const m of [grass, kelp, coral]) { m.count = 0; m.frustumCulled = false; m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(m.instanceMatrix.count * 3), 3); root.add(m); }
  // ---- fish
  const fishMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.6, metalness: 0, vertexColors: true });
  fishMat.onBeforeCompile = (sh) => { sh.vertexShader = 'attribute float aPhase; attribute float aAmp;\n' + sh.vertexShader.replace('#include <begin_vertex>', 'vec3 transformed = vec3(position); { float tz = clamp(0.45 - position.z, 0.0, 1.0); transformed.x += sin(aPhase - position.z * 6.0) * 0.11 * aAmp * tz * tz * 1.6; }'); };
  fishMat.customProgramCacheKey = () => 'zmfish';
  const NF = lite ? 90 : 240;
  const fishMesh = new THREE.InstancedMesh(fishGeometry(), fishMat, NF); fishMesh.name = 'fish'; fishMesh.frustumCulled = false; fishMesh.count = 0;
  fishMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(NF * 3), 3);
  const aPhase = new THREE.InstancedBufferAttribute(new Float32Array(NF), 1), aAmp = new THREE.InstancedBufferAttribute(new Float32Array(NF), 1);
  aPhase.setUsage(THREE.DynamicDrawUsage); fishMesh.geometry.setAttribute('aPhase', aPhase); fishMesh.geometry.setAttribute('aAmp', aAmp); root.add(fishMesh);
  let OFFS = null;
  let W = null, key = '', store = null, liq = null, rules = null, plantsAt = null, fish = [], schools = [], region = null, lastScan = null, t = 0, schoolT = 0, lastNow = 0;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ'), sc = new THREE.Vector3(), pv = new THREE.Vector3(), c3 = new THREE.Color();
  const sea = () => (ocean.still == null ? null : ocean.still);
  // a place's fear: fish taken here (by her, by predators) are remembered for a while, by the cell (24 m)
  const cellK = (x, z) => `${Math.floor(x / 24)},${Math.floor(z / 24)}`;
  function fearAt(x, z) { if (!store) return 0; const f = store.fear && store.fear[key + '|' + cellK(x, z)]; if (!f) return 0; const age = (Date.now() - f.t) / 3.6e6; return clamp(f.n * Math.exp(-age / 6), 0, 6); } // halves in ~4 hours of real time
  function addFear(x, z, n = 1) { if (!store) return; store.fear = store.fear || {}; const k = key + '|' + cellK(x, z); const f = store.fear[k] || { n: 0, t: Date.now() }; f.n = fearAt(x, z) + n; f.t = Date.now(); store.fear[k] = f; const ks = Object.keys(store.fear); if (ks.length > 400) delete store.fear[ks[0]]; }
  // ---- plants around her: scan a grid of the bed, light and substrate decide what grows
  function scanPlants(cx, cz) {
    const S = sea(); if (S == null || !rules || !(rules.biology && rules.biology.plants)) { grass.count = kelp.count = coral.count = 0; return; }
    const a = liq.absorb[1], T = rules.temperature ? rules.temperature.meanC : 15, pig = c3.set(PIG[rules.biology.pigment] || PIG.green).clone();
    const R = lite ? 44 : 70, step = 1.6; let ng = 0, nk = 0, nc = 0;
    const seed = (W && W.seed) || 1;
    // nearest cells first, so the budget is spent where she is
    if (!OFFS || OFFS.R !== R) { OFFS = []; OFFS.R = R; const n = Math.ceil(R / step); for (let j = -n; j <= n; j++) for (let i = -n; i <= n; i++) if ((i * step) ** 2 + (j * step) ** 2 <= R * R) OFFS.push([i, j, i * i + j * j]); OFFS.sort((a, b) => a[2] - b[2]); }
    const bx = Math.floor(cx / step), bz = Math.floor(cz / step);
    for (const [oi, oj] of OFFS) { if (ng >= NB && nk >= NK && nc >= NC) break;
      const gx = bx + oi, gz = bz + oj, x0 = gx * step, z0 = gz * step;
      const r1 = hash(seed, gx, gz), x = x0 + hash(seed + 1, gx, gz) * step, z = z0 + hash(seed + 2, gx, gz) * step;
      const h = ground(x, z), d = S - h; if (d < 0.35) continue;
      const light = Math.exp(-a * d), slope = Math.abs(ground(x + 0.8, z) - h) + Math.abs(ground(x, z + 0.8) - h);
      const rock = slope > 0.5;
      // seagrass: bright sand
      if (!rock && light > 0.22 && d < 9 && T > -1 && T < 32) { const k = Math.round(light * 5 * (0.5 + r1)); for (let i = 0; i < k && ng < NB; i++) { const xx = x + (hash(seed, gx * 7 + i, gz) - 0.5) * step, zz = z + (hash(seed, gx, gz * 7 + i) - 0.5) * step; const L = (0.25 + hash(seed + i, gx, gz) * 0.5) * Math.min(1, light * 2); m4.compose(pv.set(xx, ground(xx, zz) - 0.02, zz), q.identity(), sc.set(1, L, 1)); grass.setMatrixAt(ng, m4); c3.copy(pig).offsetHSL(0.02, 0, 0.06 + (hash(i, gx, gz) - 0.5) * 0.08); grass.setColorAt(ng++, c3); } }
      // kelp: rock (or coarse ground) in cool water with enough light at the bed; it grows to the surface
      if (light > 0.08 && d > 2.5 && T < 22 && (rock || r1 < 0.25) && r1 < 0.55 && nk < NK) { const L = Math.min(d - 0.3, 18 * (0.6 + 0.4 * light)) * (0.7 + 0.3 * hash(seed + 5, gx, gz)); m4.compose(pv.set(x, h - 0.05, z), q.setFromEuler(e.set(0, r1 * 6.28, 0)), sc.set(1, L, 1)); kelp.setMatrixAt(nk, m4); c3.copy(pig).offsetHSL(-0.04, 0.05, -0.04 + (r1 - 0.3) * 0.1); kelp.setColorAt(nk++, c3); }
      // reef builders: warm, bright, mostly on hard ground
      if (T > 18 && light > 0.2 && d > 0.8 && d < 20 && r1 > 0.6 && nc < NC) { const s = (0.3 + hash(seed + 9, gx, gz) * 0.9) * Math.min(1, light * 1.6); m4.compose(pv.set(x, h - 0.1, z), q.setFromEuler(e.set(r1, r1 * 9, 0)), sc.set(s * (0.8 + r1), s * (0.6 + r1 * 0.8), s)); coral.setMatrixAt(nc, m4); c3.setHSL(hash(seed, gx, gz * 3), 0.55, 0.55).lerp(pig, 0.25); coral.setColorAt(nc++, c3); }
    }
    grass.count = ng; kelp.count = nk; coral.count = nc;
    for (const m of [grass, kelp, coral]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
    plantsAt = { x: cx, z: cz, ng, nk, nc };
  }
  // ---- fish: schools around her region, each a boid flock with a home that wanders
  function spawnSchools(px, pz) {
    fish = []; schools = [];
    const S = sea(); if (S == null || !rules) return;
    const rx = Math.floor(px / 300), rz = Math.floor(pz / 300), sp = seaSpecies(rules, (W && W.seed) || 1, rx, rz);
    region = { rx, rz, species: sp.map((s) => s.id) };
    let n = 0;
    for (const s of sp) {
      // where it lives: a spot near her in water of its depth band; fewer come back to a feared place
      let hx = px, hz = pz, ok = false;
      for (let k = 0; k < 40 && !ok; k++) { const a = hash(k, rx * 3, Math.round(s.len * 100)) * 6.283, r = 8 + hash(k, rz, s.count) * (lite ? 40 : 60); hx = px + Math.sin(a) * r; hz = pz + Math.cos(a) * r; const d = S - ground(hx, hz); ok = d > s.depth[0] + 0.6 && d < s.depth[1] + 10; }
      if (!ok) continue;
      const fear = fearAt(hx, hz), count = Math.max(s.kind === 'predator' ? 1 : 0, Math.round(s.count * Math.exp(-fear * 0.45)));
      const sc0 = { sp: s, hx, hz, hy: 0, wt: 0, members: [], fear };
      for (let i = 0; i < count && n < NF; i++, n++) {
        const d = Math.max(0.6, S - ground(hx, hz)), y = S - clamp(s.depth[0] + hash(i, n, 3) * Math.min(d - 0.5, s.depth[1]), 0.4, d - 0.3);
        const f = { i: n, s, school: sc0, p: new THREE.Vector3(hx + (hash(i, n, 1) - 0.5) * 3, y, hz + (hash(i, n, 2) - 0.5) * 3), v: new THREE.Vector3((hash(i, 1, n) - 0.5), 0, (hash(i, 2, n) - 0.5)), ph: hash(i, n, 9) * 6.28, panic: 0, alive: true, hooked: false, tired: 0, len: s.len * (0.85 + hash(i, n, 5) * 0.3) };
        f.v.setLength(s.speed * 0.5); sc0.members.push(f); fish.push(f);
        fishMesh.setColorAt(n, c3.copy(s.color).offsetHSL(0, 0, (hash(i, n, 7) - 0.5) * 0.08));
      }
      schools.push(sc0);
    }
    fishMesh.count = fish.length; if (fishMesh.instanceColor) fishMesh.instanceColor.needsUpdate = true;
  }
  const tmp = new THREE.Vector3(), acc = new THREE.Vector3(), ali = new THREE.Vector3(), coh = new THREE.Vector3(), sep = new THREE.Vector3();
  function stepFish(dt, player) {
    const S = sea(); if (S == null) return;
    const pp = player.position, pSpeed = player.speed || 0, pIn = player.swimming || (player.water && player.water.depth > 0.3);
    const flowOut = [0, 0, 0];
    for (const sc0 of schools) { // the school's home wanders slowly (feeding), away from feared cells
      sc0.wt -= dt; if (sc0.wt <= 0) { sc0.wt = 6 + Math.random() * 8; const a = Math.random() * 6.283, r = 6 + Math.random() * 10; const nx = sc0.hx + Math.sin(a) * r, nz = sc0.hz + Math.cos(a) * r; if (S - ground(nx, nz) > sc0.sp.depth[0] + 0.6 && fearAt(nx, nz) <= fearAt(sc0.hx, sc0.hz) + 0.2) { sc0.hx = nx; sc0.hz = nz; } } }
    const preds = fish.filter((f) => f.alive && f.s.kind === 'predator');
    for (const f of fish) {
      if (!f.alive) continue;
      const s = f.s, M = f.school.members; acc.set(0, 0, 0);
      if (f.hooked) { /* fishing.js drives a hooked fish */ continue; }
      // flocking with its own school
      ali.set(0, 0, 0); coh.set(0, 0, 0); sep.set(0, 0, 0); let nn = 0;
      if (s.kind !== 'predator') for (const o of M) { if (o === f || !o.alive) continue; tmp.subVectors(o.p, f.p); const d2 = tmp.lengthSq(); if (d2 > 9) continue; nn++; ali.add(o.v); coh.add(o.p); if (d2 < (f.len * 2.5) ** 2) sep.addScaledVector(tmp, -1 / Math.max(0.01, d2)); }
      if (nn) { ali.divideScalar(nn).sub(f.v).multiplyScalar(1.2 * s.tight); coh.divideScalar(nn).sub(f.p).multiplyScalar(0.6 * s.tight); acc.add(ali).add(coh).addScaledVector(sep, 0.6); }
      // home
      tmp.set(f.school.hx - f.p.x, 0, f.school.hz - f.p.z); const hd = tmp.length(); if (hd > 4) acc.addScaledVector(tmp, 0.08 * (hd - 4) / hd);
      // predators hunt the nearest small fish; prey flees predators
      if (s.kind === 'predator') {
        let best = null, bd = 144; for (const o of fish) { if (!o.alive || o.s.kind === 'predator' || o.hooked) continue; const d2 = o.p.distanceToSquared(f.p); if (d2 < bd) { bd = d2; best = o; } }
        if (best) { tmp.subVectors(best.p, f.p); acc.addScaledVector(tmp.normalize(), 1.8); if (bd < (f.len * 0.4) ** 2 && Math.random() < dt * 3) { best.alive = false; addFear(best.p.x, best.p.z, 0.05); } }
      } else for (const pr of preds) { tmp.subVectors(f.p, pr.p); const d2 = tmp.lengthSq(); if (d2 < 36) { acc.addScaledVector(tmp.normalize(), 4 * (1 - Math.sqrt(d2) / 6)); f.panic = Math.min(1, f.panic + dt * 3); } }
      // her: a swimmer close and moving fast is a threat; a still one, much less (they come close to a still diver)
      if (pIn && s.kind !== 'predator') { tmp.set(f.p.x - pp.x, f.p.y - (pp.y + 1.2), f.p.z - pp.z); const d = tmp.length(), R = (2.5 + pSpeed * 2.2) * s.wary * (1 + f.school.fear * 0.3); if (d < R) { acc.addScaledVector(tmp.normalize(), 5 * (1 - d / R)); f.panic = Math.min(1, f.panic + dt * 4); } }
      // stay in the water column: above the bed and below the surface (and in its depth band)
      const bed = ground(f.p.x, f.p.z), top = S - 0.25 - f.len * 0.5, lo = bed + 0.25 + f.len * 0.5;
      if (f.p.y > top - 0.3) acc.y -= (f.p.y - top + 0.3) * 4; if (f.p.y < lo + 0.3) acc.y += (lo + 0.3 - f.p.y) * 4;
      { const dn = S - f.p.y; if (dn < s.depth[0]) acc.y -= 0.6; else if (dn > s.depth[1]) acc.y += 0.6; }
      // the bed rising ahead (the shore): turn back to deeper water
      { tmp.copy(f.v).setY(0); if (tmp.lengthSq() > 1e-4) { tmp.normalize(); const ax = f.p.x + tmp.x * 2, az = f.p.z + tmp.z * 2; if (S - ground(ax, az) < s.depth[0] + 0.3) acc.addScaledVector(tmp, -1.5); } }
      // the water carries them (wave orbital motion), they swim relative to it
      ocean.waves.orbital(f.p.x, f.p.z, S - f.p.y, flowOut); if (ocean.current) ocean.current(f.p.y, flowOut);
      const maxS = s.speed * (1 + f.panic * 2.2) * (f.tired > 0 ? 0.5 : 1);
      f.v.addScaledVector(acc, dt * 3); f.v.y *= 1 - dt * 1.5; const vl = f.v.length(); if (vl > maxS) f.v.multiplyScalar(maxS / vl); else if (vl < s.speed * 0.3) f.v.multiplyScalar(1 + dt);
      f.p.x += (f.v.x + flowOut[0] * 0.8) * dt; f.p.y += (f.v.y + flowOut[1] * 0.8) * dt; f.p.z += (f.v.z + flowOut[2] * 0.8) * dt;
      f.p.y = clamp(f.p.y, lo, top);
      f.panic = Math.max(0, f.panic - dt * 0.5); f.tired = Math.max(0, f.tired - dt);
      f.ph += dt * (4 + (f.v.length() / Math.max(0.05, f.len)) * 1.6);
    }
  }
  function draw() {
    for (const f of fish) {
      const i = f.i; if (!f.alive) { m4.makeScale(0, 0, 0); fishMesh.setMatrixAt(i, m4); continue; }
      const hs = Math.hypot(f.v.x, f.v.z); e.set(-Math.atan2(f.v.y, Math.max(1e-3, hs)) * 0.8, Math.atan2(f.v.x, f.v.z), Math.sin(f.ph * 0.5) * 0.05);
      q.setFromEuler(e); m4.compose(f.p, q, sc.setScalar(f.len)); fishMesh.setMatrixAt(i, m4);
      aPhase.array[i] = f.ph % 628.3; aAmp.array[i] = clamp(0.6 + f.v.length() / Math.max(0.1, f.s.speed) * 0.4, 0.5, 2);
    }
    fishMesh.instanceMatrix.needsUpdate = true; aPhase.needsUpdate = true; aAmp.needsUpdate = true;
  }
  const api = {
    root, get fish() { return fish; }, get schools() { return schools; }, get plants() { return plantsAt; }, get region() { return region; },
    load(w, k, st) { W = w; key = k || ''; store = st || null; rules = w && w.rules; liq = ocean.liquidInfo; fish = []; schools = []; fishMesh.count = 0; grass.count = kelp.count = coral.count = 0; lastScan = null; region = null; },
    update(dt, { player }) {
      const S = sea(); root.visible = S != null; if (S == null || !player) return;
      t += dt; const p = player.position;
      grassSU.uSea.value = kelpSU.uSea.value = S;
      // only near the sea: within ~70 m of water and not high above it
      const near = p.y < S + 25;
      root.visible = near; if (!near) return;
      if (!lastScan || Math.hypot(p.x - lastScan.x, p.z - lastScan.z) > (lite ? 14 : 22)) { lastScan = { x: p.x, z: p.z }; scanPlants(p.x, p.z); }
      // wall-clock retry timer: slow frames clamp dt, which would stall respawning for minutes
      const nowS = performance.now() / 1000; schoolT -= Math.max(dt, nowS - (lastNow || nowS)); lastNow = nowS;
      if (!region || Math.floor(p.x / 300) !== region.rx || Math.floor(p.z / 300) !== region.rz || (schoolT <= 0 && (!schools.length || fish.filter((f) => f.alive).length < 3))) { spawnSchools(p.x, p.z); schoolT = schools.length ? 30 : 4; }
      // schools far behind her drift home with her (a new set fills in as she swims along the coast)
      for (const sc0 of schools) if (Math.hypot(sc0.hx - p.x, sc0.hz - p.z) > (lite ? 60 : 90)) { const a = Math.atan2(sc0.hx - p.x, sc0.hz - p.z) + Math.PI; const nx = p.x + Math.sin(a) * 30, nz = p.z + Math.cos(a) * 30; if (S - ground(nx, nz) > sc0.sp.depth[0] + 0.6) { const dx = nx - sc0.hx, dz = nz - sc0.hz; sc0.hx = nx; sc0.hz = nz; for (const f of sc0.members) { if (f.hooked) continue; f.p.x += dx; f.p.z += dz; f.p.y = Math.max(f.p.y, ground(f.p.x, f.p.z) + 0.5); } } }
      stepFish(Math.min(dt, 0.05), player); draw();
    },
    fishNear(p, r = 3) { const out = []; for (const f of fish) if (f.alive && f.p.distanceTo(p) < r) out.push(f); return out; },
    take(f, why = 'caught') { if (!f || !f.alive) return null; f.alive = false; f.hooked = false; addFear(f.p.x, f.p.z, 1); for (const o of f.school.members) if (o.alive) o.panic = 1; return { species: f.s.id, kind: f.s.kind, len: +f.len.toFixed(2), mass: +(12 * f.len ** 3).toFixed(2), color: '#' + f.s.color.getHexString(), why }; },
    fearAt, addFear,
    dispose() { scene.remove(root); for (const m of [grass, kelp, coral, fishMesh]) { m.geometry.dispose(); m.material.dispose(); m.dispose(); } },
  };
  return api;
}
