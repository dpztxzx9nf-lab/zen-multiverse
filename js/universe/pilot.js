// Free flight: board the ship and fly it yourself, from the ground through the air into orbit, across
// the system and down onto another world, with no loading cut. Runs inside the planet world.
//
// Two ways of laying out the scene, switched without a visible change:
//   surface  (near the loaded world, below ~2.5 km): the scene is the current tile's flat frame (the
//            floating origin, curvature in the shader); the ship sits at its tile coordinates
//   space    (higher, or near another body): the ship is the origin and everything else is placed
//            relative to it in a fixed basis (camera-relative rendering), float64 underneath
// Everything the camera sees (the globe, other bodies, the star, the starfield, the sun direction) is
// derived each frame from float64 inertial positions (system.js), so a change of basis or origin moves
// nothing on screen. Far bodies are distance-compressed (same angular size, drawn behind).
// The terrain of the body you approach is loaded while you are still high above it (it is hidden up
// there anyway), with the full globe built a slice at a time between frames.
import * as THREE from 'three';
import { systemOf, soiAt, nearestSurface, sub, len, AU, LY } from './system.js';
import { createFlightState, stepFlight, CRUISE_K } from './flight.js';
import { shipPhysics, burn, readout, loadRocketSim } from './ship.js';
import { fuelState, shipStats, jumpCost } from './travel.js';
import { makePlanet } from '../game/planetgen.js';
import { buildGlobe } from './globe.js';
import { makeFrame, tileOf, shouldRebase } from './sphere.js';
import { starsIn, galaxyPos, starAt, parseAddr, addrKey, lyBetween, intergalactic, SECTOR_LY, HOME } from './universe.js';
import { moveKeys, keyDown, pad } from '../game/player.js';
import { game } from '../game/store.js';
import { hash } from '../game/names.js';

const CSS = `
#pilot{position:fixed;inset:0;pointer-events:none;z-index:22;color:#eef4ff;font:13px/1.3 system-ui,-apple-system,Segoe UI,sans-serif;text-shadow:0 1px 3px rgba(0,0,0,.6);display:none}
#pilot.on{display:block}
#pilot .top{position:absolute;top:max(12px,env(safe-area-inset-top));left:50%;transform:translateX(-50%);text-align:center;letter-spacing:.04em}
#pilot .top .mode{font-size:12px;letter-spacing:.16em;text-transform:uppercase;opacity:.75}
#pilot .top .big{font-size:20px;font-weight:600}
#pilot .left{position:absolute;left:max(14px,env(safe-area-inset-left));top:38%;width:170px}
#pilot .bar{height:5px;border-radius:3px;background:rgba(255,255,255,.18);margin:3px 0 8px;overflow:hidden}
#pilot .bar i{display:block;height:100%;background:#9fe3ff;width:0}
#pilot .bar.heat i{background:linear-gradient(90deg,#ffcf7a,#ff5a3a)}
#pilot .tgt{position:absolute;width:26px;height:26px;margin:-13px 0 0 -13px;border:1.5px solid rgba(160,230,255,.85);border-radius:50%;display:none}
#pilot .tgt b{position:absolute;left:30px;top:2px;white-space:nowrap;font-weight:500;font-size:12px}
#pilot .btns{position:absolute;right:max(12px,env(safe-area-inset-right));bottom:max(16px,env(safe-area-inset-bottom));display:flex;flex-direction:column;gap:7px;align-items:flex-end;pointer-events:auto}
#pilot .btns button{background:rgba(20,30,60,.55);border:1px solid rgba(255,255,255,.22);color:#fff;border-radius:999px;padding:9px 14px;font:inherit;font-size:13px;cursor:pointer;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}
#pilot .btns button.hot{background:rgba(160,220,255,.35)}
#pilot .btns button[hidden]{display:none}
#pilot .hint{position:absolute;left:50%;bottom:max(18px,env(safe-area-inset-bottom));transform:translateX(-50%);opacity:.75;font-size:12px;text-align:center;width:min(560px,80vw)}
#pilot .glow{position:absolute;inset:0;background:radial-gradient(ellipse at 50% 60%,rgba(255,120,40,0) 40%,rgba(255,110,40,.35) 100%);opacity:0;transition:opacity .3s}
#pilot .menu{position:absolute;right:max(12px,env(safe-area-inset-right));bottom:120px;background:rgba(18,24,52,.86);border:1px solid rgba(255,255,255,.2);border-radius:14px;padding:10px 12px;pointer-events:auto;min-width:240px;max-height:50vh;overflow:auto;display:none}
#pilot .menu.on{display:block}
#pilot .menu button{display:block;width:100%;text-align:left;margin-top:6px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);color:#fff;border-radius:10px;padding:8px 10px;font:inherit;cursor:pointer}
`;
const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const nrm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const fmtD = (m) => (m > LY * 0.05 ? (m / LY).toFixed(2) + ' ly' : m > AU * 0.01 ? (m / AU).toFixed(2) + ' AU' : m > 2000 ? (m / 1000).toFixed(1) + ' km' : Math.round(m) + ' m');
// game metres are real kilometres: say distances the way a pilot would (the real ones)
const fmtReal = (m) => (m > LY * 0.05 ? (m / LY).toFixed(2) + ' ly' : m > AU * 0.01 ? (m / AU).toFixed(2) + ' AU' : Math.round(m).toLocaleString() + ' km');
const fmtV = (v) => (v > 2.998e5 * 0.5 ? (v / 2.998e5).toFixed(1) + ' c' : v > 2000 ? (v / 1000).toFixed(1) + ' thousand km/s' : Math.round(v) + ' m/s');

export function createPilot(host) {
  const { scene, camera, hud, player, core, lite } = host;
  if (!document.getElementById('pilot-css')) { const s = document.createElement('style'); s.id = 'pilot-css'; s.textContent = CSS; document.head.appendChild(s); }
  const ui = document.createElement('div'); ui.id = 'pilot';
  ui.innerHTML = `<div class="glow"></div><div class="top"><div class="mode"></div><div class="big"></div><div class="sub"></div></div>
    <div class="left"><div>Propellant <span class="fu"></span></div><div class="bar fuel"><i></i></div><div class="dv"></div><div style="margin-top:6px">Hull heat</div><div class="bar heat"><i></i></div><div class="nav" style="margin-top:6px"></div></div>
    <div class="tgt"><b></b></div>
    <div class="menu"></div>
    <div class="btns"><button data-a="lift">Lift (hold)</button><button data-a="cruise">Cruise</button><button data-a="align">Face target</button><button data-a="warp" hidden>Engage warp</button><button data-a="scoop" hidden>Scoop ice</button><button data-a="beacons">Beacons</button><button data-a="map">Nav map</button><button data-a="leave">Leave ship</button></div>
    <div class="hint"></div>`;
  document.body.appendChild(ui);
  const $ = (s) => ui.querySelector(s);
  const btn = (a) => ui.querySelector(`[data-a="${a}"]`);
  let liftBtn = false;
  btn('lift').addEventListener('pointerdown', (e) => { e.preventDefault(); liftBtn = true; });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) btn('lift').addEventListener(ev, () => { liftBtn = false; });
  ui.querySelectorAll('.btns button').forEach((b) => { if (b.dataset.a !== 'lift') b.addEventListener('click', () => act(b.dataset.a)); });

  // ---------------- state
  const G = game.data; G.universe = G.universe || {};
  let S = null, sys = null, focus = null, Q = new THREE.Quaternion(), Qi = new THREE.Quaternion();
  let st = null, active = false, space = false, phys = shipPhysics(), scoop = false, warp = null, assist = true;
  const B = new THREE.Matrix3(), Bs = new THREE.Matrix3(), Bi = new THREE.Matrix3();
  let basisKey = '';
  const obsScene = new THREE.Vector3(); let obsI = [0, 0, 0];
  const nose = [0, 1, 0];
  let camOff = null; // inertial chase offset (smoothed)
  loadRocketSim().then(() => { phys = shipPhysics(); });

  // body orientation: the arrival spot faces the star the way its sky says (sun elevation / azimuth)
  function qFor(W, b) {
    const fr0 = makeFrame(W.radius, W.spawnTile), d0 = fr0.toDir(W.spawn.x, W.spawn.z);
    const e = nrm([fr0.e[0] - d0[0] * dot3(fr0.e, d0), fr0.e[1] - d0[1] * dot3(fr0.e, d0), fr0.e[2] - d0[2] * dot3(fr0.e, d0)]), s = crs(e, d0);
    const el = W.sky.sunElev, az = W.sky.sunAz, l = [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];
    const v0 = nrm([e[0] * l[0] + d0[0] * l[1] + s[0] * l[2], e[1] * l[0] + d0[1] * l[1] + s[1] * l[2], e[2] * l[0] + d0[2] * l[1] + s[2] * l[2]]);
    const star = nrm([-b.pos[0], -b.pos[1], -b.pos[2]]);
    return new THREE.Quaternion().setFromUnitVectors(v3(v0), v3(star));
  }
  const tmpV = new THREE.Vector3();
  const toBody = (vI) => { tmpV.set(vI[0], vI[1], vI[2]).applyQuaternion(Qi); return [tmpV.x, tmpV.y, tmpV.z]; };
  const toInertial = (vB) => { tmpV.set(vB[0], vB[1], vB[2]).applyQuaternion(Q); return [tmpV.x, tmpV.y, tmpV.z]; };
  // the local (flat-scene) basis at a body-fixed direction, as rows e, up, n
  function localRows(W, x, z, d) {
    const a = W.frame.toDir(x, z, [0, 0, 0]), b = W.frame.toDir(x + 1, z, [0, 0, 0]);
    let e = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]; const k = dot3(e, d); e = nrm([e[0] - d[0] * k, e[1] - d[1] * k, e[2] - d[2] * k]);
    return [e, d, crs(e, d)];
  }
  // basis inertial -> scene at a flat position (rows * Qi)
  function surfaceBasis(W, x, z, d, out) {
    const [e, u, n] = localRows(W, x, z, d);
    const m = new THREE.Matrix3().set(e[0], e[1], e[2], u[0], u[1], u[2], n[0], n[1], n[2]);
    const q = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(Qi));
    return out.multiplyMatrices(m, q);
  }
  // ---------------- attach to a system + the loaded body (also when she is just walking)
  function attach(sysAddr, bodyAddr) {
    const S0 = S; S = sysAddr ? systemOf(sysAddr) : null; sys = S ? S.sys : null;
    focus = S ? S.bodies.find((b) => b.addr === bodyAddr) || null : null;
    const W = host.W();
    if (focus && W) { focus.ensureRules(); Q = qFor(W, focus); Qi = Q.clone().invert(); focus.Wq = Q; }
    G.universe.at = sys ? addrKey(sys) : G.universe.at;
    if (S !== S0 || !views.size) { rebuildViews(); stars.dirty = true; }
  }
  // observer: the ship when flying, else the walker, in flat coords and inertial
  function observerFlat() { return active ? shipFlat : player.position; }
  const shipFlat = new THREE.Vector3();
  function flatToInertial(W, x, y, z) { const d = W.frame.toDir(x, z, [0, 0, 0]), r = W.radius + y; const b = toInertial([d[0] * r, d[1] * r, d[2] * r]); return [focus.pos[0] + b[0], focus.pos[1] + b[1], focus.pos[2] + b[2]]; }
  function inertialToFlat(W, p) { const pb = toBody(sub(p, focus.pos)), r = Math.hypot(pb[0], pb[1], pb[2]), d = [pb[0] / r, pb[1] / r, pb[2] / r], xz = W.frame.fromDir(d); return { x: xz[0], y: r - W.radius, z: xz[1], d, r }; }

  // ---------------- what the camera sees out there: bodies, the star, the stars
  const spaceGroup = new THREE.Group(); spaceGroup.name = 'space'; scene.add(spaceGroup);
  const views = new Map();
  const starMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), new THREE.MeshBasicMaterial({ color: '#fff', fog: false, depthTest: false, depthWrite: false }));
  starMesh.userData.noCurve = true; starMesh.material.userData.noCurve = true; starMesh.frustumCulled = false; spaceGroup.add(starMesh);
  const glowTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'); const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.15, 'rgba(255,245,225,.55)'); gr.addColorStop(1, 'rgba(255,240,220,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c); })();
  const starGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#fff', transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  starGlow.frustumCulled = false; spaceGroup.add(starGlow);
  function giantMesh(b) {
    const c = document.createElement('canvas'); c.width = 8; c.height = 128; const g = c.getContext('2d'), r = (k) => ((hash(b.body.seed, k) % 1000) / 1000);
    const base = b.kind === 'gas' ? [200 + r(1) * 40, 170 + r(2) * 40, 130 + r(3) * 40] : [150 + r(1) * 30, 190 + r(2) * 40, 210 + r(3) * 30];
    for (let y = 0; y < 128; y++) { const k = 0.82 + 0.18 * Math.sin(y * 0.35 + r(4) * 9) * Math.sin(y * 0.11 + r(5) * 5); g.fillStyle = `rgb(${base[0] * k | 0},${base[1] * k | 0},${base[2] * k | 0})`; g.fillRect(0, y, 8, 1); }
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), new THREE.MeshStandardMaterial({ map: tex, roughness: 1, fog: false }));
    m.material.userData.noCurve = true; m.userData.noCurve = true; m.frustumCulled = false;
    m.scale.setScalar(b.R);
    return { mesh: m, R: b.R, setFar(on, o) { m.material.depthTest = m.material.depthWrite = !on; m.renderOrder = on ? o : 0; }, setFade() {}, dispose() { m.geometry.dispose(); m.material.dispose(); tex.dispose(); } };
  }
  function rebuildViews() {
    for (const v of views.values()) if (v.g) { spaceGroup.remove(v.g.mesh); v.g.dispose(); } views.clear();
    if (!S) return;
    const st0 = S.star; starMesh.material.color.set(st0.col || '#fff'); starGlow.material.color.set(st0.col || '#fff');
    for (const b of S.bodies) views.set(b.addr, { b, g: null, q: null });
  }
  let viewBuildT = 0;
  function ensureView(v) {
    if (v.g) return true;
    if (viewBuildT > 0) return false; viewBuildT = 0.05; // one new body a frame or so
    const b = v.b;
    if (b.giant) { v.g = giantMesh(b); v.q = new THREE.Quaternion(); }
    else {
      b.ensureRules();
      const W = makePlanet(b.body.seed, host.dim(), { rules: b.rules });
      v.W = W; v.g = buildGlobe(W, { detail: lite ? 6 : 10 }); v.q = qFor(W, b);
      v.g.setFade(1);
    }
    v.g.mesh.visible = true; spaceGroup.add(v.g.mesh);
    return true;
  }
  // stars: real neighbouring stars (from the hashed galaxy) + a faint background
  const NBG = lite ? 900 : 1800, NN = 400;
  const starGeo = new THREE.BufferGeometry();
  const sPos = new Float32Array((NBG + NN) * 3), sCol = new Float32Array((NBG + NN) * 3), sSize = new Float32Array(NBG + NN);
  { const r = (i, k) => (hash(i, k, 77) % 100000) / 100000; for (let i = 0; i < NBG; i++) { const u = r(i, 1) * 2 - 1, ph = r(i, 2) * 6.283, c = Math.sqrt(1 - u * u); // a band along the galactic plane (y ~ 0)
    const band = r(i, 5) < 0.45 ? 0.18 : 1; const yy = u * band; const l = Math.hypot(c, yy);
    sPos[i * 3] = c * Math.cos(ph) / l; sPos[i * 3 + 1] = yy / l; sPos[i * 3 + 2] = c * Math.sin(ph) / l; const b = 0.25 + r(i, 3) * 0.5; const w = r(i, 4); sCol[i * 3] = b * (0.85 + w * 0.15); sCol[i * 3 + 1] = b * 0.9; sCol[i * 3 + 2] = b * (1 - w * 0.15); sSize[i] = 1 + r(i, 6) * 1.2; } }
  starGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3)); starGeo.setAttribute('color', new THREE.BufferAttribute(sCol, 3)); starGeo.setAttribute('aSize', new THREE.BufferAttribute(sSize, 1));
  const starMat = new THREE.ShaderMaterial({ uniforms: { uOp: { value: 0 }, uR: { value: 1000 }, uPx: { value: Math.min(2, devicePixelRatio || 1) } }, transparent: true, depthWrite: false, depthTest: true, fog: false, vertexColors: true,
    vertexShader: 'attribute float aSize; uniform float uR, uPx; varying vec3 vC; void main(){ vC = color; gl_PointSize = aSize * uPx; gl_Position = projectionMatrix * modelViewMatrix * vec4(position * uR, 1.); }',
    fragmentShader: 'uniform float uOp; varying vec3 vC; void main(){ vec2 d = gl_PointCoord - .5; float a = smoothstep(.5, .1, length(d)); gl_FragColor = vec4(vC * uOp, a * uOp); }' });
  const starPts = new THREE.Points(starGeo, starMat); starPts.frustumCulled = false; starPts.renderOrder = -9; starPts.userData.noCurve = true; spaceGroup.add(starPts);
  const streakGeo = new THREE.BufferGeometry(); const strPos = new Float32Array(NN * 6); streakGeo.setAttribute('position', new THREE.BufferAttribute(strPos, 3));
  const streaks = new THREE.LineSegments(streakGeo, new THREE.LineBasicMaterial({ color: '#cfe0ff', transparent: true, opacity: 0, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
  streaks.frustumCulled = false; streaks.userData.noCurve = true; streaks.renderOrder = -8; spaceGroup.add(streaks);
  const stars = { dirty: true, t: 0, prev: new Float32Array(NN * 3) };
  // galaxy-plane position of the current star (or the warp's interpolated point) in ly, BigInt-safe
  function hereGal() {
    if (warp) return warp.at;
    if (!sys) return null;
    const s = sys.star === 'home' ? { x: 0.5, y: 0.62 } : starAt(sys) || { x: 0.5, y: 0.5 };
    return { g: sys.g, s: sys.s, fx: s.x, fy: s.y };
  }
  function refreshStars() {
    const h = hereGal(); if (!h) return;
    const out = []; const R2 = 2;
    for (let j = -R2; j <= R2; j++) for (let i = -R2; i <= R2; i++) {
      const sx = h.s[0] + BigInt(i), sy = h.s[1] + BigInt(j);
      for (const s of starsIn(h.g, sx, sy)) {
        const dx = (i + s.x - h.fx) * SECTOR_LY, dz = (j + s.y - h.fy) * SECTOR_LY, dy = ((hash(s.seed || 1, 9) % 1000) / 1000 - 0.5) * 6;
        const d = Math.hypot(dx, dy, dz); if (d < 0.02) continue; // that's us
        out.push({ d, dir: [dx / d, dy / d, dz / d], lum: s.lum || 1, col: new THREE.Color(s.col || '#fff') });
      }
    }
    out.sort((a, b) => a.d - b.d);
    for (let k = 0; k < NN; k++) {
      const o = out[k], i = NBG + k;
      stars.prev[k * 3] = sPos[i * 3]; stars.prev[k * 3 + 1] = sPos[i * 3 + 1]; stars.prev[k * 3 + 2] = sPos[i * 3 + 2];
      if (!o) { sSize[i] = 0; continue; }
      sPos[i * 3] = o.dir[0]; sPos[i * 3 + 1] = o.dir[1]; sPos[i * 3 + 2] = o.dir[2];
      const b = Math.min(1.6, 0.35 + Math.sqrt(o.lum) * 6 / o.d);
      sCol[i * 3] = o.col.r * b; sCol[i * 3 + 1] = o.col.g * b; sCol[i * 3 + 2] = o.col.b * b; sSize[i] = Math.min(6, 1.6 + b * 2.4);
    }
    starGeo.attributes.position.needsUpdate = true; starGeo.attributes.color.needsUpdate = true; starGeo.attributes.aSize.needsUpdate = true;
  }

  // ---------------- per frame: place everything from the observer's float64 position
  const Mrot = new THREE.Matrix4(), qTmp = new THREE.Quaternion();
  function sceneOf(X, out) { const d = [X[0] - obsI[0], X[1] - obsI[1], X[2] - obsI[2]]; out.set(d[0], d[1], d[2]).applyMatrix3(B); return out.add(obsScene); }
  function quatOf(qBody) { Mrot.setFromMatrix3(B); qTmp.setFromRotationMatrix(Mrot); return qTmp.clone().multiply(qBody); }
  const tv = new THREE.Vector3(), cv = new THREE.Vector3();
  function placeFar(obj, g, X, R, order) {
    sceneOf(X, tv); cv.copy(tv).sub(camera.position); const d = cv.length(), D0 = camera.far * 0.42;
    if (d > D0) { obj.position.copy(camera.position).addScaledVector(cv, D0 / d); obj.scale.setScalar(R * D0 / d); if (g) g.setFar(true, order); return d; }
    obj.position.copy(tv); obj.scale.setScalar(R); if (g) g.setFar(false); return d;
  }
  function updateSky(darkK) {
    const W = host.W(); if (!S) { spaceGroup.visible = false; return; }
    spaceGroup.visible = true;
    // the observer, in inertial coords, and the basis
    if (active) { obsI = st.p.slice(); }
    else if (focus && W) { const p = player.position; obsI = flatToInertial(W, p.x, p.y, p.z); }
    if (!active || !space) {
      if (focus && W) { const o = observerFlat(); const f = inertialToFlat(W, obsI); surfaceBasis(W, o.x, o.z, f.d, B); obsScene.set(o.x, o.y, o.z); }
    } else obsScene.set(0, 0, 0);
    Bi.copy(B).invert();
    // the star
    const starDirScene = sceneOf([0, 0, 0], new THREE.Vector3()).sub(obsScene).normalize();
    host.setSunDir(starDirScene);
    const ds = placeFar(starMesh, null, [0, 0, 0], S.R, -7.5);
    starGlow.position.copy(starMesh.position); starGlow.scale.setScalar(starMesh.scale.x * 9); starMesh.renderOrder = -7.5; starGlow.renderOrder = -7.4;
    starMesh.visible = starGlow.visible = darkK > 0.35; starGlow.material.opacity = Math.min(1, (darkK - 0.35) * 2);
    void ds;
    // bodies (nearest drawn last)
    viewBuildT -= 1 / 60;
    const list = [];
    for (const v of views.values()) {
      const b = v.b; if (focus && b.addr === focus.addr) { if (v.g) v.g.mesh.visible = false; continue; }
      const dist = len(sub(b.pos, obsI)), ang = b.R / Math.max(1, dist);
      if (ang < 0.0004) { if (v.g) v.g.mesh.visible = false; continue; } // a dot: the starfield has it
      if (!ensureView(v)) continue;
      v.g.mesh.visible = true; list.push({ v, dist });
    }
    list.sort((a, b) => b.dist - a.dist);
    list.forEach(({ v }, i) => { placeFar(v.g.mesh, v.g, v.b.pos, 1, -7 + i * 0.01); v.g.mesh.scale.multiplyScalar(v.b.giant ? v.b.R : 1); if (v.q) v.g.mesh.quaternion.copy(quatOf(v.q)); });
    // the loaded world's globe
    const globe = host.globe();
    if (globe && focus) {
      const d = placeFar(globe.mesh, globe, focus.pos, 1, -6);
      globe.mesh.quaternion.copy(quatOf(Q));
      void d;
    }
    // stars
    stars.t -= 1 / 60; if (stars.dirty || (warp && stars.t <= 0)) { stars.dirty = false; stars.t = 0.15; refreshStars(); }
    starPts.position.copy(camera.position); Mrot.setFromMatrix3(B); starPts.quaternion.setFromRotationMatrix(Mrot);
    starMat.uniforms.uR.value = camera.far * 0.8; starMat.uniforms.uOp.value = Math.max(0, Math.min(1, darkK * 1.2 - 0.1));
    streaks.position.copy(starPts.position); streaks.quaternion.copy(starPts.quaternion);
    if (warp) {
      const R = camera.far * 0.79;
      for (let k = 0; k < NN; k++) { const i = NBG + k; for (let c = 0; c < 3; c++) { strPos[k * 6 + c] = sPos[i * 3 + c] * R; strPos[k * 6 + 3 + c] = (sPos[i * 3 + c] + (sPos[i * 3 + c] - stars.prev[k * 3 + c]) * -6) * R; } }
      streakGeo.attributes.position.needsUpdate = true; streaks.material.opacity = Math.min(0.9, warp.k * 3);
    } else streaks.material.opacity = 0;
  }

  // ---------------- flying
  function env() {
    return {
      S, burn: (th, dt, rhoK) => burn(phys, th, dt, rhoK), fuel: () => fuelState().fuel, hullHeat: phys.heat,
      mass: () => phys.dry + Math.max(0, fuelState().fuel) * phys.unitKg, maxAccel: () => phys.thrust / (phys.dry + Math.max(0, fuelState().fuel) * phys.unitKg),
      spendCruise: (u) => { const F = fuelState(); F.fuel = Math.max(0, F.fuel - u); },
      shipHalf: 1.7 * host.shipScale(),
      groundR: (b, dI) => {
        const W = host.W();
        if (focus && b.addr === focus.addr && W) { const d = toBody(dI); const h = W.heightDir(d); return W.radius + Math.max(h, W.hasSea ? W.sea : -1e9); }
        return b.R; // a world whose terrain is not loaded yet: its datum (it loads well before you get here)
      },
    };
  }
  let E = null;
  let dbgCtl = null;
  function input() {
    if (dbgCtl) return { fwd: 0, side: 0, lift: false, assist, throttle: cruiseThrottle, ...dbgCtl };
    let fwd = 0, side = 0;
    if ((moveKeys.forward || []).some(keyDown)) fwd += 1; if ((moveKeys.back || []).some(keyDown)) fwd -= 1;
    if ((moveKeys.left || []).some(keyDown)) side -= 1; if ((moveKeys.right || []).some(keyDown)) side += 1;
    if (hud.joy && (hud.joy.x || hud.joy.y)) { fwd = hud.joy.y; side = hud.joy.x; }
    if (pad && pad.connected && (pad.move.x || pad.move.y)) { fwd = pad.move.y; side = pad.move.x; }
    const lift = keyDown('Space') || liftBtn || !!(pad && pad.connected && pad.downIdx && pad.downIdx(0));
    return { fwd: Math.max(-1, Math.min(1, fwd)), side, lift, assist, throttle: cruiseThrottle };
  }
  let cruiseThrottle = 1;
  function setLookFromNose() {
    // re-express the look (steering) in the current basis so a change of basis does not turn the ship
    const f = v3(nose).applyMatrix3(B).normalize();
    player.aim(Math.atan2(f.x, f.z), Math.max(-1.42, Math.min(1.42, Math.asin(Math.max(-1, Math.min(1, f.y))))));
  }
  function steer(dt) {
    // where she looks is where the nose goes (turn rate limited)
    const lt = player.lookT || { yaw: player.heading, pitch: player.pitch }, yaw = lt.yaw, pit = lt.pitch;
    const fS = new THREE.Vector3(Math.sin(yaw) * Math.cos(pit), Math.sin(pit), Math.cos(yaw) * Math.cos(pit)).applyMatrix3(Bi).normalize();
    const want = [fS.x, fS.y, fS.z], c = Math.max(-1, Math.min(1, dot3(nose, want))), ang = Math.acos(c), maxA = dt * (st.mode === 'cruise' ? 0.9 : 1.6);
    if (ang < 1e-5) return;
    const k = Math.min(1, maxA / ang);
    const n = nrm([nose[0] + (want[0] - nose[0]) * k, nose[1] + (want[1] - nose[1]) * k, nose[2] + (want[2] - nose[2]) * k]);
    nose[0] = n[0]; nose[1] = n[1]; nose[2] = n[2]; st.nose = nose.slice();
  }
  function updateMode() {
    const W = host.W();
    const dom = st.dom;
    // approaching another landable body: load its terrain while still high above it
    if (dom && dom.landable && (!focus || dom.addr !== focus.addr) && st.alt < Math.max(dom.R * 1.2, 4000) && !warp) {
      host.loadBody(dom, tileUnder(dom)); attach(sys, dom.addr); toastOnce('arrive:' + dom.addr, `${dom.name}: ${dom.rules ? dom.rules.summary() : ''}`);
    }
    const wantSurface = !!(focus && W && dom && dom.addr === focus.addr && st.agl < (space ? 2300 : 2600));
    if (wantSurface && space) {
      // coming down: lay the scene out on the tile under the ship
      const f = inertialToFlat(W, st.p), id = tileOf(W.radius, f.d);
      if (id !== W.frame.id) host.rebase(id);
      space = false;
    } else if (!wantSurface && !space) { space = true; /* B stays what it was this frame: nothing moves */ }
    if (!space && W) {
      const f = inertialToFlat(W, st.p); shipFlat.set(f.x, f.y, f.z);
      // crossing tiles low over the ground: re-base (the next tile is prefetched as she flies)
      if (f.y < 1600) { host.prefetch(f.x, f.z); const id = shouldRebase(W.frame, f.x, f.z); if (id) { host.rebase(id); const g = inertialToFlat(W, st.p); shipFlat.set(g.x, g.y, g.z); } }
    }
    const key = (space ? 'space' : 'surf:' + (W && W.frame.id)) + ':' + (focus && focus.addr);
    if (key !== basisKey) { basisKey = key; return true; }
    return false;
  }
  function tileUnder(b) {
    // the body's arrival-facing orientation is not known until its world is made; the host recomputes
    void b; return null;
  }
  const toasted = new Set();
  function toastOnce(k, msg, ms = 5200) { if (toasted.has(k)) return; toasted.add(k); hud.toast(msg, 'star', ms); }
  function events() {
    for (const e of st.events) {
      if (e === 'landed') { hud.toast(`Down on ${focus ? focus.name : 'the ground'}. ${fuelState().fuel < 1 ? 'The tank is nearly dry: the emergency still refills it slowly.' : ''}`, 'star', 4200); host.onLanded && host.onLanded(); }
      if (e === 'bounce') hud.toast('Too fast: the ship bounced. Use Lift (or let the assist slow you) to come down gently.', 'star', 4200);
      if (e === 'overheat') hud.toast('The hull is glowing: braking. Come in shallower, or slower.', 'star', 4200);
      if (e === 'star') hud.toast('Too close to the star: the ship pulls away.', 'star', 3600);
      if (e === 'giant') hud.toast('A giant has no surface: the pressure pushes the ship back out.', 'star', 4200);
      if (e === 'cruise-off') hud.toast('Cruise off: close to something solid.', 'star', 2600);
    }
    st.events.length = 0;
  }
  // emergency still: an empty tank slowly refills from sunlight and recycled water, enough to reach
  // orbit from wherever she is (no soft lock); scooping ice on an icy or watery world is faster
  function launchNeed() {
    const b = st && st.dom; if (!b) return 1;
    const vOrb = Math.sqrt(b.GM / (b.R + (b.atmTop || 0) * 1.2)), dv = vOrb * 1.35 + (b.atmTop ? 60 : 0);
    const ratio = Math.exp(dv * Math.sqrt(1000) / (phys.isp * 9.80665));
    return Math.min(phys.tank, phys.dry * (ratio - 1) / phys.unitKg * 1.15 + 0.3);
  }
  function emergency(dt) {
    const F = fuelState(); if (warp) return;
    const floor = Math.max(1.2, launchNeed());
    // landed only: out in space an empty tank still drifts the cruise drive along at a tenth of the speed
    if (F.fuel < floor && st.landed) {
      F.fuel = Math.min(floor, F.fuel + dt / 60);
      toastOnce('still:' + Math.floor(Date.now() / 600000), 'The tank is nearly empty: the emergency still is refilling it (about one unit a minute). Scooping ice is faster.', 6000);
    }
    if (scoop && st.landed) { F.fuel = Math.min(phys.tank, F.fuel + dt * 0.12); if (F.fuel >= phys.tank - 0.01) { scoop = false; hud.toast('Tank full of fresh propellant.', 'star', 3000); } }
  }
  const canScoop = () => st && st.landed && focus && focus.rules && (focus.rules.water.ice || focus.rules.water.liquid || focus.rules.water.inventory > 0.3);
  function updateCamera(dt) {
    const W = host.W();
    const dom = st.dom, upI = dom ? nrm(sub(st.p, dom.pos)) : [B.elements[1], B.elements[4], B.elements[7]];
    const sc = host.shipScale(), dist = (st.mode === 'cruise' || warp ? 18 : 13) * sc, h = 4 * sc;
    const want = [-nose[0] * dist + upI[0] * h, -nose[1] * dist + upI[1] * h, -nose[2] * dist + upI[2] * h];
    if (!camOff) camOff = want.slice();
    const k = 1 - Math.exp(-dt * 6); for (let i = 0; i < 3; i++) camOff[i] += (want[i] - camOff[i]) * k;
    const shipS = space ? new THREE.Vector3() : shipFlat.clone();
    const offS = v3(camOff).applyMatrix3(B), upS = v3(upI).applyMatrix3(B).normalize(), nS = v3(nose).applyMatrix3(B).normalize();
    camera.position.copy(shipS).add(offS);
    // never under the ground
    if (!space && W) { const gy = host.ground(camera.position.x, camera.position.z) + 1.2; if (camera.position.y < gy) camera.position.y = gy; }
    camera.up.copy(upS); camera.lookAt(shipS.clone().addScaledVector(nS, 12 * sc));
    // the ship itself
    const ship = host.ship();
    if (ship) {
      ship.position.copy(shipS);
      const z = nS.clone(), y = upS.clone().addScaledVector(z, -upS.dot(z)); if (y.lengthSq() < 1e-4) y.set(0, 1, 0); y.normalize();
      // a saucer: tilt toward the nose a little, keep mostly level with the ground
      const tilt = y.clone().lerp(upS, 0.55).normalize(), x = new THREE.Vector3().crossVectors(tilt, z).normalize(), z2 = new THREE.Vector3().crossVectors(x, tilt);
      ship.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, tilt, z2));
      if (ship.userData.ring) ship.userData.ring.rotation.z += dt * (0.4 + st.thrustA * 0.2);
    }
  }
  // ---------------- warp: a crafted drive, flown through (the stars stream past), from the system edge
  function warpCheck() {
    const tgt = G.universe.nav && parseAddr(G.universe.nav.addr);
    if (!tgt || !sys) return { ok: false, why: 'Choose a star on the nav map first.' };
    const tsys = { g: tgt.g, s: tgt.s, star: tgt.star };
    if (addrKey(tsys) === addrKey(sys)) return { ok: false, why: 'Your target is in this system: cruise there.' };
    if (game.count('device:warp') <= 0) return { ok: false, why: 'Interstellar flight needs a warp coil (craft one at a workbench).' };
    const ly = lyBetween(sys, tsys), stt = shipStats(), gal = intergalactic(sys, tsys);
    if (gal && !stt.void) return { ok: false, why: 'Another galaxy: only a void drive survives the crossing.' };
    if (!gal && ly > stt.jumpLy) return { ok: false, why: `${ly.toFixed(1)} ly is beyond the ${stt.name}'s ${stt.jumpLy} ly warp. Hop through nearer stars.` };
    const cost = jumpCost(ly, { galaxy: gal }) + 2;
    if (len(st.p) < S.edge) return { ok: false, cost, ly, why: `Warp only works past the edge of the system (${(S.edge / AU).toFixed(0)} AU from the star; you are at ${(len(st.p) / AU).toFixed(1)} AU). Cruise outward.` };
    if (fuelState().fuel < cost) return { ok: false, cost, ly, why: `The warp needs ${cost} propellant; the tank holds ${fuelState().fuel.toFixed(1)}.` };
    return { ok: true, cost, ly, tsys };
  }
  function engageWarp() {
    const w = warpCheck(); if (!w.ok) { hud.toast(w.why, 'star', 5200); return; }
    const F = fuelState(); F.fuel -= w.cost; game.save();
    const a = hereGal(), tst = w.tsys.star === 'home' ? { x: 0.5, y: 0.62 } : starAt(w.tsys);
    const gp0 = galaxyPos(sys), gp1 = galaxyPos(w.tsys);
    const dS = [Number(gp1[0] - gp0[0]) + tst.x - a.fx, Number(gp1[1] - gp0[1]) + tst.y - a.fy]; // sectors
    const dur = 14 + 6 * Math.sqrt(w.ly);
    warp = { from: { g: sys.g, s: sys.s, fx: a.fx, fy: a.fy }, to: w.tsys, dS, ly: w.ly, t: 0, dur, k: 0, at: { g: sys.g, s: sys.s, fx: a.fx, fy: a.fy } };
    // turn toward the target star in the system frame (galaxy x -> X, galaxy y -> Z)
    const dl = Math.hypot(dS[0], dS[1]) || 1; const dir = [dS[0] / dl, 0, dS[1] / dl];
    nose[0] = dir[0]; nose[1] = dir[1]; nose[2] = dir[2]; st.nose = nose.slice(); setLookFromNose();
    hud.toast(`Warp engaged: ${w.ly.toFixed(1)} light years. The stars will stream past.`, 'star', 4200);
  }
  function updateWarp(dt) {
    warp.t += dt; const u = Math.min(1, warp.t / warp.dur), e = u * u * (3 - 2 * u); warp.k = Math.sin(Math.PI * u);
    const fx = warp.from.fx + warp.dS[0] * e, fy = warp.from.fy + warp.dS[1] * e;
    const ix = Math.floor(fx), iy = Math.floor(fy);
    warp.at = { g: warp.from.g, s: [warp.from.s[0] + BigInt(ix), warp.from.s[1] + BigInt(iy)], fx: fx - ix, fy: fy - iy };
    st.cruiseV = warp.ly * LY / warp.dur * 1.6 * warp.k;
    if (u >= 1) {
      // arrival at the target system's edge, on the side we came from, cruising in
      const dl = Math.hypot(warp.dS[0], warp.dS[1]) || 1, back = [-warp.dS[0] / dl, 0, -warp.dS[1] / dl];
      const to = warp.to; warp = null;
      S = systemOf(to); sys = S.sys; G.universe.at = addrKey(sys);
      st.p = [back[0] * S.edge * 0.93, 0, back[2] * S.edge * 0.93]; st.v = [-back[0] * 2e5, 0, -back[2] * 2e5]; st.mode = 'cruise';
      nose[0] = -back[0]; nose[1] = 0; nose[2] = -back[2]; st.nose = nose.slice();
      if (focus && !S.bodies.some((b) => b.addr === focus.addr)) focus = null;
      rebuildViews(); stars.dirty = true; game.save();
      hud.toast(`${S.star.name}. ${S.bodies.length} worlds circle it. Cruise in (or pick one on the nav map).`, 'star', 6000);
    }
  }
  // ---------------- actions
  function act(a) {
    if (!active) return;
    if (a === 'cruise') {
      if (st.landed) { hud.toast('Lift off first.', 'star', 2200); return; }
      if (st.mode === 'cruise') { st.mode = 'flight'; const sp = len(st.v), dm = st.dom, cap = dm && dm.GM ? Math.min(260, 0.6 * Math.sqrt(dm.GM / len(sub(st.p, dm.pos)))) : 260; if (sp > cap) st.v = st.v.map((x) => x * cap / sp); hud.toast('Cruise off.', 'star', 1800); return; }
      const dom = st.dom, inAir = dom && dom.atmTop && st.alt < dom.atmTop * 1.05;
      if (inAir) { hud.toast('Cruise only works above the air.', 'star', 2600); return; }
      if (nearestSurface(S, st.p).d < 250) { hud.toast('Too close for cruise: climb 250 m above the ground (or the top of the air).', 'star', 2600); return; }
      st.mode = 'cruise'; hud.toast(fuelState().fuel > 0 ? 'Cruise: speed builds the further you are from anything solid. W / S set the throttle.' : 'Cruise on an empty tank: drifting at a tenth of the speed.', 'star', 3600); return;
    }
    if (a === 'align') { const t = targetPos(); if (!t) { hud.toast('No target: pick one on the nav map.', 'star', 2400); return; } const d = nrm(sub(t, st.p)); nose[0] = d[0]; nose[1] = d[1]; nose[2] = d[2]; st.nose = nose.slice(); setLookFromNose(); return; }
    if (a === 'warp') { engageWarp(); return; }
    if (a === 'scoop') { if (!canScoop()) { hud.toast('Nothing to scoop here: land on a world with ice or water.', 'star', 3000); return; } scoop = !scoop; hud.toast(scoop ? 'Scooping ice into the tank...' : 'Scoop stopped.', 'star', 2400); return; }
    if (a === 'beacons') { toggleMenu(); return; }
    if (a === 'map') { host.openNav(); return; }
    if (a === 'leave') { if (!st.landed) { hud.toast('Land first: you can only step out on the ground.', 'star', 2600); return; } leave(); }
  }
  function toggleMenu(force) {
    const m = $('.menu'), on = force != null ? force : !m.classList.contains('on');
    m.classList.toggle('on', on); if (!on) return;
    const list = host.beacons();
    m.innerHTML = `<div style="font-weight:600">Fast travel</div><div style="opacity:.75;font-size:12px;margin-top:2px">Only from inside the ship, only to beacons you placed yourself (${host.fastCost()} propellant).</div>` +
      (list.length ? list.map((b, i) => `<button data-b="${i}">${b.name}${b.here ? ' (here)' : ''}</button>`).join('') : '<div style="margin-top:8px;opacity:.85">No beacons yet. Craft a beacon at a workbench and plant it beside your ship where you want to come back to.</div>') +
      '<button data-b="x">Close</button>';
    m.querySelectorAll('[data-b]').forEach((b) => b.addEventListener('click', () => { if (b.dataset.b === 'x') { toggleMenu(false); return; } toggleMenu(false); host.fastTravel(list[+b.dataset.b]); }));
  }
  function onKey(e) {
    if (!active || e.repeat || (e.target && /INPUT|TEXTAREA/.test(e.target.tagName))) return;
    const k = e.code;
    if (k === 'KeyC') act('cruise'); else if (k === 'KeyT') act('align'); else if (k === 'KeyJ') act('warp'); else if (k === 'KeyF') act('beacons');
    else if (k === 'KeyM') act('map'); else if (k === 'KeyE' || k === 'Enter') act('leave'); else if (k === 'KeyX') act('scoop');
    else if (k === 'KeyH') { assist = !assist; hud.toast(assist ? 'Landing assist on.' : 'Landing assist off.', 'star', 1800); }
    else if (k === 'Digit1' || k === 'Digit2' || k === 'Digit3' || k === 'Digit4') { cruiseThrottle = { Digit1: 0.25, Digit2: 0.5, Digit3: 0.75, Digit4: 1 }[k]; }
  }
  addEventListener('keydown', onKey);
  function targetPos() {
    const n = G.universe.nav; if (!n || !S) return null;
    const a = parseAddr(n.addr); if (!a) return null;
    if (addrKey({ g: a.g, s: a.s, star: a.star }) === addrKey(sys)) {
      if (a.planet == null) return [0, 0, 0];
      const b = S.bodies.find((x) => x.addr === n.addr); return b ? b.pos : null;
    }
    // another system: its star's direction, far out
    const h = hereGal(), tst = a.star === 'home' ? { x: 0.5, y: 0.62 } : starAt(a); if (!h || !tst) return null;
    const g0 = galaxyPos({ g: h.g, s: h.s }), g1 = galaxyPos(a);
    const dx = (Number(g1[0] - g0[0]) + tst.x - h.fx) * SECTOR_LY * LY, dz = (Number(g1[1] - g0[1]) + tst.y - h.fy) * SECTOR_LY * LY;
    return [st.p[0] + dx, st.p[1], st.p[2] + dz];
  }
  // ---------------- HUD
  function updateHud() {
    const F = fuelState(), r = readout(phys, st.g || 9.81), dom = st.dom;
    const mode = warp ? 'Warp' : st.landed ? 'Landed' : st.mode === 'cruise' ? (st.drift ? 'Cruise (drifting)' : 'Cruise') : dom && dom.atmTop && st.alt < dom.atmTop ? 'Atmosphere' : dom ? 'Orbit / space' : 'Interplanetary';
    $('.mode').textContent = mode + (dom ? ' · ' + dom.name : S ? ' · ' + S.star.name : '');
    const sp = warp ? st.cruiseV : len(st.v);
    $('.big').textContent = fmtV(sp);
    $('.sub').textContent = warp ? `${(warp.ly * (1 - warp.t / warp.dur)).toFixed(1)} ly to go` : dom && st.agl < 1e6 ? `altitude ${fmtD(Math.max(0, st.agl))}${st.vUp ? ` · ${st.vUp > 0 ? '+' : ''}${st.vUp.toFixed(0)} m/s up` : ''}` : S ? `${(len(st.p) / AU).toFixed(2)} AU from ${S.star.name}` : '';
    $('.fu').textContent = `${F.fuel.toFixed(1)} / ${phys.tank}`;
    $('.bar.fuel i').style.width = Math.max(0, Math.min(100, F.fuel / phys.tank * 100)) + '%';
    $('.dv').textContent = `Δv ${Math.round(r.dv)} m/s · thrust/weight ${r.twr.toFixed(2)}${phys.from === 'rocket' ? ' · your rocket\'s engine' : ''}`;
    $('.bar.heat i').style.width = Math.min(100, st.heat * 70) + '%';
    $('.glow').style.opacity = Math.max(0, Math.min(1, (st.heat - 0.4) * 1.2));
    const n = G.universe.nav, t = targetPos();
    if (n && t) {
      const tb = S.bodies.find((x) => x.addr === n.addr), d = Math.max(0, len(sub(t, st.p)) - (tb ? tb.R : 0)); $('.nav').textContent = `Target: ${n.name} · ${fmtReal(d)}`;
      const sv = sceneOf(t, new THREE.Vector3()); const pv = sv.clone().project(camera); const m = $('.tgt');
      const behind = sv.clone().sub(camera.position).dot(camera.getWorldDirection(new THREE.Vector3())) < 0;
      if (!behind && Math.abs(pv.x) < 1.2 && Math.abs(pv.y) < 1.2) { m.style.display = 'block'; m.style.left = ((pv.x + 1) / 2 * innerWidth) + 'px'; m.style.top = ((1 - pv.y) / 2 * innerHeight) + 'px'; m.querySelector('b').textContent = `${n.name} ${fmtReal(d)}`; } else m.style.display = 'none';
    } else { $('.nav').textContent = 'No target (nav map)'; $('.tgt').style.display = 'none'; }
    const w = S ? warpCheck() : { ok: false };
    btn('warp').hidden = !(game.count('device:warp') > 0 && n && w.why !== 'Your target is in this system: cruise there.');
    btn('warp').classList.toggle('hot', !!w.ok);
    btn('scoop').hidden = !canScoop(); btn('scoop').classList.toggle('hot', scoop);
    btn('cruise').classList.toggle('hot', st.mode === 'cruise');
    btn('leave').hidden = !st.landed; btn('lift').hidden = st.mode === 'cruise' || !!warp;
    $('.hint').textContent = host.P.cls === 'pc' ? 'Mouse steers · W thrust · S brake · Space lift · A/D strafe · C cruise (1-4 throttle) · T face target · J warp · F beacons · M map · E leave' : 'Drag to steer · stick: thrust / brake · buttons on the right';
  }
  // ---------------- board / leave
  function board() {
    const W = host.W(); if (!W || !focus) { hud.toast('The ship can\'t find where it is.', 'star', 3000); return false; }
    phys = shipPhysics();
    const sAt = host.shipAt();
    const p = flatToInertial(W, sAt.x, sAt.y - 1.6 * host.shipScale() + 1.7 * host.shipScale(), sAt.z);
    st = createFlightState(p, [0, 0, 0], nrm(sub(p, focus.pos)));
    st.landed = true; st.mode = 'landed'; st.dom = focus;
    // nose: level, the way she was facing
    const f = inertialToFlat(W, st.p); surfaceBasis(W, f.x, f.z, f.d, B); Bi.copy(B).invert();
    const yaw = player.heading, fS = new THREE.Vector3(Math.sin(yaw), 0.25, Math.cos(yaw)).normalize().applyMatrix3(Bi).normalize();
    nose[0] = fS.x; nose[1] = fS.y; nose[2] = fS.z; st.nose = nose.slice();
    active = true; space = false; camOff = null; basisKey = '';
    core.cinematic = true; ui.classList.add('on'); hud.showMap && hud.showMap(false);
    shipFlat.set(f.x, f.y, f.z);
    setLookFromNose();
    const F = fuelState(); const loaded = host.refuel(); if (loaded) hud.toast(`Loaded ${loaded} propellant from your bag.`, 'star', 2600);
    hud.toast(`At the helm of the ${phys.name}. Space lifts off; W thrusts where you look.${F.fuel < 1 ? ' The tank is almost empty.' : ''}`, 'star', 5200);
    return true;
  }
  function leave() {
    const W = host.W(); if (!W) return;
    const f = inertialToFlat(W, st.p);
    active = false; scoop = false; ui.classList.remove('on'); toggleMenu(false);
    host.parkAt(f.x, f.z, Math.atan2(-nose[0], -nose[2]));
    host.stepOut();
    core.cinematic = false; camera.up.set(0, 1, 0);
    G.universe.flight = null; game.save();
  }
  // drop out of the helm without parking (fast travel: the world is about to change under her)
  function abort() { active = false; scoop = false; warp = null; ui.classList.remove('on'); toggleMenu(false); core.cinematic = false; camera.up.set(0, 1, 0); G.universe.flight = null; }
  // resume or hand over a flight (from a save / fast travel)
  function restore(fl) {
    if (!fl || !fl.p) return false;
    const W = host.W(); if (!W || !focus) return false;
    phys = shipPhysics();
    st = createFlightState(fl.p, fl.v || [0, 0, 0], fl.nose || [0, 1, 0]); st.mode = fl.mode === 'cruise' ? 'cruise' : 'flight';
    nose[0] = st.nose[0]; nose[1] = st.nose[1]; nose[2] = st.nose[2];
    active = true; space = true; camOff = null; basisKey = ''; core.cinematic = true; ui.classList.add('on');
    stepOnce(0.001);
    setLookFromNose();
    return true;
  }
  function stepOnce(dt) {
    if (!E) E = env(); E.S = S; E.navAddr = G.universe.nav ? G.universe.nav.addr : null;
    const ctl = input();
    if (!warp) {
      const n = Math.max(1, Math.ceil(dt / 0.02)), h = dt / n;
      for (let i = 0; i < n; i++) stepFlight(st, ctl, h, E);
    }
  }
  return {
    attach, board, leave, restore, abort, qFor,
    get active() { return active; }, get space() { return space; }, get state() { return st; }, get system() { return S; }, get focus() { return focus; },
    get warping() { return !!warp; },
    // planet world asks: where is the point the terrain should stream around
    focusPoint() { return shipFlat; },
    // altitude of the camera above the loaded world's surface (for the sky / fog / globe fade)
    camAlt() { if (!active) return null; return st.agl; },
    darkness(alt, sunY) { return Math.max(Math.min(1, alt / 1500), Math.max(0, Math.min(1, (0.08 - sunY) * 4))); },
    update(dt, darkK) {
      if (active) {
        if (warp) updateWarp(dt);
        else {
          steer(dt);
          stepOnce(dt);
          events();
          emergency(dt);
        }
        const changed = updateMode();
        if (changed) setLookFromNose();
        if (!space && host.W()) { const W = host.W(); const f = inertialToFlat(W, st.p); surfaceBasis(W, f.x, f.z, f.d, B); }
        Bi.copy(B).invert();
        updateCamera(dt);
        if ((ui._t = (ui._t || 0) + dt) > 0.1) { ui._t = 0; updateHud(); }
        G.universe.flight = { p: st.p.slice(), v: st.v.slice(), nose: nose.slice(), mode: st.mode, sys: sys ? addrKey(sys) : null, focus: focus ? focus.addr : null };
      }
      updateSky(darkK);
    },
    surfaceTile() { const W = host.W(); if (!W || !st) return null; return tileOf(W.radius, inertialToFlat(W, st.p).d); },
    debug: {
      set(o) { if (o.p) st.p = o.p.slice(); if (o.v) st.v = o.v.slice(); if (o.mode) st.mode = o.mode; if (o.nose) { const n = nrm(o.nose); nose[0] = n[0]; nose[1] = n[1]; nose[2] = n[2]; st.nose = nose.slice(); setLookFromNose(); } if (o.landed != null) st.landed = o.landed; return true; },
      warp: engageWarp, warpCheck, act, get warp() { return warp; }, sceneOf: (X) => sceneOf(X, new THREE.Vector3()), get basisKey() { return basisKey; },
      bodies: () => S && S.bodies.map((b) => ({ name: b.name, addr: b.addr, pos: b.pos, R: b.R, landable: b.landable })),
      targetPos, ctl(o) { dbgCtl = o; }, state: () => st && { mode: st.mode, landed: st.landed, alt: st.alt, agl: st.agl, v: len(st.v), vUp: st.vUp, heat: st.heat, dom: st.dom && st.dom.name, focus: focus && focus.name, space, fuel: fuelState().fuel, cruiseV: st.cruiseV, p: st.p },
    },
  };
}
