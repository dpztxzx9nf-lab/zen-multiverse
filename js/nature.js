// Stylized nature assets (Quaternius Stylized Nature MegaKit, CC0), compressed with meshopt + WebP.
// Phones load the lite bundle (512px textures, simplified meshes); PC loads the full one.
// Materials get a painted treatment: matte, soft rim light, leaves with bent normals and
// sun translucency, season recolouring and the shared wind.
import * as THREE from 'three';
import { loadGLB } from './ktx2.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { mulberry32 } from './util.js';
import { WIND_GLSL } from './util.js';
import { addSnowCover } from './weather.js';
import { createKarikomi } from './karikomi.js';

// shared lighting uniforms for the painted look (updated by main each time-of-day tick)
export const LOOK = {
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uSunCol: { value: new THREE.Color(1, 0.95, 0.85) },
  uRim: { value: 0.35 },
  uTrans: { value: 1 },
};

export async function loadNature(P) {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loadGLB(loader, P.cls === 'pc' ? 'nature-full.glb' : 'nature-lite.glb');
  const T = {};
  gltf.scene.traverse((o) => { if (o.parent === gltf.scene || (o.name && !T[o.name] && o.parent && o.parent.type === 'Scene')) T[o.name] = o; });
  gltf.scene.children.forEach((c) => { T[c.name] = c; });
  return T;
}

// --- painted material patch ----------------------------------------------------------------
export function paint(mat, { leaf = false, sway = null, swayH = 3, swayAmp = 0.1, remap = null, snow = null, snowK = 1 } = {}) {
  mat.metalness = 0; mat.roughness = leaf ? 0.8 : 0.92;
  if (mat.map) mat.map.anisotropy = 4;
  if (leaf && mat.roughnessMap) { mat.roughnessMap = null; mat.metalnessMap = null; } // ARM is 0 off-leaf: mips made glinting white edges
  if (leaf) { mat.alphaTest = 0.45; mat.side = THREE.DoubleSide; mat.alphaToCoverage = true; mat.transparent = false; mat.depthWrite = true; } // glTF BLEND leaves load with depthWrite off
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    sh.uniforms.uSunDir = LOOK.uSunDir; sh.uniforms.uSunCol = LOOK.uSunCol; sh.uniforms.uRim = LOOK.uRim; sh.uniforms.uTrans = LOOK.uTrans;
    if (remap) { sh.uniforms.uRemapA = remap.a; sh.uniforms.uRemapB = remap.b; sh.uniforms.uRemapK = remap.k; }
    if (snow) sh.uniforms.uSnow = snow;
    let vs = sh.vertexShader, fs = sh.fragmentShader;
    vs = 'varying vec3 vWN; varying vec3 vWP;\n' + vs.replace('#include <worldpos_vertex>',
      `#include <worldpos_vertex>
       vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;
       vWN = normalize(mat3(modelMatrix) * objectNormal);`);
    if (sway) {
      sh.uniforms.uTime = sway.uTime; sh.uniforms.uWind = sway.uWind; sh.uniforms.uWindDir = sway.uWindDir;
      vs = WIND_GLSL + vs.replace('#include <project_vertex>', `vec4 mvPosition = vec4( transformed, 1.0 );
        #ifdef USE_INSTANCING
          mvPosition = instanceMatrix * mvPosition;
        #endif
        { vec4 wq = modelMatrix * mvPosition; float hh = clamp(mvPosition.y / ${swayH.toFixed(2)}, 0.0, 1.5);
          mvPosition.xyz += windOffset(wq.xyz, hh * hh * ${swayAmp.toFixed(3)}); }
        mvPosition = modelViewMatrix * mvPosition;
        gl_Position = projectionMatrix * mvPosition;`);
    }
    fs = `uniform vec3 uSunDir, uSunCol; uniform float uRim, uTrans; varying vec3 vWN; varying vec3 vWP;
      ${remap ? 'uniform vec3 uRemapA, uRemapB; uniform float uRemapK;' : ''}
      ${snow ? 'uniform float uSnow;' : ''}\n` + fs;
    if (leaf) fs = fs.replace('#include <alphatest_fragment>', `
      #ifdef USE_MAP
      { vec2 tx = vMapUv * vec2(textureSize(map, 0)); vec2 dx = dFdx(tx), dy = dFdy(tx);
        float mip = max(0.0, 0.5 * log2(max(dot(dx, dx), dot(dy, dy))));
        diffuseColor.a *= 1.0 + mip * 0.28; }
      #endif
      #include <alphatest_fragment>`);
    if (remap) fs = fs.replace('#include <map_fragment>', `#include <map_fragment>
      { float l = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
        vec3 rc = mix(uRemapA, uRemapB, smoothstep(0.03, 0.42, l));
        diffuseColor.rgb = mix(diffuseColor.rgb, rc, uRemapK); }`);
    if (snow) fs = fs.replace('#include <color_fragment>', `#include <color_fragment>
      { vec2 sp = vWP.xz * 2.5 + vWP.y * 1.3, si = floor(sp), sf = fract(sp); sf = sf * sf * (3.0 - 2.0 * sf);
        #define SH(o) fract(sin(dot(si + o, vec2(12.9898, 78.233))) * 43758.5453)
        float n = mix(mix(SH(vec2(0, 0)), SH(vec2(1, 0)), sf.x), mix(SH(vec2(0, 1)), SH(vec2(1, 1)), sf.x), sf.y);
        #undef SH
        float k = smoothstep(0.35, 0.85, vWN.y + (n - 0.5) * 0.35) * uSnow * ${snowK.toFixed(2)};
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.95, 1.0), k); }`);
    // leaves: never flip normals on back faces (bent normals already point outward)
    if (leaf) fs = fs.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n normal = normalize(vNormal);');
    fs = fs.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      { vec3 V = normalize(cameraPosition - vWP); vec3 N = normalize(vWN);
        float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0) * uRim;
        totalEmissiveRadiance += diffuseColor.rgb * uSunCol * rim * ${leaf ? '0.3' : '0.6'};
        ${leaf ? `// transmitted light passes through the blade: tinted twice by chlorophyll, so it is a deeper,
        // saturated yellow-green (albedo squared), never a pale wash
        float back = pow(max(dot(-V, uSunDir), 0.0), 4.0);
        vec3 tr = diffuseColor.rgb * diffuseColor.rgb * vec3(2.6, 2.9, 1.6);
        totalEmissiveRadiance += tr * uSunCol * back * 0.6 * uTrans;` : ''} }`);
    sh.vertexShader = vs; sh.fragmentShader = fs;
    if (prev) prev(sh, r);
  };
  const key = `paint${leaf}${!!sway}${swayH}${swayAmp}${!!remap}${!!snow}${snowK}`;
  mat.customProgramCacheKey = () => key;
  return mat;
}

// meshopt-quantized attributes (normalized ints) -> plain floats so geometry can be transformed
function toFloat(geo) {
  const g = geo.clone();
  for (const k of Object.keys(g.attributes)) {
    const a = g.attributes[k];
    if (a.isInterleavedBufferAttribute || a.normalized || !(a.array instanceof Float32Array)) {
      const n = a.count, sz = a.itemSize, out = new Float32Array(n * sz);
      for (let i = 0; i < n; i++) for (let c = 0; c < sz; c++) out[i * sz + c] = a.getComponent ? a.getComponent(i, c) : [a.getX(i), a.getY(i), a.getZ(i), a.getW(i)][c];
      g.setAttribute(k, new THREE.BufferAttribute(out, sz));
    }
  }
  return g;
}

// bend leaf-card normals outward from the canopy centre so foliage shades like a soft volume
function bendNormals(geo, k = 0.85) {
  geo = toFloat(geo);
  geo.computeBoundingBox();
  const c = geo.boundingBox.getCenter(new THREE.Vector3());
  const size = geo.boundingBox.getSize(new THREE.Vector3());
  c.y += size.y * 0.1;
  const p = geo.attributes.position, n = geo.attributes.normal;
  const v = new THREE.Vector3(), o = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).sub(c).divide(size).normalize();
    o.fromBufferAttribute(n, i);
    if (o.dot(v) < 0) o.negate();
    o.lerp(v, k).normalize();
    n.setXYZ(i, o.x, o.y, o.z);
  }
  n.needsUpdate = true;
  return geo;
}

const isLeafMat = (m) => /Lea|Grass|Flower/i.test(m.name || '');

// season palettes for foliage (remap of texture luminance onto two colours)
const LEAF_SEASON = {
  maple: {
    spring: ['#c97a98', '#ffe3ee', 1], summer: ['#2e5a24', '#9cc65e', 1], autumn: ['#7a1410', '#f0602a', 0.0], winter: null,
  },
  // scanned maple card leaves are already a natural green: summer keeps them, other seasons remap
  smaple: {
    spring: ['#b86a86', '#ffd9e6', 0.85], summer: null, autumn: ['#6a1208', '#ee5a20', 0.92], winter: null,
  },
  shrub: {
    spring: ['#28501f', '#8fbf55', 1], summer: ['#24481c', '#7fae48', 1], autumn: ['#3a4a1c', '#a8a444', 0.9], winter: ['#2d3e26', '#6d8058', 1],
  },
};

export function placeNature(scene, T, { P, season, sway, uSnow, sandRocks, pondStones, stepStones, free, scanRocks = false, scanTrees = null }) {
  const S = season.season;
  const rnd = mulberry32(4242);
  const matCache = new Map();
  const remaps = {};
  function remapFor(kind) {
    if (remaps[kind] !== undefined) return remaps[kind];
    const pal = LEAF_SEASON[kind][S];
    remaps[kind] = pal ? { a: { value: new THREE.Color(pal[0]) }, b: { value: new THREE.Color(pal[1]) }, k: { value: pal[2] } } : null;
    return remaps[kind];
  }
  function matFor(src, opts, tag) {
    const key = src.uuid + tag;
    if (!matCache.has(key)) matCache.set(key, paint(src.clone(), opts));
    return matCache.get(key);
  }
  const groupOut = new THREE.Group();
  scene.add(groupOut);

  // place a whole model (non-instanced) with painted materials
  function place(name, x, y, z, s, ry, { kind = 'tree', swayH = 15, swayAmp = 0.6, remapKind = null, shadow = true, hideLeaves = false } = {}) {
    const src = T[name]; if (!src) return null;
    const o = new THREE.Group();
    o.add(src.clone(true));
    o.position.set(x, y, z); o.scale.setScalar(s); o.rotation.y = ry;
    o.traverse((m) => {
      if (!m.isMesh) return;
      const leaf = isLeafMat(m.material);
      if (leaf && hideLeaves) { m.visible = false; return; }
      if (leaf && !m.geometry.userData.bent) { m.geometry = bendNormals(m.geometry); m.geometry.userData.bent = true; }
      m.material = matFor(m.material, {
        leaf, sway: (leaf || kind === 'tree') ? sway : null, swayH, swayAmp: leaf ? swayAmp : swayAmp * 0.25,
        remap: leaf && remapKind ? remapFor(remapKind) : null, snow: uSnow, snowK: leaf ? 0.6 : 0.9,
      }, `${kind}${remapKind}${swayH}`);
      m.castShadow = shadow && !leaf; m.receiveShadow = true;
      if (leaf) m.userData.phys = { k: 'pass', why: 'leaves' };
    });
    o.userData.phys = { k: 'solid', name: name.replace(/_\d+$/, '').toLowerCase() }; // js/solids-bake.js
    groupOut.add(o);
    return o;
  }

  // instanced scatter of a small model: one InstancedMesh per primitive
  function scatter(name, list, { swayH = 1, swayAmp = 0.15, remapKind = null, shadow = false, solid = /rock|pebble|stone/i.test(name) } = {}) {
    const src = T[name]; if (!src || !list.length) return;
    src.updateMatrixWorld(true);
    const dummy = new THREE.Object3D();
    src.traverse((m) => {
      if (!m.isMesh) return;
      const leaf = isLeafMat(m.material);
      const g = (leaf ? bendNormals(m.geometry, 0.6) : toFloat(m.geometry)).applyMatrix4(m.matrixWorld);
      const mat = matFor(m.material, { leaf, sway, swayH, swayAmp, remap: leaf && remapKind ? remapFor(remapKind) : null, snow: uSnow, snowK: 0.7 }, `inst${name}`);
      const im = new THREE.InstancedMesh(g, mat, list.length);
      list.forEach(([x, z, s, ry, y = 0], i) => {
        dummy.position.set(x, y, z); dummy.rotation.set(0, ry, 0); dummy.scale.setScalar(s); dummy.updateMatrix();
        im.setMatrixAt(i, dummy.matrix);
      });
      im.castShadow = shadow; im.receiveShadow = true;
      im.userData.phys = solid ? { k: 'solid', name: 'rock' } : { k: 'pass', why: 'ground cover: ferns, flowers, grass' };
      groupOut.add(im);
    });
  }

  // a scanned tree: LOD (near cards / far thinned cards), painted materials, wind sway
  const lodFar = P.cls === 'pc' ? 16 : 0;
  function placeScan(model, x, z, s, ry, { swayH = 6, swayAmp = 0.5, remapKind = null, hideLeaves = false, shadow = true, far = lodFar } = {}) {
    const v = model.variants[0];
    const lod = new THREE.LOD();
    v.lods.forEach((L, li) => {
      if (P.cls !== 'pc' && li < v.lods.length - 1) return; // phones: far LOD only
      const g = new THREE.Group();
      for (const part of L.parts) {
        const leaf = /lea|twig/i.test(part.material.name || '');
        if (leaf && hideLeaves) continue;
        const mat = matFor(part.material, { leaf, sway, swayH, swayAmp: leaf ? swayAmp : swayAmp * 0.3, remap: leaf && remapKind ? remapFor(remapKind) : null, snow: uSnow, snowK: leaf ? 0.6 : 0.9 }, `scan${remapKind}${swayH}`);
        if (leaf) { mat.roughness = 0.9; mat.envMapIntensity = 0.6; mat.color.setRGB(0.78, 0.88, 0.7); }
        const m = new THREE.Mesh(part.geometry, mat);
        m.castShadow = shadow && !leaf; m.receiveShadow = true;
        if (leaf) m.userData.phys = { k: 'pass', why: 'leaves and twigs' };
        g.add(m);
      }
      // 2 LODs: near / far; 3 (firs, lodkit/tree_build mid level): near / half-way / far
      lod.addLevel(g, li === 0 ? 0 : v.lods.length > 2 && li === 1 ? far * 0.5 : far);
    });
    lod.position.set(x, 0, z); lod.scale.setScalar(s); lod.rotation.y = ry;
    lod.userData.phys = { k: 'solid', name: 'tree' }; // trunk and branches, from the full-detail level
    groupOut.add(lod);
    return lod;
  }

  // ---- maples (twisted trees, coloured by season; bare in winter)
  const winter = S === 'winter';
  if (scanTrees) {
    placeScan(scanTrees.maple, 13.6, -7.4, 1.0, 0.6, { remapKind: 'smaple', swayH: 7, swayAmp: 0.35, hideLeaves: winter });
    placeScan(scanTrees.maple, -12.4, -7.8, 0.9, 2.2, { remapKind: 'smaple', swayH: 7, swayAmp: 0.35, hideLeaves: winter });
    placeScan(scanTrees.maple, 17.4, 7.6, 0.85, -0.8, { remapKind: 'smaple', swayH: 7, swayAmp: 0.35, hideLeaves: winter });
    // leaf litter under the canopies (set dressing): flat cut-out fronds from the maple's own atlas,
    // tinted from fresh green through straw to brown, thicker in autumn
    {
      const lp = scanTrees.maple.variants[0].lods[0].parts.find((pt) => /lea/i.test(pt.material.name || ''));
      if (lp && lp.material.map) {
        const n = Math.round((P.cls === 'pc' ? 420 : 140) * (S === 'autumn' ? 1.8 : S === 'winter' ? 0.6 : 1));
        const g = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
        const m = new THREE.MeshStandardMaterial({ map: lp.material.map, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.95, metalness: 0 });
        const im = new THREE.InstancedMesh(g, m, n);
        const d = new THREE.Object3D(), c = new THREE.Color();
        const spots = [[13.6, -7.4, 4.2], [-12.4, -7.8, 4], [17.4, 7.6, 3.6]];
        const tints = S === 'autumn' ? ['#b8452a', '#d07a35', '#8a3a20', '#c9a050'] : ['#7d8a52', '#a39a62', '#8a6e48', '#b0a878'];
        let k = 0, guard = 0;
        while (k < n && guard++ < n * 20) {
          const [tx, tz, R] = spots[k % spots.length];
          const a = rnd() * 6.283, r = Math.sqrt(rnd()) * R;
          const x = tx + Math.cos(a) * r, z = tz + Math.sin(a) * r * 0.8;
          if (free && !free(x, z)) continue;
          const sc = 0.22 + rnd() * 0.22;
          d.position.set(x, 0.012 + rnd() * 0.01, z); d.rotation.set((rnd() - 0.5) * 0.25, rnd() * 6.283, (rnd() - 0.5) * 0.25); d.scale.set(sc, 1, sc * (0.5 + rnd() * 0.5));
          d.updateMatrix(); im.setMatrixAt(k, d.matrix);
          im.setColorAt(k, c.set(tints[Math.floor(rnd() * tints.length)]).multiplyScalar(0.75 + rnd() * 0.4));
          k++;
        }
        im.count = k; im.receiveShadow = true;
        im.userData.phys = { k: 'pass', why: 'leaf litter' };
        groupOut.add(im);
      }
    }
    // cloud-pruned feature trees (niwaki) where the garden opens up
    const cand = [[-8.2, -9.8], [9.2, 9.6], [-14.2, 6.8], [6.5, -10.2], [-6.8, 11.4], [15.6, -3.6]];
    let n = 0;
    for (const [x, z] of cand) {
      if (n >= 2 || (free && !free(x, z))) continue;
      placeScan(scanTrees.niwaki, x, z, 0.95 + n * 0.15, n * 2.1 + 0.4, { swayH: 4, swayAmp: 0.18 });
      n++;
    }
  }
  if (!scanTrees) place('TwistedTree_1', 13.6, 0, -7.4, 0.42, 0.6, { remapKind: 'maple', swayH: 17, swayAmp: 0.9, hideLeaves: winter });
  if (!scanTrees) place('TwistedTree_3', -12.4, 0, -7.8, 0.38, 2.2, { remapKind: 'maple', swayH: 16, swayAmp: 0.9, hideLeaves: winter });
  if (!scanTrees) place('TwistedTree_5', 17.4, 0, 7.6, 0.36, -0.8, { remapKind: 'maple', swayH: 15, swayAmp: 0.9, hideLeaves: winter });
  // ---- pines beyond the wall, a soft dark backdrop
  // pines frame the view in two stands, leaving a window over the wall to the high peaks
  const pines = [['Pine_1', -9.5, -16, 1.05, 0.3], ['Pine_5', 10.5, -15.8, 0.85, 1.2], ['Pine_3', -13.5, -19, 1.0, 2.0], ['Pine_1', 14.5, -17, 0.9, 4.1],
    ['Pine_3', -16, -15.5, 0.95, 5.0], ['Pine_5', 17.5, -20, 0.9, 0.7], ['Pine_1', -19, -14, 0.8, 3.3]];
  if (scanTrees) pines.forEach(([, x, z, s, r], i) => placeScan(i % 2 ? scanTrees.fir2 : scanTrees.fir, x, z, s * (i % 2 ? 1.12 : 0.98), r, { swayH: 9, swayAmp: 0.22, far: 16 }));
  else for (const [n, x, z, s, r] of pines) place(n, x, 0, z, s * 1.9, r, { swayH: 8, swayAmp: 0.25 });

  // ---- clipped shrubs (azalea mounds) along the edges
  const shrubSpots = [[-14.8, -3.5, 1.3], [-15.2, 4.5, 1.0], [-11.5, -10.5, 1.2], [7.2, -10.4, 1.1], [16.8, -2.2, 1.0], [-4.8, -11.0, 1.0],
    [14.5, 7.8, 0.9], [-12.8, 9.2, 0.8], [-1.5, -11.2, 0.8], [12.5, -10.8, 1.2], [-11.5, 12.5, 1.1], [-9.6, 13.4, 0.7], [12.0, 11.8, 1.0], [-17.5, 8.5, 1.2],
    // a little mid-ground mass on the open west/south so phone sunset isn't just lawn and two stalks
    [-10.6, 6.2, 1.05], [-12.2, 1.8, 0.95], [-9.4, 8.4, 0.8], [4.8, 10.6, 0.9]];
  const flowering = S === 'spring' || S === 'summer';
  // sheared satsuki mounds (karikomi.js): leaf-card skin over a dark core, blooming in late spring
  createKarikomi(groupOut, { P, sway, season, spots: shrubSpots.map(([x, z, s]) => [x, z, s * 0.95]), flowering: (i) => S === 'spring' && i % 2 === 0 });
  void flowering;

  // ---- rocks: sand stones, pond edge, stepping stones
  const rocksA = ['Rock_Medium_1', 'Rock_Medium_2', 'Rock_Medium_3'];
  const rockLists = { Rock_Medium_1: [], Rock_Medium_2: [], Rock_Medium_3: [] };
  sandRocks.forEach((r, i) => rockLists[rocksA[i % 3]].push([r.x, r.z, r.r * 0.7, r.seed, 0.02 - r.r * 0.12]));
  const peb = ['Pebble_Round_1', 'Pebble_Round_2', 'Pebble_Round_3', 'Pebble_Round_4', 'Pebble_Round_5'];
  const pebLists = {}; peb.forEach((p) => (pebLists[p] = []));
  pondStones.forEach((st, i) => {
    const y = st.y ?? -0.16;
    if (st.pebble) pebLists[peb[i % 5]].push([st.x, st.z, Math.max(0.28, st.s * 2.4), st.ry, Math.min(-0.04, y * 0.6)]);
    else rockLists[rocksA[(i * 7) % 3]].push([st.x, st.z, st.s * 0.38, st.ry, y]);
  });
  if (!scanRocks) for (const k of rocksA) scatter(k, rockLists[k], { swayAmp: 0, shadow: true });
  stepStones.forEach(([x, z, s], i) => pebLists[peb[i % 5]].push([x, z, s * 3.0, rnd() * 6.28, -0.02]));
  if (!scanRocks) for (const k of peb) scatter(k, pebLists[k], { swayAmp: 0, shadow: false });

  // ---- understory: ferns, flowers, broad leaves, clover, mushrooms gathered at edges
  const nearEdge = [];
  const cx = 1, cz = 0;
  const N = P.cls === 'pc' ? 1 : P.cls === 'tablet' ? 0.7 : 0.55;
  function ring(name, n, minR, maxR, s0, s1, filter) {
    const out = [];
    let guard = 0;
    while (out.length < n * N && guard++ < 4000) {
      const a = rnd() * Math.PI * 2, r = minR + rnd() * (maxR - minR);
      const x = cx + Math.cos(a) * r * 1.25, z = cz + Math.sin(a) * r * 0.85;
      if (filter && !filter(x, z)) continue;
      out.push([x, z, s0 + rnd() * (s1 - s0), rnd() * 6.28]);
    }
    scatter(name, out, { swayH: 1, swayAmp: 0.12, remapKind: null });
    return out;
  }
  const ok = free;
  if (S !== 'winter') {
    ring('Fern_1', 22, 14, 21, 0.09, 0.14, ok);
    ring('Flower_3_Group', 14, 13, 19, 0.28, 0.4, ok);
    ring('Plant_1_Big', 12, 13, 20, 0.22, 0.32, ok);
  }
  ring('Clover_2', 26, 12, 20, 0.35, 0.5, ok);
  ring('Grass_Wispy_Short', 40, 11, 22, 0.35, 0.6, ok);
  if (S === 'autumn' || S === 'summer') ring('Mushroom_Common', 6, 15, 20, 0.45, 0.7, ok);
  const trees = [[13.6, -7.4, 0.35, 6, 'maple'], [-12.4, -7.8, 0.35, 6, 'maple'], [17.4, 7.6, 0.35, 6, 'maple'], ...pines.map(([, x, z]) => [x, z, 0.5, 13, 'pine'])]
    .map(([x, z, r, h, name]) => ({ x, z, r, h, name }));
  return { group: groupOut, nearEdge, trees };
}
