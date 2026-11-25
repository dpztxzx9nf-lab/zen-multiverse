// A gentle stylized gardener (~1.65 m to the top of the head, plus a straw sun hat).
// Built from smooth lathe/capsule parts with a simple bone hierarchy so it can walk, kneel, water,
// prune, toss koi food and hold a rake. No face details on purpose (calm, storybook look).
//   const c = createCharacter({ palette }); scene.add(c.group);
//   c.update(dt, { speed, airborne, gesture, gestureT })   speed in m/s
import * as THREE from 'three';
import { mergeGeometries } from '../util.js';

const V = (x, y) => new THREE.Vector2(x, y);
export const PALETTE = {
  skin: '#e7b99b', hair: '#5a4131', top: '#c4857a', topDark: '#a96a61', trousers: '#5d6f8c', boots: '#4d3527',
  apron: '#d9c49a', apronDark: '#b9a070', eye: '#2b2120', blush: '#ec9c92',
  hat: '#dcc28c', band: '#7c5b8c', can: '#6f8f9a', wood: '#9b7650', metal: '#8f8a82',
};

function mat(color, rough = 0.85, extra = {}) { return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0, ...extra }); }
function capsule(r, len, seg = 10) { return new THREE.CapsuleGeometry(r, len, 4, seg); }
function mesh(g, m, shadow = true) { const o = new THREE.Mesh(g, m); o.castShadow = shadow; o.receiveShadow = true; return o; }

export function buildRake() {
  const g = new THREE.Group();
  const wood = mat(PALETTE.wood, 0.7);
  const handle = mesh(new THREE.CylinderGeometry(0.016, 0.018, 1.5, 8).translate(0, 0.75, 0), wood);
  const head = [new THREE.BoxGeometry(0.46, 0.04, 0.05)];
  for (let i = 0; i < 7; i++) head.push(new THREE.BoxGeometry(0.022, 0.09, 0.022).translate(-0.2 + i * (0.4 / 6), -0.06, 0));
  const hm = mesh(mergeGeometries(head), wood);
  g.add(handle, hm);
  g.userData.head = hm; // at the handle base (y = 0)
  return g;
}
export function buildCan() {
  const g = new THREE.Group();
  const m = mat(PALETTE.can, 0.45, { metalness: 0.35 });
  const body = new THREE.LatheGeometry([V(0, 0), V(0.08, 0), V(0.085, 0.03), V(0.08, 0.17), V(0.06, 0.19), V(0, 0.19)], 18);
  const spout = new THREE.CylinderGeometry(0.008, 0.014, 0.22, 8).rotateZ(-0.95).translate(0.15, 0.13, 0);
  const rose = new THREE.CylinderGeometry(0.026, 0.012, 0.03, 10).rotateZ(-0.95 + Math.PI / 2).translate(0.245, 0.2, 0);
  const handle = new THREE.TorusGeometry(0.06, 0.008, 6, 14, Math.PI).translate(-0.01, 0.19, 0);
  g.add(mesh(mergeGeometries([body.toNonIndexed(), spout.toNonIndexed(), rose.toNonIndexed(), handle.toNonIndexed()]), m));
  return g;
}

let _blob = null;
function blobTex() {
  if (_blob) return _blob;
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 2, 32, 32, 31); gr.addColorStop(0, 'rgba(255,255,255,0.85)'); gr.addColorStop(0.55, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); _blob = new THREE.CanvasTexture(c); return _blob;
}
// merge each node's plain mesh children into one vertex-coloured mesh (fewer draw calls)
const SHARED = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
export function consolidate(root) {
  const nodes = []; root.traverse((o) => { if (!o.isMesh) nodes.push(o); });
  for (const n of nodes) {
    const kids = n.children.filter((c) => c.isMesh && c.children.length === 0 && c.material && c.material.isMeshStandardMaterial && !c.material.transparent && c.material.metalness === 0);
    if (kids.length < 2) continue;
    const geos = [];
    let cast = false;
    for (const k of kids) {
      k.updateMatrix();
      let g = k.geometry.clone().applyMatrix4(k.matrix);
      g = g.index ? g.toNonIndexed() : g;
      const cnt = g.attributes.position.count, a = new Float32Array(cnt * 3), cc = k.material.color;
      for (let i = 0; i < cnt; i++) { a[i * 3] = cc.r; a[i * 3 + 1] = cc.g; a[i * 3 + 2] = cc.b; }
      g.setAttribute('color', new THREE.BufferAttribute(a, 3));
      for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(name)) g.deleteAttribute(name);
      geos.push(g); cast = cast || k.castShadow; n.remove(k);
    }
    const m = new THREE.Mesh(mergeGeometries(geos), SHARED); m.castShadow = cast; m.receiveShadow = true; n.add(m);
  }
}
export function createCharacter({ palette = PALETTE, shadows = false } = {}) {
  const P = palette;
  const M = {
    skin: mat(P.skin, 0.7), hair: mat(P.hair, 0.75), top: mat(P.top, 0.92), topDark: mat(P.topDark, 0.92),
    trousers: mat(P.trousers, 0.95), boots: mat(P.boots, 0.7), hat: mat(P.hat, 0.95), band: mat(P.band, 0.8),
    apron: mat(P.apron, 0.95), apronDark: mat(P.apronDark, 0.95), eye: mat(P.eye, 0.35), blush: mat(P.blush, 0.8),
  };
  const group = new THREE.Group(); group.name = 'character';
  const root = new THREE.Group(); group.add(root); // hips height and bob
  const hips = new THREE.Group(); hips.position.y = 0.86; root.add(hips);

  // ---- torso: a soft A-line linen tunic over the hips, a little waist
  const torso = new THREE.Group(); hips.add(torso);
  const tunic = new THREE.LatheGeometry([V(0.0, -0.22), V(0.19, -0.22), V(0.182, -0.14), V(0.15, -0.02), V(0.128, 0.08), V(0.138, 0.2), V(0.152, 0.32), V(0.146, 0.42), V(0.105, 0.5), V(0.055, 0.545), V(0.0, 0.55)], 26);
  tunic.scale(1, 1, 0.72);
  torso.add(mesh(tunic, M.top, shadows));
  torso.add(mesh(new THREE.TorusGeometry(0.062, 0.012, 6, 18).rotateX(Math.PI / 2).translate(0, 0.53, 0), M.topDark, false));
  // a canvas garden apron with a pocket, tied at the waist
  const apron = new THREE.CylinderGeometry(0.15, 0.2, 0.46, 14, 1, true, -0.95, 1.9).scale(1, 1, 0.76).translate(0, -0.13, 0.008);
  torso.add(mesh(apron, M.apron, shadows));
  torso.add(mesh(new THREE.CylinderGeometry(0.152, 0.152, 0.11, 12, 1, true, -0.62, 1.24).scale(1, 1, 0.8).translate(0, 0.26, 0.004), M.apron, false)); // bib
  torso.add(mesh(new THREE.TorusGeometry(0.132, 0.009, 4, 24).rotateX(Math.PI / 2).scale(1, 1, 0.76).translate(0, 0.08, 0), M.apronDark, false)); // waist tie
  torso.add(mesh(new THREE.BoxGeometry(0.15, 0.09, 0.012).translate(0, -0.17, 0.148), M.apronDark, false)); // pocket
  const neck = mesh(new THREE.CylinderGeometry(0.042, 0.048, 0.1, 10).translate(0, 0.58, 0), M.skin, false); torso.add(neck);

  // ---- head + hair + sun hat
  const head = new THREE.Group(); head.position.y = 0.66; torso.add(head);
  head.add(mesh(new THREE.SphereGeometry(0.104, 22, 18).scale(0.93, 1.07, 1.0).translate(0, 0.02, 0.0), M.skin, shadows));
  head.add(mesh(new THREE.SphereGeometry(0.016, 8, 6).scale(0.8, 0.9, 0.8).translate(0, 0.005, 0.101), M.skin, false)); // nose
  for (const sx of [-1, 1]) {
    head.add(mesh(new THREE.SphereGeometry(0.0115, 8, 6).scale(0.85, 1.25, 0.5).translate(sx * 0.036, 0.026, 0.094), M.eye, false));
    head.add(mesh(new THREE.SphereGeometry(0.019, 8, 6).scale(1.2, 0.7, 0.35).translate(sx * 0.055, -0.005, 0.086), M.blush, false));
  }
  // hair: a soft cap with side-swept bangs, and a shoulder-length bob open at the face
  const cap = new THREE.SphereGeometry(0.114, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.36).scale(0.96, 1.06, 1.04).translate(0, 0.03, -0.004);
  head.add(mesh(cap, M.hair, shadows));
  const hairG = new THREE.SphereGeometry(0.118, 22, 16, Math.PI * 0.74, Math.PI * 1.52, 0, Math.PI * 0.8);
  hairG.scale(1.0, 1.08, 1.02).translate(0, 0.03, -0.005);
  head.add(mesh(hairG, M.hair, shadows));
  const bobG = new THREE.LatheGeometry([V(0.113, 0.06), V(0.126, -0.02), V(0.123, -0.1), V(0.104, -0.135)], 18, Math.PI * 0.64, Math.PI * 1.72);
  head.add(mesh(bobG, M.hair, shadows));
  const hat = new THREE.Group(); hat.position.y = 0.075; hat.rotation.x = -0.08; head.add(hat);
  hat.add(mesh(new THREE.LatheGeometry([V(0, 0.105), V(0.07, 0.1), V(0.1, 0.07), V(0.112, 0.0), V(0.13, -0.004), V(0.2, -0.018), V(0.255, -0.04), V(0.258, -0.05), V(0.2, -0.03), V(0.12, -0.014), V(0.105, -0.01)], 28), M.hat, shadows));
  hat.add(mesh(new THREE.CylinderGeometry(0.113, 0.114, 0.028, 24, 1, true).translate(0, 0.012, 0), M.band, false));

  // ---- arms: shoulder -> elbow -> hand
  function arm(side) {
    const sh = new THREE.Group(); sh.position.set(side * 0.16, 0.465, 0); torso.add(sh);
    sh.add(mesh(new THREE.SphereGeometry(0.044, 12, 10).scale(1, 0.9, 0.95), M.top, shadows));
    sh.add(mesh(new THREE.CylinderGeometry(0.042, 0.05, 0.27, 12).translate(0, -0.14, 0), M.top, shadows));
    const el = new THREE.Group(); el.position.y = -0.285; sh.add(el);
    el.add(mesh(capsule(0.04, 0.1).translate(0, -0.07, 0), M.top, shadows)); // rolled sleeves stop mid-forearm
    el.add(mesh(new THREE.TorusGeometry(0.04, 0.012, 5, 12).rotateX(Math.PI / 2).translate(0, -0.13, 0), M.topDark, false));
    el.add(mesh(capsule(0.031, 0.1).translate(0, -0.19, 0), M.skin, false));
    const hand = new THREE.Group(); hand.position.y = -0.27; el.add(hand);
    hand.add(mesh(new THREE.SphereGeometry(0.042, 10, 8).scale(0.8, 1.15, 0.6), M.skin, false));
    sh.rotation.z = side * 0.09;
    return { sh, el, hand };
  }
  const armL = arm(1), armR = arm(-1);

  // ---- legs: hip -> knee -> ankle, wide linen trousers + short boots
  function leg(side) {
    const hp = new THREE.Group(); hp.position.set(side * 0.095, -0.2, 0); hips.add(hp);
    hp.add(mesh(capsule(0.074, 0.3).translate(0, -0.2, 0), M.trousers, shadows));
    const kn = new THREE.Group(); kn.position.y = -0.4; hp.add(kn);
    kn.add(mesh(new THREE.CylinderGeometry(0.07, 0.085, 0.33, 12).translate(0, -0.165, 0), M.trousers, shadows));
    const ft = new THREE.Group(); ft.position.y = -0.4; kn.add(ft);
    ft.add(mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.1, 12).translate(0, 0.0, 0), M.boots, shadows));
    ft.add(mesh(capsule(0.045, 0.12).rotateX(Math.PI / 2).scale(1.05, 0.85, 1).translate(0, -0.035, 0.05), M.boots, shadows));
    return { hp, kn, ft };
  }
  const legL = leg(1), legR = leg(-1);

  // ---- held tools
  const rake = buildRake(); rake.visible = false; group.add(rake);
  const can = buildCan(); can.visible = false; armR.hand.add(can); can.position.set(0, -0.06, 0.02); can.rotation.set(0, -Math.PI / 2, 0);
  let holding = null;

  // ---- animation
  let phase = 0, bobY = 0, breath = 0, t = 0;
  const g = { kneel: 0, water: 0, prune: 0, toss: 0, reach: 0, rake: 0, wave: 0 }; // smoothed gesture weights
  const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
  function update(dt, { speed = 0, airborne = false, gesture = null, gestureT = 0, vy = 0 } = {}) {
    t += dt;
    const sp = Math.min(speed, 4.5);
    const amp = Math.min(1, sp / 1.4) * (airborne ? 0.25 : 1);
    phase += dt * (sp > 0.05 ? (2.2 + sp * 1.35) : 0);
    if (sp <= 0.05) phase = damp(phase, Math.round(phase / Math.PI) * Math.PI, 6, dt);
    for (const k in g) g[k] = damp(g[k], gesture === k || (k === 'rake' && holding === 'rake') ? 1 : 0, 6, dt);
    breath += dt * 1.6;
    const s = Math.sin(phase), c2 = Math.cos(phase * 2);
    // root bob + slight forward lean when hurrying
    bobY = damp(bobY, sp > 0.05 && !airborne ? (-c2 * 0.022 - 0.01) * amp : 0, 12, dt);
    const kneel = g.kneel;
    root.position.y = bobY - kneel * 0.38;
    torso.rotation.x = 0.05 * amp + Math.min(0.2, sp * 0.035) + kneel * 0.32 + g.prune * 0.06 + g.water * 0.12 + g.rake * 0.1 + (airborne ? -0.06 : 0);
    torso.rotation.y = s * 0.07 * amp;
    torso.rotation.z = Math.sin(phase) * 0.025 * amp;
    torso.scale.set(1 + Math.sin(breath) * 0.006, 1 + Math.sin(breath) * 0.008, 1 + Math.sin(breath) * 0.006);
    head.rotation.x = -torso.rotation.x * 0.55 + kneel * 0.25 + g.water * 0.1;
    head.rotation.y = -torso.rotation.y * 0.8;
    // legs
    const air = airborne ? 1 : 0;
    const swing = 0.55 * amp;
    for (const [L, sgn] of [[legL, 1], [legR, -1]]) {
      const ls = Math.sin(phase + (sgn > 0 ? 0 : Math.PI));
      let thigh = -ls * swing;
      let knee = Math.max(0, Math.sin(phase + (sgn > 0 ? 0 : Math.PI) + 1.2)) * 0.9 * amp + 0.06;
      if (airborne) { thigh = sgn > 0 ? -0.5 : 0.15; knee = sgn > 0 ? 0.7 : 0.35; if (vy < 0) { thigh *= 0.6; knee *= 0.7; } }
      // kneel: right knee down to the ground, left foot planted forward (garden kneel)
      if (kneel > 0.001) {
        const kt = sgn > 0 ? -1.25 : -0.15, kk = sgn > 0 ? 1.45 : 1.75;
        thigh = thigh * (1 - kneel) + kt * kneel; knee = knee * (1 - kneel) + kk * kneel;
      }
      L.hp.rotation.x = thigh - torso.rotation.x * (1 - kneel) * 0.7;
      L.kn.rotation.x = knee;
      L.ft.rotation.x = -(thigh + knee) * 0.5 + (kneel ? kneel * 0.3 : 0);
      void air;
    }
    // arms: natural swing opposite to legs, then gestures blend over it
    for (const [A, sgn] of [[armL, 1], [armR, -1]]) {
      const as = Math.sin(phase + (sgn > 0 ? Math.PI : 0));
      let shx = 0.04 - as * 0.45 * amp, elx = -0.28 - Math.max(0, as) * 0.25 * amp, shz = sgn * (0.13 + (airborne ? 0.35 : 0));
      // gestures (right hand leads)
      const right = sgn < 0;
      const reachX = -1.0, reachEl = -0.25;
      if (g.kneel > 0.001) { const w = g.kneel; shx = shx * (1 - w) + (right ? -0.95 : -0.55) * w; elx = elx * (1 - w) + (right ? -0.35 : -0.6) * w; }
      if (g.water > 0.001 && right) { const w = g.water; shx = shx * (1 - w) + -1.05 * w; elx = elx * (1 - w) + -0.25 * w; }
      if (g.prune > 0.001) { const w = g.prune; const snip = Math.sin(t * 9) * 0.08; shx = shx * (1 - w) + (-1.1 + (right ? snip : 0)) * w; elx = elx * (1 - w) + -0.85 * w; shz = shz * (1 - w) + -sgn * 0.25 * w; }
      if (g.toss > 0.001 && right) { const w = g.toss; const k = Math.min(1, t % 10); void k; shx = shx * (1 - w) + -1.35 * w; elx = elx * (1 - w) + -0.15 * w; }
      if (g.reach > 0.001 && right) { const w = g.reach; shx = shx * (1 - w) + reachX * w; elx = elx * (1 - w) + reachEl * w; }
      if (g.wave > 0.001 && right) { const w = g.wave; shx = shx * (1 - w) + -0.3 * w; shz = shz * (1 - w) + (-2.5 + Math.sin(t * 7) * 0.25) * w; elx = elx * (1 - w) + -0.4 * w; }
      if (g.rake > 0.001) { const w = g.rake; shx = shx * (1 - w) + (right ? -0.75 : -0.6) * w; elx = elx * (1 - w) + -0.55 * w; shz = shz * (1 - w) + -sgn * 0.18 * w; }
      A.sh.rotation.x = shx; A.sh.rotation.z = shz; A.el.rotation.x = elx;
    }
    can.visible = g.water > 0.25;
    can.rotation.z = -g.water * 0.35;
    // rake: held in front with both hands, tines on the sand ~0.95 m ahead
    rake.visible = holding === 'rake';
    if (rake.visible) {
      rake.position.set(0.06, 0.0, 0.98);
      rake.rotation.set(-0.75 + Math.sin(phase) * 0.02 * amp, 0, 0);
    }
  }
  // soft contact shadow (the garden's shadow map only refreshes now and then)
  const blob = new THREE.Mesh(new THREE.CircleGeometry(0.42, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: blobTex(), transparent: true, depthWrite: false, opacity: 0.55, color: '#000' }));
  blob.position.y = 0.015; blob.renderOrder = 1; group.add(blob);
  consolidate(group);
  return {
    group, update, blob, head,
    hold(tool) { holding = tool; },
    get holding() { return holding; },
    // world-space point where the rake tines touch the ground
    rakeTip(out) { return out.set(0.06, 0, 0.98).applyMatrix4(group.matrixWorld); },
    handWorld(out) { return armR.hand.getWorldPosition(out); },
    height: 1.65,
  };
}
