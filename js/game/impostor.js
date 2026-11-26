// Tree impostors for distant forests: a species' light LOD is rendered once (at load) from 8 azimuths
// into a small atlas, then drawn as camera-facing (cylindrical) cards that pick the atlas frame matching
// the view direction around each tree. Lit by the scene sun/sky through a soft "crown" normal, fogged
// like everything else, and darkened toward the base where a real canopy self-shadows.
//   const imp = makeImpostor(renderer, lodParts, { frames: 8, px: 192 });
//   const mesh = imp.mesh(capacity); imp.set(mesh, i, x, y, z, yaw, scale); mesh.geometry.instanceCount = n;
import * as THREE from 'three';
import { stylize } from '../look.js';

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
    const m = new THREE.MeshBasicMaterial({ map: s.map || null, color: s.color ? s.color.clone() : new THREE.Color(1, 1, 1), alphaTest: s.alphaTest > 0 ? 0.32 : 0, side: THREE.DoubleSide, vertexColors: !!s.vertexColors });
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

  // the crown as a volume: where the leaves sit in the frame (from the leaf parts' bounds), so each pixel
  // gets the normal of a soft ellipsoid crown and is lit like the near trees (look.js ramp, rim, translucency)
  const leafBox = new THREE.Box3();
  for (const p of parts) if (p.mat.alphaTest > 0 || /lea|frond|needle|twig/i.test(p.mat.name || '')) leafBox.union(p.geo.boundingBox);
  if (leafBox.isEmpty()) leafBox.copy(box);
  const crownY = ((leafBox.min.y + leafBox.max.y) / 2 - y0) / h, crownR = Math.max(0.12, (leafBox.max.y - leafBox.min.y) / 2 / h);
  const crownX = Math.min(1, Math.max(leafBox.max.x - leafBox.min.x, leafBox.max.z - leafBox.min.z) / 2 / r);
  // the trunk: a few texels wide in the atlas, so the mips average it away and the crown floated over its
  // spot ("trees hanging behind the hill"). Keep a solid stem from the ground to the crown, as wide as the
  // real trunk's foot (at least ~1.2 texels), in a bark tone where the capture has nothing.
  const isLeaf = (p) => p.mat.alphaTest > 0 || /lea|frond|needle|twig/i.test(p.mat.name || '');
  let stemLow = Infinity, stemHW = 0;
  for (const p of parts) if (!isLeaf(p)) stemLow = Math.min(stemLow, p.geo.boundingBox.min.y);
  if (stemLow - y0 < 0.6) {
    let n = 0, sum = 0;
    for (const p of parts) { if (isLeaf(p)) continue; const P = p.geo.attributes.position; for (let i = 0; i < P.count; i++) if (P.getY(i) < stemLow + 0.6) { sum += Math.hypot(P.getX(i), P.getZ(i)); n++; } }
    stemHW = n ? sum / n : 0;
  }
  const stemU = stemHW > 0 ? Math.max(0.75 * stemHW / (2 * r), 1.2 / px) : 0, stemTop = crownY; // up into the crown: inside it the capture wins
  // never sample below ~12 texels a frame: deeper mips average a whole frame (and its neighbours) into one
  // flat block, which is what made far forests read as hatched rectangles
  const maxLod = Math.max(1, Math.log2(px) - 3.0);
  const mat = new THREE.MeshStandardMaterial({ map: rt.texture, alphaTest: 0.42, roughness: 0.95, metalness: 0, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
      attribute vec4 aPose; // x, y, z, yaw
      attribute float aScale; varying vec3 vImpR, vImpC; varying vec2 vImpUv; varying float vImpSeed;`)
      .replace('#include <uv_vertex>', `#include <uv_vertex>
      vec3 toCam = cameraPosition - aPose.xyz; vec2 dc = normalize(toCam.xz + 1e-4);
      float az = atan(dc.x, dc.y) - aPose.w;
      float fr = mod(floor(az / ${(Math.PI * 2 / frames).toFixed(6)} + 0.5), ${frames.toFixed(1)});
      vMapUv = vec2((uv.x + fr) / ${frames.toFixed(1)}, uv.y);
      vImpR = vec3(dc.y, 0.0, -dc.x); vImpC = vec3(dc.x, 0.0, dc.y); vImpUv = uv; vImpSeed = fract(aPose.x * 0.1307 + aPose.z * 0.7123 + aPose.w * 0.31);`)
      .replace('#include <beginnormal_vertex>', `vec3 objectNormal = normalize(vec3(dc.x, 0.0, dc.y) * 0.75 + vec3(0.0, 0.65, 0.0));`)
      .replace('#include <begin_vertex>', `vec3 transformed = vec3(dc.y, 0.0, -dc.x) * position.x * aScale + vec3(0.0, position.y * aScale, 0.0) + aPose.xyz;`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vImpR, vImpC; varying vec2 vImpUv; varying float vImpSeed;`)
      .replace('#include <map_fragment>', `
      float impMip;
      { vec2 tx = vMapUv * vec2(textureSize(map, 0)); vec2 dx = dFdx(tx), dy = dFdy(tx);
        impMip = clamp(0.5 * log2(max(dot(dx, dx), dot(dy, dy))), 0.0, ${maxLod.toFixed(2)});
        vec4 sampledDiffuseColor = textureLod(map, vMapUv, impMip);
        // leaf cards captured small alias into thin horizontal rows (the "hatching"): take the coverage
        // from one mip softer as well, so gaps between rows close into one leafy mass
        float aSoft = textureLod(map, vMapUv, min(impMip + 1.0, ${(maxLod + 1).toFixed(2)})).a;
        sampledDiffuseColor.a = max(sampledDiffuseColor.a, aSoft * 0.95);
        diffuseColor *= sampledDiffuseColor; }
      diffuseColor.rgb *= mix(0.62, 1.04, smoothstep(0.0, 0.85, vMapUv.y));`)
      .replace('#include <alphatest_fragment>', `
      // no big coverage boost: a boosted mip lifts the empty space around the crown over the cut and the
      // whole frame turns into a block; the mipped alpha thins into the crown's soft mass instead
      diffuseColor.a *= 1.0 + min(impMip, 1.5) * 0.15;
      // art bible 12: far crowns were reading as blocks. Two causes, both cut here.
      // 1) mips bleed the neighbouring atlas frame into this frame's side edges: fade the last texels
      //    (in this mip's texel size) at the frame's left and right borders
      { float fu = fract(vMapUv.x * ${frames.toFixed(1)}), edge = min(fu, 1.0 - fu) * ${fw.toFixed(1)} / exp2(impMip);
        diffuseColor.a *= smoothstep(0.5, 2.0, edge); }
      // 2) a square frame cut leaves square corners: keep the crown inside a soft ellipse (a river-stone
      //    silhouette, art bible 1) and the trunk inside a narrow column under it
      { vec2 q = vec2((vImpUv.x - 0.5) * 2.0 / ${crownX.toFixed(3)}, (vImpUv.y - ${crownY.toFixed(3)}) / ${crownR.toFixed(3)});
        // the edge wanders per tree (lobes like a real crown), so a stand of the same species is not a row of pills
        float ang = atan(q.y, q.x), sd = vImpSeed * 6.2832;
        float rim = 0.82 + 0.1 * sin(ang * 3.0 + sd) + 0.07 * sin(ang * 7.0 - sd * 2.3) + 0.04 * sin(ang * 13.0 + sd * 5.1);
        float crown = 1.0 - smoothstep(rim, rim + 0.18, length(q * vec2(0.95, 1.0)));
        float trunk = (1.0 - smoothstep(0.06, 0.12, abs(vImpUv.x - 0.5))) * step(vImpUv.y, ${crownY.toFixed(3)});
        diffuseColor.a *= max(crown, trunk);
        ${stemU > 0 ? `float stem = (1.0 - smoothstep(${stemU.toFixed(4)}, ${(stemU * 1.7).toFixed(4)}, abs(vImpUv.x - 0.5))) * (1.0 - step(${stemTop.toFixed(3)}, vImpUv.y));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.16, 0.12), stem * (1.0 - smoothstep(0.2, 0.6, diffuseColor.a)));
        diffuseColor.a = max(diffuseColor.a, stem);` : ''} }
      #include <alphatest_fragment>`)
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
      { vec2 q = vec2((vImpUv.x - 0.5) * 2.0 / ${crownX.toFixed(3)}, (vImpUv.y - ${crownY.toFixed(3)}) / ${crownR.toFixed(3)});
        float zz = sqrt(max(0.12, 1.0 - dot(q, q) * 0.85));
        vec3 nW = normalize(vImpR * q.x + vec3(0.0, 1.0, 0.0) * (q.y + 0.25) + vImpC * zz);
        normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz); }`);
  };
  mat.customProgramCacheKey = () => `impostor${frames}|m2|${fw}|${crownX.toFixed(3)},${crownY.toFixed(3)},${crownR.toFixed(3)},${maxLod.toFixed(2)},${stemU.toFixed(4)},${stemTop.toFixed(3)}`;
  crossfadeMaterial(mat, true);
  stylize(mat, 'leaf', { wind: false });
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
