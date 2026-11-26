// The planet seen from height: one low-poly globe coloured and shaped from the same seed as the ground,
// so climbing out of the atmosphere (or coming back down) is one continuous view. It is a real sphere in
// the local tile frame: centre (0, -R, 0), rotated so the tile's anchor sits right under the origin.
import * as THREE from 'three';
export function buildGlobe(W, { lite = false } = {}) {
  const R = W.radius, geo = lite ? new THREE.SphereGeometry(1, 96, 48) : new THREE.SphereGeometry(1, 192, 96), pos = geo.attributes.position; // indexed: smooth shading
  const col = new Float32Array(pos.count * 3), c = new THREE.Color(), d = [0, 0, 0];
  for (let i = 0; i < pos.count; i++) {
    d[0] = pos.getX(i); d[1] = pos.getY(i); d[2] = pos.getZ(i); const l = Math.hypot(d[0], d[1], d[2]); d[0] /= l; d[1] /= l; d[2] /= l;
    const { h } = W.colorDir(d, c);
    // relief is exaggerated x3 so mountains read from orbit; seas are flat
    const r = R - 25 + Math.max(W.hasSea ? W.sea : -1e9, h) * 3;
    pos.setXYZ(i, d[0] * r, d[1] * r, d[2] * r); col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, transparent: true, opacity: 0, depthWrite: true });
  mat.userData.noCurve = true;
  const mesh = new THREE.Mesh(geo, mat); mesh.userData.noCurve = true; mesh.visible = false; mesh.frustumCulled = false;
  // a thin atmosphere shell, tinted by the sky, thickness from pressure
  let shell = null;
  if (W.rules && W.rules.atmosphere.pressureKPa > 0.5) {
    const sm = new THREE.MeshBasicMaterial({ color: W.sky.horizon, transparent: true, opacity: 0, side: THREE.BackSide, depthWrite: false, blending: THREE.AdditiveBlending });
    sm.userData.noCurve = true;
    shell = new THREE.Mesh(new THREE.SphereGeometry(R * (1.025 + 0.02 * W.sky.haze), 48, 24), sm); shell.userData.noCurve = true; mesh.add(shell);
  }
  const api = {
    mesh,
    // place the globe under the current tile frame
    orient(frame) {
      const e = frame.e, a = frame.a, s = frame.s;
      // local = [e; a; s] * global  -> rotation matrix with those rows
      const m = new THREE.Matrix4().set(e[0], e[1], e[2], 0, a[0], a[1], a[2], 0, s[0], s[1], s[2], 0, 0, 0, 0, 1);
      mesh.quaternion.setFromRotationMatrix(m); mesh.position.set(0, -R, 0);
    },
    // k: 0 = on the ground (hidden) .. 1 = fully visible from orbit
    setFade(k) { mesh.visible = k > 0.001; mat.opacity = Math.min(1, k * 1.4); mat.transparent = k < 0.99; if (shell) shell.material.opacity = 0.35 * k; },
    dispose() { geo.dispose(); mat.dispose(); if (shell) { shell.geometry.dispose(); shell.material.dispose(); } },
  };
  return api;
}
