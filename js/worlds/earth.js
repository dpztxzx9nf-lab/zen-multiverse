// World "earth": the home garden. Everything that belongs to this world (scene, light, camera drift,
// time of day, post look, touches/tending) lives here; js/main.js is the shared engine
// (renderer, input routing, frame loop, adaptive pixel ratio, world switching).
// Interface returned to the world manager:
//   { scene, camera, tending, resize(w, h, pixelRatio), frame(dt, raw), input: { down, move, up, leave, hover },
//     degrade(), debug }
import { tick } from '../haptics.js';
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createSky, computeTime } from '../sky.js';
import { createSkyPhoto } from '../skyphoto.js';
import { createSand, SAND, SAND_ROCKS } from '../sand.js';
import { createPond, POND } from '../pond.js';
import { createBonsai } from '../bonsai.js';
import { createFlora, CENTER } from '../flora.js';
import { placedRock, rockMaterial, rockQuality } from '../rocks.js';
import { computeSeason } from '../season.js';
import { loadNature, placeNature, LOOK } from '../nature.js';
import { createMountains } from '../mountains.js';
import { createSnapdragons } from '../snapdragon.js';
import { createFinds } from '../finds.js';
import { createLizard } from '../lizard.js';
import { createState } from '../state.js';
import { createTending } from '../tending.js';
import { slice as saveSlice, persist as savePersist } from '../save.js';
import { createWeather, addSnowCover } from '../weather.js';
import { createSurprises } from '../surprises.js';
import { createGodRays, createGrade } from '../post.js';
import { createCameraRig } from '../camera-rig.js';
import { createColliders } from '../colliders.js';
import { createEarthGame, BED_ZONE } from '../game/earth-game.js';
import { fpFov } from '../game/player.js';
import { loadSet } from '../game/pbr.js';
import { createGrass } from '../grass.js';
import { loadGardenRocks, placeGardenRocks, loadGardenTrees } from '../gardenrocks.js';
import { loadLightmaps, applyStaticLightmaps, applyRockLightmaps, updateLightmapStrength } from '../lightmap.js';
import { createLife } from '../life.js';
import { fbm3, mulberry32, smoothstep, lerp, clamp, mergeGeometries, windGust } from '../util.js';

export async function createEarth({ renderer, canvas, P, params, DEBUG, audio, engine, worlds }) {
const hourOverride = params.has('hour') ? parseFloat(params.get('hour')) : null;
const growOverride = params.has('grow') ? parseFloat(params.get('grow')) || 0 : 0;
rockQuality.segs = P.rockSegs;
document.documentElement.dataset.device = P.cls;
const SEASON = computeSeason(new Date(), params);
const uSnow = { value: SEASON.snowCover };
addSnowCover(rockMaterial(), uSnow, { strength: 0.9 });
renderer.shadowMap.type = P.softShadows ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2('#c8def0', 0.011);
const camera = new THREE.PerspectiveCamera(55, engine.width / engine.height, 0.08, 1200);

// ---- lights
const hemi = new THREE.HemisphereLight('#bcd4ee', '#55503c', 1.0);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#ffffff', 3);
sun.castShadow = true;
sun.shadow.mapSize.set(P.shadowMap, P.shadowMap);
const sc = sun.shadow.camera;
sc.left = -21; sc.right = 21; sc.top = 21; sc.bottom = -21; // garden-sized at 1 u = 1 m: ~4 cm texels on phones sc.near = 1; sc.far = 160;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.04;
sun.shadow.radius = 3;
scene.add(sun);
scene.add(sun.target);
sun.target.position.set(CENTER.x, 0, CENTER.y);

// ---- ground (moss) with a hole for the pond
// Beyond the garden the moss gives way to a pale salt flat (Bonneville): polygon crust,
// tiny glints that catch the sun, and a mirage shimmer near the horizon (grade pass).
const uSalt = { uGlint: { value: 1 }, uHeat: { value: 0 } };
function addSaltFlat(mat) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    sh.uniforms.uGlint = uSalt.uGlint; sh.uniforms.uHeat = uSalt.uHeat;
    sh.vertexShader = 'varying vec3 vSaltW;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n vSaltW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = `varying vec3 vSaltW; uniform float uGlint, uHeat;
      vec2 sHash(vec2 p) { p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453); }
      // hexagonal salt-crust polygons (Bonneville): distance to the nearest jittered hex-cell edge
      float hexEdge(vec2 p) {
        const vec2 s = vec2(1.0, 1.7320508);
        vec4 hc = floor(vec4(p, p - vec2(0.5, 1.0)) / s.xyxy) + 0.5;
        vec4 h = vec4(p - hc.xy * s, p - (hc.zw + 0.5) * s);
        vec2 q = dot(h.xy, h.xy) < dot(h.zw, h.zw) ? h.xy : h.zw;
        vec2 id = dot(h.xy, h.xy) < dot(h.zw, h.zw) ? hc.xy : hc.zw + 0.5;
        q += (sHash(id) - 0.5) * 0.12;
        q = abs(q);
        return 0.5 - max(dot(q, s * 0.5), q.x);
      }
      float sNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(sHash(i).x, sHash(i + vec2(1, 0)).x, f.x), mix(sHash(i + vec2(0, 1)).x, sHash(i + vec2(1, 1)).x, f.x), f.y); }
      \n` + sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      float sd = length((vSaltW.xz - vec2(${CENTER.x.toFixed(2)}, ${CENTER.y.toFixed(2)})) * vec2(0.85, 1.0));
      float salt = smoothstep(24.0, 34.0, sd + (sNoise(vSaltW.xz * 0.15) - 0.5) * 6.0);
      vec2 sp = vSaltW.xz * 0.55;
      float e = hexEdge(sp);
      float fw = fwidth(sp.x) * 1.5 + 0.0001;
      float detail = 1.0 - smoothstep(0.08, 0.45, fw); // fade the pattern before it aliases
      float ridge = 1.0 - smoothstep(0.0, 0.05 + fw, e);   // raised, brighter crust rims
      float crack = 1.0 - smoothstep(0.0, 0.012 + fw * 0.5, abs(e - 0.012));
      float damp = smoothstep(0.35, 0.75, sNoise(vSaltW.xz * 0.06)) * 0.5 + smoothstep(0.5, 0.9, sNoise(vSaltW.xz * 0.4 + 7.0)) * 0.2;
      // warm cream near the garden -> cooler, bluer white toward the horizon; kept below paper-white
      vec3 near = vec3(0.70, 0.665, 0.60), far = vec3(0.66, 0.68, 0.71);
      vec3 saltCol = mix(near, far, smoothstep(30.0, 120.0, sd));
      saltCol *= 1.0 - damp * 0.14;
      saltCol = mix(saltCol, saltCol * 1.1 + 0.02, ridge * detail * 0.6);
      saltCol = mix(saltCol, saltCol * 0.78, crack * detail * 0.7);
      saltCol *= 0.97 + 0.05 * sHash(floor(vSaltW.xz * 3.0)).x * detail;
      vec3 dry = vec3(0.56, 0.52, 0.36);
      diffuseColor.rgb = mix(diffuseColor.rgb, dry, smoothstep(14.0, 26.0, sd) * (1.0 - salt) * 0.6);
      diffuseColor.rgb = mix(diffuseColor.rgb, saltCol, salt);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      { vec2 gc = floor(vSaltW.xz * 9.0); vec2 h = sHash(gc + floor(cameraPosition.xz * 1.7));
        float gl = step(0.996, h.x) * salt * uGlint * detail; totalEmissiveRadiance += vec3(1.0, 0.97, 0.9) * gl * 0.8; }`)
      .replace('#include <fog_fragment>', `#include <fog_fragment>
      // mirage: at grazing angles the hot salt mirrors the sky in a shimmering band near the horizon
      #ifdef USE_FOG
      { vec3 vd = normalize(cameraPosition - vSaltW); float graz = 1.0 - clamp(vd.y * 18.0, 0.0, 1.0);
        float wob = 0.75 + 0.25 * sin(vSaltW.x * 0.35 + vSaltW.z * 0.21 + cameraPosition.x * 0.1);
        float m = graz * graz * salt * uHeat * wob * smoothstep(40.0, 90.0, length(vSaltW.xz - cameraPosition.xz));
        gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor * 1.06 + vec3(0.02, 0.025, 0.035), clamp(m, 0.0, 0.85)); }
      #endif`);
  };
  return mat;
}
function makeGround() {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const col = new THREE.Color();
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    // tileable noise via torus mapping
    const a = u * Math.PI * 2, b = v * Math.PI * 2;
    const nx = Math.cos(a) * 1.2, ny = Math.sin(a) * 1.2, nz = Math.cos(b) * 1.2, nw = Math.sin(b) * 1.2;
    const n = fbm3(nx + nz * 0.7, ny + nw * 0.7, nz - nw, 4);
    const f = fbm3(nx * 6 + nz * 3, ny * 6, nw * 6 + 11, 2);
    col.setHSL(0.225 + n * 0.05, 0.56 + n * 0.12, 0.25 + n * 0.08 + f * 0.05);
    const i = (y * size + x) * 4;
    img.data[i] = col.r * 255; img.data[i + 1] = col.g * 255; img.data[i + 2] = col.b * 255; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1 / 9, 1 / 9);
  tex.anisotropy = 4;
  const shape = new THREE.Shape();
  shape.absarc(CENTER.x, -CENTER.y, 160, 0, Math.PI * 2, false);
  const hole = new THREE.Path();
  POND.outline(96, 0.42).forEach(([x, z], i) => { if (i === 0) hole.moveTo(x, -z); else hole.lineTo(x, -z); });
  hole.closePath();
  shape.holes.push(hole);
  const g = new THREE.ShapeGeometry(shape, 96);
  g.rotateX(-Math.PI / 2);
  const gm = new THREE.MeshStandardMaterial({ map: tex, roughness: 1, color: '#ffffff' });
  const m = new THREE.Mesh(g, addSaltFlat(addSnowCover(antiTile(gm), uSnow, { strength: 0.85 })));
  m.receiveShadow = true;
  m.name = 'ground';
  scene.add(m);
  // the scanned lawn (Poly Haven grass_ground) replaces the painted moss once it arrives
  loadSet('grass_ground', P, renderer).then((set) => {
    if (!set.diff) return;
    for (const t of [set.diff, set.nor, set.arm]) if (t) { t.repeat.set(1 / 2.4, 1 / 2.4); }
    gm.map = set.diff; gm.normalMap = set.nor; gm.normalScale.set(0.8, 0.8);
    // ARM G is roughness; do not bind it as aoMap — three.js aoMap samples uv2, which the bake owns
    if (set.arm) { gm.roughnessMap = set.arm; set.arm.channel = 0; }
    gm.color.set('#b9c7a4'); gm.needsUpdate = true;
  });
  return { mesh: m, material: gm };
}
// breaks up the repeat of a tiled ground texture: a second, rotated, larger-scale sample blended by low-frequency noise
function antiTile(mat) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      #ifdef USE_MAP
      { vec2 q = vMapUv * 0.37; q = vec2(q.x * 0.8 - q.y * 0.6, q.x * 0.6 + q.y * 0.8);
        float n = sin(vMapUv.x * 0.9 + sin(vMapUv.y * 0.53) * 2.0) * sin(vMapUv.y * 0.71 + sin(vMapUv.x * 0.37) * 2.0) * 0.5 + 0.5;
        vec4 b = texture2D(map, q);
        diffuseColor.rgb = mix(diffuseColor.rgb, b.rgb * color_white_fix, smoothstep(0.3, 0.7, n) * 0.55);
        diffuseColor.rgb *= 0.88 + 0.24 * n; }
      #endif`).replace('color_white_fix', 'diffuse');
  };
  return mat;
}
const ground = makeGround();

// Rocky Mountain peaks on the horizon
const mountains = await createMountains(scene, { P, season: SEASON, center: CENTER });

// stepping stones along the front (drawn with the stylized asset stones)
const STEP_STONES = [], EXTRA_ROCKS = [];
{
  const extra = [[-12.4, 11.9, 0.7, 801], [-10.6, 12.8, 0.4, 802], [11.0, 11.2, 0.6, 803], [16.5, 9.6, 0.8, 804]];
  const geos = extra.map(([x, z, s, seed]) => placedRock(seed, { sx: s * 1.3, sy: s * 0.8, sz: s, moss: 0.8 }, x, 0, z, seed));
  // a stepping-stone path at walking stride (~0.75 m), curving gently along the front of the bed
  const pts = [];
  for (let x = -8.6, i = 0; x < 6.4; x += 0.74, i++) pts.push([x, 6.9 + 0.35 * Math.sin(x * 0.42) + (i % 2 ? 0.16 : -0.16)]);
  pts.forEach(([x, z], i) => {
    const s = 0.3 + (i % 3) * 0.04;
    geos.push(placedRock(700 + i, { sx: s * 1.2, sy: s * 0.35, sz: s, flatTop: 0.25, rough: 0.15, moss: 0.25, segs: 24 }, x, 0, z, i * 1.3));
  });
  STEP_STONES.push(...pts.map(([x, z], i) => [x, z, 0.3 + (i % 3) * 0.04]));
  EXTRA_ROCKS.push(...extra.map(([x, z, s, seed]) => ({ x, z, r: s, seed })));
}

// ---- garden parts
const sway = { uTime: { value: 0 }, uWind: { value: 1 }, uWindDir: { value: new THREE.Vector2(0.86, 0.5) } };
const sky = createSky(scene, P.skySegs);
const skyPhoto = await createSkyPhoto({ renderer, P });
const sand = createSand(scene, { P, renderer });
const pond = createPond(scene, renderer, { P });
// stylized nature assets replace the procedural trees, shrubs and rocks
const [NATURE, ROCKS, TREES] = await Promise.all([loadNature(P), loadGardenRocks(), loadGardenTrees()]);
const bonsaiPos = new THREE.Vector3(1.5, 0, -7.2);
const bonsai = createBonsai(scene, { position: bonsaiPos, scale: 0.36, standH: 0.8, debugGrowDays: growOverride, detail: P.bonsaiDetail, hitBoost: P.touch ? 1.4 : 1.05 });
const flora = createFlora(scene, { P, sway, useAssets: true, renderer, season: SEASON, uSnow, blocked: [[bonsaiPos.x, bonsaiPos.z, 3.2], [7.6, -4.6, 0.8], [7.0, 6.0, 1.5]] });
sand.rocks.forEach((m) => { m.visible = false; });
pond.stones.visible = true; // procedural, volumetric pond rocks (nature chips looked flat)
const freeSpot = (x, z) => {
  const inSand = Math.abs(x - SAND.cx) < SAND.w / 2 + 1.2 && Math.abs(z - SAND.cz) < SAND.d / 2 + 1.2;
  const inPondA = POND.contains(x, z, 1.4);
  const nearBonsai = Math.hypot(x - bonsaiPos.x, z - bonsaiPos.z) < 3.4;
  const onPath = z > 6.0 && z < 8.0 && x > -9.4 && x < 7.0;
  const wall = z < -11.6 && z > -13.6;
  const shed = x > 17.5 && x < 23 && z > -0.5 && z < 5.8;
  const beds = x > BED_ZONE.x0 - 0.6 && x < BED_ZONE.x1 + 0.6 && z > BED_ZONE.z0 - 0.6 && z < BED_ZONE.z1 + 0.6;
  const rack = Math.hypot(x - 4.85, z + 2.3) < 1.0;
  return !(inSand || inPondA || nearBonsai || onPath || wall || beds || rack || shed);
};
const grass = createGrass(scene, { P, sway, free: freeSpot, center: CENTER, uSnow, season: SEASON.season });
const nature = placeNature(scene, NATURE, { P, season: SEASON, sway, uSnow, sandRocks: [...SAND_ROCKS, ...EXTRA_ROCKS], pondStones: [], stepStones: STEP_STONES, free: freeSpot, scanRocks: !!ROCKS, scanTrees: TREES });
const gardenRocks = ROCKS ? placeGardenRocks(scene, ROCKS, { P, sandRocks: SAND_ROCKS, extraRocks: EXTRA_ROCKS, pondStones: pond.edgeStones, stepStones: STEP_STONES, free: freeSpot, uSnow, center: CENTER }) : null;
if (gardenRocks) pond.stones.visible = false;

// ---- mom's world: snapdragons, finds + shelf, the horned lizard, shared gifts and visit signs
const gardenState = createState();
const snaps = [createSnapdragons(scene, { P, season: SEASON, sway, uSnow, touch: P.touch })];
const downRay = new THREE.Raycaster();
function surfaceY(x, z) {
  downRay.set(new THREE.Vector3(x, 30, z), new THREE.Vector3(0, -1, 0));
  const h = downRay.intersectObject(nature.group, true)[0];
  return h ? h.point.y : 0.2;
}
const finds = createFinds(scene, { P, state: gardenState, sand: SAND, sandRocks: SAND_ROCKS, pond: POND, shelfAt: { x: 5.0, z: 5.0, ry: 0.25 }, params, touch: P.touch });
// a small flat sunning stone at the sand's south edge, where the walk can actually see the lizard
const BASK = { x: 1.05, z: 3.50, r: 0.26 };
const baskMesh = new THREE.Mesh(placedRock(91, { sx: 0.18, sy: 0.13, sz: 0.14, flatTop: 0.78, moss: 0.10, rough: 0.16, segs: 28 }, BASK.x, 0.08, BASK.z, 0.4), rockMaterial());
baskMesh.castShadow = true; baskMesh.receiveShadow = true; scene.add(baskMesh);
function baskY(x, z) {
  downRay.set(new THREE.Vector3(x, 30, z), new THREE.Vector3(0, -1, 0));
  const h = downRay.intersectObject(baskMesh, true)[0];
  return h ? h.point.y : 0.10;
}
const lizard = createLizard(scene, { rock: BASK, surfaceY: baskY, params, sand: SAND });
const SNAP_CENTERS = snaps[0].clusters;
// colliders (metres) for the camera now and a walking character later
const colliders = createColliders();
colliders.circle(POND.cx, POND.cz, POND.r + 0.7, { h: 0.4, kind: 'water', name: 'pond' })
  .box(SAND.cx, SAND.cz, SAND.w / 2, SAND.d / 2, { h: 0.1, kind: 'soft', name: 'sand' })
  .box(bonsaiPos.x, bonsaiPos.z, 0.55, 0.35, { h: 0.8, name: 'bonsai stand' })
  .circle(7.6, -4.6, 0.55, { h: 1.6, name: 'lantern' })
  .box(5.0, 5.0, 0.8, 0.2, { ry: 0.25, h: 0.8, name: 'shelf' })
  .box(0, -12.6, 17.5, 0.35, { h: 2.0, name: 'wall' });
for (const r of [...SAND_ROCKS, ...EXTRA_ROCKS]) colliders.circle(r.x, r.z, r.r * 0.9, { h: r.r, name: 'rock' });
for (const t of nature.trees || []) colliders.circle(t.x, t.z, t.r, { h: t.h, name: t.name });
const giftRnd = (id) => mulberry32([...String(id)].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261) >>> 0);
const GIFT_SPOTS = [[-5.6, -7.4], [5.6, -8.6], [-10.6, 5.8], [13.8, 7.4], [-7.0, 9.2], [8.2, -7.8]];
let visitGlow = 0;
function applyShared(items) {
  for (const it of items) {
    const r = giftRnd(it.id);
    const [gx, gz] = GIFT_SPOTS[Math.floor(r() * GIFT_SPOTS.length)];
    if (it.kind === 'gifts' && it.type === 'flower') {
      snaps.push(createSnapdragons(scene, { P, season: SEASON, sway, uSnow, touch: P.touch, clusters: [[gx + (r() - 0.5), gz + (r() - 0.5), 4]], seed: Math.floor(r() * 1e6) }));
    } else if (it.kind === 'gifts' && it.type === 'lantern') {
      const lan = new THREE.Group();
      const paper = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.5, 12), new THREE.MeshStandardMaterial({ color: '#f4e6cc', emissive: '#ffb860', emissiveIntensity: 0.0, roughness: 0.9 }));
      paper.position.y = 0.55; lan.add(paper);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.32, 6), new THREE.MeshStandardMaterial({ color: '#4a3424' })); post.position.y = 0.16; lan.add(post);
      lan.position.set(gx, 0, gz); scene.add(lan);
      giftLanterns.push(paper.material);
    } else if (it.kind === 'visits' && it.type === 'rake') {
      // a fresh spiral raked by a visitor
      const cx0 = 0.25 + r() * 0.5, cy0 = 0.3 + r() * 0.4;
      sand.rakeStart({ x: cx0, y: cy0 });
      for (let k = 1; k < 90; k++) { const a = k * 0.16, rr = 0.012 + k * 0.0014; sand.rakeMove({ x: cx0 + Math.cos(a) * rr * 0.7, y: cy0 + Math.sin(a) * rr }); }
      sand.rakeEnd();
    } else if (it.kind === 'visits' && it.type === 'lantern-lit') {
      visitGlow = 1;
    }
  }
}
const giftLanterns = [];
applyShared(gardenState.allShared().filter((x) => x.kind === 'gifts'));
applyShared(gardenState.takeUnapplied().filter((x) => x.kind === 'visits'));
gardenState.onChange(() => applyShared(gardenState.takeUnapplied()));
// the hook a future sync step calls with { gifts: [...], visits: [...] }
window.garden = { mergeShared: (remote) => gardenState.mergeShared(remote) };
const lightmaps = await loadLightmaps(P);
if (lightmaps) {
  applyStaticLightmaps(scene, lightmaps, { sand, pond, finds });
  if (gardenRocks) applyRockLightmaps(gardenRocks, lightmaps);
}
const life = await createLife({
  scene, P, season: SEASON.season, gardenRocks,
  inSand: (x, z) => Math.abs(x - SAND.cx) < SAND.w / 2 && Math.abs(z - SAND.cz) < SAND.d / 2,
  inPond: (x, z, m = 0) => POND.contains(x, z, m),
  pondLevel: POND.level,
});

const weather = createWeather(scene, { P, sway, center: CENTER });
weather.set(SEASON);
const surprises = createSurprises(scene, { camera, params, audio });
pond.onSplash = () => audio.splash();

// ---- post-processing
const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: P.samples });
const composer = new EffectComposer(renderer, rt);
const renderPass = new RenderPass(scene, camera);
let bloomDisabled = false;
const stats = { sceneCalls: 0, sceneTris: 0, totalCalls: 0, totalTris: 0, fps: 0 };
{
  const orig = renderPass.render.bind(renderPass);
  renderPass.render = (...a) => {
    const c0 = renderer.info.render.calls, t0 = renderer.info.render.triangles;
    orig(...a);
    stats.sceneCalls = renderer.info.render.calls - c0; stats.sceneTris = renderer.info.render.triangles - t0;
  };
}
composer.addPass(renderPass);
let n8aoPass = null;
const forceN8 = params.get('n8ao') === '1' || params.get('n8ao') === 'on';
const wantN8 = (P.n8ao || forceN8) && params.get('n8ao') !== '0';
if (wantN8) {
  try {
    const { N8AOPass } = await import('../../vendor/n8ao/N8AOPass.js');
    n8aoPass = new N8AOPass(scene, camera, 256, 256);
    // tighter, faster falloff, full-res on PC so bright gravel does not pick up half-res blotches
    n8aoPass.configuration.aoRadius = P.cls === 'pc' ? 0.42 : 0.35;
    n8aoPass.configuration.distanceFalloff = 2.0;
    n8aoPass.configuration.intensity = P.cls === 'pc' ? 0.82 : 0.7;
    n8aoPass.configuration.halfRes = P.cls !== 'pc';
    n8aoPass.configuration.gammaCorrection = false;
    n8aoPass.configuration.colorMultiply = true;
    n8aoPass.configuration.denoiseIterations = 2;
    n8aoPass.configuration.aoSamples = P.cls === 'pc' ? 10 : 8;
    n8aoPass.configuration.denoiseSamples = 8;
    composer.addPass(n8aoPass);
  } catch (e) { console.warn('[n8ao] failed to load', e && e.message); n8aoPass = null; }
}
let n8Watch = 0, n8Low = 0;
const godRays = P.godRays ? createGodRays(P.godRays) : null;
if (godRays) composer.addPass(godRays);
let reflK = 1, raysOn = true, bloomK = 1; // quality ladder state (applyQuality below)
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.3, 0.55, 0.9);
{
  // phones/tablets run bloom at a reduced internal resolution
  const origSize = bloom.setSize.bind(bloom);
  bloom.setSize = (w, h) => { const k = P.bloomScale * (bloomK > 0 ? bloomK : 1); origSize(Math.max(64, Math.round(w * k)), Math.max(64, Math.round(h * k))); };
}
composer.addPass(bloom);
composer.addPass(new OutputPass());
const grade = createGrade({ tilt: P.tilt, grain: P.grain });
composer.addPass(grade);
// ?prof=1: label each pass for the per-pass GPU timer (js/perf)
const mark = (l) => { const pf = engine.perf && engine.perf.perf; if (pf && pf.prof) pf.mark(l); };
const passName = (p) => (p === godRays ? 'godrays' : p === grade ? 'grade' : p === n8aoPass ? 'n8ao+scene' : p === renderPass ? 'scene' : p.constructor.name.replace(/Pass$/, '').toLowerCase());
for (const p of composer.passes) { const o = p.render.bind(p), name = passName(p); p.render = (...a) => { mark(name); return o(...a); }; }
// N8AOPass draws the scene itself (autoRenderBeauty) into its own single-sample target and ignores the
// pass before it, so with AO on the RenderPass was a second, wasted full scene draw. Only one of them
// runs now, and the post chain drops MSAA while AO is on (its image never had MSAA to begin with).
const userAO = { on: true };
let aoMode = n8aoPass ? (P.cls === 'pc' ? 2 : 1) : 0;
function syncAO() {
  const on = !!(n8aoPass && userAO.on && aoMode > 0);
  if (n8aoPass) { n8aoPass.enabled = on; if (on) n8aoPass.configuration.halfRes = P.cls !== 'pc' || aoMode === 1; }
  renderPass.enabled = !on;
  const samples = on ? 0 : P.samples;
  for (const t of [composer.renderTarget1, composer.renderTarget2]) if (t.samples !== samples) { t.samples = samples; t.dispose(); }
}
syncAO();

// ---- sizing
let viewW = 1, viewH = 1;
let framing = { fov: 55 };
let viewHpx = 1;
// one place sets the lens (ambient framing, or first person while walking) and the point sizes with it
function applyFov(f) {
  camera.fov = f; camera.updateProjectionMatrix();
  const ps = viewHpx / (2 * Math.tan((f * Math.PI) / 360));
  bonsai.setPointScale(ps); flora.setPointScale(ps); weather.setPointScale(ps);
}
let portraitBias = 0;
let nightLook = 0.3;
let pixelRatio = 1;
function resize(w, h, pr) {
  pixelRatio = pr;
  const aspect = w / h;
  camera.aspect = aspect;
  // t: portrait-ness, u: ultra-wide-ness (phone landscape, 21:9 monitors)
  const t = smoothstep(1.25, 0.5, aspect);
  const u = smoothstep(1.8, 2.4, aspect);
  const pc = P.cls === 'pc';
  // realistic eye: ~50° vertical in landscape, ~62° in portrait so the ground at her feet stays in view
  framing = { fov: lerp(lerp(52, 62, t), 46, u) };
  portraitBias = t * 0.12;
  nightLook = lerp(0.32, 0.38, t);
  void pc;
  composer.setPixelRatio(pixelRatio);
  composer.setSize(w, h);
  if (n8aoPass && n8aoPass.setSize) n8aoPass.setSize(w * pixelRatio, h * pixelRatio);
  viewHpx = h * pixelRatio; applyFov(framing.fov);
  grade.uniforms.uRes.value.set(w * pixelRatio, h * pixelRatio);
  viewW = w * pixelRatio; viewH = h * pixelRatio;
}

// ---- camera rig: eye height (1.6 m), a slow walk around the garden (drift mode); later it can
// follow a character (rig.follow) without the rest of the world changing
const target = new THREE.Vector3();
let lookUp = -1;
// arrival: every visit opens looking up into the sky and slowly settles onto the garden
let introT = DEBUG && !params.has('intro') ? 1 : 0;
const arrival = saveSlice('earth.arrival', () => ({ arrived: !!localStorage.getItem('zen-garden-arrived') }));
const INTRO = arrival.arrived ? 11 : 16;
arrival.arrived = true; savePersist();
// the walk: along the stepping stones, round the pond, behind the bed past the bonsai, and back
const WALK = [[-9.6, 6.2], [-5.0, 7.7], [-1.0, 7.6], [3.0, 7.8], [6.8, 8.0], [10.6, 6.9], [14.9, 3.6], [15.2, -1.6], [12.4, -5.0],
  [9.2, -6.4], [5.0, -5.4], [1.5, -5.3], [-3.0, -5.4], [-7.6, -5.2], [-11.0, -2.2], [-11.4, 2.6]];
const rig = createCameraRig(camera, {
  path: WALK, eye: 1.6, speed: 0.3, colliders,
  start: params.has('camt') ? parseFloat(params.get('camt')) : Math.random(),
  pois: () => {
    const night = ts ? ts.night : 0, gold = ts ? ts.golden : 0;
    return [
      { x: SAND.cx, z: SAND.cz, y: 0, w: 1.4 * (1 - night * 0.4), linger: 0.2 },
      { x: POND.cx, z: POND.cz, y: night ? 0.5 : -0.1, w: 1.6 + night * 2.0 + gold * 1.1, linger: 0.4 + night * 0.7 },
      { x: bonsaiPos.x, z: bonsaiPos.z, y: 1.05, w: 1.3 * (1 - night * 0.75), linger: 0.9 * (1 - night * 0.5) },
      { x: 7.6, z: -4.6, y: 0.9, w: 0.5 * (1 - night * 0.5), linger: 0.3 },
      { x: 5.0, z: 5.0, y: 0.5, w: 0.8, linger: 0.6 },
      ...SNAP_CENTERS.map(([x, z]) => ({ x, z, y: 0.5, w: 0.7, linger: 0.6 })),
      ...finds.world.map((w) => ({ x: w.obj.position.x, z: w.obj.position.z, y: 0, w: 0.9, linger: 1 })),
      ...(lizard.state === 'bask' ? [{ x: lizard.group.position.x, z: lizard.group.position.z, y: lizard.group.position.y, w: 1.2, linger: 1 }] : []),
      // at night, a far high point over the back wall so the gaze lifts to the moon and sky
      ...(night > 0.15 ? [{ x: POND.cx, z: -40, y: 22, w: 2.4 * night, linger: 0.25 }] : []),
    ];
  },
});
if (params.has('camt')) rig.setU(parseFloat(params.get('camt')), true);
// debug-only fixed framings (absolute metres: eye xyz, target xyz), used for close-up shots and the icon
const CAMS = {
  bonsai: [1.9, 1.45, -4.9, 1.5, 1.05, -7.2], icon: [1.7, 1.25, -5.6, 1.5, 1.1, -7.2],
  snap: [7.6, 1.05, 7.6, 8.6, 0.45, 5.4], shelf: [4.9, 1.2, 6.9, 5.0, 0.55, 5.0],
  lizard: [1.19, 0.285, 3.655, 1.05, 0.195, 3.535], lizardtop: [1.05, 0.50, 3.56, 1.05, 0.190, 3.50],
  range: [0.0, 1.55, 8.5, 0.0, 3.2, -40],
  pondwide: [10.6, 1.6, 6.9, 10.2, -0.1, 1.2], lotus: [11.7, 1.2, 0.6, 11.5, -0.05, -0.4], moon: [1.6, 1.4, -4.4, 1.5, 3.2, -9],
  nightpond: [11.0, 1.55, 5.85, 9.8, 2.55, -8],
  top: [1.5, 60, 0.5, 1.5, 0, 0.45],
};
const camOverride = DEBUG && CAMS[params.get('cam')] ? CAMS[params.get('cam')] : null;
if (camOverride) rig.fix(new THREE.Vector3(camOverride[0], camOverride[1], camOverride[2]), new THREE.Vector3(camOverride[3], camOverride[4], camOverride[5]));
function updateCamera(now, dt, dragging) {
  introT = Math.min(1, introT + dt / INTRO);
  const ie = 1 - (introT < 0.5 ? 4 * introT ** 3 : 1 - Math.pow(-2 * introT + 2, 3) / 2);
  // at night, slowly lift the gaze toward the stars (and settle back), never abruptly
  const lookTarget = ts.night * nightLook * (0.6 + 0.4 * Math.sin(now * 0.017 - 1.2)) + ts.golden * (1 - (ts.overcast || 0)) * 0.05;
  if (lookUp < 0) lookUp = lookTarget;
  lookUp += (lookTarget - lookUp) * Math.min(1, dt * 0.15);
  // portrait: look up a little by day (less empty lawn); at sunset keep more of the garden in frame
  rig.pitchBias = portraitBias * (1 - ts.golden * 0.55);
  // at night, if the walk has brought us close to the back wall, turn toward the pond and moon
  let preferYaw = null, preferK = 0;
  if (ts.night > 0.15) {
    const distWall = rig.position.z - (-12.6);
    if (distWall < 8.5) {
      preferYaw = Math.atan2(POND.cx - rig.position.x, POND.cz - rig.position.z);
      // blend also toward the moon over the wall when we can see past the pond
      preferK = ts.night * (distWall < 8.5 ? (1 - (distWall - 4) / 4.5) : 0);
      preferK = Math.max(0, Math.min(0.95, preferK));
    }
  }
  if (game.cinematic) { game.rocket.cinematicCamera(dt, camera, now); target.copy(camera.position); return; }
  if (game.walking) {
    const f = fpFov(viewW, viewH); if (Math.abs(camera.fov - f) > 0.01) applyFov(f);
    game.updateCamera(dt, ie * 0.9); target.copy(camera.position); return;
  }
  if (Math.abs(camera.fov - framing.fov) > 0.01) applyFov(framing.fov);
  rig.update(dt, now, { lift: lookUp + ie * 0.9, dragging, preferYaw, preferK });
  target.copy(rig.position);
}

// ---- interaction: touches on the world itself
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let active = null; // { id, mode, x, y, lastDrop }
let clock = 0;

function pick(e) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hb = raycaster.intersectObject(bonsai.hit, false);
  const hits = raycaster.intersectObjects([pond.hitDisk, sand.mesh], false);
  // small things on top of the world win over the ground behind them
  let prop = null;
  for (const c of [finds.hit(raycaster.ray), lizard.hit(raycaster.ray, P.touch), ...snaps.map((s, i) => { const h = s.hit(raycaster.ray); if (h) h.snaps = i; return h; })]) {
    if (c && (!prop || c.dist < prop.dist)) prop = c;
  }
  const stone = life && life.pickStone(raycaster);
  if (stone && (!prop || stone.dist < prop.dist + 0.15) && (!hits.length || stone.dist < hits[0].distance + 0.2) && (!hb.length || stone.dist < hb[0].distance)) return stone;
  if (prop && (!hits.length || prop.dist < hits[0].distance + 0.6) && (!hb.length || prop.dist < hb[0].distance + 0.3)) return prop;
  if (hb.length && (!hits.length || hb[0].distance < hits[0].distance + 2)) return { kind: 'bonsai' };
  if (!hits.length) return null;
  const h = hits[0];
  if (h.object === sand.mesh) return { kind: 'sand', uv: h.uv, point: h.point };
  return { kind: 'water', uv: pond.pointToUv(h.point), point: h.point };
}

// ---- tending: one action per touchable kind (extend with planting / pruning / harvesting) ----
const tending = createTending({ world: 'earth' });
tending.register('sand', { start(h) { sand.rakeStart(h.uv); } });
tending.register('water', { start(h, { clock, e, active }) {
  pond.tap(h.uv, clock, 0.6); audio.plink(h.uv.x, 0.04); tick();
  active.hold = { t: clock, uv: h.uv, x0: e.clientX, y0: e.clientY };
} });
tending.register('snap', { start(h, { clock }) { const r = snaps[h.snaps].chomp(h, clock); if (r) { audio.chomp(r.deg, r.winter ? 0.015 : 0.03); tick(); } } });
tending.register('find', { start(h) { finds.collect(h.w, audio); tending.log('find'); tick(); } });
tending.register('shelf', { start(h) { finds.turn(h.it, audio); } });
tending.register('lizard', { start() { if (lizard.scare()) audio.skitter(); } });
tending.register('stone', { start(h) {
  const dir = h.point ? new THREE.Vector3(h.point.x - camera.position.x, 0, h.point.z - camera.position.z) : null;
  life.tumble(h.rec, dir); tick();
} });
tending.register('bonsai', { cooldown: 0.8, start(h, { clock, e }) {
  bonsai.water(clock); audio.chime(); tending.log('water');
  tick(12);
} });
// ---- the game layer: walk the garden as the gardener and tend it (ambient drift stays one tap away)
const game = createEarthGame({ scene, camera, P, params, audio, colliders, sand, SAND, pond, POND, bonsai, bonsaiPos, finds, snaps, gardenState, growOverride, tending, canvas, engine, worlds, nature, renderer });
const CURSORS = {
  sand: `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><g fill="none" stroke-linecap="round"><path d="M17 15 L29 3" stroke="rgba(40,30,20,.55)" stroke-width="4"/><path d="M17 15 L29 3" stroke="#f3ead8" stroke-width="2"/><path d="M5 17 L19 17" stroke="rgba(40,30,20,.55)" stroke-width="4"/><path d="M5 17 L19 17" stroke="#f3ead8" stroke-width="2"/><path d="M6 17v8M9.5 17v8M13 17v8M16.5 17v8" stroke="rgba(40,30,20,.5)" stroke-width="3"/><path d="M6 17v8M9.5 17v8M13 17v8M16.5 17v8" stroke="#f3ead8" stroke-width="1.4"/></g></svg>')}") 11 26, pointer`,
  touchable: `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28"><circle cx="14" cy="14" r="9" fill="rgba(255,255,255,.12)" stroke="rgba(255,255,255,.75)" stroke-width="1.5"/><circle cx="14" cy="14" r="2.2" fill="rgba(255,255,255,.9)"/></svg>')}") 14 14, pointer`,
};
let hoverKind = null, hoverPending = null, hoverT = 0;
function applyHover(h) {
  const k = h ? h.kind : null;
  sand.setHover(k === 'sand' ? h.uv : null);
  pond.setHover(k === 'water' ? h.point : null);
  bonsai.setHover(k === 'bonsai');
  if (k !== hoverKind) {
    canvas.style.cursor = k === 'sand' ? CURSORS.sand : k ? CURSORS.touchable : 'default';
    hoverKind = k;
  }
}
function down(e) {
  if (game.walking && !game.cinematic) { walkPointer = e.pointerId; game.input.down(e); return; }
  const h = pick(e);
  active = { id: e.pointerId, mode: h ? h.kind : 'look', x: e.clientX, y: e.clientY, lastDrop: clock };
  if (!h) return;
  // walking: sand and water are for her feet and rake; a drag that starts there turns the view
  if (game.walking && (h.kind === 'sand' || h.kind === 'water')) {
    active.mode = 'look';
    if (h.kind === 'water') { pond.tap(h.uv, clock, 0.6); audio.plink(h.uv.x, 0.04); tick(); }
    return;
  }
  tending.dispatch(h, { clock, e, active });
}
let walkPointer = null;
// walking, a tap on nothing tendable still touches the world: the pond ripples where she taps
game.onEmptyTap = (e) => { const h = pick(e); if (h && h.kind === 'water') { pond.tap(h.uv, clock, 0.6); audio.plink(h.uv.x, 0.04); tick(); } };
function move(e) {
  if (walkPointer !== null) { game.input.move(e); return; }
  if (P.hover && e.pointerType === 'mouse' && !active) { hoverPending = e; return; }
  if (!active || e.pointerId !== active.id) return;
  const dx = e.clientX - active.x, dy = e.clientY - active.y;
  active.x = e.clientX; active.y = e.clientY;
  if (active.mode === 'look') {
    const s = 2.2 / Math.max(window.innerWidth, window.innerHeight);
    if (game.walking) { game.look(dx * s * 1.6, dy * s * 0.9); return; }
    rig.look(-dx * s, dy * s * 0.6);
    return;
  }
  const h = pick(e);
  if (P.hover && e.pointerType === 'mouse') applyHover(h);
  if (active.mode === 'sand') {
    if (h && h.kind === 'sand') {
      const d = sand.rakeMove(h.uv);
      audio.rake(d * 60);
    } else { sand.rakeEnd(); audio.rake(0); }
  } else if (active.mode === 'water') {
    if (active.hold && !active.breathing && Math.hypot(e.clientX - active.hold.x0, e.clientY - active.hold.y0) > 14) active.hold = null;
    if (active.breathing) return;
    if (h && h.kind === 'water' && clock - active.lastDrop > 0.07) {
      active.lastDrop = clock;
      pond.tap(h.uv, clock, 0.14);
    }
  }
}
function endPointer(e) {
  if (walkPointer !== null && e.pointerId === walkPointer) { walkPointer = null; game.input.up(e); return; }
  if (!active || e.pointerId !== active.id) return;
  if (active.mode === 'sand') { sand.rakeEnd(); audio.rake(0); }
  if (active.breathing) { pond.setBreath(false); audio.breath(false); }
  active = null;
}
// ---- time of day
function currentHour() {
  if (hourOverride !== null && !Number.isNaN(hourOverride)) return ((hourOverride % 24) + 24) % 24;
  const d = new Date();
  return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
}
const gray = new THREE.Color();
function withWeather(t) {
  const oc = SEASON.overcast, mist = SEASON.mist;
  t.overcast = oc; t.rain = SEASON.rain; t.mist = mist;
  if (oc > 0) {
    for (const k of ['zenith', 'horizon', 'hemiSky']) {
      const c = t[k]; const l = c.r * 0.3 + c.g * 0.59 + c.b * 0.11;
      gray.setRGB(l, l * 1.01, l * 1.04);
      c.lerp(gray, oc * 0.75);
    }
    t.zenith.lerp(t.horizon, oc * 0.4);
    t.sunIntensity *= 1 - 0.85 * oc;
    t.hemiIntensity *= 1 + 0.35 * oc;
    t.golden *= 1 - 0.6 * oc;
  }
  if (mist > 0) {
    t.fog *= 1 + mist * 1.8;
    t.horizon.lerp(gray.setRGB(0.86, 0.88, 0.9).multiplyScalar(0.25 + 0.75 * (1 - t.night)), mist * 0.35);
  }
  return t;
}
let ts = withWeather(computeTime(currentHour(), new Date()));
let tsTimer = 0;
const lightPos = new THREE.Vector3(), shadowSunAt = new THREE.Vector3();
let gardenBreath = 0, baseSunI = 1, baseFog = 0.01;
function applyTime() {
  if (skyPhoto) skyPhoto.update(ts, sky, scene);
  scene.fog.color.copy(ts.horizon);
  scene.fog.density = ts.fog * (1 - 0.4 * (ts.photoK || 0)); // the photo sky already carries the haze
  mountains.setHaze(ts.horizon, clamp(0.3 + (ts.overcast || 0) * 0.45 + (SEASON.mist ? 0.15 : 0) + ts.night * 0.1, 0, 0.95));
  if (mountains.setGlow) mountains.setGlow(ts.golden || 0, ts.lightColor);
  hemi.color.copy(ts.hemiSky);
  hemi.groundColor.copy(ts.hemiGround);
  hemi.intensity = ts.hemiIntensity * (1 - 0.7 * (ts.photoK || 0)); // the photo env lights the shade instead
  const useSun = ts.elev > -3;
  const dir = useSun ? ts.sunDir : ts.moonLightDir;
  sun.color.copy(useSun ? ts.lightColor : new THREE.Color('#9fb6ff'));
  sun.intensity = useSun ? ts.sunIntensity : 0.75 * ts.night;
  baseSunI = sun.intensity; baseFog = scene.fog.density;
  lightPos.copy(dir).multiplyScalar(80).add(sun.target.position);
  if (!sun.position.equals(lightPos)) {
    // the sun creeps ~0.25 deg a minute: re-render the shadow map once it has moved ~0.15 deg (or the light swapped)
    if (lightPos.distanceToSquared(shadowSunAt) > 0.045 || shadowSunAt.lengthSq() === 0) { shadowSunAt.copy(lightPos); renderer.shadowMap.needsUpdate = true; }
    sun.position.copy(lightPos);
  }
  renderer.toneMappingExposure = ts.exposure;
  bloom.strength = lerp(0.25, 0.75, ts.night) + ts.golden * 0.15;
  bloom.threshold = lerp(1.15, 0.72, ts.night);
  bloom.radius = lerp(0.45, 0.7, ts.night);
  // phones/tablets skip bloom in plain daylight (only sun glints would use it)
  if (P.bloomDayOff) bloom.enabled = !bloomDisabled && bloomK > 0 && (ts.night > 0.05 || ts.golden > 0.2);
  pond.uniforms.uLanternI.value = smoothstep(0.0, 0.8, ts.night + ts.golden * 0.25);
  pond.uniforms.uOvercast.value = ts.overcast || 0;
  LOOK.uSunDir.value.copy(ts.elev > -4 ? ts.sunDir : ts.moonDir);
  LOOK.uSunCol.value.copy(ts.lightColor).multiplyScalar(ts.elev > -4 ? Math.min(1.4, ts.sunIntensity / 2.2) : 0.25);
  LOOK.uTrans.value = (1 - (ts.overcast || 0) * 0.8);
  if (lightmaps) updateLightmapStrength(lightmaps, ts);
}
applyTime();
renderer.shadowMap.needsUpdate = true;
let leapT = params.get('surprise') === 'koi' ? 0 : 40 + Math.random() * 100;
const sunScr = new THREE.Vector3(), camFwd = new THREE.Vector3();
const G = {
  day: { sh: new THREE.Color(0.96, 1.0, 1.04), hi: new THREE.Color(1.04, 1.0, 0.95), sat: 1.04, vig: 0.12, lift: new THREE.Color(0, 0, 0) },
  gold: { sh: new THREE.Color(0.95, 0.98, 1.04), hi: new THREE.Color(1.06, 1.0, 0.9), sat: 1.0, vig: 0.18, lift: new THREE.Color(0.016, 0.01, 0.0) }, // amber light, cool-neutral shade (no magenta)
  night: { sh: new THREE.Color(0.9, 0.96, 1.16), hi: new THREE.Color(0.98, 1.0, 1.08), sat: 0.92, vig: 0.34, lift: new THREE.Color(0.0, 0.008, 0.028) },
  grey: { sh: new THREE.Color(0.96, 0.99, 1.04), hi: new THREE.Color(1.0, 1.0, 1.0), sat: 0.86, vig: 0.22, lift: new THREE.Color(0.02, 0.022, 0.026) },
};
const gtmp = { sh: new THREE.Color(), hi: new THREE.Color(), lift: new THREE.Color() };
function updateGrade(now) {
  const gu = grade.uniforms;
  const gold = ts.golden, night = ts.night, oc = ts.overcast || 0;
  gtmp.sh.copy(G.day.sh).lerp(G.gold.sh, gold).lerp(G.night.sh, night).lerp(G.grey.sh, oc * (1 - night) * 0.8);
  gtmp.hi.copy(G.day.hi).lerp(G.gold.hi, gold).lerp(G.night.hi, night).lerp(G.grey.hi, oc * (1 - night) * 0.8);
  gtmp.lift.copy(G.day.lift).lerp(G.gold.lift, gold).lerp(G.night.lift, night).lerp(G.grey.lift, oc * 0.8);
  gu.uShadow.value.copy(gtmp.sh); gu.uHigh.value.copy(gtmp.hi); gu.uLift.value.copy(gtmp.lift);
  gu.uSat.value = lerp(lerp(lerp(G.day.sat, G.gold.sat, gold), G.night.sat, night), G.grey.sat, oc * 0.8);
  gu.uVig.value = lerp(lerp(G.day.vig, G.gold.vig, gold), G.night.vig, night);
  gu.uContrast.value = lerp(lerp(0.24, 0.2, gold), 0.12, night); // filmic S-curve: deeper shade under the trees
  gu.uTime.value = now;
  // horizon line on screen (for the mirage band) and how hot/bright the day is
  {
    camera.getWorldDirection(camFwd);
    const hz = new THREE.Vector3(camFwd.x, 0, camFwd.z).normalize().multiplyScalar(400).add(camera.position); hz.y = 0;
    hz.project(camera);
    gu.uHorizon.value = hz.y * 0.5 + 0.5 + 0.012;
    const warm = { summer: 1, spring: 0.6, autumn: 0.45, winter: 0.1 }[SEASON.season];
    gu.uHeat.value = smoothstep(25, 50, ts.elev) * (1 - oc) * warm * (1 - night);
    uSalt.uHeat.value = Math.max(0.25, gu.uHeat.value) * (1 - night) * (1 - oc * 0.6);
  }
  // sun (or moon) position on screen for haze and rays
  const useSun = ts.elev > -4;
  const dir = useSun ? ts.sunDir : ts.moonDir;
  sunScr.copy(dir).multiplyScalar(200).add(camera.position).project(camera);
  camera.getWorldDirection(camFwd);
  const facing = smoothstep(-0.1, 0.45, camFwd.dot(dir));
  const sx = sunScr.x * 0.5 + 0.5, sy = sunScr.y * 0.5 + 0.5;
  gu.uSun.value.set(sx, sy);
  const sunVis = useSun ? smoothstep(-4, 2, ts.elev) : 0;
  gu.uHaze.value = facing * (sunVis * (0.02 + gold * 0.16) * (1 - oc * 0.7) + (1 - sunVis) * night * 0.035) + SEASON.mist * 0.08;
  // into the sun: the eye stops down and the black point re-seats, so contre-jour frames keep their punch
  const into = facing * sunVis * (1 - oc) * (1 - night);
  gu.uBlack.value = into * 0.045;
  gu.uContrast.value += into * 0.08;
  renderer.toneMappingExposure = ts.exposure * (1 - into * 0.14);
  gu.uTilt.value = 0; // tilt-shift read as a miniature: off for the photographic look
  gu.uHazeCol.value.copy(useSun ? ts.lightColor : gray.setRGB(0.55, 0.65, 1.0));
  if (godRays) {
    const ru = godRays.uniforms;
    ru.uSun.value.set(sx, sy);
    ru.uAspect.value = camera.aspect;
    ru.uTime.value = now;
    const high = smoothstep(55, 25, ts.elev);
    ru.uI.value = facing * (useSun ? sunVis * (0.06 + gold * 0.75) * (0.4 + 0.6 * high) * (1 - oc * 0.85) : night * 0.09 * (1 - oc));
    ru.uCol.value.copy(useSun ? ts.lightColor : gray.setRGB(0.5, 0.6, 0.95));
    godRays.enabled = raysOn && ru.uI.value > 0.001; // the shader would only copy the image
  }
}
const DT_MAX = DEBUG && params.has('fastdt') ? 6.0 : 0.25; // headless tests render slowly
let shadowTick = 0;
function frame(dt) {
  if (game.walking) { if (hoverKind) applyHover(null); hoverPending = null; }
  else if (hoverPending && (hoverT += dt) > 0.05) { hoverT = 0; applyHover(pick(hoverPending)); hoverPending = null; }
  clock += dt;
  tsTimer += dt;
  if (tsTimer > 0.5) { tsTimer = 0; ts = withWeather(computeTime(currentHour(), new Date())); applyTime(); }
  const gb = Math.sin(clock * (Math.PI * 2 / 11)) * (1 - pond.breath.k * 0.5) + pond.breath.k * (pond.breath.fill * 2 - 1);
  gardenBreath = gb;
  sun.intensity = baseSunI * (1 + gb * 0.035);
  scene.fog.density = baseFog * (1 + gb * 0.07) * game.fogK;
  sway.uTime.value = clock;
  sway.uWind.value = (1 + gb * 0.08) * (0.75 + 0.25 * Math.sin(clock * 0.11) + 0.1 * Math.sin(clock * 0.37)) * (1 + SEASON.rain * 0.35 + SEASON.snow * 0.1);
  { const a = 0.52 + 0.25 * Math.sin(clock * 0.013); sway.uWindDir.value.set(Math.cos(a), Math.sin(a)); }
  const gustHere = windGust(target.x, target.z, clock, sway.uWindDir.value) * sway.uWind.value;
  const wx = weather.update(dt, ts);
  ts.rain = wx.rain;
  if (wx.rain > 0.05) pond.rainDrop(wx.rain);
  const pl = game.player;
  const nearW = Math.max(0, 1 - Math.max(0, POND.dist(camera.position.x, camera.position.z)) / 9);
  audio.update(dt, {
    gust: gustHere, night: ts.night, rain: wx.rain, mist: SEASON.mist, snow: wx.snow || 0,
    world: 'earth', biome: 'garden', zone: 'garden',
    camera, speed: (pl && pl.speed) || 0, altitude: camera.position.y, nearWater: nearW,
  });
  surprises.update(dt, clock, ts);
  leapT -= dt;
  if (leapT < 0) { leapT = 80 + Math.random() * 160; pond.leap(); }
  game.update(dt, clock, ts);
  updateCamera(clock, dt, !!active && active.mode === 'look');
  mountains.follow(camera.position);
  sky.update(ts, clock);
  grass.update(camera);
  sand.update(dt);
  // a finger held still on the water begins the breathing rhythm
  if (active && active.hold && !active.breathing && clock - active.hold.t > 0.9) {
    active.breathing = true; pond.setBreath(true, active.hold.uv); audio.breath(true);
  }
  mark('pond-sim');
  pond.update(dt, clock, ts);
  mark('misc');
  for (const s of snaps) s.update(dt, clock);
  finds.update(dt, clock, ts, audio);
  lizard.update(dt, clock, ts, SEASON);
  visitGlow = Math.max(0, visitGlow - dt / 600);
  flora.lanternBoost = visitGlow;
  for (const m of giftLanterns) m.emissiveIntensity = smoothstep(0, 0.8, ts.night + ts.golden * 0.3) * 1.6;
  bonsai.update(dt, clock);
  flora.update(dt, clock, ts);
  life.update(dt, clock, ts, 9 * (pixelRatio || 1));
  // moving casters (lizard, koi, her) refresh their shadows ~0.7x a second, whatever the frame rate
  if ((shadowTick += dt) > 1.5) { shadowTick = 0; renderer.shadowMap.needsUpdate = true; }
  updateGrade(clock);
  mark('reflection');
  if (reflK > 0) pond.renderReflection(renderer, scene, camera, viewW, viewH, reflK);
  composer.render(dt);
  stats.totalCalls = renderer.info.render.calls; stats.totalTris = renderer.info.render.triangles;
  if (n8aoPass && P.cls !== 'pc') {
    n8Watch += dt;
    if (engine.fps && engine.fps < 28) n8Low += dt; else n8Low = Math.max(0, n8Low - dt * 0.5);
    if (n8Watch > 2.5 && n8Low > 1.6) { aoMode = 0; syncAO(); n8aoPass = null; }
  }
}
// ---- quality ladder (js/perf/governor.js): what the garden can trade, cheapest-looking first
const shadowBase = P.shadowMap;
function applyQuality(Q) {
  grade.uniforms.uSharp.value = Q.pr < 0.99 ? Math.min(1, (1 - Q.pr) * 2.2) : 0;
  if (n8aoPass) { aoMode = Q.ao; syncAO(); }
  raysOn = !!Q.rays; if (godRays && !raysOn) godRays.enabled = false;
  reflK = P.reflections ? Q.refl : 0;
  pond.setReflection && pond.setReflection(reflK > 0);
  const bk = Q.bloom; if (bk !== bloomK) { bloomK = bk; bloom.enabled = bk > 0 && !bloomDisabled; resize(engine.width, engine.height, engine.pixelRatio); }
  const sm = Math.max(512, Math.round(shadowBase * Q.shadow));
  if (sun.shadow.mapSize.x !== sm) { sun.shadow.mapSize.set(sm, sm); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } renderer.shadowMap.needsUpdate = true; }
  if (life.setDensity) life.setDensity(Q.foliage);
  if (grass.setDensity) grass.setDensity(Q.foliage);
}
const debug = {
  scene, camera,
    project(x, y, z) {
      const v = new THREE.Vector3(x, y, z).project(camera);
      return { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight };
    },
    info() { return { finds: finds.count, pending: finds.pending, lizard: lizard.state, breath: [pond.breath.k.toFixed(2), pond.breath.count, pond.lotusOpen.toFixed(2)], rays: godRays ? [godRays.uniforms.uSun.value.x.toFixed(2), godRays.uniforms.uSun.value.y.toFixed(2), godRays.uniforms.uI.value.toFixed(2)] : null, haze: grade.uniforms.uHaze.value.toFixed(2), surprise: surprises.state, device: P.cls, world: 'earth', n8ao: !!(n8aoPass && n8aoPass.enabled), lightmaps: !!lightmaps, game: game.info(), season: SEASON.season, weather: SEASON.weather, intro: introT, pixelRatio, frames: engine.frames, growth: bonsai.growth, hour: ts.hour, elev: ts.elev, bloom: bloom.enabled, ...stats, fps: Math.round(engine.fps) }; },
    sand: SAND, pond: POND, bonsai: bonsaiPos,
    tris() {
      const out = [];
      scene.traverse((o) => { if ((o.isMesh || o.isPoints || o.isLine) && o.visible) {
        const g = o.geometry; const n = (g.index ? g.index.count : g.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1);
        let p = o, path = []; while (p && p !== scene) { path.unshift(p.name || p.type); p = p.parent; }
        out.push([Math.round(n), path.join('/').slice(0, 60), o.material && o.material.type]); } });
      return out.sort((a, b) => b[0] - a[0]).slice(0, 25);
    },
    pickAt(x, y) { const h = pick({ clientX: x, clientY: y }); return h ? { kind: h.kind, dist: h.dist } : null; },
    surfaceY,
    sizes() {
      const b = new THREE.Box3(), v = new THREE.Vector3(), out = {};
      const sz = (o) => { b.setFromObject(o); b.getSize(v); return [+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2), +b.min.y.toFixed(2)]; };
      out.bonsai = sz(bonsai.group); out.lantern = sz(flora.lantern); out.lizard = sz(lizard.group); out.shelf = sz(finds.shelf);
      out.pond = sz(pond.group); out.lotus = sz(pond.lotus);
      const seen = {};
      nature.group.traverse((o) => { if (o.isMesh || o.isInstancedMesh) { const k = (o.name || o.parent?.name || '?').slice(0, 24); if (!seen[k]) { seen[k] = 1; out['n:' + k] = sz(o); } } });
      scene.traverse((o) => { if (o.name && /koi|wall|bench|bamboo|snap/i.test(o.name) && !out['s:' + o.name]) out['s:' + o.name] = sz(o); });
      return out;
    },
    snapCenters: () => snaps[0].centers.map((c) => [c.x, c.y, c.z]),
    snapPose(i, o) { const sd = snaps[0], sp = sd.spikes[i]; for (let k = 0; k < sp.nf; k++) sd.setFloret(sp, k, o * (k / sp.nf < 0.8 ? 1 : 0.15)); sd.meshes[0].instanceMatrix.needsUpdate = true; sd.meshes[1].instanceMatrix.needsUpdate = true; },
    findPos: () => finds.world.map((w) => w.obj.position.toArray()),
    shelfPos: () => finds.items.map((it) => it.obj.position.toArray()),
    lizardPos: () => lizard.group.position.toArray(),
    breathe(on) { pond.setBreath(on, { x: 0.45, y: 0.5 }); },
    game,
    walkTo(x, z, yaw) { game.player.teleport(x, z, yaw ?? game.player.heading); },
    hideHud(on = true) { const el = document.getElementById('hud'); if (el) el.style.display = on ? 'none' : ''; },
    burstPetals() { life.burstPetals(); },
    tumbleNearest(x, z) { return life.tumbleNearest(x, z); },
    ripple(x, z, s = 0.7) { const uv = pond.pointToUv(new THREE.Vector3(x, POND.level, z)); if (uv) pond.tap(uv, clock, s); return uv; },
    life,
};


resize(engine.width, engine.height, engine.pixelRatio);
return {
  id: 'earth', scene, camera, tending, resize, frame, debug,
  onEnter(arg = {}) { game.onEnter(arg); renderer.shadowMap.needsUpdate = true; },
  where: () => game.where && game.where(),
  setAO(on) { userAO.on = !!on; syncAO(); },
  applyQuality,
  onContextRestored() { if (skyPhoto && skyPhoto.restore) skyPhoto.restore(); renderer.shadowMap.needsUpdate = true; syncAO(); },
  mapData: () => ({ name: 'The garden', fit: true, extent: { cx: 1.5, cz: -0.5, r: 60 }, pond: POND.outline(72, 0), items: game.interact.items(), player: { x: game.player.position.x, z: game.player.position.z, yaw: game.player.heading } }),
  restoreWhere: (w) => game.restoreWhere && game.restoreWhere(w),
  input: {
    down, move, up: endPointer,
    leave() { if (P.hover) applyHover(null); },
    get active() { return active; },
  },
  // called by the engine when the device still struggles at the lowest pixel ratio
  degrade() { if (n8aoPass && n8aoPass.enabled) { aoMode = 0; syncAO(); return true; } if (bloom.enabled) { bloom.enabled = false; bloomDisabled = true; return true; } return false; },
  get DT_MAX() { return DT_MAX; },
};
}
