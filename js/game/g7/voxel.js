// Diggable ground: 0.5 m voxels (material byte + fill byte, like Enshrouded) in 16 m chunks,
// meshed with surface nets in a worker. The far landscape stays the streaming heightfield; a 16 m
// column turns into voxels the first time it is dug or raised (the heightfield gets a hole there,
// and the voxel surface starts exactly where the heightfield was, so nothing pops).
// Underground has layers: topsoil by biome (soil, sand, snow), then stone with strata, metal ore
// veins and crystal pockets. Sand and snow pour: dig under them and they slump to a natural slope.
//   const vox = createVoxels({ scene, material, W, height, seed, lite, onHoles })
import * as THREE from 'three';
import { surfaceNets } from './surfacenets.js';
import { VS, MAT, MATS } from './materials.js';

export const CN = 32, CS = CN * VS, NP = CN + 3; // voxels per chunk side, chunk size (m), padded block
const ISO = 127.5;
const fl = Math.floor;
const h3 = (x, y, z, s) => { let h = (x * 374761393 + y * 668265263 + z * 2147483647 + s * 1442695041) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
function vnoise3(x, y, z, s) {
  const xi = fl(x), yi = fl(y), zi = fl(z), fx = x - xi, fy = y - yi, fz = z - zi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const L = (a, b, t) => a + (b - a) * t;
  return L(L(L(h3(xi, yi, zi, s), h3(xi + 1, yi, zi, s), u), L(h3(xi, yi + 1, zi, s), h3(xi + 1, yi + 1, zi, s), u), v),
    L(L(h3(xi, yi, zi + 1, s), h3(xi + 1, yi, zi + 1, s), u), L(h3(xi, yi + 1, zi + 1, s), h3(xi + 1, yi + 1, zi + 1, s), u), v), w);
}
const SOIL_BY_BIOME = { forest: MAT.SOIL, shore: MAT.SAND, salt: MAT.SAND, crystal: MAT.SOIL, ice: MAT.SNOW };

export function createVoxels({ scene, material, height, biome, groundColor, seed = 1, lite = false, onHoles = () => {}, onMesh = () => {}, uvScale = [1 / 3.5, 1 / 3.5] }) {
  const chunks = new Map();   // "cx,cy,cz" -> { fill, mat } (only chunks that differ from the base)
  const meshes = new Map();   // "cx,cy,cz" -> THREE.Mesh
  const active = new Set();   // "cx,cz" columns drawn as voxels
  const colCache = new Map();
  const dirty = new Set();
  const edited = new Set();   // chunk keys changed since the last save
  // ---- the untouched ground, deterministic from the planet
  function column(cx, cz) {
    const key = cx + ',' + cz; let c = colCache.get(key); if (c) return c;
    const n = NP + 1, h = new Float32Array(n * n), soil = new Uint8Array(n * n), top = new Float32Array(n * n);
    let mn = Infinity, mx = -Infinity;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = (cx * CN + i - 1) * VS, z = (cz * CN + j - 1) * VS, y = height(x, z), k = j * n + i;
      h[k] = y; mn = Math.min(mn, y); mx = Math.max(mx, y);
      soil[k] = SOIL_BY_BIOME[biome(x, z, y)] || MAT.SOIL;
      top[k] = 0.7 + vnoise3(x * 0.15, 0, z * 0.15, seed + 7) * 0.9;
    }
    c = { h, soil, top, mn, mx, n };
    colCache.set(key, c); if (colCache.size > 300) colCache.delete(colCache.keys().next().value);
    return c;
  }
  function baseMat(x, y, z, depth, soil, topD) {
    if (depth < topD) return soil;
    if (depth > 2.2) {
      if (vnoise3(x * 0.22, y * 0.3, z * 0.22, seed + 11) > 0.78) return MAT.ORE;
      if (vnoise3(x * 0.13, y * 0.13, z * 0.13, seed + 23) > 0.86) return MAT.CRYSTAL;
    }
    if (soil === MAT.SNOW && depth < topD + 1.2) return MAT.ICE;
    return MAT.STONE;
  }
  // fill one chunk-sized (or padded) block of base samples starting at global sample (gx0, gy0, gz0)
  function baseBlock(gx0, gy0, gz0, n, fill, mat) {
    const cx = fl((gx0 + 1) / CN), cz = fl((gz0 + 1) / CN);
    for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) {
      const gx = gx0 + i, gz = gz0 + k;
      let C = column(fl(gx / CN), fl(gz / CN));
      const li = gx - fl(gx / CN) * CN + 1, lk = gz - fl(gz / CN) * CN + 1, ci = lk * C.n + li;
      const hh = C.h[ci], soil = C.soil[ci], topD = C.top[ci];
      for (let j = 0; j < n; j++) {
        const gy = gy0 + j, y = gy * VS, depth = hh - y, o = (k * n + j) * n + i;
        const f = Math.max(0, Math.min(1, 0.5 + depth / VS));
        fill[o] = Math.round(f * 255);
        mat[o] = f > 0 ? baseMat(gx * VS, y, gz * VS, depth, soil, topD) : 0;
      }
    }
    void cx; void cz;
  }
  function getChunk(cx, cy, cz, create) {
    const key = cx + ',' + cy + ',' + cz; let c = chunks.get(key);
    if (!c && create) { c = { fill: new Uint8Array(CN * CN * CN), mat: new Uint8Array(CN * CN * CN) }; baseBlock(cx * CN, cy * CN, cz * CN, CN, c.fill, c.mat); chunks.set(key, c); }
    return c;
  }
  // one sample (global integer coords): edited chunk or the base ground
  const one = { f: new Uint8Array(1), m: new Uint8Array(1) };
  function sample(gx, gy, gz) {
    const cx = fl(gx / CN), cy = fl(gy / CN), cz = fl(gz / CN), c = chunks.get(cx + ',' + cy + ',' + cz);
    if (c) { const o = ((gz - cz * CN) * CN + (gy - cy * CN)) * CN + (gx - cx * CN); return c.fill[o]; }
    const C = column(cx, cz), li = gx - cx * CN + 1, lk = gz - cz * CN + 1, depth = C.h[lk * C.n + li] - gy * VS;
    return Math.round(Math.max(0, Math.min(1, 0.5 + depth / VS)) * 255);
  }
  function sampleMat(gx, gy, gz) {
    const cx = fl(gx / CN), cy = fl(gy / CN), cz = fl(gz / CN), c = chunks.get(cx + ',' + cy + ',' + cz);
    if (c) { const o = ((gz - cz * CN) * CN + (gy - cy * CN)) * CN + (gx - cx * CN); return c.fill[o] > ISO ? c.mat[o] : 0; }
    baseBlock(gx, gy, gz, 1, one.f, one.m); return one.f[0] > ISO ? one.m[0] : 0;
  }
  function setSample(gx, gy, gz, f, m) {
    const cx = fl(gx / CN), cy = fl(gy / CN), cz = fl(gz / CN), c = getChunk(cx, cy, cz, true);
    const o = ((gz - cz * CN) * CN + (gy - cy * CN)) * CN + (gx - cx * CN);
    c.fill[o] = f; if (m != null) c.mat[o] = m;
    edited.add(cx + ',' + cy + ',' + cz);
    // this sample shows up in the padded blocks of neighbouring chunks too
    const lx = gx - cx * CN, ly = gy - cy * CN, lz = gz - cz * CN;
    for (let dz = (lz <= 1 ? -1 : 0); dz <= (lz === CN - 1 ? 1 : 0); dz++) for (let dy = (ly <= 1 ? -1 : 0); dy <= (ly === CN - 1 ? 1 : 0); dy++) for (let dx = (lx <= 1 ? -1 : 0); dx <= (lx === CN - 1 ? 1 : 0); dx++) dirty.add((cx + dx) + ',' + (cy + dy) + ',' + (cz + dz));
  }
  // smooth density at a world point: > 0 inside the ground
  function density(x, y, z) {
    const gx = x / VS, gy = y / VS, gz = z / VS, ix = fl(gx), iy = fl(gy), iz = fl(gz), fx = gx - ix, fy = gy - iy, fz = gz - iz;
    const s = (a, b, c) => sample(ix + a, iy + b, iz + c);
    const c00 = s(0, 0, 0) * (1 - fx) + s(1, 0, 0) * fx, c10 = s(0, 1, 0) * (1 - fx) + s(1, 1, 0) * fx;
    const c01 = s(0, 0, 1) * (1 - fx) + s(1, 0, 1) * fx, c11 = s(0, 1, 1) * (1 - fx) + s(1, 1, 1) * fx;
    return ((c00 * (1 - fy) + c10 * fy) * (1 - fz) + (c01 * (1 - fy) + c11 * fy) * fz - ISO) / 255;
  }
  const colKey = (x, z) => fl(x / CS) + ',' + fl(z / CS);
  const isActive = (x, z) => active.has(colKey(x, z));
  // ---- queries for the walker / physics
  // the surface under yFrom (or, if yFrom is inside the ground, the top of that solid)
  function top(x, z, yFrom) {
    const C = column(fl(x / CS), fl(z / CS)); if (yFrom > C.mx + 30) yFrom = C.mx + 30;
    if (density(x, yFrom, z) > 0) { let y = yFrom; for (let k = 0; k < 16; k++) { y += 0.25; if (density(x, y, z) <= 0) return refine(x, z, y - 0.25, y); } return yFrom + 4; }
    let y = yFrom;
    for (let k = 0; k < 160; k++) { const y2 = y - 0.4; if (density(x, y2, z) > 0) return refine(x, z, y2, y); y = y2; }
    return -1e4;
  }
  function refine(x, z, lo, hi) { for (let k = 0; k < 6; k++) { const m = (lo + hi) / 2; if (density(x, m, z) > 0) lo = m; else hi = m; } return (lo + hi) / 2; }
  const solid = (x, y, z) => density(x, y, z) > 0;
  function materialAt(x, y, z) { const gx = Math.round(x / VS), gy = Math.round(y / VS), gz = Math.round(z / VS); for (const d of [0, -1, 1]) { const m = sampleMat(gx, gy + d, gz); if (m) return m; } return 0; }
  // ---- activation: a column becomes voxels (the heightfield gets a hole there)
  function activate(cx, cz) {
    const key = cx + ',' + cz; if (active.has(key)) return;
    active.add(key); const C = column(cx, cz);
    for (let cy = fl((C.mn - 2) / CS); cy <= fl((C.mx + 2) / CS); cy++) dirty.add(cx + ',' + cy + ',' + cz);
    for (const k of chunks.keys()) { const [a, , c] = k.split(',').map(Number); if (a === cx && c === cz) dirty.add(k); }
    onHoles(cx, cz);
  }
  function activateAround(x, z, r) { for (let a = fl((x - r) / CS); a <= fl((x + r) / CS); a++) for (let b = fl((z - r) / CS); b <= fl((z + r) / CS); b++) activate(a, b); }
  // ---- edits. Returns what came out (or went in), by material, in voxel units
  function carve(x, y, z, r, { maxHard = 9, strength = 1 } = {}) {
    activateAround(x, z, r + VS);
    const got = {}; let blocked = 0;
    const g0x = fl((x - r) / VS) - 1, g1x = Math.ceil((x + r) / VS) + 1, g0y = fl((y - r) / VS) - 1, g1y = Math.ceil((y + r) / VS) + 1, g0z = fl((z - r) / VS) - 1, g1z = Math.ceil((z + r) / VS) + 1;
    for (let gz = g0z; gz <= g1z; gz++) for (let gy = g0y; gy <= g1y; gy++) for (let gx = g0x; gx <= g1x; gx++) {
      const d = Math.hypot(gx * VS - x, gy * VS - y, gz * VS - z);
      const want = Math.round(Math.max(0, Math.min(1, 0.5 + (d - r) / VS)) * 255);
      const f = sample(gx, gy, gz); if (want >= f) continue;
      const m = sampleMat(gx, gy, gz) || MAT.SOIL;
      if ((MATS[m]?.hard || 1) > maxHard) { blocked++; continue; }
      const nf = Math.round(f - (f - want) * strength);
      got[m] = (got[m] || 0) + (f - nf) / 255;
      setSample(gx, gy, gz, nf, m);
    }
    settleAround(x, y, z, r + 2);
    return { got, blocked };
  }
  function raise(x, y, z, r, m, budget = Infinity) {
    activateAround(x, z, r + VS);
    let used = 0;
    const g0x = fl((x - r) / VS) - 1, g1x = Math.ceil((x + r) / VS) + 1, g0y = fl((y - r) / VS) - 1, g1y = Math.ceil((y + r) / VS) + 1, g0z = fl((z - r) / VS) - 1, g1z = Math.ceil((z + r) / VS) + 1;
    for (let gz = g0z; gz <= g1z; gz++) for (let gy = g0y; gy <= g1y; gy++) for (let gx = g0x; gx <= g1x; gx++) {
      const d = Math.hypot(gx * VS - x, gy * VS - y, gz * VS - z);
      const want = Math.round(Math.max(0, Math.min(1, 0.5 - (d - r) / VS)) * 255);
      const f = sample(gx, gy, gz); if (want <= f) continue;
      const add = (want - f) / 255; if (used + add > budget) continue;
      used += add; setSample(gx, gy, gz, want, f > ISO ? sampleMat(gx, gy, gz) : m);
    }
    settleAround(x, y, z, r + 2);
    return used;
  }
  // flatten: cut what is above the plane, fill what is below (a calm way to make a floor)
  function flatten(x, y, z, r, m, budget = Infinity) {
    activateAround(x, z, r + VS);
    const got = {}; let used = 0;
    for (let gz = fl((z - r) / VS); gz <= Math.ceil((z + r) / VS); gz++) for (let gx = fl((x - r) / VS); gx <= Math.ceil((x + r) / VS); gx++) {
      const dd = Math.hypot(gx * VS - x, gz * VS - z); if (dd > r) continue;
      for (let gy = fl((y - 2) / VS); gy <= Math.ceil((y + 2.5) / VS); gy++) {
        const want = Math.round(Math.max(0, Math.min(1, 0.5 + (y - gy * VS) / VS)) * 255), f = sample(gx, gy, gz);
        if (want < f) { const mm = sampleMat(gx, gy, gz) || MAT.SOIL; got[mm] = (got[mm] || 0) + (f - want) / 255; setSample(gx, gy, gz, want, mm); }
        else if (want > f) { const add = (want - f) / 255; if (used + add > budget) continue; used += add; setSample(gx, gy, gz, want, f > ISO ? sampleMat(gx, gy, gz) : m); }
      }
    }
    return { got, used };
  }
  // ---- pouring: sand and snow slump to their angle of repose (a tiny falling-sand pass on voxels)
  const settleQ = [];
  function settleAround(x, y, z, r) { settleQ.push({ x0: fl((x - r) / VS), x1: Math.ceil((x + r) / VS), y0: fl((y - r - 3) / VS), y1: Math.ceil((y + r + 4) / VS), z0: fl((z - r) / VS), z1: Math.ceil((z + r) / VS), passes: 0 }); }
  let pouring = 0;
  function settlePass(B) {
    let moved = 0;
    for (let gy = B.y0 + 1; gy <= B.y1; gy++) for (let gz = B.z0; gz <= B.z1; gz++) for (let gx = B.x0; gx <= B.x1; gx++) {
      const f = sample(gx, gy, gz); if (f <= ISO) continue;
      const m = sampleMat(gx, gy, gz); if (!MATS[m] || !MATS[m].pours) continue;
      if (sample(gx, gy - 1, gz) <= ISO) { setSample(gx, gy - 1, gz, 255, m); setSample(gx, gy, gz, 0, 0); moved++; continue; }
      // slide off a step: if a side is open and the one below it too
      const o = h3(gx, gy, gz, B.passes) * 4 | 0;
      for (let k = 0; k < 4; k++) {
        const d = (o + k) & 3, dx = d === 0 ? 1 : d === 1 ? -1 : 0, dz = d === 2 ? 1 : d === 3 ? -1 : 0;
        if (sample(gx + dx, gy, gz + dz) <= ISO && sample(gx + dx, gy - 1, gz + dz) <= ISO) { setSample(gx + dx, gy - 1, gz + dz, 255, m); setSample(gx, gy, gz, 0, 0); moved++; break; }
      }
    }
    return moved;
  }
  // ---- meshing (worker; main-thread fallback)
  let worker = null, seq = 0; const pending = new Map();
  try { worker = new Worker(new URL('./mesh-worker.js', import.meta.url), { type: 'module' }); worker.onmessage = (e) => done(e.data); worker.onerror = () => { worker = null; }; } catch (e) { worker = null; }
  const inflight = new Set();
  function padded(cx, cy, cz) {
    const n = NP, fillB = new Uint8Array(n * n * n), matB = new Uint8Array(n * n * n);
    baseBlock(cx * CN - 1, cy * CN - 1, cz * CN - 1, n, fillB, matB);
    // overlay edited chunks (own + neighbours' rims)
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const c = chunks.get((cx + dx) + ',' + (cy + dy) + ',' + (cz + dz)); if (!c) continue;
      const ox = (cx + dx) * CN - (cx * CN - 1), oy = (cy + dy) * CN - (cy * CN - 1), oz = (cz + dz) * CN - (cz * CN - 1);
      for (let k = Math.max(0, -oz); k < Math.min(CN, n - oz); k++) for (let j = Math.max(0, -oy); j < Math.min(CN, n - oy); j++) {
        const src = (k * CN + j) * CN, dst = ((k + oz) * n + (j + oy)) * n + ox;
        for (let i = Math.max(0, -ox); i < Math.min(CN, n - ox); i++) { fillB[dst + i] = c.fill[src + i]; matB[dst + i] = c.mat[src + i]; }
      }
    }
    return { fillB, matB };
  }
  function mesh(key) {
    const [cx, cy, cz] = key.split(',').map(Number);
    if (!active.has(cx + ',' + cz)) { drop(key); return; }
    const { fillB, matB } = padded(cx, cy, cz);
    if (worker) { const id = ++seq; pending.set(id, key); inflight.add(key); worker.postMessage({ id, fill: fillB, mat: matB, N: NP, vs: VS }, [fillB.buffer, matB.buffer]); }
    else done({ id: 0, key, ...surfaceNets(fillB, matB, NP, VS) });
  }
  const col = new THREE.Color(), tmpC = new THREE.Color();
  function done(r) {
    const key = r.key || pending.get(r.id); pending.delete(r.id); inflight.delete(key);
    const [cx, cy, cz] = key.split(',').map(Number);
    drop(key, true);
    if (!r.idx.length) { onMesh(key, null); return; }
    const n = r.pos.length / 3, colors = new Float32Array(n * 3), uv = new Float32Array(n * 2);
    const ox = cx * CS, oy = cy * CS, oz = cz * CS;
    for (let i = 0; i < n; i++) {
      const x = r.pos[i * 3] + ox, y = r.pos[i * 3 + 1] + oy, z = r.pos[i * 3 + 2] + oz, up = r.nor[i * 3 + 1], m = r.mat[i] || MAT.SOIL;
      // start from the planet's own colour for this spot and slope (so cut walls match its cliffs),
      // then tint by how the material differs from plain soil: stone greyer, sand paler, ice bluer
      groundColor(x, z, y, Math.min(1, 1 - up), col);
      if (m !== MAT.SOIL || up < 0.55) {
        tmpC.set(MATS[m] ? MATS[m].color : '#777'); const L = 0.3 * tmpC.r + 0.55 * tmpC.g + 0.15 * tmpC.b + 1e-4, Lg = 0.3 * col.r + 0.55 * col.g + 0.15 * col.b + 1e-4;
        const k = m === MAT.SOIL ? 0.25 : 0.7; col.lerp(tmpC.multiplyScalar(Math.min(1.6, Lg / L * (m === MAT.ICE || m === MAT.SNOW || m === MAT.CRYSTAL ? 1.5 : 1))), k);
        if (m === MAT.STONE) col.multiplyScalar(0.86 + 0.14 * Math.sin(y * 1.9 + Math.sin(x * 0.2) * 0.8)); // strata
        if (m === MAT.ORE) { const s = h3(Math.round(x * 6), Math.round(y * 6), Math.round(z * 6), 3); if (s > 0.6) col.multiplyScalar(1.5); }
        if (up < 0.55) col.multiplyScalar(0.82 + 0.18 * h3(Math.round(x * 3), Math.round(y * 3), Math.round(z * 3), 5));
      }
      // linear vertex colours, like the terrain's
      colors[i * 3] = col.r; colors[i * 3 + 1] = col.g; colors[i * 3 + 2] = col.b;
      uv[i * 2] = x * uvScale[0]; uv[i * 2 + 1] = z * uvScale[1]; // match the ground mesh's own uv mapping
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(r.pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(r.nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(new THREE.BufferAttribute(r.idx, 1)); g.computeBoundingSphere();
    const m = new THREE.Mesh(g, material); m.position.set(ox, oy, oz); m.receiveShadow = true; m.castShadow = !lite; m.name = 'voxels';
    m.userData.mats = r.mat;
    scene.add(m); meshes.set(key, m);
    onMesh(key, m);
  }
  function drop(key, keepCb) { const m = meshes.get(key); if (m) { scene.remove(m); m.geometry.dispose(); meshes.delete(key); if (!keepCb) onMesh(key, null); } }
  // ---- per frame: re-mesh what changed (a couple per frame), let sand pour
  let settleT = 0, pourSound = null;
  function update(dt) {
    settleT += dt;
    if (settleQ.length && settleT > 0.06) {
      settleT = 0; const B = settleQ[0]; B.passes++;
      const n = settlePass(B); pouring = n;
      if (n && pourSound) pourSound(n);
      if (!n || B.passes > 80) settleQ.shift();
    }
    let budget = lite ? 1 : 2;
    for (const key of dirty) { if (budget <= 0) break; if (inflight.has(key)) continue; dirty.delete(key); mesh(key); budget--; }
  }
  // ---- save: per chunk, only the samples that differ from the base ground (run-length, base64)
  function encode(key) {
    const c = chunks.get(key); if (!c) return null;
    const [cx, cy, cz] = key.split(',').map(Number);
    const bf = new Uint8Array(CN * CN * CN), bm = new Uint8Array(CN * CN * CN); baseBlock(cx * CN, cy * CN, cz * CN, CN, bf, bm);
    const out = []; let i = 0; const L = CN * CN * CN;
    const varint = (v) => { while (v > 127) { out.push((v & 127) | 128); v >>>= 7; } out.push(v); };
    const same = (k) => c.fill[k] === bf[k] && (c.fill[k] <= ISO || c.mat[k] === bm[k]);
    while (i < L) {
      let s = 0; while (i < L && same(i)) { s++; i++; }
      let n = 0; const st = i; while (i < L && !same(i) && n < 4096) { n++; i++; }
      varint(s); varint(n); for (let k = st; k < st + n; k++) out.push(c.fill[k], c.mat[k]);
    }
    let bin = ''; const u = new Uint8Array(out); for (let k = 0; k < u.length; k += 8192) bin += String.fromCharCode.apply(null, u.subarray(k, k + 8192));
    return btoa(bin);
  }
  function decode(key, b64) {
    const [cx, cy, cz] = key.split(',').map(Number); const c = getChunk(cx, cy, cz, true);
    const bin = atob(b64), u = new Uint8Array(bin.length); for (let k = 0; k < bin.length; k++) u[k] = bin.charCodeAt(k);
    let p = 0, i = 0; const rd = () => { let v = 0, s = 0, b; do { b = u[p++]; v |= (b & 127) << s; s += 7; } while (b & 128); return v; };
    while (p < u.length) { i += rd(); const n = rd(); for (let k = 0; k < n; k++, i++) { c.fill[i] = u[p++]; c.mat[i] = u[p++]; } }
    activate(cx, cz); dirty.add(key);
  }
  function save() { const o = {}; for (const key of chunks.keys()) { const e = encode(key); if (e && e.length > 4) o[key] = e; } edited.clear(); return o; }
  function load(o) { for (const [k, v] of Object.entries(o || {})) { try { decode(k, v); } catch (e) { console.warn('[vox] bad chunk', k); } } }
  function clear() { for (const k of [...meshes.keys()]) drop(k); chunks.clear(); active.clear(); colCache.clear(); dirty.clear(); settleQ.length = 0; }
  // ---- rays: march the ground (voxels where active, heightfield elsewhere)
  function raycast(o, d, maxD, hfSolid) {
    let t = 0, prev = 0; const s = 0.12;
    const inside = (x, y, z) => (isActive(x, z) ? density(x, y, z) > 0 : hfSolid(x, y, z));
    while (t < maxD) {
      t += s; const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
      if (inside(x, y, z)) {
        let lo = prev, hi = t; for (let k = 0; k < 7; k++) { const m = (lo + hi) / 2; if (inside(o.x + d.x * m, o.y + d.y * m, o.z + d.z * m)) hi = m; else lo = m; }
        const px = o.x + d.x * hi, py = o.y + d.y * hi, pz = o.z + d.z * hi, e = 0.15;
        const f = (a, b, c) => (isActive(a, c) ? density(a, b, c) : (hfSolid(a, b, c) ? 0.5 : -0.5));
        const n = new THREE.Vector3(f(px - e, py, pz) - f(px + e, py, pz), f(px, py - e, pz) - f(px, py + e, pz), f(px, py, pz - e) - f(px, py, pz + e));
        if (n.lengthSq() < 1e-8) n.set(0, 1, 0); n.normalize();
        return { t: hi, point: new THREE.Vector3(px, py, pz), normal: n, voxel: isActive(px, pz) };
      }
      prev = t;
    }
    return null;
  }
  return {
    CS, active, chunks, meshes, isActive, activate, density, top, solid, materialAt, carve, raise, flatten, update, raycast,
    save, load, clear, encode, decode, get pouring() { return pouring; }, set pourSound(f) { pourSound = f; },
    get busy() { return dirty.size + inflight.size + settleQ.length; },
    // 16 m columns (local indices 0..7) inside a 128 m heightfield chunk that are voxels now
    holesIn(cx128, cz128, ch = 128) { const n = ch / CS, out = []; for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) if (active.has((cx128 * n + i) + ',' + (cz128 * n + j))) out.push([i, j]); return out; },
  };
}
