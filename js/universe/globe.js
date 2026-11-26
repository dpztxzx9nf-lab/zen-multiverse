// The planet seen from height: one globe coloured and shaped from the same seed as the ground, so
// climbing out of the atmosphere (or coming back down) is one continuous view. It is a real sphere of
// the planet's radius; the world (or the pilot) places and orients it each frame.
//   buildGlobe(W, { detail })           now (small detail for far bodies)
//   buildGlobeAsync(W, { detail })      a few thousand vertices per slice between frames (no hitch)
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
function prep(W, lite, detail) {
  // geodesic (no poles, so no pinched spot under the player wherever you stand); merged so it shades smooth
  const ico = new THREE.IcosahedronGeometry(1, detail != null ? detail : (lite ? 24 : 44)); ico.deleteAttribute('normal'); ico.deleteAttribute('uv');
  const geo = mergeVertices(ico); ico.dispose();
  return { geo, pos: geo.attributes.position, col: new Float32Array(geo.attributes.position.count * 3) };
}
function shade(W, pos, col, i0, i1) {
  const R = W.radius, c = new THREE.Color(), d = [0, 0, 0];
  for (let i = i0; i < i1; i++) {
    d[0] = pos.getX(i); d[1] = pos.getY(i); d[2] = pos.getZ(i); const l = Math.hypot(d[0], d[1], d[2]); d[0] /= l; d[1] /= l; d[2] /= l;
    const { h } = W.colorDir(d, c);
    // relief is exaggerated x3 so mountains read from orbit; seas are flat
    const r = R - 25 + Math.max(W.hasSea ? W.sea : -1e9, h) * 3;
    pos.setXYZ(i, d[0] * r, d[1] * r, d[2] * r); col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
}
function finish(W, geo, col) {
  const R = W.radius;
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.computeVertexNormals(); geo.computeBoundingSphere();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, transparent: true, opacity: 0, depthWrite: true });
  mat.userData.noCurve = true;
  const mesh = new THREE.Mesh(geo, mat); mesh.userData.noCurve = true; mesh.visible = false; mesh.frustumCulled = false; mesh.name = 'globe';
  // a thin atmosphere shell, tinted by the sky, thickness from pressure
  let shell = null;
  if (W.rules && W.rules.atmosphere.pressureKPa > 0.5) {
    const sm = new THREE.MeshBasicMaterial({ color: W.sky.horizon, transparent: true, opacity: 0, side: THREE.BackSide, depthWrite: false, blending: THREE.AdditiveBlending });
    sm.userData.noCurve = true;
    shell = new THREE.Mesh(new THREE.SphereGeometry(R * (1.025 + 0.02 * W.sky.haze), 48, 24), sm); shell.userData.noCurve = true; shell.frustumCulled = false; mesh.add(shell);
  }
  let far = false;
  const api = {
    mesh, R,
    // place the globe under the current tile frame (walking: the planet sits under the tile's anchor)
    orient(frame) {
      const e = frame.e, a = frame.a, s = frame.s;
      // local = [e; a; s] * global  -> rotation matrix with those rows
      const m = new THREE.Matrix4().set(e[0], e[1], e[2], 0, a[0], a[1], a[2], 0, s[0], s[1], s[2], 0, 0, 0, 0, 1);
      mesh.quaternion.setFromRotationMatrix(m); mesh.position.set(0, -R, 0); mesh.scale.setScalar(1);
    },
    // k: 0 = on the ground (hidden) .. 1 = fully visible from orbit
    setFade(k) { mesh.visible = k > 0.001; mat.opacity = Math.min(1, k * 1.4); mat.transparent = k < 0.99; if (shell) shell.material.opacity = 0.35 * k; },
    // far away (distance-compressed by the pilot): drawn behind everything, in distance order
    setFar(on, order = -5) {
      if (on !== far) { far = on; mat.depthTest = mat.depthWrite = !on; if (shell) shell.material.depthTest = !on; }
      mesh.renderOrder = on ? order : 0; if (shell) shell.renderOrder = on ? order + 0.01 : 0;
    },
    dispose() { geo.dispose(); mat.dispose(); if (shell) { shell.geometry.dispose(); shell.material.dispose(); } },
  };
  return api;
}
export function buildGlobe(W, { lite = false, detail = null } = {}) {
  const { geo, pos, col } = prep(W, lite, detail);
  shade(W, pos, col, 0, pos.count);
  return finish(W, geo, col);
}
export async function buildGlobeAsync(W, { lite = false, detail = null, slice = 2500, cancelled = () => false } = {}) {
  const { geo, pos, col } = prep(W, lite, detail);
  for (let i = 0; i < pos.count; i += slice) {
    shade(W, pos, col, i, Math.min(pos.count, i + slice));
    await new Promise((r) => setTimeout(r, 0));
    if (cancelled()) { geo.dispose(); return null; }
  }
  return finish(W, geo, col);
}
