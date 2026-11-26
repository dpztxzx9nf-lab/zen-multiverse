// A camp's ground in Raked Light: the trodden earth, the hearth's ash and the saltbush that grows where nobody
// walks, all from the camp's own wear field (js/factions/wear.js). One soft-edged overlay mesh per camp that
// follows the ground as drawn (so it never floats or cuts in), plus one instanced draw for the bushes.
import * as THREE from 'three';
import { campsOf, wearOf, wearAt } from './wear.js';
import { mergeGeometries } from '../util.js';

// phones/tablets get a coarser grid and simpler bushes (same look at phone size, ~half the triangles)
// (read when a camp is built: main.js sets data-device after the modules load)
const lite = () => typeof document !== 'undefined' && (document.documentElement.dataset.device || 'pc') !== 'pc';
const STEP_PC = 0.4, STEP_LITE = 0.6; // overlay grid spacing (m): fine enough for a footpath's soft edge
export const hash = (a, b) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };

function extent(strokes) {
  let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
  const add = (x, z, r) => { x0 = Math.min(x0, x - r); z0 = Math.min(z0, z - r); x1 = Math.max(x1, x + r); z1 = Math.max(z1, z + r); };
  for (const s of strokes) { if (s.pts) for (const [x, z] of s.pts) add(x, z, s.width); else add(s.x, s.z, s.r); }
  const m = 2; return { x0: x0 - m, z0: z0 - m, x1: x1 + m, z1: z1 + m };
}

// the trodden ground as vertex colour and alpha on a fine grid that follows the ground as drawn:
// crushed crust at the edges, packed mud inside, a darker line where most feet go, ash at the hearth
const CRUST = [0.55, 0.49, 0.41], MUD = [0.41, 0.34, 0.26], CORE = [0.29, 0.24, 0.18], ASH = [0.2, 0.19, 0.18];
const noise = (x, z) => { // smooth value noise, 0..1
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi, u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
};
export function groundAt(strokes, x, z) {
  const brk = noise(x * 0.9, z * 0.9) * 0.6 + noise(x * 3.1, z * 3.1) * 0.4; // trampling is patchy
  let w = wearAt(strokes, x, z), ash = 0;
  for (const s of strokes) if (s.k === 'ash') { const d = Math.hypot(x - s.x, z - s.z); ash = Math.max(ash, 1 - Math.min(1, d / (s.r * 1.6)) ** 1.5); }
  w = Math.max(0, Math.min(1, w * (0.7 + brk * 0.6) - 0.04));
  if (w <= 0 && ash <= 0) return null;
  const mix = (a, b, t) => a.map((v, k) => v + (b[k] - v) * t);
  let col = w < 0.25 ? mix(CRUST, MUD, w / 0.25) : mix(MUD, CORE, Math.min(1, (w - 0.25) / 0.6));
  if (hash(Math.floor(x * 9), Math.floor(z * 9)) > 0.93 && w > 0.3) col = mix(col, CORE, 0.6); // scuffs and prints
  col = mix(col, ASH, ash);
  const a = Math.min(0.95, Math.max(ash, w < 0.25 ? Math.sqrt(w / 0.25) * 0.8 : 0.8 + (w - 0.25) * 0.5)); // sqrt: the yard's soft edge reads from the path, not only up close
  return { col, a };
}

function overlay(strokes, gy, stylize) {
  const E = extent(strokes), w = E.x1 - E.x0, d = E.z1 - E.z0;
  const STEP = lite() ? STEP_LITE : STEP_PC;
  const nx = Math.max(2, Math.ceil(w / STEP)), nz = Math.max(2, Math.ceil(d / STEP));
  const geo = new THREE.PlaneGeometry(w, d, nx, nz); geo.rotateX(-Math.PI / 2);
  const P = geo.attributes.position, cx = (E.x0 + E.x1) / 2, cz = (E.z0 + E.z1) / 2;
  const C = new Float32Array(P.count * 4);
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i) + cx, z = P.getZ(i) + cz; P.setXYZ(i, x, gy(x, z) + 0.03, z);
    const g = groundAt(strokes, x, z);
    if (g) { for (let k = 0; k < 3; k++) C[i * 4 + k] = g.col[k] ** 2.2; C[i * 4 + 3] = g.a; } // colours are sRGB; vertex colours are linear
  }
  geo.setAttribute('color', new THREE.BufferAttribute(C, 4));
  // draw only the cells that show anything (the trodden ground is ~15% of its bounding box): phones paid
  // for the whole grid (+37k triangles at the camp)
  const I = geo.index.array, keep = [];
  for (let t = 0; t < I.length; t += 3) if (C[I[t] * 4 + 3] > 0.01 || C[I[t + 1] * 4 + 3] > 0.01 || C[I[t + 2] * 4 + 3] > 0.01) keep.push(I[t], I[t + 1], I[t + 2]);
  geo.setIndex(keep);
  geo.deleteAttribute('uv'); geo.computeVertexNormals();
  const mat = stylize(new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, depthWrite: false, roughness: 0.97,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), 'terrain');
  const m = new THREE.Mesh(geo, mat); m.receiveShadow = true; m.renderOrder = 1; m.name = 'camp-ground';
  return m;
}

// saltbush: low grey-green mounds in threes (5:3:2), where the crust is whole and nothing stands
function bushes(camps, all, gy, stylize) {
  const spots = [];
  for (const { camp, strokes } of camps) {
    const H = camp.hearth;
    for (let k = 0; k < 40 && spots.length < camps.length * 12; k++) {
      const an = hash(H.x + k, H.z) * 6.283, rr = 6 + hash(H.z, H.x + k) * 9, x = H.x + Math.cos(an) * rr, z = H.z + Math.sin(an) * rr;
      if (wearAt(strokes, x, z) > 0.02 || all.some((p) => Math.hypot(p.x - x, p.z - z) < 3.2)) continue;
      if (spots.some((q) => Math.hypot(q.x - x, q.z - z) < 4)) continue;
      const a0 = hash(x, z) * 6.283;
      for (const [s, dx, dz] of [[1, 0, 0], [0.62, 0.75, 0.35], [0.4, -0.55, 0.6]]) {
        const bx = x + Math.cos(a0) * dx - Math.sin(a0) * dz, bz = z + Math.sin(a0) * dx + Math.cos(a0) * dz;
        spots.push({ x: bx, z: bz, s: s * (0.45 + hash(bx, bz) * 0.2) });
      }
    }
  }
  if (!spots.length) return null;
  // three twiggy masses (5:3:2), each a lumpy crown: saltbush is a tangle of small grey leaves, never a smooth dome
  const lumpy = (r) => { const g = new THREE.IcosahedronGeometry(r, lite() ? 1 : 2), P = g.attributes.position;
    for (let i = 0; i < P.count; i++) { const x = P.getX(i), y = P.getY(i), z = P.getZ(i), k = 0.82 + noise(x / r * 2.3 + y / r * 1.7 + 5, z / r * 2.3 - y / r * 1.1) * 0.34; P.setXYZ(i, x * k, y * k, z * k); }
    return g; }; // keeps the sphere's own normals: light rolls over the crown softly instead of faceting
  const geo = mergeGeometries([[1, 0, 0, 0.55], [0.7, 0.55, 0.3, 0.45], [0.5, -0.45, 0.45, 0.4]].map(([r, x, z, h]) => lumpy(r).scale(1, h / r * 0.9, 1).translate(x, h * 0.5, z)));
  const mat = stylize(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95 }), 'leaf', { lite: true });
  const im = new THREE.InstancedMesh(geo, mat, spots.length); im.name = 'camp-saltbush';
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), Sc = new THREE.Vector3(), col = new THREE.Color();
  spots.forEach((b, i) => {
    Q.setFromAxisAngle(V.set(0, 1, 0), hash(b.z, b.x) * 6.283);
    M.compose(V.set(b.x, gy(b.x, b.z) - 0.04, b.z), Q, Sc.set(b.s * (0.9 + hash(b.x, 3) * 0.3), b.s, b.s * (0.9 + hash(b.z, 5) * 0.3)));
    im.setMatrixAt(i, M);
    im.setColorAt(i, col.setHSL(0.2 + hash(b.x, b.z) * 0.06, 0.12 + hash(b.z, 7) * 0.06, 0.13 + hash(b.x, 9) * 0.05)); // saltbush: dusty grey-olive
  });
  im.castShadow = true; im.receiveShadow = true;
  return im;
}

export function campGround({ props, people, gy, stylize = (m) => m }) {
  const g = new THREE.Group(); g.name = 'camp-grounds';
  const camps = campsOf(props, people).map((camp) => ({ camp, strokes: wearOf(camp) }));
  for (const { strokes } of camps) if (strokes.length) g.add(overlay(strokes, gy, stylize));
  const b = bushes(camps, props, gy, stylize); if (b) g.add(b);
  return g;
}
