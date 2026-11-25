// Little treasures found half-buried in the sand or along the pond edge: pretty pebbles, agates,
// crystals, shells and (rarely) an arrowhead. One or two a day. Tapping one lifts it onto the
// wooden shelf near the bonsai; tapping a shelf item turns it slowly in the light.
import * as THREE from 'three';
import { mulberry32, noise3 } from './util.js';

const TYPES = [['pebble', 36], ['agate', 26], ['crystal', 18], ['shell', 14], ['arrowhead', 6]];
const RARE = { crystal: 1, arrowhead: 1 };
const hashStr = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
const dayKey = (d) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

function rollType(r) {
  let x = r * TYPES.reduce((s, t) => s + t[1], 0);
  for (const [t, w] of TYPES) { if ((x -= w) < 0) return t; }
  return 'pebble';
}

// ---- item builders (each returns a Mesh/Group about 0.3 units across, resting on y=0)
function vcol(g, fn) {
  const p = g.attributes.position, c = new Float32Array(p.count * 3), col = new THREE.Color();
  for (let i = 0; i < p.count; i++) { fn(p.getX(i), p.getY(i), p.getZ(i), col); c.set([col.r, col.g, col.b], i * 3); }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
}
function lump(rnd, sx, sy, sz, rough = 0.18) {
  const g = new THREE.SphereGeometry(1, 22, 16);
  const p = g.attributes.position, o = rnd() * 50;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = 1 + noise3(x * 1.4 + o, y * 1.4, z * 1.4) * rough;
    p.setXYZ(i, x * sx * n, y * sy * n, z * sz * n);
  }
  g.computeVertexNormals();
  return g;
}
const PEBBLE_COLS = [['#d9a6a0', '#f3d6cf'], ['#9fb3a0', '#d5e0cf'], ['#8a9db5', '#cdd8e6'], ['#e0d2b8', '#f6eedf'], ['#b07a5a', '#e2b48e'], ['#6f6a73', '#b5afb8']];
function makePebble(rnd) {
  const g = lump(rnd, 0.15, 0.08, 0.11, 0.15);
  const [a, b] = PEBBLE_COLS[Math.floor(rnd() * PEBBLE_COLS.length)].map((c) => new THREE.Color(c));
  const o = rnd() * 9;
  vcol(g, (x, y, z, c) => { const n = noise3(x * 30 + o, y * 30, z * 30); c.copy(a).lerp(b, 0.5 + n * 0.5); if (n > 0.62) c.multiplyScalar(0.7); });
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38 }));
  m.position.y = 0.07;
  return m;
}
const AGATE = [['#d08a52', '#f2dcc0', '#a85a30'], ['#8aa3bd', '#e4ebf2', '#5f7d9c'], ['#c98a8a', '#f3dede', '#a05a62'], ['#b8a27a', '#efe6d2', '#8c7450']];
function makeAgate(rnd) {
  const g = lump(rnd, 0.14, 0.1, 0.13, 0.12);
  const cv = document.createElement('canvas'); cv.width = 16; cv.height = 256;
  const cx = cv.getContext('2d');
  const [a, b, d] = AGATE[Math.floor(rnd() * AGATE.length)];
  for (let y = 0; y < 256; y++) {
    const band = Math.sin(y * 0.16 + Math.sin(y * 0.045) * 4) * 0.5 + 0.5;
    const c = new THREE.Color(a).lerp(new THREE.Color(band > 0.5 ? b : d), Math.abs(band - 0.5) * (y % 37 < 4 ? 1.6 : 0.9));
    cx.fillStyle = '#' + c.getHexString(); cx.fillRect(0, y, 16, 1);
  }
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.14, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.12 }));
  m.rotation.x = Math.PI / 2 - 0.5; // show the banded 'eye' toward the viewer
  m.position.y = 0.1;
  return m;
}
const XTAL = ['#c8a2ea', '#eaf3ff', '#f4cd78', '#f5bfd0', '#a8e0d8'];
function makeCrystal(rnd) {
  const grp = new THREE.Group();
  const col = new THREE.Color(XTAL[Math.floor(rnd() * XTAL.length)]);
  const mat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.06, metalness: 0.1, transparent: true, opacity: 0.85, emissive: col, emissiveIntensity: 0.18, flatShading: true });
  const base = new THREE.Mesh(lump(rnd, 0.13, 0.05, 0.11, 0.3), new THREE.MeshStandardMaterial({ color: '#8d8478', roughness: 0.9 }));
  base.position.y = 0.03; grp.add(base);
  const n = 3 + Math.floor(rnd() * 3);
  for (let i = 0; i < n; i++) {
    const r = 0.022 + rnd() * 0.02, h = 0.09 + rnd() * 0.13;
    const prism = new THREE.CylinderGeometry(r, r * 1.05, h, 6); prism.translate(0, h / 2, 0);
    const tip = new THREE.ConeGeometry(r, r * 2.2, 6); tip.translate(0, h + r * 1.1, 0);
    const pm = new THREE.Mesh(prism, mat), tm = new THREE.Mesh(tip, mat);
    const g = new THREE.Group(); g.add(pm, tm);
    g.position.set((rnd() - 0.5) * 0.12, 0.04, (rnd() - 0.5) * 0.1);
    g.rotation.set((rnd() - 0.5) * 0.9, rnd() * 6, (rnd() - 0.5) * 0.9);
    grp.add(g);
  }
  return grp;
}
function makeShell(rnd) {
  const NU = 28, NV = 10;
  const pos = [], idx = [], col = [];
  const a = new THREE.Color(['#f3dcc4', '#f6cdbd', '#efe4d2', '#f2c9a8'][Math.floor(rnd() * 4)]), b = new THREE.Color('#c98a6a');
  for (let j = 0; j <= NV; j++) for (let i = 0; i <= NU; i++) {
    const th = (i / NU - 0.5) * 2.3, t = j / NV;
    const rib = Math.pow(0.5 + 0.5 * Math.cos(th * 15), 2) * 0.012 * t;
    const dome = Math.sin(t * Math.PI * 0.85) * 0.05 * (1 - Math.abs(th) * 0.25);
    pos.push(Math.sin(th) * t * 0.15, dome + rib, -Math.cos(th) * t * 0.15 + 0.07);
    const c = a.clone().lerp(b, (Math.sin(t * 18) * 0.5 + 0.5) * 0.35 + rib * 10);
    col.push(c.r, c.g, c.b);
  }
  for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) { const p = j * (NU + 1) + i; idx.push(p, p + NU + 1, p + 1, p + 1, p + NU + 1, p + NU + 2); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, side: THREE.DoubleSide }));
  m.position.y = 0.005;
  return m;
}
function makeArrowhead(rnd) {
  const s = new THREE.Shape();
  s.moveTo(0, 0.17); s.lineTo(0.07, -0.02); s.lineTo(0.05, -0.04); s.lineTo(0.035, -0.035); s.lineTo(0.035, -0.07); s.lineTo(-0.035, -0.07);
  s.lineTo(-0.035, -0.035); s.lineTo(-0.05, -0.04); s.lineTo(-0.07, -0.02); s.lineTo(0, 0.17);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 1, curveSegments: 1 });
  g.translate(0, 0, -0.006);
  const g2 = g.index ? g.toNonIndexed() : g; const p = g2.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); p.setZ(i, z * (1 - Math.abs(x) * 5) + noise3(x * 60, y * 60, 3) * 0.004); }
  g2.computeVertexNormals();
  const obsidian = rnd() < 0.55;
  const m = new THREE.Mesh(g2, new THREE.MeshStandardMaterial({ color: obsidian ? '#1d1b22' : '#9a5a3c', roughness: obsidian ? 0.12 : 0.5, metalness: obsidian ? 0.15 : 0, flatShading: true }));
  m.rotation.x = -Math.PI / 2; m.position.y = 0.02;
  const grp = new THREE.Group(); grp.add(m); grp.scale.setScalar(1.25);
  return grp;
}
const BUILD = { pebble: makePebble, agate: makeAgate, crystal: makeCrystal, shell: makeShell, arrowhead: makeArrowhead };
export function buildFind(type, seed) {
  const o = new THREE.Group();
  const it = BUILD[type](mulberry32(seed));
  it.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  o.add(it);
  return o;
}

// ---- the shelf + finds manager
export function createFinds(scene, { P, state, sand, sandRocks, pond, shelfAt, params, touch }) {
  const group = new THREE.Group(); scene.add(group);
  const S = 0.62; // item display scale on the shelf
  const WORLD_S = touch ? 1.3 : 1.25; // ~12-16 cm: a hand-sized find // finds read a little larger in the sand than on the shelf
  // wooden display shelf (merged planks), faces the usual camera directions
  const shelf = new THREE.Group();
  shelf.position.set(shelfAt.x, 0, shelfAt.z); shelf.rotation.y = shelfAt.ry; shelf.scale.setScalar(0.62); // ~1.55 m wide, 0.8 m tall
  const wood = new THREE.MeshStandardMaterial({ color: '#8a5d3b', roughness: 0.75 });
  const woodDark = new THREE.MeshStandardMaterial({ color: '#5e3d27', roughness: 0.8 });
  const W = 2.5, D = 0.5;
  const plank = (w, h, d, x, y, z, m = wood) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.castShadow = true; b.receiveShadow = true; shelf.add(b); };
  plank(W, 0.06, D, 0, 0.42, 0); plank(W, 0.06, D * 0.9, 0, 0.95, -0.04);
  for (const sx of [-1, 1]) { plank(0.08, 1.12, 0.08, sx * (W / 2 - 0.05), 0.56, D / 2 - 0.06, woodDark); plank(0.08, 1.3, 0.08, sx * (W / 2 - 0.05), 0.65, -D / 2 + 0.04, woodDark); }
  plank(W, 0.07, 0.07, 0, 1.28, -D / 2 + 0.04, woodDark); // top rail
  plank(W, 0.05, 0.05, 0, 0.12, D / 2 - 0.06, woodDark);
  group.add(shelf);
  const slots = [];
  for (let row = 0; row < 2; row++) for (let i = 0; i < 6; i++) {
    const x = -W / 2 + 0.26 + i * ((W - 0.52) / 5), y = row ? 0.98 : 0.45, z = row ? -0.04 : 0.02;
    slots.push(new THREE.Vector3(x, y, z));
  }
  const slotWorld = (i) => shelf.localToWorld(slots[i % slots.length].clone());

  // ---- items already collected
  const items = []; // { id, type, seed, obj, slot, spinT }
  function addToShelf(f, obj, slot) {
    obj = obj || buildFind(f.type, f.seed);
    obj.scale.setScalar(S * 1.25);
    const p = slotWorld(slot); obj.position.copy(p); obj.rotation.set(0, shelfAt.ry + (f.seed % 100) / 40, 0);
    group.add(obj);
    items.push({ ...f, obj, slot, spinT: -1, baseRy: obj.rotation.y });
  }
  const data = state.data;
  // a debug preview can fill the shelf without saving anything
  const preview = params.get('shelf');
  const shown = preview ? Array.from({ length: Math.min(12, +preview || 8) }, (_, i) => ({ id: 'p' + i, type: TYPES[i % 5][0], seed: 1000 + i * 77 })) : data.finds.slice(-12);
  shown.forEach((f, i) => addToShelf(f, null, i));

  // ---- today's finds in the world
  const now = new Date();
  const dk = dayKey(now);
  const r = mulberry32(hashStr(dk));
  const nToday = 1 + (r() < 0.45 ? 1 : 0);
  const pending = [];
  const forced = params.get('find');
  const placeRnd = mulberry32(hashStr(dk + 'p'));
  function spot(inSand) {
    for (let k = 0; k < 60; k++) {
      if (inSand) {
        const x = sand.cx + (placeRnd() - 0.5) * (sand.w - 2), z = sand.cz + (placeRnd() - 0.5) * (sand.d - 2);
        if (sandRocks.every((rk) => Math.hypot(x - rk.x, z - rk.z) > rk.r + 1.6)) return [x, z];
      } else {
        const a = placeRnd() * Math.PI * 2;
        const pr = (pond.radius ? pond.radius(a) : pond.r) + 0.95; const x = pond.cx + Math.cos(a) * pr, z = pond.cz + Math.sin(a) * pr;
        if (z > pond.cz - 1) return [x, z]; // the side facing the camera
      }
    }
    return [sand.cx + 2, sand.cz + 3];
  }
  for (let k = 0; k < nToday; k++) {
    const id = `${dk}#${k}`;
    const type = rollType(r()), seed = Math.floor(r() * 1e6), inSand = r() < 0.6;
    const [x, z] = spot(inSand);
    if (data.finds.some((f) => f.id === id)) continue;
    if (k === 1 && now.getHours() < 12 && !forced) continue; // the second one turns up in the afternoon
    pending.push({ id, type, seed, x, z, inSand });
  }
  if (forced) {
    pending.length = 0;
    pending.push({ id: 'debug', type: BUILD[forced] ? forced : 'agate', seed: 4242, x: sand.cx + 3.0, z: sand.cz + 2.6, inSand: true, debug: true });
  }
  const glintMat = new THREE.SpriteMaterial({ color: '#fff6dc', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, map: (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64); g.fillStyle = 'rgba(255,255,255,0.9)'; g.fillRect(31, 4, 2, 56); g.fillRect(4, 31, 56, 2);
    const t = new THREE.CanvasTexture(c); return t; })() });
  const haloMat = new THREE.MeshBasicMaterial({ map: (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 4, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })(), color: '#fff3d8', transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending });
  const world = pending.map((f, i) => {
    const obj = buildFind(f.type, f.seed);
    obj.scale.setScalar(WORLD_S);
    // half buried: sunk a little and tilted
    obj.position.set(f.x, f.inSand ? 0.02 : -0.02, f.z);
    obj.rotation.set(0.35, f.seed % 6, 0.2);
    group.add(obj);
    const gl = new THREE.Sprite(glintMat.clone()); gl.scale.setScalar(touch ? 0.32 : 0.42); gl.position.set(f.x, 0.1, f.z); group.add(gl);
    // a faint brushed halo in the sand so a half-buried find reads from standing height
    const halo = new THREE.Mesh(new THREE.CircleGeometry(touch ? 0.22 : 0.28, 20).rotateX(-Math.PI / 2), haloMat.clone()); halo.position.set(f.x, 0.012, f.z); halo.material.opacity = touch ? 0.3 : 0.42; group.add(halo);
    return { ...f, obj, gl, halo, phase: i * 2.3, lift: -1 };
  });

  // ---- interaction
  const v = new THREE.Vector3(), sph = new THREE.Sphere();
  function hit(ray) {
    let best = null;
    const test = (p, rr, h) => { sph.set(p, rr); const q = ray.intersectSphere(sph, v); if (q) { const d = q.distanceTo(ray.origin); if (!best || d < best.dist) best = { ...h, dist: d }; } };
    for (const w of world) if (w.lift < 0) test(w.obj.position, touch ? 0.9 : 0.65, { kind: 'find', w });
    for (const it of items) test(it.obj.position, touch ? 0.32 : 0.22, { kind: 'shelf', it });
    return best;
  }
  const flying = [];
  function collect(w, audio) {
    if (w.lift >= 0) return;
    w.lift = 0;
    const slot = (preview ? shown.length : data.finds.length) % slots.length;
    w.from = w.obj.position.clone(); w.to = slotWorld(slot); w.slot = slot;
    if (!w.debug) { data.finds.push({ id: w.id, type: w.type, seed: w.seed, at: Date.now() }); state.save(); }
    // the shelf only shows the latest 12: free the slot it lands in
    const old = items.findIndex((it) => it.slot === slot);
    if (old >= 0) { const it = items[old]; w.replace = it; }
    flying.push(w);
    if (audio) audio.pickup(RARE[w.type] ? 1 : 0);
  }
  function turn(it, audio) {
    if (it.spinT >= 0) return;
    it.spinT = 0;
    if (audio) audio.turn();
  }
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  function update(dt, now, ts, audio) {
    const day = 1 - ts.night;
    for (const w of world) {
      if (w.lift >= 0) { w.gl.material.opacity = 0; continue; }
      // a quick star-glint every ~4 s as the light catches it, plus a faint constant shimmer
      // PC: a little brighter and more frequent, so a hand-sized stone reads from standing height
      const period = touch ? 5.2 : 3.8;
      const k = (now + w.phase) % period;
      const tw = Math.exp(-(((k - 0.35) / (touch ? 0.16 : 0.22)) ** 2));
      const shimmer = touch ? 0.16 : 0.28;
      w.gl.material.opacity = (tw * (touch ? 1.0 : 1.25) + shimmer + 0.07 * Math.sin(now * 3.1 + w.phase)) * (0.4 + day * 0.6);
      w.gl.scale.setScalar((touch ? 0.26 : 0.34) + tw * (touch ? 0.34 : 0.48));
      w.gl.material.rotation = now * 0.3 + tw * 0.6;
    }
    for (let i = flying.length - 1; i >= 0; i--) {
      const w = flying[i];
      w.lift += dt;
      const L = 1.1, A = 2.0;
      if (w.lift < L) {
        const t = ease(w.lift / L);
        w.obj.position.set(w.from.x, w.from.y + t * 0.6, w.from.z); w.halo.material.opacity = 0.3 * (1 - t);
        w.obj.rotation.set(0.35 * (1 - t), w.obj.rotation.y + dt * 1.5, 0.2 * (1 - t));
      } else {
        const t = ease(Math.min(1, (w.lift - L) / A));
        const p = new THREE.Vector3().lerpVectors(w.from, w.to, t);
        p.y = THREE.MathUtils.lerp(w.from.y + 0.6, w.to.y, t) + Math.sin(t * Math.PI) * 0.7;
        w.obj.position.copy(p);
        w.obj.rotation.y += dt * 1.2 * (1 - t);
        w.obj.scale.setScalar(THREE.MathUtils.lerp(WORLD_S, S * 1.25, t));
        if (w.replace && t > 0.6) { group.remove(w.replace.obj); items.splice(items.indexOf(w.replace), 1); w.replace = null; }
        if (t >= 1) {
          flying.splice(i, 1); world.splice(world.indexOf(w), 1); group.remove(w.gl); group.remove(w.halo);
          group.remove(w.obj);
          addToShelf(w, w.obj, w.slot);
          if (audio) audio.place();
        }
      }
    }
    for (const it of items) {
      if (it.spinT < 0) continue;
      it.spinT += dt / 4;
      const t = Math.min(1, it.spinT);
      it.obj.rotation.y = it.baseRy + ease(t) * Math.PI * 2;
      it.obj.position.y = slotWorld(it.slot).y + Math.sin(t * Math.PI) * 0.1;
      if (t >= 1) it.spinT = -1;
    }
  }
  return { group, shelf, hit, collect, turn, update, get count() { return data.finds.length; }, get pending() { return world.length; }, world, items };
}
