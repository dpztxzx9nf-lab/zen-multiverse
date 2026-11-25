// Her favourite flower: snapdragons (Antirrhinum majus). Clusters of flower spikes in soft mixed
// colours bloom spring through autumn; winter leaves dry stems with little seed pods.
// A gentle tap makes the florets' lower lips open and snap shut, a small springy chomp.
//
// To swap the species later, change FAVORITE_FLOWER (palette, spike size, floret count) or
// provide another builder with the same interface: { group, hit(ray), chomp(hit, now), update(dt, now, ts) }.
import * as THREE from 'three';
import { mulberry32, mergeGeometries } from './util.js';
import { paint } from './nature.js';

export const FAVORITE_FLOWER = {
  species: 'snapdragon',
  palette: ['#f6a9c4', '#ffc4a0', '#fff0d2', '#d9508a', '#ffd970', '#f3b8d8', '#ff9fb0', '#f7dca8'],
  winterColor: '#8d7152',
  stem: '#5f8a45', stemWinter: '#8b7b5c',
  spikeHeight: [0.5, 0.85],
  florets: [11, 16], // per spike (PC); phones use fewer
  floretSize: 0.068,
};

// clusters near the pond and the bonsai (x, z, spikes)
const CLUSTERS = [[7.4, 5.4, 7], [9.8, 5.9, 6], [13.4, 5.0, 6], [3.4, -6.6, 5], [-0.4, -7.1, 5], [6.2, 3.6, 4]];

function sphere(sx, sy, sz, x, y, z, col, seg = 6) {
  const g = new THREE.SphereGeometry(1, seg, Math.max(3, Math.round(seg * 0.67)));
  g.scale(sx, sy, sz); g.translate(x, y, z);
  const n = g.attributes.position.count, c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { c[i * 3] = col[0]; c[i * 3 + 1] = col[1]; c[i * 3 + 2] = col[2]; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

export function createSnapdragons(scene, { P, season, sway, uSnow, touch = false, clusters = CLUSTERS, seed = 777 }) {
  const F = FAVORITE_FLOWER;
  const S = season.season, winter = S === 'winter';
  const rnd = mulberry32(seed);
  const lite = P.cls === 'phone';
  const seg = lite ? 5 : 7;
  const W = [1, 1, 1], PAL = [1.0, 0.86, 0.45], TUBE = [0.92, 0.95, 0.85];
  // upper part: corolla tube + hooded two-lobed upper lip; lower lip hinges at the origin
  const upperG = mergeGeometries([
    sphere(0.42, 0.42, 0.62, 0, 0.02, 0.0, TUBE, seg),
    sphere(0.5, 0.36, 0.42, 0, 0.2, 0.32, W, seg),
    sphere(0.3, 0.28, 0.26, -0.21, 0.32, 0.48, W, seg),
    sphere(0.3, 0.28, 0.26, 0.21, 0.32, 0.48, W, seg),
  ]);
  const lowerG = mergeGeometries([
    sphere(0.5, 0.2, 0.44, 0, -0.2, 0.42, W, seg),
    sphere(0.19, 0.1, 0.16, -0.26, -0.25, 0.74, W, seg),
    sphere(0.2, 0.1, 0.17, 0, -0.27, 0.8, W, seg),
    sphere(0.19, 0.1, 0.16, 0.26, -0.25, 0.74, W, seg),
    sphere(0.3, 0.17, 0.24, 0, -0.07, 0.5, PAL, seg), // the yellow 'bee badge' palate
  ]);
  const petalMat = paint(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }), { sway, swayH: 1.3, swayAmp: 0.16, snow: uSnow, snowK: 0.4 });
  petalMat.roughness = 0.55;
  petalMat.emissive = new THREE.Color('#ffffff'); petalMat.emissiveIntensity = 0.02;

  const stemG = new THREE.CylinderGeometry(0.6, 1, 1, 5, 1); stemG.translate(0, 0.5, 0);
  const leafShape = new THREE.Shape();
  leafShape.moveTo(0, 0); leafShape.quadraticCurveTo(0.5, 0.35, 0, 1); leafShape.quadraticCurveTo(-0.5, 0.35, 0, 0);
  const leafG = new THREE.ShapeGeometry(leafShape, 4); leafG.rotateX(-0.9); // tilt outward
  const greenMat = paint(new THREE.MeshStandardMaterial({ color: winter ? F.stemWinter : F.stem, side: THREE.DoubleSide }), { sway, swayH: 1.3, swayAmp: 0.16, snow: uSnow, snowK: 0.6 });

  // build spikes
  const spikes = [];
  const nf0 = lite ? 0.65 : 1;
  for (const [cx, cz, n] of clusters) {
    const count = Math.max(3, Math.round(n * (lite ? 0.7 : 1)));
    for (let k = 0; k < count; k++) {
      const a = rnd() * 6.28, r = Math.sqrt(rnd()) * 0.75;
      const H = F.spikeHeight[0] + rnd() * (F.spikeHeight[1] - F.spikeHeight[0]);
      const sp = {
        x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r, H,
        tiltX: (rnd() - 0.5) * 0.22, tiltZ: (rnd() - 0.5) * 0.22,
        color: new THREE.Color(winter ? F.winterColor : F.palette[Math.floor(rnd() * F.palette.length)]),
        nf: Math.round((F.florets[0] + rnd() * (F.florets[1] - F.florets[0])) * nf0),
        t0: -99, amp: [], deg: Math.floor(rnd() * 5), base: 0,
      };
      sp.m = new THREE.Matrix4().compose(new THREE.Vector3(sp.x, 0, sp.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(sp.tiltX, rnd() * 6.28, sp.tiltZ)), new THREE.Vector3(1, 1, 1));
      spikes.push(sp);
    }
  }
  const NFL = spikes.reduce((s, p) => s + p.nf, 0);
  const upper = new THREE.InstancedMesh(upperG, petalMat, NFL);
  const lower = new THREE.InstancedMesh(lowerG, petalMat, NFL);
  const stems = new THREE.InstancedMesh(stemG, greenMat, spikes.length);
  const NL = lite ? 4 : 7;
  const leaves = new THREE.InstancedMesh(leafG, greenMat, spikes.length * NL);
  const tmp = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3(), cc = new THREE.Color();
  let fi = 0;
  spikes.forEach((sp, si) => {
    stems.setMatrixAt(si, tmp.copy(sp.m).multiply(new THREE.Matrix4().makeScale(0.016, sp.H, 0.016)));
    for (let l = 0; l < NL; l++) {
      const y = 0.04 + (l / NL) * sp.H * 0.4, ang = l * 2.1 + si;
      const ls = (0.2 - l * 0.012) * (winter ? 0.7 : 1);
      leaves.setMatrixAt(si * NL + l, tmp.copy(sp.m).multiply(new THREE.Matrix4().compose(v.set(0, y, 0), q.setFromEuler(e.set(0, ang, 0)), sc.set(ls * 0.45, ls, ls))));
    }
    sp.base = fi;
    sp.local = [];
    for (let i = 0; i < sp.nf; i++, fi++) {
      const u = i / Math.max(1, sp.nf - 1);
      const bud = u > 0.8;
      const s = F.floretSize * (1 - u * 0.5) * (bud ? 0.75 : 1) * (winter ? 0.6 : 1);
      const y = sp.H * (0.42 + u * 0.56);
      const phi = i * 2.399 + si;
      const L = new THREE.Matrix4().compose(v.set(Math.sin(phi) * (0.025 + s * 0.2), y, Math.cos(phi) * (0.025 + s * 0.2)), q.setFromEuler(e.set(bud ? -0.6 : 0.12, phi, 0)), sc.setScalar(s));
      sp.local.push(L);
      sp.amp.push(bud || winter ? 0.15 : 1);
      cc.copy(sp.color).offsetHSL(0, 0, (rnd() - 0.5) * 0.06 + (bud ? -0.06 : 0));
      upper.setColorAt(fi, cc); lower.setColorAt(fi, cc);
    }
  });
  const wobM = new THREE.Matrix4();
  function setFloret(sp, i, open) {
    const L = sp.local[i];
    tmp.copy(sp.m);
    if (sp.wob) tmp.multiply(wobM.makeRotationAxis(sp.wobAxis, sp.wob));
    tmp.multiply(L);
    upper.setMatrixAt(sp.base + i, tmp.clone().multiply(new THREE.Matrix4().makeRotationX(-open * 0.3)));
    lower.setMatrixAt(sp.base + i, tmp.multiply(new THREE.Matrix4().makeRotationX(open)));
  }
  spikes.forEach((sp) => { for (let i = 0; i < sp.nf; i++) setFloret(sp, i, winter ? 0 : 0.08); });
  for (const m of [upper, lower, stems, leaves]) { m.castShadow = !lite && m !== leaves; m.receiveShadow = true; scene.add(m); }

  // ---- interaction
  const centers = spikes.map((sp) => new THREE.Vector3(0, sp.H * 0.7, 0).applyMatrix4(sp.m));
  const hitR = touch ? 0.42 : 0.3;
  const sph = new THREE.Sphere();
  function hit(ray) {
    let best = null;
    centers.forEach((c, i) => {
      sph.set(c, hitR + spikes[i].H * 0.15);
      const p = ray.intersectSphere(sph, v);
      if (p) { const d = p.distanceTo(ray.origin); if (!best || d < best.dist) best = { kind: 'snap', spike: i, dist: d, point: p.clone() }; }
    });
    return best;
  }
  const active = new Set();
  function chomp(h, now) {
    const sp = spikes[h.spike];
    if (now - sp.t0 < 0.35) return null;
    sp.t0 = now; sp.tapY = h.point ? h.point.y : sp.H * 0.7;
    sp.wobAxis = new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
    active.add(sp);
    return { deg: sp.deg, winter };
  }
  function update(dt, now) {
    const changed = active.size > 0;
    for (const sp of active) {
      const t = now - sp.t0;
      let done = t > 2.2;
      for (let i = 0; i < sp.nf; i++) {
        const fy = sp.local[i].elements[13];
        const near = Math.exp(-Math.abs(fy - (sp.tapY || 0)) * 2.2);
        const tt = t - i * 0.03;
        let o = 0.08;
        if (winter) {
          o = 0; // seed pods just rattle: a quick shake
          if (tt > 0) o = Math.sin(tt * 40) * Math.exp(-tt * 6) * 0.25;
        } else if (tt > 0) {
          const A = 1.15 * sp.amp[i] * (0.45 + 0.55 * near);
          o = tt < 0.16 ? A * Math.sin((tt / 0.16) * Math.PI / 2) : A * Math.exp(-(tt - 0.16) * 7) * Math.cos((tt - 0.16) * 19);
          o = Math.max(-0.08, o) + 0.08;
        }
        setFloret(sp, i, o);
      }
      // the whole spike bobs on its stem like a spring
      sp.wob = Math.sin(t * 11) * Math.exp(-t * 3.2) * 0.14;
      stems.setMatrixAt(spikes.indexOf(sp), tmp.copy(sp.m).multiply(wobM.makeRotationAxis(sp.wobAxis, sp.wob)).multiply(new THREE.Matrix4().makeScale(0.016, sp.H, 0.016)));
      stems.instanceMatrix.needsUpdate = true;
      if (done) { sp.wob = 0; for (let i = 0; i < sp.nf; i++) setFloret(sp, i, winter ? 0 : 0.08); active.delete(sp); }
    }
    if (changed) { upper.instanceMatrix.needsUpdate = true; lower.instanceMatrix.needsUpdate = true; }
  }
  // spikes a hover could highlight (PC)
  return { hit, chomp, update, spikes, centers, meshes: [upper, lower, stems, leaves], clusters: CLUSTERS, setFloret };
}
