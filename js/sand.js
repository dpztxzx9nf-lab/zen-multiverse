// Raked sand bed: a heightmap canvas drives displacement + bump. Dragging draws rake grooves;
// over a few minutes they slowly settle back into the garden's resting pattern.
import * as THREE from 'three';
import { placedRock, rockMaterial, makeMossMound } from './rocks.js';
import { mulberry32, mergeGeometries } from './util.js';
import { applyDetail } from './detail.js';
import { loadSet } from './game/pbr.js';

export const SAND = { cx: -2.5, cz: 0.5, w: 13, d: 8.5 }; // metres: a residential karesansui bed
export const SAND_ROCKS = [
  { x: -6.26, z: -1.07, r: 1.13, seed: 11, sy: 0.85 },
  { x: -5.10, z: -0.22, r: 0.58, seed: 23, sy: 0.7 },
  { x: -5.72, z: -2.05, r: 0.39, seed: 31, sy: 0.6 },
  { x: 0.72, z: 2.00, r: 0.82, seed: 47, sy: 0.95 },
  { x: -2.57, z: 3.05, r: 0.47, seed: 59, sy: 0.6 },
];

export function createSand(scene, { P, renderer }) {
  const { cx, cz, w: W, d: D } = SAND;
  const TW = P.sandTex;
  const ppu = TW / W;
  const TH = Math.round(D * ppu);
  const SP = 0.36; // groove spacing (world units)
  const AMP = 54;

  const canvas = document.createElement('canvas');
  canvas.width = TW; canvas.height = TH;
  const ctx = canvas.getContext('2d', { willReadFrequently: false });
  const base = document.createElement('canvas');
  base.width = TW; base.height = TH;
  const bctx = base.getContext('2d');

  // ---- resting pattern: straight lines, outline bands, and rings around rocks
  const img = bctx.createImageData(TW, TH);
  const x0 = cx - W / 2, z0 = cz - D / 2, x1 = cx + W / 2, z1 = cz + D / 2;
  const TAU = Math.PI * 2;
  const ringN = 4;
  for (let py = 0; py < TH; py++) {
    const wz = z0 + (py + 0.5) / ppu;
    for (let px = 0; px < TW; px++) {
      const wx = x0 + (px + 0.5) / ppu;
      let dmin = 1e9;
      for (const r of SAND_ROCKS) {
        const d = Math.hypot(wx - r.x, (wz - r.z) * 1.08) - r.r * 1.12;
        if (d < dmin) dmin = d;
      }
      const de = Math.min(wx - x0, x1 - wx, wz - z0, z1 - wz);
      let v;
      if (dmin < ringN * SP) {
        v = dmin < 0 ? 0.2 : Math.cos((TAU * dmin) / SP);
      } else if (de < 2 * SP) {
        v = Math.cos((TAU * (de - SP * 0.25)) / SP);
      } else {
        v = Math.cos((TAU * (wz - z0 - SP * 0.25)) / SP);
      }
      const val = 128 + AMP * v;
      const i = (py * TW + px) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = val;
      img.data[i + 3] = 255;
    }
  }
  bctx.putImageData(img, 0, 0);
  ctx.drawImage(base, 0, 0);

  // ---- rake profile strip (cross-section of a 5-tine rake)
  const NT = 5;
  const HP = Math.round(NT * SP * ppu);
  const strip = document.createElement('canvas');
  strip.width = 4; strip.height = HP;
  const sctx = strip.getContext('2d');
  const sd = sctx.createImageData(4, HP);
  for (let y = 0; y < HP; y++) {
    const t = ((y + 0.5) / HP) * NT;
    const v = Math.cos(TAU * t);
    const a = Math.min(1, t / 0.45, (NT - t) / 0.45);
    const aa = a * a * (3 - 2 * a);
    for (let x = 0; x < 4; x++) {
      const i = (y * 4 + x) * 4;
      sd.data[i] = sd.data[i + 1] = sd.data[i + 2] = 128 + AMP * 1.05 * v;
      sd.data[i + 3] = 255 * aa;
    }
  }
  sctx.putImageData(sd, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 4;

  // grain colour map: crushed granite (shirakawa-suna) is not white. It is a warm grey-beige made of
  // quartz/feldspar grains with a pepper of dark biotite and a few rust-coloured grains, plus soft
  // blotches where finer dust settles.
  const GS = 1024;
  const gc = document.createElement('canvas');
  gc.width = gc.height = GS;
  const gctx = gc.getContext('2d');
  const gd = gctx.createImageData(GS, GS);
  const rnd = mulberry32(7);
  const blot = new Float32Array(GS * GS);
  { // tileable value noise blotches (period 8 and 32 cells)
    const lat = (n) => { const a = new Float32Array(n * n); for (let i = 0; i < a.length; i++) a[i] = rnd(); return a; };
    const L1 = lat(8), L2 = lat(32);
    const samp = (L, n, x, y) => { const fx = x * n, fy = y * n, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty), g = (a, b) => L[((b % n + n) % n) * n + ((a % n + n) % n)];
      return (g(ix, iy) * (1 - sx) + g(ix + 1, iy) * sx) * (1 - sy) + (g(ix, iy + 1) * (1 - sx) + g(ix + 1, iy + 1) * sx) * sy; };
    for (let y = 0; y < GS; y++) for (let x = 0; x < GS; x++) blot[y * GS + x] = samp(L1, 8, x / GS, y / GS) * 0.65 + samp(L2, 32, x / GS, y / GS) * 0.35;
  }
  for (let i = 0; i < GS * GS; i++) {
    const n = rnd();
    let r = 214 + (n - 0.5) * 46, g = r * 0.962, b = r * 0.905;
    const k = rnd();
    if (k > 0.972) { const d = 70 + rnd() * 80; r -= d; g -= d; b -= d * 0.95; }            // biotite / dark grains
    else if (k > 0.962) { r -= 10; g -= 34; b -= 52; }                                        // iron-stained grain
    else if (k > 0.94) { r += 18; g += 18; b += 16; }                                         // bright quartz
    const m = 0.9 + (blot[i] - 0.5) * 0.16;
    gd.data[i * 4] = r * m; gd.data[i * 4 + 1] = g * m; gd.data[i * 4 + 2] = b * m; gd.data[i * 4 + 3] = 255;
  }
  gctx.putImageData(gd, 0, 0);
  const grain = new THREE.CanvasTexture(gc);
  grain.colorSpace = THREE.SRGBColorSpace;
  grain.wrapS = grain.wrapT = THREE.RepeatWrapping;
  grain.anisotropy = 8;
  grain.repeat.set(5, 5 * D / W);

  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#cbc5b8'),
    map: grain,
    roughness: 0.93,
    metalness: 0,
    displacementMap: tex,
    displacementScale: 0.11,
    displacementBias: -0.055,
    bumpMap: tex,
    bumpScale: 2.6,
  });
  const hover = { value: new THREE.Vector3(0.5, 0.5, 0) };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uHover = hover;
    shader.fragmentShader = 'uniform vec3 uHover;\n' + shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>
       { float hgt = texture2D(bumpMap, vBumpMapUv).x;
         diffuseColor.rgb *= mix(0.80, 1.06, smoothstep(0.2, 0.8, hgt));
         // weathering: broad faint dust/damp patches, and darker sand where it meets the kerb and the
         // rocks (fine debris collects and the rake never quite reaches)
         vec2 wp = vBumpMapUv * vec2(${W.toFixed(1)}, ${D.toFixed(1)});
         float pn = sin(wp.x * 0.83 + sin(wp.y * 0.61) * 1.7) * sin(wp.y * 0.97 + sin(wp.x * 0.53) * 1.3);
         diffuseColor.rgb *= 1.0 - 0.05 * smoothstep(0.1, 0.9, pn);
         vec2 ed = min(vBumpMapUv, 1.0 - vBumpMapUv) * vec2(${W.toFixed(1)}, ${D.toFixed(1)});
         float edge = min(ed.x, ed.y);
         diffuseColor.rgb *= mix(vec3(0.84, 0.83, 0.82), vec3(1.0), smoothstep(0.0, 0.32, edge));
         diffuseColor.rgb *= 1.0 - 0.06 * (1.0 - smoothstep(0.02, 0.5, hgt));
         float rd = 9.0;
         ${SAND_ROCKS.map((r) => `rd = min(rd, length((wp - vec2(${(r.x - (cx - W / 2)).toFixed(2)}, ${((cz + D / 2) - r.z).toFixed(2)})) * vec2(1.0, 1.08)) - ${(r.r * 1.12).toFixed(2)});`).join('\n         ')}
         diffuseColor.rgb *= mix(0.86, 1.0, smoothstep(-0.1, 0.35, rd));
         vec2 dd = (vBumpMapUv - uHover.xy) * vec2(${W.toFixed(1)}, ${D.toFixed(1)});
         diffuseColor.rgb *= 1.0 + uHover.z * 0.09 * exp(-dot(dd, dd) / 0.9); }`
    );
  };
  // photographic grain relief and tonal break-up from a CC0 gravelly-sand scan (luminance only)
  loadSet('gravelly_sand', P, renderer).then((set) => applyDetail(mat, set, { scale: 0.9, k: 0.55, lum: true, nK: 0.4, rK: 0.5, key: 'sand' }));
  let hoverTarget = 0;
  function setHover(uv) { if (uv) { hover.value.x = uv.x; hover.value.y = uv.y; hoverTarget = 1; } else hoverTarget = 0; }

  const segX = P.sandSegs, segZ = Math.round(segX * D / W);
  const geo = new THREE.PlaneGeometry(W, D, segX, segZ);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(cx, 0.09, cz);
  mesh.receiveShadow = true;
  mesh.name = 'sand';
  scene.add(mesh);

  // grey stone kerb: individual sawn blocks (~60 cm) with eased arrises, hairline joints and a little
  // settling, in a scanned granite texture
  const cw = 0.2, ch = 0.14, bev = 0.014;
  const kerbG = (() => {
    const L = 1, sh = new THREE.Shape();
    const hx = L / 2 - bev, hz = cw / 2 - bev;
    sh.moveTo(-hx, -hz); sh.lineTo(hx, -hz); sh.lineTo(hx, hz); sh.lineTo(-hx, hz); sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth: ch - 2 * bev, bevelEnabled: true, bevelThickness: bev, bevelSize: bev, bevelSegments: 2, curveSegments: 1 });
    g.rotateX(-Math.PI / 2); g.translate(0, bev, 0);
    return g;
  })();
  const curbMat = new THREE.MeshStandardMaterial({ color: '#77736c', roughness: 0.85 });
  loadSet('rock_boulder_dry', P, renderer).then((set) => applyDetail(curbMat, set, { scale: 1.8, k: 0.9, lum: true, nK: 0.8, key: 'kerb' }));
  const runs = [ // [x0, z0, x1, z1]
    [cx - W / 2 - cw, cz - D / 2 - cw / 2, cx + W / 2 + cw, cz - D / 2 - cw / 2],
    [cx - W / 2 - cw, cz + D / 2 + cw / 2, cx + W / 2 + cw, cz + D / 2 + cw / 2],
    [cx - W / 2 - cw / 2, cz - D / 2, cx - W / 2 - cw / 2, cz + D / 2],
    [cx + W / 2 + cw / 2, cz - D / 2, cx + W / 2 + cw / 2, cz + D / 2],
  ];
  const kr = mulberry32(91), mats = [], m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  for (const [ax, az, bx, bz] of runs) {
    const len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(len / 0.6)), bl = len / n, rot = Math.atan2(-(bz - az), bx - ax);
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      e.set((kr() - 0.5) * 0.012, rot + (kr() - 0.5) * 0.01, (kr() - 0.5) * 0.012);
      q.setFromEuler(e);
      m4.compose(new THREE.Vector3(ax + (bx - ax) * t, -0.004 + (kr() - 0.5) * 0.012, az + (bz - az) * t), q, new THREE.Vector3(bl - 0.006, 1, 1));
      mats.push(m4.clone());
    }
  }
  const kerb = new THREE.InstancedMesh(kerbG, curbMat, mats.length);
  mats.forEach((m, i) => kerb.setMatrixAt(i, m));
  kerb.castShadow = true; kerb.receiveShadow = true; kerb.name = 'kerb';
  scene.add(kerb);
  // sand floor under the displaced surface
  const under = new THREE.Mesh(new THREE.PlaneGeometry(W, D).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#a9a294', roughness: 1 }));
  under.position.set(cx, 0.03, cz);
  scene.add(under);

  // rocks + a mossy island under the main group
  const mound = makeMossMound(5, 1.85, 1.35);
  mound.position.set(SAND_ROCKS[0].x - 0.3, 0.06, SAND_ROCKS[0].z - 0.4);
  scene.add(mound);
  const mound2 = makeMossMound(9, 1.05, 0.9);
  mound2.position.set(SAND_ROCKS[3].x, 0.06, SAND_ROCKS[3].z);
  scene.add(mound2);
  const rocks = [];
  const rockGeos = SAND_ROCKS.map((r) => placedRock(r.seed, { sx: r.r, sy: r.r * r.sy, sz: r.r * 0.9, moss: 0.7 }, r.x, 0.12, r.z, r.seed));
  const rockMesh = new THREE.Mesh(mergeGeometries(rockGeos), rockMaterial());
  rockMesh.castShadow = true; rockMesh.receiveShadow = true;
  scene.add(rockMesh);
  rocks.push(rockMesh);

  // ---- raking
  let raking = false;
  const s = { x: 0, y: 0 }, last = { x: 0, y: 0 };
  let dirty = false;
  let strokeLen = 0;

  function uvToPx(uv) { return { x: uv.x * TW, y: (1 - uv.y) * TH }; }
  function segment(ax, ay, bx, by) {
    const len = Math.hypot(bx - ax, by - ay);
    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(Math.atan2(by - ay, bx - ax));
    ctx.drawImage(strip, -1.5, -HP / 2, len + 3, HP);
    ctx.restore();
    dirty = true;
  }
  function rakeStart(uv) {
    const p = uvToPx(uv);
    s.x = last.x = p.x; s.y = last.y = p.y;
    raking = true; strokeLen = 0;
  }
  function rakeMove(uv) {
    if (!raking) { rakeStart(uv); return 0; }
    const p = uvToPx(uv);
    s.x += (p.x - s.x) * 0.5; s.y += (p.y - s.y) * 0.5;
    const d = Math.hypot(s.x - last.x, s.y - last.y);
    if (d > 2.5) {
      segment(last.x, last.y, s.x, s.y);
      last.x = s.x; last.y = s.y;
      strokeLen += d;
      return d / ppu;
    }
    return 0;
  }
  function rakeEnd() {
    if (raking) {
      const d = Math.hypot(s.x - last.x, s.y - last.y);
      if (d > 0.5) segment(last.x, last.y, s.x, s.y);
    }
    raking = false;
  }

  let settleT = 0, settleN = 0;
  function update(dt) {
    hover.value.z += (hoverTarget - hover.value.z) * Math.min(1, dt * 4);
    settleT += dt;
    if (settleT > 4) {
      settleT = 0; settleN++;
      ctx.globalAlpha = settleN % 6 === 0 ? 0.22 : 0.03;
      ctx.drawImage(base, 0, 0);
      ctx.globalAlpha = 1;
      dirty = true;
    }
    if (dirty) { tex.needsUpdate = true; dirty = false; }
  }

  return { mesh, rocks, rakeStart, rakeMove, rakeEnd, update, setHover, get raking() { return raking; } };
}
