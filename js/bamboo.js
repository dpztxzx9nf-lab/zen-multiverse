// Realistic timber bamboo (Phyllostachys) for the garden groves, built procedurally from botany:
// tapered culms with swollen nodes, sheath scars and a waxy white bloom band under each node,
// internodes that lengthen up the culm, alternate branch pairs from the upper nodes only, and
// drooping sprays of narrow lanceolate leaves (painted alpha cards with midribs) at the branch tips.
// A few culm variants are merged geometries instanced across every grove; wind comes from paint().
//   createBamboo(scene, { P, sway, groves: [[x, z, radius, count], ...], rnd })
import * as THREE from 'three';
import { mergeGeometries, mulberry32 } from './util.js';
import { paint } from './nature.js';

function culmTexture() {
  // one internode, node at v=0 (bottom) and v=1 (top); repeated per internode by UVs
  const W = 64, H = 512, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'), img = g.createImageData(W, H), rnd = mulberry32(31);
  const streak = Array.from({ length: W }, () => (rnd() - 0.5));
  for (let y = 0; y < H; y++) {
    const v = 1 - y / H; // canvas y=0 is the top (v=1)
    for (let x = 0; x < W; x++) {
      let r = 74, gg = 90, b = 50;                               // living culm: muted olive green
      const s = streak[x] * 10 + (streak[(x + 7) % W] - 0.5) * 4;  // fine longitudinal fibres
      r += s * 0.6; gg += s; b += s * 0.4;
      const bloom = Math.exp(-((v - 0.93) ** 2) / 0.0012);         // white waxy band just under the node above
      r += bloom * 34; gg += bloom * 32; b += bloom * 30;
      const ring = Math.exp(-((v - 0.985) ** 2) / 0.00004) + Math.exp(-((v - 0.012) ** 2) / 0.00006); // node ridge + sheath scar
      r -= ring * 34; gg -= ring * 44; b -= ring * 20;
      const tan = Math.max(0, 0.06 - v) / 0.06;                    // scar tissue above the node, tan
      r += tan * 30; gg += tan * 8; b -= tan * 4;
      const n = (rnd() - 0.5) * 8; r += n; gg += n; b += n;
      const k = (y * W + x) * 4; img.data[k] = r; img.data[k + 1] = gg; img.data[k + 2] = b; img.data[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.anisotropy = 4;
  return t;
}

function sprayTexture() {
  // a twig from the top centre with 9 leaves fanning downward; 512 px ~ 0.5 m, so a leaf is ~12-16 cm
  const S = 512, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'), rnd = mulberry32(77);
  const twig = (t) => ({ x: S / 2 + Math.sin(t * 2.2) * 30 * t, y: 8 + t * 300 });
  g.strokeStyle = '#5a5a2c'; g.lineWidth = 3; g.beginPath();
  for (let i = 0; i <= 20; i++) { const p = twig(i / 20); i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y); }
  g.stroke();
  const leaves = [];
  for (let i = 0; i < 9; i++) {
    const t = 0.18 + (i / 8) * 0.82, side = i % 2 ? 1 : -1;
    leaves.push({ t, ang: side * (0.35 + rnd() * 0.75) * (1 - t * 0.5), len: 125 + rnd() * 55, w: 15 + rnd() * 6, curl: (rnd() - 0.5) * 0.5, tone: rnd() });
  }
  leaves.push({ t: 1, ang: (rnd() - 0.5) * 0.3, len: 150, w: 17, curl: 0.1, tone: 0.5 });
  for (const L of leaves) {
    const p = twig(L.t);
    g.save(); g.translate(p.x, p.y); g.rotate(L.ang);
    // leaf blade: petiole, widest at ~30%, long acuminate tip, slight curve
    const len = L.len, w = L.w, cu = L.curl * len;
    const path = new Path2D();
    path.moveTo(0, 0);
    path.bezierCurveTo(w * 0.9, len * 0.12, w * 0.75 + cu * 0.3, len * 0.55, cu, len);
    path.bezierCurveTo(-w * 0.55 + cu * 0.3, len * 0.55, -w * 0.9, len * 0.12, 0, 0);
    const gr = g.createLinearGradient(0, 0, cu, len);
    const base = L.tone < 0.12 ? [150, 150, 70] : [52 + L.tone * 24, 92 + L.tone * 34, 34 + L.tone * 10];
    gr.addColorStop(0, `rgb(${base[0] * 0.8},${base[1] * 0.8},${base[2] * 0.8})`);
    gr.addColorStop(0.5, `rgb(${base[0]},${base[1]},${base[2]})`);
    gr.addColorStop(1, L.tone > 0.85 ? 'rgb(150,140,70)' : `rgb(${base[0] * 1.08},${base[1] * 1.08},${base[2]})`); // dry tips on a few
    g.fillStyle = gr; g.fill(path);
    g.strokeStyle = 'rgba(30,45,15,0.45)'; g.lineWidth = 1.2; g.stroke(path);
    g.strokeStyle = 'rgba(190,210,140,0.55)'; g.lineWidth = 1.4;  // midrib
    g.beginPath(); g.moveTo(0, 2); g.quadraticCurveTo(cu * 0.4, len * 0.5, cu * 0.97, len * 0.97); g.stroke();
    g.strokeStyle = 'rgba(20,40,10,0.18)'; g.lineWidth = 0.8;     // parallel veins
    for (const o of [-0.35, 0.35]) { g.beginPath(); g.moveTo(o * w * 0.4, len * 0.06); g.quadraticCurveTo(cu * 0.4 + o * w * 0.6, len * 0.45, cu * 0.95, len * 0.95); g.stroke(); }
    g.restore();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

// one culm with its branches (merged) and its leaf cards (merged), in local space at 1:1 scale
function buildVariant(seed, { h, r0, bend, rings, radial, cards }) {
  const rnd = mulberry32(seed);
  const pos = [], uv = [], idx = [];
  const nodes = [];
  let y = 0, k = 0;
  const R = (yy) => r0 * (1 - 0.62 * Math.pow(yy / h, 1.6)) + 0.005;
  const bx = (yy) => bend * h * (yy / h) * (yy / h);
  const ring = (yy, rs, v) => {
    const base = pos.length / 3;
    for (let a = 0; a <= radial; a++) {
      const th = (a / radial) * Math.PI * 2, rr = R(yy) * rs;
      pos.push(Math.cos(th) * rr + bx(yy), yy, Math.sin(th) * rr); uv.push(a / radial, v);
    }
    return base;
  };
  let prev = -1;
  const link = (b) => { if (prev >= 0) for (let a = 0; a < radial; a++) { const p0 = prev + a, p1 = b + a; idx.push(p0, p1, p0 + 1, p0 + 1, p1, p1 + 1); } prev = b; };
  while (y < h) {
    const len = Math.min(h - y, 0.13 + Math.min(1, k / 9) * 0.2 - Math.max(0, (y / h - 0.75)) * 0.25 + (rnd() - 0.5) * 0.03);
    if (len < 0.05) break;
    const ya = y, yb = y + len;
    nodes.push(ya);
    prev = -1;
    const prof = rings >= 5 ? [[0, 1.075, 0], [0.025, 1.0, 0.06], [0.5, 0.995, 0.5], [0.92, 0.99, 0.95], [1, 1.07, 1]] : [[0, 1.07, 0], [0.5, 1.0, 0.5], [1, 1.06, 1]];
    for (const [f, rs, v] of prof) link(ring(ya + (f === 0.025 ? 0.025 : len * f), rs, v));
    y = yb; k++;
  }
  const culm = new THREE.BufferGeometry();
  culm.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  culm.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  culm.setIndex(idx); culm.computeVertexNormals();
  // branches from upper nodes, alternating sides; leaf sprays at their tips and along them
  const parts = [culm], cardM = [];
  const up = new THREE.Vector3(0, 1, 0);
  const crown = new THREE.Vector3(bx(h * 0.8), h * 0.8, 0);
  const upper = nodes.filter((n) => n > h * 0.42);
  upper.forEach((ny, i) => {
    const az = i * Math.PI + (rnd() - 0.5) * 1.2 + (i % 4 < 2 ? 0 : Math.PI * 0.5);
    const tY = (ny - h * 0.42) / (h * 0.58);
    const L = (0.35 + 0.9 * Math.sin(Math.PI * Math.min(1, 0.25 + tY * 0.8))) * (0.8 + rnd() * 0.4);
    const dir = new THREE.Vector3(Math.cos(az) * 0.72, 0.62 + tY * 0.25, Math.sin(az) * 0.72).normalize();
    const start = new THREE.Vector3(bx(ny) + Math.cos(az) * R(ny), ny, Math.sin(az) * R(ny));
    const br = new THREE.CylinderGeometry(0.004, 0.008, L, 4, 1, true).translate(0, L / 2, 0);
    br.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, dir)); br.translate(start.x, start.y, start.z);
    parts.push(br);
    const nTip = 3 + Math.round(rnd() * 3);
    for (let c = 0; c < nTip + 1; c++) {
      const f = c === 0 ? 1 : 0.35 + rnd() * 0.55;
      const at = start.clone().addScaledVector(dir, L * f);
      cardM.push({ at, az: az + (rnd() - 0.5) * 1.4, tilt: 0.25 + rnd() * 0.75, s: 0.8 + rnd() * 0.45, tone: rnd() });
    }
    // short secondary twigs straight off the culm carry sprays too, so the crown is a dense mass
    if (ny > h * 0.55) for (let c = 0; c < 3; c++) {
      const a2 = az + Math.PI * (0.5 + rnd());
      cardM.push({ at: new THREE.Vector3(bx(ny) + Math.cos(a2) * 0.12, ny + rnd() * 0.15, Math.sin(a2) * 0.12), az: a2, tilt: 0.2 + rnd() * 0.6, s: 0.75 + rnd() * 0.4, tone: rnd() });
    }
  });
  // crown sprays at the very top
  for (let c = 0; c < 4; c++) cardM.push({ at: new THREE.Vector3(bx(h) + (rnd() - 0.5) * 0.2, h - rnd() * 0.6, (rnd() - 0.5) * 0.2), az: rnd() * 6.28, tilt: 0.1 + rnd() * 0.4, s: 0.9 + rnd() * 0.3, tone: rnd() });
  // trim or pad to the device budget
  while (cardM.length > cards) cardM.splice(Math.floor(rnd() * cardM.length), 1);
  const wood = mergeGeometries(parts.map((p) => p.toNonIndexed()));
  // leaf cards: 0.72 m spray hanging from its attachment point, drooping outward
  const cardG = new THREE.PlaneGeometry(0.72, 0.72, 2, 3).translate(0, -0.36, 0);
  { const p = cardG.attributes.position; for (let i = 0; i < p.count; i++) { const d = -p.getY(i) / 0.72; p.setZ(i, d * d * 0.16 + Math.abs(p.getX(i)) * 0.15); } cardG.computeVertexNormals(); }
  const leafParts = [], m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), col = new THREE.Color(), v = new THREE.Vector3(), nn = new THREE.Vector3();
  for (const c of cardM) {
    e.set(-c.tilt, c.az + Math.PI / 2, 0, 'YXZ'); q.setFromEuler(e);
    m4.compose(c.at, q, new THREE.Vector3(c.s, c.s, c.s));
    const g = cardG.clone().applyMatrix4(m4);
    // bend normals outward from the crown so the canopy shades as a volume
    const p = g.attributes.position, n = g.attributes.normal, cols = new Float32Array(p.count * 3);
    const j = c.tone - 0.5; col.setRGB(1 + j * 0.16, 1 + j * 0.08, 1 - j * 0.1).multiplyScalar(0.9 + c.tone * 0.2);
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).sub(crown); v.y *= 0.5; v.normalize();
      nn.fromBufferAttribute(n, i); if (nn.dot(v) < 0) nn.negate(); nn.lerp(v, 0.7).normalize(); n.setXYZ(i, nn.x, nn.y, nn.z);
      cols[i * 3] = col.r; cols[i * 3 + 1] = col.g; cols[i * 3 + 2] = col.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    leafParts.push(g);
  }
  return { wood, leaves: mergeGeometries(leafParts) };
}

export function createBamboo(scene, { P, sway, groves, rnd }) {
  const pc = P.cls === 'pc';
  const cfg = { h: 10, rings: pc ? 5 : 3, radial: pc ? 9 : 6, cards: pc ? 230 : 80 };
  const VARIANTS = [
    buildVariant(11, { ...cfg, r0: 0.06, bend: 0.02 }), buildVariant(23, { ...cfg, r0: 0.07, bend: -0.03 }),
    buildVariant(37, { ...cfg, r0: 0.055, bend: 0.045 }), buildVariant(51, { ...cfg, r0: 0.075, bend: 0.0 }),
  ];
  const culmMat = paint(new THREE.MeshStandardMaterial({ map: culmTexture(), color: '#ffffff' }), { sway, swayH: 10, swayAmp: 0.5 });
  culmMat.roughness = 0.5; culmMat.envMapIntensity = 0.8;
  const leafMat = paint(new THREE.MeshStandardMaterial({ map: sprayTexture(), vertexColors: true, color: '#ffffff' }), { leaf: true, sway, swayH: 10, swayAmp: 0.5 });
  leafMat.roughness = 0.75; leafMat.envMapIntensity = 0.6;
  const per = VARIANTS.map(() => []);
  for (const [gx, gz, gr, n] of groves) {
    for (let s = 0; s < Math.round(n * P.bambooStalks * 1.35); s++) {
      const a = rnd() * 6.28, rr = Math.sqrt(rnd()) * gr;
      per[Math.floor(rnd() * VARIANTS.length)].push({ x: gx + Math.cos(a) * rr, z: gz + Math.sin(a) * rr, s: 0.8 + rnd() * 0.45, ry: rnd() * 6.28, lean: (rnd() - 0.5) * 0.06, age: rnd() });
    }
  }
  const dummy = new THREE.Object3D(), tint = new THREE.Color();
  const meshes = [];
  VARIANTS.forEach((V, vi) => {
    const list = per[vi]; if (!list.length) return;
    const wm = new THREE.InstancedMesh(V.wood, culmMat, list.length), lm = new THREE.InstancedMesh(V.leaves, leafMat, list.length);
    list.forEach((c, i) => {
      dummy.position.set(c.x, 0, c.z); dummy.rotation.set(c.lean, c.ry, c.lean * 0.6); dummy.scale.setScalar(c.s); dummy.updateMatrix();
      wm.setMatrixAt(i, dummy.matrix); lm.setMatrixAt(i, dummy.matrix);
      // culm age: new culms bright green, older ones olive to yellowed with grey lichen dulling
      tint.setRGB(1, 1, 1).lerp(new THREE.Color(1.25, 1.08, 0.78), c.age > 0.6 ? (c.age - 0.6) * 1.8 : 0).multiplyScalar(0.85 + c.age * 0.15);
      wm.setColorAt(i, tint);
      tint.setRGB(1, 1, 1).multiplyScalar(0.92 + (c.age - 0.5) * 0.12); lm.setColorAt(i, tint);
    });
    wm.castShadow = pc; wm.receiveShadow = true; lm.receiveShadow = true;
    wm.name = 'bambooCulms'; lm.name = 'bambooLeaves';
    scene.add(wm, lm); meshes.push(wm, lm);
  });
  return { meshes };
}
