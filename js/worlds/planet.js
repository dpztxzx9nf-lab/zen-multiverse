// World "planet": endless procedural worlds from a seed. Streaming terrain in chunks (load, unload,
// three LOD rings with skirts), blended biomes (salt flats, alien forest, crystal fields, ocean
// shores, ice), instanced flora, gentle creatures, samples to collect, and a journal where she names
// what she finds. A dimension changes the palette, the weight of things and the creatures' style.
//   ?world=planet&seed=123[&dim=amber]
import * as THREE from 'three';
import { fpFov } from '../game/player.js';
import { createWalkCore } from '../game/walkcore.js';
import { makePlanet, BIOMES, BIOME_NAMES } from '../game/planetgen.js';
import { makeFlora } from '../game/flora.js';
import { makeSpecies, buildCreature, stepCreature } from '../game/creatures.js';
import { rng, hash, DIMENSIONS } from '../game/names.js';
import { game, UNLOCK_ALL } from '../game/store.js';
import { openStarMap } from '../game/starmap.js';
import { icon } from '../game/icons.js';
import { createColliders } from '../colliders.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export async function createPlanet({ renderer, canvas, P, params, engine, worlds, audio }) {
  const lite = P.cls !== 'pc';
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
  const pmrem = new THREE.PMREMGenerator(renderer);
  let envRT = null;
  function bakeEnv() {
    const s2 = new THREE.Scene(); const m = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), skyMat); s2.add(m);
    if (envRT) envRT.dispose();
    envRT = pmrem.fromScene(s2, 0, 0.1, 500); scene.environment = envRT.texture; scene.environmentIntensity = 0.3;
  }
  // ---- water: one plane at sea level that follows her, with a scrolling normal map
  const waterNormal = (() => {
    const N = 128, d = new Uint8Array(N * N * 4), r = rng(3), h = new Float32Array(N * N);
    for (let k = 0; k < 6; k++) { const fx = 1 + Math.floor(r() * 5), fz = 1 + Math.floor(r() * 5), ph = r() * 6.28, a = 1 / (k + 1); for (let i = 0; i < N * N; i++) { const x = i % N, z = Math.floor(i / N); h[i] += Math.sin((x * fx + z * fz) / N * Math.PI * 2 + ph) * a; } }
    for (let i = 0; i < N * N; i++) { const x = i % N, z = Math.floor(i / N); const dx = h[z * N + ((x + 1) % N)] - h[z * N + ((x + N - 1) % N)], dz = h[((z + 1) % N) * N + x] - h[((z + N - 1) % N) * N + x]; const v = new THREE.Vector3(-dx * 0.6, 1, -dz * 0.6).normalize(); d[i * 4] = (v.x * 0.5 + 0.5) * 255; d[i * 4 + 1] = (v.z * 0.5 + 0.5) * 255; d[i * 4 + 2] = v.y * 255; d[i * 4 + 3] = 255; }
    const t = new THREE.DataTexture(d, N, N); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true; return t;
  })();
  const waterMat = new THREE.MeshStandardMaterial({ color: '#4a8', roughness: 0.06, metalness: 0.0, transparent: true, opacity: 0.86, normalMap: waterNormal, normalScale: new THREE.Vector2(0.35, 0.35) });
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
  const terrainMat = new THREE.MeshStandardMaterial({ vertexColors: true, map: grain, bumpMap: grain, bumpScale: lite ? 0.5 : 0.9, roughness: 0.92, metalness: 0, side: THREE.DoubleSide });

  // ---------------- the current planet
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
    const seg = T.segs[lod], CH = T.CH, step = CH / seg, w = seg + 1, B = seg + 3;
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
    for (let j = 0; j < seg; j++) for (let i = 0; i < seg; i++) { const a = j * w + i, b = a + 1, d = a + w, e = d + 1; idx.push(a, d, b, b, d, e); }
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
    return { mesh: m, lod, seg, h };
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
  function chunkList(cx, cz) {
    const key = cx + ',' + cz; let L = lists.get(key); if (L) return L;
    L = [];
    const CH = T.CH;
    for (const f of flora) {
      const r = rng(hash(W.seed, cx, cz, f.i, 5));
      const N = Math.round(f.density * (lite ? 0.6 : 1) * (W.dim.creature === 'many' ? 1.1 : 1));
      for (let k = 0; k < N; k++) {
        const x = cx * CH + r() * CH, z = cz * CH + r() * CH, y = W.height(x, z);
        if (W.hasSea && y < W.sea + 0.3 && f.biome !== 'shore') { r(); r(); r(); continue; }
        if (W.hasSea && y < W.sea - 0.2) { r(); r(); r(); continue; }
        const w = W.biomesAt(x, z, y), pw = f.biome === 'any' ? 0.35 : w[f.biome];
        const keep = r() < pw * pw * 1.6, ry = r() * 6.283, sc = f.scale[0] + r() * (f.scale[1] - f.scale[0]);
        if (!keep) continue;
        // keep the arrival spot clear
        if (x * x + z * z < 36) continue;
        L.push([f.i, x, y - 0.08, z, ry, sc]);
      }
    }
    lists.set(key, L);
    if (lists.size > 400) { const first = lists.keys().next().value; lists.delete(first); }
    return L;
  }
  const trunks = new Map(); // "gx,gz" (8 m cells) -> [[x, z, r]]
  colliders.shape((x, z) => {
    let best = 99; const gx = Math.floor(x / 8), gz = Math.floor(z / 8);
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const L = trunks.get((gx + i) + ',' + (gz + j)); if (!L) continue; for (const t of L) { const d = Math.hypot(x - t[0], z - t[1]) - t[2]; if (d < best) best = d; } }
    return best;
  }, { h: 6, kind: 'solid', name: 'trees' });
  let floraCenter = null;
  const fm = new THREE.Matrix4(), fq = new THREE.Quaternion(), fv = new THREE.Vector3(), fs = new THREE.Vector3(), yAxis = new THREE.Vector3(0, 1, 0);
  function rebuildFlora(px, pz) {
    const pcx = Math.floor(px / T.CH), pcz = Math.floor(pz / T.CH);
    const counts = floraIM.map(() => 0);
    trunks.clear();
    const Rr = Math.ceil(T.floraR);
    const activeSamples = new Set();
    for (let dz = -Rr; dz <= Rr; dz++) for (let dx = -Rr; dx <= Rr; dx++) {
      const cx = pcx + dx, cz = pcz + dz, d = chunkDist(cx, cz, px, pz);
      if (d > T.floraR) continue;
      const near = d < T.nearR + 0.5;
      for (const it of chunkList(cx, cz)) {
        const f = flora[it[0]], im = floraIM[it[0]];
        if (f.near && !near) continue;
        if (counts[it[0]] >= im.userData.cap) continue;
        fq.setFromAxisAngle(yAxis, it[4]); fv.set(it[1], it[2], it[3]); fs.setScalar(it[5]);
        fm.compose(fv, fq, fs); im.setMatrixAt(counts[it[0]]++, fm);
        if (f.trunkR && d < 1.6) { const key = Math.floor(it[1] / 8) + ',' + Math.floor(it[3] / 8); let L = trunks.get(key); if (!L) trunks.set(key, (L = [])); L.push([it[1], it[3], f.trunkR * it[5]]); }
      }
      if (d < 1.6) activeSamples.add(cx + ',' + cz);
    }
    floraIM.forEach((im, i) => { im.count = counts[i]; im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); });
    syncSamples(activeSamples);
    floraCenter = { cx: pcx, cz: pcz };
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
  function spawnAnimals(px, pz) {
    const want = Math.round(T.creatures * (W.dim.creature === 'many' ? 1.5 : 1));
    for (let i = animals.length - 1; i >= 0; i--) { const a = animals[i]; if (Math.hypot(a.root.position.x - px, a.root.position.z - pz) > 120) { scene.remove(a.root); animals.splice(i, 1); } }
    let tries = 0;
    while (animals.length < want && tries++ < 6) {
      const ang = Math.random() * 6.283, d = (animals.length < 3 ? 14 : 28) + Math.random() * 50, x = px + Math.cos(ang) * d, z = pz + Math.sin(ang) * d;
      if (!walkable(x, z)) continue;
      const b = W.dominant(W.biomesAt(x, z, W.height(x, z)));
      const cand = species.filter((s) => s.biomes.includes(b)); const S = (cand.length ? cand : species)[Math.floor(Math.random() * (cand.length || species.length))];
      const herd = Math.min(S.herd, want - animals.length);
      for (let k = 0; k < herd; k++) {
        const hx = x + (Math.random() - 0.5) * 6, hz = z + (Math.random() - 0.5) * 6;
        if (!walkable(hx, hz)) continue;
        const c = buildCreature(S);
        c.root.position.set(hx, W.height(hx, hz), hz); scene.add(c.root);
        animals.push({ S, root: c.root, parts: c.parts, heading: Math.random() * 6.28, state: 'graze', timer: Math.random() * 3, tx: hx, tz: hz, home: { x: hx, z: hz }, phase: Math.random() * 6, speedNow: 0, seed: Math.random() * 10 });
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
  function spot(kind, S) {
    const k = speciesKey(kind, S.i);
    if (G.journal.species[k]) return;
    G.journal.species[k] = { name: S.name, kind, label: kind === 'fauna' ? S.label : S.kind, planet: PK, first: Date.now() };
    game.save();
    hud.toast(`New ${kind === 'fauna' ? 'creature' : 'plant'} in the journal: ${S.name}`, kind === 'fauna' ? 'eye' : 'leaf', 3600);
  }
  extraTabs.push({ id: 'journal', label: 'Journal', icon: 'book', render: (b, rerender) => {
    const pj = planetEntry();
    const here = Object.entries(G.journal.species).filter(([, v]) => v.planet === PK);
    const allN = Object.keys(G.journal.species).length, worldsN = Object.keys(G.journal.planets).length;
    b.innerHTML = `<h3>This world</h3><div class="row"><span style="width:26px;height:26px;display:inline-flex">${icon('star')}</span><div class="grow"><input data-planet value="${esc(pj.name)}" maxlength="28" style="width:100%;font:inherit;padding:8px 10px;border-radius:10px;border:1px solid rgba(255,255,255,.25);background:rgba(255,255,255,.08);color:#fff"><div class="muted" style="font-size:13px;margin-top:4px">${DIMENSIONS[W.dimKey].name} dimension · gravity ${(W.gravity / 9.81).toFixed(2)} g · visit ${pj.visits}</div></div></div>` +
      `<h3>Met here (${here.length} of ${species.length + flora.length})</h3>` +
      (here.length ? here.map(([k, v]) => `<div class="row"><span style="width:26px;height:26px;display:inline-flex">${icon(v.kind === 'fauna' ? 'eye' : 'leaf')}</span><div class="grow"><input data-sp="${esc(k)}" value="${esc(v.name)}" maxlength="28" style="width:100%;font:inherit;padding:6px 10px;border-radius:10px;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.06);color:#fff"><div class="muted" style="font-size:13px;margin-top:3px">${esc(v.label)}</div></div></div>`).join('') : '<p class="muted">Walk close to creatures and plants to add them here. Tap a name to rename it.</p>') +
      `<p class="muted" style="font-size:13px;margin-top:14px">${allN} species named across ${worldsN} world${worldsN === 1 ? '' : 's'}.</p>`;
    const inp = b.querySelector('[data-planet]');
    inp.addEventListener('change', () => { pj.name = inp.value.trim() || W.name; game.save(); hud.toast(`Named ${pj.name}`, 'star'); });
    b.querySelectorAll('[data-sp]').forEach((el) => el.addEventListener('change', () => { const e = G.journal.species[el.dataset.sp]; e.name = el.value.trim() || e.name; game.save(); }));
    for (const el of b.querySelectorAll('input')) { el.addEventListener('pointerdown', (e) => e.stopPropagation()); el.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.blur(); }); }
    void rerender;
  } });

  // ---------------- load a planet (seed + dimension)
  function clearPlanet() {
    for (const c of chunks.values()) { scene.remove(c.mesh); c.mesh.geometry.dispose(); }
    chunks.clear(); lists.clear(); trunks.clear();
    for (const im of floraIM) { scene.remove(im); im.geometry.dispose(); im.material.dispose(); im.dispose(); }
    floraIM = [];
    for (const a of animals) scene.remove(a.root); animals = [];
    for (const [key, s] of samples) { scene.remove(s.g); interact.remove('s-' + key); } samples.clear();
    for (const m of [...skyMoons.children]) skyMoons.remove(m);
  }
  function loadPlanet(seed, dimKey, pk) {
    clearPlanet();
    W = makePlanet(seed, dimKey); PK = pk;
    flora = makeFlora(W, { lite }); species = makeSpecies(W, { lite });
    floraIM = flora.map((f) => {
      const cap = Math.round((f.big ? 1400 : f.near ? 3500 : 2600) * T.cap);
      const im = new THREE.InstancedMesh(f.geo, f.mat, cap); im.count = 0; im.userData.cap = cap;
      im.castShadow = T.shadows && (f.big || f.kind === 'crystal' || f.kind === 'icespike' || f.kind === 'saltpillar'); im.receiveShadow = true;
      scene.add(im); return im;
    });
    // sky, light, fog from the planet
    const S = W.sky;
    sunDir.set(Math.cos(S.sunElev) * Math.sin(S.sunAz), Math.sin(S.sunElev), Math.cos(S.sunElev) * Math.cos(S.sunAz)).normalize();
    skyU.uZen.value.copy(S.zenith); skyU.uHor.value.copy(S.horizon); skyU.uGnd.value.copy(S.ground).lerp(S.horizon, 0.5); skyU.uSunCol.value.copy(S.sun);
    sun.color.copy(S.sun).lerp(new THREE.Color('#fff'), 0.5); sun.intensity = 1.7 + S.sunElev * 0.6;
    hemi.color.copy(S.horizon); hemi.groundColor.copy(S.ground);
    scene.fog = new THREE.FogExp2(S.horizon.clone(), 1.7 / (T.R * T.CH));
    bakeEnv();
    const mr = rng(hash(seed, 61));
    for (let i = 0; i < S.moons; i++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(60 + mr() * 90, 32, 24), new THREE.MeshStandardMaterial({ color: W.C(W.hue + mr(), 0.25, 0.7), roughness: 1, fog: false }));
      const a = S.sunAz + 1.2 + mr() * 3, e = 0.25 + mr() * 0.5; m.position.set(Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a)).multiplyScalar(2000); skyMoons.add(m);
    }
    water.visible = W.hasSea; water.position.y = W.sea; waterMat.color.copy(W.water.shallow);
    core.player.cam && 0;
    // gravity: the walking core reads it through the player options; swap the player's gravity here
    player.setGravity && player.setGravity(W.gravity);
    // first frame: terrain around the arrival spot, all at once
    let n = 0; while (streamChunks(0, 0, 999) > 0 && n++ < 3);
    rebuildFlora(0, 0);
    spawnAnimals(0, 0);
  }

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
    clock += dt; frameN++;
    renderer.toneMappingExposure = 1.0;
    core.update(dt);
    const p = player.position;
    streamChunks(p.x, p.z, T.build);
    const pcx = Math.floor(p.x / T.CH), pcz = Math.floor(p.z / T.CH);
    if (!floraCenter || floraCenter.cx !== pcx || floraCenter.cz !== pcz) rebuildFlora(p.x, p.z);
    animT += dt; if (animT > 1.5) { animT = 0; spawnAnimals(p.x, p.z); }
    const ctx = { player: p, playerSpeed: player.speed, height: groundFn, walkable };
    for (const a of animals) stepCreature(a, dt, clock, ctx);
    // the journal: who is close enough to meet
    spotT += dt;
    if (spotT > 0.4) {
      spotT = 0;
      for (const a of animals) if (Math.hypot(a.root.position.x - p.x, a.root.position.z - p.z) < 10 + a.S.size * 2) spot('fauna', a.S);
      const L = lists.get(pcx + ',' + pcz);
      if (L) for (const it of L) if (Math.abs(it[1] - p.x) < 3.2 && Math.abs(it[3] - p.z) < 3.2) spot('flora', flora[it[0]]);
    }
    for (const s of samples.values()) { s.m.rotation.y += dt; const tw = Math.exp(-((((clock + s.phase) % 4) - 0.3) ** 2) / 0.03); s.sp.material.opacity = 0.35 + tw; s.m.position.y = 0.35 + Math.sin(clock * 1.5 + s.phase) * 0.06; }
    core.updateCamera(dt);
    sky.position.copy(camera.position); skyMoons.position.copy(camera.position);
    if (W.hasSea) { water.position.x = Math.round(camera.position.x / 32) * 32; water.position.z = Math.round(camera.position.z / 32) * 32; waterNormal.offset.set((clock * 0.004) % 1, (clock * 0.003) % 1); }
    const texel = 90 / 2048;
    shadowAt.set(Math.round(p.x / texel) * texel, Math.round(p.y / texel) * texel, Math.round(p.z / texel) * texel);
    sun.position.copy(shadowAt).addScaledVector(sunDir, 150); sun.target.position.copy(shadowAt);
    if (T.shadows && frameN % 2 === 0) renderer.shadowMap.needsUpdate = true;
    renderer.render(scene, camera);
  }
  function resize(w, h) { camera.aspect = w / h; camera.fov = fpFov(w, h); camera.updateProjectionMatrix(); }
  resize(engine.width, engine.height);

  return {
    id: 'planet', scene, camera, resize, frame, input: core.input,
    degrade() { return false; },
    debug: {
      core, player, interact, openMap, get W() { return W; }, get animals() { return animals; }, get samples() { return samples; }, flora: () => flora, species: () => species,
      info: () => { const q = player.position; const w = W.biomesAt(q.x, q.z, q.y); return { world: 'planet', device: P.cls, seed: W.seed, dim: W.dimKey, name: planetEntry().name, pos: [+q.x.toFixed(1), +q.y.toFixed(1), +q.z.toFixed(1)], biome: W.dominant(w), chunks: chunks.size, lods: [0, 1, 2].map((l) => [...chunks.values()].filter((c) => c.lod === l).length), flora: floraIM.reduce((s, im) => s + im.count, 0), creatures: animals.length, spotted: Object.values(G.journal.species).filter((v) => v.planet === PK).length, prompt: interact.current ? interact.current.id : null, gravity: +(W.gravity / 9.81).toFixed(2), totalCalls: renderer.info.render.calls, totalTris: renderer.info.render.triangles, fps: Math.round(engine.fps) }; },
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
      core.activate(); hud.showMap(true);
      const pj = planetEntry(); pj.visits = (pj.visits || 0) + 1; game.save();
      unlockDims();
      hud.fadeTo(0, 1400);
      setTimeout(() => hud.toast(`${pj.name} · ${DIMENSIONS[dimKey].name} dimension`, 'star', 4200), 900);
      void UNLOCK_ALL; void BIOMES;
    },
    onExit() { core.deactivate(); },
  };
}
