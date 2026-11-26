// World "planet": endless procedural worlds from a seed. Streaming terrain in chunks (load, unload,
// three LOD rings with skirts), blended biomes (salt flats, alien forest, crystal fields, ocean
// shores, ice), instanced flora, gentle creatures, samples to collect, and a journal where she names
// what she finds. A dimension changes the palette, the weight of things and the creatures' style.
//   ?world=planet&seed=123[&dim=amber]
import * as THREE from 'three';
import { makeImpostor, crossfadeMaterial } from '../game/impostor.js';
import { buildShip, buildHabitat, buildGreenhouse, buildAntenna, buildSolar, decorateModule } from '../game/moonbase.js';
import { buildRocket } from '../game/rocket.js';
import { GARDEN, MOONBASE, moonGround } from '../universe/basesite.js';
import { activeShip, shipById } from '../game/fleet.js';
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
import { dimLaws } from '../universe/dimensions.js';
import { makeWorldRules } from '../universe/rules.js';
import { precipK } from '../audio-medium.js';
import { bodyForTravel, refuel as loadPropellant, shipStats, fuelState } from '../universe/travel.js';
import { createPilot } from '../universe/pilot.js';
import { beaconList, plantBeacon, hasBeaconItem, payJump, FAST_COST } from '../universe/beacons.js';
import { homeBeacon, podFitted, usePod, wreck, wreckShip, repairWreck, salvageWreck, hold, holdCount, stowAll, takeAll } from '../universe/rescue.js';
import { parseAddr } from '../universe/universe.js';
import { makeFrame, shouldRebase, transfer } from '../universe/sphere.js';
import { setCurveRadius, curveTree } from '../universe/curve.js';
import { buildGlobe, buildGlobeAsync } from '../universe/globe.js';
import { setCurrentRules } from '../universe/current.js';
import { createExposure } from '../universe/exposure.js';
import { createLife } from '../game/life/life.js';

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
  const sun = new THREE.DirectionalLight('#fff', 2.6); scene.add(sun, sun.target); sun.userData.govShadow = true; // applyQuality sizes its shadow map
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
  const core = createWalkCore({ world: 'planet', scene, camera, P, canvas, ground: (x, z) => groundAt(x, z), gravity: 9.81, jumpV: 3.4, start: { x: 0, z: 0, yaw: 0 }, colliders, extraTabs, onMap: () => openMap(), audio, surface: (x, z) => surfaceAt(x, z) });
  const { hud, player, interact } = core;
  // living worlds: history, peoples, economies and ecosystems from this world's rules (life/life.js)
  const life = createLife({ scene, P, hud, interact, player, game, ground: (x, z) => groundAt(x, z), lite });

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
  const water = new THREE.Mesh(new THREE.PlaneGeometry(2 * T.R * T.CH + 400, 2 * T.R * T.CH + 400, lite ? 32 : 64, lite ? 32 : 64).rotateX(-Math.PI / 2), waterMat); scene.add(water);
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
    life.recordFell(it[1], it[3]);
    const ccx = Math.floor(it[1] / T.CH), ccz = Math.floor(it[3] / T.CH); lists.delete(ccx + ',' + ccz); lists.delete(ccx + ',' + ccz + 'f');
    floraCenter = null;
    const h = (f.height || 9) * it[5];
    return { x: it[1], y: it[2], z: it[3], h: Math.min(12, h), r: f.trunkR * it[5] };
  }
  // trunks near a point (the living world sets trees alight)
  function trunksNear(x, z, r) { const out = []; for (let gz = Math.floor((z - r) / 8); gz <= Math.floor((z + r) / 8); gz++) for (let gx = Math.floor((x - r) / 8); gx <= Math.floor((x + r) / 8); gx++) for (const tr of trunks.get(gx + ',' + gz) || []) if (Math.hypot(tr[0] - x, tr[1] - z) < r) { const it = tr[3], f = it && flora[it[0]]; out.push([tr[0], tr[1], tr[2], it, f ? (f.height || 9) * it[5] : 8]); } return out; }
  sb = createSandbox({ scene, camera, P, renderer, core, steps: core.steps, terrainMat, params, audio,
    hf: { ground: (x, z) => groundFn(x, z), height2, biome: (x, z, y) => W.dominant(W.biomesAt(x, z, y)), groundColor: (x, z, y, s, c) => W.groundColor(x, z, y, s, c), trunksNear, fellTree: (tr) => (tr[3] ? fellTree([tr[0], tr[1], tr[2], tr[3]]) : null), rebuild: (cx, cz) => rebuildChunkAt(Math.floor(cx * 16 / T.CH), Math.floor(cz * 16 / T.CH)), trunkRay, fell: fellTree, floraDirty: (x, z) => { const ccx = Math.floor(x / T.CH), ccz = Math.floor(z / T.CH); lists.delete(ccx + ',' + ccz); lists.delete(ccx + ',' + ccz + 'f'); floraCenter = null; }, isWater: (x, z, y) => W.hasSea && y < W.sea + 0.25 } });
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

  function buildChunk(cx, cz, lod, noHoles = false) {
    // columns dug into voxels leave a hole here (the voxel mesh fills it, matching at the rim)
    const holes = sb && sb.vox && !noHoles ? sb.vox.holesIn(cx, cz, T.CH) : [];
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
      const r = rng(hash(W.lseed, cx, cz, f.i, 5));
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
        if (W.tile === W.spawnTile && (x - W.spawn.x) ** 2 + (z - W.spawn.z) ** 2 < 36) continue;
        if ((f.trunkR || f.big) && life.cleared(x, z)) continue; // settlements cut their trees
        if (W.site && siteClear(x, z)) continue; // the garden / base ground stays as it is in the hand-built world
        if (sb && f.trunkR && sb.isFelled(f.i + ':' + Math.round(x * 10) + ':' + Math.round(z * 10))) continue;
        if (sb && sb.vox && sb.vox.isActive(x, z) && Math.abs(sb.vox.top(x, z, y + 3) - y) > 0.3) continue; // dug away or buried
        if (sb && sb.sim && !f.trunkR && sb.sim.burnt(x, z)) continue; // burnt to the ground (grows back with the grass)
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
  let qT = 0, governed = false;
  function scaleQuality(dt) {
    if (params.has('q') || governed) return; // the engine's quality governor drives `quality` through applyQuality
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
    const taken = new Set(((G.journal.planets[PK] && G.journal.planets[PK].samples) || []).map((k) => (W.tile === W.spawnTile ? k : k.startsWith(W.tile + '|') ? k.slice(W.tile.length + 1) : null)).filter(Boolean));
    for (const [key, s] of samples) if (!active.has(key) || taken.has(key)) { scene.remove(s.g); interact.remove('s-' + key); samples.delete(key); }
    for (const key of active) {
      if (samples.has(key) || taken.has(key)) continue;
      const [cx, cz] = key.split(',').map(Number), r = rng(hash(W.lseed, cx, cz, 909));
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
        const pj = planetEntry(); pj.samples = pj.samples || []; pj.samples.push(W.tile === W.spawnTile ? key : W.tile + '|' + key);
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
  // a creature leaving the world: its bone texture (one small float texture per skinned mesh) and
  // animation caches go with it, or every herd that wanders off or every new planet leaks a few
  function dropAnimal(a) {
    scene.remove(a.root);
    a.root.traverse((o) => { if (o.isSkinnedMesh && o.skeleton) o.skeleton.dispose(); });
    const mx = a.parts && a.parts.mixer; if (mx) { mx.stopAllAction(); mx.uncacheRoot(a.root); }
  }
  function spawnAnimals(px, pz) {
    const want = W.rules && W.rules.biology.life !== 'complex' ? 0 : Math.round(T.creatures * (W.dim.creature === 'many' ? 1.5 : 1));
    for (let i = animals.length - 1; i >= 0; i--) { const a = animals[i]; if (Math.hypot(a.root.position.x - px, a.root.position.z - pz) > 120) { dropAnimal(a); animals.splice(i, 1); } }
    if (!species.length) return;
    let tries = 0;
    while (animals.length < want && tries++ < 6) {
      // the first herd grazes where she is looking (a living world from the first second), later ones anywhere
      camera.getWorldDirection(tmpV);
      const ahead = animals.length < 3 && tries < 5, ang = ahead ? Math.atan2(tmpV.z, tmpV.x) + (Math.random() - 0.5) * 1.1 : Math.random() * 6.283;
      const d = (animals.length < 3 ? 14 : 28) + Math.random() * (ahead ? 14 : 50), x = px + Math.cos(ang) * d, z = pz + Math.sin(ang) * d;
      if (!walkable(x, z)) continue;
      const b = W.dominant(W.biomesAt(x, z, W.height(x, z)));
      const S = life.pickSpecies(x, z, b); if (!S) continue; // the local population decides
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
    if (!e) { e = G.journal.planets[PK] = { name: (curBody && curBody.name) || W.name, seed: W.seed, dim: W.dimKey, first: Date.now(), visits: 0 }; }
    return e;
  }
  // observing: rest her gaze on an animal for a couple of seconds and it goes in the journal, with
  // whatever it was doing (grazing, keeping to its herd, dozing, curious about her, bolting)
  const herds = new Map(); let stillT = 0; const _f = new THREE.Vector3(), _to = new THREE.Vector3();
  const NOTE = { hunt: 'stalks smaller animals', graze: 'grazes quietly', herd: 'keeps close to its herd', rest: 'dozes, lying low', curious: 'comes over to look at you', flee: 'bolts when startled' };
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
  extraTabs.push({ id: 'history', label: 'History', icon: 'map', render: (b) => life.historyTab(b) });
  extraTabs.push({ id: 'journal', label: 'Journal', icon: 'book', render: (b, rerender) => {
    const pj = planetEntry();
    const here = Object.entries(G.journal.species).filter(([, v]) => v.planet === PK);
    const allN = Object.keys(G.journal.species).length, worldsN = Object.keys(G.journal.planets).length;
    b.innerHTML = `<h3>This world</h3><div class="row"><span style="width:26px;height:26px;display:inline-flex">${icon('star')}</span><div class="grow"><input data-planet value="${esc(pj.name)}" maxlength="28" style="width:100%;font:inherit;padding:8px 10px;border-radius:10px;border:1px solid rgba(255,255,255,.25);background:rgba(255,255,255,.08);color:#fff"><div class="muted" style="font-size:13px;margin-top:4px">${DIMENSIONS[W.dimKey].name} dimension · gravity ${(W.gravity / 9.81).toFixed(2)} g · visit ${pj.visits}</div><div class="muted" style="font-size:13px;margin-top:4px">${W.rules ? esc(W.rules.eraName + ' · ' + W.rules.summary()) : ''}</div><div class="muted" style="font-size:12px;margin-top:2px">${W.rules ? esc('Air: ' + (W.rules.atmosphere.breathable ? 'breathable' : W.rules.survival.reasons.join(', ')) + ' · fire ' + (W.rules.can('combustion') ? 'burns' : 'will not burn') + ' · water ' + (W.rules.water.liquid ? 'flows' : W.rules.water.ice ? 'frozen' : 'absent') + ' · radiation ' + W.rules.radiation + ' · elements: ' + W.rules.chemistry.elements.join(' ')) : ''}</div></div></div>` +
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
    // biology decides what grows: lifeless worlds keep only rock, crystal and ice; microbes leave no plants
    const life = W.rules ? W.rules.biology.life : 'complex';
    if (life === 'none' || life === 'microbial') for (const f of flora) if (!/^(pebbles|crystal|boulder|stone|ice spire)$/.test(f.kind)) f.density = 0;
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
    dropPre();
    if (sb) sb.clear();
    for (const c of chunks.values()) { scene.remove(c.mesh); c.mesh.geometry.dispose(); }
    chunks.clear(); lists.clear(); trunks.clear();
    for (const F of floraIM) for (const L of F) for (const im of L) { scene.remove(im); if (im.userData.own) { im.geometry.dispose(); im.material.dispose(); } im.dispose(); }
    for (const f of flora) for (const L of f.lods) for (const pt of L) if (!pt.own) pt.mat.dispose();
    impIM.forEach((m) => { if (m) { scene.remove(m); m.geometry.dispose(); } }); impostors.forEach((I) => I && I.dispose()); impostors = []; impIM = [];
    for (const o of xfOwned) o.dispose(); xfOwned = [];
    floraIM = []; flora = [];
    for (const a of animals) dropAnimal(a); animals = [];
    for (const [key, s] of samples) { scene.remove(s.g); interact.remove('s-' + key); } samples.clear();
    for (const m of [...skyMoons.children]) { skyMoons.remove(m); m.material.dispose(); }
    if (globe) { scene.remove(globe.mesh); globe.dispose(); globe = null; }
  }
  // ---------------- the sphere: tiles, floating origin, the globe from height
  let globe = null, exposure = null, rebaseT = 0, era = 'present', travelArg = {}, loadedSig = null;
  const skyBase = { zen: new THREE.Color(), hor: new THREE.Color(), gnd: new THREE.Color() }, BLACK = new THREE.Color(0, 0, 0);
  // player edits are stored per tile (the arrival tile keeps the old per-planet key, so old saves still load)
  const tileKey = () => (W.tile === W.spawnTile ? PK : `${PK}@${W.tile}`);
  function dropTerrain() {
    for (const c of chunks.values()) { scene.remove(c.mesh); c.mesh.geometry.dispose(); }
    chunks.clear(); lists.clear(); trunks.clear(); floraCenter = null;
    for (const [key, sm] of samples) { scene.remove(sm.g); interact.remove('s-' + key); } samples.clear();
    for (const a of animals) dropAnimal(a); animals = [];
  }
  // walked into the next tile: re-base the scene on its frame so coordinates stay near 0,0,0.
  // Seamless: the next tile's terrain and flora lists are built ahead of time, one chunk a frame, while
  // she walks (or flies) toward the border (prefetch below); crossing swaps them in, no rebuild hitch.
  let pre = null; // { id, frame, chunks: Map, lists: Map, done }
  function dropPre() { if (!pre) return; for (const c of pre.chunks.values()) c.mesh.geometry.dispose(); pre = null; }
  function inFrame(fr, L, fn) { const of = W.frame, ol = lists; W.setFrame(fr); lists = L; try { return fn(); } finally { W.setFrame(of); lists = ol; } }
  function tileEdited(key) { const r = G.g7 && G.g7.worlds && G.g7.worlds[key]; return !!(r && ((r.felled && r.felled.length) || (r.vox && Object.keys(r.vox).length) || (r.builds && r.builds.length) || (r.props && r.props.length))); }
  function prefetch(px, pz, budget = 1) {
    if (!W) return;
    const r = Math.hypot(px, pz) || 1, k = (r + 420) / r;
    const id = shouldRebase(W.frame, px * k, pz * k, 0);
    if (!id) return;
    if (!pre || pre.id !== id) { dropPre(); pre = { id, frame: makeFrame(W.radius, id), chunks: new Map(), lists: new Map(), done: false }; }
    if (pre.done) return;
    const t = transfer(W.frame, pre.frame, px, pz);
    inFrame(pre.frame, pre.lists, () => {
      const pcx = Math.floor(t.x / T.CH), pcz = Math.floor(t.z / T.CH), Rr = Math.ceil(T.R);
      for (let b = 0; b < budget; b++) {
        let best = null;
        for (let dz = -Rr; dz <= Rr; dz++) for (let dx = -Rr; dx <= Rr; dx++) {
          const cx = pcx + dx, cz = pcz + dz, d = chunkDist(cx, cz, t.x, t.z), key = cx + ',' + cz;
          if (d > T.R || pre.chunks.has(key)) continue;
          if (!best || d < best.d) best = { cx, cz, d, key };
        }
        if (best) { pre.chunks.set(best.key, buildChunk(best.cx, best.cz, lodFor(best.d), true)); continue; }
        // terrain ready: the flora lists around where she will be
        const Fr = Math.ceil(T.floraR); let n = 0;
        for (let dz = -Fr; dz <= Fr && n < 2; dz++) for (let dx = -Fr; dx <= Fr && n < 2; dx++) { const key = (pcx + dx) + ',' + (pcz + dz); if (!lists.has(key) && flora.length) { chunkList(pcx + dx, pcz + dz); n++; } }
        if (!n) pre.done = true;
        break;
      }
    });
  }
  function rebase(id) {
    const t0 = performance.now();
    const from = W.frame, to = makeFrame(W.radius, id), q = player.position;
    const t = transfer(from, to, q.x, q.z, player.heading), vy = q.y - groundFn(q.x, q.z);
    if (ship) { const ts = transfer(from, to, shipAt.x, shipAt.z, ship.rotation.y); shipAt.x = ts.x; shipAt.z = ts.z; ship.position.x = ts.x; ship.position.z = ts.z; ship.rotation.y = ts.yaw; colliders.remove('ship'); colliders.circle(ts.x, ts.z, 2.6 * activeShip().scale, { h: 3, name: 'ship' }); }
    const ready = pre && pre.id === id ? pre : null; pre = null;
    dropTerrain();
    W.setFrame(to);
    if (sb) sb.load(tileKey(), W);
    if (ready) {
      for (const [key, c] of ready.chunks) { scene.add(c.mesh); chunks.set(key, c); }
      const edited = tileEdited(tileKey());
      lists = edited ? new Map() : ready.lists;
      if (edited && sb && sb.vox) for (const [key, c] of chunks) { const [cx, cz] = key.split(',').map(Number); if (sb.vox.holesIn(cx, cz, T.CH).length) rebuildChunkAt(cx, cz); void c; }
    }
    if (globe) globe.orient(to);
    if (!piloting()) { player.teleport(t.x, t.z, t.yaw); if (vy > 0.5) player.position.y += vy; }
    if (!ready && !piloting()) { let n = 0; while (streamChunks(t.x, t.z, 999) > 0 && n++ < 3); }
    else streamChunks(t.x, t.z, 2); // whatever the prefetch did not reach streams in over the next frames
    const fpt = piloting() ? pilot.focusPoint() : t;
    rebuildFlora(fpt.x, fpt.z); if (!piloting()) spawnAnimals(t.x, t.z);
    refreshBeacons(); refreshWreck(); refreshSite(); curveTree(scene);
    lastRebaseMs = Math.round(performance.now() - t0);
    if (window.__zenDebugRebase) window.__zenDebugRebase(id, lastRebaseMs, !!ready);
    return t;
  }
  let lastRebaseMs = 0, curBody = null;
  const piloting = () => !!(pilot && pilot.active);
  const nearShip = () => !!ship && Math.hypot(player.position.x - shipAt.x, player.position.z - shipAt.z) < 7;
  async function toShip() { if (!ship) return; player.teleport(shipAt.x + 3, shipAt.z + 3, player.heading); player.snapCamera(); }
  function loadPlanet(seed, dimKey, pk, { body = null, star = null, tile = null, light = false } = {}) {
    clearPlanet(); curBody = body;
    const rules = makeWorldRules({ seed, body, star, era, dim: dimLaws(dimKey) });
    const home = body && body.world && dimKey === 'prime' && era === 'present' ? body.world : null;
    const siteOpt = home === 'earth' ? { kind: 'earth', r0: GARDEN.flat, r1: GARDEN.blend } : home === 'moon' ? { kind: 'moon', r0: MOONBASE.flat, r1: MOONBASE.blend, local: moonGround(rng(4242)).height } : null;
    W = makePlanet(seed, dimKey, { rules, site: siteOpt }); PK = pk;
    if (tile && tile !== W.tile) W.setFrame(makeFrame(W.radius, tile));
    core.worldRules = rules; if (worlds.currentId === 'planet') setCurrentRules(rules, { world: 'planet', pk, era, W });
    setCurveRadius(W.radius);
    player.setEnvSpeed && player.setEnvSpeed(rules.move.speedK);
    if (sb) sb.load(tileKey(), W);
    void makeSpecies;
    // what lives here is whatever the world's own history left alive (a dead world has no animals)
    life.load(W, pk, core); species = life.species();
    setupFlora();
    // sky, light, fog from the planet
    const S = W.sky;
    sunDir.set(Math.cos(S.sunElev) * Math.sin(S.sunAz), Math.sin(S.sunElev), Math.cos(S.sunElev) * Math.cos(S.sunAz)).normalize();
    skyU.uZen.value.copy(S.zenith); skyU.uHor.value.copy(S.horizon); skyBase.zen.copy(S.zenith); skyBase.hor.copy(S.horizon); skyU.uGnd.value.copy(S.ground).lerp(S.horizon, 0.5); skyBase.gnd.copy(skyU.uGnd.value); skyU.uSunCol.value.copy(S.sun);
    sun.color.copy(S.sun).lerp(new THREE.Color('#fff'), 0.5); sun.intensity = sunBase = (2.4 + S.sunElev * 0.9) * (W.rules ? Math.min(1.5, Math.max(0.45, Math.pow(W.rules.star.lum / (W.rules.body.au * W.rules.body.au), 0.25))) : 1); // the star's real output at this orbit and era hemi.intensity = 0.45;
    hemi.color.copy(S.horizon); hemi.groundColor.copy(S.ground);
    scene.fog = new THREE.FogExp2(S.horizon.clone(), 1.7 / (T.R * T.CH));
    bakeEnv();
    { const b0 = W.dominant(W.biomesAt(0, 0, W.height(0, 0))); swapSet(terrainMat, 'g', BIOME_SET[b0] || 'forest_ground_04', P, renderer); swapSet(terrainMat, 'r', BIOME_ROCK[b0] || 'rock_boulder_dry', P, renderer); }
    water.visible = W.hasSea; water.position.y = W.sea; waterMat.color.copy(W.water.shallow); if (sb && sb.sim) sb.sim.view.setWaterColor(W.water.shallow);
    shoreU.uSea.value = W.hasSea ? W.sea : -1e4; shoreU.uShallowW.value.copy(W.water.shallow); shoreU.uDeepW.value.copy(W.water.deep || W.water.shallow);
    core.player.cam && 0;
    // gravity: the walking core reads it through the player options; swap the player's gravity here
    player.setGravity && player.setGravity(W.gravity);
    if (light) { globe = buildGlobe(W, { lite, detail: lite ? 10 : 16 }); const Wl = W; buildGlobeAsync(W, { lite, cancelled: () => W !== Wl }).then((g) => { if (!g || W !== Wl) { if (g) g.dispose(); return; } const old = globe; globe = g; scene.add(g.mesh); if (old) { scene.remove(old.mesh); old.dispose(); } }).catch(() => {}); }
    else globe = buildGlobe(W, { lite });
    scene.add(globe.mesh); globe.orient(W.frame);
    if (exposure) exposure.dispose();
    exposure = createExposure({ rules, player, hud, isSafe: nearShip, retreat: toShip });
    // first frame: terrain around the arrival spot, all at once
    const s0 = W.tile === W.spawnTile ? W.spawn : { x: 0, z: 0 };
    refreshBeacons(); refreshWreck(); refreshSite();
    if (light) return;
    let n = 0; while (streamChunks(s0.x, s0.z, 999) > 0 && n++ < 3);
    rebuildFlora(s0.x, s0.z);
    spawnAnimals(s0.x, s0.z);
  }

  // ---------------- her ship, parked beside the arrival spot (it carries her home or onward)
  let ship = null, shipId = null, parkFace = 0, shipParked = false; const shipAt = new THREE.Vector3();
  function parkShip(face) {
    const S = activeShip();
    ensureShip(); ship.quaternion.identity();
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
    const ox = player.position.x, oz = player.position.z;
    let a = face + 2.2, x = ox + Math.sin(a) * 9, z = oz + Math.cos(a) * 9;
    search: for (const d of [9, 12, 15, 19]) for (let k = 0; k < 12; k++) { const b = face + 2.2 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.5; const xx = ox + Math.sin(b) * d, zz = oz + Math.cos(b) * d; if (clear(xx, zz)) { a = b; x = xx; z = zz; break search; } }
    parkFace = face; shipParked = !!flora.length;
    shipAt.set(x, Math.max(W.height(x, z), W.hasSea ? W.sea : -1e9) + 1.6 * S.scale, z); ship.position.copy(shipAt); ship.rotation.y = a;
    colliders.remove('ship'); colliders.circle(x, z, 2.6 * S.scale, { h: 3, name: 'ship' });
  }
  function ensureShip() {
    const S = activeShip();
    if (ship && shipId !== S.id) { scene.remove(ship); ship = null; }
    if (!ship) { ship = buildShip({ scale: S.scale, accent: S.accent, guide: S.id !== 'skiff', lite }); shipId = S.id; scene.add(ship); }
    return ship;
  }
  // ---------------- beacons: the only fast travel (crafted, planted by hand, used from inside the ship)
  const beaconGroup = new THREE.Group(); beaconGroup.name = 'beacons'; scene.add(beaconGroup);
  const pylonGeo = new THREE.CylinderGeometry(0.12, 0.26, 3.2, 8), orbGeo = new THREE.SphereGeometry(0.34, 16, 12);
  const pylonMat = new THREE.MeshStandardMaterial({ color: '#8a97a8', metalness: 0.6, roughness: 0.45 }), orbMat = new THREE.MeshBasicMaterial({ color: '#9fe3ff' });
  function refreshBeacons() {
    beaconGroup.clear();
    if (!W) return;
    const tile = W.tile === W.spawnTile ? null : W.tile;
    for (const b of beaconList()) {
      if (b.world !== 'planet' || (b.addr || null) !== (travelArg.addr || null) || b.dim !== W.dimKey || (b.era || 'present') !== era || (b.tile || null) !== tile) continue;
      const g = new THREE.Group(), m = new THREE.Mesh(pylonGeo, pylonMat), o = new THREE.Mesh(orbGeo, orbMat);
      m.position.y = 1.6; o.position.y = 3.45; g.add(m, o); g.position.set(b.x, groundFn(b.x, b.z), b.z); beaconGroup.add(g);
    }
    curveTree(beaconGroup);
  }
  function plantHere() {
    const a = ship ? ship.rotation.y : 0, sc = activeShip().scale, x = shipAt.x + Math.sin(a - 1.6) * 6 * sc, z = shipAt.z + Math.cos(a - 1.6) * 6 * sc;
    if (W.site) { const L = siteLocal(x, z, 0); if (L && L.r < SITE[W.site.kind].back + 8) { hud.toast(W.site.kind === 'earth' ? 'Too close to the garden: plant this one further out (or set one up inside the garden itself).' : 'Too close to the base: plant it further out.', 'star', 4200); return null; } }
    const [star, index] = String(PK).split(':');
    const b = plantBeacon({ world: 'planet', name: planetEntry().name + (era !== 'present' ? ` (${W.rules.eraName})` : ''), seed: W.seed, star: +star, index: +index, addr: travelArg.addr || null, dim: W.dimKey, era, tile: W.tile === W.spawnTile ? null : W.tile, x, z });
    hud.toast(b ? `Beacon planted. From inside the ship you can jump back here from anywhere (${FAST_COST} propellant).` : 'There is already a beacon here.', 'star', 5200);
    refreshBeacons(); return b;
  }
  async function fastTravel(b) {
    if (!b) return;
    if (!pilot.active) { hud.toast('Fast travel works only from inside the ship.', 'star', 3200); return; }
    if (!payJump()) { hud.toast(`A beacon jump needs ${FAST_COST} propellant in the tank.`, 'star', 3600); return; }
    pilot.abort(); if (b.world !== 'planet') G.universe.parked = null; // the ship comes along: parked just outside the garden / base
    await hud.fadeTo(1, 450);
    const go = b.world === 'earth' ? worlds.go('earth', { from: 'beacon', beacon: b }) : b.world === 'moon' ? worlds.go('moon', { from: 'beacon', beacon: b })
      : worlds.go('planet', { from: 'warp', beacon: b, seed: b.seed, star: b.star, index: b.index, addr: b.addr, dim: b.dim, era: b.era });
    return go.catch((e) => { console.warn('[G] beacon jump failed', e); hud.fadeTo(0, 600); });
  }
  function parkAt(x, z, yaw) {
    ensureShip(); ship.quaternion.identity(); ship.rotation.set(0, yaw, 0);
    const sc = activeShip().scale; shipAt.set(x, Math.max(groundFn(x, z), W.hasSea ? W.sea : -1e9) + 1.6 * sc, z); ship.position.copy(shipAt);
    colliders.remove('ship'); colliders.circle(x, z, 2.6 * sc, { h: 3, name: 'ship' }); shipParked = true; parkFace = yaw;
    G.universe.parked = { addr: travelArg.addr || null, dim: W.dimKey, era, tile: W.frame.id, x: +x.toFixed(2), z: +z.toFixed(2), yaw: +yaw.toFixed(3) };
  }
  // ---------------- home sites: the garden on the whole Earth, the moon base on the whole Moon
  const siteGroup = new THREE.Group(); siteGroup.name = 'site'; scene.add(siteGroup);
  let siteBuilt = null;
  const SITE = { earth: GARDEN, moon: MOONBASE };
  function siteFrame() { return W && W.site ? makeFrame(W.radius, W.site.tile) : null; }
  // her position in the hand-built world's own coordinates (garden: its centre at GARDEN.cx/cz; base: 0, 0)
  function siteLocal(x, z, yaw) {
    const fr = siteFrame(); if (!fr) return null;
    const t = W.frame.id === fr.id ? { x, z, yaw } : transfer(W.frame, fr, x, z, yaw);
    const dx = t.x - W.site.x, dz = t.z - W.site.z, o = W.site.kind === 'earth' ? { x: GARDEN.cx, z: GARDEN.cz } : { x: 0, z: 0 };
    return { x: dx + o.x, z: dz + o.z, yaw: t.yaw, r: Math.hypot(dx, dz) };
  }
  // a spot just outside the garden / base on the sphere world, along local direction `an` (0 = +z), facing outward
  function siteOutside(an = 0.3, extra = 22) {
    const S0 = SITE[W.site.kind], o = W.site.kind === 'earth' ? { x: GARDEN.cx, z: GARDEN.cz } : { x: 0, z: 0 }, r = S0.back + extra;
    return siteToFlat(o.x + Math.sin(an) * r, o.z + Math.cos(an) * r, an);
  }
  function siteToFlat(lx, lz, yaw = 0) {
    const fr = siteFrame(), o = W.site.kind === 'earth' ? { x: GARDEN.cx, z: GARDEN.cz } : { x: 0, z: 0 };
    const x = W.site.x + lx - o.x, z = W.site.z + lz - o.z;
    return W.frame.id === fr.id ? { x, z, yaw } : transfer(fr, W.frame, x, z, yaw);
  }
  function buildSite(kind) {
    const g = new THREE.Group();
    const M = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, ...o });
    if (kind === 'earth') {
      // what the garden looks like from outside: lawn, salt flat, the wall, the shed, the pad, a few trees
      const salt = new THREE.Mesh(new THREE.CircleGeometry(66, 64).rotateX(-Math.PI / 2), M('#cbc2ab')); salt.position.y = 0.03; g.add(salt);
      const lawn = new THREE.Mesh(new THREE.CircleGeometry(30, 64).rotateX(-Math.PI / 2), M('#5d7a3a')); lawn.scale.x = 1 / 0.85; lawn.position.set(GARDEN.cx, 0.05, GARDEN.cz); g.add(lawn);
      const wall = new THREE.Mesh(new THREE.BoxGeometry(35, 2.1, 0.5), M('#cdb48a')); wall.position.set(0, 1.05, -12.6); g.add(wall);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(35.5, 0.3, 0.9), M('#4b4b53')); cap.position.set(0, 2.25, -12.6); g.add(cap);
      const shed = new THREE.Mesh(new THREE.BoxGeometry(8, 3.2, 10), M('#7a5a3c')); shed.position.set(20.5, 1.6, 2.5); g.add(shed);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(7.2, 1.8, 4).rotateY(Math.PI / 4), M('#5b4636')); roof.scale.set(0.8, 1, 1); roof.position.set(20.5, 4.1, 2.5); g.add(roof);
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(6, 6.3, 0.4, 32), M('#8d8d8d')); pad.position.set(34, 0.2, 1); g.add(pad);
      const trunkM = M('#5a4430'), leafM = M('#3f6a35');
      for (const [x, z, s] of [[-8, 4, 1.2], [9, -6, 1], [-4, -8, 0.9], [6, 9, 1.1], [-12, -3, 0.8], [12, 10, 0.9]]) {
        const t = new THREE.Mesh(new THREE.CylinderGeometry(0.18 * s, 0.25 * s, 3 * s, 6), trunkM); t.position.set(x, 1.5 * s, z); g.add(t);
        const l = new THREE.Mesh(new THREE.IcosahedronGeometry(1.9 * s, 1), leafM); l.position.set(x, 3.6 * s, z); g.add(l);
      }
      if ((G.rocket && G.rocket.parts || []).length >= 5) { const r = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.2, 11, 16), M('#e8e4dc', { metalness: 0.3 })); r.position.set(34, 5.9, 1); g.add(r); }
    } else {
      // the moon base: the modules she built, where she put them, and the rocket on its pad
      const MM = (G.moon && G.moon.modules) || {}, lvl = (id) => (MM[id] ? MM[id].lvl || 1 : 0);
      const builders = { habitat: buildHabitat, greenhouse: buildGreenhouse, antenna: buildAntenna, solar: (o) => buildSolar({ ...o, lvl: lvl('solar') || 1 }) };
      for (const id of Object.keys(builders)) {
        if (!MM[id]) continue; const s = MM[id].x != null ? MM[id] : MOONBASE.DEF[id];
        try { const m = builders[id]({ lite }); decorateModule(id, m, lvl(id), { lite }); m.userData.local = s; g.add(m); } catch (e) { /* a module it cannot build here */ }
      }
      try { const R = buildRocket({ lite }); for (const k in R.parts) R.parts[k].visible = true; R.group.userData.local = { x: MOONBASE.LZ.x, z: MOONBASE.LZ.z, ry: 0.6 }; g.add(R.group); } catch (e) { /* */ }
    }
    return g;
  }
  function refreshSite() {
    if (siteBuilt && (!W || !W.site || siteBuilt.kind !== W.site.kind || siteBuilt.W !== W)) { siteGroup.remove(siteBuilt.g); siteBuilt = null; }
    if (!W || !W.site) return;
    const fr = siteFrame(), c = W.frame.id === fr.id ? { x: W.site.x, z: W.site.z, yaw: 0 } : transfer(fr, W.frame, W.site.x, W.site.z, 0);
    if (Math.hypot(c.x, c.z) > 4000) { siteGroup.visible = false; return; }
    if (!siteBuilt) { siteBuilt = { kind: W.site.kind, W, g: buildSite(W.site.kind) }; siteGroup.add(siteBuilt.g); }
    siteGroup.visible = true;
    // lay it out in this tile's frame (each piece stands on the ground here)
    const o = W.site.kind === 'earth' ? { x: GARDEN.cx, z: GARDEN.cz } : { x: 0, z: 0 };
    siteBuilt.g.position.set(0, 0, 0); siteBuilt.g.rotation.set(0, 0, 0);
    if (W.site.kind === 'earth') { const p0 = siteToFlat(0, 0, 0), pc = siteToFlat(o.x, o.z, 0); siteBuilt.g.position.set(p0.x, groundFn(pc.x, pc.z) - 0.02, p0.z); siteBuilt.g.rotation.y = p0.yaw; }
    else for (const m of siteBuilt.g.children) { const s = m.userData.local; if (!s) continue; const p = siteToFlat(s.x, s.z, 0); m.position.set(p.x, groundFn(p.x, p.z) - 0.05, p.z); m.rotation.y = (s.ry || 0) + p.yaw; }
    curveTree(siteGroup);
  }
  // walking back into the garden / the base: the hand-built world takes over at the same spot, no fade
  let siteSwitching = false;
  function siteCheck() {
    if (!W || !W.site || siteSwitching || piloting() || core.cinematic) return;
    const q = player.position, L = siteLocal(q.x, q.z, player.heading); if (!L) return;
    const S = SITE[W.site.kind];
    if (L.r < S.back + 60 && !siteSwitching && !sitePrepared) { sitePrepared = true; worlds.prepare && worlds.prepare(W.site.kind === 'earth' ? 'earth' : 'moon').catch(() => {}); }
    if (L.r < S.back) {
      siteSwitching = true;
      worlds.go(W.site.kind === 'earth' ? 'earth' : 'moon', { from: 'walk', x: L.x, z: L.z, yaw: L.yaw }).catch((e) => console.warn('[site] walk in', e)).finally(() => { siteSwitching = false; sitePrepared = false; });
    }
  }
  let sitePrepared = false;
  function siteClear(x, z) {
    // cheap reject: the site's spot in this tile's frame (cached per frame id)
    if (!siteClear.c || siteClear.c.id !== W.frame.id || siteClear.c.W !== W) { const fr = siteFrame(); const c = W.frame.id === fr.id ? { x: W.site.x, z: W.site.z } : transfer(fr, W.frame, W.site.x, W.site.z, 0); siteClear.c = { id: W.frame.id, W, x: c.x, z: c.z }; }
    const R0 = W.site.kind === 'earth' ? GARDEN.flat : MOONBASE.blend;
    return (x - siteClear.c.x) ** 2 + (z - siteClear.c.z) ** 2 < R0 * R0;
  }
  if (sb) sb.noDig = (x, z) => {
    if (!W || !W.site) return null; const L = siteLocal(x, z, 0); if (!L) return null;
    if (W.site.kind === 'earth' && L.r < GARDEN.out + 8) return 'The garden stays as it is: dig further out';
    if (W.site.kind === 'moon' && L.r < 70) return 'Not under the base';
    return null;
  };
  // ---------------- the pilot: free flight from the ground to orbit, across the system, down onto another world
  const pilot = createPilot({
    scene, camera, hud, player, core, lite, P,
    W: () => W, globe: () => globe, dim: () => W && W.dim, shipScale: () => activeShip().scale,
    ship: () => ensureShip(), shipAt: () => shipAt, ground: (x, z) => groundFn(x, z),
    parkAt: (x, z, yaw) => parkAt(x, z, yaw),
    stepOut() {
      const a = ship.rotation.y, sc = activeShip().scale;
      player.teleport(shipAt.x + Math.sin(a + 1.6) * 4.5 * sc, shipAt.z + Math.cos(a + 1.6) * 4.5 * sc, a); player.aim(a + 1.6 + Math.PI, -0.05); player.snapCamera();
      hud.showMap(true); floraCenter = null; animT = 9;
    },
    // flying close to another world: make it the loaded one (no synchronous terrain: it streams under the ship)
    loadBody(b) {
      const a = b.arg, nav = G.universe.nav; let dimKey = W ? W.dimKey : 'prime', eraK = 'present';
      if (W && loadedSig === a.addr) return;
      // the course she set on the nav map can carry an era (Chronometer, 6 propellant) and a dimension (the ship's)
      if (nav && nav.addr === a.addr) {
        if (nav.dim && activeShip().dims.includes(nav.dim)) dimKey = nav.dim;
        if (nav.era && nav.era !== 'present' && shipStats().chrono) { const F = fuelState(); if (F.fuel >= 6) { F.fuel -= 6; eraK = nav.era; hud.toast('The Chronometer hums: arriving in another era.', 'star', 4200); } else hud.toast('Not enough propellant for the era shift (6): arriving in the present.', 'star', 4200); }
      }
      const pk = `${a.star}:${a.index}:${dimKey}` + (eraK !== 'present' ? `:${eraK}` : '');
      era = eraK; travelArg = { seed: a.seed, star: a.star, index: a.index, addr: a.addr, dim: dimKey, era: eraK }; loadedSig = a.addr;
      const tb = bodyForTravel({ addr: a.addr });
      loadPlanet(a.seed, dimKey, pk, { body: tb.body, star: tb.star, light: true });
    },
    rebase: (id) => rebase(id),
    prefetch: (x, z) => prefetch(x, z, lite ? 1 : 2),
    setSunDir(d) { sunDir.copy(d); },
    refuel: () => loadPropellant(),
    openNav: () => openMap(),
    beacons: () => beaconList().map((b) => ({ ...b, here: b.world === 'planet' && b.addr === travelArg.addr })),
    fastCost: () => FAST_COST,
    fastTravel: (b) => fastTravel(b), ground: (x, z) => groundFn(x, z), height: (x, z) => W.height(x, z),
    // the escape pod (pulled by hand, or fired by itself when the ship is destroyed): see launchPod
    launchPod: (why) => launchPod(why),
    onDestroyed: (why) => launchPod(why || 'broke'),
    onLanded() {
      const pj = planetEntry(); if (!pj.landed) { pj.landed = Date.now(); pj.visits = (pj.visits || 0) + 1; game.save(); unlockDims(); }
    },
  });
  interact.add({ id: 'ship', at: () => ({ x: shipAt.x, y: shipAt.y - 1, z: shipAt.z }), r: 4.5, priority: 0.3, enabled: () => !!ship && ship.visible && !piloting(),
    actions: () => {
      const a = [{ label: `Take the helm of the ${activeShip().name}`, icon: 'map', run: async () => { if (!pilot.focus) { hud.toast('This world is on the old star map: set a course to it on the new map to fly from here.', 'star', 5200); return; } pilot.board(); } }];
      if (fuelState().wrecked) a[0].label = 'Assemble a new hull from the rebuild kit';
      if (hasBeaconItem()) a.push({ label: 'Plant a beacon beside the ship', icon: 'star', run: async () => { plantHere(); } });
      if (!fuelState().wrecked) {
        a.push({ label: 'Stow materials and samples in the hold', icon: 'crystal', run: async () => { const n = stowAll(); hud.toast(n ? `Stowed ${n} in the hold (${holdCount()} aboard). It stays with the ship.` : 'Nothing to stow: materials and samples go in the hold.', 'star', 3600); } });
        if (holdCount()) a.push({ label: `Take everything from the hold (${holdCount()})`, icon: 'crystal', run: async () => { const n = takeAll(); hud.toast(`Took ${n} from the hold.`, 'star', 2600); } });
      }
      return a;
    } });
  // ---------------- the escape pod, the wreck it leaves, and whether her ship is here at all
  async function launchPod(why = null) {
    if (!why && !podFitted()) return;
    const lost = why === 'star' || why === 'giant' || why === 'broke';
    // where the ship ends up: below the pilot (flying or landed), or right where it stands if she bailed from outside
    const spot = pilot.active && pilot.wreckSpot ? pilot.wreckSpot() : ship && ship.visible ? { ground: true, x: shipAt.x, z: shipAt.z, yaw: 0 } : null;
    const pod = usePod();
    const at = !lost && spot && spot.ground ? { addr: travelArg.addr || null, dim: W.dimKey, era, tile: W.frame.id, x: +spot.x.toFixed(2), z: +spot.z.toFixed(2), yaw: +spot.yaw.toFixed(3) } : null;
    const w = wreckShip({ at, space: !lost && !at && spot ? spot.space : null, why: why || 'pod', lost });
    pilot.abort(); G.universe.flight = null; G.universe.parked = null; game.save();
    await hud.fadeTo(1, 900);
    const where = lost ? (why === 'star' ? 'burned up in the star' : why === 'giant' ? 'was crushed in the giant' : 'broke apart') + ', hold and all' : at ? `is a wreck where it came down on ${planetEntry().name}, hold and tank aboard` : 'is adrift where you left it, hold and tank aboard';
    hud.toast(`${pod ? 'The escape pod' : 'With no pod fitted, the emergency capsule'} brought you home to your home beacon with everything you carried. The ship ${where}. ${w ? 'Repair it where it lies with a rebuild kit, or salvage it from another ship. ' : ''}A rebuild kit (workbench) also builds a new hull at home; a spare pod is crafted at the workbench.`, 'star', 11000);
    worlds.go('earth', { from: 'beacon', beacon: homeBeacon() });
  }
  let wreckModel = null; const wreckAt = new THREE.Vector3();
  function wreckHere() {
    const w = wreck(), a = w && w.at; if (!a || !W) return null;
    if ((a.addr || null) !== (travelArg.addr || null) || a.dim !== W.dimKey || (a.era || 'present') !== era) return null;
    return (a.tile || W.spawnTile) === W.frame.id ? a : transfer(makeFrame(W.radius, a.tile || W.spawnTile), W.frame, a.x, a.z, a.yaw || 0);
  }
  function refreshWreck() {
    const t = wreckHere();
    if (!t) { if (wreckModel) { scene.remove(wreckModel); wreckModel = null; colliders.remove('wreck'); } return; }
    const w = wreck(), S = shipById(w.ship);
    if (!wreckModel) {
      wreckModel = buildShip({ scale: S.scale, accent: '#4a4038', guide: false, lite });
      wreckModel.traverse((o) => { if (o.isMesh && o.material && o.material.color) { o.material = o.material.clone(); o.material.color.multiplyScalar(0.45); if (o.material.emissive) o.material.emissive.setScalar(0); } });
      scene.add(wreckModel);
    }
    wreckAt.set(t.x, groundFn(t.x, t.z) + 0.9 * S.scale, t.z);
    wreckModel.position.copy(wreckAt); wreckModel.rotation.set(0.12, t.yaw || 0, 0.32);
    colliders.remove('wreck'); colliders.circle(t.x, t.z, 2.4 * S.scale, { h: 3, name: 'wreck' });
  }
  interact.add({ id: 'wreck', at: () => ({ x: wreckAt.x, y: wreckAt.y - 0.5, z: wreckAt.z }), r: 5, priority: 0.35, enabled: () => !!wreckModel && !piloting(),
    actions: () => {
      const w = wreck(); if (!w) return [];
      const n = Object.values(w.hold || {}).reduce((x, y) => x + y, 0), what = `${n} in the hold, ${(+w.fuel || 0).toFixed(1)} propellant in the tank`;
      if (fuelState().wrecked) {
        if (game.count('shipkit') > 0) return [{ label: `Repair your ${w.name} with the rebuild kit (${what})`, icon: 'star', run: async () => { if (repairWreck()) { const t = wreckHere(); scene.remove(wreckModel); wreckModel = null; colliders.remove('wreck'); parkAt(t.x, t.z, t.yaw || 0); shipPresence(true); hud.toast('Patched and flying again, hold and tank as you left them.', 'star', 4200); } } }];
        return [{ label: `The wreck of your ${w.name} (${what})`, icon: 'star', run: async () => hud.toast('Build a ship rebuild kit at a workbench (6 metal, 4 crystal, 2 ore) to repair it here.', 'star', 4200) }];
      }
      return [{ label: `Salvage the wreck (${what})`, icon: 'crystal', run: async () => { const r = salvageWreck(); if (!r) return; scene.remove(wreckModel); wreckModel = null; colliders.remove('wreck'); hud.toast(`Moved ${r.items} into your hold and ${r.fuel.toFixed(1)} propellant into the tank.`, 'star', 4200); } }];
    } });
  // a wrecked ship is not here (it lies where it came down); at home a rebuild kit lets her assemble a new hull
  function shipPresence(force = false) {
    if (!ship) return;
    const want = piloting() || !fuelState().wrecked || (!!W && !!W.site && W.site.kind === 'earth' && game.count('shipkit') > 0);
    if (!force && ship.visible === want) return;
    ship.visible = want;
    if (want) { colliders.remove('ship'); colliders.circle(shipAt.x, shipAt.z, 2.6 * activeShip().scale, { h: 3, name: 'ship' }); } else colliders.remove('ship');
  }
  // in space the scene is laid out around the ship: everything standing on the ground hides
  let groundHidden = false, hiddenList = [];
  function hideGround(on) {
    if (on === groundHidden) return; groundHidden = on;
    if (on) { hiddenList = scene.children.filter((o) => o.visible && o !== sky && o !== ship && o.name !== 'space' && !o.isLight && (!globe || o !== globe.mesh)); for (const o of hiddenList) o.visible = false; }
    else { for (const o of hiddenList) o.visible = true; hiddenList = []; }
  }

  // ---------------- travel
  // the star map is navigation only: it sets a course; the ship flies it
  function openMap(o = {}) { return openStarMap({ current: 'planet', nav: true, here: travelArg.addr || null, onClose: o.onClose || null }); }
  function unlockDims() {
    const n = Object.keys(G.journal.planets).length;
    const steps = [[1, 'amber'], [2, 'tidal'], [3, 'velvet']];
    for (const [k, d] of steps) if (n >= k && !game.unlocked('dim:' + d)) { game.unlock('dim:' + d); setTimeout(() => hud.toast(`A new dimension on the star map: ${DIMENSIONS[d].name} (${DIMENSIONS[d].hint})`, 'map', 5200), 4200); }
  }

  // ---------------- frame
  let clock = 0, frameN = 0, spotT = 0, animT = 0, sunBase = 2.6;
  const shadowAt = new THREE.Vector3(); let shadowT = 1;
  let darkK = 0, sunK = 1;
  function frame(dt) {
    if ((frameN & 31) === 0) shipPresence();
    clock += dt; frameN++; shoreU.uShoreT.value = clock;
    renderer.toneMappingExposure = 1.0;
    core.update(dt);
    { // weather only where there is air around the camera: none in space, thinning out on the climb (and none on airless worlds)
      const fl = piloting(), st = pilot.state, P0 = W && W.rules && W.rules.atmosphere ? W.rules.atmosphere.pressureKPa || 0 : 0;
      const rel = P0 <= 0 ? 0 : !fl ? 1 : pilot.space || !st || !st.dom || !(st.dom.rho0 > 0) ? 0 : st.rho / st.dom.rho0;
      if (sb && sb.sim) sb.sim.weather.precip = precipK(rel);
    }
    if (sb) sb.update(dt);
    const flying = piloting(), inSpace = flying && pilot.space;
    // terrain, flora and animals stream around the ship while she flies, around her when she walks
    const p = flying ? pilot.focusPoint() : player.position;
    if (!inSpace) streamChunks(p.x, p.z, T.build);
    if (!core.cinematic) prefetch(p.x, p.z, lite ? 1 : 2);
    rebaseT += dt; if (rebaseT > 0.25 && !core.cinematic) { rebaseT = 0; const id = shouldRebase(W.frame, p.x, p.z); if (id) rebase(id); }
    if (exposure && !flying) exposure.tick(dt);
    if (!flying && frameN % 6 === 0) siteCheck();
    if (frameN % 60 === 30) curveTree(scene); // late-made meshes (trees grown on the fly, the ship, props) get the horizon drop too
    const pcx = Math.floor(p.x / T.CH), pcz = Math.floor(p.z / T.CH);
    if (!flora.length && W && floraReady()) { setupFlora(); if (ship && !shipParked && !flying) parkShip(parkFace); }
    scaleQuality(dt);
    if (!inSpace && (!floraCenter || floraCenter.cx !== pcx || floraCenter.cz !== pcz || Math.hypot(p.x - floraCenter.x, p.z - floraCenter.z) > 24)) rebuildFlora(p.x, p.z);
    animT += dt; if (!flying && (animT > 1.5 || (!animals.length && animT > 0.2))) { animT = 0; spawnAnimals(p.x, p.z); }
    // herds: centre + any member bolting (so the fright spreads)
    herds.clear();
    for (const a of animals) { let h = herds.get(a.herd); if (!h) herds.set(a.herd, (h = { x: 0, z: 0, n: 0, flee: null })); h.x += a.root.position.x; h.z += a.root.position.z; h.n++; if (a.state === 'flee' && a.timer > 2.5 && !h.flee) { const l = Math.hypot(a.tx - a.root.position.x, a.tz - a.root.position.z) || 1; h.flee = { x: a.root.position.x, z: a.root.position.z, dx: (a.tx - a.root.position.x) / l, dz: (a.tz - a.root.position.z) / l }; } }
    for (const h of herds.values()) { h.x /= h.n; h.z /= h.n; }
    stillT = player.speed < 0.15 ? stillT + dt : 0;
    const hr = new Date().getHours() + new Date().getMinutes() / 60, night = params.has('night') ? 1 : hr >= 21 || hr < 5.5 ? 1 : hr >= 19.5 ? (hr - 19.5) / 1.5 : hr < 7 ? (7 - hr) / 1.5 : 0;
    if (!inSpace) {
      const ctx = { player: player.position, playerSpeed: player.speed, stillT, night, herd: (a) => herds.get(a.herd), height: groundFn, walkable, lite, audio, danger: sb && sb.sim ? sb.sim.danger : null, water: sb && sb.sim ? sb.sim.waterNear : null };
      for (const a of animals) stepCreature(a, dt, clock, ctx);
      if (!flying) observe(dt);
      life.update(dt, { night, animals, camera: camera.position, removeAnimal: (a) => { a._dead = true; } });
      for (let i = animals.length - 1; i >= 0; i--) if (animals[i]._dead) { dropAnimal(animals[i]); animals.splice(i, 1); }
    }
    // the journal: who is close enough to meet
    spotT += dt;
    if (spotT > 0.4 && !flying) {
      spotT = 0;
      const L = lists.get(pcx + ',' + pcz);
      if (L) for (const it of L) if (Math.abs(it[1] - p.x) < 3.2 && Math.abs(it[3] - p.z) < 3.2) spot('flora', flora[it[0]]);
    }
    if (ship && !flying) { ship.position.y = shipAt.y + Math.sin(clock * 0.7) * 0.18; ship.userData.ring.rotation.z = clock * 0.4; }
    if (player.character && player.character.group) player.character.group.visible = !flying;
    for (const s of samples.values()) { s.m.rotation.y += dt; const tw = Math.exp(-((((clock + s.phase) % 4) - 0.3) ** 2) / 0.03); s.sp.material.opacity = 0.35 + tw; s.m.position.y = 0.35 + Math.sin(clock * 1.5 + s.phase) * 0.06; }
    core.updateCamera(dt);
    // the pilot lays out the camera, the ship, the star, the other worlds and the stars (also on foot)
    pilot.update(dt, darkK);
    hideGround(inSpace && pilot.space);
    sky.position.copy(camera.position);
    // ground to orbit: the globe fades in with height and the haze thins out into space; night by the sun
    { const ca = flying ? pilot.camAlt() : null;
      const alt = Math.max(0, ca != null ? ca : camera.position.y - groundFn(camera.position.x, camera.position.z)), k = Math.min(1, Math.max(0, (alt - 250) / 900));
      if (globe) globe.setFade(k);
      const sunY = groundHidden ? 1 : sunDir.y, dayK = Math.max(0, Math.min(1, (sunY + 0.1) / 0.25));
      const kk = Math.min(1, alt / (W.radius * 0.35)), nk = Math.max(kk, (1 - dayK) * 0.94); darkK = W.sky.haze < 0.02 ? 1 : nk; // airless: stars and the sun's disc by day
      skyU.uZen.value.copy(skyBase.zen).lerp(BLACK, nk); skyU.uHor.value.copy(skyBase.hor).lerp(BLACK, Math.max(kk * 0.92, (1 - dayK) * 0.85)); skyU.uGnd.value.copy(skyBase.gnd).lerp(BLACK, nk);
      if (!groundHidden) { water.visible = W.hasSea && k < 0.5; for (const c of chunks.values()) c.mesh.visible = k < 0.98; }
      if (scene.fog) scene.fog.density = groundHidden ? 0 : (1.7 / (T.R * T.CH)) * W.sky.haze * (1 - Math.min(1, alt / 1500)) + 0.00001;
      const far = groundHidden ? 4e5 : alt > 200 ? Math.max(2800, alt * 3 + W.radius * 2.2) : flying ? 6000 : 2800; if (Math.abs(camera.far - far) > 50) { camera.far = far; camera.updateProjectionMatrix(); }
      sunK = dayK; }
    if (W.hasSea) { water.position.x = Math.round(camera.position.x / 32) * 32; water.position.z = Math.round(camera.position.z / 32) * 32; waterNormal.offset.set((clock * 0.004) % 1, (clock * 0.003) % 1); }
    const texel = 90 / sun.shadow.mapSize.x, sp = flying ? camera.position : player.position;
    shadowAt.set(Math.round(sp.x / texel) * texel, Math.round(sp.y / texel) * texel, Math.round(sp.z / texel) * texel);
    sun.position.copy(shadowAt).addScaledVector(sunDir, 150); sun.target.position.copy(shadowAt);
    // shadow map at most 30x a second (was every 2nd frame: 120x a second at 240 fps), sooner only if she moved a texel
    shadowT += dt;
    if (T.shadows && shadowT >= 1 / 30) { shadowT = 0; renderer.shadowMap.needsUpdate = true; }
    { const cl = sb && sb.sim ? sb.sim.weather.cloud : 0; sun.intensity = sunBase * (1 - 0.6 * cl) * (0.08 + 0.92 * sunK); hemi.intensity = 0.45 * (1 - 0.25 * cl) * (0.25 + 0.75 * sunK); }
    const q = player.position;
    const biome = W ? W.dominant(W.biomesAt(q.x, q.z, q.y)) : 'forest';
    const nearSea = W && W.hasSea && !flying ? Math.max(0, 1 - Math.max(0, q.y - (W.sea || 0)) / 6) : 0;
    const zone = biome === 'forest' ? 'forest' : 'open';
    audio.update(dt, {
      world: 'planet', biome, zone, camera, speed: flying ? 0 : player.speed || 0, altitude: flying ? (pilot.camAlt() || 0) : camera.position.y,
      night, rain: sb && sb.sim && !inSpace ? sb.sim.weather.rain : 0, mist: 0, nearWater: nearSea, ...audioMedium(flying, inSpace, night),
    });
    renderer.render(scene, camera);
  }
  // what carries sound here (audio-medium.js): the world's surface pressure, thinning with height on ascent; the
  // ship's hull hum and engine are carried by the frame, so they play in vacuum too
  const LIVE = /forest|meadow|grass|savanna|steppe|jungle|garden|marsh|swamp|wood/;
  function audioMedium(flying, inSpace, night) {
    const R = W && W.rules, A = (R && R.atmosphere) || {}, T = (R && R.temperature) || {}, P0 = A.pressureKPa || 0, st = pilot.state;
    let pk = P0;
    if (inSpace) pk = 0;
    else if (flying && st && st.dom) pk = st.dom.rho0 > 0 ? P0 * Math.min(1, st.rho / st.dom.rho0) : 0;
    return {
      air: P0 > 0 ? pk / 101.325 : 0, life: (R && R.biology && R.biology.animals) || 0,
      tempC: (T.meanC ?? 15) + (T.swingC || 8) * (0.25 - 0.5 * night),
      grassAt: (x, z) => !!W && LIVE.test(W.dominant(W.biomesAt(x, z, groundFn(x, z)))), height: (x, z) => groundFn(x, z),
      ship: flying ? 1 : 0, thrust: flying && st ? Math.min(1, (st.thrustA || 0) / 20) : 0,
    };
  }
  function resize(w, h) { camera.aspect = w / h; camera.fov = fpFov(w, h); camera.updateProjectionMatrix(); }
  resize(engine.width, engine.height);

  // no free trip home: from inside the ship she can jump to a beacon she planted at the garden; otherwise fly
  async function goHome() {
    if (pilot.active) { const gb = beaconList().find((b) => b.world === 'earth'); if (gb) return fastTravel(gb); }
    hud.toast(beaconList().some((b) => b.world === 'earth') ? 'Board the ship to jump to your garden beacon.' : 'Home is a flight away: board the ship and set course for Earth on the nav map. A beacon planted at the garden lets you jump back from the ship.', 'star', 6500);
  }
  return {
    id: 'planet', scene, camera, resize, frame, input: core.input, goHome,
    mapData: () => ({ name: (planetEntry() || {}).name || 'A far world', key: PK, extent: { cx: player.position.x, cz: player.position.z, r: 140 }, height: W.height, sea: W.hasSea ? W.sea : null, items: interact.items(), player: { x: player.position.x, z: player.position.z, yaw: player.heading } }),
    qualityCap(c) { qCap = c; if (quality > c) { quality = c; floraCenter = null; } },
    applyQuality(Q) {
      if (params.has('q')) return;
      governed = true; const q = Math.min(1.25, Q.lod, qCap); // the governor works under the user's view-distance cap
      if (Math.abs(q - quality) > 0.02) { quality = q; floraCenter = null; }
      if (T.shadows) { const sm = Math.max(512, Math.min(4096, Math.round(2048 * (Q.shadow >= 1 ? 1 : 0.5) * (engine.userShadowK || 1)))); if (sun.shadow.mapSize.x !== sm) { sun.shadow.mapSize.set(sm, sm); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } } }
    },
    onContextRestored() { if (W) bakeEnv(); impostors.forEach((I) => I && I.rebake && I.rebake()); renderer.shadowMap.needsUpdate = true; },
    // auto-save: where she stands, so a reload puts her back on this world
    where() { if (W && pilot.active && pilot.focus && !pilot.warping) { const [star, index] = String(PK).split(':'); return { world: 'planet', seed: W.seed, dim: W.dimKey, star: +star, index: +index, era, addr: travelArg.addr || null, flight: G.universe.flight }; }
      if (!W || core.cinematic) return null; const q = player.position; const [star, index] = String(PK).split(':'); return { world: 'planet', seed: W.seed, dim: W.dimKey, star: +star, index: +index, era, addr: travelArg.addr || null, tile: W.tile === W.spawnTile ? null : W.tile, x: +q.x.toFixed(2), z: +q.z.toFixed(2), yaw: +(player.cam.yaw - Math.PI).toFixed(3) }; },
    restoreWhere(w) { if (pilot.active) return; if (!w || !W || w.seed !== W.seed || w.dim !== W.dimKey || (w.era || 'present') !== era) return; const wt = w.tile || W.spawnTile; if (wt !== W.tile) { dropTerrain(); W.setFrame(makeFrame(W.radius, wt)); if (sb) sb.load(tileKey(), W); if (globe) globe.orient(W.frame); } if (!walkable(w.x, w.z)) return; /* no distance limit: any tile anywhere on the globe */ player.teleport(w.x, w.z, w.yaw || 0); player.snapCamera(); streamChunks(w.x, w.z, 4); },
    degrade() { return false; },
    debug: {
      get sim() { return sb && sb.sim; },
      sb, game, life,
      // tests: stand near a village / ruin / the busiest wild ground, looking at it
      lifeGoto(kind, ang = 0.6, dist = null) { const t = life.find(kind); if (!t) return null; const a = ang, d = dist != null ? dist : kind === 'eco' ? 0 : kind === 'ruin' ? 18 : 26; const x = t.x + Math.sin(a) * d, z = t.z + Math.cos(a) * d; player.teleport(x, z, Math.atan2(t.x - x, t.z - z)); player.snapCamera(); streamChunks(x, z, 999); rebuildFlora(x, z); camera.updateMatrixWorld(); for (const an of animals) dropAnimal(an); animals = []; spawnAnimals(x, z); for (let i = 0; i < 240; i++) life.update(0.1, { night: 0, animals, camera: camera.position, removeAnimal: (q) => { q._dead = true; } }); animals = animals.filter((q) => { if (q._dead) dropAnimal(q); return !q._dead; }); if (kind === 'eco' && animals.length) { let cx = 0, cz = 0; for (const an of animals) { cx += an.root.position.x; cz += an.root.position.z; } cx /= animals.length; cz /= animals.length; player.teleport(cx - 22, cz - 22, Math.atan2(22, 22)); player.snapCamera(); streamChunks(cx, cz, 999); rebuildFlora(cx - 22, cz - 22); for (const an of animals) { an.state = 'graze'; an.timer = 30; } } return { x, z, kind: t.tier || kind, name: t.name || t.place || null }; },
      core, player, interact, openMap, get W() { return W; }, get animals() { return animals; }, get samples() { return samples; }, flora: () => flora, floraIM: () => floraIM, species: () => species,
      info: () => { const q = player.position; const w = W.biomesAt(q.x, q.z, q.y); return { world: 'planet', device: P.cls, seed: W.seed, dim: W.dimKey, name: planetEntry().name, pos: [+q.x.toFixed(1), +q.y.toFixed(1), +q.z.toFixed(1)], biome: W.dominant(w), chunks: chunks.size, lods: [0, 1, 2].map((l) => [...chunks.values()].filter((c) => c.lod === l).length), flora: floraIM.reduce((s, F) => s + F.reduce((t, L) => t + L[0].count, 0), 0), creatures: animals.length, spotted: Object.values(G.journal.species).filter((v) => v.planet === PK).length, prompt: interact.current ? interact.current.id : null, gravity: +(W.gravity / 9.81).toFixed(2), tile: W.tile, radius: W.radius, era, rules: W.rules && W.rules.summary(), totalCalls: renderer.info.render.calls, totalTris: renderer.info.render.triangles, fps: Math.round(engine.fps) }; },
      // perf: estimated triangles per object (main pass; shadow casters counted again as shadow:)
      observeNow() { const a = animals[0]; if (a) { a.obsT = 9; noteFauna(a); } return G.journal.species; },
      setQuality(q) { quality = q; floraCenter = null; }, floraStats: () => floraStats, get shipAt() { return shipAt; },
      tris() { const o = {}; let main = 0, shadow = 0; scene.traverseVisible((m) => { if (!m.isMesh) return; const g = m.geometry; const t = (g.index ? g.index.count : g.attributes.position.count) / 3 * (m.isInstancedMesh ? m.count : g.isInstancedBufferGeometry ? g.instanceCount : 1); const k = m.name || m.parent?.name || 'mesh'; o[k] = (o[k] || 0) + t; main += t; if (m.castShadow && T.shadows) shadow += t; }); return { main: Math.round(main), shadow: Math.round(shadow), top: Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, v]) => k + '=' + Math.round(v / 1000) + 'k') }; },
      rebaseNow() { const q = player.position, id = shouldRebase(W.frame, q.x, q.z); const had = !!(pre && pre.id === id); if (id) rebase(id); return { id, tile: W.tile, pos: [+q.x.toFixed(1), +q.z.toFixed(1)], ms: lastRebaseMs, prefetched: had }; },
      get prefetch() { return pre && { id: pre.id, chunks: pre.chunks.size, lists: pre.lists.size, done: pre.done }; }, get lastRebaseMs() { return lastRebaseMs; },
      launchPod: (why) => launchPod(why), // tests: the escape pod without the pilot UI
      pilot, siteLocal: (x, z, y = 0) => siteLocal(x, z, y), siteToFlat: (x, z, y = 0) => siteToFlat(x, z, y), get globe() { return globe; },
      // tests: run the flight for a while without rendering (headless renders at ~2 fps)
      simFly(seconds, ctl = null, h = 0.05) { if (ctl) pilot.debug.ctl(ctl); const n = Math.round(seconds / h); for (let i = 0; i < n && pilot.active; i++) pilot.update(h, darkK); return pilot.debug.state(); }, camera, scene, get rules() { return W && W.rules; }, board: () => pilot.board(), beacons: beaconList, plant: plantHere, fastTravel: (b) => fastTravel(b), ground: (x, z) => groundFn(x, z), height: (x, z) => W.height(x, z),
      // tests: walk in a straight line quickly (streams chunks as she goes)
      async trek(dx, dz, steps = 10) { for (let i = 0; i < steps; i++) { player.teleport(player.position.x + dx / steps, player.position.z + dz / steps, Math.atan2(dx, dz)); streamChunks(player.position.x, player.position.z, 4); await new Promise((r) => setTimeout(r, 30)); } },
    },
    onEnter(arg = {}) {
      if (pilot.active) pilot.abort();
      const seed = arg.seed != null ? arg.seed : (params.has('seed') ? +params.get('seed') : 1);
      const dimKey = arg.dim || params.get('dim') || G.dim || 'prime';
      const star = arg.star != null ? arg.star : seed, index = arg.index != null ? arg.index : 0;
      const newEra = arg.era || params.get('era') || 'present';
      const pk = `${star}:${index}:${dimKey}` + (newEra !== 'present' ? `:${newEra}` : '');
      const tb = bodyForTravel({ ...arg, seed, star, index });
      travelArg = { ...arg, addr: tb.addr };
      const sig = tb.addr || `${star}:${index}`;
      if (!W || W.seed !== seed || W.dimKey !== dimKey || newEra !== era || sig !== loadedSig) { era = newEra; loadedSig = sig; loadPlanet(seed, dimKey, pk, { body: tb.body, star: tb.star }); }
      PK = pk;
      // the solar system around this world (worlds from the old star map have none: they can't be flown from)
      const A = tb.addr ? parseAddr(tb.addr) : null;
      pilot.attach(A ? { g: A.g, s: A.s, star: A.star } : null, tb.addr || null);
      setCurveRadius(W.radius); setCurrentRules(W.rules, { world: 'planet', pk, era, W });
      const bk = arg.beacon || null, fl = arg.flight || null, walk = arg.from === 'walk' && arg.site && W.site ? arg : null;
      const wantTile = bk ? (bk.tile || W.spawnTile) : walk ? W.site.tile : W.spawnTile;
      if (W.tile !== wantTile) { dropTerrain(); W.setFrame(makeFrame(W.radius, wantTile)); if (sb) sb.load(tileKey(), W); if (globe) globe.orient(W.frame); refreshBeacons(); }
      core.activate(); hud.showMap(true);
      if (fl && pilot.focus && pilot.restore(fl)) {
        // resumed mid-flight: the terrain streams in under the ship
        hud.fadeTo(0, 900);
      } else if (walk) {
        // walked out of the garden / the base: same spot, same heading, no fade
        const p = siteToFlat(walk.x, walk.z, walk.yaw || 0);
        player.teleport(p.x, p.z, p.yaw); player.snapCamera();
        let n = 0; while (streamChunks(p.x, p.z, 999) > 0 && n++ < 3);
        floraCenter = null; refreshSite();
        const pk0 = G.universe.parked;
        if (pk0 && pk0.addr === travelArg.addr && pk0.dim === W.dimKey && (pk0.era || 'present') === era && !walk.board) {
          const t = (pk0.tile || W.spawnTile) === W.frame.id ? pk0 : transfer(makeFrame(W.radius, pk0.tile || W.spawnTile), W.frame, pk0.x, pk0.z, pk0.yaw || 0);
          parkAt(t.x, t.z, t.yaw || 0);
        } else if (walk.board) { parkAt(p.x + Math.sin(p.yaw + 1.6) * 7, p.z + Math.cos(p.yaw + 1.6) * 7, p.yaw); if (pilot.focus) pilot.board(); }
        else { const L = siteLocal(p.x, p.z, 0), o = siteOutside(Math.atan2(L.x - (W.site.kind === 'earth' ? GARDEN.cx : 0), L.z - (W.site.kind === 'earth' ? GARDEN.cz : 0)) + 0.25, W.site.kind === 'earth' ? 24 : 70); parkAt(o.x, o.z, o.yaw); }
        hud.fadeTo(0, 1);
      } else if (bk) {
        // a beacon jump lands her in the ship, parked beside the beacon she planted
        const sc = activeShip().scale; parkAt(bk.x + 6 * sc * 0.7, bk.z + 6 * sc * 0.7, 0);
        player.teleport(shipAt.x + 4 * sc, shipAt.z, 0); player.snapCamera();
        let n = 0; while (streamChunks(shipAt.x, shipAt.z, 999) > 0 && n++ < 3);
        if (pilot.focus) pilot.board();
        hud.fadeTo(0, 700);
      } else {
        // face the most open view: downhill, toward the longest sightline
        // home Earth / Moon: the spawn is the garden / base itself, which lives in its own world; arrive just outside it
        const s0 = W.site ? siteOutside(0.4, W.site.kind === 'earth' ? 30 : 80) : W.spawn; let bestA = 0, bestH = Infinity;
        for (let i = 0; i < 16; i++) { const an = (i / 16) * Math.PI * 2; let hs = 0; for (const d of [15, 35, 60]) hs += W.height(s0.x + Math.sin(an) * d, s0.z + Math.cos(an) * d); if (hs < bestH) { bestH = hs; bestA = an; } }
        player.teleport(s0.x, s0.z, bestA); player.snapCamera();
        let n = 0; while (streamChunks(s0.x, s0.z, 999) > 0 && n++ < 3);
        parkShip(bestA);
        hud.fadeTo(0, 1400);
      }
      const pj = planetEntry(); if (!fl) { pj.visits = (pj.visits || 0) + 1; pj.landed = pj.landed || Date.now(); } game.save();
      unlockDims();
      setTimeout(() => hud.toast(`${pj.name} · ${era === 'present' ? '' : W.rules.eraName + ' · '}${W.rules.summary()}`, 'star', 6500), 900);
      if (!W.rules.survival.breathable && !fl) setTimeout(() => hud.toast(`Air: ${W.rules.survival.reasons.join(', ')}. Stay near the ship unless you are suited.`, 'star', 6000), 7800);
      void UNLOCK_ALL; void BIOMES;
    },
    // get the spot she is walking toward ready while she is still in the garden / at the base
    prepare(arg = {}) {
      const seed = arg.seed, dimKey = arg.dim || 'prime', star = arg.star, index = arg.index, pk = `${star}:${index}:${dimKey}`;
      const tb = bodyForTravel({ ...arg, seed, star, index }), sig = tb.addr || `${star}:${index}`;
      if (!W || W.seed !== seed || W.dimKey !== dimKey || era !== 'present' || sig !== loadedSig) { era = 'present'; loadedSig = sig; travelArg = { ...arg, addr: tb.addr }; loadPlanet(seed, dimKey, pk, { body: tb.body, star: tb.star, light: true }); }
      if (!W.site) return;
      if (W.tile !== W.site.tile) { dropTerrain(); W.setFrame(makeFrame(W.radius, W.site.tile)); if (sb) sb.load(tileKey(), W); refreshSite(); }
      const p = siteToFlat(arg.x != null ? arg.x : 0, arg.z != null ? arg.z : 0);
      // a few chunks at a time between frames, so the garden / base keeps running smoothly
      let n = 0; const tick = () => { if (worlds.currentId === 'planet' || n++ > 200) return; if (streamChunks(p.x, p.z, 2) > 0) setTimeout(tick, 16); else { rebuildFlora(p.x, p.z); } };
      tick();
    },
    onExit() { if (pilot.active) pilot.abort(); core.deactivate(); if (sb) sb.deactivate(); life.save(); },
  };
}
