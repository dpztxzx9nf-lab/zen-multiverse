// Living things around the garden: bamboo, grass, maples, shrubs, stone lantern,
// night-blooming moonflowers, fireflies and drifting leaves.
import * as THREE from 'three';
import { mulberry32, addSway, smoothstep, fbm3, noise3, mergeGeometries, softBlob, WIND_GLSL, windGust } from './util.js';
import { SAND } from './sand.js';
import { addSnowCover } from './weather.js';
import { POND } from './pond.js';
import { createWall } from './wall.js';

export const CENTER = new THREE.Vector2(1.5, -0.5);

function inSand(x, z, m = 0) { return Math.abs(x - SAND.cx) < SAND.w / 2 + m && Math.abs(z - SAND.cz) < SAND.d / 2 + m; }
function inPond(x, z, m = 0) { return POND.contains(x, z, m); }

export function createFlora(scene, { P, sway, useAssets = false, blocked = [], season = { season: 'autumn' }, uSnow = { value: 0 } }) {
  const SEASON = season.season;
  const rnd = mulberry32(4242);
  const isMobile = P.cls !== 'pc';
  const isBlocked = (x, z, m) => inSand(x, z, m) || inPond(x, z, m + 0.6) || blocked.some((b) => Math.hypot(x - b[0], z - b[1]) < b[2] + m);
  const dummy = new THREE.Object3D();

  // ---------------- bamboo grove (behind the garden)
  {
    const HS = P.cls === 'pc' ? 36 : 18;
    const stalkGeo = new THREE.CylinderGeometry(1, 1.1, 1, P.cls === 'pc' ? 8 : 6, HS, true).translate(0, 0.5, 0);
    const p = stalkGeo.attributes.position;
    const col = new Float32Array(p.count * 3);
    const cA = new THREE.Color('#5d7d3a'), cB = new THREE.Color('#8ea85a'), cN = new THREE.Color('#3c4f26'), c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      const ring = Math.round(y * 36);
      const isNode = HS === 36 ? ring % 3 === 0 : Math.round(y * HS) % 2 === 0;
      c.copy(cA).lerp(cB, y * 0.8);
      if (isNode && ring > 0) c.lerp(cN, 0.6);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    stalkGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const stalkMat = addSway(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }), sway, { height: 10, amp: 0.5 });
    const leafGeo = new THREE.PlaneGeometry(0.13, 0.85, 1, 3);
    {
      const lp = leafGeo.attributes.position;
      for (let i = 0; i < lp.count; i++) {
        const y = lp.getY(i) / 0.62 + 0.5;
        lp.setX(i, lp.getX(i) * Math.sin(Math.PI * Math.min(1, y * 1.1)) * 1.4);
        lp.setZ(i, -y * y * 0.16);
      }
      leafGeo.translate(0, 0.42, 0);
      leafGeo.computeVertexNormals();
    }
    const leafMat = addSway(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.7, side: THREE.DoubleSide, emissive: '#1c2a10', emissiveIntensity: 0.6 }), sway, { height: 10, amp: 0.5 });
    const stalks = [], leaves = [];
    // groves framing the sides and back corners, leaving the sky open above the back wall
    const groves = [
      [-21, -9, 3.5, 9], [-22, -2, 3.0, 7], [-21.5, 5, 3.0, 6], [-13, -16.5, 4, 8],
      [21, -13, 3.5, 9], [27, -14, 3.0, 7], [13, -17, 3.5, 7], [-9.5, -19.5, 3.0, 5], [9.5, -19.5, 3, 4],
    ];
    for (const [gx, gz, gr, n] of groves) {
      for (let s = 0; s < Math.round(n * P.bambooStalks); s++) {
        const a = rnd() * 6.28, rr = Math.sqrt(rnd()) * gr;
        const x = gx + Math.cos(a) * rr, z = gz + Math.sin(a) * rr;
        const h = 8 + rnd() * 5, r = 0.1 + rnd() * 0.06;
        stalks.push({ x, z, h, r, lean: (rnd() - 0.5) * 0.1 });
        const nl = P.bambooLeaves;
        for (let l = 0; l < nl; l++) {
          const tt = rnd();
          const y = h * (0.55 + tt * 0.5);
          const spread = 0.35 + (1 - Math.abs(tt - 0.5)) * 1.0;
          const aa = rnd() * 6.28, rr2 = Math.sqrt(rnd()) * spread;
          leaves.push({ x: x + Math.cos(aa) * rr2, y, z: z + Math.sin(aa) * rr2, ry: aa + Math.PI / 2 + (rnd() - 0.5) * 0.8, rx: 1.2 + rnd() * 0.9, s: 0.8 + rnd() * 0.6 });
        }
      }
    }
    const sm = new THREE.InstancedMesh(stalkGeo, stalkMat, stalks.length);
    stalks.forEach((s, i) => {
      dummy.position.set(s.x, 0, s.z); dummy.rotation.set(s.lean, 0, s.lean * 0.7); dummy.scale.set(s.r, s.h, s.r);
      dummy.updateMatrix(); sm.setMatrixAt(i, dummy.matrix);
    });
    sm.castShadow = false;
    scene.add(sm);
    const lm = new THREE.InstancedMesh(leafGeo, leafMat, leaves.length);
    const lc = new THREE.Color();
    leaves.forEach((l, i) => {
      dummy.position.set(l.x, l.y, l.z); dummy.rotation.set(l.rx, l.ry, 0, 'YXZ'); dummy.scale.setScalar(l.s);
      dummy.updateMatrix(); lm.setMatrixAt(i, dummy.matrix);
      lc.setHSL(0.2 + rnd() * 0.06, 0.5 + rnd() * 0.15, 0.3 + rnd() * 0.14); lm.setColorAt(i, lc);
    });
    lm.castShadow = false;
    scene.add(lm);
  }

  // ---------------- grass tufts on the moss
  {
    const blades = [];
    const NB = P.cls === 'pc' ? 16 : 10;
    const pos = [], colr = [];
    const dark = new THREE.Color('#2f4a1c'), light = new THREE.Color('#9cbb58');
    for (let b = 0; b < NB; b++) {
      const a = (b / NB) * Math.PI * 2 + rnd();
      const lean = 0.25 + rnd() * 0.45, h = 0.18 + rnd() * 0.22, w = 0.02;
      const dx = Math.cos(a), dz = Math.sin(a);
      const px = -dz, pz = dx;
      const S = P.cls === 'pc' ? 4 : 3;
      for (let s = 0; s < S; s++) {
        const t0 = s / S, t1 = (s + 1) / S;
        const P = (t) => [dx * lean * t * t * h * 1.5, t * h, dz * lean * t * t * h * 1.5];
        const W = (t) => w * (1 - t);
        const a0 = P(t0), a1 = P(t1);
        const l0 = [a0[0] - px * W(t0), a0[1], a0[2] - pz * W(t0)], r0 = [a0[0] + px * W(t0), a0[1], a0[2] + pz * W(t0)];
        const l1 = [a1[0] - px * W(t1), a1[1], a1[2] - pz * W(t1)], r1 = [a1[0] + px * W(t1), a1[1], a1[2] + pz * W(t1)];
        pos.push(...l0, ...r0, ...l1, ...r0, ...r1, ...l1);
        const c0 = dark.clone().lerp(light, t0), c1 = dark.clone().lerp(light, t1);
        for (const cc of [c0, c0, c1, c0, c1, c1]) colr.push(cc.r, cc.g, cc.b);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
    g.computeVertexNormals();
    // point normals upward-ish for softer lighting
    const nn = g.attributes.normal;
    for (let i = 0; i < nn.count; i++) nn.setXYZ(i, nn.getX(i) * 0.3, 1, nn.getZ(i) * 0.3);
    const mat = addSway(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }), sway, { height: 0.6, amp: 0.16 });
    const N = P.grass;
    const im = new THREE.InstancedMesh(g, mat, N);
    let n = 0, tries = 0;
    while (n < N && tries < N * 20) {
      tries++;
      const a = rnd() * Math.PI * 2, r = 3 + Math.sqrt(rnd()) * 21;
      const x = CENTER.x + Math.cos(a) * r, z = CENTER.y + Math.sin(a) * r;
      if (isBlocked(x, z, 0.5)) continue;
      // tufts gather along edges: near the sand curb, pond stones, wall and groves; sparse in open moss
      const nearSand = Math.max(Math.abs(x - SAND.cx) - SAND.w / 2, Math.abs(z - SAND.cz) - SAND.d / 2);
      const nearPond = POND.dist(x, z);
      const edge = Math.min(nearSand < 0 ? 99 : nearSand, nearPond < 0 ? 99 : nearPond, Math.abs(z + 12.6), 99);
      const keep = edge < 1.2 ? 0.9 : (z < -9 || Math.abs(x - CENTER.x) > 15 ? 0.6 : 0.08);
      if (rnd() > keep) continue;
      if (fbm3(x * 0.4, 0, z * 0.4, 2) < -0.15) continue;
      dummy.position.set(x, 0, z); dummy.rotation.set(0, rnd() * 6.28, 0); dummy.scale.setScalar(0.7 + rnd() * 0.8);
      dummy.updateMatrix(); im.setMatrixAt(n++, dummy.matrix);
    }
    im.count = n;
    im.receiveShadow = true;
    scene.add(im);
  }

  if (!useAssets) {
  // ---------------- maples, pines and clipped shrubs
  // Phone/tablet: all foliage is one instanced mesh of low-poly blobs (1 draw call).
  // PC: soft alpha-tested leaf cards with outward-facing normals and gentle wind.
  const cards = P.treeFoliage === 'cards';
  const barkMat = new THREE.MeshStandardMaterial({ color: '#4a3a30', roughness: 0.95 });
  const barkGeos = [];
  const foliage = []; // {x,y,z,s,color,ox,oy,oz,kind}
  const cc = new THREE.Color();
  function cloudTree({ x, z, h, seed, colors, spread = 1, pads = 6, kind = 0 }) {
    const r = mulberry32(seed);
    const pts = [];
    for (let i = 0; i <= 6; i++) pts.push(new THREE.Vector3(x + Math.sin(i * 0.9 + seed) * 0.25 * (i / 6), (i / 6) * h * 0.75, z + Math.cos(i * 0.7 + seed) * 0.2 * (i / 6)));
    const curve = new THREE.CatmullRomCurve3(pts);
    const ts = P.cls === 'pc' ? 24 : 12, rs = P.cls === 'pc' ? 8 : 6;
    const tg = new THREE.TubeGeometry(curve, ts, 1, rs, false);
    const tp = tg.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i <= ts; i++) {
      const c = curve.getPointAt(i / ts), rr = 0.32 * (1 - (i / ts) * 0.7) * (1 + Math.max(0, 1 - (i / ts) * 8) * 0.6);
      for (let j = 0; j <= rs; j++) { const k = i * (rs + 1) + j; v.fromBufferAttribute(tp, k).sub(c).multiplyScalar(rr).add(c); tp.setXYZ(k, v.x, v.y, v.z); }
    }
    tg.computeVertexNormals();
    barkGeos.push(tg);
    const centers = [];
    for (let k = 0; k < pads; k++) {
      const a = k * 2.4 + r(), el = h * (0.5 + r() * 0.5);
      const d = (0.8 + r() * 1.6) * spread;
      const end = new THREE.Vector3(x + Math.cos(a) * d, el, z + Math.sin(a) * d);
      const st = curve.getPointAt(Math.min(0.95, (el / h) * 0.9));
      const bc = new THREE.CatmullRomCurve3([st, st.clone().lerp(end, 0.5).add(new THREE.Vector3(0, 0.3, 0)), end]);
      barkGeos.push(new THREE.TubeGeometry(bc, 6, 0.07, 5, false));
      centers.push({ p: end, r: (1.0 + r() * 0.7) * spread });
    }
    centers.push({ p: new THREE.Vector3(pts[6].x, h * 0.85, pts[6].z), r: 1.4 * spread });
    const per = cards ? 46 : P.treeBlobs;
    for (const c of centers) for (let k = 0; k < per; k++) {
      const a = r() * 6.28, u = r() * 2 - 1, rr = Math.cbrt(r()) * c.r;
      const s = Math.sqrt(1 - u * u);
      const ox = Math.cos(a) * s, oy = u * 0.55, oz = Math.sin(a) * s;
      const t = (u + 1) / 2;
      cc.copy(colors[0]).lerp(colors[1], t * 0.8 + r() * 0.3); cc.offsetHSL((r() - 0.5) * 0.03, 0, (r() - 0.5) * 0.06);
      foliage.push({
        x: c.p.x + ox * rr, y: c.p.y + oy * rr, z: c.p.z + oz * rr,
        s: cards ? 0.55 + r() * 0.35 : (0.1 + r() * 0.11) * Math.sqrt(170 / Math.max(per, 1)) * 0.75 + 0.03,
        color: cc.clone(), ox, oy: oy + 0.5, oz, kind,
      });
    }
  }
  const C = (a, b) => [new THREE.Color(a), new THREE.Color(b)];
  const PAL = {
    spring: [C('#d98aa6', '#fbe0ea'), C('#e9a8bf', '#fff1f5'), C('#cf7d9c', '#f7d2df')], // sakura
    summer: [C('#2f5a22', '#7fa448'), C('#3d6a26', '#9ab85a'), C('#2a5220', '#6f9a40')],
    autumn: [C('#8a1e14', '#e8572a'), C('#9a6a12', '#f0c040'), C('#a8321a', '#f08a3a')],
    winter: [C('#5a4636', '#8a7462'), C('#62503e', '#94806a'), C('#584434', '#86705c')],
  }[SEASON];
  cloudTree({ x: 18.5, z: -7.5, h: 6.8, seed: 3, colors: PAL[0], spread: 1.3, pads: 7 });
  cloudTree({ x: -16.5, z: -8.5, h: 6.0, seed: 8, colors: PAL[1], spread: 1.15, pads: 6 });
  cloudTree({ x: 22, z: 4.5, h: 5.0, seed: 13, colors: PAL[2], spread: 1.0, pads: 5 });
  if (SEASON === 'winter') {
    // bare winter maples: keep only a sparse scatter of dry leaves
    for (let i = foliage.length - 1; i >= 0; i--) if (foliage[i].kind === 0 && (i * 7919) % 100 > 22) foliage.splice(i, 1);
  }
  // pines beyond the wall
  cloudTree({ x: -7, z: -16, h: 7.5, seed: 21, colors: [new THREE.Color('#1d3a24'), new THREE.Color('#4a6e3a')], spread: 1.25, pads: 7, kind: 1 });
  cloudTree({ x: 8.5, z: -15.5, h: 6.5, seed: 34, colors: [new THREE.Color('#1f3d26'), new THREE.Color('#557a3e')], spread: 1.15, pads: 6, kind: 1 });
  {
    addSnowCover(barkMat, uSnow, { strength: 0.8 });
    const bark = new THREE.Mesh(mergeGeometries(barkGeos), barkMat);
    bark.castShadow = true;
    scene.add(bark);
  }
  // clipped azalea-like mounds
  {
    const spots = [[-14.8, -3.5, 1.3], [-15.2, 4.5, 1.0], [-11.5, -10.5, 1.2], [7.2, -10.4, 1.1], [16.8, -2.2, 1.0], [-4.8, -11.0, 1.0], [14.5, 7.8, 0.9], [-12.8, 9.2, 0.8], [-1.5, -11.2, 0.8], [12.5, -10.8, 1.2], [-11.5, 12.5, 1.1], [-9.6, 13.4, 0.7], [12.0, 11.8, 1.0], [-17.5, 8.5, 1.2]];
    const per = cards ? 30 : P.shrubBlobs;
    for (const [x, z, s] of spots) for (let k = 0; k < per; k++) {
      const a = rnd() * 6.28, u = rnd(), rr = Math.sqrt(rnd()) * s * (cards ? 1.0 : 1.2);
      const y = (1 - (rr / (s * 1.2)) ** 2) * s * 0.75 * (0.6 + u * 0.4);
      cc.setHSL(0.27 + rnd() * 0.04, 0.45, 0.17 + u * 0.1);
      const flower = rnd() < (cards ? 0.18 : 0.12) * (SEASON === 'winter' ? 0 : SEASON === 'autumn' ? 0.5 : 1);
      if (flower) cc.setHSL(0.93 + rnd() * 0.04, 0.55, 0.55 + rnd() * 0.15);
      const sc = cards ? 0.42 + rnd() * 0.2 : (0.18 + rnd() * 0.12) * Math.sqrt(60 / Math.max(per, 1)) * 0.8;
      foliage.push({ x: x + Math.cos(a) * rr, y, z: z + Math.sin(a) * rr, s: sc, color: cc.clone(), ox: Math.cos(a) * rr / s, oy: 0.9, oz: Math.sin(a) * rr / s, kind: flower ? 3 : 2 });
    }
  }
  if (!cards) {
    // trees (far away) use the lightest blobs; shrubs near the camera get a rounder blob
    const blobMat = addSnowCover(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85 }), uSnow, { strength: 0.7 });
    for (const [list, detail] of [[foliage.filter((f) => f.kind < 2), P.treeBlobDetail], [foliage.filter((f) => f.kind >= 2), 1]]) {
      const im = new THREE.InstancedMesh(softBlob(detail), blobMat, list.length);
      list.forEach((f, i) => {
        dummy.position.set(f.x, f.y, f.z); dummy.rotation.set(rnd() * 3, rnd() * 3, 0); dummy.scale.set(f.s, f.s * 0.82, f.s);
        dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix); im.setColorAt(i, f.color);
      });
      im.castShadow = true; im.receiveShadow = true;
      scene.add(im);
    }
  } else {
    // leaf textures drawn once on canvases (white, tinted per instance)
    function leafTexture(drawLeaf, count, seed) {
      const c = document.createElement('canvas'); c.width = c.height = 256;
      const x = c.getContext('2d');
      const rr = mulberry32(seed);
      for (let i = 0; i < count; i++) {
        const a = rr() * 6.28, d = Math.sqrt(rr()) * 88;
        x.save();
        x.translate(128 + Math.cos(a) * d, 128 + Math.sin(a) * d);
        x.rotate(rr() * 6.28);
        const shade = 190 + Math.floor(rr() * 65);
        x.fillStyle = `rgb(${shade},${shade},${shade})`;
        drawLeaf(x, 0.8 + rr() * 0.5);
        x.restore();
      }
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      t.generateMipmaps = true; t.anisotropy = 4;
      return t;
    }
    const maple = (x, s) => {
      x.beginPath();
      for (let k = 0; k <= 10; k++) {
        const a = (k / 10) * Math.PI * 2 - Math.PI / 2;
        const r = (k % 2 === 0 ? 22 : 9) * s;
        x.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      x.closePath(); x.fill();
      x.strokeStyle = 'rgba(0,0,0,0.25)'; x.lineWidth = 1.2; x.beginPath(); x.moveTo(0, 0); x.lineTo(0, 20 * s); x.stroke();
    };
    const small = (x, s) => {
      x.beginPath(); x.ellipse(0, 0, 6 * s, 15 * s, 0, 0, Math.PI * 2); x.fill();
      x.strokeStyle = 'rgba(0,0,0,0.22)'; x.lineWidth = 1; x.beginPath(); x.moveTo(0, -13 * s); x.lineTo(0, 13 * s); x.stroke();
    };
    const texMaple = leafTexture(maple, 30, 1);
    const texSmall = leafTexture(small, 70, 2);
    const cardGeo = (() => {
      const a = new THREE.PlaneGeometry(1, 1), b = new THREE.PlaneGeometry(1, 1).rotateY(Math.PI / 2), c2 = new THREE.PlaneGeometry(1, 1).rotateX(Math.PI / 2);
      return mergeGeometries([a, b, c2]);
    })();
    const makeCards = (list, tex) => {
      const mat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.75, alphaToCoverage: true });
      mat.onBeforeCompile = (sh) => {
        sh.uniforms.uTime = sway.uTime; sh.uniforms.uWind = sway.uWind; sh.uniforms.uWindDir = sway.uWindDir;
        sh.vertexShader = 'attribute vec3 aOut;\n' + WIND_GLSL + sh.vertexShader
          .replace('#include <defaultnormal_vertex>', 'vec3 transformedNormal = normalMatrix * normalize(aOut);')
          .replace('#include <project_vertex>', `vec4 mvPosition = vec4(transformed, 1.0);
            mvPosition = instanceMatrix * mvPosition;
            { vec4 wp = modelMatrix * mvPosition;
              mvPosition.xyz += windOffset(wp.xyz, 0.09 * clamp(mvPosition.y * 0.18, 0.0, 1.0)); }
            mvPosition = modelViewMatrix * mvPosition;
            gl_Position = projectionMatrix * mvPosition;`);
        sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>',
          THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''));
      };
      mat.customProgramCacheKey = () => 'leafcards';
      const g = cardGeo.clone();
      const im = new THREE.InstancedMesh(g, mat, list.length);
      const outs = new Float32Array(list.length * 3);
      list.forEach((f, i) => {
        dummy.position.set(f.x, f.y, f.z); dummy.rotation.set(rnd() * 6.28, rnd() * 6.28, rnd() * 6.28); dummy.scale.setScalar(f.s);
        dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix); im.setColorAt(i, f.color);
        outs[i * 3] = f.ox; outs[i * 3 + 1] = f.oy; outs[i * 3 + 2] = f.oz;
      });
      g.setAttribute('aOut', new THREE.InstancedBufferAttribute(outs, 3));
      im.castShadow = true; im.receiveShadow = true;
      scene.add(im);
      return im;
    };
    makeCards(foliage.filter((f) => f.kind === 0), SEASON === 'spring' ? texSmall : texMaple);
    makeCards(foliage.filter((f) => f.kind !== 0), texSmall);
  }

  }
  // earthen garden wall (plaster bays, kawara cap, ivy, lamps with light pools)
  const wall = createWall(scene, { P, uSnow, season });

  // ---------------- stone lantern (tōrō) that glows at night (stone parts merged into one mesh)
  const lantern = new THREE.Group();
  lantern.position.set(7.6, 0, -4.6);
  lantern.scale.setScalar(0.63); // ~1.6 m stone lantern
  {
    const parts = [];
    const put = (g, x, y, z, sy = 1) => { g.scale(1, sy, 1); g.translate(x, y, z); parts.push(g.index ? g.toNonIndexed() : g); };
    put(new THREE.CylinderGeometry(0.55, 0.65, 0.22, 6), 0, 0.11, 0);
    put(new THREE.CylinderGeometry(0.16, 0.2, 1.0, 12), 0, 0.72, 0);
    put(new THREE.CylinderGeometry(0.5, 0.32, 0.18, 6), 0, 1.3, 0);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      put(new THREE.BoxGeometry(0.09, 0.42, 0.09), Math.cos(a) * 0.28, 1.6, Math.sin(a) * 0.28);
    }
    put(new THREE.ConeGeometry(0.78, 0.42, 6), 0, 2.03, 0, 0.85);
    put(new THREE.CylinderGeometry(0.18, 0.22, 0.12, 6), 0, 2.25, 0);
    put(new THREE.SphereGeometry(0.15, 12, 10), 0, 2.4, 0);
    parts.forEach((p) => p.deleteAttribute('uv'));
    const m = new THREE.Mesh(mergeGeometries(parts), addSnowCover(new THREE.MeshStandardMaterial({ color: '#8a877e', roughness: 0.95 }), uSnow));
    m.castShadow = true; m.receiveShadow = true;
    lantern.add(m);
  }
  const lanternGlowMat = new THREE.MeshStandardMaterial({ color: '#2a2018', emissive: '#ffb25a', emissiveIntensity: 0, roughness: 1 });
  const glowBox = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.36, 0.42), lanternGlowMat);
  glowBox.position.y = 1.6;
  lantern.add(glowBox);
  const lanternLight = new THREE.PointLight('#ffb060', 0, 14, 1.6);
  lanternLight.position.set(0, 1.6, 0);
  lantern.add(lanternLight);
  scene.add(lantern);

  // ---------------- moonflowers (night-blooming)
  const flowers = [];
  const moonLight = new THREE.PointLight('#cfe0ff', 0, 7, 1.8);
  {
    const plant = new THREE.Group();
    // sit near the snapdragons but off the walk path, so the leaves don't fill a close walk-by
    plant.position.set(6.15, 0, 4.35);
    scene.add(plant);
    moonLight.position.set(0, 1.0, 0);
    plant.add(moonLight);
    // heart-shaped leaves
    const leafShape = new THREE.Shape();
    leafShape.moveTo(0, 0);
    leafShape.bezierCurveTo(0.18, 0.05, 0.25, 0.25, 0, 0.45);
    leafShape.bezierCurveTo(-0.25, 0.25, -0.18, 0.05, 0, 0);
    const lg = new THREE.ShapeGeometry(leafShape, 6);
    const lmat = addSway(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.75, side: THREE.DoubleSide }), sway, { height: 1.5, amp: 0.06 });
    const NL = 72;
    const lim = new THREE.InstancedMesh(lg, lmat, NL);
    const cc = new THREE.Color();
    for (let i = 0; i < NL; i++) {
      // bias the leaf mass away from +z (the stepping-stone path and the snap close-up)
      const a = rnd() * 6.28, r = Math.sqrt(rnd()) * 0.82;
      const y = 0.05 + (1 - r / 0.82) * 0.7 * rnd() + 0.08;
      const x = Math.cos(a) * r, z = Math.sin(a) * r * 0.75 - 0.12; // a little toward the pond
      dummy.position.set(x, y, Math.min(0.55, z));
      dummy.rotation.set(-1.0 - rnd() * 0.5, a + Math.PI / 2 + (rnd() - 0.5), 0, 'YXZ');
      dummy.scale.setScalar(0.55 + rnd() * 0.4);
      dummy.updateMatrix(); lim.setMatrixAt(i, dummy.matrix);
      cc.setHSL(0.27 + rnd() * 0.04, 0.5, 0.16 + rnd() * 0.12); lim.setColorAt(i, cc);
    }
    lim.castShadow = true; lim.receiveShadow = true;
    plant.add(lim);

    const petalShape = new THREE.Shape();
    petalShape.moveTo(-0.03, 0);
    petalShape.bezierCurveTo(-0.2, 0.12, -0.2, 0.32, 0, 0.36);
    petalShape.bezierCurveTo(0.2, 0.32, 0.2, 0.12, 0.03, 0);
    const pg = new THREE.ShapeGeometry(petalShape, 8);
    {
      const pp = pg.attributes.position;
      for (let i = 0; i < pp.count; i++) { const y = pp.getY(i), x = pp.getX(i); pp.setZ(i, -x * x * 1.2 + y * y * 0.4); }
      pg.computeVertexNormals();
    }
    const spots = [[0.2, 1.05, 0.1, 0.0], [-0.55, 0.85, 0.3, 1.3], [0.55, 0.75, -0.35, 2.4], [-0.1, 0.7, -0.6, 3.6]];
    const stemGeos = [], centerGeo = new THREE.SphereGeometry(0.045, 10, 8);
    for (const [x, y, z, rot] of spots) {
      const f = new THREE.Group();
      f.position.set(x, y, z);
      f.rotation.set(0.25 * Math.cos(rot), rot, 0.25 * Math.sin(rot));
      const mat = new THREE.MeshStandardMaterial({ color: '#f4f7ee', emissive: '#dfe9ff', emissiveIntensity: 0, roughness: 0.5, side: THREE.DoubleSide });
      // six petals in one mesh; opening is done in the vertex shader (1 draw call per flower)
      const fu2 = { uAng: { value: -0.18 }, uS: { value: new THREE.Vector2(0.38, 0.85) } };
      mat.onBeforeCompile = (sh) => {
        sh.uniforms.uAng = fu2.uAng; sh.uniforms.uS = fu2.uS;
        sh.vertexShader = 'attribute float aYaw; uniform float uAng; uniform vec2 uS;\n' + sh.vertexShader
          .replace('#include <beginnormal_vertex>', `float ca = cos(uAng), sa = sin(uAng), cb = cos(aYaw), sb = sin(aYaw);
            mat3 rx = mat3(1.0, 0.0, 0.0, 0.0, ca, sa, 0.0, -sa, ca);
            mat3 ry = mat3(cb, 0.0, -sb, 0.0, 1.0, 0.0, sb, 0.0, cb);
            vec3 objectNormal = ry * rx * normalize(vec3(normal.x / uS.x, normal.y / uS.y, normal.z));`)
          .replace('#include <begin_vertex>', 'vec3 transformed = ry * rx * (position * vec3(uS, 1.0));');
      };
      mat.customProgramCacheKey = () => 'moonpetals';
      const petals = mergeGeometries(Array.from({ length: 6 }, () => pg.clone()));
      const yaw = new Float32Array(petals.attributes.position.count);
      const per = petals.attributes.position.count / 6;
      for (let i = 0; i < yaw.length; i++) yaw[i] = Math.floor(i / per) * (Math.PI / 3);
      petals.setAttribute('aYaw', new THREE.BufferAttribute(yaw, 1));
      const pm = new THREE.Mesh(petals, mat);
      pm.frustumCulled = false;
      f.add(pm);
      const center = new THREE.Mesh(centerGeo, new THREE.MeshStandardMaterial({ color: '#f7f0b0', emissive: '#fff2a0', emissiveIntensity: 0 }));
      center.position.y = 0.03;
      f.add(center);
      stemGeos.push(new THREE.CylinderGeometry(0.015, 0.02, y, 5).translate(x, y / 2, z));
      const pivots = fu2;
      plant.add(f);
      flowers.push({ group: f, pivots, mat, center, phase: rnd() * 0.25 });
    }
    plant.add(new THREE.Mesh(mergeGeometries(stemGeos), new THREE.MeshStandardMaterial({ color: '#3d5a28' })));
  }

  // ---------------- fireflies
  const NF = P.fireflies;
  const fg = new THREE.BufferGeometry();
  const fpos = new Float32Array(NF * 3), fseed = new Float32Array(NF);
  for (let i = 0; i < NF; i++) {
    let x, z;
    do { const a = rnd() * 6.28, r = 2 + Math.sqrt(rnd()) * 17; x = CENTER.x + Math.cos(a) * r; z = CENTER.y + Math.sin(a) * r; } while (inSand(x, z, -1.5));
    fpos[i * 3] = x; fpos[i * 3 + 1] = 0.4 + rnd() * 2.2; fpos[i * 3 + 2] = z;
    fseed[i] = rnd() * 100;
  }
  fg.setAttribute('position', new THREE.BufferAttribute(fpos, 3));
  fg.setAttribute('aSeed', new THREE.BufferAttribute(fseed, 1));
  const fu = { uTime: sway.uTime, uNight: { value: 0 }, uScale: { value: 300 } };
  const fmat = new THREE.ShaderMaterial({
    uniforms: fu, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `uniform float uTime; uniform float uScale; attribute float aSeed; varying float vA;
      void main(){
        vec3 p = position;
        float t = uTime * 0.18 + aSeed;
        p.x += sin(t * 1.3) * 1.2 + sin(t * 2.9 + 1.0) * 0.4;
        p.z += cos(t * 1.1) * 1.2 + sin(t * 2.3 + 2.0) * 0.4;
        p.y += sin(t * 1.7) * 0.35;
        float bl = sin(uTime * (0.7 + fract(aSeed) * 0.8) + aSeed * 7.0);
        vA = smoothstep(0.2, 0.9, bl) ;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = min(0.3 * uScale / -mv.z, uScale * 0.012);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform float uNight; varying float vA;
      void main(){ float r = length(gl_PointCoord - 0.5); float a = pow(smoothstep(0.5, 0.0, r), 2.2) * vA * uNight;
        if (a < 0.003) discard; gl_FragColor = vec4(vec3(0.85, 1.0, 0.45) * a * 3.0, a); }`,
  });
  const fireflies = new THREE.Points(fg, fmat);
  fireflies.frustumCulled = false;
  fg.setDrawRange(0, Math.round(NF * { spring: 0.6, summer: 1, autumn: 0.4, winter: 0 }[SEASON]));
  fireflies.visible = SEASON !== 'winter';
  scene.add(fireflies);

  // ---------------- drifting maple leaves
  const NLV = Math.max(1, Math.round(P.fallingLeaves * { spring: 1.3, summer: 0.25, autumn: 1, winter: 0.12 }[SEASON]));
  const lvShape = new THREE.Shape();
  if (SEASON === 'spring') {
    // cherry petal: a soft notched oval
    lvShape.moveTo(0, -0.03);
    lvShape.bezierCurveTo(0.028, -0.02, 0.025, 0.02, 0.008, 0.03);
    lvShape.lineTo(0, 0.022); lvShape.lineTo(-0.008, 0.03);
    lvShape.bezierCurveTo(-0.025, 0.02, -0.028, -0.02, 0, -0.03);
  } else {
    // a small seven-lobed maple leaf (~10 cm)
    for (let k = 0; k <= 14; k++) {
      const a = (k / 14) * Math.PI * 2;
      const rr = k % 2 === 0 ? (k === 6 || k === 8 ? 0.035 : 0.052) : 0.024;
      const x = Math.sin(a) * rr, y = Math.cos(a) * rr;
      if (k === 0) lvShape.moveTo(x, y); else lvShape.lineTo(x, y);
    }
  }
  const lvGeo = new THREE.ShapeGeometry(lvShape);
  lvGeo.rotateX(-Math.PI / 2);
  const lvMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.7, side: THREE.DoubleSide });
  const lvMesh = new THREE.InstancedMesh(lvGeo, lvMat, NLV);
  lvMesh.name = 'fallingLeaves';
  lvMesh.frustumCulled = false;
  scene.add(lvMesh);
  const lvCol = {
    spring: ['#f6c6d6', '#fbe3ec', '#eaa0bb', '#fff3f7'],
    summer: ['#5d8a34', '#7fa448', '#4a7a2c', '#94b45a'],
    autumn: ['#c0301c', '#e86a2a', '#f0b23a', '#a8281a'],
    winter: ['#8a7462', '#7a634e', '#9a8470', '#6e5a48'],
  }[SEASON].map((c) => new THREE.Color(c));
  const sources = [[18.5, -7.5, 6.5], [-16.5, -8.5, 6], [22, 4.5, 5]];
  const lvs = [];
  function spawnLeaf(l, initial) {
    const s = sources[Math.floor(Math.random() * sources.length)];
    l.x = s[0] + (Math.random() - 0.5) * 4; l.z = s[1] + (Math.random() - 0.5) * 4; l.y = s[2] * (0.6 + Math.random() * 0.4);
    if (initial) { l.x = CENTER.x + (Math.random() - 0.5) * 34; l.z = CENTER.y + (Math.random() - 0.5) * 24; l.y = Math.random() * 6; }
    l.ph = Math.random() * 6.28; l.spin = (Math.random() - 0.5) * 3; l.rest = 0; l.floor = 0.02;
    l.rx = Math.random() * 6; l.rz = Math.random() * 6; l.ry = Math.random() * 6;
  }
  for (let i = 0; i < NLV; i++) {
    const l = {}; spawnLeaf(l, true); lvs.push(l);
    lvMesh.setColorAt(i, lvCol[i % lvCol.length]);
  }

  // ---------------- per-frame update
  let lanternBoost = 0; // a visit sign can light the lantern even by day
  function update(dt, now, ts) {
    const night = ts.night;
    // lantern
    const flick = 0.92 + 0.05 * Math.sin(now * 7.3) + 0.03 * Math.sin(now * 13.1 + 1.0);
    const lan = Math.max(smoothstep(0.0, 0.8, night + ts.golden * 0.25), lanternBoost * 0.6);
    lanternGlowMat.emissiveIntensity = lan * 2.6 * flick;
    lanternLight.intensity = lan * 9 * flick;
    wall.update(lan, 0.94 + 0.06 * Math.sin(now * 7.3) * Math.sin(now * 2.1));
    // moonflowers open over the evening and close by morning
    const open = smoothstep(0.15, 0.95, night);
    for (const f of flowers) {
      const o = smoothstep(f.phase, 1, open);
      const breathe = Math.sin(now * 0.5 + f.phase * 20) * 0.03 * o;
      f.pivots.uAng.value = -(0.18 + o * 1.12) - breathe;
      f.pivots.uS.value.set(0.38 + 0.62 * o, 0.85 + 0.15 * o);
      f.mat.emissiveIntensity = o * (0.42 + 0.08 * Math.sin(now * 0.8 + f.phase * 10));
      f.mat.color.setRGB(0.85 + 0.12 * o, 0.92 + 0.05 * o, 0.8 + 0.18 * o);
      f.center.material.emissiveIntensity = o * 0.9;
      f.group.scale.setScalar(0.7 + 0.2 * o);
    }
    moonLight.intensity = open * 0.9;
    fu.uNight.value = smoothstep(0.35, 1.0, night);
    // leaves
    for (let i = 0; i < NLV; i++) {
      const l = lvs[i];
      if (l.rest > 0) {
        l.rest -= dt;
        if (l.onWater) { l.x += Math.sin(now * 0.2 + l.ph) * 0.05 * dt; l.z += Math.cos(now * 0.17 + l.ph) * 0.05 * dt; }
        if (l.rest <= 0) spawnLeaf(l, false);
      } else {
        l.y -= (0.32 + 0.12 * Math.sin(now * 1.7 + l.ph)) * dt;
        const gw = windGust(l.x, l.z, now, sway.uWindDir.value) * sway.uWind.value;
        l.x += (Math.sin(now * 0.9 + l.ph) * 0.4 + sway.uWindDir.value.x * gw * 0.9) * dt;
        l.z += (Math.cos(now * 0.7 + l.ph * 2) * 0.3 + sway.uWindDir.value.y * gw * 0.9) * dt;
        l.rx += l.spin * dt; l.rz += l.spin * 0.7 * dt;
        let floor = 0.03;
        const wet = inPond(l.x, l.z, -0.2);
        if (wet) floor = POND.level + 0.015;
        else if (inSand(l.x, l.z)) floor = 0.13;
        if (l.y <= floor) {
          l.y = floor; l.rest = wet ? 25 + Math.random() * 20 : 8 + Math.random() * 14; l.onWater = wet;
          l.rx = 0; l.rz = 0;
        }
      }
      dummy.position.set(l.x, l.y, l.z);
      dummy.rotation.set(l.rx, l.ry, l.rz);
      dummy.scale.setScalar(SEASON === 'spring' ? 1.25 : 1.6);
      dummy.updateMatrix();
      lvMesh.setMatrixAt(i, dummy.matrix);
    }
    lvMesh.instanceMatrix.needsUpdate = true;
  }

  function setPointScale(px) { fu.uScale.value = px; }

  return { update, setPointScale, lantern, lanternLight, set lanternBoost(v) { lanternBoost = v; }, get lanternBoost() { return lanternBoost; } };
}
