// The salt cove and the sea cave (geometry in js/cove.js): the carved bank and bed, the still water you
// can swim and dive in (water/ocean.js: buoyancy, breath, splashes), the headland stone with its tunnel
// and air chamber, daylight through a crack in the roof, and a few things on the shore (driftwood, reeds,
// a group of three stones). Art bible: river-stone shapes, muted stone and salt, shadows ink not black.
//   const cove = createCove({ scene, camera, hud, lite })
//   cove.env(base)  -> { top, solid, liquid } for the walker (wraps the world's own ground)
//   cove.update(dt, player)
import * as THREE from 'three';
import { COVE, HEAD, CHAMBER, TUNNEL, LEDGE, CRACK, HOLE_C, holeR, shoreR, shoreline, coveGround, coveTop, coveSolid, wet, DRIFT, REEDS } from '../cove.js';
import { createSeaLife } from './water/sealife.js';
import { createOcean, createUnderwater } from './water/ocean.js';
import { createSwimHud } from './water/swim-hud.js';

export function createCove({ scene, camera, hud, lite = false }) {
  const root = new THREE.Group(); root.name = 'cove'; scene.add(root);
  // ---- bank and bed: a polar grid over the carved hole (js/cove.js holeOutline), heights from coveGround
  //      (lawn level where the hole is only there for the headland's footprint)
  {
    const NA = lite ? 96 : 160, NR = lite ? 26 : 40, pos = [], col = [], idx = [];
    const cBank = new THREE.Color('#b3a891'), cWet = new THREE.Color('#857b6a'), cDeep = new THREE.Color('#57544c'), c = new THREE.Color();
    const HR = Array.from({ length: NA }, (_, i) => holeR((i / NA) * Math.PI * 2) + 0.3);
    for (let j = 0; j <= NR; j++) for (let i = 0; i < NA; i++) {
      const th = (i / NA) * Math.PI * 2, r = HR[i] * Math.pow(j / NR, 0.8);
      const x = HOLE_C.x + Math.sin(th) * r, z = HOLE_C.z + Math.cos(th) * r;
      const y = j === NR ? -0.004 : Math.min(-0.004, coveGround(x, z) ?? -0.004);
      pos.push(x, y, z);
      const dep = COVE.sea - y; c.copy(cBank).lerp(cWet, Math.min(1, Math.max(0, (0.25 - y) / 0.5))).lerp(cDeep, Math.min(1, Math.max(0, dep / 3)));
      col.push(c.r, c.g, c.b);
    }
    for (let j = 0; j < NR; j++) for (let i = 0; i < NA; i++) { const a = j * NA + i, b = j * NA + (i + 1) % NA, d = (j + 1) * NA + i, e = (j + 1) * NA + (i + 1) % NA; idx.push(a, d, b, b, d, e); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 })); m.receiveShadow = true; m.name = 'cove-bed'; root.add(m);
  }
  // ---- stone: one material family; the cave pieces cut themselves away where the tunnel and chamber are
  const cut = (mat, mode) => {
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = 'varying vec3 vCW;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n vCW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = 'varying vec3 vCW;\n' + sh.fragmentShader.replace('void main() {', `void main() {
        bool inTun = vCW.z < ${TUNNEL.z0.toFixed(2)} + 0.02 && vCW.z > ${TUNNEL.z1.toFixed(2)} && length(vCW.xy - vec2(${TUNNEL.x.toFixed(2)}, ${TUNNEL.y.toFixed(2)})) < ${TUNNEL.r.toFixed(2)} - 0.01;
        bool inCh = length(vCW - vec3(${CHAMBER.x.toFixed(2)}, ${CHAMBER.y.toFixed(2)}, ${CHAMBER.z.toFixed(2)})) < ${CHAMBER.r.toFixed(2)} - 0.01;
        bool inCr = length(vCW.xz - vec2(${CRACK.x.toFixed(2)}, ${CRACK.z.toFixed(2)})) < ${CRACK.r.toFixed(2)} && vCW.y > ${CHAMBER.y.toFixed(2)};
        ${mode === 'head' ? 'if (inTun || inCr) discard;' : mode === 'chamber' ? 'if (inTun || inCr) discard;' : 'if (inCh) discard;'}`);
    };
    mat.customProgramCacheKey = () => 'cove-' + mode;
    return mat;
  };
  const stoneCol = new THREE.Color('#8b867c'), dampCol = new THREE.Color('#6e6a62');
  // the headland: an elliptic river stone (lathe: straight sides under 'base', then a dome), a little uneven
  {
    const pts = [new THREE.Vector2(HEAD.R, HEAD.floor), new THREE.Vector2(HEAD.R, HEAD.base)];
    for (let i = 1; i <= 14; i++) { const e = HEAD.R * (1 - i / 14); pts.push(new THREE.Vector2(Math.max(0.001, e), HEAD.base + (HEAD.top - HEAD.base) * Math.pow(1 - (e / HEAD.R) ** 2, 0.4545))); }
    const g = new THREE.LatheGeometry(pts, lite ? 40 : 72); const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i), a = Math.atan2(x, z);
      const n = 0.2 * Math.sin(a * 3 + y * 0.9) + 0.1 * Math.sin(a * 7 - y * 1.7) + 0.06 * Math.sin(a * 13 + y * 3.1); const rr = Math.hypot(x, z) || 1, k = (rr + n * (y > HEAD.base ? Math.min(1, rr / 2) : 1)) / rr;
      p.setXYZ(i, x * k * HEAD.sx, y, z * k);
    }
    g.computeVertexNormals();
    // colour: warm grey stone, dark and damp below the tide line, pale salt crust just above it, ochre lichen on top
    const cs = [], c = new THREE.Color(), base = new THREE.Color('#948c7f'), damp = new THREE.Color('#5f5a52'), salt = new THREE.Color('#bdb4a3'), lichen = new THREE.Color('#9a8a5e');
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i), n = Math.sin(x * 1.3 + z * 0.7) * 0.5 + Math.sin(x * 3.1 - z * 2.3 + y) * 0.5;
      c.copy(base).offsetHSL(0, 0, n * 0.03);
      if (y < COVE.sea + 0.15) c.lerp(damp, 0.85); else if (y < COVE.sea + 0.5) c.lerp(salt, 0.55 * (1 - (y - COVE.sea - 0.15) / 0.35));
      if (y > 2.4 && n > 0.25) c.lerp(lichen, Math.min(0.6, (n - 0.25) * 1.4));
      cs.push(c.r, c.g, c.b);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(cs, 3));
    const mat = cut(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88 }), 'head');
    const m = new THREE.Mesh(g, mat); m.position.set(HEAD.x, 0, HEAD.z); m.castShadow = m.receiveShadow = true; m.name = 'headland'; root.add(m);
  }
  // the chamber (we see its inside), the tunnel (inside too) and the shelf at the back
  {
    const ch = new THREE.Mesh(new THREE.SphereGeometry(CHAMBER.r, lite ? 32 : 48, lite ? 20 : 32), cut(new THREE.MeshStandardMaterial({ color: dampCol, roughness: 0.8, side: THREE.BackSide }), 'chamber'));
    ch.position.set(CHAMBER.x, CHAMBER.y, CHAMBER.z); ch.receiveShadow = true; root.add(ch);
    const len = TUNNEL.z0 - TUNNEL.z1, tg = new THREE.CylinderGeometry(TUNNEL.r, TUNNEL.r, len, 24, 6, true).rotateX(Math.PI / 2);
    const tu = new THREE.Mesh(tg, cut(new THREE.MeshStandardMaterial({ color: dampCol, roughness: 0.85, side: THREE.BackSide }), 'tunnel'));
    tu.position.set(TUNNEL.x, TUNNEL.y, (TUNNEL.z0 + TUNNEL.z1) / 2); root.add(tu);
    // the shelf: the chamber's cross-section behind the line z = cz + dz, from the floor up to LEDGE.top
    const rr = Math.sqrt(CHAMBER.r ** 2 - (LEDGE.top - CHAMBER.y) ** 2), sh = new THREE.Shape(), z0 = LEDGE.dz;
    const a0 = Math.acos(Math.max(-1, Math.min(1, z0 / rr)));
    sh.moveTo(Math.sin(a0) * rr, z0); for (let i = 1; i <= 24; i++) { const a = a0 + (i / 24) * (2 * Math.PI - 2 * a0); sh.lineTo(Math.sin(a) * rr, Math.cos(a) * rr); }
    const lg = new THREE.ExtrudeGeometry(sh, { depth: 4.6, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.06, bevelSegments: 2 }).rotateX(Math.PI / 2);
    const le = new THREE.Mesh(lg, new THREE.MeshStandardMaterial({ color: '#7a756b', roughness: 0.92 })); le.position.set(CHAMBER.x, LEDGE.top - 0.08, CHAMBER.z); le.receiveShadow = true; root.add(le);
    // an old shell on the shelf (where the pearl was), and a crust of pale crystal on the back wall
    const shell = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#cfc6b4', roughness: 0.6 })); shell.scale.set(1, 0.35, 1.2); shell.position.set(CHAMBER.x + 0.5, LEDGE.top + 0.01, CHAMBER.z - 2.5); root.add(shell);
    for (let i = 0; i < 5; i++) { const cr = new THREE.Mesh(new THREE.OctahedronGeometry(0.09 + i * 0.02, 0), new THREE.MeshStandardMaterial({ color: '#c9cdd0', roughness: 0.25, metalness: 0.0 })); cr.position.set(CHAMBER.x - 0.6 + i * 0.25, LEDGE.top + 0.25 + (i % 2) * 0.12, CHAMBER.z - 3.2 + Math.abs(i - 2) * 0.06); cr.rotation.set(i, i * 2, 0.3); cr.scale.y = 1.6; root.add(cr); }
  }
  // daylight through the crack: a soft beam and the warm patch it makes on the shelf (no real lights: two more
  // lights would recompile and cost every material in the garden). It follows the sun's height a little.
  const beamTo = new THREE.Vector3(CHAMBER.x + 0.15, LEDGE.top + 0.01, CHAMBER.z - 2.0), beamFrom = new THREE.Vector3(CRACK.x, CHAMBER.y + CHAMBER.r - 0.2, CRACK.z);
  const bl = beamFrom.distanceTo(beamTo), beamG = new THREE.CylinderGeometry(CRACK.r * 0.8, 0.42, bl, 24, 1, true); beamG.translate(0, -bl / 2, 0);
  // the beam is dust in the air, not a solid: faint, brightest at the crack, thinning toward the shelf, and soft at
  // its edges (seen side-on it fades out; only looking through its core does it read)
  const beamM = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide, fog: false,
    uniforms: { uCol: { value: new THREE.Color('#f3e6cc') }, uK: { value: 0.11 } },
    vertexShader: 'varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'uniform vec3 uCol; uniform float uK; varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ float edge = pow(abs(dot(normalize(vN), normalize(vV))), 2.2); float along = mix(0.35, 1.0, smoothstep(0.0, 1.0, vUv.y)); gl_FragColor = vec4(uCol * uK * edge * along, 1.0); }' });
  const beam = new THREE.Mesh(beamG, beamM); beam.position.copy(beamFrom); beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), beamTo.clone().sub(beamFrom).normalize()); root.add(beam);
  const patch = new THREE.Mesh(new THREE.CircleGeometry(0.45, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffe7bf', transparent: true, opacity: 0.12, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  patch.position.copy(beamTo); patch.scale.set(1, 1, 1.4); root.add(patch);
  // ---- the water: cove + chamber surfaces, moving with the shared wave model
  const waterMat = new THREE.MeshStandardMaterial({ color: '#3d5c61', roughness: 0.08, metalness: 0, transparent: true, opacity: 0.8 });
  const wg = (() => { const s = new THREE.Shape(); shoreline(120, 0.25).forEach(([x, z], i) => (i ? s.lineTo(x - COVE.x, -(z - COVE.z)) : s.moveTo(x - COVE.x, -(z - COVE.z)))); const g = new THREE.ShapeGeometry(s, 24); g.rotateX(-Math.PI / 2); g.translate(COVE.x, 0, COVE.z); return g; })();
  const water = new THREE.Group(); water.name = 'cove-water';
  const wm = new THREE.Mesh(wg, waterMat); wm.position.y = COVE.sea; wm.renderOrder = 2; water.add(wm);
  const cr = Math.sqrt(CHAMBER.r ** 2 - (COVE.sea - CHAMBER.y) ** 2), cw = new THREE.Mesh(new THREE.CircleGeometry(cr, 40).rotateX(-Math.PI / 2), waterMat);
  cw.position.set(CHAMBER.x, COVE.sea, CHAMBER.z); water.add(cw); root.add(water);
  const ocean = createOcean({ scene, camera, water, waterMat, lite });
  ocean.load({ hasSea: true, sea: COVE.sea, seed: 11, gravity: 9.81, rules: { water: { liquid: true, inventory: 0.9 }, temperature: { meanC: 14 }, biology: { animals: 0.4, plants: 0.3 }, atmosphere: { pressureKPa: 101.325, breathable: true } } });
  ocean.waves.setWind(1.2, 0.6);
  // fish: a few small schools that keep to the deep water, scatter when you swim at them, and remember where
  // they were chased (water/sealife.js boids). Outside the cove the 'bed' is above the sea, so they turn back.
  const SEA_W = { seed: 11, rules: { temperature: { meanC: 14 }, gravity: 9.81, biology: { animals: true, plants: true, pigment: 'green', sizeK: 0.6 } } };
  const life = createSeaLife({ scene, ocean, lite, ground: (x, z) => { const g = coveGround(x, z); return g == null ? COVE.sea + 0.6 : g; } });
  life.load(SEA_W, 'cove', {});
  const swimHud = createSwimHud(hud), under = createUnderwater();
  let dry = null;
  let sunL = null, hemiL = null; scene.traverse((o) => { if (o.isDirectionalLight && !sunL) sunL = o; if (o.isHemisphereLight && !hemiL) hemiL = o; });
  let caveK = 0; const caveHold = [];
  const holdOf = (o, k) => { if (o && typeof o[k] === 'number') caveHold.push({ o, k, base: o[k], set: null }); };
  holdOf(sunL, 'intensity'); holdOf(hemiL, 'intensity'); holdOf(scene, 'environmentIntensity');
  const waterCol = new THREE.Color('#3f6a70');
  // ---- the shore: driftwood on the north beach, reeds on the west bank, three stones (5:3:2) by the headland
  const wood = new THREE.MeshStandardMaterial({ color: '#8d8272', roughness: 0.9 }), reedM = new THREE.MeshStandardMaterial({ color: '#8f8a5c', roughness: 0.85 }), rockM = new THREE.MeshStandardMaterial({ color: '#7f7b72', roughness: 0.9 });
  for (const { th, L, r, x, z } of DRIFT) { const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, L, 4, 8), wood); m.rotation.set(Math.PI / 2, 0, th + 1.2); m.position.set(x, (coveGround(x, z) ?? 0) + r * 0.8, z); m.castShadow = true; root.add(m); }
  for (const { x: x0, z: z0 } of REEDS) { for (let k = 0; k < 9; k++) { const h = 0.9 + ((k * 37) % 7) * 0.08, m = new THREE.Mesh(new THREE.ConeGeometry(0.025, h, 4), reedM); const x = x0 + Math.sin(k * 2.4) * 0.5, z = z0 + Math.cos(k * 2.4) * 0.5; m.position.set(x, (coveGround(x, z) ?? 0) + h / 2 - 0.05, z); m.rotation.z = Math.sin(k) * 0.08; root.add(m); } }
  for (const [dx, dz, s] of [[-8.8, 2.8, 1.0], [-7.4, 4.1, 0.6], [-9.7, 4.4, 0.4]]) { const m = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 1), rockM); m.scale.set(1.25, 0.7, 1); m.position.set(HEAD.x + dx, s * 0.45, HEAD.z + dz); m.castShadow = m.receiveShadow = true; root.add(m); }
  // ink shadows, not sky-blue ones (art bible): the photo sky lights the shade blue, so the cove's stone and
  // wood take less of it and keep a little warm light of their own
  root.traverse((o) => { const m = o.isMesh && o.material; if (m && m.isMeshStandardMaterial && !m.transparent) { m.envMapIntensity = 0.2; if (m.emissive) m.emissive.set('#1c1812'); } });
  // ---- the walker's view of all this
  function env(base = {}) {
    const g0 = base.ground || (() => 0);
    return {
      top: (x, z, y) => coveTop(x, z, y, base.top ? base.top(x, z, y) : g0(x, z)),
      solid: (x, y, z) => coveSolid(x, y, z) || (base.solid ? base.solid(x, y, z) : false),
      liquid: (x, z) => (wet(x, z) ? ocean.liquid(x, z) : null),
    };
  }
  return {
    env, ocean, root, life,
    update(dt, player) {
      if (!player) return;
      for (const h of caveHold) { if (h.set !== null && h.o[h.k] === h.set) h.o[h.k] = h.base; h.set = null; } // undo last frame's cave dimming first
      const p = player.position, near = Math.hypot(p.x - COVE.x, p.z - COVE.z) < 60;
      root.visible = true;
      if (!near) { if (dry) { if (hemiL && hemiL.intensity === dry.hemiSet) hemiL.intensity = dry.hemi; if (scene.fog && scene.fog.density === dry.fogSet) scene.fog.density = dry.fog; dry = null; } under.apply({ depth: 0, liquid: null, scene, fog: scene.fog }); swimHud.update(null, 0); return; }
      ocean.update(dt, { wind: [1.0, 0.6], swimmers: [{ id: 'me', x: p.x, y: p.y, z: p.z, yaw: player.heading || 0, swimming: player.swimming, headUnder: !!(player.swim && player.swim.headUnder), strokes: player.swim ? player.swim.strokes : 0, impact: player.water ? player.water.entry : 0 }] });
      const cx = camera.position.x, cz = camera.position.z, d = wet(cx, cz) ? (ocean.surfaceAt(cx, cz) ?? COVE.sea) - camera.position.y : 0;
      // apply() scales the hemisphere light and sets the fog density every frame it is under; the garden only
      // resets those when its time of day changes, so hold the dry values and put them back each frame/on surfacing
      if (dry && hemiL && hemiL.intensity === dry.hemiSet) hemiL.intensity = dry.hemi;
      if (dry && scene.fog && scene.fog.density === dry.fogSet) scene.fog.density = dry.fog;
      const pre = { hemi: hemiL ? hemiL.intensity : 0, fog: scene.fog ? scene.fog.density : 0 };
      const k = under.apply({ depth: d, liquid: ocean.liquidInfo, waterColor: waterCol, fog: scene.fog, scene, sun: sunL, hemi: hemiL, sky: null, sunK: 1 });
      dry = under.on ? { ...pre, hemiSet: hemiL ? hemiL.intensity : 0, fogSet: scene.fog ? scene.fog.density : 0 } : null;
      // inside the chamber and the tunnel the sky can't reach: daylight only through the crack. Ease the sun,
      // the sky fill and the sky reflections down while the camera is in there (restored at the top of the next frame)
      const c = camera.position, inCave = Math.hypot(c.x - CHAMBER.x, c.y - CHAMBER.y, c.z - CHAMBER.z) < CHAMBER.r - 0.05
        || (c.z < TUNNEL.z0 && c.z > TUNNEL.z1 && Math.hypot(c.x - TUNNEL.x, c.y - TUNNEL.y) < TUNNEL.r);
      caveK += ((inCave ? 1 : 0) - caveK) * Math.min(1, dt * 2.5);
      const f = 1 - 0.72 * caveK;
      for (const h of caveHold) { h.base = h.o[h.k]; if (f < 0.995) { h.o[h.k] = h.base * f; h.set = h.o[h.k]; } else h.set = null; }
      swimHud.update(player, k);
      life.update(dt, { player, camera });
    },
  };
}
