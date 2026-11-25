// Gentle creatures: varied body plans built from a few soft shapes, each species from the seed.
// They wander, graze, and drift away if she comes close too fast. None are hostile; none chase.
import * as THREE from 'three';
import { rng, hash, makeName } from './names.js';

const PLANS = ['quad', 'hopper', 'floater', 'crawler', 'strider'];
const PLAN_LABEL = { quad: 'four-legged grazer', hopper: 'hopper', floater: 'drifting floater', crawler: 'many-footed crawler', strider: 'long-legged strider' };

function mat(c, extra = {}) { return new THREE.MeshStandardMaterial({ color: c, roughness: 0.7, ...extra }); }

export function makeSpecies(W, { lite }) {
  const r0 = rng(hash(W.seed, 41));
  const n = 4 + Math.floor(r0() * 3);
  const style = W.dim.creature; // dimension style: soft / tall / round / many
  const list = [];
  const order = [...PLANS].sort(() => r0() - 0.5);
  for (let i = 0; i < n; i++) {
    const r = rng(hash(W.seed, 43, i));
    const plan = order[i % order.length];
    const body = W.C(W.hue + 0.1 + r() * 0.8, 0.45 + r() * 0.3, 0.55 + r() * 0.15);
    const belly = body.clone().offsetHSL(0, -0.15, 0.15), accent = W.C(W.hue + r(), 0.7, 0.6);
    let size = plan === 'strider' ? 1.4 + r() * 1.2 : plan === 'crawler' ? 0.4 + r() * 0.4 : 0.5 + r() * 1.1;
    if (style === 'round') size *= 0.85;
    const biomes = ['forest', 'shore', 'salt', 'crystal', 'ice'].filter(() => r() < 0.55);
    if (!biomes.length) biomes.push('forest');
    list.push({ i, plan, size, body, belly, accent, eyes: 1 + Math.floor(r() * 3), legLen: (style === 'tall' ? 1.6 : 1) * (0.8 + r() * 0.5), round: style === 'round' ? 1.3 : 1,
      speed: (plan === 'crawler' ? 0.5 : plan === 'strider' ? 1.1 : 0.9) * (0.8 + r() * 0.4), shy: 4 + r() * 5, biomes,
      name: makeName(hash(W.seed, 47, i)), label: PLAN_LABEL[plan], herd: plan === 'quad' || plan === 'hopper' ? 2 + Math.floor(r() * 3) : 1, ...buildKit(plan, body, belly, accent, r, lite) });
  }
  return list;
}
// shared geometry + materials per species; build() makes one animal from them
function buildKit(plan, body, belly, accent, r, lite) {
  const seg = lite ? 10 : 16;
  const M = { body: mat(body), belly: mat(belly), accent: mat(accent, { emissive: accent, emissiveIntensity: plan === 'floater' ? 0.6 : 0.15 }), eye: mat('#1b1720', { roughness: 0.2 }), shine: new THREE.MeshBasicMaterial({ color: '#ffffff' }) };
  const G = {
    torso: new THREE.SphereGeometry(0.5, seg, seg * 0.75), head: new THREE.SphereGeometry(0.3, seg, seg * 0.75),
    leg: new THREE.CapsuleGeometry(0.07, 0.5, 3, 6).translate(0, -0.3, 0), eye: new THREE.SphereGeometry(0.06, 8, 6), ear: new THREE.ConeGeometry(0.08, 0.35, 6),
    tendril: new THREE.CapsuleGeometry(0.03, 0.9, 2, 5).translate(0, -0.5, 0), seg: new THREE.SphereGeometry(0.26, seg, seg * 0.6),
  };
  const ears = r() < 0.6, tail = r() < 0.7, spots = r() < 0.5;
  return { M, G, ears, tail, spots };
}
export function buildCreature(S) {
  const { M, G, plan, size } = S;
  const root = new THREE.Group(); const rig = new THREE.Group(); root.add(rig);
  const parts = { legs: [], tend: [], segs: [] };
  const add = (g, m, p, s, parent = rig) => { const o = new THREE.Mesh(g, m); if (p) o.position.set(...p); if (s) o.scale.set(...s); o.castShadow = true; parent.add(o); return o; };
  if (plan === 'quad' || plan === 'strider') {
    const L = (plan === 'strider' ? 1.9 : 0.9) * S.legLen;
    const torso = add(G.torso, M.body, [0, L, 0], plan === 'strider' ? [0.9, 0.55, 1.1] : [0.85 * S.round, 0.7 * S.round, 1.25]);
    add(G.torso, M.belly, [0, L - 0.12, 0], plan === 'strider' ? [0.75, 0.4, 0.9] : [0.7, 0.5, 1.05]);
    const head = new THREE.Group(); head.position.set(0, L + (plan === 'strider' ? 0.15 : 0.35), plan === 'strider' ? 0.55 : 0.7); rig.add(head);
    add(G.head, M.body, [0, 0, 0], [1, 0.95, 1.1], head);
    for (let e = 0; e < S.eyes; e++) { const x = S.eyes === 1 ? 0 : (e / (S.eyes - 1) - 0.5) * 0.3; add(G.eye, M.eye, [x, 0.08, 0.27], null, head); add(G.eye, M.shine, [x + 0.02, 0.11, 0.31], [0.3, 0.3, 0.3], head); }
    if (S.ears) for (const s of [-1, 1]) { const ear = add(G.ear, M.accent, [s * 0.16, 0.3, -0.02], null, head); ear.rotation.z = -s * 0.4; }
    const nLeg = plan === 'strider' ? 6 : 4;
    for (let i = 0; i < nLeg; i++) {
      const side = i % 2 ? 1 : -1, row = Math.floor(i / 2), z = plan === 'strider' ? (row - 1) * 0.35 : row ? -0.35 : 0.35;
      const hip = new THREE.Group(); hip.position.set(side * (plan === 'strider' ? 0.4 : 0.3), L - 0.05, z); rig.add(hip);
      const leg = add(G.leg, M.body, [0, 0, 0], [1, L / 0.6, 1], hip); if (plan === 'strider') hip.rotation.z = side * 0.35;
      parts.legs.push({ hip, phase: (i % 2 ? Math.PI : 0) + row * 1.3, side }); void leg;
    }
    if (S.tail) { const t = add(G.ear, M.accent, [0, L + 0.1, -0.65], [1, 1.6, 1]); t.rotation.x = -2.1; parts.tail = t; }
    parts.head = head; parts.torso = torso;
  } else if (plan === 'hopper') {
    const torso = add(G.torso, M.body, [0, 0.55, 0], [0.8 * S.round, 0.85 * S.round, 0.8 * S.round]);
    add(G.torso, M.belly, [0, 0.5, 0.12], [0.6, 0.65, 0.6]);
    const head = new THREE.Group(); head.position.set(0, 0.95, 0.15); rig.add(head);
    add(G.head, M.body, [0, 0, 0], [1, 1, 1], head);
    for (let e = 0; e < S.eyes; e++) { const x = S.eyes === 1 ? 0 : (e / (S.eyes - 1) - 0.5) * 0.3; add(G.eye, M.eye, [x, 0.06, 0.27], null, head); add(G.eye, M.shine, [x + 0.02, 0.09, 0.31], [0.3, 0.3, 0.3], head); }
    for (const s of [-1, 1]) { const ear = add(G.ear, M.accent, [s * 0.12, 0.36, -0.05], [1, 1.8, 1], head); ear.rotation.z = -s * 0.25; }
    for (const s of [-1, 1]) { const hip = new THREE.Group(); hip.position.set(s * 0.28, 0.42, -0.05); rig.add(hip); add(G.leg, M.belly, [0, 0, 0], [1.6, 0.8, 1.6], hip); parts.legs.push({ hip, phase: 0, side: s }); }
    parts.head = head; parts.torso = torso;
  } else if (plan === 'floater') {
    const bell = add(G.torso, M.accent, [0, 1.6, 0], [1.1, 0.8, 1.1]);
    bell.material = M.accent; add(G.torso, M.belly, [0, 1.48, 0], [0.9, 0.5, 0.9]);
    for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2; const t = add(G.tendril, M.body, [Math.cos(a) * 0.32, 1.35, Math.sin(a) * 0.32]); parts.tend.push({ t, a }); }
    for (let e = 0; e < S.eyes; e++) add(G.eye, M.eye, [(e - (S.eyes - 1) / 2) * 0.18, 1.55, 0.5]);
    parts.torso = bell;
  } else { // crawler: a soft caterpillar of beads
    const n = 6;
    for (let i = 0; i < n; i++) { const s = 1 - i * 0.08; const b = add(G.seg, i % 2 && S.spots ? M.accent : M.body, [0, 0.24 * s, -i * 0.32], [s, s, s]); parts.segs.push(b); }
    const head = new THREE.Group(); head.position.set(0, 0.3, 0.28); rig.add(head);
    add(G.head, M.body, [0, 0, 0], [0.95, 0.95, 0.95], head);
    for (let e = 0; e < S.eyes; e++) { const x = S.eyes === 1 ? 0 : (e / (S.eyes - 1) - 0.5) * 0.26; add(G.eye, M.eye, [x, 0.08, 0.25], null, head); }
    for (const s of [-1, 1]) { const ant = add(G.ear, M.accent, [s * 0.1, 0.32, 0], [0.5, 1.3, 0.5], head); ant.rotation.z = -s * 0.5; }
    parts.head = head;
  }
  root.scale.setScalar(size);
  return { root, rig, parts };
}
// one animal's life: wander / graze / drift away. Returns nothing; mutates `a`.
export function stepCreature(a, dt, t, ctx) {
  const S = a.S, p = a.root.position;
  const dx = ctx.player.x - p.x, dz = ctx.player.z - p.z, dist = Math.hypot(dx, dz);
  if (dist < S.shy * (ctx.playerSpeed > 2 ? 1.5 : 1) && ctx.playerSpeed > 0.3 && a.state !== 'flee') { a.state = 'flee'; a.timer = 3 + Math.random() * 2; const k = 14 / (dist || 1); a.tx = p.x - dx * k; a.tz = p.z - dz * k; }
  a.timer -= dt;
  if (a.timer <= 0) {
    if (a.state === 'walk' || a.state === 'flee') { a.state = 'graze'; a.timer = 2 + Math.random() * 5; }
    else { a.state = 'walk'; a.timer = 4 + Math.random() * 6; const ang = Math.random() * 6.283, d = 4 + Math.random() * 12; a.tx = a.home.x + Math.cos(ang) * d; a.tz = a.home.z + Math.sin(ang) * d; }
  }
  let speed = 0;
  if (a.state !== 'graze') {
    const ex = a.tx - p.x, ez = a.tz - p.z, d = Math.hypot(ex, ez);
    if (d < 0.5) { a.timer = 0; }
    else {
      const want = Math.atan2(ex, ez);
      let dh = want - a.heading; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      a.heading += dh * Math.min(1, dt * 2.5);
      speed = S.speed * (a.state === 'flee' ? 2.4 : 1) * Math.max(0.4, S.size * 0.8);
      const nx = p.x + Math.sin(a.heading) * speed * dt, nz = p.z + Math.cos(a.heading) * speed * dt;
      if (ctx.walkable(nx, nz)) { p.x = nx; p.z = nz; } else { a.timer = 0; a.state = 'graze'; }
    }
  }
  a.speedNow += (speed - a.speedNow) * Math.min(1, dt * 4);
  const gy = ctx.height(p.x, p.z);
  a.root.rotation.y = a.heading;
  const P = a.parts, sp = a.speedNow, ph = (a.phase += dt * (2 + sp * 4 / S.size));
  if (S.plan === 'floater') {
    p.y = gy + 0.3 + Math.sin(t * 0.8 + a.seed) * 0.25;
    for (const q of P.tend) q.t.rotation.x = Math.sin(t * 1.6 + q.a * 2) * 0.25 + sp * 0.3;
    P.torso.scale.y = 0.8 + Math.sin(t * 1.6 + a.seed) * 0.06;
  } else if (S.plan === 'hopper') {
    const hop = sp > 0.05 ? Math.max(0, Math.sin(ph)) * 0.45 : 0;
    p.y = gy + hop * S.size;
    for (const l of P.legs) l.hip.rotation.x = sp > 0.05 ? -Math.cos(ph) * 0.6 : 0;
    if (P.head) P.head.rotation.x = a.state === 'graze' ? 0.4 + Math.sin(t * 3 + a.seed) * 0.1 : 0;
  } else if (S.plan === 'crawler') {
    p.y = gy;
    P.segs.forEach((b, i) => { b.position.x = Math.sin(ph - i * 0.9) * 0.08 * (sp > 0.05 ? 1 : 0.3); b.position.y = 0.24 * (1 - i * 0.08) + Math.max(0, Math.sin(ph - i * 0.9)) * 0.05; });
  } else {
    p.y = gy;
    for (const l of P.legs) l.hip.rotation.x = Math.sin(ph + l.phase) * Math.min(0.7, sp * 0.9);
    if (P.torso) P.torso.position.y = P.torso.position.y * 0.9 + (P.torso.userData.y0 ?? (P.torso.userData.y0 = P.torso.position.y)) * 0.1 + Math.abs(Math.sin(ph)) * 0.02 * sp;
    if (P.head) P.head.rotation.x = a.state === 'graze' ? 0.55 + Math.sin(t * 2.5 + a.seed) * 0.12 : Math.sin(ph * 2) * 0.05;
    if (P.tail) P.tail.rotation.y = Math.sin(t * 2 + a.seed) * 0.4;
  }
}
