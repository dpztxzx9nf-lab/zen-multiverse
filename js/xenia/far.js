// The far land: one low-resolution ring of terrain around her, from just inside the edge of the streamed
// chunks out to the horizon of the highest peaks (a 900 m peak shows from 3.4 km; from up there you see
// about 7 km). Heights and colours come from the planet itself (W.colorDir: land, sea, snow), sampled on a
// polar grid that is rebuilt a slice per frame when she has moved far enough. Inside the near ground's
// radius the ring hides itself (the chunks draw that), so the two never fight.
//   const far = createFarTerrain({ scene, lite }); far.update(W, x, z, nearR); far.dispose()
import * as THREE from 'three';

export function createFarTerrain({ scene, lite = false, outer = null }) {
  const NA = lite ? 80 : 128, NR = lite ? 30 : 42;
  const R1 = outer || (lite ? 6000 : 7500);
  const N = NA * (NR + 1);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 4 });
  const U = { uFarHole: { value: 300 }, uFarC: { value: new THREE.Vector2() } };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = 'varying vec3 vFarW;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n vFarW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = 'varying vec3 vFarW; uniform float uFarHole; uniform vec2 uFarC;\n' + sh.fragmentShader.replace('void main() {', 'void main() {\n if (length(vFarW.xz - uFarC) < uFarHole) discard;');
  };
  mat.customProgramCacheKey = () => 'xenia-far';
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const idx = [];
  for (let j = 0; j < NR; j++) for (let i = 0; i < NA; i++) { const a = j * NA + i, b = j * NA + (i + 1) % NA, c = (j + 1) * NA + i, d = (j + 1) * NA + (i + 1) % NA; idx.push(a, b, c, b, d, c); }
  geo.setIndex(idx);
  const mesh = new THREE.Mesh(geo, mat); mesh.name = 'far-land'; mesh.frustumCulled = false; mesh.visible = false; mesh.renderOrder = -1;
  scene.add(mesh);
  // the build in progress (a slice per frame) and where the drawn one is centred
  let job = null, drawn = null;
  const tmpC = new THREE.Color(), dir = [0, 0, 0];
  const radius = (j, r0) => r0 * Math.pow(R1 / r0, j / NR);
  function start(W, x, z, nearR) {
    const r0 = Math.max(120, nearR * 0.55);
    job = { W, frame: W.frame, x, z, r0, k: 0, pos: new Float32Array(N * 3), col: new Float32Array(N * 3) };
  }
  function step(budget) {
    const J = job, W = J.W; if (W.frame !== J.frame) { job = null; return; }
    const sea = W.hasSea ? W.sea : -1e9;
    for (let n = 0; n < budget && J.k < N; n++, J.k++) {
      const j = Math.floor(J.k / NA), i = J.k % NA, r = radius(j, J.r0), a = (i / NA) * Math.PI * 2;
      const x = J.x + Math.sin(a) * r, z = J.z + Math.cos(a) * r;
      W.frame.toDir(x, z, dir);
      const { h, c } = W.colorDir(dir, tmpC);
      const y = Math.max(h, sea - 0.05) - 1.5 - r * 0.0015;
      J.pos[J.k * 3] = x; J.pos[J.k * 3 + 1] = y; J.pos[J.k * 3 + 2] = z;
      J.col[J.k * 3] = c.r; J.col[J.k * 3 + 1] = c.g; J.col[J.k * 3 + 2] = c.b;
    }
    if (J.k < N) return;
    pos.set(J.pos); col.set(J.col);
    geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true;
    geo.computeVertexNormals(); geo.computeBoundingSphere();
    drawn = { frame: J.frame, x: J.x, z: J.z, r0: J.r0 }; job = null; mesh.visible = true;
  }
  return {
    mesh,
    // every frame: keep the ring centred near her (rebuilt in slices; the old one stays up meanwhile)
    update(W, x, z, nearR, camX, camZ) {
      if (!W) { mesh.visible = false; return; }
      U.uFarHole.value = Math.max(80, nearR - 70); U.uFarC.value.set(camX ?? x, camZ ?? z);
      if (drawn && drawn.frame !== W.frame) { mesh.visible = false; drawn = null; }
      const moved = !drawn || Math.hypot(x - drawn.x, z - drawn.z) > nearR * 0.3;
      if (!job && moved) start(W, x, z, nearR);
      if (job) step(drawn ? (lite ? 500 : 900) : N); // the first one at once (behind the arrival fade)
    },
    hide() { mesh.visible = false; drawn = null; job = null; },
    get ready() { return !!drawn; },
    dispose() { scene.remove(mesh); geo.dispose(); mat.dispose(); },
  };
}
