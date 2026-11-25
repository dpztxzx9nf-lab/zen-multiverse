// A friendly retro rocket (~13.5 m) built from five parts in order:
//   body -> engine -> fins -> capsule -> nose. buildRocket() returns { group, parts: {id: Group}, flame, setFlame(k) }
import * as THREE from 'three';
import { mergeGeometries } from '../util.js';

export const ROCKET_PARTS = [
  { id: 'body', name: 'Hull', desc: 'A cream-painted hull, ringed in teal.', cost: { salt: 4, 'find:any': 1 } },
  { id: 'engine', name: 'Engine', desc: 'A copper engine bell and fuel tanks.', cost: { 'find:any': 2, pinecone: 3, salt: 3 } },
  { id: 'fins', name: 'Fins', desc: 'Three swept fins to stand on and fly straight.', cost: { clipping: 2, salt: 3 } },
  { id: 'capsule', name: 'Capsule', desc: 'A cosy capsule with a round window.', cost: { 'flower:any': 3, 'find:any': 1, salt: 4 } },
  { id: 'nose', name: 'Nose cone', desc: 'A copper nose cone, garlanded with flowers.', cost: { 'flower:any': 3, pinecone: 2 } },
];
const V = (x, y) => new THREE.Vector2(x, y);
const std = (color, rough = 0.5, metal = 0, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });

export function buildRocket({ lite = false } = {}) {
  const seg = lite ? 28 : 48;
  const M = {
    cream: std('#efe6d2', 0.45), teal: std('#2f7f86', 0.4), copper: std('#b8703f', 0.35, 0.55), dark: std('#3b3b40', 0.5, 0.4),
    fin: std('#c4603f', 0.5), glass: std('#ffd99a', 0.15, 0, { emissive: '#ffb45a', emissiveIntensity: 0.0 }), rim: std('#8a8f96', 0.35, 0.6),
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
  add(engine, new THREE.LatheGeometry([V(0.45, 1.75), V(0.5, 1.45), V(0.62, 1.0), V(0.84, 0.45), V(0.9, 0.22), V(0.84, 0.22), V(0.56, 0.95), V(0.38, 1.45), V(0.3, 1.75)], seg), M.copper);
  add(engine, new THREE.CylinderGeometry(1.06, 0.98, 0.25, seg).translate(0, 1.62, 0), M.dark);
  // fins (3), feet on the ground
  const fins = mk('fins');
  {
    const s = new THREE.Shape();
    s.moveTo(0, 0); s.lineTo(0, 3.2); s.bezierCurveTo(0.6, 2.4, 1.3, 1.2, 1.55, -0.35); s.lineTo(1.25, -0.35); s.bezierCurveTo(1.0, 0.4, 0.6, 0.2, 0, 0);
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 2, curveSegments: lite ? 8 : 14 });
    g.translate(0, 0, -0.06);
    const list = [];
    for (let i = 0; i < 3; i++) list.push(g.clone().translate(0.85, 0.35, 0).rotateY(i * (Math.PI * 2 / 3) + Math.PI / 2));
    add(fins, mergeGeometries(list), M.fin);
  }
  // capsule 7.4 .. 9.9 m with a round window
  const capsule = mk('capsule');
  add(capsule, new THREE.LatheGeometry([V(0, 7.4), V(1.02, 7.4), V(0.98, 8.2), V(0.86, 9.3), V(0.74, 9.9), V(0, 9.9)], seg), M.cream);
  add(capsule, new THREE.CylinderGeometry(1.0, 1.0, 0.18, seg, 1, true).translate(0, 7.55, 0), M.teal, false);
  const win = new THREE.Group(); win.position.set(0, 8.45, 0.93); win.rotation.x = -0.12; capsule.add(win);
  add(win, new THREE.TorusGeometry(0.34, 0.07, 10, 28), M.rim, false);
  const glass = add(win, new THREE.CircleGeometry(0.34, 28), M.glass, false); glass.position.z = 0.01;
  // nose 9.9 .. 13.4 m, copper ogive with a garland ring and a tiny antenna
  const nose = mk('nose');
  {
    const pts = []; for (let i = 0; i <= 14; i++) { const t = i / 14; pts.push(V(0.74 * Math.sqrt(1 - t * t * 0.98) * (1 - t * 0.15), 9.9 + t * 3.2)); }
    pts.push(V(0, 13.1)); add(nose, new THREE.LatheGeometry(pts, seg), M.copper);
    add(nose, new THREE.CylinderGeometry(0.018, 0.018, 0.5, 6).translate(0, 13.3, 0), M.rim, false);
    // flower garland: a ring of little blossoms
    const fl = []; const n = lite ? 18 : 30;
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; fl.push(new THREE.IcosahedronGeometry(0.075, 0).translate(Math.cos(a) * 0.78, 9.98, Math.sin(a) * 0.78)); }
    const garland = mergeGeometries(fl);
    const cols = ['#e05a8f', '#f3cf4a', '#f6eedf', '#9a7fd0'];
    const c = new Float32Array(garland.attributes.position.count * 3); const cc = new THREE.Color();
    for (let i = 0; i < garland.attributes.position.count; i++) { cc.set(cols[Math.floor(i / 60) % cols.length]); c.set([cc.r, cc.g, cc.b], i * 3); }
    garland.setAttribute('color', new THREE.BufferAttribute(c, 3));
    add(nose, garland, std('#ffffff', 0.7, 0, { vertexColors: true }), false);
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
  return { group, parts, flame, setFlame, window: M.glass };
}
