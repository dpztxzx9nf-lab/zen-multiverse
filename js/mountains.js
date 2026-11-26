// Colorado Front Range from real elevation (AWS Terrain Tiles / Mapzen Terrarium),
// baked offline into assets/terrain/front-range-*.bin. No runtime tile fetch.
// Viewer is Longmont (40.167, -105.10). The mesh is in true metres, then drawn
// through a "far group" shrunk toward the camera each frame (same perspective,
// kind to the depth buffer and the 400 m sky dome).
// Garden axes: +X = north, -Z = west, after a small yaw that puts the
// Longs/Meeker massif on the back-wall axis (true bearing ~282.6°, WNW).
import * as THREE from 'three';
import { smoothstep } from './util.js';
import { GLTFLoader } from '../vendor/addons/loaders/GLTFLoader.js';

const FAR_S = 0.006; // 58 km draws at ~350 m, inside the 400 m sky dome
// Mild exaggeration so the real ~3.6° Longs crest still clears the garden wall
// (~2.5° from the range camera) as a jagged horizon band, not a nearby dune.
const EXAG = 1.65;
// Rotate so Longs Peak sits on -Z (the wall / range-camera axis).
const YAW = 12.57 * Math.PI / 180;

export async function createMountains(scene, { P, season, center }) {
  const tier = P.cls === 'pc' ? 'pc' : 'phone';
  // The range is decimated offline (mom-garden-tools/blender/lodkit.py: quadric collapse of the
  // 512x160 grid, silhouette-preserving): PC 162k -> 49k triangles (lod1), phones 19k (lod2).
  // The raw grid stays as the fallback.
  const lodFile = `../assets/terrain/front-range-lod${tier === 'pc' ? 1 : 2}.glb`;
  const [meta, buf, lodGeo] = await Promise.all([
    fetch(new URL(`../assets/terrain/front-range.json`, import.meta.url)).then((r) => r.json()),
    fetch(new URL(`../assets/terrain/front-range-${tier}.bin`, import.meta.url)).then((r) => r.arrayBuffer()),
    new GLTFLoader().loadAsync(new URL(lodFile, import.meta.url).href).then((g) => { let geo = null; g.scene.traverse((o) => { if (o.isMesh && !geo) geo = o.geometry; }); return geo; }).catch(() => null),
  ]);
  const spec = meta[tier];
  const ns = spec.ns, ew = spec.ew;
  const u16 = new Uint16Array(buf);
  const viewElev = meta.viewer.elev;
  const elevAt = (j, i) => meta.elev0 + u16[j * ew + i] * meta.scale;

  const snowLine = season.season === 'winter' ? 3050
    : season.season === 'spring' ? 3250
    : season.season === 'autumn' ? 3450
    : 3550;
  const treeLine = 3350;
  const plains = new THREE.Color('#6a7554');
  const grass = new THREE.Color('#5a6b48');
  const forest = new THREE.Color('#2d4a32');
  const forest2 = new THREE.Color('#3a5638');
  const rock = new THREE.Color('#7a756c');
  const rock2 = new THREE.Color('#8e877c');
  const snow = new THREE.Color('#f3f6fa');
  const c = new THREE.Color();

  const pos = [], col = [], dist = [], elevs = [];
  const cy = Math.cos(YAW), sy = Math.sin(YAW);
  // extra skirt ring so the far and side cuts don't read as a paper edge
  const nx = ew, ny = ns;
  for (let j = 0; j < ny; j++) {
    const north = meta.northMin + (meta.northMax - meta.northMin) * (j / (ny - 1));
    for (let i = 0; i < nx; i++) {
      const east = meta.eastMin + (meta.eastMax - meta.eastMin) * (i / (nx - 1));
      let e = elevAt(j, i);
      // drop the far-west and north/south rims toward the plains so they haze out
      const edgeW = 1 - smoothstep(0.0, 0.08, i / (nx - 1));
      const edgeS = 1 - smoothstep(0.0, 0.06, j / (ny - 1));
      const edgeN = 1 - smoothstep(0.0, 0.06, 1 - j / (ny - 1));
      const drop = Math.max(edgeW, edgeS * 0.7, edgeN * 0.7);
      e = e * (1 - drop) + viewElev * drop;
      const x0 = north, z0 = east;
      const x = x0 * cy + z0 * sy;
      const z = -x0 * sy + z0 * cy;
      const y = (e - viewElev) * EXAG;
      pos.push(x, y, z);
      dist.push(Math.hypot(east, north));
      elevs.push(e);
    }
  }
  let idx = [];
  if (lodGeo) {
    // decimated mesh: positions are already in range metres; recover elevation and ground distance
    pos.length = 0; dist.length = 0; elevs.length = 0;
    const pa = lodGeo.attributes.position;
    for (let k = 0; k < pa.count; k++) {
      const x = pa.getX(k), y = pa.getY(k), z = pa.getZ(k);
      const north = x * cy - z * sy, east = x * sy + z * cy;
      pos.push(x, y, z); dist.push(Math.hypot(east, north)); elevs.push(y / EXAG + viewElev);
    }
    idx = Array.from(lodGeo.index.array);
  } else for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, cc = a + nx, d = cc + 1;
      idx.push(a, cc, b, b, cc, d);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aDist', new THREE.Float32BufferAttribute(dist, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  // flip if the height field came out downward-facing
  const nrm = g.attributes.normal;
  let nySum = 0;
  for (let k = 0; k < nrm.count; k++) nySum += nrm.getY(k);
  if (nySum < 0) {
    const arr = g.index.array;
    for (let t = 0; t < arr.length; t += 3) {
      const tmp = arr[t + 1]; arr[t + 1] = arr[t + 2]; arr[t + 2] = tmp;
    }
    g.computeVertexNormals();
  }

  for (let k = 0; k < elevs.length; k++) {
    const e = elevs[k];
    const slope = 1 - Math.max(0, nrm.getY(k)); // 0 = flat, 1 = cliff
    c.copy(plains).lerp(grass, smoothstep(1550, 1750, e));
    c.lerp(forest, smoothstep(1750, 2200, e));
    c.lerp(forest2, smoothstep(2200, 3000, e));
    c.lerp(rock, smoothstep(treeLine - 180, treeLine + 80, e));
    c.lerp(rock2, smoothstep(0.28, 0.62, slope));
    const sn = smoothstep(snowLine - 80, snowLine + 160, e) * smoothstep(0.12, 0.45, nrm.getY(k));
    c.lerp(snow, sn);
    // steep high faces stay rocky even in winter, with only a dusting
    if (slope > 0.55 && e > 3200) c.lerp(rock, 0.45 * slope);
    col.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));

  const uHaze = { value: new THREE.Color('#b9cfe0') };
  const uHazeK = { value: 0.5 };
  const uGlow = { value: 0 };
  const uGlowColor = { value: new THREE.Color('#ffb080') };
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.95, metalness: 0, fog: false, flatShading: false,
  });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uHaze = uHaze;
    sh.uniforms.uHazeK = uHazeK;
    sh.uniforms.uGlow = uGlow;
    sh.uniforms.uGlowColor = uGlowColor;
    sh.vertexShader = 'attribute float aDist; varying float vD; varying float vH;\n'
      + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vD = aDist; vH = position.y / 1.65;');
    // position.y is already exaggerated; vH in "true" metres above the plains is y/EXAG
    sh.fragmentShader = 'uniform vec3 uHaze, uGlowColor; uniform float uHazeK, uGlow; varying float vD; varying float vH;\n'
      + sh.fragmentShader.replace('#include <dithering_fragment>',
        `// aerial perspective: nearer foothills stay greener, far peaks go bluish
         float od = vD / 45000.0;
         float hz = clamp(1.0 - exp(-od * (0.55 + uHazeK * 1.2)), 0.0, 0.72);
         vec3 far = mix(uHaze, uHaze * vec3(0.86, 0.92, 1.08), smoothstep(8000.0, 50000.0, vD));
         gl_FragColor.rgb = mix(gl_FragColor.rgb, far, hz);
         // warm alpenglow on the high peaks at sunrise/sunset (rim + snow)
         float high = smoothstep(2500.0, 4000.0, vH);
         gl_FragColor.rgb += uGlowColor * uGlow * high * (0.28 + 0.55 * hz);
         #include <dithering_fragment>`);
  };

  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  mesh.name = 'frontRange';

  // Do not add a "nearby" plains band into the far group. After the FAR_S shrink,
  // a plane only 170 m out draws about a metre in front of the camera, at nearly
  // eye height, and reads as a thin bright line cutting through the wall.

  const far = new THREE.Group();
  far.add(mesh);
  far.scale.setScalar(FAR_S);
  scene.add(far);

  function setHaze(color, k) { uHaze.value.copy(color); uHazeK.value = k; }
  function setGlow(amount, color) {
    uGlow.value = amount;
    if (color) uGlowColor.value.copy(color);
  }
  function follow(camPos) { far.position.copy(camPos).multiplyScalar(1 - FAR_S); }
  return { mesh, group: far, setHaze, setGlow, follow };
}
