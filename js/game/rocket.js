// A classic rocket (~13.5 m) built from five parts in order. The shape stays classic; the surfaces are
// real: painted aluminium skin with panel seams, rivet rows and launch soot, bare copper with a
// light patina, painted fins worn at the edges (procedural maps, no external assets).
//   body -> engine -> fins -> capsule -> nose. buildRocket() returns { group, parts: {id: Group}, flame, setFlame(k) }
import * as THREE from 'three';
import { consolidate } from './character.js';
import { mergeGeometries } from '../util.js';

export const ROCKET_PARTS = [
  { id: 'body', name: 'Hull', desc: 'A painted aluminium hull, banded in dark teal.', cost: { salt: 4, 'find:any': 1 } },
  { id: 'engine', name: 'Engine', desc: 'A copper engine bell and fuel tanks.', cost: { 'find:any': 2, pinecone: 3, salt: 3 } },
  { id: 'fins', name: 'Fins', desc: 'Three swept fins to stand on and fly straight.', cost: { clipping: 2, salt: 3 } },
  { id: 'capsule', name: 'Capsule', desc: 'A cosy capsule with a round window.', cost: { 'flower:any': 3, fibre: 2, 'find:any': 1, salt: 4 } },
  { id: 'nose', name: 'Nose cone', desc: 'A copper nose cone and a whip antenna.', cost: { 'flower:any': 3, pinecone: 2 } },
];
const V = (x, y) => new THREE.Vector2(x, y);
const std = (color, rough = 0.5, metal = 0, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });

// skin maps: colour + bump/roughness from the same seams. u wraps around, v runs up the profile.
function skinMaps(size, { base, seamsU = 16, seamsV = [], soot = 0.6, patina = 0, wear = 0, rivets = true }, seed = 1) {
  const mk = () => { const c = document.createElement('canvas'); c.width = c.height = size; return c; };
  const col = mk(), bump = mk(), g = col.getContext('2d'), b = bump.getContext('2d');
  let r = seed * 9301 + 49297; const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
  g.fillStyle = base; g.fillRect(0, 0, size, size); b.fillStyle = '#808080'; b.fillRect(0, 0, size, size);
  // panel-to-panel tone differences (each sheet was painted / rolled a little differently)
  const rows = [0, ...seamsV, 1];
  for (let j = 0; j < rows.length - 1; j++) for (let i = 0; i < seamsU; i++) {
    const v = (rnd() - 0.5) * 0.06; g.fillStyle = v > 0 ? `rgba(255,255,255,${v})` : `rgba(0,0,0,${-v})`;
    g.fillRect(i / seamsU * size, (1 - rows[j + 1]) * size, size / seamsU, (rows[j + 1] - rows[j]) * size);
  }
  // fine mottling
  for (let k = 0; k < size * 6; k++) { g.fillStyle = `rgba(${rnd() < 0.5 ? '0,0,0' : '255,255,255'},${rnd() * 0.035})`; const w = 2 + rnd() * size / 40; g.fillRect(rnd() * size, rnd() * size, w, w * (0.3 + rnd())); }
  // seams + rivets
  g.strokeStyle = 'rgba(0,0,0,0.28)'; g.lineWidth = Math.max(1, size / 700); b.strokeStyle = '#404040'; b.lineWidth = Math.max(1.5, size / 450);
  for (let i = 0; i <= seamsU; i++) { const x = i / seamsU * size; for (const c of [g, b]) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, size); c.stroke(); } }
  for (const v of seamsV) { const y = (1 - v) * size; for (const c of [g, b]) { c.beginPath(); c.moveTo(0, y); c.lineTo(size, y); c.stroke(); } }
  if (rivets) {
    b.fillStyle = '#b8b8b8'; g.fillStyle = 'rgba(0,0,0,0.12)'; const d = size / 160;
    for (const v of seamsV) for (let x = 0; x < size; x += size / 96) { for (const o of [-1.6, 1.6]) { b.beginPath(); b.arc(x, (1 - v) * size + o * d, d * 0.55, 0, 6.3); b.fill(); g.fillRect(x - 1, (1 - v) * size + o * d - 1, 2, 2); } }
  }
  // launch soot and run-off streaks rising from the bottom
  if (soot > 0) {
    const gr = g.createLinearGradient(0, size, 0, size * 0.55); gr.addColorStop(0, `rgba(25,20,18,${soot})`); gr.addColorStop(1, 'rgba(25,20,18,0)');
    g.fillStyle = gr; g.fillRect(0, 0, size, size);
    for (let k = 0; k < 90; k++) { const x = rnd() * size, h = size * (0.05 + rnd() * 0.35); const s2 = g.createLinearGradient(0, size, 0, size - h); s2.addColorStop(0, `rgba(20,16,14,${0.12 + rnd() * 0.2})`); s2.addColorStop(1, 'rgba(20,16,14,0)'); g.fillStyle = s2; g.fillRect(x, size - h, 1 + rnd() * size / 120, h); }
  }
  // rain streaks down from seams (dirt)
  for (let k = 0; k < 60; k++) { const x = rnd() * size, y = rnd() * size, h = size * (0.03 + rnd() * 0.12); const s3 = g.createLinearGradient(0, y, 0, y + h); s3.addColorStop(0, 'rgba(60,50,40,0.10)'); s3.addColorStop(1, 'rgba(60,50,40,0)'); g.fillStyle = s3; g.fillRect(x, y, 1 + rnd() * 2, h); }
  if (patina > 0) for (let k = 0; k < 140; k++) { g.fillStyle = `rgba(70,140,120,${rnd() * patina * 0.25})`; const w = rnd() * size / 14; g.beginPath(); g.ellipse(rnd() * size, rnd() * size, w, w * 0.6, rnd() * 3, 0, 6.3); g.fill(); }
  if (wear > 0) for (let k = 0; k < 220; k++) { g.fillStyle = `rgba(185,185,180,${rnd() * wear})`; const w = rnd() * size / 70; g.fillRect(rnd() * size, rnd() < 0.5 ? rnd() * size * 0.06 : size - rnd() * size * 0.06, w, w * 0.5); }
  const tex = (c, srgb) => { const t = new THREE.CanvasTexture(c); t.wrapS = THREE.RepeatWrapping; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = 4; return t; };
  return { map: tex(col, true), bumpMap: tex(bump, false) };
}

export function buildRocket({ lite = false } = {}) {
  const seg = lite ? 28 : 48, S = lite ? 512 : 1024;
  const hull = skinMaps(S, { base: '#dcd8ce', seamsU: 12, seamsV: [0.1, 0.38, 0.62, 0.9], soot: 0.55 }, 3);
  const cap = skinMaps(S / 2, { base: '#dcd8ce', seamsU: 10, seamsV: [0.3, 0.7], soot: 0, rivets: true }, 5);
  const cu = skinMaps(S / 2, { base: '#a8673d', seamsU: 8, seamsV: [0.5], soot: 0.15, patina: 0.6, rivets: false }, 7);
  const bell = skinMaps(S / 2, { base: '#6b4a35', seamsU: 24, seamsV: [], soot: 0.85, patina: 0.2, rivets: false }, 9);
  const finS = skinMaps(S / 2, { base: '#7f3326', seamsU: 3, seamsV: [0.5], soot: 0.5, wear: 0.35, rivets: false }, 11);
  const bumpK = 0.6;
  const M = {
    cream: std('#ffffff', 0.42, 0.15, { map: hull.map, bumpMap: hull.bumpMap, bumpScale: bumpK }),
    capCream: std('#ffffff', 0.42, 0.15, { map: cap.map, bumpMap: cap.bumpMap, bumpScale: bumpK }),
    teal: std('#2a4f54', 0.5, 0.1),
    copper: std('#ffffff', 0.38, 0.9, { map: cu.map, bumpMap: cu.bumpMap, bumpScale: bumpK }),
    bell: std('#ffffff', 0.55, 0.8, { map: bell.map, bumpMap: bell.bumpMap, bumpScale: bumpK }),
    dark: std('#2c2d30', 0.55, 0.6),
    fin: std('#ffffff', 0.5, 0.05, { map: finS.map, bumpMap: finS.bumpMap, bumpScale: bumpK }),
    glass: std('#20262b', 0.06, 0.0, { emissive: '#ffb45a', emissiveIntensity: 0.0, envMapIntensity: 1.6 }), rim: std('#9a9ea4', 0.3, 0.95),
  };
  const group = new THREE.Group(); group.name = 'rocket';
  const parts = {};
  const mk = (id) => { const g = new THREE.Group(); g.name = 'rocket-' + id; group.add(g); parts[id] = g; return g; };
  const add = (g, geo, m, cast = true) => { const o = new THREE.Mesh(geo, m); o.castShadow = cast; o.receiveShadow = true; g.add(o); return o; };
  // hull 1.6 .. 7.4 m
  const body = mk('body');
  add(body, new THREE.LatheGeometry([V(0, 1.6), V(1.06, 1.6), V(1.1, 2.2), V(1.1, 6.6), V(1.02, 7.4), V(0, 7.4)], seg), M.cream);
  for (const y of [2.3, 6.4]) add(body, new THREE.CylinderGeometry(1.115, 1.115, 0.28, seg, 1, true).translate(0, y, 0), M.teal, false);
  add(body, new THREE.CylinderGeometry(1.112, 1.112, 0.06, seg, 1, true).translate(0, 4.4, 0), M.rim, false);
  // engine 0.2 .. 1.7 m
  const engine = mk('engine');
  add(engine, new THREE.LatheGeometry([V(0.45, 1.75), V(0.5, 1.45), V(0.62, 1.0), V(0.84, 0.45), V(0.9, 0.22), V(0.84, 0.22), V(0.56, 0.95), V(0.38, 1.45), V(0.3, 1.75)], seg), M.bell);
  add(engine, new THREE.CylinderGeometry(1.06, 0.98, 0.25, seg).translate(0, 1.62, 0), M.dark);
  // fins (3), feet on the ground
  const fins = mk('fins');
  {
    const s = new THREE.Shape();
    s.moveTo(0, 0); s.lineTo(0, 3.2); s.bezierCurveTo(0.6, 2.4, 1.3, 1.2, 1.55, -0.35); s.lineTo(1.25, -0.35); s.bezierCurveTo(1.0, 0.4, 0.6, 0.2, 0, 0);
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.1, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 2, curveSegments: lite ? 8 : 14 });
    g.translate(0, 0, -0.05);
    // extrude UVs are in metres: squeeze into 0..1 so the fin skin maps once
    const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 1.6, (uv.getY(i) + 0.4) / 3.7);
    const list = [];
    for (let i = 0; i < 3; i++) list.push(g.clone().translate(0.85, 0.35, 0).rotateY(i * (Math.PI * 2 / 3) + Math.PI / 2));
    add(fins, mergeGeometries(list), M.fin);
  }
  // capsule 7.4 .. 9.9 m with a round window
  const capsule = mk('capsule');
  add(capsule, new THREE.LatheGeometry([V(0, 7.4), V(1.02, 7.4), V(0.98, 8.2), V(0.86, 9.3), V(0.74, 9.9), V(0, 9.9)], seg), M.capCream);
  add(capsule, new THREE.CylinderGeometry(1.0, 1.0, 0.18, seg, 1, true).translate(0, 7.55, 0), M.teal, false);
  const win = new THREE.Group(); win.position.set(0, 8.45, 0.93); win.rotation.x = -0.12; capsule.add(win);
  add(win, new THREE.TorusGeometry(0.34, 0.05, 10, 28), M.rim, false);
  const glass = add(win, new THREE.CircleGeometry(0.34, 28), M.glass, false); glass.position.z = 0.01;
  // nose 9.9 .. 13.4 m, copper ogive and a whip antenna
  const nose = mk('nose');
  {
    const pts = []; for (let i = 0; i <= 14; i++) { const t = i / 14; pts.push(V(0.74 * Math.sqrt(1 - t * t * 0.98) * (1 - t * 0.15), 9.9 + t * 3.2)); }
    pts.push(V(0, 13.1)); add(nose, new THREE.LatheGeometry(pts, seg), M.copper);
    add(nose, new THREE.CylinderGeometry(0.012, 0.018, 0.6, 6).translate(0, 13.35, 0), M.rim, false);
    add(nose, new THREE.CylinderGeometry(0.76, 0.76, 0.05, seg, 1, true).translate(0, 9.93, 0), M.rim, false);
  }
  // exhaust flame (additive, hidden until ignition)
  const flameMat = new THREE.MeshBasicMaterial({ color: '#ffc27a', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.7, 4.2, 20, 1, true).rotateX(Math.PI).translate(0, -1.9, 0), flameMat);
  const core = new THREE.Mesh(new THREE.ConeGeometry(0.4, 2.2, 16, 1, true).rotateX(Math.PI).translate(0, -0.9, 0), new THREE.MeshBasicMaterial({ color: '#fff4d8', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  flame.add(core); flame.position.y = 0.25; group.add(flame);
  const light = new THREE.PointLight('#ffb060', 0, 60, 1.6); light.position.y = -1; group.add(light);
  function setFlame(k, t = 0) {
    const f = k * (0.85 + 0.15 * Math.sin(t * 37) * Math.sin(t * 23));
    flameMat.opacity = Math.min(1, f) * 0.85; core.material.opacity = Math.min(1, f);
    flame.scale.set(0.8 + 0.2 * f, 0.6 + 0.6 * f, 0.8 + 0.2 * f);
    light.intensity = f * 60;
  }
  consolidate(group);
  return { group, parts, flame, setFlame, window: M.glass };
}
