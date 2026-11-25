// Procedural rocks with moss on their upward faces.
import * as THREE from 'three';
import { fbm3, mulberry32, smoothstep } from './util.js';

export const rockQuality = { segs: 1 };

export function makeRockGeometry(seed, { sx = 1, sy = 0.7, sz = 0.9, rough = 0.28, moss = 0.6, flatTop = 0, segs = 40 } = {}) {
  segs = Math.max(10, Math.round(segs * rockQuality.segs));
  const g = new THREE.SphereGeometry(1, segs, Math.round(segs * 0.7));
  const pos = g.attributes.position;
  const rnd = mulberry32(seed);
  const ox = rnd() * 100, oy = rnd() * 100, oz = rnd() * 100;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = fbm3(v.x * 1.3 + ox, v.y * 1.3 + oy, v.z * 1.3 + oz, 5);
    const n2 = fbm3(v.x * 4 + oz, v.y * 4 + ox, v.z * 4 + oy, 3);
    const r = 1 + n * rough * 1.6 + n2 * rough * 0.25;
    v.multiplyScalar(r);
    v.x *= sx; v.y *= sy; v.z *= sz;
    if (v.y < -0.15 * sy) v.y = -0.15 * sy + (v.y + 0.15 * sy) * 0.15;
    if (flatTop > 0 && v.y > flatTop * sy) v.y = flatTop * sy + (v.y - flatTop * sy) * 0.08;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  const nrm = g.attributes.normal;
  const col = new Float32Array(pos.count * 3);
  const stone = new THREE.Color(), mossC = new THREE.Color();
  const baseHue = 0.08 + rnd() * 0.06;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const ny = nrm.getY(i);
    const n = fbm3(v.x * 2.2 + oy, v.y * 2.2 + oz, v.z * 2.2 + ox, 4);
    const speck = fbm3(v.x * 9 + ox, v.y * 9, v.z * 9 + oz, 2);
    stone.setHSL(baseHue, 0.06 + n * 0.03, 0.33 + n * 0.12 + speck * 0.05);
    const m = smoothstep(0.35, 0.75, ny + n * 0.6) * moss * smoothstep(-0.2 * sy, 0.25 * sy, v.y);
    mossC.setHSL(0.24 + n * 0.04, 0.45, 0.22 + speck * 0.05 + n * 0.05);
    stone.lerp(mossC, m);
    col[i * 3] = stone.r; col[i * 3 + 1] = stone.g; col[i * 3 + 2] = stone.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

let sharedRockMat = null;
export const rockMaterial = () => sharedRockMat || (sharedRockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 }));

export function makeRock(seed, opts) {
  const m = new THREE.Mesh(makeRockGeometry(seed, opts), rockMaterial());
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

// A low mossy mound (island) under rocks
export function makeMossMound(seed, rx, rz) {
  const g = new THREE.SphereGeometry(1, 48, 16, 0, Math.PI * 2, 0, Math.PI / 2);
  const pos = g.attributes.position;
  const rnd = mulberry32(seed);
  const o = rnd() * 50;
  const v = new THREE.Vector3();
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const ang = Math.atan2(v.z, v.x);
    const edge = 1 + 0.22 * fbm3(Math.cos(ang) * 1.5 + o, Math.sin(ang) * 1.5, o, 3);
    const bump = fbm3(v.x * 5 + o, v.z * 5, o, 3);
    v.x *= rx * edge; v.z *= rz * edge; v.y = v.y * 0.28 + bump * 0.04 * v.y;
    pos.setXYZ(i, v.x, v.y, v.z);
    const fine = fbm3(v.x * 22 + o, v.z * 22, o + 3, 2);
    c.setHSL(0.21 + bump * 0.05 + fine * 0.02, 0.34 + fine * 0.1, 0.1 + bump * 0.06 + fine * 0.06 + v.y * 0.12);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.computeVertexNormals();
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  m.receiveShadow = true;
  return m;
}

// Rock geometry already transformed into place (for merging many rocks into one draw call)
export function placedRock(seed, opts, x, y, z, rotY = 0) {
  const g = makeRockGeometry(seed, opts);
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotY, 0)), new THREE.Vector3(1, 1, 1)));
  return g;
}
