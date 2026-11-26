// Golden-hour light shafts: soft beams of dusty sunlight slanting down through the bamboo groves and
// maple canopies, only while the sun is low and clear. One instanced additive mesh (one draw call);
// every beam is a quad that turns about its own sun-ray axis to face the eye (all in the vertex shader),
// so nothing is updated on the CPU. Beams fade near the camera, at both ends and with overcast.
//   const shafts = createShafts(scene, { P, spots: [[x, z, radius, n], ...] }); shafts.update(ts, now)
import * as THREE from 'three';
import { mulberry32 } from './util.js';

export function createShafts(scene, { P, spots }) {
  const per = P.cls === 'pc' ? 1 : P.cls === 'tablet' ? 0.7 : 0.45;
  const rnd = mulberry32(4711);
  const G = [], L = [];
  for (const [x, z, r, n] of spots) {
    const k = Math.max(1, Math.round(n * per));
    for (let i = 0; i < k; i++) {
      const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * r;
      G.push(x + Math.cos(a) * d, 1.8 + rnd() * 4.7, z + Math.sin(a) * d); // where the beam leaves the canopy
      L.push(7 + rnd() * 6, 0.7 + rnd() * 1.5, rnd() * 100, 0.55 + rnd() * 0.45); // length, width, phase, strength
    }
  }
  const quad = new THREE.InstancedBufferGeometry();
  quad.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, -0.5, 1, 0, 0.5, 1, 0], 3));
  quad.setIndex([0, 1, 2, 1, 3, 2]);
  quad.setAttribute('aG', new THREE.InstancedBufferAttribute(new Float32Array(G), 3));
  quad.setAttribute('aL', new THREE.InstancedBufferAttribute(new Float32Array(L), 4));
  quad.instanceCount = G.length / 3;
  const U = { uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uCol: { value: new THREE.Color() }, uI: { value: 0 }, uTime: { value: 0 } };
  const mat = new THREE.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      attribute vec3 aG; attribute vec4 aL; uniform vec3 uSunDir; uniform float uTime;
      varying vec2 vQ; varying float vK;
      void main() {
        vec3 up = normalize(uSunDir);
        vec3 p = aG - up * (position.y * aL.x); // light travels away from the sun; a low sun makes long, shallow beams
        vec3 side = normalize(cross(up, cameraPosition - p) + 1e-4);
        p += side * position.x * aL.y * (1.0 - 0.4 * position.y); // widest where it leaves the canopy
        vQ = vec2(position.x * 2.0, position.y);
        float near = smoothstep(2.0, 6.0, distance(cameraPosition, p));
        vK = aL.w * near * (0.65 + 0.35 * sin(uTime * 0.21 + aL.z) * sin(uTime * 0.13 + aL.z * 1.7)); // slow breathing of the light
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uCol; uniform float uI; varying vec2 vQ; varying float vK;
      void main() {
        float a = pow(1.0 - min(abs(vQ.x), 1.0), 2.5) * smoothstep(0.0, 0.12, vQ.y) * smoothstep(1.0, 0.35, vQ.y);
        gl_FragColor = vec4(uCol * a * vK * uI, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(quad, mat);
  mesh.frustumCulled = false; mesh.visible = false; mesh.name = 'lightShafts'; mesh.renderOrder = 5;
  scene.add(mesh);
  return {
    mesh,
    update(ts, now) {
      // low, clear sun only: rises in from ~22 deg, peaks around 6-10 deg, gone at the horizon
      const clear = 1 - Math.min(1, (ts.overcast || 0) * 1.4);
      const k = THREE.MathUtils.smoothstep(ts.elev, 1, 6) * (1 - THREE.MathUtils.smoothstep(ts.elev, 12, 22)) * clear;
      U.uI.value = mesh.userData.force ?? k * 0.8; // debug: lightShafts.userData.force
      mesh.visible = k > 0.02;
      if (!mesh.visible) return;
      U.uSunDir.value.copy(ts.sunDir);
      U.uCol.value.copy(ts.lightColor);
      U.uTime.value = now;
    },
  };
}
