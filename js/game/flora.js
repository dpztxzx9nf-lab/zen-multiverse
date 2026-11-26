// Procedural flora for a planet: each species is one merged, vertex-coloured geometry drawn with
// instancing. Shapes and colours come from the planet's seed, so every world grows its own plants.
import * as THREE from 'three';
import { rng, hash, makeName } from './names.js';
import { loadModel } from './models.js';
import { stylize, clumpOf } from '../look.js';
let meadowTex = null;
// fine grass card: ~90 thin tapered blades, dark roots to lighter tips, transparent elsewhere
function meadowTexture() {
  const N = 256, c = document.createElement('canvas'); c.width = N; c.height = N; const g = c.getContext('2d');
  let sd = 91; const r = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 90; i++) {
    const x = 4 + r() * (N - 8), h = N * (0.35 + r() * 0.63), w = 1.2 + r() * 2.2, bend = (r() - 0.5) * 60;
    const gr = g.createLinearGradient(0, N, 0, N - h); const l = 0.55 + r() * 0.45;
    gr.addColorStop(0, `rgb(${Math.round(90 * l)},${Math.round(100 * l)},${Math.round(70 * l)})`); gr.addColorStop(1, `rgb(${Math.round(255 * l)},${Math.round(255 * l)},${Math.round(225 * l)})`);
    g.beginPath(); g.moveTo(x - w, N); g.quadraticCurveTo(x + bend * 0.3, N - h * 0.6, x + bend, N - h); g.quadraticCurveTo(x + bend * 0.3 + w * 0.4, N - h * 0.6, x + w, N); g.closePath();
    g.fillStyle = gr; g.fill();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function part(geo, color) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const n = g.attributes.position.count, c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { c[i * 3] = color.r; c[i * 3 + 1] = color.g; c[i * 3 + 2] = color.b; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  if (!g.attributes.normal) g.computeVertexNormals();
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k);
  return g;
}
export function mergeParts(parts) {
  let n = 0; for (const p of parts) n += p.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let o = 0;
  for (const p of parts) { pos.set(p.attributes.position.array, o * 3); nor.set(p.attributes.normal.array, o * 3); col.set(p.attributes.color.array, o * 3); o += p.attributes.position.count; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeBoundingSphere();
  return g;
}
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const tube = (pts, r, seg = 10, rs = 6) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), seg, r, rs);
// a tapered tube (thick at the base)
function taper(pts, r0, r1, seg = 10, rs = 7) {
  const g = tube(pts, 1, seg, rs), p = g.attributes.position, curve = new THREE.CatmullRomCurve3(pts);
  const c = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    const ring = Math.floor(i / (rs + 1)), t = ring / seg; curve.getPointAt(Math.min(1, t), c);
    const r = r0 + (r1 - r0) * t;
    p.setXYZ(i, c.x + (p.getX(i) - c.x) * r, c.y + (p.getY(i) - c.y) * r, c.z + (p.getZ(i) - c.z) * r);
  }
  g.computeVertexNormals(); return g;
}

const BUILD = {
  // ground cover: a clump of crossed grass cards (one alpha blade texture), tinted per planet and biome
  meadow(r, W, lite, p) {
    const cards = lite ? 3 : 5, pos = [], uv = [], nrm = [], idx = [];
    for (let k = 0; k < cards; k++) {
      const a = (k / cards) * Math.PI + r() * 0.4, w = 0.8 + r() * 0.5, h = 0.26 + r() * 0.22;
      const ox = (r() - 0.5) * 0.5, oz = (r() - 0.5) * 0.5, dx = Math.cos(a) * w / 2, dz = Math.sin(a) * w / 2, lean = (r() - 0.5) * 0.12;
      const b = pos.length / 3;
      pos.push(ox - dx, 0, oz - dz, ox + dx, 0, oz + dz, ox + dx + lean, h, oz + dz, ox - dx + lean, h, oz - dz);
      uv.push(0, 0, 1, 0, 1, 1, 0, 1);
      for (let i = 0; i < 4; i++) nrm.push(0, 1, 0);
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3)); geo.setIndex(idx);
    if (!meadowTex) meadowTex = meadowTexture();
    const dry = p.biome === 'shore' ? 0.55 : p.biome === 'salt' ? 0.8 : 0.15 + r() * 0.2;
    const col = new THREE.Color(0.11, 0.16, 0.05).lerp(new THREE.Color(0.36, 0.31, 0.17), dry).lerp(W.C(W.hue, 0.4, 0.35), 0.12);
    const mat = new THREE.MeshStandardMaterial({ map: meadowTex, color: col, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.92, metalness: 0 });
    // cards keep their up-facing normal on both sides (DoubleSide would flip the back face to black)
    mat.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n normal = normalize(vNormal);'); };
    mat.customProgramCacheKey = () => 'meadow';
    return { geo, mat };
  },
  bulbtree(r, W, lite) {
    const parts = [], bark = W.C(W.hue + 0.08 + r() * 0.1, 0.25, 0.3), bulb = W.C(W.hue + 0.3 + r() * 0.4, 0.75, 0.68), leaf = W.C(W.hue + r() * 0.1, 0.5, 0.42);
    const H = 4 + r() * 4, lean = (r() - 0.5) * 1.5;
    const trunk = [V3(0, 0, 0), V3(lean * 0.3, H * 0.35, 0.2), V3(lean * 0.8, H * 0.7, -0.1), V3(lean, H, 0)];
    parts.push(part(taper(trunk, 0.32, 0.12, lite ? 6 : 10, lite ? 5 : 7), bark));
    const nb = 3 + Math.floor(r() * 3);
    for (let i = 0; i < nb; i++) {
      const a = (i / nb) * Math.PI * 2 + r(), L = 1.2 + r() * 1.6, y0 = H * (0.6 + r() * 0.35);
      const s = V3(lean * (y0 / H), y0, 0), e = V3(s.x + Math.cos(a) * L, y0 + 0.4 + r() * 0.8, Math.sin(a) * L);
      parts.push(part(taper([s, s.clone().lerp(e, 0.5).add(V3(0, 0.4, 0)), e], 0.1, 0.05, 4, 5), bark));
      parts.push(part(new THREE.IcosahedronGeometry(0.35 + r() * 0.3, lite ? 0 : 1).translate(e.x, e.y + 0.2, e.z), bulb));
      parts.push(part(new THREE.IcosahedronGeometry(0.55 + r() * 0.3, 0).scale(1, 0.5, 1).translate(e.x * 0.8, e.y - 0.1, e.z * 0.8), leaf));
    }
    parts.push(part(new THREE.IcosahedronGeometry(0.6, lite ? 0 : 1).translate(lean, H + 0.3, 0), bulb));
    return { geo: mergeParts(parts), trunkR: 0.35, glow: bulb };
  },
  umbrella(r, W, lite) {
    const parts = [], stalk = W.C(W.hue + 0.15 + r() * 0.1, 0.25, 0.75), cap = W.C(W.hue + 0.6 + r() * 0.3, 0.55, 0.5), gill = W.C(W.hue + 0.6, 0.45, 0.78);
    const H = 3 + r() * 5, Rc = 1.6 + r() * 1.8, bend = (r() - 0.5) * 1.2;
    const pts = [V3(0, 0, 0), V3(bend * 0.4, H * 0.5, 0), V3(bend, H, 0)];
    parts.push(part(taper(pts, 0.28, 0.16, lite ? 5 : 8, lite ? 6 : 8), stalk));
    const prof = []; for (let i = 0; i <= 8; i++) { const t = i / 8; prof.push(new THREE.Vector2(Rc * Math.sin(t * Math.PI / 2) ** 0.8, Math.cos(t * Math.PI / 2) * Rc * 0.45)); }
    const capG = new THREE.LatheGeometry(prof, lite ? 12 : 20); capG.translate(bend, H - 0.1, 0); parts.push(part(capG, cap));
    parts.push(part(new THREE.CircleGeometry(Rc * 0.98, lite ? 12 : 20).rotateX(Math.PI / 2).translate(bend, H - 0.08, 0), gill));
    const nt = lite ? 4 : 8;
    for (let i = 0; i < nt; i++) { const a = (i / nt) * Math.PI * 2, d = Rc * (0.5 + r() * 0.4); parts.push(part(new THREE.CylinderGeometry(0.03, 0.015, 0.8 + r() * 1.2, 4).translate(bend + Math.cos(a) * d, H - 0.6 - r() * 0.4, Math.sin(a) * d), gill)); }
    return { geo: mergeParts(parts), trunkR: 0.3, glow: gill };
  },
  frond(r, W, lite) {
    const parts = [], c1 = W.C(W.hue + 0.02 + r() * 0.08, 0.55, 0.4), c2 = W.C(W.hue + 0.3 + r() * 0.3, 0.6, 0.6);
    const n = lite ? 6 : 10, L = 0.8 + r() * 0.9;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + r() * 0.3, tilt = 0.5 + r() * 0.5;
      const g = new THREE.SphereGeometry(1, 6, 4).scale(0.12 * L, 0.03, 0.5 * L).translate(0, 0, 0.5 * L).rotateX(-tilt).rotateY(a);
      parts.push(part(g, i % 3 === 0 ? c2 : c1));
    }
    parts.push(part(new THREE.IcosahedronGeometry(0.12, 0).translate(0, 0.25, 0), c2));
    return { geo: mergeParts(parts), trunkR: 0 };
  },
  tuft(r, W, lite) {
    const parts = [], c = W.C(W.hue + r() * 0.08, 0.45, 0.45), tip = W.C(W.hue + 0.12, 0.55, 0.65);
    const n = lite ? 5 : 8;
    for (let i = 0; i < n; i++) { const a = r() * 6.28, h = 0.35 + r() * 0.5; parts.push(part(new THREE.ConeGeometry(0.035, h, 3).translate(0, h / 2, 0).rotateZ((r() - 0.5) * 0.7).rotateY(a).translate(Math.cos(a) * 0.08, 0, Math.sin(a) * 0.08), i % 2 ? c : tip)); }
    return { geo: mergeParts(parts), trunkR: 0 };
  },
  reed(r, W, lite) {
    const parts = [], c = W.C(W.hue + 0.12 + r() * 0.05, 0.4, 0.5), head = W.C(W.hue + 0.05, 0.5, 0.35);
    const n = lite ? 3 : 5;
    for (let i = 0; i < n; i++) { const h = 1.2 + r() * 1.4, x = (r() - 0.5) * 0.4, z = (r() - 0.5) * 0.4; parts.push(part(new THREE.CylinderGeometry(0.02, 0.03, h, 4).translate(x, h / 2, z), c)); parts.push(part(new THREE.SphereGeometry(0.06, 5, 4).scale(1, 3, 1).translate(x, h + 0.1, z), head)); }
    return { geo: mergeParts(parts), trunkR: 0 };
  },
  crystal(r, W, lite) {
    const parts = [], c = W.C(W.hue + 0.5 + r() * 0.3, 0.1, 0.78), c2 = W.C(W.hue + 0.55 + r() * 0.3, 0.14, 0.62); // quartz-like, barely tinted
    const n = 3 + Math.floor(r() * 5);
    for (let i = 0; i < n; i++) {
      const h = 0.6 + r() * 2.6, w = 0.12 + r() * 0.22, g = new THREE.CylinderGeometry(w, w, h, 6).translate(0, h / 2, 0);
      g.computeVertexNormals();
      const tipG = new THREE.ConeGeometry(w, w * 2.2, 6).translate(0, h + w * 1.1, 0);
      const rx = (r() - 0.5) * 0.9, rz = (r() - 0.5) * 0.9, x = (r() - 0.5) * 0.6, z = (r() - 0.5) * 0.6;
      for (const q of [g, tipG]) { q.rotateX(rx); q.rotateZ(rz); q.translate(x, 0, z); parts.push(part(q, i % 2 ? c : c2)); }
    }
    return { geo: mergeParts(parts), trunkR: 0.4, crystal: c };
  },
  rock(r, W, lite) {
    const g = new THREE.IcosahedronGeometry(1, lite ? 0 : 1), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const k = 0.75 + r() * 0.35; p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.65, p.getZ(i) * k); }
    g.computeVertexNormals();
    return { geo: mergeParts([part(g, W.C(W.hue + 0.05, 0.12, 0.45 + r() * 0.15))]), trunkR: 0.8 };
  },
  saltpillar(r, W, lite) {
    const parts = [], c = W.C(0.07, 0.2, 0.9), c2 = W.C(0.98, 0.3, 0.84);
    let y = 0; const n = 3 + Math.floor(r() * 4);
    for (let i = 0; i < n; i++) { const s = 0.9 - i * 0.12 + r() * 0.1, h = 0.4 + r() * 0.5; parts.push(part(new THREE.BoxGeometry(s, h, s * (0.8 + r() * 0.3)).rotateY(r()).translate((r() - 0.5) * 0.2, y + h / 2, (r() - 0.5) * 0.2), i % 2 ? c : c2)); y += h * 0.95; }
    return { geo: mergeParts(parts), trunkR: 0.5 };
  },
  succulent(r, W, lite) {
    const parts = [], body = W.C(W.hue + 0.15 + r() * 0.1, 0.4, 0.45), fl = W.C(W.hue + 0.75 + r() * 0.2, 0.8, 0.65);
    const H = 0.6 + r() * 0.9, prof = [];
    for (let i = 0; i <= 8; i++) { const t = i / 8; prof.push(new THREE.Vector2(Math.max(0.01, Math.sin(t * Math.PI) * 0.3 * (1 - t * 0.4)), t * H)); }
    parts.push(part(new THREE.LatheGeometry(prof, lite ? 8 : 12), body));
    for (let i = 0; i < 3; i++) parts.push(part(new THREE.IcosahedronGeometry(0.07, 0).translate((r() - 0.5) * 0.12, H + 0.04, (r() - 0.5) * 0.12), fl));
    return { geo: mergeParts(parts), trunkR: 0.25 };
  },
  icespike(r, W, lite) {
    const parts = [], c = W.C(0.55, 0.5, 0.82), c2 = W.C(0.58, 0.55, 0.92);
    const n = 3 + Math.floor(r() * 4);
    for (let i = 0; i < n; i++) { const h = 1 + r() * 3.5, w = 0.2 + r() * 0.3; parts.push(part(new THREE.ConeGeometry(w, h, 5).translate(0, h / 2, 0).rotateX((r() - 0.5) * 0.5).rotateZ((r() - 0.5) * 0.5).translate((r() - 0.5) * 0.8, 0, (r() - 0.5) * 0.8), i % 2 ? c : c2)); }
    return { geo: mergeParts(parts), trunkR: 0.4, crystal: c };
  },
  frostpuff(r, W, lite) {
    const parts = [], c = W.C(0.55, 0.25, 0.88), c2 = W.C(W.hue + 0.6, 0.45, 0.7);
    for (let i = 0; i < 6; i++) parts.push(part(new THREE.IcosahedronGeometry(0.25 + r() * 0.25, lite ? 0 : 1).translate((r() - 0.5) * 0.6, 0.25 + r() * 0.4, (r() - 0.5) * 0.6), i === 0 ? c2 : c));
    return { geo: mergeParts(parts), trunkR: 0 };
  },
};
// which species grow where, and how thickly (per 128 m chunk at full weight). Most are CC0 Poly Haven
// scans (quiver trees, Namaqualand succulents and shrubs, ferns, boulders) cut down to two LODs in
// Blender; the crystal and ice spikes stay procedural as the one quietly alien thing.
const PLAN = [
  { kind: 'quiver tree', model: 'qtree_a', biome: 'forest', density: 20, scale: [0.8, 1.35], big: true, trunkR: 0.3 },
  { kind: 'tree aloe', model: 'qtree_b', biome: 'forest', density: 16, scale: [0.8, 1.4], big: true, trunkR: 0.3 },
  { kind: 'succulent shrub', model: 'othonna', biome: 'forest', density: 30, scale: [0.8, 1.3], trunkR: 0.3 },
  { kind: 'bush', model: 'rooibos', biome: 'forest', density: 60, scale: [1.1, 1.9], near: true },
  { kind: 'fern', model: 'fern', biome: 'forest', density: 70, scale: [0.8, 1.4], near: true },
  { kind: 'low shrub', model: 'shrub', biome: 'forest', density: 180, scale: [2.0, 3.6], near: true },
  { kind: 'meadow grass', build: 'meadow', biome: 'forest', density: 8000, scale: [0.8, 1.5], near: true, cluster: 0.68, maxD: 55, cap: 8000, noShadow: true },
  { kind: 'dune grass', build: 'meadow', biome: 'shore', density: 2600, scale: [0.7, 1.4], near: true, cluster: 0.55, maxD: 55, cap: 3200, noShadow: true },
  { kind: 'pebbles', model: 'pebbles', biome: 'any', density: 260, scale: [3, 8], near: true, cluster: 0.7, maxD: 70, cap: 1600 },
  { kind: 'mossy boulder', model: 'grock_moss', biome: 'forest', density: 7, scale: [0.7, 1.5], trunkR: 0.8, big: true, cluster: 0.5 },
  { kind: 'ice plant', model: 'iceplant', biome: 'shore', density: 140, scale: [2.0, 3.6], near: true },
  { kind: 'crystal', build: 'crystal', biome: 'crystal', density: 50, scale: [0.6, 1.8] },
  { kind: 'boulder', model: 'boulder_a', biome: 'any', density: 5, scale: [0.35, 1.2], trunkR: 1.1, big: true },
  { kind: 'stone', model: 'boulder_b', biome: 'any', density: 10, scale: [0.5, 1.7], trunkR: 0.5 },
  { kind: 'mossy rock', model: 'mossrock', biome: 'forest', density: 4, scale: [0.6, 1.2], trunkR: 1.0, big: true },
  { kind: 'dead trunk', model: 'deadtrunk', biome: 'salt', density: 10, scale: [0.8, 1.3], trunkR: 0.2 },
  { kind: 'succulent', model: 'succulent', biome: 'salt', density: 70, scale: [1.2, 2.2], near: true },
  { kind: 'ice spire', build: 'icespike', biome: 'ice', density: 26, scale: [0.6, 1.5] },
  { kind: 'dead trunk', model: 'deadtrunk', biome: 'ice', density: 4, scale: [0.8, 1.2], trunkR: 0.2 },
  // tall forest trees (Poly Haven Fir Tree 01 and Island Tree 01 rebuilt as cards in Blender): thick on
  // hills and ridges, two mesh LODs near the walker and 8-view impostors out to the horizon
  { kind: 'fir', model: 'ptree_fir', biome: 'forest', density: 420, scale: [0.7, 1.3], big: true, trunkR: 0.35, forest: true, hill: true, cluster: 0.6, near0: 30, imp: 70, cap0: 24, cap: 260, capImp: 9000 },
  { kind: 'broadleaf tree', model: 'ptree_broad', biome: 'forest', density: 110, scale: [0.75, 1.2], big: true, trunkR: 0.45, forest: true, cluster: 0.5, near0: 35, imp: 75, cap0: 20, cap: 220, capImp: 3000 },
];
let scans = null;
export function preloadFlora() {
  if (!scans) {
    const names = [...new Set(PLAN.filter((p) => p.model).map((p) => p.model))];
    scans = Promise.all(names.map((n) => loadModel(n))).then((ms) => { const o = {}; names.forEach((n, i) => { o[n] = ms[i]; }); scans = o; return o; });
  }
  return scans;
}
export const floraReady = () => scans && !(scans instanceof Promise);
function scanMaterial(m, W, r) {
  const c = m.clone();
  if (c.transparent || c.alphaTest > 0 || c.alphaHash) { c.transparent = false; c.alphaHash = false; c.alphaTest = 0.5; c.side = THREE.DoubleSide; c.depthWrite = true; }
  // a planet's light and soil shift plant colour a little (the alien twist stays subtle)
  if (c.alphaTest > 0 || /leaf|leaves|othonna|fern|shrub|rooibos|iceplant|succulent|quiver_tree_02/.test(m.name || '')) c.color.setHSL(((W.hue % 1) + 1) % 1, 0.4, 0.5).lerp(new THREE.Color(1, 1, 1), 0.72 + r() * 0.12);
  c.roughness = Math.max(c.roughness, 0.6);
  if (c.alphaTest > 0) { c.roughnessMap = null; c.metalnessMap = null; c.roughness = 0.85; c.envMapIntensity = 0.6; } // ARM is 0 off-leaf: glinting edges
  return c;
}
// stylize and remember how, so a clone (the crossfade LOD) can be styled the same way
function stylizeFlora(m, kind, o) { stylize(m, kind, o); m.userData.zmStyle = { kind, o }; return m; }
export function restyle(clone, src) { const z = src.userData.zmStyle; if (!z) return clone; delete clone.userData.zmLook; clone.userData.zmStyle = z; return stylize(clone, z.kind, z.o); }
// each entry: lods[l] = [{ geo, mat }] parts drawn by one InstancedMesh each. Needs preloadFlora() first.
export function makeFlora(W, { lite }) {
  return PLAN.map((p, i) => {
    const r = rng(hash(W.seed, 17, i));
    let lods;
    if (p.model) {
      const set = scans[p.model];
      if (!set || !set.variants.length) return null;
      const v = set.variants[Math.floor(r() * set.variants.length)];
      const mats = new Map();
      lods = v.lods.map((L) => L.parts.map((pt) => { if (!mats.has(pt.material)) mats.set(pt.material, scanMaterial(pt.material, W, r)); return { geo: pt.geometry, mat: mats.get(pt.material), own: false }; }));
      if (lite && lods.length > 1 && !p.big) lods = [lods[1]]; // phones: small plants use the light mesh only
      // Raked Light: leaves as soft clumps (normals bent out from the crown) swaying in the wind; bark and stems matte
      for (const [src, m] of mats) {
        const geos = v.lods[0].parts.filter((pt) => pt.material === src).map((pt) => pt.geometry);
        const leafy = m.alphaTest > 0, c = clumpOf(geos);
        stylizeFlora(m, leafy ? 'leaf' : 'wood', { clump: leafy && (p.big || p.forest) ? c.center : null, clumpK: 0.65, height: c.height, wind: !p.noWind, lite });
      }
    } else {
      const b = BUILD[p.build](r, W, lite, p);
      // living shapes are soft (smooth shading, painterly ramp); only crystals keep their facets
      const mat = b.mat || new THREE.MeshStandardMaterial({ vertexColors: true, roughness: b.crystal ? 0.3 : 0.75, metalness: 0, emissive: b.crystal || '#000', emissiveIntensity: 0.06, flatShading: !!b.crystal });
      stylizeFlora(mat, b.crystal ? 'rock' : p.build === 'meadow' ? 'grass' : 'leaf', { height: 3, wind: !b.crystal && p.build !== 'meadow', lite });
      lods = [[{ geo: b.geo, mat, own: true }]];
    }
    return { ...p, i, lods, trunkR: p.trunkR || 0, name: makeName(hash(W.seed, 23, i)), kindLabel: 'flora' };
  }).filter(Boolean).map((f, i) => ({ ...f, i }));
}
