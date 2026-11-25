// A shy horned lizard (Phrynosoma platyrhinos), true size (~9.5 cm nose to tail tip).
// Wide teardrop body tapering into a distinct tail about half the body length, a triangular
// head clearly separated by a short neck, a crown of 4–6 backward horns (the centre pair
// longest), and a single fringe of scales along each side. Muted sandy tan/gray with dark
// paired blotches — desert camouflage, not orange. It suns on a small flat stone at the
// sand's edge. Touch it and it scurries off, then shimmies into the sand.
import * as THREE from 'three';
import { mulberry32, mergeGeometries, noise3 } from './util.js';

// muted sandy gray-tan: paired dark blotches with pale rims, a faint mid-line, fine speckle
function skinMaps() {
  const N = 128, c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d'), img = g.createImageData(N, N);
  const bumpC = document.createElement('canvas'); bumpC.width = bumpC.height = N;
  const bg = bumpC.getContext('2d'), bimg = bg.createImageData(N, N);
  const base = [168, 156, 132], dark = [70, 62, 50], pale = [206, 198, 178], cool = [148, 144, 130];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N - 0.5, v = y / N;
    let col = base.slice();
    const n = noise3(x * 0.16, y * 0.16, 1.7) * 0.5 + noise3(x * 0.48, y * 0.48, 4.2) * 0.28;
    col = col.map((cv, i) => cv + (cool[i] - cv) * (0.2 + n * 0.35));
    let blotch = 0;
    for (const s of [-1, 1]) for (const bv of [0.24, 0.40, 0.56, 0.70]) {
      const d = Math.hypot((u - s * 0.15) * 2.4, (v - bv) * 3.6) + n * 0.14;
      const rim = Math.exp(-((d - 0.18) ** 2) / 0.0035);
      const core = 1 - Math.min(1, Math.max(0, (d - 0.04) / 0.12));
      col = col.map((cv, i) => cv + (pale[i] - cv) * rim * 0.28);
      col = col.map((cv, i) => cv + (dark[i] - cv) * core * 0.42);
      blotch = Math.max(blotch, core);
    }
    const spine = Math.exp(-(u * u) / 0.0008) * (v > 0.12 && v < 0.82 ? 1 : 0);
    col = col.map((cv, i) => cv + (pale[i] - cv) * spine * 0.5);
    const sp = (noise3(x * 1.4, y * 1.4, 9.1) > 0.38 ? 12 : 0) - (noise3(x * 1.15, y * 1.15, 3.3) > 0.42 ? 16 : 0);
    const k = (y * N + x) * 4;
    img.data[k] = col[0] + n * 14 + sp; img.data[k + 1] = col[1] + n * 12 + sp; img.data[k + 2] = col[2] + n * 10 + sp; img.data[k + 3] = 255;
    const bh = Math.max(0, Math.min(255, 128 + n * 70 + blotch * 36 + sp * 2));
    bimg.data[k] = bh; bimg.data[k + 1] = bh; bimg.data[k + 2] = bh; bimg.data[k + 3] = 255;
  }
  g.putImageData(img, 0, 0); bg.putImageData(bimg, 0, 0);
  const map = new THREE.CanvasTexture(c); map.colorSpace = THREE.SRGBColorSpace;
  const bumpMap = new THREE.CanvasTexture(bumpC);
  return { map, bumpMap };
}
function planarUV(geo, hw = 0.036, z0 = -0.072, z1 = 0.050) {
  const p = geo.attributes.position, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) { uv[i * 2] = 0.5 + p.getX(i) / (2 * hw); uv[i * 2 + 1] = (p.getZ(i) - z0) / (z1 - z0); }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}
const tint = (geo, hex) => { const c = new THREE.Color(hex), n = geo.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3); geo.setAttribute('color', new THREE.BufferAttribute(a, 3)); return geo; };
const prep = (geo, hex = '#ffffff') => { if (geo.index) geo = geo.toNonIndexed(); planarUV(geo); return tint(geo, hex); };

// body width profile: u=0 at the neck, u=1 at the tail join. Rounded ends, wide shoulders,
// a gentle taper — a fat teardrop/oval, not a diamond that pinches to a point at both ends.
function teardropW(u) {
  const peak = 0.30, w0 = 0.64, wp = 1.0, w1 = 0.42;
  u = Math.min(1, Math.max(0, u));
  if (u < peak) {
    const t = u / peak;
    return w0 + (wp - w0) * (1 - (1 - t) * (1 - t));
  }
  const t = (u - peak) / (1 - peak);
  return wp + (w1 - wp) * (t * t * (3 - 2 * t));
}

function makeRevolve(z0, z1, rings, segs, radiusFn, yFn) {
  const pos = [], idx = [];
  for (let j = 0; j <= rings; j++) {
    const u = j / rings, z = z0 + (z1 - z0) * u, rx = radiusFn(u);
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2, cx = Math.cos(a), cy = Math.sin(a);
      pos.push(cx * rx, yFn(u, cy), z);
    }
  }
  for (let j = 0; j < rings; j++) for (let i = 0; i < segs; i++) {
    const a = j * (segs + 1) + i, b = a + segs + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function buildLizard(skinMat, sandMat, rnd) {
  const root = new THREE.Group();
  // Body: 5.2 cm long, ~5.6 cm wide at the shoulders, very flat, rounded teardrop.
  const bodyLen = 0.052, bodyZ0 = 0.022, bodyZ1 = bodyZ0 - bodyLen;
  const bodyG = makeRevolve(bodyZ0, bodyZ1, 22, 32,
    (u) => 0.028 * teardropW(u),
    (u, cy) => cy * 0.0064 * (cy < 0 ? 0.32 : 1) * (0.9 + 0.1 * teardropW(u)) + 0.0070
  );
  const body = new THREE.Mesh(prep(bodyG), skinMat);
  body.castShadow = true;
  root.add(body);

  const tailG = makeRevolve(-0.028, -0.056, 10, 12,
    (u) => 0.0078 * (1 - 0.82 * u),
    (u, cy) => cy * 0.0032 * (1 - 0.5 * u) + 0.0062
  );
  const tail = new THREE.Mesh(prep(tailG, '#c8beaa'), sandMat);
  tail.castShadow = true;
  root.add(tail);

  const neck = new THREE.SphereGeometry(1, 14, 10); neck.scale(0.009, 0.0058, 0.0075); neck.translate(0, 0.0074, 0.026);
  root.add(new THREE.Mesh(prep(neck, '#c2b6a0'), sandMat));

  for (const s of [-1, 1]) for (let k = 0; k < 10; k++) {
    const t = k / 9, u = 0.08 + t * 0.84, z = bodyZ0 + (bodyZ1 - bodyZ0) * u;
    const w = 0.028 * teardropW(u);
    const len = 0.0058 - Math.abs(t - 0.35) * 0.0032;
    const sp = new THREE.ConeGeometry(0.0014, len, 4); sp.rotateZ(-s * Math.PI / 2); sp.rotateY(s * 0.12);
    sp.translate(s * (w + len * 0.35), 0.0072, z);
    const fringe = new THREE.Mesh(prep(sp, '#c6bba8'), sandMat);
    fringe.castShadow = true;
    root.add(fringe);
  }

  const head = new THREE.Group(); head.position.set(0, 0.0082, 0.030); root.add(head);
  const skullG = makeRevolve(0.001, 0.016, 8, 16,
    (u) => 0.013 * (1 - 0.78 * u),
    (u, cy) => cy * 0.0054 * (1 - 0.2 * u) * (cy < 0 ? 0.55 : 1) + 0.0012
  );
  const headMesh = new THREE.Mesh(prep(skullG, '#c8bca8'), skinMat);
  headMesh.castShadow = true; head.add(headMesh);

  const hornCol = '#c2b49a';
  const hornParts = [];
  for (const H of [
    { s: -1, yaw: 0.10, len: 0.0145, x: 0.0026 },
    { s: 1, yaw: -0.10, len: 0.0145, x: 0.0026 },
    { s: -1, yaw: 0.40, len: 0.010, x: 0.0064 },
    { s: 1, yaw: -0.40, len: 0.010, x: 0.0064 },
    { s: -1, yaw: 0.70, len: 0.0065, x: 0.0092 },
    { s: 1, yaw: -0.70, len: 0.0065, x: 0.0092 },
  ]) {
    const h = new THREE.ConeGeometry(0.0017 * (H.len / 0.012), H.len, 5);
    h.rotateX(0.95); // tip starts +Y; tilt back toward the body (~54°)
    h.rotateY(H.yaw);
    h.translate(H.s * H.x, 0.0060, 0.0004);
    hornParts.push(prep(h, hornCol));
  }
  const hornMesh = new THREE.Mesh(mergeGeometries(hornParts), sandMat);
  hornMesh.castShadow = true; head.add(hornMesh);

  for (const s of [-1, 1]) {
    const e = new THREE.SphereGeometry(0.00125, 8, 6);
    e.translate(s * 0.0078, 0.0032, 0.0075);
    const eye = new THREE.Mesh(tint(e.toNonIndexed(), '#1a1612'), new THREE.MeshStandardMaterial({ color: '#1a1612', roughness: 0.35, metalness: 0.05 }));
    eye.castShadow = true; head.add(eye);
    const hi = new THREE.SphereGeometry(0.0004, 6, 4);
    hi.translate(s * 0.0083, 0.0036, 0.0082);
    head.add(new THREE.Mesh(tint(hi.toNonIndexed(), '#e8e4dc'), new THREE.MeshStandardMaterial({ color: '#e8e4dc', roughness: 0.4 })));
  }
  const throat = new THREE.Mesh(prep(new THREE.SphereGeometry(0.0055, 10, 6), '#d2c8b4'), sandMat);
  throat.scale.set(1, 0.4, 1); throat.position.set(0, -0.0025, 0.006); head.add(throat);

  const legs = [];
  for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    const u = sz > 0 ? 0.22 : 0.62;
    const w = 0.028 * teardropW(u);
    const hip = new THREE.Group(); hip.position.set(sx * w * 0.88, 0.0068, bodyZ0 + (bodyZ1 - bodyZ0) * u); root.add(hip);
    const lg = [];
    const upper = new THREE.CapsuleGeometry(0.0024, 0.009, 3, 6); upper.rotateZ(-sx * 1.15); upper.translate(sx * 0.007, -0.0005, 0);
    lg.push(prep(upper, '#c2b8a4'));
    const lower = new THREE.CapsuleGeometry(0.0020, 0.0065, 3, 6); lower.rotateZ(-sx * 0.25); lower.translate(sx * 0.014, -0.0058, sz * 0.001);
    lg.push(prep(lower, '#b8ae9a'));
    const foot = new THREE.SphereGeometry(1, 8, 6); foot.scale(0.0050, 0.0015, 0.0040); foot.translate(sx * 0.018, -0.0084, sz * 0.0012);
    lg.push(prep(foot, '#b0a690'));
    for (let t = 0; t < 4; t++) {
      const toe = new THREE.ConeGeometry(0.0005, 0.0034, 3); toe.rotateZ(-sx * 1.1);
      toe.translate(sx * 0.021, -0.0084, sz * 0.0012 + (t - 1.5) * 0.0019);
      lg.push(prep(toe, '#a89e8a'));
    }
    const leg = new THREE.Mesh(mergeGeometries(lg), sandMat); leg.castShadow = true; hip.add(leg);
    legs.push({ hip, sx, sz });
  }
  return { root, body, head, throat, legs };
}

export function createLizard(scene, { rock, surfaceY, params, sand }) {
  const rnd = mulberry32(Date.now() & 0xffff);
  const maps = skinMaps();
  const mat = new THREE.MeshStandardMaterial({ map: maps.map, bumpMap: maps.bumpMap, bumpScale: 0.28, vertexColors: true, roughness: 0.92 });
  const sandMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, color: '#ffffff' });
  const L = buildLizard(mat, sandMat, mulberry32(77));
  const g = new THREE.Group(); g.add(L.root); g.visible = false; g.name = 'lizard';
  scene.add(g);
  const puffG = new THREE.BufferGeometry(); const puffP = new Float32Array(14 * 3); puffG.setAttribute('position', new THREE.BufferAttribute(puffP, 3));
  const puff = new THREE.Points(puffG, new THREE.PointsMaterial({ color: '#e3d2b0', size: 0.006, transparent: true, opacity: 0 }));
  puff.frustumCulled = false; scene.add(puff);
  const grains = Array.from({ length: 14 }, () => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 }));
  const forced = params.get('surprise') === 'lizard' || params.has('lizard');
  const top = new THREE.Vector3(rock.x, 0, rock.z);
  let state = 'away', t = 0, away = forced ? 0 : 20 + Math.random() * 60, flee = null;
  let nextPuff = 3, puffT = -1, nextTurn = 2, headAim = 0, headTilt = 0, nextPush = 9, pushT = -1;
  let nextBob = 3.5, bobT = -1;
  const block = Math.floor(Date.now() / (20 * 60 * 1000));
  const likes = forced || mulberry32(block * 13 + 5)() < 0.65;
  function canBask(ts, season) {
    return forced || (likes && ts.elev > 14 && !ts.overcast && season.season !== 'winter' && season.weather === 'clear');
  }
  const sph = new THREE.Sphere(), hp = new THREE.Vector3();
  function hit(ray, touch = false) {
    if (state !== 'bask' && state !== 'arrive') return null;
    sph.set(g.position.clone().add(new THREE.Vector3(0, 0.03, 0)), touch ? 0.32 : 0.22);
    const p = ray.intersectSphere(sph, hp);
    return p ? { kind: 'lizard', dist: p.distanceTo(ray.origin) } : null;
  }
  function scare() {
    if (state !== 'bask' && state !== 'arrive') return false;
    state = 'flee'; t = 0;
    const a = rnd() * Math.PI * 2, d = (rock.r || 0.4) + 0.9 + rnd() * 0.5;
    const end = new THREE.Vector3(rock.x + Math.cos(a) * d, 0.0, rock.z + Math.sin(a) * d);
    end.x = THREE.MathUtils.clamp(end.x, sand.cx - sand.w / 2 + 0.3, sand.cx + sand.w / 2 - 0.3);
    end.z = THREE.MathUtils.clamp(end.z, sand.cz - sand.d / 2 + 0.3, sand.cz + sand.d / 2 - 0.3);
    flee = { from: g.position.clone(), end, heading: Math.atan2(end.x - g.position.x, end.z - g.position.z) };
    return true;
  }
  // faces the stepping-stone path (+z, south) so the wedge head and horns read from a walk-by
  const baseRy = 0.15;
  function legs(phase, amp) {
    for (const l of L.legs) {
      const diag = (l.sx * l.sz > 0) ? 0 : Math.PI;
      l.hip.rotation.y = Math.sin(phase + diag) * amp * l.sx;
      l.hip.rotation.z = Math.max(0, Math.sin(phase + diag + 1.2)) * amp * 0.5 * l.sx;
    }
  }
  function update(dt, now, ts, season) {
    t += dt;
    if (puffT >= 0) {
      puffT += dt;
      const pa = puff.geometry.attributes.position;
      grains.forEach((q, i) => { q.vy -= 1.6 * dt; q.x += q.vx * dt; q.y = Math.max(0.002, q.y + q.vy * dt); q.z += q.vz * dt; pa.setXYZ(i, q.x, q.y, q.z); });
      pa.needsUpdate = true; puff.material.opacity = Math.max(0, 0.8 - puffT * 0.6);
      if (puffT > 1.6) puffT = -1;
    }
    if (state === 'away') {
      away -= dt;
      if (away < 0 && canBask(ts, season)) { state = 'arrive'; t = 0; g.visible = true; top.y = surfaceY(top.x, top.z) - 0.001; g.position.copy(top); g.rotation.set(0, baseRy, 0); }
      else if (away < 0) away = 30;
      return;
    }
    if (state === 'arrive') {
      const k = Math.min(1, t / 2.5);
      L.root.position.y = -0.022 * (1 - k); legs(t * 9, 0.35 * (1 - k));
      if (k >= 1) { state = 'bask'; t = 0; legs(0, 0); }
    }
    if (state === 'bask') {
      L.body.scale.set(1, 1 + Math.sin(now * 2.2) * 0.04, 1);
      const sway = Math.sin(now * 0.65) * 0.04;
      L.root.rotation.z = sway;
      L.body.rotation.y = Math.sin(now * 0.32) * 0.025;
      nextPuff -= dt;
      if (nextPuff < 0) { nextPuff = 5 + rnd() * 6; }
      const tp = Math.max(0, 1 - Math.abs((nextPuff - 0.5) / 0.5));
      L.throat.scale.set(1 + tp * 0.5, 0.4 + tp * 0.9, 1 + tp * 0.4);
      nextTurn -= dt;
      if (nextTurn < 0) { nextTurn = 2.5 + rnd() * 4; headAim = (rnd() - 0.5) * 0.7; headTilt = (rnd() - 0.4) * 0.28; }
      L.head.rotation.y += (headAim - L.head.rotation.y) * Math.min(1, dt * 4);
      L.head.rotation.z += (headTilt * 0.5 - L.head.rotation.z) * Math.min(1, dt * 3);
      nextBob -= dt;
      if (nextBob < 0 && bobT < 0) { bobT = 0; nextBob = 5 + rnd() * 7; }
      let bob = 0;
      if (bobT >= 0) { bobT += dt; bob = Math.sin(Math.min(1, bobT / 0.9) * Math.PI * 2) * 0.22; if (bobT > 0.9) { bobT = -1; bob = 0; } }
      const restX = -headTilt * 0.6;
      L.head.rotation.x += (restX + bob - L.head.rotation.x) * Math.min(1, dt * 8);
      nextPush -= dt;
      if (nextPush < 0 && pushT < 0) { pushT = 0; nextPush = 12 + rnd() * 14; }
      if (pushT >= 0) { pushT += dt; const k = Math.sin(Math.min(1, pushT / 1.4) * Math.PI * 2) ** 2; L.root.rotation.x = -k * 0.18; L.root.position.y = k * 0.004; if (pushT > 1.4) { pushT = -1; L.root.rotation.x = 0; L.root.position.y = 0; } }
      g.rotation.y = baseRy + Math.sin(now * 0.05) * 0.15;
      if (!canBask(ts, season) && t > 10) scare();
    }
    if (state === 'flee') {
      const total = flee.from.distanceTo(flee.end);
      const dashT = 1.05, k0 = Math.min(1, t / dashT);
      const seg = Math.min(2, Math.floor(k0 * 3)), local = k0 * 3 - seg;
      const moving = local < 0.72;
      const k = (seg + Math.min(1, local / 0.72)) / 3;
      const pnt = new THREE.Vector3().lerpVectors(flee.from, flee.end, k);
      pnt.y = THREE.MathUtils.lerp(flee.from.y, 0.0, Math.min(1, k * 3)) + (seg === 0 ? Math.sin(Math.min(1, local / 0.72) * Math.PI) * 0.05 : 0);
      g.position.copy(pnt);
      g.rotation.y = flee.heading + (moving ? Math.sin(t * 38) * 0.18 : 0);
      legs(t * 48, moving ? 0.9 : 0);
      void total;
      if (k0 >= 1) {
        const b = Math.min(1, (t - dashT) / 1.8);
        if (puffT < 0 && b < 0.1) {
          puffT = 0;
          grains.forEach((q) => { const a = rnd() * 6.28; q.x = g.position.x; q.y = 0.005; q.z = g.position.z; q.vx = Math.cos(a) * 0.12; q.vz = Math.sin(a) * 0.12; q.vy = 0.25 + rnd() * 0.2; });
        }
        L.root.position.y = -0.018 * b; L.root.rotation.z = Math.sin(t * 26) * 0.22 * (1 - b);
        legs(t * 30, 0.5 * (1 - b));
        if (b >= 1) { state = 'away'; g.visible = false; L.root.position.y = 0; L.root.rotation.z = 0; away = 240 + rnd() * 240; }
      }
    }
  }
  return { group: g, hit, scare, update, get state() { return state; } };
}
