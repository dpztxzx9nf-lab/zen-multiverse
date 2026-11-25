// A bonsai that grows over real days. First visit + watering days live in localStorage.
// It never wilts: without water it just grows more slowly.
import * as THREE from 'three';
import { makeRock } from './rocks.js';
import { slice, replaceSlice, persist } from './save.js';
import { mulberry32, mergeGeometries, paintColor, smoothstep, fbm3, softBlob } from './util.js';

const KEY = 'zenGarden.bonsai.v1';
const dayStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function loadState() {
  let st = slice('bonsai', () => ({ first: Date.now(), watered: [] }), KEY); // migrates the v1/v2 key once
  if (!st || !st.first) st = replaceSlice('bonsai', { first: Date.now(), watered: [] });
  if (!Array.isArray(st.watered)) st.watered = [];
  return st;
}
function saveState(st) { replaceSlice('bonsai', st); persist(0); }

export function growthFromState(st, now, extraDays = 0) {
  const days = Math.max(0, (now - st.first) / 86400000) + extraDays;
  const w = Math.min(new Set(st.watered).size + extraDays * 0.7, days + 1);
  const pr = Array.isArray(st.pruned) ? Math.min(new Set(st.pruned).size, days + 1) : 0;
  const gp = 0.4 * days + 0.6 * w + 0.15 * pr;
  return 0.16 + 0.84 * (1 - Math.exp(-gp / 40));
}

export function createBonsai(scene, { position, scale = 1, standH = 0.8, debugGrowDays = 0, detail = 2, hitBoost = 1 }) {
  const group = new THREE.Group();
  group.position.copy(position);
  group.scale.setScalar(scale);
  scene.add(group);

  // low dark-wood display stand (built in metres, ~0.8 m high), on a flat stone
  const stand = new THREE.Group(); stand.scale.setScalar(1 / scale); group.add(stand);
  {
    const wood = new THREE.MeshStandardMaterial({ color: '#3b2a20', roughness: 0.55 });
    const W = 1.05, D = 0.62, H = standH;
    const parts = [];
    const box = (w, h, d, x, y, z) => parts.push(new THREE.BoxGeometry(w, h, d).translate(x, y, z));
    box(W, 0.05, D, 0, H - 0.025, 0); box(W - 0.06, 0.04, D - 0.06, 0, H - 0.07, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(0.06, H - 0.05, 0.06, sx * (W / 2 - 0.07), (H - 0.05) / 2, sz * (D / 2 - 0.07));
    for (const sx of [-1, 1]) box(0.04, 0.04, D - 0.14, sx * (W / 2 - 0.07), 0.14, 0);
    box(W - 0.14, 0.04, 0.04, 0, 0.14, 0);
    const m = new THREE.Mesh(mergeGeometries(parts), wood); m.castShadow = true; m.receiveShadow = true; stand.add(m);
    // a bed of dark river gravel under the stand
    const slab = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.9, 0.05, 28).scale(1, 1, 0.75), new THREE.MeshStandardMaterial({ color: '#5d5850', roughness: 1 }));
    slab.position.y = 0.012; slab.receiveShadow = true; stand.add(slab);
  }
  const topY = standH / scale;

  // oval glazed pot
  const potPts = [
    [0.0, 0.0], [0.86, 0.0], [0.9, 0.04], [0.95, 0.3], [1.02, 0.36], [1.0, 0.4], [0.9, 0.4], [0.88, 0.34], [0.0, 0.34],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const potGeo = new THREE.LatheGeometry(potPts, 56).scale(1.25, 1, 0.82);
  const potMat = new THREE.MeshStandardMaterial({ color: '#33505f', roughness: 0.28, metalness: 0.05 });
  const pot = new THREE.Mesh(potGeo, potMat);
  pot.position.y = topY + 0.06;
  pot.castShadow = true; pot.receiveShadow = true;
  group.add(pot);
  for (const [fx, fz] of [[0.7, 0.4], [-0.7, 0.4], [0.7, -0.4], [-0.7, -0.4]]) {
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 0.12), potMat);
    foot.position.set(fx, topY + 0.03, fz);
    group.add(foot);
  }
  // mossy soil
  const soilGeo = new THREE.CircleGeometry(0.89, 40).rotateX(-Math.PI / 2).scale(1.25, 1, 0.82);
  const soil = new THREE.Mesh(soilGeo, new THREE.MeshStandardMaterial({ color: '#4d6a32', roughness: 1 }));
  soil.position.y = topY + 0.06 + 0.35;
  soil.receiveShadow = true;
  group.add(soil);
  const tree = new THREE.Group();
  tree.position.y = soil.position.y;
  tree.position.x = -0.25;
  group.add(tree);

  const barkMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
  let barkMesh = null;
  const MAXB = 1600;
  const blobGeo = softBlob(detail);
  const leafMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85, emissive: '#3a4a18', emissiveIntensity: 0 });
  const foliage = new THREE.InstancedMesh(blobGeo, leafMat, MAXB);
  foliage.castShadow = true; foliage.receiveShadow = true;
  foliage.count = 0;
  tree.add(foliage);

  // ---- fixed structure (seeded)
  const rnd = mulberry32(2026);
  const trunkBends = [0, 0.32, -0.12, 0.26, -0.05, 0.14];
  const trunkBendsZ = [0, 0.1, 0.22, -0.05, 0.12, 0.0];
  const prim = [];
  const hf = [0.32, 0.43, 0.53, 0.62, 0.71, 0.8, 0.88];
  const births = [0.0, 0.0, 0.1, 0.22, 0.35, 0.48, 0.62];
  for (let k = 0; k < hf.length; k++) {
    prim.push({
      hf: hf[k], az: k * 2.45 + 0.6 + (rnd() - 0.5) * 0.4, lf: 1.0 - k * 0.09, el: 0.05 + rnd() * 0.2, b: births[k],
      subs: [0, 1].map((j) => ({ at: 0.5 + j * 0.25, side: j ? 1 : -1, ang: 0.5 + rnd() * 0.4, b: births[k] + 0.14 + j * 0.14, lf: 0.45 + rnd() * 0.15 })),
    });
  }

  function trunkPoint(H, t) {
    const n = trunkBends.length - 1;
    const f = t * n, i = Math.min(n - 1, Math.floor(f)), u = f - i;
    const sm = u * u * (3 - 2 * u);
    const bx = trunkBends[i] + (trunkBends[i + 1] - trunkBends[i]) * sm;
    const bz = trunkBendsZ[i] + (trunkBendsZ[i + 1] - trunkBendsZ[i]) * sm;
    return new THREE.Vector3(bx * H * 0.55, t * H, bz * H * 0.55);
  }

  function taperTube(points, r0, r1, radial = 8) {
    const curve = new THREE.CatmullRomCurve3(points);
    const seg = Math.max(4, points.length * 4);
    const g = new THREE.TubeGeometry(curve, seg, 1, radial, false);
    const p = g.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i <= seg; i++) {
      const t = i / seg;
      const c = curve.getPointAt(t);
      const flare = 1 + Math.pow(Math.max(0, 1 - t * 6), 2) * 0.9 * (r0 > 0.1 ? 1 : 0);
      const r = (r0 + (r1 - r0) * Math.pow(t, 0.8)) * flare;
      for (let j = 0; j <= radial; j++) {
        const idx = i * (radial + 1) + j;
        v.fromBufferAttribute(p, idx).sub(c).multiplyScalar(r).add(c);
        p.setXYZ(idx, v.x, v.y, v.z);
      }
    }
    g.computeVertexNormals();
    return g;
  }

  const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(), tmpP = new THREE.Vector3();
  const colA = new THREE.Color('#2f5a2a'), colB = new THREE.Color('#6f9a3e'), colC = new THREE.Color();

  function build(s) {
    const H = 0.9 + 1.7 * s;
    const trunkR = 0.08 + 0.17 * s;
    const geoms = [];
    const tpts = [];
    for (let i = 0; i <= 8; i++) tpts.push(trunkPoint(H, i / 8));
    geoms.push(taperTube(tpts, trunkR, trunkR * 0.3, 10));
    const pads = [];
    pads.push({ p: trunkPoint(H, 1).add(new THREE.Vector3(0, 0.12, 0)), r: 0.42 + 0.35 * s, m: 1 });
    for (const pr of prim) {
      const m = smoothstep(pr.b, pr.b + 0.16, s);
      if (m <= 0.01) continue;
      const start = trunkPoint(H, pr.hf);
      const len = H * 0.62 * pr.lf * m * (0.6 + 0.4 * s);
      const dir = new THREE.Vector3(Math.cos(pr.az), pr.el, Math.sin(pr.az)).normalize();
      const mid = start.clone().addScaledVector(dir, len * 0.5).add(new THREE.Vector3(0, -0.06 * len, 0));
      const end = start.clone().addScaledVector(dir, len).add(new THREE.Vector3(0, 0.12 * len, 0));
      const br = trunkR * (0.5 - pr.hf * 0.25) * (0.5 + 0.5 * m);
      geoms.push(taperTube([start, mid, end], br, br * 0.35, 6));
      pads.push({ p: end.clone().add(new THREE.Vector3(0, 0.06, 0)), r: (0.3 + 0.32 * s) * (0.6 + 0.4 * m) * (1.05 - pr.hf * 0.35), m });
      for (const sb of pr.subs) {
        const ms = smoothstep(sb.b, sb.b + 0.16, s);
        if (ms <= 0.01) continue;
        const sp = start.clone().addScaledVector(dir, len * sb.at);
        const sdir = dir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), sb.side * sb.ang);
        sdir.y = 0.1; sdir.normalize();
        const sl = len * sb.lf * ms;
        const se = sp.clone().addScaledVector(sdir, sl).add(new THREE.Vector3(0, 0.05, 0));
        geoms.push(taperTube([sp, sp.clone().lerp(se, 0.5).add(new THREE.Vector3(0, -0.03, 0)), se], br * 0.55, br * 0.2, 5));
        pads.push({ p: se.clone().add(new THREE.Vector3(0, 0.04, 0)), r: (0.22 + 0.24 * s) * (0.5 + 0.5 * ms), m: ms });
      }
    }
    const bark = mergeGeometries(geoms.map((g) => paintColor(g, new THREE.Color('#5a4535'))));
    // bark color variation
    const bp = bark.attributes.position, bc = bark.attributes.color;
    for (let i = 0; i < bp.count; i++) {
      const n = fbm3(bp.getX(i) * 6, bp.getY(i) * 14, bp.getZ(i) * 6, 3);
      colC.setHSL(0.07, 0.22 + n * 0.05, 0.22 + n * 0.12);
      bc.setXYZ(i, colC.r, colC.g, colC.b);
    }
    if (barkMesh) { tree.remove(barkMesh); barkMesh.geometry.dispose(); }
    barkMesh = new THREE.Mesh(bark, barkMat);
    barkMesh.castShadow = true; barkMesh.receiveShadow = true;
    tree.add(barkMesh);

    // foliage cloud pads
    const fr = mulberry32(77);
    let n = 0;
    for (const pad of pads) {
      const count = Math.round(10 + 34 * pad.m * (0.5 + s));
      for (let k = 0; k < count && n < MAXB; k++) {
        const a = fr() * Math.PI * 2;
        const rr = Math.sqrt(fr()) * pad.r;
        const yy = (1 - (rr / pad.r) ** 2) * pad.r * 0.42 * fr();
        tmpP.set(pad.p.x + Math.cos(a) * rr, pad.p.y + yy - 0.02, pad.p.z + Math.sin(a) * rr * 0.85);
        const bs = (0.07 + fr() * 0.07) * (0.6 + 0.6 * s) * (0.7 + 0.3 * pad.m);
        tmpS.set(bs * 1.15, bs * 0.7, bs * 1.15);
        tmpQ.setFromEuler(new THREE.Euler(fr() * 0.5, fr() * 6.28, fr() * 0.5));
        tmpM.compose(tmpP, tmpQ, tmpS);
        foliage.setMatrixAt(n, tmpM);
        const top = Math.min(1, (yy / (pad.r * 0.42 + 1e-3)) * 0.8 + fr() * 0.35);
        colC.copy(colA).lerp(colB, top);
        colC.offsetHSL((fr() - 0.5) * 0.03, 0, (fr() - 0.5) * 0.04);
        foliage.setColorAt(n, colC);
        n++;
      }
    }
    foliage.count = n;
    foliage.instanceMatrix.needsUpdate = true;
    if (foliage.instanceColor) foliage.instanceColor.needsUpdate = true;
    foliage.computeBoundingSphere();
    group.updateMatrixWorld(true);
    hit.position.copy(tree.localToWorld(new THREE.Vector3(0, H * 0.5, 0)));
    hit.scale.setScalar(Math.max(1.2, H * 0.7) * scale * hitBoost);
    hit.updateMatrixWorld(true);
    currentH = H;
  }

  // invisible tap target (never added to the scene)
  const hit = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial());
  let currentH = 1;

  const state = loadState();
  let s = growthFromState(state, Date.now(), debugGrowDays);
  build(s);

  // ---- watering sparkle
  const NP = 140;
  const pg = new THREE.BufferGeometry();
  const ppos = new Float32Array(NP * 3), palpha = new Float32Array(NP), psize = new Float32Array(NP), pcol = new Float32Array(NP * 3);
  pg.setAttribute('position', new THREE.BufferAttribute(ppos, 3));
  pg.setAttribute('aAlpha', new THREE.BufferAttribute(palpha, 1));
  pg.setAttribute('aSize', new THREE.BufferAttribute(psize, 1));
  pg.setAttribute('aColor', new THREE.BufferAttribute(pcol, 3));
  const pmat = new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 300 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `attribute float aAlpha; attribute float aSize; attribute vec3 aColor; uniform float uScale; varying float vA; varying vec3 vC;
      void main(){ vA = aAlpha; vC = aColor; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = min(aSize * uScale / -mv.z, uScale * 0.02); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying float vA; varying vec3 vC;
      void main(){ vec2 d = gl_PointCoord - 0.5; float r = length(d); float core = smoothstep(0.5, 0.0, r); float star = max(smoothstep(0.08,0.0,abs(d.x))*smoothstep(0.5,0.0,abs(d.y)), smoothstep(0.08,0.0,abs(d.y))*smoothstep(0.5,0.0,abs(d.x)));
        float a = (core * core + star * 0.6) * vA; if (a < 0.003) discard; gl_FragColor = vec4(vC * a * 2.2, a); }`,
  });
  const points = new THREE.Points(pg, pmat);
  points.frustumCulled = false;
  group.add(points);
  const parts = Array.from({ length: NP }, () => ({ life: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, kind: 0 }));
  let perk = 0, perkV = 0;

  function water(now) {
    const today = dayStr(new Date());
    if (!state.watered.includes(today)) {
      state.watered.push(today);
      if (state.watered.length > 4000) state.watered = state.watered.slice(-4000);
      saveState(state);
    }
    const ns = growthFromState(state, Date.now(), debugGrowDays);
    if (ns > s + 0.001) { s = ns; build(s); }
    perkV += 1.4;
    const top = tree.position.y + currentH + 1.1;
    let spawned = 0;
    for (const p of parts) {
      if (p.life > 0) continue;
      const kind = spawned < 70 ? 0 : 1;
      const a = Math.random() * 6.28, r = Math.sqrt(Math.random()) * currentH * 0.6;
      p.kind = kind;
      p.x = tree.position.x + Math.cos(a) * r; p.z = Math.sin(a) * r * 0.8;
      if (kind === 0) { p.y = top + Math.random() * 0.8; p.vx = 0; p.vz = 0; p.vy = -2.2 - Math.random(); p.max = 1.0 + Math.random() * 0.4; p.delay = Math.random() * 0.5; }
      else { p.y = tree.position.y + currentH * (0.35 + Math.random() * 0.6); p.vx = (Math.random() - 0.5) * 0.2; p.vz = (Math.random() - 0.5) * 0.2; p.vy = 0.25 + Math.random() * 0.3; p.max = 1.6 + Math.random(); p.delay = 0.7 + Math.random() * 0.9; }
      p.life = p.max + p.delay;
      if (++spawned >= 120) break;
    }
  }

  // pruning: a gentle shaping; a few snipped leaves drift down (counts a little toward growth)
  function prune() {
    const today = dayStr(new Date());
    if (!Array.isArray(state.pruned)) state.pruned = [];
    if (!state.pruned.includes(today)) { state.pruned.push(today); if (state.pruned.length > 4000) state.pruned = state.pruned.slice(-4000); saveState(state); }
    const ns = growthFromState(state, Date.now(), debugGrowDays);
    if (ns > s + 0.001) { s = ns; build(s); }
    perkV -= 0.9;
    let spawned = 0;
    for (const p of parts) {
      if (p.life > 0) continue;
      const a = Math.random() * 6.28, r = (0.4 + Math.random() * 0.6) * currentH * 0.75;
      p.kind = 2;
      p.x = tree.position.x + Math.cos(a) * r; p.z = Math.sin(a) * r * 0.8;
      p.y = tree.position.y + currentH * (0.55 + Math.random() * 0.5);
      p.vx = (Math.random() - 0.5) * 0.3; p.vz = (Math.random() - 0.5) * 0.3; p.vy = -0.5 - Math.random() * 0.4;
      p.max = 2.2 + Math.random() * 1.2; p.delay = Math.random() * 1.2;
      p.life = p.max + p.delay;
      if (++spawned >= 46) break;
    }
  }

  let hoverT = 0, hoverV = 0;
  function setHover(on) { hoverT = on ? 1 : 0; }
  function update(dt, now) {
    hoverV += (hoverT - hoverV) * Math.min(1, dt * 4);
    leafMat.emissiveIntensity = hoverV * 0.35 + Math.max(0, perk) * 0.4;
    // spring "perk" after watering (sub-stepped so long frames stay stable)
    const n = Math.ceil(dt / 0.016);
    for (let k = 0; k < n; k++) {
      const h = dt / n;
      perkV += (-perk * 30 - perkV * 5) * h;
      perk += perkV * h;
    }
    const breathe = 1 + Math.sin(now * 0.6) * 0.006 + perk * 0.03;
    foliage.scale.set(breathe, 1 + (breathe - 1) * 1.6, breathe);
    tree.rotation.z = Math.sin(now * 0.4) * 0.006;
    for (let i = 0; i < NP; i++) {
      const p = parts[i];
      if (p.life <= 0) { palpha[i] = 0; continue; }
      p.life -= dt;
      if (p.delay > 0) { p.delay -= dt; palpha[i] = 0; continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const t = 1 - p.life / p.max;
      if (p.kind === 2) {
        p.vx += Math.sin(now * 2.3 + i) * 0.6 * dt; p.vy = Math.max(-0.9, p.vy - 0.6 * dt);
        palpha[i] = Math.min(1, t * 6) * (1 - Math.max(0, (t - 0.8) / 0.2)) * 0.95;
        psize[i] = 0.42;
        pcol[i * 3] = 0.36; pcol[i * 3 + 1] = 0.56; pcol[i * 3 + 2] = 0.24;
      } else if (p.kind === 0) {
        p.vy -= 3 * dt;
        palpha[i] = Math.sin(Math.PI * Math.min(1, t)) * 0.9;
        psize[i] = 0.4;
        pcol[i * 3] = 0.7; pcol[i * 3 + 1] = 0.88; pcol[i * 3 + 2] = 1.0;
      } else {
        palpha[i] = Math.sin(Math.PI * Math.min(1, t)) * (0.6 + 0.4 * Math.sin(now * 20 + i));
        psize[i] = 0.55;
        pcol[i * 3] = 1.0; pcol[i * 3 + 1] = 0.9; pcol[i * 3 + 2] = 0.55;
      }
      ppos[i * 3] = p.x; ppos[i * 3 + 1] = p.y; ppos[i * 3 + 2] = p.z;
    }
    pg.attributes.position.needsUpdate = true;
    pg.attributes.aAlpha.needsUpdate = true;
    pg.attributes.aSize.needsUpdate = true;
    pg.attributes.aColor.needsUpdate = true;
  }

  function setPointScale(px) { pmat.uniforms.uScale.value = px; }

  return { group, hit, water, prune, update, setPointScale, setHover, get growth() { return s; }, get state() { return state; } };
}
