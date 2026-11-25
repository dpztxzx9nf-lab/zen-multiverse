// Baked bounce + AO for the static garden pieces (ground, sand, wall, pond rim, shelf, rocks).
// UV2 is derived from world XZ or a box unwrap so the Blender bake mesh need not match
// runtime vertex order. MeshStandardMaterial.lightMap and aoMap both read uv2.
// The mid-day Poly Haven HDRI stays on scene.environment for reflections and specular;
// the lightmap carries bounce and occlusion only, and is faded at night so the dynamic
// sun (and moon) still run the day/night cycle.
import * as THREE from 'three';

export const LM = {
  size: 2048,
  phoneSize: 1024,
  pad: 4,
  gx0: -20, gx1: 20, gz0: -16, gz1: 18,
  sand: { cx: -2.5, cz: 0.5, w: 13, d: 8.5 },
  pond: { cx: 10.2, cz: 1.2, r: 4.4 },
  wall: { x0: 0, z: -12.6, len: 35, h: 2.55, t: 0.7 },
  shelf: { x: 5, z: 5, ry: 0.25, s: 0.62 },
  // pixel rects [x, y, w, h] in the 2048 garden atlas (y=0 at the top of the saved WebP).
  // Garden textures load with flipY=false so these coords match the file. Rocks keep flipY=true.
  tiles: {
    ground: [0, 0, 1536, 1536],
    sand: [1536, 0, 512, 512],
    pond: [1536, 512, 512, 512],
    wall: [0, 1536, 2048, 256],
    shelf: [0, 1792, 256, 256],
  },
  rockSize: 128,
  rockCols: 16,
};

function tileMap(u, v, tile, pad = LM.pad) {
  const [x, y, w, h] = tile;
  const uu = (x + pad + Math.min(1, Math.max(0, u)) * (w - 2 * pad)) / LM.size;
  const vv = (y + pad + Math.min(1, Math.max(0, v)) * (h - 2 * pad)) / LM.size;
  return [uu, vv];
}

export function rockTile(i) {
  const c = LM.rockCols, s = LM.rockSize;
  const col = i % c, row = Math.floor(i / c);
  return [col * s, row * s, s, s];
}

export function setUv2WorldXZ(geo, getXZ, tile, bounds) {
  const p = geo.attributes.position;
  const out = new Float32Array(p.count * 2);
  const { x0, x1, z0, z1 } = bounds;
  for (let i = 0; i < p.count; i++) {
    const [wx, wz] = getXZ(i, p);
    out[i * 2] = tileMap((wx - x0) / (x1 - x0), (wz - z0) / (z1 - z0), tile)[0];
    out[i * 2 + 1] = tileMap((wx - x0) / (x1 - x0), (wz - z0) / (z1 - z0), tile)[1];
  }
  geo.setAttribute('uv2', new THREE.BufferAttribute(out, 2));
  return geo;
}

export function setUv2FromFn(geo, fn) {
  const p = geo.attributes.position;
  const out = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const [u, v] = fn(i, p);
    out[i * 2] = u; out[i * 2 + 1] = v;
  }
  geo.setAttribute('uv2', new THREE.BufferAttribute(out, 2));
  return geo;
}

function worldXZ(mesh, i, p) {
  mesh.updateWorldMatrix(true, false);
  const v = new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i)).applyMatrix4(mesh.matrixWorld);
  return [v.x, v.z];
}

export function applyUv2Ground(mesh) {
  setUv2WorldXZ(mesh.geometry, (i, p) => worldXZ(mesh, i, p), LM.tiles.ground, {
    x0: LM.gx0, x1: LM.gx1, z0: LM.gz0, z1: LM.gz1,
  });
}

export function applyUv2Sand(mesh) {
  const { cx, cz, w, d } = LM.sand;
  setUv2WorldXZ(mesh.geometry, (i, p) => worldXZ(mesh, i, p), LM.tiles.sand, {
    x0: cx - w / 2, x1: cx + w / 2, z0: cz - d / 2, z1: cz + d / 2,
  });
}

export function applyUv2Pond(mesh) {
  const { cx, cz, r } = LM.pond;
  setUv2WorldXZ(mesh.geometry, (i, p) => worldXZ(mesh, i, p), LM.tiles.pond, {
    x0: cx - r, x1: cx + r, z0: cz - r, z1: cz + r,
  });
}

export function applyUv2Wall(root) {
  const { len, h, t } = LM.wall;
  const tile = LM.tiles.wall;
  root.updateWorldMatrix(true, false);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const v = new THREE.Vector3();
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes.position) return;
    if (o.isInstancedMesh) return; // cap tiles, ivy, moss — shared template UV2 would be wrong
    if (o.material && (o.material.transparent || o.material.blending === THREE.AdditiveBlending)) return;
    setUv2FromFn(o.geometry, (i, p) => {
      v.set(p.getX(i), p.getY(i), p.getZ(i)).applyMatrix4(o.matrixWorld).applyMatrix4(inv);
      const u = (v.x + len / 2) / len;
      if (v.y > h * 0.82) return tileMap(u, 0.58 + (v.z / t + 0.5) * 0.16, tile);
      if (v.z >= -0.02) return tileMap(u, (v.y / h) * 0.55, tile);
      return tileMap(u, 0.78 + (v.y / h) * 0.17, tile);
    });
  });
}

export function applyUv2Shelf(root) {
  const tile = LM.tiles.shelf;
  root.updateWorldMatrix(true, false);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const v = new THREE.Vector3();
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes.position) return;
    setUv2FromFn(o.geometry, (i, p) => {
      v.set(p.getX(i), p.getY(i), p.getZ(i)).applyMatrix4(o.matrixWorld).applyMatrix4(inv);
      return tileMap((v.x + 1.25) / 2.5, v.y / 1.35, tile);
    });
  });
}

function prepTex(tex, { flipY = true } = {}) {
  // RGBM and AO are data; do not apply an sRGB transfer
  tex.colorSpace = THREE.NoColorSpace;
  tex.flipY = flipY;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

export function hookRgbmLightmap(mat, range = 8) {
  if (!mat || mat.userData.lmRgbm) return mat;
  mat.userData.lmRgbm = true;
  mat.userData.lmRgbmRange = range;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    if (sh.fragmentShader.includes('uLmRgbm')) return;
    sh.uniforms.uLmRgbm = { value: mat.userData.lmRgbmRange ?? range };
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uLmRgbm;')
      .replace(
        'vec3 lightMapIrradiance = lightMapTexel.rgb * lightMapIntensity;',
        'vec3 lightMapIrradiance = lightMapTexel.rgb * lightMapTexel.a * uLmRgbm * lightMapIntensity;',
      );
  };
  const pk = mat.customProgramCacheKey ? mat.customProgramCacheKey.bind(mat) : () => '';
  mat.customProgramCacheKey = () => pk() + 'lmRgbm';
  mat.needsUpdate = true;
  return mat;
}

export async function loadLightmaps(P) {
  const tier = P.cls === 'pc' ? 'pc' : 'phone';
  const base = new URL('../assets/lightmap/', import.meta.url).href;
  const loader = new THREE.TextureLoader();
  const tryLoad = (name) => loader.loadAsync(`${base}${name}-${tier}.webp`).catch(() => null);
  const [garden, gardenAo, rocks, rocksAo, layout] = await Promise.all([
    tryLoad('garden'), tryLoad('garden-ao'), tryLoad('rocks'), tryLoad('rocks-ao'),
    fetch(new URL('../assets/lightmap/layout.json', import.meta.url)).then((r) => r.ok ? r.json() : null).catch(() => null),
  ]);
  if (!garden || !gardenAo) return null;
  // the garden WebP is packed with y=0 at the top; flipY would map the sand tile onto the black wall strip
  prepTex(garden, { flipY: false }); prepTex(gardenAo, { flipY: false });
  if (rocks) prepTex(rocks);
  if (rocksAo) prepTex(rocksAo);
  const rgbmRange = (layout && layout.rgbmRange) || 8;
  return { garden, gardenAo, rocks, rocksAo, mats: [], rockMats: [], rgbmRange };
}

export function applyMaps(mat, light, ao, { lightI = 0.45, aoI = 0.9, rgbmRange = 8 } = {}) {
  if (!mat || mat.isShaderMaterial) return mat;
  if (mat.aoMap && mat.aoMap !== ao && mat.roughnessMap !== mat.aoMap) {
    /* leave roughnessMap as-is */
  }
  mat.aoMap = ao;
  mat.aoMapIntensity = aoI;
  mat.userData.lmAoI = aoI;
  mat.userData.lmLightI = lightI;
  if (light) {
    mat.lightMap = light;
    mat.lightMapIntensity = lightI;
    hookRgbmLightmap(mat, rgbmRange);
  }
  mat.needsUpdate = true;
  return mat;
}

export function applyStaticLightmaps(scene, maps, { sand, pond, finds }) {
  if (!maps) return;
  const seen = new Set();
  const add = (mat, light, ao) => {
    if (!mat || seen.has(mat)) return;
    seen.add(mat);
    applyMaps(mat, light, ao, { rgbmRange: maps.rgbmRange });
    maps.mats.push(mat);
  };
  const ground = scene.getObjectByName('ground');
  if (ground) { applyUv2Ground(ground); add(ground.material, null, maps.gardenAo); }
  if (sand?.mesh) {
    applyUv2Sand(sand.mesh);
    // softer AO on the gravel: a full 0.9 stack with displacement self-shadow turned dusk grooves into black trenches
    applyMaps(sand.mesh.material, maps.garden, maps.gardenAo, { rgbmRange: maps.rgbmRange, aoI: 0.45, lightI: 0.4 });
    maps.mats.push(sand.mesh.material);
    seen.add(sand.mesh.material);
    // kerb is instanced; world-XZ uv2 on the template mesh would be wrong, and N8AO + baked sand covers the joint
  }
  if (pond?.group) {
    pond.group.traverse((o) => {
      if (!o.isMesh) return;
      if (o.name === 'pondRim' || o.name === 'pondBowl') {
        applyUv2Pond(o);
        add(o.material, maps.garden, maps.gardenAo);
      }
    });
  }
  const wall = scene.getObjectByName('wall');
  if (wall) {
    applyUv2Wall(wall);
    wall.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh) return;
      if (o.material && (o.material.transparent || o.material.blending === THREE.AdditiveBlending)) return;
      // wall bake is nearly empty; applying its AO tile turns the plaster black at dusk
      applyMaps(o.material, maps.garden, null, { rgbmRange: maps.rgbmRange, aoI: 0, lightI: 0.25 });
      maps.mats.push(o.material);
      seen.add(o.material);
    });
  }
  if (finds?.shelf) {
    applyUv2Shelf(finds.shelf);
    finds.shelf.traverse((o) => { if (o.isMesh) add(o.material, maps.garden, maps.gardenAo); });
  }
}

// Per-instance world-XZ tiles on an InstancedMesh (shared geometry, unique atlas cells).
export function hookRockLightmap(mat) {
  if (!mat || mat.userData.lmRock) return mat;
  mat.userData.lmRock = true;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    if (sh.vertexShader.includes('aLmUv')) return;
    sh.vertexShader = sh.vertexShader.replace(
      '#include <common>',
      '#include <common>\nattribute vec4 aLmUv;\nattribute vec4 aLmBox;',
    ).replace(
      /\}\s*$/,
      `#ifdef USE_LIGHTMAP
      {
        vec4 lmp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          lmp = instanceMatrix * lmp;
        #endif
        lmp = modelMatrix * lmp;
        vLightMapUv = aLmUv.xy + aLmUv.zw * clamp((lmp.xz - aLmBox.xy) * aLmBox.zw, 0.0, 1.0);
        #ifdef USE_AOMAP
          vAoMapUv = vLightMapUv;
        #endif
      }
      #endif
      }`,
    );
  };
  const pk = mat.customProgramCacheKey ? mat.customProgramCacheKey.bind(mat) : () => '';
  mat.customProgramCacheKey = () => pk() + 'lmRock';
  mat.needsUpdate = true;
  return mat;
}

export function applyRockLightmaps(gardenRocks, maps) {
  if (!maps?.rocks || !gardenRocks?.records?.length) return;
  // one atlas tile per placed rock (id); every mesh part of that rock shares it
  const unique = [];
  const byId = new Map();
  gardenRocks.records.forEach((r) => {
    if (!byId.has(r.id)) { byId.set(r.id, r); unique.push(r); }
  });
  unique.sort((a, b) => (a.x - b.x) || (a.z - b.z) || (a.name || '').localeCompare(b.name || ''));
  const tileOf = new Map();
  unique.forEach((r, i) => tileOf.set(r.id, i));
  const perMesh = new Map();
  gardenRocks.records.forEach((r) => {
    r.tileIndex = tileOf.get(r.id);
    if (!perMesh.has(r.im)) perMesh.set(r.im, []);
    perMesh.get(r.im).push(r);
  });
  const tmp = new THREE.Vector3();
  const box = new THREE.Box3();
  for (const [im, items] of perMesh) {
    if (!im.geometry.userData.lmOwn) { im.geometry = im.geometry.clone(); im.geometry.userData.lmOwn = true; }
    hookRockLightmap(im.material);
    applyMaps(im.material, maps.rocks, maps.rocksAo, { aoI: 0.85, lightI: 0.4, rgbmRange: maps.rgbmRange });
    if (!maps.rockMats.includes(im.material)) maps.rockMats.push(im.material);
    const n = im.count;
    const uv = new Float32Array(n * 4);
    const bb = new Float32Array(n * 4);
    const m4 = new THREE.Matrix4();
    items.forEach((r) => {
      const tile = rockTile(r.tileIndex);
      const [uu0, vv0] = tileMap(0, 0, tile);
      const [uu1, vv1] = tileMap(1, 1, tile);
      uv[r.i * 4] = uu0; uv[r.i * 4 + 1] = vv0; uv[r.i * 4 + 2] = uu1 - uu0; uv[r.i * 4 + 3] = vv1 - vv0;
      im.getMatrixAt(r.i, m4);
      const geo = im.geometry;
      if (!geo.boundingBox) geo.computeBoundingBox();
      box.copy(geo.boundingBox).applyMatrix4(m4);
      // instance matrix is already in world (group at origin)
      const pad = 0.08;
      const minx = box.min.x - pad, minz = box.min.z - pad;
      const sx = Math.max(1e-3, box.max.x + pad - minx), sz = Math.max(1e-3, box.max.z + pad - minz);
      bb[r.i * 4] = minx; bb[r.i * 4 + 1] = minz; bb[r.i * 4 + 2] = 1 / sx; bb[r.i * 4 + 3] = 1 / sz;
      r.box = [minx, minz, sx, sz];
    });
    im.geometry.setAttribute('aLmUv', new THREE.InstancedBufferAttribute(uv, 4));
    im.geometry.setAttribute('aLmBox', new THREE.InstancedBufferAttribute(bb, 4));
    void tmp;
  }
  maps.mats.push(...maps.rockMats);
}

export function updateLightmapStrength(maps, ts) {
  if (!maps) return;
  const night = ts.night || 0;
  const overcast = ts.overcast || 0;
  const elevRad = ts.elev != null ? ts.elev * Math.PI / 180 : Math.acos(Math.min(1, Math.max(0, night)));
  const elev = Math.max(0, Math.sin(Math.max(0, elevRad)));
  const day = Math.max(0, 1 - night) * (0.55 + 0.45 * (1 - overcast * 0.35));
  // modest scale so the dynamic sun + IBL still own mid-day; zero at night so the garden stays dark
  const k = 0.42 * day * (0.22 + 0.78 * elev);
  const aoFade = 0.8 + 0.2 * (1 - night * 0.45);
  for (const m of maps.mats) {
    m.lightMapIntensity = (maps.rockMats.includes(m) ? 0.9 : 1) * k;
    const aoBase = m.userData.lmAoI;
    m.aoMapIntensity = (aoBase == null ? 0.9 : aoBase) * aoFade;
  }
}
