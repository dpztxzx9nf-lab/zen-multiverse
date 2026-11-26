// Hand-built garden animals in Raked Light ("round the living": river-stone masses, no hard edges):
// a hare and a fox made of soft, slightly flattened ellipsoids on a small rig of pivots, animated in code.
// No skinning, no downloads: each animal is ~20 small meshes sharing one vertex-coloured material per species.
// Countershaded coats (lighter belly, a darker dorsal line) in muted natural colours; ink-dark eyes, ear tips
// and paws (dark, never black: art bible "shadows are ink").
//   const m = buildHare() / buildFox();  scene.add(m.root);  each frame: m.pose(dt, { v, st, t })
// st is the sim state (graze / eat / idle / walk / flee / follow / stalk / chase / rest / dead), v its speed (m/s).
import * as THREE from 'three';

const C = (h) => new THREE.Color(h);
// coat palettes (sRGB): back, flank, belly, ink (eyes, tips, paws), accent (tail, chest)
export const COATS = {
  hare: { back: C('#6f604e'), flank: C('#8a7a64'), belly: C('#d9d0be'), ink: C('#231d18'), accent: C('#ece6d8') },
  fox: { back: C('#7a4d36'), flank: C('#93603f'), belly: C('#e2d7c3'), ink: C('#2a211c'), accent: C('#ece5d6') },
};

// a soft ellipsoid ("stone") with vertex colours from a painter function of the unit-sphere normal
function stone(rx, ry, rz, paint, seg = 14) {
  const g = new THREE.SphereGeometry(1, seg, Math.max(8, Math.round(seg * 0.7)));
  const p = g.attributes.position, n = new THREE.Vector3(), col = new Float32Array(p.count * 3), c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    n.set(p.getX(i), p.getY(i), p.getZ(i));
    // river-stone flattening: the underside is a little flatter than the top
    const y = n.y < 0 ? n.y * 0.86 : n.y;
    p.setXYZ(i, n.x * rx, y * ry, n.z * rz);
    paint(n, c); col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.computeVertexNormals();
  return g;
}
// one continuous soft mass along a spine (so body, chest and neck read as a single river stone, no seams):
// keys [z, y, rx, ry] from tail end to head end, smoothed (Catmull-Rom); the ends close round, not to a point
function loft(keys, paint, rings = 28, around = 18) {
  const pts = keys.map(([z, y]) => new THREE.Vector3(0, y, z)), curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  const rad = (u) => { const f = u * (keys.length - 1), i = Math.min(keys.length - 2, Math.floor(f)), t = f - i, s = t * t * (3 - 2 * t);
    return [keys[i][2] + (keys[i + 1][2] - keys[i][2]) * s, keys[i][3] + (keys[i + 1][3] - keys[i][3]) * s]; };
  const pos = [], col = [], idx = [], c = new THREE.Color(), n = new THREE.Vector3();
  for (let r = 0; r <= rings; r++) {
    const u = r / rings, P = curve.getPoint(u);
    const endK = Math.sqrt(Math.max(0, 1 - Math.pow(Math.abs(u - 0.5) * 2, 6))); // round caps
    const [rx, ry] = rad(u);
    for (let k = 0; k < around; k++) {
      const th = (k / around) * Math.PI * 2, cx = Math.cos(th), cy = Math.sin(th);
      const yy = cy < 0 ? cy * 0.88 : cy; // flatter belly (river stone)
      pos.push(P.x + cx * rx * endK, P.y + yy * ry * endK, P.z);
      n.set(cx, cy, (u - 0.5) * 0.6).normalize(); paint(n, c, u); col.push(c.r, c.g, c.b);
    }
  }
  // end points close the caps
  const a0 = curve.getPoint(0), a1 = curve.getPoint(1), z0 = (rings + 1) * around;
  pos.push(a0.x, a0.y, a0.z - 0.004, a1.x, a1.y, a1.z + 0.004);
  paint(n.set(0, 0, -1), c, 0); col.push(c.r, c.g, c.b); paint(n.set(0, 0, 1), c, 1); col.push(c.r, c.g, c.b);
  for (let r = 0; r < rings; r++) for (let k = 0; k < around; k++) {
    const a = r * around + k, b = r * around + (k + 1) % around, d = a + around, e = b + around; idx.push(a, b, d, b, e, d);
  }
  for (let k = 0; k < around; k++) { idx.push(z0, (k + 1) % around, k); const L = rings * around; idx.push(z0 + 1, L + k, L + (k + 1) % around); }
  if (keys[keys.length - 1][0] < keys[0][0]) for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; } // spine runs -z: keep faces outward
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}
// countershading: belly below, back on top, a slightly darker line along the spine
const counter = (K, o = {}) => (n, c) => {
  const up = n.y;
  c.copy(K.belly).lerp(K.flank, THREE.MathUtils.smoothstep(up, -0.55, 0.05)).lerp(K.back, THREE.MathUtils.smoothstep(up, 0.2, 0.85));
  if (o.spine) c.multiplyScalar(1 - 0.12 * THREE.MathUtils.smoothstep(up, 0.8, 0.98));
  if (o.tip && n.z * o.tip.dir > o.tip.from) c.lerp(o.tip.col, THREE.MathUtils.smoothstep(n.z * o.tip.dir, o.tip.from, o.tip.from + 0.25));
  if (o.chest && n.z > 0.35 && n.y < 0.35) c.lerp(o.chest, THREE.MathUtils.smoothstep(n.z, 0.35, 0.7) * 0.9);
};
const flat = (col) => (n, c) => c.copy(col);
function piv(parent, x, y, z) { const o = new THREE.Object3D(); o.position.set(x, y, z); parent.add(o); return o; }
function put(parent, geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = true; parent.add(m); return m; }
function material() { return new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, envMapIntensity: 0.35 }); }
const eyeMat = new THREE.MeshStandardMaterial({ color: '#16110e', roughness: 0.25, metalness: 0 });

// a two-part leg hanging down from its pivot (upper, then a lower part on a knee pivot)
function leg(parent, mat, K, x, y, z, up, low, r, foot) {
  const hip = piv(parent, x, y, z);
  put(hip, stone(r, up / 2 + r * 0.3, r * 1.05, (n, c) => c.copy(K.flank).lerp(K.back, Math.max(0, n.z) * 0.3)), mat, 0, -up / 2 + r * 0.2, 0);
  const knee = piv(hip, 0, -up * 0.92, 0);
  put(knee, stone(r * 0.72, low / 2 + r * 0.4, r * 0.78, (n, c) => c.copy(K.flank).lerp(K.ink, THREE.MathUtils.smoothstep(-n.y, 0.2, 0.9) * 0.3)), mat, 0, -low / 2 + r * 0.25, 0);
  if (foot) put(knee, stone(r * 0.8, r * 0.6, foot * 0.75, flat(K.flank.clone().lerp(K.belly, 0.25))), mat, 0, -low + r * 0.3, foot * 0.4);
  return { hip, knee, len: up + low };
}

export function buildHare() {
  const K = COATS.hare, mat = material(), root = new THREE.Group(); root.name = 'hare';
  const body = piv(root, 0, 0.2, 0);
  // haunch (big, round) running into a narrower chest and up into the neck: one mass
  put(body, loft([[-0.2, 0.03, 0.05, 0.05], [-0.13, 0.03, 0.105, 0.11], [-0.02, 0.03, 0.1, 0.105], [0.08, 0.04, 0.078, 0.085], [0.15, 0.07, 0.055, 0.06], [0.18, 0.11, 0.035, 0.04]], counter(K, { spine: true })), mat, 0, 0, 0);
  const neck = piv(body, 0, 0.08, 0.15);
  const head = piv(neck, 0, 0.04, 0.03);
  put(head, loft([[-0.05, 0.0, 0.035, 0.04], [-0.01, 0.005, 0.058, 0.06], [0.05, -0.005, 0.05, 0.05], [0.095, -0.02, 0.03, 0.03], [0.11, -0.022, 0.012, 0.012]],
    (n, c, u) => { counter(K)(n, c); if (u > 0.6 && n.y < 0.4) c.lerp(K.belly, 0.6); }, 18, 16), mat, 0, 0, 0);
  for (const s of [-1, 1]) {
    put(head, new THREE.SphereGeometry(0.012, 8, 6), eyeMat, s * 0.047, 0.016, 0.045);
    const ear = piv(head, s * 0.022, 0.045, -0.01); ear.rotation.set(-0.25, 0, s * -0.12);
    // long soft ears with dark tips
    put(ear, stone(0.025, 0.085, 0.012, (n, c) => c.copy(K.flank).lerp(K.ink, THREE.MathUtils.smoothstep(n.y, 0.55, 0.85))), mat, 0, 0.08, 0);
    (s < 0 ? (head.userData.earL = ear) : (head.userData.earR = ear));
  }
  const tail = piv(body, 0, 0.07, -0.19);
  put(tail, stone(0.035, 0.035, 0.03, flat(K.accent)), mat, 0, 0, 0);
  // hind legs: long, folded (thigh forward, long foot flat on the ground); fore legs short and thin
  const legs = {
    hl: leg(body, mat, K, -0.068, 0.0, -0.07, 0.11, 0.1, 0.042, 0.075), hr: leg(body, mat, K, 0.068, 0.0, -0.07, 0.11, 0.1, 0.042, 0.075),
    fl: leg(body, mat, K, -0.04, -0.02, 0.12, 0.08, 0.1, 0.022, 0.03), fr: leg(body, mat, K, 0.04, -0.02, 0.12, 0.08, 0.1, 0.022, 0.03),
  };
  return rigged('hare', root, body, neck, head, tail, legs, { bodyY: 0.2 });
}

export function buildFox() {
  const K = COATS.fox, mat = material(), root = new THREE.Group(); root.name = 'fox';
  const body = piv(root, 0, 0.36, 0);
  // hips, a slim waist, the deep chest with its pale bib: one long mass
  put(body, loft([[-0.27, 0.01, 0.04, 0.04], [-0.2, 0.01, 0.085, 0.09], [-0.05, 0.0, 0.076, 0.082], [0.11, -0.005, 0.094, 0.115], [0.23, 0.03, 0.076, 0.088], [0.29, 0.07, 0.05, 0.055]], counter(K, { spine: true, chest: K.accent })), mat, 0, 0, 0);
  const neck = piv(body, 0, 0.06, 0.25); neck.rotation.x = -0.35;
  put(neck, loft([[-0.04, -0.01, 0.05, 0.06], [0.03, 0.03, 0.058, 0.065], [0.09, 0.08, 0.045, 0.05]], counter(K, { chest: K.accent }), 12, 16), mat, 0, 0, 0);
  const head = piv(neck, 0, 0.09, 0.07);
  // the wedge: broad skull tapering to a slim muzzle, cream cheeks, dark nose tip
  put(head, loft([[-0.06, 0.005, 0.045, 0.045], [-0.02, 0.01, 0.075, 0.062], [0.04, -0.005, 0.055, 0.048], [0.1, -0.02, 0.03, 0.03], [0.135, -0.022, 0.016, 0.016]],
    (n, c, u) => { counter(K, { chest: K.accent })(n, c); if (n.y < 0.1 && u > 0.35) c.lerp(K.accent, 0.75); if (u > 0.93) c.lerp(K.ink, 0.9); }, 20, 16), mat, 0, 0, 0);
  for (const s of [-1, 1]) {
    put(head, new THREE.SphereGeometry(0.011, 8, 6), eyeMat, s * 0.04, 0.018, 0.055);
    const ear = piv(head, s * 0.042, 0.05, -0.012); ear.rotation.set(-0.1, 0, s * -0.28);
    // upright ears, rounded (round the living), dark backs
    put(ear, stone(0.032, 0.05, 0.012, (n, c) => c.copy(n.z < -0.2 ? K.ink : K.flank).lerp(K.ink, THREE.MathUtils.smoothstep(n.y, 0.6, 0.9))), mat, 0, 0.045, 0);
    (s < 0 ? (head.userData.earL = ear) : (head.userData.earR = ear));
  }
  // the brush: three overlapping stones on a chain of pivots, pale tip
  const tail = piv(body, 0, 0.05, -0.27); tail.rotation.x = 0.55;
  // two pivots so the brush can curve; each half one soft mass, the tip pale
  const tail2 = piv(tail, 0, 0, -0.17), segs = [tail, tail2];
  put(tail, loft([[0.02, 0, 0.03, 0.03], [-0.06, 0, 0.055, 0.052], [-0.2, 0, 0.068, 0.064]], counter(K), 12, 16), mat, 0, 0, 0);
  put(tail2, loft([[0.02, 0, 0.066, 0.062], [-0.1, 0, 0.066, 0.062], [-0.2, 0, 0.04, 0.038], [-0.24, 0, 0.012, 0.012]], (n, c, u) => { counter(K)(n, c); c.lerp(K.accent, THREE.MathUtils.smoothstep(u, 0.7, 0.88)); }, 14, 16), mat, 0, 0, 0);
  tail.userData.segs = segs;
  const legs = {
    hl: leg(body, mat, K, -0.055, -0.04, -0.17, 0.17, 0.17, 0.036, 0.045), hr: leg(body, mat, K, 0.055, -0.04, -0.17, 0.17, 0.17, 0.036, 0.045),
    fl: leg(body, mat, K, -0.05, -0.05, 0.19, 0.15, 0.17, 0.03, 0.04), fr: leg(body, mat, K, 0.05, -0.05, 0.19, 0.15, 0.17, 0.03, 0.04),
  };
  for (const L of Object.values(legs)) L.knee.children.forEach((m, i) => { if (i === 0 && m.geometry) { /* dark socks */ const col = m.geometry.attributes.color; for (let k = 0; k < col.count; k++) col.setXYZ(k, ...new THREE.Color(col.getX(k), col.getY(k), col.getZ(k)).lerp(K.ink, 0.55).toArray()); } });
  return rigged('fox', root, body, neck, head, tail, legs, { bodyY: 0.36 });
}

// the procedural animation. Gaits come from speed: the hare walks in small hops and bounds when running
// (fore legs together, hind legs together, a flight phase); the fox walks, trots (diagonal pairs) and gallops.
function rigged(kind, root, body, neck, head, tail, legs, o) {
  const hare = kind === 'hare';
  const base = { neckX: neck.rotation.x, tailX: tail.rotation.x };
  let rest = 0, ph = Math.random(), look = 0, lookT = 0, lookTo = 0, twT = 1 + Math.random() * 3, tw = 0, low = 0, lean = 0, breath = Math.random() * 6;
  const S = { v: 0 };
  function pose(dt, { v = 0, st = 'idle', t = 0 } = {}) {
    S.v += (v - S.v) * Math.min(1, dt * 6); const sp = S.v;
    breath += dt;
    // gait phase: one cycle per stride; stride grows with speed (a running animal reaches further)
    const stride = hare ? 0.28 + sp * 0.16 : 0.42 + sp * 0.12;
    ph = (ph + (sp / stride) * dt) % 1;
    const w = Math.min(1, sp / 0.4); // 0 standing .. 1 moving
    const run = THREE.MathUtils.smoothstep(sp, hare ? 2.0 : 3.2, hare ? 3.5 : 5.0);
    const crouch = st === 'stalk' ? 1 : 0;
    low += (crouch - low) * Math.min(1, dt * 3);
    rest += ((st === 'rest' && sp < 0.2 ? 1 : 0) - rest) * Math.min(1, dt * 1.5); // lying down: legs folded under
    const graze = (st === 'graze' || st === 'eat') && sp < 0.2 ? 1 : 0;
    lean += (graze - lean) * Math.min(1, dt * 2.5);
    const a = ph * Math.PI * 2;
    let bodyY = o.bodyY - low * (hare ? 0.04 : 0.07), pitch = 0;
    const L = legs;
    if (hare) {
      // hop / bound: hind legs push together, fore legs reach together half a cycle later
      const push = Math.sin(a), lift = Math.max(0, Math.sin(a)) * (0.03 + 0.09 * run) * w;
      bodyY += lift; pitch = -Math.cos(a) * (0.12 + 0.2 * run) * w;
      const hind = Math.sin(a + 0.4) * (0.5 + 0.6 * run) * w, fore = Math.sin(a + Math.PI) * (0.5 + 0.5 * run) * w;
      for (const k of ['hl', 'hr']) { L[k].hip.rotation.x = 0.55 - hind + low * 0.4; L[k].knee.rotation.x = -1.0 + Math.max(0, push) * 0.7 * w - low * 0.3; }
      for (const k of ['fl', 'fr']) { L[k].hip.rotation.x = -fore * 0.9 + low * 0.2; L[k].knee.rotation.x = Math.max(0, -Math.sin(a)) * 0.6 * w; }
    } else {
      // fox: walk / trot on diagonal pairs (fl+hr, fr+hl); gallop = pairs nearly together with a bound
      const gal = run, sw = (0.35 + 0.25 * w) * w;
      const pFL = a, pHR = a + gal * 0.6, pFR = a + Math.PI * (1 - gal * 0.85), pHL = a + Math.PI * (1 - gal * 0.85) + gal * 0.6;
      const swing = (L0, p, k) => { L0.hip.rotation.x = Math.sin(p) * sw * k + low * (k > 0 ? 0.5 : -0.35); L0.knee.rotation.x = (k > 0 ? 1 : -1) * Math.max(0, Math.cos(p)) * 0.7 * w + low * (k > 0 ? 0.6 : -0.9); };
      swing(L.fl, pFL, 1); swing(L.fr, pFR, 1); swing(L.hl, pHL, -1); swing(L.hr, pHR, -1);
      bodyY += (Math.abs(Math.sin(a * 2)) * 0.012 * (1 - gal) + Math.max(0, Math.sin(a)) * 0.05 * gal) * w;
      pitch = Math.sin(a) * 0.08 * gal * w;
    }
    if (rest > 0.01) { // fold: fore legs forward along the ground (fox) or tucked (hare), hind legs folded flat
      const k = rest, mix = (o, v) => o + (v - o) * k;
      for (const n of ['hl', 'hr']) { L[n].hip.rotation.x = mix(L[n].hip.rotation.x, hare ? 1.0 : -1.25); L[n].knee.rotation.x = mix(L[n].knee.rotation.x, hare ? -2.0 : 2.4); }
      for (const n of ['fl', 'fr']) { L[n].hip.rotation.x = mix(L[n].hip.rotation.x, hare ? -0.9 : -1.45); L[n].knee.rotation.x = mix(L[n].knee.rotation.x, hare ? 1.2 : 0.1); }
      bodyY = mix(bodyY, hare ? 0.1 : 0.11); pitch *= 1 - k;
    }
    body.position.y = bodyY; body.rotation.x = pitch + (hare ? 0 : low * 0.06);
    body.scale.y = 1 + Math.sin(breath * (sp > 2 ? 9 : 3)) * 0.015; // breathing, quicker after a run
    // head: grazing goes down to the grass; otherwise it looks around now and then
    if ((lookT -= dt) <= 0) { lookT = 1.5 + Math.random() * 3.5; lookTo = sp > 0.5 ? 0 : (Math.random() - 0.5) * 1.4; }
    look += (lookTo - look) * Math.min(1, dt * 3);
    neck.rotation.x = base.neckX + lean * (hare ? 0.9 : 0.8) - (st === 'stalk' ? -0.25 : 0) + run * 0.25 - pitch * 0.6;
    neck.rotation.y = look * (1 - lean * 0.6);
    head.rotation.x = lean * (hare ? 0.35 + Math.sin(breath * 14) * 0.06 : 0.2); // nibbling
    // ears: hare ears lie back when running and flick at rest; fox ears prick forward when stalking
    if ((twT -= dt) <= 0) { twT = 1.2 + Math.random() * 4; tw = 1; }
    tw = Math.max(0, tw - dt * 5);
    const eL = head.userData.earL, eR = head.userData.earR;
    if (hare) { const back = run * 0.9 + (st === 'rest' ? 0.8 : 0); eL.rotation.x = -0.25 - back - tw * 0.3; eR.rotation.x = -0.25 - back + tw * 0.15; }
    else { const fwd = st === 'stalk' || st === 'chase' ? 0.25 : 0; eL.rotation.x = -0.1 + fwd - tw * 0.25; eR.rotation.x = -0.1 + fwd; }
    // tail: the hare's flashes up when it bolts; the fox's brush streams behind at speed and sways at rest
    if (hare) tail.rotation.x = -run * 0.6;
    else {
      tail.rotation.x = base.tailX - run * 0.45 - low * 0.25;
      tail.rotation.y = Math.sin(breath * 1.3) * 0.25 * (1 - w) + Math.sin(a) * 0.12 * w;
      for (const s of tail.userData.segs.slice(1)) s.rotation.x = -0.12 + run * 0.08;
    }
    root.visible = st !== 'dead';
  }
  return { root, kind, pose, rig: { body, neck, head, tail, legs } };
}
