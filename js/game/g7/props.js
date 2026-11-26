// Things you can pick up, carry, stack, throw and break. Each is a real rigid body with a
// material: stone shatters into smaller chunks, wood splinters along its grain, ice and crystal
// break into shards that skate across the ground. The smallest pieces can be gathered.
//   const props = createProps({ scene, physics, P, renderer, audio: steps })
import * as THREE from 'three';
import { loadSet } from '../pbr.js';
import { SOLID } from './materials.js';

const rnd = (s) => { let x = Math.sin(s * 12.9898) * 43758.5453; return () => { x = Math.sin(x * 1.13 + 0.71) * 43758.5453; return x - Math.floor(x); }; };
// texture coordinates in metres so a 2 m plank and a 0.5 m block show the same grain size
function metricUV(g, scale = 1) {
  g.computeBoundingBox(); const uv = g.attributes.uv, p = g.attributes.position, n = g.attributes.normal;
  for (let i = 0; i < uv.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    let u, v; if (ax >= ay && ax >= az) { u = p.getZ(i); v = p.getY(i); } else if (ay >= az) { u = p.getX(i); v = p.getZ(i); } else { u = p.getX(i); v = p.getY(i); }
    uv.setXY(i, u * scale, v * scale);
  }
  uv.needsUpdate = true; return g;
}
export function rockGeometry(seed, detail = 1) {
  const g = new THREE.IcosahedronGeometry(1, detail), p = g.attributes.position, r = rnd(seed);
  const a = [0.6 + r() * 0.5, 0.45 + r() * 0.35, 0.6 + r() * 0.5], ph = [r() * 6, r() * 6, r() * 6];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + 0.16 * Math.sin(x * 3.1 + ph[0]) * Math.cos(z * 2.7 + ph[1]) + 0.09 * Math.sin(y * 5.3 + ph[2]);
    p.setXYZ(i, x * a[0] * k, Math.max(y * a[1] * k, -a[1] * 0.55), z * a[2] * k);
  }
  g.deleteAttribute('normal'); const m = THREE.BufferGeometryUtils ? g : g; m.computeVertexNormals();
  return metricUV(m, 0.9);
}
export function createProps({ scene, physics, P, renderer, steps, lite }) {
  const mats = {};
  const tex = {};
  for (const id of ['rock_boulder_dry', 'bark_brown_02', 'wood_planks', 'rough_wood', 'metal_plate', 'japanese_stone_wall']) loadSet(id, P, renderer).then((s) => { tex[id] = s; refresh(); }).catch(() => {});
  function std(key, o) { if (!mats[key]) { mats[key] = new THREE.MeshStandardMaterial(o); refresh(); } return mats[key]; }
  function refresh() {
    const set = (key, id) => { const m = mats[key], s = tex[id]; if (!m || !s) return; m.map = s.diff; m.normalMap = s.nor; m.roughnessMap = s.arm; m.color.set('#fff'); m.needsUpdate = true; };
    set('stone', 'rock_boulder_dry'); set('bark', 'bark_brown_02'); set('wood', 'wood_planks'); set('endgrain', 'rough_wood'); set('metal', 'metal_plate'); set('block', 'japanese_stone_wall');
  }
  const M = {
    stone: () => std('stone', { color: SOLID.stone.color, roughness: 0.95 }),
    block: () => std('block', { color: SOLID.stone.color, roughness: 0.9 }),
    bark: () => std('bark', { color: '#6b4c35', roughness: 0.95 }),
    wood: () => std('wood', { color: SOLID.wood.color, roughness: 0.8 }),
    endgrain: () => std('endgrain', { color: '#b08a62', roughness: 0.9 }),
    metal: () => std('metal', { color: SOLID.metal.color, roughness: 0.45, metalness: 0.8 }),
    ice: () => std('ice', { color: '#d6ecf7', roughness: 0.08, metalness: 0, transparent: true, opacity: 0.82, envMapIntensity: 1.4 }),
    crystal: () => std('crystal', { color: SOLID.crystal.color, roughness: 0.15, emissive: '#5a4fb0', emissiveIntensity: 0.25 }),
    shell: () => std('shell', { color: SOLID.shell.color, roughness: 0.5 }),
  };
  // ---- shapes per kind. size ~ the object's main dimension in metres
  const KINDS = {
    rock: { mat: 'stone', make(s, seed) { const g = rockGeometry(seed, s > 0.5 ? 2 : 1); g.scale(s, s, s); const pts = hullPts(g); return { mesh: new THREE.Mesh(g, M.stone()), shape: { type: 'hull', points: pts, r: s * 0.9, vol: s * s * s * 1.6 } }; } },
    log: { mat: 'wood', make(s, seed) { const r = 0.12 + s * 0.06, hh = s * 0.5; const grp = new THREE.Group(); const g = new THREE.CylinderGeometry(r * (0.9 + rnd(seed)() * 0.1), r, hh * 2, 12, 1, true); metricUV(g, 1.2); grp.add(new THREE.Mesh(g, M.bark())); const cap = new THREE.CircleGeometry(r, 12); for (const sgn of [1, -1]) { const c = new THREE.Mesh(cap, M.endgrain()); c.rotation.x = -sgn * Math.PI / 2; c.position.y = sgn * hh; grp.add(c); } return { mesh: grp, shape: { type: 'cyl', r, hh } }; } },
    plank: { mat: 'wood', make(s) { const hx = s * 0.5, hy = 0.035, hz = 0.11; return { mesh: new THREE.Mesh(metricUV(new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2), 0.8), M.wood()), shape: { type: 'box', hx, hy, hz } }; } },
    splinter: { mat: 'wood', make(s, seed) { const r = rnd(seed); const hx = s * 0.5, hy = 0.03 + r() * 0.03, hz = 0.04 + r() * 0.05; return { mesh: new THREE.Mesh(metricUV(new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2), 0.8), M.wood()), shape: { type: 'box', hx, hy, hz } }; } },
    crate: { mat: 'wood', make(s) { const h = s * 0.5; return { mesh: new THREE.Mesh(metricUV(new THREE.BoxGeometry(s, s, s), 1.1), M.wood()), shape: { type: 'box', hx: h, hy: h, hz: h } }; } },
    block: { mat: 'stone', make(s, seed, dims) { const d = dims || [s, s * 0.5, s * 0.5]; return { mesh: new THREE.Mesh(metricUV(new THREE.BoxGeometry(d[0], d[1], d[2]), 0.7), M.block()), shape: { type: 'box', hx: d[0] / 2, hy: d[1] / 2, hz: d[2] / 2 } }; } },
    beam: { mat: 'wood', make(s, seed, dims) { const d = dims || [s, 0.22, 0.22]; return { mesh: new THREE.Mesh(metricUV(new THREE.BoxGeometry(d[0], d[1], d[2]), 0.8), M.wood()), shape: { type: 'box', hx: d[0] / 2, hy: d[1] / 2, hz: d[2] / 2 } }; } },
    plate: { mat: 'metal', make(s, seed, dims) { const d = dims || [s, 0.06, s * 0.5]; return { mesh: new THREE.Mesh(metricUV(new THREE.BoxGeometry(d[0], d[1], d[2]), 0.8), M.metal()), shape: { type: 'box', hx: d[0] / 2, hy: d[1] / 2, hz: d[2] / 2 } }; } },
    ice: { mat: 'ice', make(s, seed, dims) { const d = dims || [s, s * 0.8, s * 0.9]; return { mesh: new THREE.Mesh(new THREE.BoxGeometry(d[0], d[1], d[2]), M.ice()), shape: { type: 'box', hx: d[0] / 2, hy: d[1] / 2, hz: d[2] / 2 } }; } },
    shard: { mat: 'ice', make(s, seed, dims, matKey = 'ice') { const g = new THREE.OctahedronGeometry(s * 0.5, 0); g.scale(1, 0.35 + rnd(seed)() * 0.3, 0.6); g.computeVertexNormals(); return { mesh: new THREE.Mesh(g, matKey === 'crystal' ? M.crystal() : M.ice()), shape: { type: 'hull', points: hullPts(g), r: s * 0.5, vol: s * s * s * 0.1 } }; } },
    crystal: { mat: 'crystal', make(s, seed) { const grp = new THREE.Group(), r = rnd(seed), pts = []; for (let i = 0; i < 4; i++) { const h = s * (0.5 + r() * 0.6), g = new THREE.CylinderGeometry(0, s * 0.13, h, 6); g.translate(0, h / 2, 0); const m = new THREE.Mesh(g, M.crystal()); m.rotation.set((r() - 0.5) * 0.9, r() * 6, (r() - 0.5) * 0.9); m.position.set((r() - 0.5) * s * 0.3, -s * 0.25, (r() - 0.5) * s * 0.3); grp.add(m); } pts.push(-s * 0.35, -s * 0.3, -s * 0.35, s * 0.35, -s * 0.3, s * 0.35, -s * 0.35, -s * 0.3, s * 0.35, s * 0.35, -s * 0.3, -s * 0.35, 0, s * 0.8, 0); return { mesh: grp, shape: { type: 'hull', points: new Float32Array(pts), r: s * 0.6, vol: s * s * s * 0.15 } }; } },
    shell: { mat: 'shell', make(s, seed) { const g = new THREE.SphereGeometry(s * 0.5, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2); g.scale(1, 0.45, 0.8 + rnd(seed)() * 0.2); return { mesh: new THREE.Mesh(g, M.shell()), shape: { type: 'ball', r: s * 0.3 } }; } },
  };
  function hullPts(g) { const p = g.attributes.position.array; const step = Math.max(3, Math.floor(p.length / 3 / 60) * 3); const out = []; for (let i = 0; i < p.length; i += step) out.push(p[i], p[i + 1], p[i + 2]); return new Float32Array(out); }
  const list = new Set();
  let onGather = null, onChange = null, seqN = 0;
  // the smallest pieces of each material: these you gather rather than break again
  const MIN = { rock: 0.22, log: 0.6, plank: 0.5, splinter: 9, crate: 9, block: 0.3, beam: 0.6, plate: 9, ice: 0.3, shard: 9, crystal: 9, shell: 9 };
  function spawn(kind, size, pos, { quat = null, vel = null, ang = null, seed = Math.random() * 1e4, dims = null, matKey = null, sleep = false, id = null, natural = false, touched = false } = {}) {
    const K = KINDS[kind]; if (!K) return null;
    const { mesh, shape } = K.make(size, seed, dims, matKey);
    mesh.traverse((o) => { if (o.isMesh) { o.castShadow = !lite; o.receiveShadow = true; } });
    scene.add(mesh);
    const mk = matKey || K.mat, S = SOLID[mk] || SOLID.stone;
    const volume = shape.type === 'box' ? 8 * shape.hx * shape.hy * shape.hz : shape.type === 'cyl' ? Math.PI * shape.r * shape.r * shape.hh * 2 : shape.type === 'ball' ? 4.19 * shape.r ** 3 : shape.vol;
    const mass = Math.max(0.2, volume * S.density);
    const b = physics.add({ shape, mass, pos, quat, vel, ang, mesh, friction: S.friction, restitution: S.restitution, sleep, kind, data: {} });
    Object.assign(b.data, { kind, size, seed, dims, mat: mk, id: id || ('p' + Date.now().toString(36) + (++seqN)), natural, touched });
    b.onImpact = (bb, dv) => impact(bb, dv);
    list.add(b); return b;
  }
  // ---- breaking: real smaller pieces, gentle and few (calm, never chaotic)
  const BREAK_V = { stone: 8.5, wood: 9.5, ice: 5.5, crystal: 6.5, shell: 5, metal: 99 };
  let lastSound = 0;
  function impact(b, dv) {
    const S = SOLID[b.data.mat] || SOLID.stone;
    const t = performance.now();
    if (t - lastSound > 60 && dv > 2.5 && steps) { lastSound = t; steps.play(S.step || 'stone', Math.min(1.6, 0.4 + dv * 0.12)); }
    // pieces that gave way from a structure are already cracked: they break on a softer landing
    const k = b.data.fragile ? 0.45 : 1;
    if (dv > k * (BREAK_V[b.data.mat] || 9) * Math.sqrt(Math.max(0.5, b.data.size)) && b.data.size > (MIN[b.data.kind] || 9)) breakBody(b, dv);
  }
  const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _o = new THREE.Vector3();
  function breakBody(b, force = 6) {
    if (!list.has(b)) return [];
    const { kind, size, mat } = b.data, r = rnd(b.data.seed + 1), out = [];
    const base = b.pos.clone(), v = b.vel.clone(), q = b.quat.clone();
    remove(b);
    const push = Math.min(1.6, 0.4 + force * 0.08);
    const piece = (k, s, off, opts = {}) => { _o.copy(off).applyQuaternion(q).add(base); const dir = off.clone().applyQuaternion(q).normalize(); const p = spawn(k, s, _o.clone(), { quat: opts.quat || q, vel: v.clone().multiplyScalar(0.5).addScaledVector(dir, push).add(_v.set(0, 0.6, 0)), ang: new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).multiplyScalar(3), seed: r() * 1e4, dims: opts.dims, matKey: opts.matKey, touched: true }); if (p) out.push(p); };
    if (kind === 'rock') { const n = 3 + (r() > 0.5 ? 1 : 0); for (let i = 0; i < n; i++) { const a = (i / n) * 6.283 + r(); piece('rock', size * (0.5 + r() * 0.12), new THREE.Vector3(Math.cos(a), r() * 0.5, Math.sin(a)).multiplyScalar(size * 0.35)); } }
    else if (kind === 'block' || kind === 'beam' && mat === 'stone') {
      const d = b.data.dims || [size, size * 0.5, size * 0.5];
      // split along the longest side, jittered: chunks of the same stone
      const n = d[0] > 1.2 ? 3 : 2, cuts = []; let acc = 0; for (let i = 0; i < n; i++) { const w = (1 / n) * (0.75 + r() * 0.5); cuts.push(w); acc += w; }
      let x = -d[0] / 2; for (const w0 of cuts) { const w = w0 / acc * d[0]; piece('block', w, new THREE.Vector3(x + w / 2, 0, 0), { dims: [w * 0.96, d[1] * (0.85 + r() * 0.15), d[2] * (0.85 + r() * 0.15)] }); x += w; }
    } else if (kind === 'log') { const hh = size * 0.5; if (size > 1.2) { piece('log', size * 0.5, new THREE.Vector3(0, -hh * 0.5, 0)); piece('log', size * 0.45, new THREE.Vector3(0, hh * 0.5, 0)); } else for (let i = 0; i < 3; i++) { const a = i * 2.1; piece('splinter', size, new THREE.Vector3(Math.cos(a) * 0.06, 0, Math.sin(a) * 0.06), { quat: q.clone().multiply(_q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2)) }); } }
    else if (kind === 'plank' || kind === 'crate' || kind === 'beam') { const n = kind === 'crate' ? 4 : 2; for (let i = 0; i < n; i++) piece(kind === 'beam' ? 'splinter' : 'plank', kind === 'crate' ? size * 0.95 : size * 0.5, new THREE.Vector3((i - (n - 1) / 2) * size * 0.3, (r() - 0.5) * 0.1, (r() - 0.5) * 0.1)); }
    else if (kind === 'ice' || kind === 'crystal' || kind === 'shell') { const n = 4; for (let i = 0; i < n; i++) { const a = i * 1.57 + r(); piece('shard', size * 0.55, new THREE.Vector3(Math.cos(a), 0.2, Math.sin(a)).multiplyScalar(size * 0.3), { matKey: mat === 'shell' ? 'ice' : mat }); } }
    dust(base, mat, size);
    onChange && onChange();
    return out;
  }
  // ---- a soft puff when something breaks
  const puffs = [];
  const puffTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
  function dust(at, mat, size) {
    const col = mat === 'wood' ? '#c9a77f' : mat === 'ice' ? '#eaf6ff' : mat === 'crystal' ? '#d8d2ff' : '#b8ada0';
    for (let i = 0; i < (lite ? 3 : 6); i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTex, color: col, transparent: true, depthWrite: false, opacity: 0.5 }));
      s.position.copy(at).add(_v.set((Math.random() - 0.5) * size, Math.random() * size * 0.5, (Math.random() - 0.5) * size)); s.scale.setScalar(size * 0.6);
      scene.add(s); puffs.push({ s, t: 0, v: new THREE.Vector3((Math.random() - 0.5) * 0.6, 0.35 + Math.random() * 0.3, (Math.random() - 0.5) * 0.6) });
    }
  }
  function update(dt) {
    for (let i = puffs.length - 1; i >= 0; i--) { const p = puffs[i]; p.t += dt; p.s.position.addScaledVector(p.v, dt); p.s.scale.multiplyScalar(1 + dt * 0.8); p.s.material.opacity = 0.5 * Math.max(0, 1 - p.t / 1.8); if (p.t > 1.8) { scene.remove(p.s); p.s.material.dispose(); puffs.splice(i, 1); } }
  }
  function remove(b) { if (!list.has(b)) return; list.delete(b); physics.remove(b); if (b.mesh) { scene.remove(b.mesh); b.mesh.traverse((o) => { if (o.isMesh) o.geometry.dispose(); }); } }
  const gatherable = (b) => (b.data.size <= (MIN[b.data.kind] ?? 0) * 1.01 || ['splinter', 'shard', 'shell', 'plank'].includes(b.data.kind) || (b.data.kind === 'rock' && b.data.size < 0.32));
  // what a body gives back when gathered (by volume, at least one)
  function yieldOf(b) {
    const S = SOLID[b.data.mat] || SOLID.stone; const item = b.data.kind === 'shell' ? 'find:shell' : b.data.kind === 'plank' ? 'mat:wood' : S.item;
    const n = Math.max(1, Math.round(b.volume / 0.02)); return { item, n: Math.min(n, 12) };
  }
  return {
    KINDS, list, spawn, remove, breakBody, update, gatherable, yieldOf, materials: M,
    set onChange(f) { onChange = f; }, set onGather(f) { onGather = f; }, get onGather() { return onGather; },
  };
}
