// Moon-base modules (habitat, greenhouse with the moon bonsai, antenna) and the friendly fleet's ships.
// All built from a few lathe / tube shapes so they stay cheap; each returns a Group.
import * as THREE from 'three';
import { consolidate } from './character.js';
import { loadModel } from './models.js';

// Modules modelled in Blender after real concepts (tools/blender/moonbase_build.py): an ESA-style
// regolith-shell dome with a rigid airlock, the Arizona/NASA cylindrical lunar greenhouse, a dish on
// an az-el head. preloadModules() once; the builders then clone. Falls back to the old shapes.
const MODELS = {};
export async function preloadModules() {
  const [h, g, a] = await Promise.all(['habitat', 'greenhouse', 'antenna'].map(loadModel));
  MODELS.habitat = h; MODELS.greenhouse = g; MODELS.antenna = a;
}
function cloneScene(m) {
  const g = m.scene.clone(true);
  g.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = !/membrane|led|window|port|beacon/.test(o.name); o.receiveShadow = true;
    const mt = o.material;
    // windows: dark glass that mirrors the sky with only a faint warm interior (not glowing dots)
    if (/^port|hatch_window/.test(o.name)) { o.geometry = planarUV(o.geometry); o.material = portMat(); }
    if (/^solar/.test(o.name)) { o.geometry = planarUV(o.geometry); o.material = new THREE.MeshStandardMaterial({ map: solarTexture(), roughness: 0.22, metalness: 0.35 }); }
    if (mt && mt.name === 'membrane') { o.material = new THREE.MeshPhysicalMaterial({ color: '#eef4f8', roughness: 0.06, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide, clearcoat: 1 }); o.renderOrder = 2; }
  });
  return g;
}
// real-looking photovoltaic panel: dark blue mono cells, thin silver busbars, a frame edge
let solarTex = null;
function solarTexture() {
  if (solarTex) return solarTex;
  const W = 512, H = 1024, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  g.fillStyle = '#c9ccd0'; g.fillRect(0, 0, W, H);
  const cols = 6, rows = 12, m = 10, cw = (W - 2 * m) / cols, ch = (H - 2 * m) / rows;
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const x = m + i * cw + 2, y = m + j * ch + 2, w = cw - 4, h = ch - 4;
    const gr = g.createLinearGradient(x, y, x + w, y + h); const k = Math.random() * 0.06;
    gr.addColorStop(0, `rgb(${18 + k * 90},${26 + k * 90},${58 + k * 120})`); gr.addColorStop(1, `rgb(${10 + k * 60},${16 + k * 60},${40 + k * 90})`);
    g.fillStyle = gr; g.fillRect(x, y, w, h);
    g.fillStyle = '#f4f6f8'; g.fillRect(x, y, 3, 3); g.fillRect(x + w - 3, y, 3, 3); g.fillRect(x, y + h - 3, 3, 3); g.fillRect(x + w - 3, y + h - 3, 3, 3); // cut corners
    g.fillStyle = 'rgba(205,210,220,0.85)'; for (let b = 1; b <= 3; b++) g.fillRect(x + (w * b) / 4 - 1, y, 2, h); // busbars
    g.fillStyle = 'rgba(160,170,190,0.25)'; for (let f = 0; f < h; f += 6) g.fillRect(x, y + f, w, 1); // fingers
  }
  solarTex = new THREE.CanvasTexture(c); solarTex.colorSpace = THREE.SRGBColorSpace; solarTex.anisotropy = 8;
  return solarTex;
}
function planarUV(geo) {
  geo = geo.clone(); geo.computeBoundingBox(); const b = geo.boundingBox, s = b.getSize(new THREE.Vector3());
  const ax = [['x', s.x], ['y', s.y], ['z', s.z]].sort((a, c) => c[1] - a[1]); const [u, v] = [ax[1][0], ax[0][0]];
  const p = geo.attributes.position, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) { uv[i * 2] = (p['get' + u.toUpperCase()](i) - b.min[u]) / (s[u] || 1); uv[i * 2 + 1] = (p['get' + v.toUpperCase()](i) - b.min[v]) / (s[v] || 1); }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); return geo;
}
// habitat windows: thick multi-pane glass in a brushed-aluminium bezel. The pane mirrors the black
// sky (so it reads dark and glassy, not as a brown disc picking up the regolith), and behind it a dim,
// lived-in interior shows: a neutral LED ceiling light falling off down a cool grey cabin wall.
let portM = null;
function portMat() {
  if (portM) return portM;
  const S = 256, mk = () => { const c = document.createElement('canvas'); c.width = c.height = S; return c; };
  const cm = mk(), ce = mk(), g = cm.getContext('2d'), e = ce.getContext('2d');
  g.fillStyle = '#b9bdc2'; g.fillRect(0, 0, S, S);                          // bezel
  const R = S / 2, r0 = R * 0.8;
  g.fillStyle = '#05070a'; g.beginPath(); g.arc(R, R, r0, 0, 6.283); g.fill(); // glass
  g.strokeStyle = '#6d7277'; g.lineWidth = 5; g.beginPath(); g.arc(R, R, r0 + 2, 0, 6.283); g.stroke(); // gasket
  for (let i = 0; i < 12; i++) { const a = (i / 12) * 6.283; g.fillStyle = '#80868c'; g.beginPath(); g.arc(R + Math.cos(a) * R * 0.9, R + Math.sin(a) * R * 0.9, 3.5, 0, 6.283); g.fill(); } // bolts
  e.fillStyle = '#000'; e.fillRect(0, 0, S, S);
  e.save(); e.beginPath(); e.arc(R, R, r0 - 2, 0, 6.283); e.clip();
  const wall = e.createLinearGradient(0, 0, 0, S);                           // canvas y=0 is the top
  wall.addColorStop(0, '#6e747a'); wall.addColorStop(0.35, '#2c3034'); wall.addColorStop(1, '#0a0c0e');
  e.fillStyle = wall; e.fillRect(0, 0, S, S);
  const lamp = e.createRadialGradient(R * 0.85, S * 0.12, 4, R * 0.85, S * 0.12, S * 0.45);
  lamp.addColorStop(0, 'rgba(255,244,228,0.95)'); lamp.addColorStop(1, 'rgba(255,244,228,0)');
  e.fillStyle = lamp; e.fillRect(0, 0, S, S);
  e.fillStyle = 'rgba(0,0,0,0.75)'; e.fillRect(R * 1.15, S * 0.48, S * 0.22, S * 0.5); // a locker / shelf silhouette
  e.fillRect(R * 0.2, S * 0.7, S * 0.3, S * 0.3);
  e.restore();
  const tm = new THREE.CanvasTexture(cm), te = new THREE.CanvasTexture(ce);
  tm.colorSpace = te.colorSpace = THREE.SRGBColorSpace; tm.anisotropy = te.anisotropy = 8;
  portM = new THREE.MeshPhysicalMaterial({ map: tm, emissiveMap: te, emissive: '#ffffff', emissiveIntensity: 0.55, roughness: 0.12, metalness: 0.6, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 0.35 });
  // only the bezel is metal; the glass is a dielectric
  portM.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n metalnessFactor *= smoothstep(0.05, 0.3, dot(diffuseColor.rgb, vec3(0.33)));'); };
  return portM;
}
const byName = (g, n) => { let f = null; g.traverse((o) => { if (!f && o.name === n) f = o; }); return f; };
export function buildHabitat(o) {
  if (!MODELS.habitat) return legacyHabitat(o);
  const g = cloneScene(MODELS.habitat);
  g.userData.collider = { type: 'circle', r: 3.5 };
  return g;
}
export function buildGreenhouse(o) {
  if (!MODELS.greenhouse) return legacyGreenhouse(o);
  const g = cloneScene(MODELS.greenhouse);
  let holder = byName(g, 'bonsai_holder');
  if (!holder) { holder = new THREE.Group(); holder.position.set(0, 0.87, 0); g.add(holder); }
  const pink = new THREE.PointLight('#ff4fc0', o.lite ? 0 : 3, 5, 2); pink.position.set(0, 1.9, 0); g.add(pink);
  g.userData = { bonsaiHolder: holder, pink, collider: { type: 'box', hw: 3.4, hd: 1.9 } };
  return g;
}
export function buildAntenna(o) {
  if (!MODELS.antenna) return legacyAntenna(o);
  const g = cloneScene(MODELS.antenna);
  const head = byName(g, 'head') || g, beacon = byName(g, 'beacon');
  g.userData = { head, dish: byName(g, 'dish'), beacon: beacon || { material: { emissiveIntensity: 0 } }, collider: { type: 'circle', r: 1.0 } };
  if (beacon && beacon.material) beacon.material = beacon.material.clone();
  return g;
}

const V = (x, y) => new THREE.Vector2(x, y);
const std = (color, rough = 0.7, metal = 0, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });
function add(g, geo, m, cast = true) { const o = new THREE.Mesh(geo, m); o.castShadow = cast; o.receiveShadow = true; g.add(o); return o; }

export const MODULES = [
  { id: 'habitat', name: 'Habitat', desc: 'A soft white module to rest in, with round warm windows.', cost: { regolith: 6, ice: 2 }, r: 5 },
  { id: 'greenhouse', name: 'Greenhouse', desc: 'A glass dome with a moon bonsai growing under pink light.', cost: { regolith: 4, ice: 3, moonglass: 2, clipping: 1 }, r: 4 },
  { id: 'antenna', name: 'Antenna', desc: 'A dish that listens to the stars, pointed home.', cost: { regolith: 3, moonglass: 3, 'find:any': 1 }, r: 2 },
  { id: 'solar', name: 'Solar array', desc: 'Panels that drink the long lunar day and keep the lamps warm.', cost: { regolith: 3, moonglass: 2, salt: 2 }, r: 3.4 },
];
// upgrades: level 2 and 3 of each module. `power` = solar level needed (the array runs the base)
export const UPGRADES = {
  habitat: [null, null, { desc: 'A second sleeping pod, for guests from home.', cost: { regolith: 6, ice: 2, fibre: 2 }, power: 1 }, { desc: 'A little porch and a bench to sit and watch Earth.', cost: { regolith: 5, moonglass: 2, clipping: 2 }, power: 2 }],
  greenhouse: [null, null, { desc: 'Grow lights and a second planter: moon herbs every day.', cost: { regolith: 4, ice: 3, 'flower:any': 2 }, power: 1 }, { desc: 'A misting loop: more herbs, and the bonsai grows faster.', cost: { ice: 4, moonglass: 3, herb: 2 }, power: 2 }],
  solar: [null, null, { desc: 'A second row of panels.', cost: { regolith: 3, moonglass: 3 }, power: 0 }, { desc: 'A third row and a battery for the long lunar night.', cost: { regolith: 4, moonglass: 3, ice: 2 }, power: 0 }],
  antenna: [null],
};
export const maxLevel = (id) => UPGRADES[id].length - 1 || 1;

// solar array: rows of tilted panels on posts, one row per level, plus a battery box at level 3
export function buildSolar({ lite, lvl = 1 }) {
  const g = new THREE.Group();
  const panel = std('#ffffff', 0.35, 0.3, { map: solarTexture() }), frame = std('#b9bcc0', 0.4, 0.8), post = std('#8d9095', 0.5, 0.7), box = std('#e9e6df', 0.7, 0.1);
  const pg = planarUV(new THREE.BoxGeometry(1.1, 0.04, 2.0));
  for (let row = 0; row < Math.min(3, lvl); row++) for (let i = 0; i < 3; i++) {
    const x = (i - 1) * 1.3, z = (row - (Math.min(3, lvl) - 1) / 2) * 2.4;
    add(g, new THREE.CylinderGeometry(0.04, 0.05, 1.1, lite ? 6 : 10).translate(x, 0.55, z), post);
    const pn = add(g, pg.clone(), panel); pn.position.set(x, 1.15, z); pn.rotation.x = -0.55; // tilted toward the low sun
    const fr = add(g, new THREE.BoxGeometry(1.14, 0.02, 2.04), frame); fr.position.set(x, 1.13, z); fr.rotation.x = -0.55;
  }
  if (lvl >= 3) add(g, new THREE.BoxGeometry(0.9, 0.7, 0.6).translate(2.4, 0.35, 0), box);
  g.userData = { collider: { type: 'circle', r: 2.2 + (lvl - 1) * 0.6 } };
  return g;
}
// visible upgrades on a module's group (kept simple, in the same materials language)
export function decorateModule(id, g, lvl, { lite } = {}) {
  if (lvl < 2) return;
  const shell = std('#f1eee8', 0.82), rib = std('#cfcac0', 0.6, 0.2), warm = std('#ffd9a0', 0.4, 0, { emissive: '#ffb765', emissiveIntensity: 1.2 });
  const green = std('#5f8a4a', 0.8), grow = std('#ffb3d9', 0.4, 0, { emissive: '#ff7fbf', emissiveIntensity: 1.4 }), wood = std('#8b6b4f', 0.8);
  if (id === 'habitat') {
    const pod = add(g, new THREE.CapsuleGeometry(1.05, 1.6, 8, lite ? 18 : 28).rotateX(Math.PI / 2).translate(0, 1.35, -3.6), shell);
    add(g, new THREE.CylinderGeometry(0.55, 0.55, 1.2, lite ? 14 : 22).rotateX(Math.PI / 2).translate(0, 1.35, -2.3), rib);
    add(g, new THREE.CylinderGeometry(0.22, 0.22, 0.08, 16).rotateZ(Math.PI / 2).translate(1.05, 1.5, -3.8), warm, false);
    void pod;
    if (lvl >= 3) {
      add(g, new THREE.BoxGeometry(2.4, 0.1, 1.6).translate(5.6, 0.35, 1.6), rib);
      add(g, new THREE.BoxGeometry(1.4, 0.08, 0.4).translate(5.6, 0.75, 2.0), wood);
      for (const sx of [-0.6, 0.6]) add(g, new THREE.BoxGeometry(0.08, 0.4, 0.36).translate(5.6 + sx, 0.55, 2.0), wood);
    }
  } else if (id === 'greenhouse') {
    for (const sx of [-1, 1]) {
      add(g, new THREE.BoxGeometry(1.4, 0.35, 0.5).translate(sx * 1.4, 0.18, 2.6), rib);
      for (let k = 0; k < 5; k++) add(g, new THREE.IcosahedronGeometry(0.13 + (k % 2) * 0.04, 0).translate(sx * 1.4 - 0.5 + k * 0.25, 0.45, 2.6), green);
      add(g, new THREE.BoxGeometry(1.4, 0.04, 0.08).translate(sx * 1.4, 1.2, 2.6), grow, false);
    }
    if (lvl >= 3) add(g, new THREE.TorusGeometry(2.6, 0.03, 6, lite ? 32 : 64).rotateX(Math.PI / 2).translate(0, 2.2, 0), rib);
  }
}


function legacyHabitat({ lite }) {
  const g = new THREE.Group();
  const seg = lite ? 24 : 40;
  const shell = std('#f1eee8', 0.82), rib = std('#cfcac0', 0.6, 0.2), dark = std('#4a4f58', 0.5, 0.4);
  const win = std('#ffd9a0', 0.4, 0, { emissive: '#ffb765', emissiveIntensity: 1.4 });
  const L = 6.2, R = 1.9;
  const body = new THREE.CapsuleGeometry(R, L - 2 * R + 2, 10, seg).rotateZ(Math.PI / 2).translate(0, R + 0.5, 0);
  add(g, body, shell);
  for (let i = -2; i <= 2; i++) add(g, new THREE.TorusGeometry(R + 0.03, 0.06, 6, seg).rotateY(Math.PI / 2).translate(i * 1.05, R + 0.5, 0), rib);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(g, new THREE.CylinderGeometry(0.1, 0.16, 0.7, 8).translate(sx * 2.2, 0.35, sz * 1.1), dark);
  // round windows along the side facing the base, and one in the end cap
  for (let i = -1; i <= 1; i++) {
    add(g, new THREE.CylinderGeometry(0.3, 0.3, 0.1, 18).rotateX(Math.PI / 2).translate(i * 1.6, R + 0.75, R - 0.02), win, false);
    add(g, new THREE.TorusGeometry(0.31, 0.05, 6, 18).translate(i * 1.6, R + 0.75, R + 0.02), rib, false);
  }
  // hatch with a little step
  add(g, new THREE.CylinderGeometry(0.7, 0.7, 0.16, 20).rotateZ(Math.PI / 2).translate(L / 2 + 0.95, R + 0.25, 0), rib);
  add(g, new THREE.CylinderGeometry(0.55, 0.55, 0.06, 20).rotateZ(Math.PI / 2).translate(L / 2 + 1.05, R + 0.25, 0), dark);
  add(g, new THREE.BoxGeometry(0.9, 0.12, 1.0).translate(L / 2 + 1.5, 0.55, 0), rib);
  add(g, new THREE.BoxGeometry(0.9, 0.12, 1.0).translate(L / 2 + 1.9, 0.22, 0), rib);
  // solar wings on a mast
  const panel = std('#1d2c5a', 0.28, 0.6, { emissive: '#0b1430', emissiveIntensity: 0.4 });
  add(g, new THREE.CylinderGeometry(0.06, 0.08, 3.4, 8).translate(-L / 2 - 1.1, 1.7, 0), rib);
  for (const sz of [-1, 1]) {
    add(g, new THREE.BoxGeometry(1.3, 0.04, 2.6).translate(-L / 2 - 1.1, 3.35, sz * 1.5).rotateX(0), panel);
    for (let k = -1; k <= 1; k++) add(g, new THREE.BoxGeometry(1.32, 0.05, 0.03).translate(-L / 2 - 1.1, 3.36, sz * 1.5 + k * 0.85), rib, false);
  }
  consolidate(g);
  g.userData.windows = win;
  g.userData.collider = { type: 'box', hw: L / 2 + 1.6, hd: R + 0.1 };
  return g;
}

// a small, old-looking bonsai that grows in the moon greenhouse (k: 0.55 seedling -> 1 full)
export function buildMoonBonsai(k = 1, seed = 3) {
  const g = new THREE.Group();
  const bark = std('#4e3d30', 0.95), leaf = std('#2c4a22', 0.8); // real juniper colours (no glow)
  const trunk = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.12, 0.25, 0.02), new THREE.Vector3(-0.08, 0.5, 0.05), new THREE.Vector3(0.1, 0.78, -0.02), new THREE.Vector3(0.02, 0.95, 0)]);
  add(g, new THREE.TubeGeometry(trunk, 24, 0.075, 8).scale(1, 1, 1), bark);
  const pads = [[0.1, 0.8, 0, 0.34], [-0.34, 0.62, 0.08, 0.27], [0.4, 0.55, -0.05, 0.25], [0.02, 1.05, 0.02, 0.3], [-0.12, 0.92, -0.18, 0.2]];
  const br = [[0.0, 0.5, 0, -0.34, 0.62, 0.08], [0.06, 0.45, 0, 0.4, 0.55, -0.05]];
  for (const b of br) add(g, new THREE.TubeGeometry(new THREE.LineCurve3(new THREE.Vector3(b[0], b[1], b[2]), new THREE.Vector3(b[3], b[4], b[5])), 4, 0.035, 6), bark);
  let s = seed;
  const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const geos = [];
  for (const [x, y, z, rad] of pads) for (let i = 0; i < 6; i++) {
    const q = new THREE.IcosahedronGeometry(rad * (0.45 + r() * 0.3), 1);
    q.scale(1, 0.55, 1).translate(x + (r() - 0.5) * rad, y + (r() - 0.3) * rad * 0.4, z + (r() - 0.5) * rad);
    geos.push(q);
  }
  const merged = mergeList(geos);
  add(g, merged, leaf);
  g.scale.setScalar(k);
  return g;
}
function mergeList(list) {
  // small local merge (non-indexed) so this module stays self-contained
  const parts = list.map((x) => (x.index ? x.toNonIndexed() : x));
  let n = 0; for (const p of parts) n += p.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  let o = 0;
  for (const p of parts) { p.computeVertexNormals(); pos.set(p.attributes.position.array, o * 3); nor.set(p.attributes.normal.array, o * 3); o += p.attributes.position.count; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return g;
}

function legacyGreenhouse({ lite }) {
  const g = new THREE.Group();
  const R = 3.3;
  const ico = new THREE.IcosahedronGeometry(R, lite ? 2 : 3);
  // keep the upper half (and a little skirt) for the dome
  const pos = ico.attributes.position; const keep = [];
  const tri = ico.index ? ico.toNonIndexed() : ico; const p = tri.attributes.position;
  for (let i = 0; i < p.count; i += 3) { const y = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3; if (y > -0.15) keep.push(i); }
  const arr = new Float32Array(keep.length * 9);
  keep.forEach((i, k) => { for (let j = 0; j < 3; j++) { arr[k * 9 + j * 3] = p.getX(i + j); arr[k * 9 + j * 3 + 1] = Math.max(0, p.getY(i + j)); arr[k * 9 + j * 3 + 2] = p.getZ(i + j); } });
  const dome = new THREE.BufferGeometry(); dome.setAttribute('position', new THREE.BufferAttribute(arr, 3)); dome.computeVertexNormals();
  void pos;
  const glass = new THREE.MeshPhysicalMaterial({ color: '#e6f4ff', roughness: 0.08, metalness: 0, transparent: true, opacity: 0.14, depthWrite: false, side: THREE.DoubleSide, clearcoat: 1 });
  const domeM = new THREE.Mesh(dome, glass); domeM.position.y = 0.45; domeM.renderOrder = 2; g.add(domeM);
  const struts = new THREE.LineSegments(new THREE.EdgesGeometry(dome, 1), new THREE.LineBasicMaterial({ color: '#f4f1ea', transparent: true, opacity: 0.85 }));
  struts.position.y = 0.45; g.add(struts);
  const rim = std('#d9d4ca', 0.6, 0.2);
  add(g, new THREE.CylinderGeometry(R + 0.1, R + 0.2, 0.5, 40, 1, true).translate(0, 0.25, 0), rim);
  add(g, new THREE.TorusGeometry(R + 0.12, 0.08, 6, 40).rotateX(Math.PI / 2).translate(0, 0.5, 0), rim);
  // round planter with soil, the bonsai, a ring of little moss stones
  add(g, new THREE.CylinderGeometry(1.05, 1.15, 0.55, 32).translate(0, 0.28, 0), std('#8a7a6a', 0.9));
  add(g, new THREE.CylinderGeometry(0.98, 0.98, 0.05, 32).translate(0, 0.56, 0), std('#3d2e25', 1), false);
  const pink = new THREE.PointLight('#ff9fe0', lite ? 0 : 6, 7, 1.6); pink.position.set(0, 2.6, 0); g.add(pink);
  const lamp = add(g, new THREE.CylinderGeometry(0.5, 0.65, 0.12, 24).translate(0, 2.75, 0), std('#ffc8ef', 0.4, 0, { emissive: '#ff8fd6', emissiveIntensity: 1.6 }), false);
  add(g, new THREE.CylinderGeometry(0.02, 0.02, 0.6, 6).translate(0, 3.1, 0), rim, false);
  const bonsaiHolder = new THREE.Group(); bonsaiHolder.position.y = 0.58; g.add(bonsaiHolder);
  // airlock tunnel stub toward the habitat
  add(g, new THREE.CylinderGeometry(0.9, 0.9, 1.6, 20).rotateZ(Math.PI / 2).translate(R + 0.6, 0.9, 0), std('#efebe4', 0.8));
  consolidate(g);
  g.userData = { bonsaiHolder, lamp, pink, collider: { type: 'circle', r: R + 0.25 } };
  return g;
}

function legacyAntenna({ lite }) {
  const g = new THREE.Group();
  const metal = std('#d8d4cc', 0.45, 0.5), dark = std('#3c4048', 0.6, 0.3);
  // a three-legged lattice mast
  const H = 6.5, legs = [];
  for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2; legs.push([Math.cos(a) * 0.55, Math.sin(a) * 0.55]); }
  const bars = [];
  for (const [x, z] of legs) bars.push([x, 0, z, x * 0.4, H, z * 0.4]);
  for (let k = 0; k < 6; k++) {
    const y0 = (k / 6) * H, y1 = ((k + 1) / 6) * H;
    for (let i = 0; i < 3; i++) {
      const a = legs[i], b = legs[(i + 1) % 3], s0 = 1 - 0.6 * (y0 / H), s1 = 1 - 0.6 * (y1 / H);
      bars.push([a[0] * s0, y0, a[1] * s0, b[0] * s1, y1, b[1] * s1]);
    }
  }
  for (const [x0, y0, z0, x1, y1, z1] of bars) {
    const a = new THREE.Vector3(x0, y0, z0), b = new THREE.Vector3(x1, y1, z1), len = a.distanceTo(b);
    const m = add(g, new THREE.CylinderGeometry(0.035, 0.035, len, 5), metal);
    m.position.copy(a).add(b).multiplyScalar(0.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  }
  // the dish on a yoke (aimed later, at Earth)
  const head = new THREE.Group(); head.position.y = H + 0.2; g.add(head);
  const pts = []; for (let i = 0; i <= 14; i++) { const r = (i / 14) * 1.7; pts.push(V(r, r * r * 0.16)); }
  const dish = new THREE.LatheGeometry(pts, lite ? 28 : 44); dish.rotateX(Math.PI / 2);
  const dishG = new THREE.Group(); head.add(dishG);
  add(dishG, dish, std('#f2efe8', 0.4, 0.2, { side: THREE.DoubleSide, emissive: '#5a5a5e', emissiveIntensity: 0.6 }));
  add(dishG, new THREE.CylinderGeometry(0.03, 0.03, 1.3, 6).rotateX(Math.PI / 2).translate(0, 0, 0.75), metal);
  add(dishG, new THREE.SphereGeometry(0.1, 10, 8).translate(0, 0, 1.4), std('#ffb36b', 0.4, 0, { emissive: '#ff9a4a', emissiveIntensity: 1.2 }), false);
  add(head, new THREE.BoxGeometry(0.4, 0.4, 0.4), dark);
  const beacon = add(g, new THREE.SphereGeometry(0.08, 10, 8).translate(0, H + 0.62, 0), std('#ff6060', 0.4, 0, { emissive: '#ff3030', emissiveIntensity: 2 }), false);
  add(g, new THREE.BoxGeometry(1.0, 0.7, 0.7).translate(1.3, 0.35, 0.6), dark);
  add(g, new THREE.BoxGeometry(0.6, 0.06, 0.6).translate(1.3, 0.73, 0.6), metal);
  consolidate(g);
  g.userData = { dish: dishG, head, beacon, collider: { type: 'circle', r: 0.9 } };
  return g;
}

// ---- the friendly fleet: smooth pearl ships with soft coloured underglow
export function buildShip({ scale = 1, accent = '#7fe0d0', guide = false, lite = false }) {
  const g = new THREE.Group();
  const seg = lite ? 28 : 48;
  const pearl = std('#f4f0ea', 0.32, 0.25), trim = std('#c9c2b6', 0.4, 0.5);
  const glow = new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.9 });
  const hull = [V(0, -0.55), V(1.2, -0.42), V(2.4, -0.15), V(2.8, 0.05), V(2.5, 0.28), V(1.6, 0.5), V(0.7, 0.62), V(0, 0.66)];
  add(g, new THREE.LatheGeometry(hull, seg), pearl);
  add(g, new THREE.TorusGeometry(2.62, 0.07, 8, seg).rotateX(Math.PI / 2).translate(0, 0.08, 0), trim);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.12, 8, seg).rotateX(Math.PI / 2).translate(0, -0.5, 0), glow); g.add(ring);
  const cockpit = std('#ffe2b0', 0.15, 0, { emissive: '#ffc27a', emissiveIntensity: 1.1, transparent: true, opacity: 0.92 });
  add(g, new THREE.SphereGeometry(0.75, 24, 14, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.6, 0), cockpit, false);
  if (guide) {
    // the guide: a longer hull with two swept fins and a lantern on top
    for (const s of [-1, 1]) {
      const fin = new THREE.Shape(); fin.moveTo(0, 0); fin.lineTo(1.4, -0.1); fin.quadraticCurveTo(1.9, 0.3, 1.5, 0.55); fin.lineTo(0, 0.3);
      const fg = new THREE.ExtrudeGeometry(fin, { depth: 0.08, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 1 });
      fg.translate(1.6, 0, -0.04); if (s < 0) fg.rotateY(Math.PI);
      add(g, fg, pearl);
    }
    add(g, new THREE.SphereGeometry(0.16, 12, 10).translate(0, 1.42, 0), new THREE.MeshBasicMaterial({ color: '#fff3d6' }), false);
    add(g, new THREE.CylinderGeometry(0.03, 0.05, 0.4, 6).translate(0, 1.2, 0), trim, false);
  }
  // small running lights around the rim
  const lightsG = [];
  for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; lightsG.push(new THREE.SphereGeometry(0.06, 6, 4).translate(Math.cos(a) * 2.7, 0.1, Math.sin(a) * 2.7)); }
  const lg = mergeList(lightsG); g.add(new THREE.Mesh(lg, new THREE.MeshBasicMaterial({ color: '#fff7e0' })));
  g.scale.setScalar(scale);
  g.userData = { ring, accent };
  return g;
}
