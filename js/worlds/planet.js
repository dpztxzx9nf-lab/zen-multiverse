// World "planet": endless procedural worlds from a seed. Streaming terrain in chunks (load, unload,
// three LOD rings with skirts), blended biomes (salt flats, alien forest, crystal fields, ocean
// shores, ice), instanced flora, gentle creatures, samples to collect, and a journal where she names
// what she finds. A dimension changes the palette, the weight of things and the creatures' style.
//   ?world=planet&seed=123[&dim=amber]
import * as THREE from 'three';
import { makeImpostor, crossfadeMaterial } from '../game/impostor.js';
import { buildShip } from '../game/moonbase.js';
import { activeShip } from '../game/fleet.js';
import { fpFov } from '../game/player.js';
import { groundMaterial, swapSet, BIOME_SET, BIOME_ROCK } from '../game/pbr.js';
import { createWalkCore } from '../game/walkcore.js';
import { makePlanet, BIOMES, BIOME_NAMES } from '../game/planetgen.js';
import { makeFlora, preloadFlora, floraReady } from '../game/flora.js';
import { makeSpecies, buildCreature, stepCreature, preloadCreatures } from '../game/creatures.js';
import { rng, hash, DIMENSIONS } from '../game/names.js';
import { game, UNLOCK_ALL } from '../game/store.js';
import { openStarMap } from '../game/starmap.js';
import { icon } from '../game/icons.js';
import { createColliders } from '../colliders.js';
import { createSandbox } from '../game/g7/sandbox.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export async function createPlanet({ renderer, canvas, P, params, engine, worlds, audio }) {
  const lite = P.cls !== 'pc';
  preloadCreatures(); preloadFlora();
  const G = game.data;
  G.journal = G.journal || { species: {}, planets: {} }; G.journal.species = G.journal.species || {}; G.journal.planets = G.journal.planets || {};
  // ---- device tier: chunk size, view radius (in chunks), LOD resolutions, flora + creature budgets
  const T = lite
    ? { CH: 128, R: 2.6, segs: [40, 20, 10], floraR: 1.6, nearR: 1.0, build: 1, creatures: 7, cap: 0.5, shadows: false }
    : { CH: 128, R: 3.7, segs: [64, 32, 16], floraR: 2.3, nearR: 1.3, build: 2, creatures: 14, cap: 1, shadows: true };
  if (params.has('far')) T.R += 1;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, engine.width / engine.height, 0.1, 2800);
  const sun = new THREE.DirectionalLight('#fff', 2.6); scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight('#fff', '#444', 0.35); scene.add(hemi);
  if (T.shadows) { sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 400 }); sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.04; }
  const sunDir = new THREE.Vector3();
  const colliders = createColliders();
  const extraTabs = [];
  let groundAt = () => 0;
  // footsteps by what is underfoot (a dug or built surface overrides the biome)
  const STEP = { salt: 'gravel', forest: 'grass', crystal: 'stone', ice: 'snow', shore: 'sand' };
  let surfaceOverride = null;
  const surfaceAt = (x, z) => { const o = surfaceOverride && surfaceOverride(x, z); if (o) return o; if (!W) return 'grass'; const y = groundAt(x, z); return STEP[W.dominant(W.biomesAt(x, z, y))] || 'grass'; };
  const core = createWalkCore({ scene, camera, P, canvas, ground: (x, z) => groundAt(x, z), gravity: 9.81, jumpV: 3.4, start: { x: 0, z: 0, yaw: 0 }, colliders, extraTabs, onMap: () => openMap(), audio, surface: (x, z) => surfaceAt(x, z) });
  const { hud, player, interact } = core;

  // ---- sky dome (gradient + sun), also baked once into an environment map for soft reflections
  const skyU = { uZen: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uGnd: { value: new THREE.Color() }, uSun: { value: sunDir }, uSunCol: { value: new THREE.Color() } };
  const skyMat = new THREE.ShaderMaterial({ uniforms: skyU, side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
    fragmentShader: `uniform vec3 uZen, uHor, uGnd, uSun, uSunCol; varying vec3 vD;
      void main(){ vec3 d = normalize(vD); float y = d.y;
        vec3 c = mix(uHor, uZen, pow(smoothstep(0., 1., y), 0.55));
        c = mix(c, uGnd, smoothstep(0.0, -0.25, y));
        float s = max(dot(d, uSun), 0.);
        c += uSunCol * (pow(s, 900.) * 6. + pow(s, 12.) * 0.25 + pow(s, 3.) * 0.08);
        gl_FragColor = vec4(c, 1.); }` });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(2400, 32, 16), skyMat); sky.renderOrder = -10; scene.add(sky);
  const skyMoons = new THREE.Group(); scene.add(skyMoons);
  const moonGeo = new THREE.SphereGeometry(1, 48, 32);
  let moonMap = null;
  const moonTex = () => moonMap || (moonMap = (() => { const t = new THREE.TextureLoader().load(new URL('../../assets/pbr/moon_01/1k_diff.webp', import.meta.url).href); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2, 1); return t; })());
  const pmrem = new THREE.PMREMGenerator(renderer);
  let envRT = null;
  function bakeEnv() {
    const s2 = new THREE.Scene(); const m = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), skyMat); s2.add(m);
    if (envRT) envRT.dispose();
    envRT = pmrem.fromScene(s2, 0, 0.1, 500); scene.environment = envRT.texture; scene.environmentIntensity = 0.6;
  }
  // ---- water: one plane at sea level that follows her, with a scrolling normal map
  const waterNormal = (() => {
    const N = 128, d = new Uint8Array(N * N * 4), r = rng(3), h = new Float32Array(N * N);
    for (let k = 0; k < 6; k++) { const fx = 1 + Math.floor(r() * 5), fz = 1 + Math.floor(r() * 5), ph = r() * 6.28, a = 1 / (k + 1); for (let i = 0; i < N * N; i++) { const x = i % N, z = Math.floor(i / N); h[i] += Math.sin((x * fx + z * fz) / N * Math.PI * 2 + ph) * a; } }
    for (let i = 0; i < N * N; i++) { const x = i % N, z = Math.floor(i / N); const dx = h[z * N + ((x + 1) % N)] - h[z * N + ((x + N - 1) % N)], dz = h[((z + 1) % N) * N + x] - h[((z + N - 1) % N) * N + x]; const v = new THREE.Vector3(-dx * 0.6, 1, -dz * 0.6).normalize(); d[i * 4] = (v.x * 0.5 + 0.5) * 255; d[i * 4 + 1] = (v.z * 0.5 + 0.5) * 255; d[i * 4 + 2] = v.y * 255; d[i * 4 + 3] = 255; }
    const t = new THREE.DataTexture(d, N, N); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true; return t;
  })();
  const waterMat = new THREE.MeshStandardMaterial({ color: '#4a8', roughness: 0.05, metalness: 0.0, transparent: true, opacity: 0.6, normalMap: waterNormal, normalScale: new THREE.Vector2(0.35, 0.35) });
  waterNormal.repeat.set(60, 60);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(2 * T.R * T.CH + 400, 2 * T.R * T.CH + 400).rotateX(-Math.PI / 2), waterMat); scene.add(water);
  // ground detail: a soft world-space grain (colour + bump) so close ground never reads as flat plastic
  const grain = (() => {
    const N = 256, c = document.createElement('canvas'); c.width = c.height = N; const g = c.getContext('2d');
    const img = g.createImageData(N, N), r = rng(11);
    const val = new Float32Array(N * N); for (let i = 0; i < N * N; i++) val[i] = r();
    for (let i = 0; i < N * N; i++) { const x = i % N, y = Math.floor(i / N); let v = 0; for (let k = -1; k <= 1; k++) for (let j = -1; j <= 1; j++) v += val[((y + k + N) % N) * N + ((x + j + N) % N)]; v /= 9; const q = 222 + (v - 0.5) * 70 + (val[i] - 0.5) * 22; img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = q; img.data[i * 4 + 3] = 255; }
    g.putImageData(img, 0, 0);
    for (let i = 0; i < 160; i++) { g.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '60,50,50'},${0.08 + r() * 0.1})`; g.beginPath(); g.arc(r() * N, r() * N, 1 + r() * 3, 0, 7); g.fill(); }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = lite ? 2 : 8; t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  void grain;
  // photographic ground: a CC0 scan picked per planet (Earth analogue of its main biome) as detail over
  // the terrain's own colours, bare rock on steep slopes
  const terrainMat = await groundMaterial({ ground: 'forest_ground_04', rock: 'rock_boulder_dry', scale: 0.5, rockScale: 0.11, vertexTint: true, normalK: 1.1, slope: [0.66, 0.82], P, renderer, base: { side: THREE.DoubleSide } });
  // shoreline: wet darkened sand above the waterline, a thin breaking foam line, and absorption
  // (shallows show the bed tinted, depth fades to the sea colour) so the water plane can stay thin
  const shoreU = { uSea: { value: -1e4 }, uDeepW: { value: new THREE.Color() }, uShallowW: { value: new THREE.Color() }, uShoreT: { value: 0 } };
  {
    const prev = terrainMat.onBeforeCompile;
    terrainMat.onBeforeCompile = (sh, r) => {
      if (prev) prev(sh, r);
      Object.assign(sh.uniforms, shoreU);
      sh.fragmentShader = 'uniform float uSea, uShoreT; uniform vec3 uDeepW, uShallowW;\n' + sh.fragmentShader
        .replace('#include <color_fragment>', `#include <color_fragment>
        float shoreWet = 0.0;
        { float hs = vPbrW.y - uSea;
          shoreWet = (1.0 - smoothstep(0.0, 1.1, hs)) * step(-0.02, hs);
          diffuseColor.rgb *= 1.0 - 0.42 * shoreWet;
          float dep = max(-hs, 0.0);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * uShallowW * 1.8, smoothstep(0.0, 0.5, dep));
          diffuseColor.rgb = mix(diffuseColor.rgb, uDeepW * 0.6, 1.0 - exp(-dep * 0.35));
          float wob = 0.06 * sin(uShoreT * 0.7 + vPbrW.x * 0.21 + vPbrW.z * 0.17) + 0.03 * sin(uShoreT * 1.3 - vPbrW.z * 0.5);
          float fl = exp(-pow((hs - 0.05 - wob) * 11.0, 2.0)) + 0.5 * exp(-pow((hs + 0.12 - wob * 0.6) * 7.0, 2.0));
          vec2 fc = floor(vPbrW.xz * 5.0); float fn = fract(sin(dot(fc, vec2(12.9898, 78.233))) * 43758.5453);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.88, 0.86), clamp(fl * (0.35 + 0.5 * fn), 0.0, 0.85)); }`)
        .replace('float roughnessFactor = clamp(roughness * pbrArm.g * uRoughK, 0.04, 1.);', 'float roughnessFactor = clamp(roughness * pbrArm.g * uRoughK, 0.04, 1.);\n roughnessFactor = mix(roughnessFactor, 0.22, shoreWet * 0.8);');
    };
    const pk = terrainMat.customProgramCacheKey ? terrainMat.customProgramCacheKey.bind(terrainMat) : () => '';
    terrainMat.customProgramCacheKey = () => pk() + 'shore';
  }

  // ---------------- the physical world (g7): voxels where dug, props, building, crafting
  let sb = null;
  const height2 = (x, z) => { const s2 = 2, ix = Math.floor(x / s2), iz = Math.floor(z / s2), u = x / s2 - ix, v = z / s2 - iz; const a = W.height(ix * s2, iz * s2), b = W.height(ix * s2 + s2, iz * s2), c = W.height(ix * s2, iz * s2 + s2), d = W.height(ix * s2 + s2, iz * s2 + s2); return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v; };
  function trunkRay(o, d, maxD) {
    let best = null; const seen = new Set();
    for (let t = 0; t <= maxD + 8; t += 4) { const gx = Math.floor((o.x + d.x * t) / 8), gz = Math.floor((o.z + d.z * t) / 8); for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const k = (gx + i) + ',' + (gz + j); if (seen.has(k)) continue; seen.add(k); for (const tr of trunks.get(k) || []) {
      const dx = o.x - tr[0], dz = o.z - tr[1], a = d.x * d.x + d.z * d.z, bq = 2 * (dx * d.x + dz * d.z), c = dx * dx + dz * dz - tr[2] * tr[2], disc = bq * bq - 4 * a * c; if (disc < 0 || a < 1e-6) continue;
      const tt = (-bq - Math.sqrt(disc)) / (2 * a); if (tt < 0 || tt > maxD) continue; const y = o.y + d.y * tt, gy = W.height(tr[0], tr[1]); if (y < gy - 0.2 || y > gy + 6) continue;
      if (!best || tt < best.t) best = { t: tt, point: new THREE.Vector3(o.x + d.x * tt, y, o.z + d.z * tt), tree: tr };
    } } }
    return best;
  }
  function fellTree(tr) {
    const it = tr[3]; if (!it) return null; const f = flora[it[0]]; if (!f) return null;
    sb.markFelled(it[0] + ':' + Math.round(it[1] * 10) + ':' + Math.round(it[3] * 10));
    const ccx = Math.floor(it[1] / T.CH), ccz = Math.floor(it[3] / T.CH); lists.delete(ccx + ',' + ccz); lists.delete(ccx + ',' + ccz + 'f');
    floraCenter = null;
    const h = (f.height || 9) * it[5];
    return { x: it[1], y: it[2], z: it[3], h: Math.min(12, h), r: f.trunkR * it[5] };
  }
  sb = createSandbox({ scene, camera, P, renderer, core, steps: core.steps, terrainMat, params,
    hf: { ground: (x, z) => groundFn(x, z), height2, biome: (x, z, y) => W.dominant(W.biomesAt(x, z, y)), groundColor: (x, z, y, s, c) => W.groundColor(x, z, y, s, c), rebuild: (cx, cz) => rebuildChunkAt(Math.floor(cx * 16 / T.CH), Math.floor(cz * 16 / T.CH)), trunkRay, fell: fellTree, floraDirty: (x, z) => { const ccx = Math.floor(x / T.CH), ccz = Math.floor(z / T.CH); lists.delete(ccx + ',' + ccz); lists.delete(ccx + ',' + ccz + 'f'); floraCenter = null; }, isWater: (x, z, y) => W.hasSea && y < W.sea + 0.25 } });
  player.setEnv(sb.env);
  core.onSecondary = () => sb.secondary();
  surfaceOverride = (x, z) => sb.surface(x, z);

  // ---------------- the current planet
  let impostors = [], impIM = [], xfOwned = [];
  let W = null, PK = null, flora = [], floraIM = [], species = [], chunks = new Map(), lists = new Map(), animals = [], samples = new Map();
  const groundFn = (x, z) => {
    const cx = Math.floor(x / T.CH), cz = Math.floor(z / T.CH), c = chunks.get(cx + ',' + cz);
    if (!c || !c.h) return W.height(x, z);
    const n = c.seg, s = T.CH / n, fx = (x - cx * T.CH) / s, fz = (z - cz * T.CH) / s;
    const ix = Math.min(n - 1, Math.max(0, Math.floor(fx))), iz = Math.min(n - 1, Math.max(0, Math.floor(fz))), u = fx - ix, v = fz - iz, w = n + 1;
    const a = c.h[iz * w + ix], b = c.h[iz * w + ix + 1], d = c.h[(iz + 1) * w + ix], e = c.h[(iz + 1) * w + ix + 1];
    return (a * (1 - u) + b * u) * (1 - v) + (d * (1 - u) + e * u) * v;
  };
  groundAt = groundFn;

  function buildChunk(cx, cz, lod) {
    // columns dug into voxels leave a hole here (the voxel mesh fills it, matching at the rim)
    const holes = sb && sb.vox ? sb.vox.holesIn(cx, cz, T.CH) : [];
    const hk = new Set(holes.map(([i, j]) => i + ',' + j));
    const seg = holes.length && lod === 0 ? Math.max(64, T.segs[0]) : T.segs[lod], CH = T.CH, step = CH / seg, w = seg + 1, B = seg + 3;
    const hb = new Float32Array(B * B);
    for (let j = 0; j < B; j++) for (let i = 0; i < B; i++) hb[j * B + i] = W.height(cx * CH + (i - 1) * step, cz * CH + (j - 1) * step);
    const nV = w * w + 4 * w;
    const pos = new Float32Array(nV * 3), nor = new Float32Array(nV * 3), col = new Float32Array(nV * 3), uv = new Float32Array(nV * 2), h = new Float32Array(w * w);
    const n = new THREE.Vector3(), c = new THREE.Color();
    for (let j = 0; j < w; j++) for (let i = 0; i < w; i++) {
      const k = j * w + i, y = hb[(j + 1) * B + i + 1]; h[k] = y;
      pos[k * 3] = i * step; pos[k * 3 + 1] = y; pos[k * 3 + 2] = j * step;
      uv[k * 2] = (cx * CH + i * step) / 3.5; uv[k * 2 + 1] = (cz * CH + j * step) / 3.5;
      n.set(hb[(j + 1) * B + i] - hb[(j + 1) * B + i + 2], 2 * step, hb[j * B + i + 1] - hb[(j + 2) * B + i + 1]).normalize();
      nor[k * 3] = n.x; nor[k * 3 + 1] = n.y; nor[k * 3 + 2] = n.z;
      W.groundColor(cx * CH + i * step, cz * CH + j * step, y, 1 - n.y, c);
      col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
    }
    // skirts: a curtain hanging down from each edge hides cracks between LODs
    const edges = [[(t) => t, () => 0], [(t) => t, () => seg], [() => 0, (t) => t], [() => seg, (t) => t]];
    const idx = [];
    for (let j = 0; j < seg; j++) for (let i = 0; i < seg; i++) { if (hk.size && hk.has(Math.floor((i + 0.5) * step / 16) + ',' + Math.floor((j + 0.5) * step / 16))) continue; const a = j * w + i, b = a + 1, d = a + w, e = d + 1; idx.push(a, d, b, b, d, e); }
    let o = w * w;
    edges.forEach(([fi, fj], ei) => {
      for (let t = 0; t <= seg; t++) {
        const k = fj(t) * w + fi(t), s = o + t;
        pos[s * 3] = pos[k * 3]; pos[s * 3 + 1] = pos[k * 3 + 1] - 2.5 * (lod + 1); pos[s * 3 + 2] = pos[k * 3 + 2];
        nor[s * 3] = nor[k * 3]; nor[s * 3 + 1] = nor[k * 3 + 1]; nor[s * 3 + 2] = nor[k * 3 + 2];
        uv[s * 2] = uv[k * 2]; uv[s * 2 + 1] = uv[k * 2 + 1] + 0.7;
        col[s * 3] = col[k * 3] * 0.8; col[s * 3 + 1] = col[k * 3 + 1] * 0.8; col[s * 3 + 2] = col[k * 3 + 2] * 0.8;
        if (t < seg) { const k2 = fj(t + 1) * w + fi(t + 1); idx.push(k, s, k2, k2, s, s + 1); }
      }
      o += w; void ei;
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeBoundingSphere();
    const m = new THREE.Mesh(g, terrainMat); m.position.set(cx * CH, 0, cz * CH); m.receiveShadow = true; m.castShadow = false;
    return { mesh: m, lod, seg, h, holes: holes.length };
  }
  function rebuildChunkAt(cx, cz) {
    const key = cx + ',' + cz, c = chunks.get(key); if (!c) return;
    const nc = buildChunk(cx, cz, c.lod); scene.remove(c.mesh); c.mesh.geometry.dispose(); scene.add(nc.mesh); chunks.set(key, nc);
  }
  const chunkDist = (cx, cz, px, pz) => Math.hypot(cx + 0.5 - px / T.CH, cz + 0.5 - pz / T.CH);
  const lodFor = (d) => (d < 1.25 ? 0 : d < 2.3 ? 1 : 2);
  function streamChunks(px, pz, budget) {
    const pcx = Math.floor(px / T.CH), pcz = Math.floor(pz / T.CH), Rr = Math.ceil(T.R);
    const want = [];
    for (let dz = -Rr; dz <= Rr; dz++) for (let dx = -Rr; dx <= Rr; dx++) {
      const cx = pcx + dx, cz = pcz + dz, d = chunkDist(cx, cz, px, pz);
      if (d > T.R) continue;
      const key = cx + ',' + cz, lod = lodFor(d), c = chunks.get(key);
      if (!c || c.lod !== lod) want.push({ key, cx, cz, lod, d, has: !!c });
    }
    want.sort((a, b) => (a.has - b.has) || a.d - b.d); // missing chunks first, nearest first
    let built = 0;
    for (const q of want) {
      if (built >= budget) break;
      const c = chunks.get(q.key);
      if (c && Math.abs(c.lod - q.lod) < 1 && q.lod > 0) continue;
      const nc = buildChunk(q.cx, q.cz, q.lod);
      if (c) { scene.remove(c.mesh); c.mesh.geometry.dispose(); }
      scene.add(nc.mesh); chunks.set(q.key, nc); built++;
    }
    // unload what is now beyond the view
    for (const [key, c] of chunks) {
      const [cx, cz] = key.split(',').map(Number);
      if (chunkDist(cx, cz, px, pz) > T.R + 0.6) { scene.remove(c.mesh); c.mesh.geometry.dispose(); chunks.delete(key); }
    }
    return built;
  }

  // ---------------- flora: per-chunk instance lists, drawn by one InstancedMesh per species
  function chunkList(cx, cz, forestOnly = false) {
    const key = cx + ',' + cz + (forestOnly ? 'f' : ''); let L = lists.get(key); if (L) return L;
    if (forestOnly && lists.has(cx + ',' + cz)) return lists.get(cx + ',' + cz);
    L = [];
    const CH = T.CH;
    for (const f of flora) {
      if (forestOnly && !f.forest) continue;
      const r = rng(hash(W.seed, cx, cz, f.i, 5));
      const N = Math.round(f.density * (lite ? 0.6 : 1) * (f.cluster ? 1.6 : 1.35) * (W.dim.creature === 'many' ? 1.1 : 1));
      for (let k = 0; k < N; k++) {
        const x = cx * CH + r() * CH, z = cz * CH + r() * CH, y = W.height(x, z);
        if (W.hasSea && y < W.sea + 0.3 && f.biome !== 'shore') { r(); r(); r(); continue; }
        if (W.hasSea && y < W.sea - 0.2) { r(); r(); r(); continue; }
        const w = W.biomesAt(x, z, y), pw = f.biome === 'any' ? 0.35 : w[f.biome];
        // natural clustering: each species gathers in drifts (a low-frequency field per species)
        const cl = f.cluster ? Math.min(1, Math.max(0, (vnoise(x * 0.028 + f.i * 13.7, z * 0.028 - f.i * 7.3) - 0.5 + f.cluster * 0.5) * 2.4)) * 1.8 : 1;
        // forests climb the hills: ridges and upper slopes are thick with trees, valley floors open
        let hk = 1;
        if (f.hill) { const avg = (W.height(x + 45, z) + W.height(x - 45, z) + W.height(x, z + 45) + W.height(x, z - 45)) * 0.25; hk = 0.3 + 1.1 * Math.min(1, Math.max(0, (y - avg + 3) / 12)); }
        const keep = r() < pw * pw * 1.6 * cl * hk, ry = r() * 6.283, sc = f.scale[0] + r() * (f.scale[1] - f.scale[0]);
        if (!keep) continue;
        // keep the arrival spot clear
        if (x * x + z * z < 36) continue;
        if (sb && f.trunkR && sb.isFelled(f.i + ':' + Math.round(x * 10) + ':' + Math.round(z * 10))) continue;
        if (sb && sb.vox && sb.vox.isActive(x, z) && Math.abs(sb.vox.top(x, z, y + 3) - y) > 0.3) continue; // dug away or buried
        L.push([f.i, x, y - 0.08, z, ry, sc]);
      }
    }
    lists.set(key, L);
    if (lists.size > 400) { const first = lists.keys().next().value; lists.delete(first); }
    return L;
  }
  function vnoise(x, z) {
    const xi = Math.floor(x), zi = Math.floor(z), fx = x - xi, fz = z - zi, u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
    const h = (i, j) => { const n = Math.sin((xi + i) * 127.1 + (zi + j) * 311.7 + W.seed * 0.013) * 43758.5453; return n - Math.floor(n); };
    return (h(0, 0) * (1 - u) + h(1, 0) * u) * (1 - v) + (h(0, 1) * (1 - u) + h(1, 1) * u) * v;
  }
  const trunks = new Map(); // "gx,gz" (8 m cells) -> [[x, z, r]]
  colliders.shape((x, z) => {
    let best = 99; const gx = Math.floor(x / 8), gz = Math.floor(z / 8);
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const L = trunks.get((gx + i) + ',' + (gz + j)); if (!L) continue; for (const t of L) { const d = Math.hypot(x - t[0], z - t[1]) - t[2]; if (d < best) best = d; } }
    return best;
  }, { h: 6, kind: 'solid', name: 'trees' });
  let floraCenter = null;
  const fm = new THREE.Matrix4(), fq = new THREE.Quaternion(), fv = new THREE.Vector3(), fs = new THREE.Vector3(), yAxis = new THREE.Vector3(0, 1, 0);
  // Triangle budget for flora (main pass), scaled live by the quality scaler. Shadow casters (near
  // LOD0 big plants) cost again in the shadow pass, so LOD0 has its own smaller share.
  const BUDGET = lite ? { all: 600e3, lod0: 160e3 } : { all: 2.0e6, lod0: 420e3 };
  let quality = params.has('q') ? +params.get('q') : 1; // 0.45 .. 1.25
  let qCap = 1.25; // the game's video setting caps it (low 0.6, medium 0.9)
  const XF = 10; // metres of dithered crossfade between a tree's mesh and its impostor
  const cand = [];
  function rebuildFlora(px, pz) {
    const pcx = Math.floor(px / T.CH), pcz = Math.floor(pz / T.CH);
    const counts = floraIM.map((F) => F.map(() => 0));
    const impN = flora.map(() => 0);
    trunks.clear();
    const Rr = Math.ceil(T.floraR);
    const activeSamples = new Set();
    // 1) everything that could be drawn as a mesh, nearest first
    cand.length = 0;
    for (let dz = -Rr; dz <= Rr; dz++) for (let dx = -Rr; dx <= Rr; dx++) {
      const cx = pcx + dx, cz = pcz + dz, d = chunkDist(cx, cz, px, pz);
      if (d > T.floraR) continue;
      const near = d < T.nearR + 0.5;
      for (const it of chunkList(cx, cz)) {
        const f = flora[it[0]];
        if (f.near && !near) continue;
        const dd = Math.hypot(it[1] - px, it[3] - pz);
        if (f.maxD && dd > f.maxD * (lite ? 0.7 : 1) * Math.min(1, quality)) continue;
        if (f.trunkR && d < 1.6) { const key = Math.floor(it[1] / 8) + ',' + Math.floor(it[3] / 8); let L = trunks.get(key); if (!L) trunks.set(key, (L = [])); L.push([it[1], it[3], f.trunkR * it[5], it]); }
        cand.push(dd, it);
      }
      if (d < 1.6) activeSamples.add(cx + ',' + cz);
    }
    const order = new Uint32Array(cand.length / 2).map((_, i) => i).sort((i, j) => cand[i * 2] - cand[j * 2]);
    // 2) spend the budget nearest-first: LOD0 close, LOD1 further, impostor (forests) or nothing beyond
    const B = BUDGET.all * quality, B0 = BUDGET.lod0 * quality; let used = 0, used0 = 0;
    const put = (it, i, l) => { fq.setFromAxisAngle(yAxis, it[4]); fv.set(it[1], it[2], it[3]); fs.setScalar(it[5]); fm.compose(fv, fq, fs); const C = counts[i]; for (const im of floraIM[i][l]) im.setMatrixAt(C[l], fm); return C[l]++; };
    const impAt = (i, it, xf) => { const I = impIM[i]; if (!I || impN[i] >= I.userData.cap) return; impostors[i].set(I, impN[i], it[1], it[2], it[3], it[4], it[5], xf); impN[i]++; };
    const impD = flora.map((f) => (f.forest ? f.imp * (lite ? 0.6 : 1) * Math.min(1.1, quality) : 0));
    for (const k of order) {
      const dd = cand[k * 2], it = cand[k * 2 + 1], i = it[0], f = flora[i], F = floraIM[i], cost = f.cost;
      const last = F.length - 1;
      if (f.forest && dd > impD[i]) { impAt(i, it, 0); continue; }
      let l = last > 0 && dd < (f.near0 || (lite ? 34 : 60) * (f.big ? 1.4 : 1)) * Math.min(1, quality) ? 0 : last;
      if (l === 0 && (used0 + cost[0] > B0 || counts[i][0] >= F[0][0].userData.cap)) l = last;
      if (used + cost[l] > B && !(cost[l] < 1500 && used < B * 1.15)) { if (f.forest) impAt(i, it, 0); continue; }
      if (counts[i][l] >= F[l][0].userData.cap) { if (f.forest) impAt(i, it, 0); continue; }
      const n = put(it, i, l); used += cost[l]; if (l === 0) used0 += cost[0];
      // the outer band of mesh trees also gets an impostor; both dither across by distance
      if (f.forest && l === last && dd > impD[i] - XF - 4) { impAt(i, it, 1); xfSet(i, n, 1); }
      else if (f.forest && l === last) xfSet(i, n, 0);
    }
    // 3) distant forests: impostors out to the edge of the terrain view
    if (impIM.some(Boolean)) {
      const Rf = Math.ceil(T.R);
      for (let dz = -Rf; dz <= Rf; dz++) for (let dx = -Rf; dx <= Rf; dx++) {
        const cx = pcx + dx, cz = pcz + dz, d = chunkDist(cx, cz, px, pz);
        if (d <= T.floraR || d > T.R) continue;
        for (const it of chunkList(cx, cz, true)) impAt(it[0], it, 0);
      }
      impIM.forEach((I, i) => { if (!I) return; impostors[i].commit(I, impN[i]); const u = I.material.userData.xf; if (u) { u.uF0.value = impD[i] - XF; u.uF1.value = impD[i]; } });
    }
    floraIM.forEach((F, i) => F.forEach((L, l) => { for (const im of L) { im.count = counts[i][l]; im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); const u = im.material.userData.xf; if (u) { u.uF0.value = impD[i] - XF; u.uF1.value = impD[i]; } if (im.geometry.attributes.aXF) im.geometry.attributes.aXF.needsUpdate = true; } }));
    floraStats = { used: Math.round(used), used0: Math.round(used0), quality: +quality.toFixed(2), imp: impN.reduce((a, b) => a + b, 0) };
    syncSamples(activeSamples);
    floraCenter = { cx: pcx, cz: pcz, x: px, z: pz };
  }
  let floraStats = null;
  function xfSet(i, n, v) { for (const im of floraIM[i][floraIM[i].length - 1]) { const a = im.geometry.attributes.aXF; if (a) a.array[n] = v; } }
  // Dynamic quality: on a real GPU, hold ~55+ fps by trading flora budget and distances. Software
  // renderers (headless shots, < 8 fps) are left alone so tests stay deterministic.
  let qT = 0;
  function scaleQuality(dt) {
    if (params.has('q')) return;
    qT += dt; if (qT < 2.5) return; qT = 0;
    const fps = engine.fps; if (!(fps > 8)) return;
    const q0 = quality;
    if (fps < 40) quality = Math.max(0.45, quality * 0.82); else if (fps < 52) quality = Math.max(0.45, quality * 0.93);
    else if (fps > 58 && quality < qCap) quality = Math.min(qCap, quality * 1.05);
    if (Math.abs(quality - q0) > 0.04) floraCenter = null; // rebuild with the new budget
  }

  // ---------------- samples: one glowing find per chunk, by biome
  const sparkTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,.3)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); g.fillRect(31, 6, 2, 52); g.fillRect(6, 31, 52, 2); return new THREE.CanvasTexture(c); })();
  const sampleGeo = new THREE.OctahedronGeometry(0.16, 0).scale(1, 1.6, 1);
  function syncSamples(active) {
    const taken = new Set((G.journal.planets[PK] && G.journal.planets[PK].samples) || []);
    for (const [key, s] of samples) if (!active.has(key) || taken.has(key)) { scene.remove(s.g); interact.remove('s-' + key); samples.delete(key); }
    for (const key of active) {
      if (samples.has(key) || taken.has(key)) continue;
      const [cx, cz] = key.split(',').map(Number), r = rng(hash(W.seed, cx, cz, 909));
      let x, z, y, ok = false;
      for (let k = 0; k < 6 && !ok; k++) { x = cx * T.CH + 10 + r() * (T.CH - 20); z = cz * T.CH + 10 + r() * (T.CH - 20); y = W.height(x, z); ok = !W.hasSea || y > W.sea + 0.5; }
      if (!ok) continue;
      const w = W.biomesAt(x, z, y), b = W.dominant(w);
      const col = new THREE.Color().setHSL((W.hue + 0.5 + r() * 0.4) % 1, 0.75, 0.68);
      const g = new THREE.Group(); g.position.set(x, y, z);
      const m = new THREE.Mesh(sampleGeo, new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.8, roughness: 0.2 })); m.position.y = 0.35; g.add(m);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: sparkTex, color: col, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); sp.position.y = 0.4; sp.scale.setScalar(0.9); g.add(sp);
      scene.add(g);
      const s = { g, m, sp, x, y, z, b, phase: r() * 6 };
      samples.set(key, s);
      interact.add({ id: 's-' + key, at: () => s, r: 1.6, priority: 0.5, actions: () => [{ label: `Take a sample of the ${BIOME_NAMES[b]}`, icon: 'crystal', run: async () => {
        const pr = player.act('kneel', 1.3, s); await new Promise((res) => setTimeout(res, 700));
        const pj = planetEntry(); pj.samples = pj.samples || []; pj.samples.push(key);
        game.add(`sample:${pj.name} ${b === 'shore' ? 'shore' : BIOME_NAMES[b].split(' ')[0]}`); game.save();
        scene.remove(g); interact.remove('s-' + key); samples.delete(key);
        hud.toast(`A sample from ${pj.name}`, 'crystal'); await pr;
      } }] });
    }
  }

  // ---------------- creatures
  const tmpV = new THREE.Vector3();
  function walkable(x, z) { const y = W.height(x, z); if (W.hasSea && y < W.sea + 0.3) return false; const y2 = W.height(x + 1, z); return Math.abs(y2 - y) < 0.9; }
  let herdSeq = 0;
  function spawnAnimals(px, pz) {
    const want = Math.round(T.creatures * (W.dim.creature === 'many' ? 1.5 : 1));
    for (let i = animals.length - 1; i >= 0; i--) { const a = animals[i]; if (Math.hypot(a.root.position.x - px, a.root.position.z - pz) > 120) { scene.remove(a.root); animals.splice(i, 1); } }
    let tries = 0;
    while (animals.length < want && tries++ < 6) {
      // the first herd grazes where she is looking (a living world from the first second), later ones anywhere
      camera.getWorldDirection(tmpV);
      const ahead = animals.length < 3 && tries < 5, ang = ahead ? Math.atan2(tmpV.z, tmpV.x) + (Math.random() - 0.5) * 1.1 : Math.random() * 6.283;
      const d = (animals.length < 3 ? 14 : 28) + Math.random() * (ahead ? 14 : 50), x = px + Math.cos(ang) * d, z = pz + Math.sin(ang) * d;
      if (!walkable(x, z)) continue;
      const b = W.dominant(W.biomesAt(x, z, W.height(x, z)));
      const cand = species.filter((s) => s.biomes.includes(b)); const S = (cand.length ? cand : species)[Math.floor(Math.random() * (cand.length || species.length))];
      const herd = Math.min(S.herd, want - animals.length), hid = ++herdSeq;
      for (let k = 0; k < herd; k++) {
        const hx = x + (Math.random() - 0.5) * 6, hz = z + (Math.random() - 0.5) * 6;
        if (!walkable(hx, hz)) continue;
        const c = buildCreature(S); if (!c) return; // models still loading: try on the next pass
        c.root.position.set(hx, W.height(hx, hz), hz); scene.add(c.root);
        animals.push({ S, herd: hid, obsT: 0, root: c.root, parts: c.parts, heading: Math.random() * 6.28, state: 'graze', timer: Math.random() * 3, tx: hx, tz: hz, home: { x: hx, z: hz }, phase: Math.random() * 6, speedNow: 0, seed: Math.random() * 10 });
      }
    }
  }

  // ---------------- journal (species and planets she has met, with names she can change)
  const speciesKey = (kind, i) => `${W.seed}:${W.dimKey}:${kind}:${i}`;
  function planetEntry() {
    let e = G.journal.planets[PK];
    if (!e) { e = G.journal.planets[PK] = { name: W.name, seed: W.seed, dim: W.dimKey, first: Date.now(), visits: 0 }; }
    return e;
  }
  // observing: rest her gaze on an animal for a couple of seconds and it goes in the journal, with
  // whatever it was doing (grazing, keeping to its herd, dozing, curious about her, bolting)
  const herds = new Map(); let stillT = 0; const _f = new THREE.Vector3(), _to = new THREE.Vector3();
  const NOTE = { graze: 'grazes quietly', herd: 'keeps close to its herd', rest: 'dozes, lying low', curious: 'comes over to look at you', flee: 'bolts when startled' };
  function observe(dt) {
    camera.getWorldDirection(_f);
    let best = null, bd = 0;
    for (const a of animals) {
      _to.copy(a.root.position); _to.y += a.S.size * 0.6; _to.sub(camera.position); const d = _to.length(); if (d > 24) { a.obsT = Math.max(0, a.obsT - dt); continue; }
      const c = _f.dot(_to) / d, tol = Math.cos(Math.atan((a.S.size * 0.9 + 0.4) / d));
      if (c > tol && c > bd) { bd = c; best = a; }
    }
    for (const a of animals) if (a !== best) a.obsT = Math.max(0, a.obsT - dt * 0.5);
    if (!best) return;
    best.obsT += dt;
    if (best.obsT > 2.2) { best.obsT = -6; noteFauna(best); }
  }
  function noteFauna(a) {
    const k = speciesKey('fauna', a.S.i); let e = G.journal.species[k];
    const fresh = !e;
    if (!e) { spot('fauna', a.S, true); e = G.journal.species[k]; }
    e.seen = e.seen || []; e.watched = (e.watched || 0) + 1;
    const n = a.note || (a.state === 'graze' ? 'graze' : null);
    let line = null;
    if (n && NOTE[n] && !e.seen.includes(n)) { e.seen.push(n); line = `${e.name} ${NOTE[n]}`; }
    if (a.S.nocturnal && a.state === 'rest' && !e.seen.includes('day')) { e.seen.push('day'); line = `${e.name} sleeps by day, wakes at dusk`; }
    game.save();
    if (fresh) { hud.toast(`You watch for a while. ${a.S.name} goes in the journal${line ? ': ' + NOTE[n] : ''}`, 'eye', 4200); audio.setActivity && audio.setActivity('discover', 8); }
    else if (line) hud.toast(`Journal: ${line}`, 'eye', 3600);
  }
  function spot(kind, S, quiet = false) {
    const k = speciesKey(kind, S.i);
    if (G.journal.species[k]) return;
    G.journal.species[k] = { name: S.name, kind, label: kind === 'fauna' ? S.label : S.kind, planet: PK, first: Date.now() };
    game.save();
    if (!quiet) hud.toast(`New ${kind === 'fauna' ? 'creature' : 'plant'} in the journal: ${S.name}`, kind === 'fauna' ? 'eye' : 'leaf', 3600);
  }
  extraTabs.push({ id: 'journal', label: 'Journal', icon: 'book', render: (b, rerender) => {
    const pj = planetEntry();
    const here = Object.entries(G.journal.species).filter(([, v]) => v.planet === PK);
    const allN = Object.keys(G.journal.species).length, worldsN = Object.keys(G.journal.planets).length;
    b.innerHTML = `<h3>This world</h3><div class="row"><span style="width:26px;height:26px;display:inline-flex">${icon('star')}</span><div class="grow"><input data-planet value="${esc(pj.name)}" maxlength="28" style="width:100%;font:inherit;padding:8px 10px;border-radius:10px;border:1px solid rgba(255,255,255,.25);background:rgba(255,255,255,.08);color:#fff"><div class="muted" style="font-size:13px;margin-top:4px">${DIMENSIONS[W.dimKey].name} dimension · gravity ${(W.gravity / 9.81).toFixed(2)} g · visit ${pj.visits}</div></div></div>` +
      `<h3>Met here (${here.length} of ${species.length + flora.length})</h3>` +
      (here.length ? here.map(([k, v]) => `<div class="row"><span style="width:26px;height:26px;display:inline-flex">${icon(v.kind === 'fauna' ? 'eye' : 'leaf')}</span><div class="grow"><input data-sp="${esc(k)}" value="${esc(v.name)}" maxlength="28" style="width:100%;font:inherit;padding:6px 10px;border-radius:10px;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.06);color:#fff"><div class="muted" style="font-size:13px;margin-top:3px">${esc(v.label)}${(v.seen || []).length ? ' · ' + v.seen.map((n) => (n === 'day' ? 'sleeps by day' : NOTE[n] || n)).map(esc).join(' · ') : ''}</div></div></div>`).join('') : '<p class="muted">Stand still and watch a creature for a moment to add it here; walk among plants to meet them. Tap a name to rename it.</p>') +
      `<p class="muted" style="font-size:13px;margin-top:14px">${allN} species named across ${worldsN} world${worldsN === 1 ? '' : 's'}.</p>`;
    const inp = b.querySelector('[data-planet]');
    inp.addEventListener('change', () => { pj.name = inp.value.trim() || W.name; game.save(); hud.toast(`Named ${pj.name}`, 'star'); });
    b.querySelectorAll('[data-sp]').forEach((el) => el.addEventListener('change', () => { const e = G.journal.species[el.dataset.sp]; e.name = el.value.trim() || e.name; game.save(); }));
    for (const el of b.querySelectorAll('input')) { el.addEventListener('pointerdown', (e) => e.stopPropagation()); el.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.blur(); }); }
    void rerender;
  } });

  // flora needs the scanned models; until they arrive the planet has bare ground
  function setupFlora() {
    if (!floraReady()) { floraCenter = null; return false; }
    flora = makeFlora(W, { lite }); lists.clear();
    for (const f of flora) f.cost = f.lods.map((L) => L.reduce((s, pt) => s + (pt.geo.index ? pt.geo.index.count : pt.geo.attributes.position.count) / 3, 0));
    floraIM = flora.map((f) => f.lods.map((L, l) => L.map((pt) => {
      const cap = Math.round((f.cap || (f.big ? 700 : f.near ? 3000 : 1800)) * T.cap * (l === 0 && f.lods.length > 1 ? 0.5 : 1));
      let geo = pt.geo, mat = pt.mat;
      if (f.forest && l === f.lods.length - 1) { // far mesh LOD: crossfades into the impostor
        geo = new THREE.BufferGeometry(); geo.index = pt.geo.index; for (const k in pt.geo.attributes) geo.setAttribute(k, pt.geo.attributes[k]);
        geo.setAttribute('aXF', new THREE.InstancedBufferAttribute(new Float32Array(cap), 1).setUsage(THREE.DynamicDrawUsage));
        mat = crossfadeMaterial(pt.mat.clone(), false); xfOwned.push(geo, mat);
      }
      const im = new THREE.InstancedMesh(geo, mat, cap); im.count = 0; im.userData.cap = cap; im.userData.own = pt.own; im.name = f.kind + ':' + l;
      im.castShadow = T.shadows && l === 0 && (f.big || !!f.build) && !f.noShadow; im.receiveShadow = true;
      scene.add(im); return im;
    })));
    impostors = flora.map((f) => (f.forest ? makeImpostor(renderer, f.lods[f.lods.length - 1], { px: lite ? 128 : 192 }) : null));
    impIM = impostors.map((I, i) => { if (!I) return null; const m = I.mesh(Math.round(flora[i].capImp * (lite ? 0.4 : 1))); scene.add(m); return m; });
    floraCenter = null;
    return true;
  }
  // ---------------- load a planet (seed + dimension)
  function clearPlanet() {
    if (sb) sb.clear();
    for (const c of chunks.values()) { scene.remove(c.mesh); c.mesh.geometry.dispose(); }
    chunks.clear(); lists.clear(); trunks.clear();
    for (const F of floraIM) for (const L of F) for (const im of L) { scene.remove(im); if (im.userData.own) { im.geometry.dispose(); im.material.dispose(); } im.dispose(); }
    for (const f of flora) for (const L of f.lods) for (const pt of L) if (!pt.own) pt.mat.dispose();
    impIM.forEach((m) => { if (m) { scene.remove(m); m.geometry.dispose(); } }); impostors.forEach((I) => I && I.dispose()); impostors = []; impIM = [];
    for (const o of xfOwned) o.dispose(); xfOwned = [];
    floraIM = []; flora = [];
    for (const a of animals) scene.remove(a.root); animals = [];
    for (const [key, s] of samples) { scene.remove(s.g); interact.remove('s-' + key); } samples.clear();
    for (const m of [...skyMoons.children]) { skyMoons.remove(m); m.material.dispose(); }
  }
  function loadPlanet(seed, dimKey, pk) {
    clearPlanet();
    W = makePlanet(seed, dimKey); PK = pk;
    if (sb) sb.load(pk, W);
    species = makeSpecies(W, { lite });
    setupFlora();
    // sky, light, fog from the planet
    const S = W.sky;
    sunDir.set(Math.cos(S.sunElev) * Math.sin(S.sunAz), Math.sin(S.sunElev), Math.cos(S.sunElev) * Math.cos(S.sunAz)).normalize();
    skyU.uZen.value.copy(S.zenith); skyU.uHor.value.copy(S.horizon); skyU.uGnd.value.copy(S.ground).lerp(S.horizon, 0.5); skyU.uSunCol.value.copy(S.sun);
    sun.color.copy(S.sun).lerp(new THREE.Color('#fff'), 0.5); sun.intensity = 2.4 + S.sunElev * 0.9; hemi.intensity = 0.45;
    hemi.color.copy(S.horizon); hemi.groundColor.copy(S.ground);
    scene.fog = new THREE.FogExp2(S.horizon.clone(), 1.7 / (T.R * T.CH));
    bakeEnv();
    const mr = rng(hash(seed, 61));
    for (let i = 0; i < S.moons; i++) {
      // a daytime moon: only the lit part shows, added onto the sky the way the real one looks
      const m = new THREE.Mesh(moonGeo, new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(0.08 + mr() * 0.05, 0.12 + mr() * 0.1, 0.55), map: moonTex(), roughness: 1, fog: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      m.scale.setScalar(22 + mr() * 40); m.rotation.set(mr() * 6, mr() * 6, 0);
      const a = S.sunAz + 1.2 + mr() * 3, e = 0.25 + mr() * 0.5; m.position.set(Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a)).multiplyScalar(2000); skyMoons.add(m);
    }
    { const b0 = W.dominant(W.biomesAt(0, 0, W.height(0, 0))); swapSet(terrainMat, 'g', BIOME_SET[b0] || 'forest_ground_04', P, renderer); swapSet(terrainMat, 'r', BIOME_ROCK[b0] || 'rock_boulder_dry', P, renderer); }
    water.visible = W.hasSea; water.position.y = W.sea; waterMat.color.copy(W.water.shallow);
    shoreU.uSea.value = W.hasSea ? W.sea : -1e4; shoreU.uShallowW.value.copy(W.water.shallow); shoreU.uDeepW.value.copy(W.water.deep || W.water.shallow);
    core.player.cam && 0;
    // gravity: the walking core reads it through the player options; swap the player's gravity here
    player.setGravity && player.setGravity(W.gravity);
    // first frame: terrain around the arrival spot, all at once
    let n = 0; while (streamChunks(0, 0, 999) > 0 && n++ < 3);
    rebuildFlora(0, 0);
    spawnAnimals(0, 0);
  }

  // ---------------- her ship, parked beside the arrival spot (it carries her home or onward)
  let ship = null, shipId = null, parkFace = 0, shipParked = false; const shipAt = new THREE.Vector3();
  function parkShip(face) {
    const S = activeShip();
    if (ship && shipId !== S.id) { scene.remove(ship); ship = null; }
    if (!ship) { ship = buildShip({ scale: S.scale, accent: S.accent, guide: S.id !== 'skiff', lite }); shipId = S.id; scene.add(ship); }
    // a clear, dry spot beside her: away from trunks and boulders, not in the water
    const clear = (x, z) => {
      if (W.hasSea && W.height(x, z) < W.sea + 0.4) return false;
      if (Math.abs(W.height(x + 3, z) - W.height(x - 3, z)) + Math.abs(W.height(x, z + 3) - W.height(x, z - 3)) > 3) return false;
      if (!flora.length) return true;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) for (const it of chunkList(Math.floor(x / T.CH) + i, Math.floor(z / T.CH) + j)) {
        const f = flora[it[0]]; if (!f.big && !f.trunkR) continue; if (Math.hypot(it[1] - x, it[3] - z) < 4.2 * S.scale + (f.trunkR || 0.5) * it[5] + (f.forest ? 2.5 : 0)) return false;
      }
      return true;
    };
    let a = face + 2.2, x = Math.sin(a) * 9, z = Math.cos(a) * 9;
    search: for (const d of [9, 12, 15, 19]) for (let k = 0; k < 12; k++) { const b = face + 2.2 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.5; const xx = Math.sin(b) * d, zz = Math.cos(b) * d; if (clear(xx, zz)) { a = b; x = xx; z = zz; break search; } }
    parkFace = face; shipParked = !!flora.length;
    shipAt.set(x, Math.max(W.height(x, z), W.hasSea ? W.sea : -1e9) + 1.6 * S.scale, z); ship.position.copy(shipAt); ship.rotation.y = a;
    colliders.remove('ship'); colliders.circle(x, z, 2.6 * S.scale, { h: 3, name: 'ship' });
  }
  interact.add({ id: 'ship', at: () => ({ x: shipAt.x, y: shipAt.y - 1, z: shipAt.z }), r: 4.5, priority: 0.3, enabled: () => !!ship,
    actions: () => [{ label: `Board the ${activeShip().name}`, icon: 'map', run: async () => openMap() }] });

  // ---------------- travel
  function openMap() { return openStarMap({ current: 'planet', onTravel: (d) => worlds.go(d.world, { ...d, from: 'warp' }).catch((e) => { console.warn('[G] warp failed', e); }) }); }
  function unlockDims() {
    const n = Object.keys(G.journal.planets).length;
    const steps = [[1, 'amber'], [2, 'tidal'], [3, 'velvet']];
    for (const [k, d] of steps) if (n >= k && !game.unlocked('dim:' + d)) { game.unlock('dim:' + d); setTimeout(() => hud.toast(`A new dimension on the star map: ${DIMENSIONS[d].name} (${DIMENSIONS[d].hint})`, 'map', 5200), 4200); }
  }

  // ---------------- frame
  let clock = 0, frameN = 0, spotT = 0, animT = 0;
  const shadowAt = new THREE.Vector3();
  function frame(dt) {
    clock += dt; frameN++; shoreU.uShoreT.value = clock;
    renderer.toneMappingExposure = 1.0;
    core.update(dt);
    if (sb) sb.update(dt);
    const p = player.position;
    streamChunks(p.x, p.z, T.build);
    const pcx = Math.floor(p.x / T.CH), pcz = Math.floor(p.z / T.CH);
    if (!flora.length && W && floraReady()) { setupFlora(); if (ship && !shipParked) parkShip(parkFace); }
    scaleQuality(dt);
    if (!floraCenter || floraCenter.cx !== pcx || floraCenter.cz !== pcz || Math.hypot(p.x - floraCenter.x, p.z - floraCenter.z) > 24) rebuildFlora(p.x, p.z);
    animT += dt; if (animT > 1.5 || (!animals.length && animT > 0.2)) { animT = 0; spawnAnimals(p.x, p.z); }
    // herds: centre + any member bolting (so the fright spreads)
    herds.clear();
    for (const a of animals) { let h = herds.get(a.herd); if (!h) herds.set(a.herd, (h = { x: 0, z: 0, n: 0, flee: null })); h.x += a.root.position.x; h.z += a.root.position.z; h.n++; if (a.state === 'flee' && a.timer > 2.5 && !h.flee) { const l = Math.hypot(a.tx - a.root.position.x, a.tz - a.root.position.z) || 1; h.flee = { x: a.root.position.x, z: a.root.position.z, dx: (a.tx - a.root.position.x) / l, dz: (a.tz - a.root.position.z) / l }; } }
    for (const h of herds.values()) { h.x /= h.n; h.z /= h.n; }
    stillT = player.speed < 0.15 ? stillT + dt : 0;
    const hr = new Date().getHours() + new Date().getMinutes() / 60, night = params.has('night') ? 1 : hr >= 21 || hr < 5.5 ? 1 : hr >= 19.5 ? (hr - 19.5) / 1.5 : hr < 7 ? (7 - hr) / 1.5 : 0;
    const ctx = { player: p, playerSpeed: player.speed, stillT, night, herd: (a) => herds.get(a.herd), height: groundFn, walkable, lite, audio };
    for (const a of animals) stepCreature(a, dt, clock, ctx);
    observe(dt);
    // the journal: who is close enough to meet
    spotT += dt;
    if (spotT > 0.4) {
      spotT = 0;
      const L = lists.get(pcx + ',' + pcz);
      if (L) for (const it of L) if (Math.abs(it[1] - p.x) < 3.2 && Math.abs(it[3] - p.z) < 3.2) spot('flora', flora[it[0]]);
    }
    if (ship) { ship.position.y = shipAt.y + Math.sin(clock * 0.7) * 0.18; ship.userData.ring.rotation.z = clock * 0.4; }
    for (const s of samples.values()) { s.m.rotation.y += dt; const tw = Math.exp(-((((clock + s.phase) % 4) - 0.3) ** 2) / 0.03); s.sp.material.opacity = 0.35 + tw; s.m.position.y = 0.35 + Math.sin(clock * 1.5 + s.phase) * 0.06; }
    core.updateCamera(dt);
    sky.position.copy(camera.position); skyMoons.position.copy(camera.position);
    if (W.hasSea) { water.position.x = Math.round(camera.position.x / 32) * 32; water.position.z = Math.round(camera.position.z / 32) * 32; waterNormal.offset.set((clock * 0.004) % 1, (clock * 0.003) % 1); }
    const texel = 90 / 2048;
    shadowAt.set(Math.round(p.x / texel) * texel, Math.round(p.y / texel) * texel, Math.round(p.z / texel) * texel);
    sun.position.copy(shadowAt).addScaledVector(sunDir, 150); sun.target.position.copy(shadowAt);
    if (T.shadows && frameN % 2 === 0) renderer.shadowMap.needsUpdate = true;
    const biome = W ? W.dominant(W.biomesAt(p.x, p.z, p.y)) : 'forest';
    const nearSea = W && W.hasSea ? Math.max(0, 1 - Math.max(0, p.y - (W.sea || 0)) / 6) : 0;
    const zone = biome === 'forest' ? 'forest' : 'open';
    audio.update(dt, {
      world: 'planet', biome, zone, camera, speed: player.speed || 0, altitude: camera.position.y,
      night, rain: 0, mist: 0, nearWater: nearSea,
    });
    renderer.render(scene, camera);
  }
  function resize(w, h) { camera.aspect = w / h; camera.fov = fpFov(w, h); camera.updateProjectionMatrix(); }
  resize(engine.width, engine.height);

  return {
    id: 'planet', scene, camera, resize, frame, input: core.input,
    mapData: () => ({ name: (planetEntry() || {}).name || 'A far world', key: PK, extent: { cx: player.position.x, cz: player.position.z, r: 140 }, height: W.height, sea: W.hasSea ? W.sea : null, items: interact.items(), player: { x: player.position.x, z: player.position.z, yaw: player.heading } }),
    qualityCap(c) { qCap = c; if (quality > c) { quality = c; floraCenter = null; } },
    // auto-save: where she stands, so a reload puts her back on this world
    where() { if (!W || core.cinematic) return null; const q = player.position; const [star, index] = String(PK).split(':'); return { world: 'planet', seed: W.seed, dim: W.dimKey, star: +star, index: +index, x: +q.x.toFixed(2), z: +q.z.toFixed(2), yaw: +(player.cam.yaw - Math.PI).toFixed(3) }; },
    restoreWhere(w) { if (!w || !W || w.seed !== W.seed || w.dim !== W.dimKey) return; if (Math.hypot(w.x, w.z) > 5000 || !walkable(w.x, w.z)) return; player.teleport(w.x, w.z, w.yaw || 0); player.snapCamera(); streamChunks(w.x, w.z, 4); },
    degrade() { return false; },
    debug: {
      sb, game,
      core, player, interact, openMap, get W() { return W; }, get animals() { return animals; }, get samples() { return samples; }, flora: () => flora, floraIM: () => floraIM, species: () => species,
      info: () => { const q = player.position; const w = W.biomesAt(q.x, q.z, q.y); return { world: 'planet', device: P.cls, seed: W.seed, dim: W.dimKey, name: planetEntry().name, pos: [+q.x.toFixed(1), +q.y.toFixed(1), +q.z.toFixed(1)], biome: W.dominant(w), chunks: chunks.size, lods: [0, 1, 2].map((l) => [...chunks.values()].filter((c) => c.lod === l).length), flora: floraIM.reduce((s, F) => s + F.reduce((t, L) => t + L[0].count, 0), 0), creatures: animals.length, spotted: Object.values(G.journal.species).filter((v) => v.planet === PK).length, prompt: interact.current ? interact.current.id : null, gravity: +(W.gravity / 9.81).toFixed(2), totalCalls: renderer.info.render.calls, totalTris: renderer.info.render.triangles, fps: Math.round(engine.fps) }; },
      // perf: estimated triangles per object (main pass; shadow casters counted again as shadow:)
      observeNow() { const a = animals[0]; if (a) { a.obsT = 9; noteFauna(a); } return G.journal.species; },
      setQuality(q) { quality = q; floraCenter = null; }, floraStats: () => floraStats, get shipAt() { return shipAt; },
      tris() { const o = {}; let main = 0, shadow = 0; scene.traverseVisible((m) => { if (!m.isMesh) return; const g = m.geometry; const t = (g.index ? g.index.count : g.attributes.position.count) / 3 * (m.isInstancedMesh ? m.count : g.isInstancedBufferGeometry ? g.instanceCount : 1); const k = m.name || m.parent?.name || 'mesh'; o[k] = (o[k] || 0) + t; main += t; if (m.castShadow && T.shadows) shadow += t; }); return { main: Math.round(main), shadow: Math.round(shadow), top: Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, v]) => k + '=' + Math.round(v / 1000) + 'k') }; },
      // tests: walk in a straight line quickly (streams chunks as she goes)
      async trek(dx, dz, steps = 10) { for (let i = 0; i < steps; i++) { player.teleport(player.position.x + dx / steps, player.position.z + dz / steps, Math.atan2(dx, dz)); streamChunks(player.position.x, player.position.z, 4); await new Promise((r) => setTimeout(r, 30)); } },
    },
    onEnter(arg = {}) {
      const seed = arg.seed != null ? arg.seed : (params.has('seed') ? +params.get('seed') : 1);
      const dimKey = arg.dim || params.get('dim') || G.dim || 'prime';
      const star = arg.star != null ? arg.star : seed, index = arg.index != null ? arg.index : 0;
      const pk = `${star}:${index}:${dimKey}`;
      if (!W || W.seed !== seed || W.dimKey !== dimKey) loadPlanet(seed, dimKey, pk);
      PK = pk;
      // face the most open view: downhill, toward the longest sightline
      let bestA = 0, bestH = Infinity;
      for (let i = 0; i < 16; i++) { const an = (i / 16) * Math.PI * 2; let hs = 0; for (const d of [15, 35, 60]) hs += W.height(Math.sin(an) * d, Math.cos(an) * d); if (hs < bestH) { bestH = hs; bestA = an; } }
      player.teleport(0, 0, bestA); player.snapCamera();
      parkShip(bestA);
      core.activate(); hud.showMap(true);
      const pj = planetEntry(); pj.visits = (pj.visits || 0) + 1; game.save();
      unlockDims();
      hud.fadeTo(0, 1400);
      setTimeout(() => hud.toast(`${pj.name} · ${DIMENSIONS[dimKey].name} dimension`, 'star', 4200), 900);
      void UNLOCK_ALL; void BIOMES;
    },
    onExit() { core.deactivate(); if (sb) sb.deactivate(); },
  };
}
