// Tree impostors for distant forests: a species' light LOD is rendered once (at load) from 8 azimuths
// into a small atlas, then drawn as camera-facing (cylindrical) cards that pick the atlas frame matching
// the view direction around each tree. Lit by the scene sun/sky through a soft "crown" normal, fogged
// like everything else, and darkened toward the base where a real canopy self-shadows.
//   const imp = makeImpostor(renderer, lodParts, { frames: 8, px: 192 });
//   const mesh = imp.mesh(capacity); imp.set(mesh, i, x, y, z, yaw, scale); mesh.geometry.instanceCount = n;
import * as THREE from 'three';

// Screen-door crossfade by distance (no sorting, no blending): a mesh instance flagged aXF=1 dissolves
// out between uF0..uF1 metres from the camera while its impostor dissolves in on the complementary
// pixels. Unflagged instances are never touched.
const IGN = 'float xfIGN(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }';
export function crossfadeMaterial(m, impostor, prev) {
  const xf = { uF0: { value: 60 }, uF1: { value: 70 } }; m.userData.xf = xf;
  const before = prev || m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    if (before) before.call(m, sh, r);
    Object.assign(sh.uniforms, xf);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
      attribute float aXF; uniform float uF0, uF1; varying float vXF;`)
      .replace('#include <project_vertex>', `#include <project_vertex>
      { vec3 o = ${impostor ? 'aPose.xyz' : '(modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz'};
        float f = smoothstep(uF0, uF1, distance(o.xz, cameraPosition.xz));
        vXF = aXF > 0.5 ? ${impostor ? 'f' : 'f'} : ${impostor ? '1.0' : '0.0'}; }`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying float vXF; ${IGN}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
      ${impostor ? 'if (xfIGN(gl_FragCoord.xy) >= vXF) discard;' : 'if (xfIGN(gl_FragCoord.xy) < vXF) discard;'}`);
  };
  const key = m.customProgramCacheKey ? m.customProgramCacheKey.bind(m) : () => '';
  m.customProgramCacheKey = () => key() + (impostor ? 'xfI' : 'xfM');
  return m;
}
export function makeImpostor(renderer, parts, { frames = 8, px = 192 } = {}) {
  const box = new THREE.Box3();
  for (const p of parts) { p.geo.computeBoundingBox(); box.union(p.geo.boundingBox); }
  const r = Math.max(Math.abs(box.min.x), Math.abs(box.max.x), Math.abs(box.min.z), Math.abs(box.max.z)) * 1.02;
  const h = (box.max.y - Math.min(0, box.min.y)) * 1.02, y0 = Math.min(0, box.min.y);
  const fw = px, fh = Math.round(px * Math.min(3, Math.max(1, h / (2 * r))));
  const rt = new THREE.WebGLRenderTarget(fw * frames, fh, { samples: 0, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
  const scene = new THREE.Scene();
  // unlit albedo capture: lighting happens at draw time with the live sun
  for (const p of parts) {
    const s = p.mat;
    const m = new THREE.MeshBasicMaterial({ map: s.map || null, color: s.color ? s.color.clone() : new THREE.Color(1, 1, 1), alphaTest: s.alphaTest > 0 ? 0.5 : 0, side: THREE.DoubleSide, vertexColors: !!s.vertexColors });
    if (!s.alphaTest) m.color.multiplyScalar(0.8); // bark reads a touch darker than leaves in silhouette
    scene.add(new THREE.Mesh(p.geo, m));
  }
  const cam = new THREE.OrthographicCamera(-r, r, y0 + h, y0, 0.1, r * 6);
  function bake() {
    const prev = { target: renderer.getRenderTarget(), autoClear: renderer.autoClear, clear: renderer.getClearColor(new THREE.Color()), alpha: renderer.getClearAlpha() };
    renderer.setRenderTarget(rt); renderer.setClearColor(0x2a3a1c, 0); renderer.clear(true, true, true);
    renderer.autoClear = false;
    for (let k = 0; k < frames; k++) {
      const a = (k / frames) * Math.PI * 2;
      cam.position.set(Math.sin(a) * r * 3, 0, Math.cos(a) * r * 3); cam.lookAt(0, 0, 0); cam.position.y = 0; cam.updateMatrixWorld();
      rt.viewport.set(k * fw, 0, fw, fh); rt.scissor.set(k * fw, 0, fw, fh); rt.scissorTest = true;
      renderer.clear(true, true, false);
      renderer.render(scene, cam);
    }
    rt.scissorTest = false; rt.viewport.set(0, 0, fw * frames, fh);
    renderer.setRenderTarget(prev.target); renderer.autoClear = prev.autoClear; renderer.setClearColor(prev.clear, prev.alpha);
  }
  bake();
  // the capture materials stay (tiny) so the atlas can be baked again after a WebGL context loss

  const mat = new THREE.MeshStandardMaterial({ map: rt.texture, alphaTest: 0.42, roughness: 0.95, metalness: 0, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
      attribute vec4 aPose; // x, y, z, yaw
      attribute float aScale;`)
      .replace('#include <uv_vertex>', `#include <uv_vertex>
      vec3 toCam = cameraPosition - aPose.xyz; vec2 dc = normalize(toCam.xz + 1e-4);
      float az = atan(dc.x, dc.y) - aPose.w;
      float fr = mod(floor(az / ${(Math.PI * 2 / frames).toFixed(6)} + 0.5), ${frames.toFixed(1)});
      vMapUv = vec2((uv.x + fr) / ${frames.toFixed(1)}, uv.y);`)
      .replace('#include <beginnormal_vertex>', `vec3 objectNormal = normalize(vec3(dc.x, 0.0, dc.y) * 0.75 + vec3(0.0, 0.65, 0.0));`)
      .replace('#include <begin_vertex>', `vec3 transformed = vec3(dc.y, 0.0, -dc.x) * position.x * aScale + vec3(0.0, position.y * aScale, 0.0) + aPose.xyz;`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      diffuseColor.rgb *= mix(0.55, 1.05, smoothstep(0.0, 0.85, vMapUv.y));`)
      .replace('#include <alphatest_fragment>', `
      { vec2 tx = vMapUv * vec2(textureSize(map, 0)); vec2 dx = dFdx(tx), dy = dFdy(tx);
        diffuseColor.a *= 1.0 + max(0.0, 0.5 * log2(max(dot(dx, dx), dot(dy, dy)))) * 0.3; }
      #include <alphatest_fragment>`);
  };
  mat.customProgramCacheKey = () => 'impostor' + frames;
  crossfadeMaterial(mat, true);
  const quad = new THREE.PlaneGeometry(2 * r, h, 1, 1).translate(0, h / 2 + y0, 0);
  return {
    r, h, material: mat, texture: rt.texture,
    mesh(cap) {
      const g = new THREE.InstancedBufferGeometry();
      g.index = quad.index; g.setAttribute('position', quad.attributes.position); g.setAttribute('uv', quad.attributes.uv); g.setAttribute('normal', quad.attributes.normal);
      g.setAttribute('aPose', new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('aScale', new THREE.InstancedBufferAttribute(new Float32Array(cap), 1).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('aXF', new THREE.InstancedBufferAttribute(new Float32Array(cap), 1).setUsage(THREE.DynamicDrawUsage));
      g.instanceCount = 0;
      const m = new THREE.Mesh(g, mat); m.frustumCulled = false; m.userData.cap = cap; m.name = 'impostors';
      return m;
    },
    set(m, i, x, y, z, yaw, s, xf = 0) { const p = m.geometry.attributes.aPose; p.setXYZW(i, x, y, z, yaw); m.geometry.attributes.aScale.setX(i, s); m.geometry.attributes.aXF.setX(i, xf); },
    commit(m, n) { m.geometry.instanceCount = n; for (const k of ['aPose', 'aScale', 'aXF']) m.geometry.attributes[k].needsUpdate = true; },
    rebake: bake,
    dispose() { rt.dispose(); mat.dispose(); quad.dispose(); scene.traverse((o) => { if (o.isMesh) o.material.dispose(); }); },
  };
}
