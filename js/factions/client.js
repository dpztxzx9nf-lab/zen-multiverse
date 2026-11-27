// Factions in the game: draws the Warden camp, the Reaver post and their people, offers the choices
// (help, spare or finish, free, return or keep, steal, talk, learn, trade, the gate) and shows what follows.
// Signed in and connected: the multiplayer server decides everything (net.js hands us {t:'fa'} messages and
// a send function; we only draw and ask). Offline: the same simulation (sim.js) runs here, saved in
// localStorage, for the home garden only. No meters anywhere: you read people by how they act and talk.
import * as THREE from 'three';
import { createScene, createSim, pos as posOf, asksOf } from './sim.js';
import { game } from '../game/store.js';
import { stylize } from '../look.js';
import { mergeGeometries } from '../util.js';
import { campGround } from './ground.js';
import { solid, passable, actor, bakeSolids, unbake } from '../solids-bake.js';
// a box with softly rounded edges ("cut the made": planes with a chamfer, never razor edges)
function RoundedBoxGeometry(w, h, d, seg = 2, r = 0.05) {
  const g = new THREE.BoxGeometry(w, h, d, seg * 2 + 1, seg * 2 + 1, seg * 2 + 1), p = g.attributes.position, v = new THREE.Vector3(), c = new THREE.Vector3();
  const ix = w / 2 - r, iy = h / 2 - r, iz = d / 2 - r;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i); c.set(Math.max(-ix, Math.min(ix, v.x)), Math.max(-iy, Math.min(iy, v.y)), Math.max(-iz, Math.min(iz, v.z)));
    v.sub(c); if (v.lengthSq() > 1e-12) v.setLength(r); p.setXYZ(i, c.x + v.x, c.y + v.y, c.z + v.z);
  }
  g.computeVertexNormals(); return g;
}

const LS = 'zen-factions-v1';
const STANCE_FACE = { friendly: 1, grateful: 1, wary: 1, hostile: -1 }; // -1: turns their back on you

export function startFactions({ worlds, params }) {
  let D = null, mode = 'off', send = null, view = null, off = 0, known = {}, local = null, me = 'me';
  const wait = new Map(); // k -> resolver (server replies)
  const talks = new Map(); // npc id -> last talk result (offers)
  const root = new THREE.Group(); root.name = 'factions';
  let scene = null, built = null, gateOpen = false, lastLook = 0, lastPose = 0, lastSave = 0, warned = 0, carrying = null, debugLog = [];
  const objs = { npcs: new Map(), caches: new Map(), packs: new Map(), prints: null, gate: null };
  const ready = fetch(new URL('./factions.json', import.meta.url)).then((r) => r.json()).then((d) => { D = d; });

  // ---- the world we are in
  const W = () => worlds.current;
  const ctx = () => { const w = W(), d = w && w.debug; if (!d) return {}; const g = d.game || {}; return { player: g.player || d.player || d.core?.player, interact: g.interact || d.interact || d.core?.interact, hud: g.hud || d.core?.hud || d.hud, w }; };
  const tileNow = () => { const w = W(); const q = w && w.where && w.where(); return (q && q.tile) || w?.debug?.W?.tile || null; };
  const now = () => Date.now() + off;
  const gy = (x, z) => { const p = ctx().player; try { const y = p?.ground ? p.ground(x, z) : 0; return Number.isFinite(y) ? y : 0; } catch { return 0; } };
  const myPos = () => ctx().player?.position || null;
  const toast = (t, ms = 4200) => { try { ctx().hud?.toast(t, 'leaf', ms); } catch { /* */ } };
  const say = (who, lines) => { const h = ctx().hud; return h && h.say ? h.say(who, lines) : Promise.resolve(); };
  const log = (s) => { debugLog.push(s); if (debugLog.length > 60) debugLog.shift(); };

  // ---- meshes (cheap: a few hundred triangles each), in the Raked Light style (art-bible.md 6):
  // ~6.5 heads tall with a slightly bigger head and hands, a tapered stone-like torso, one readable
  // silhouette per role, and each culture's colour language (Wardens: indigo cloth, ochre wood;
  // Reavers: rust and soot with one vermilion accent). The sim's data (factions.json) stays untouched.
  const ART = {
    wardens: { cloth: '#4a5574', trim: '#b98a4a', dark: '#2f3447', wood: '#8f6e48', banner: '#3d4a72', mark: '#d9a24c', tent: '#bfae8c' },
    reavers: { cloth: '#7e3a26', trim: '#2f2a27', dark: '#3a2c26', wood: '#5a4535', banner: '#b8432c', mark: '#2a2422', tent: '#6e5546' },
  };
  const matCache = new Map();
  const mat = (c, o = {}, kind = 'made') => {
    const k = c + kind + JSON.stringify({ ...o, map: o.map ? o.map.uuid : undefined });
    if (!matCache.has(k)) matCache.set(k, stylize(new THREE.MeshStandardMaterial({ color: c, roughness: kind === 'skin' ? 0.6 : kind === 'cloth' ? 0.9 : 0.8, ...o }), kind));
    return matCache.get(k);
  };
  const SR = 'rgba(0,0,0,0)';
  function label(text) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 56;
    const x = c.getContext('2d'); x.font = '600 26px system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    const tw = Math.min(250, x.measureText(text).width + 24);
    x.fillStyle = 'rgba(30,34,38,0.62)'; x.beginPath(); x.roundRect((256 - tw) / 2, 6, tw, 44, 18); x.fill();
    x.fillStyle = '#f3ede1'; x.fillText(text, 128, 29);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
    s.scale.set(0.95, 0.2, 1); s.renderOrder = 10; return s;
  }
  void SR;
  // a lathe from (radius, height) pairs: soft stone-like masses instead of capsules
  const lathe = (pts, seg = 10) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);
  const TORSO = lathe([[0.001, 0], [0.17, 0.02], [0.2, 0.12], [0.17, 0.28], [0.2, 0.42], [0.25, 0.55], [0.23, 0.63], [0.12, 0.68], [0.001, 0.69]], 12);
  const COAT = lathe([[0.001, 0], [0.31, 0], [0.27, 0.25], [0.21, 0.5], [0.001, 0.52]], 12);
  const LEG = lathe([[0.001, 0], [0.075, 0.02], [0.07, 0.4], [0.085, 0.55], [0.095, 0.82], [0.001, 0.84]], 8);
  const ARM = lathe([[0.001, 0], [0.05, 0.02], [0.048, 0.25], [0.062, 0.45], [0.07, 0.56], [0.001, 0.58]], 8);
  function personMesh(n) {
    const A = ART[n.f] || ART.wardens, F = D.factions[n.f], g = new THREE.Group(), body = new THREE.Group(); g.add(body);
    const cloth = mat(A.cloth, {}, 'cloth'), trim = mat(A.trim, {}, 'cloth'), skin = mat(F.skin, {}, 'skin'), dark = mat(A.dark, {}, 'cloth');
    const legs = new THREE.Group(); legs.position.y = 0.86; body.add(legs);
    for (const s of [-0.1, 0.1]) {
      const hip = new THREE.Group(); hip.position.set(s, 0, 0); legs.add(hip);
      const l = new THREE.Mesh(LEG, dark); l.rotation.x = Math.PI; l.position.y = 0.0; l.scale.set(1, 0.98, 1); hip.add(l);
      const foot = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 6), mat(A.trim === '#c08a3e' ? '#5a4632' : '#2f2a27', {}, 'made')); foot.scale.set(1, 0.6, 1.7); foot.position.set(0, -0.83, 0.05); hip.add(foot);
    }
    const arms = [];
    for (const s of [-1, 1]) {
      const a = new THREE.Group(); a.position.set(s * 0.25, 1.42, 0);
      const m = new THREE.Mesh(ARM, cloth); m.rotation.x = Math.PI; m.position.y = 0.0; a.add(m);
      const h = new THREE.Mesh(new THREE.SphereGeometry(0.072, 10, 8), skin); h.scale.set(0.9, 1.1, 0.8); h.position.y = -0.62; a.add(h);
      a.rotation.z = s * 0.08; body.add(a); arms.push(a);
    }
    const torso = new THREE.Mesh(TORSO, cloth); torso.position.y = 0.82; body.add(torso);
    const belt = new THREE.Mesh(new THREE.TorusGeometry(0.175, 0.025, 5, 16), trim); belt.rotation.x = Math.PI / 2; belt.position.y = 1.1; body.add(belt);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.1, 8), skin); neck.position.y = 1.52; body.add(neck);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.165, 16, 12), skin); head.scale.set(0.95, 1.05, 1); head.position.y = 1.66; body.add(head);
    const hood = new THREE.Mesh(new THREE.SphereGeometry(0.182, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.56), cloth); hood.position.y = 1.69; hood.rotation.x = -0.32; body.add(hood);
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 5), skin); nose.scale.set(0.8, 1, 1.2); nose.position.set(0, 1.64, 0.16); body.add(nose);
    for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 5), mat('#22201e', {}, 'made')); e.position.set(s * 0.06, 1.69, 0.145); body.add(e); }
    if (n.f === 'reavers') { const mask = new THREE.Mesh(new THREE.CylinderGeometry(0.168, 0.16, 0.09, 14, 1, true, -1.2, 2.4), mat(A.dark, { side: THREE.DoubleSide }, 'cloth')); mask.position.set(0, 1.6, 0.0); body.add(mask); }
    // one big readable shape per role
    if (n.role === 'tracker') { const coat = new THREE.Mesh(COAT, cloth); coat.position.y = 0.42; body.add(coat); const bow = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.02, 4, 18, Math.PI * 0.9), mat(A.wood, {}, 'made')); bow.position.set(0.05, 1.2, -0.22); bow.rotation.set(0, Math.PI / 2, Math.PI / 2 + 0.15); body.add(bow); }
    if (n.role === 'courier') { const bag = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8), mat(A.wood, {}, 'made')); bag.scale.set(1.0, 1.15, 0.6); bag.position.set(0, 1.2, -0.26); body.add(bag); const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.5, 8), trim); roll.rotation.z = Math.PI / 2; roll.position.set(0, 1.47, -0.24); body.add(roll); }
    if (n.role === 'chief' || n.role === 'teacher') { const mantle = new THREE.Mesh(lathe([[0.001, 0.2], [0.33, 0.12], [0.3, 0.0], [0.001, 0.0]], 14), trim); mantle.position.y = 1.4; body.add(mantle); }
    if (n.role === 'gatekeeper' || n.role === 'raider' || n.role === 'scout') { const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, 2.1, 6), mat(A.wood, {}, 'made')); sp.position.set(0.34, 1.0, 0.08); body.add(sp); const tip = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.22, 6), mat('#8f8a80', { roughness: 0.6 }, 'rock')); /* a knapped stone point */ tip.position.set(0.34, 2.15, 0.08); body.add(tip); }
    if (n.role === 'trader') { const pack = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), mat('#a68a5e', {}, 'cloth')); pack.scale.set(1.1, 1.0, 0.75); pack.position.set(0, 1.25, -0.3); body.add(pack); }
    const rope = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.025, 4, 14), mat('#a08a5f', {}, 'made')); rope.position.y = 1.0; rope.rotation.x = Math.PI / 2; rope.visible = false; body.add(rope);
    const tag = label(n.name); tag.position.y = 2.1; g.add(tag);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    g.name = 'npc:' + n.id;
    g.userData = { body, head, rope, tag, legs, arms, phase: Math.random() * 6, phys: { k: 'actor', why: 'a person: steps around you' } };
    return g;
  }
  // a painted cloth banner: the culture's mark (Wardens: an ochre enso; Reavers: a soot slash)
  const bannerTex = new Map();
  function bannerMap(f) {
    if (bannerTex.has(f)) return bannerTex.get(f);
    const A = ART[f] || ART.wardens, c = document.createElement('canvas'); c.width = 128; c.height = 192; const x = c.getContext('2d');
    x.fillStyle = A.banner; x.fillRect(0, 0, 128, 192); x.strokeStyle = A.mark; x.lineCap = 'round';
    if (f === 'reavers') { x.lineWidth = 16; x.beginPath(); x.moveTo(24, 40); x.quadraticCurveTo(70, 90, 104, 160); x.stroke(); }
    else { x.lineWidth = 12; x.beginPath(); x.arc(64, 86, 36, -1.2, Math.PI * 1.75); x.stroke(); }
    x.fillStyle = 'rgba(0,0,0,0.18)'; for (let i = 0; i < 6; i++) x.fillRect(0, 184 - i * 2, 128, 1);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; bannerTex.set(f, t); return t;
  }
  // a Warden tent: a stone-shaped dome of indigo cloth over ochre poles
  const DOME = lathe([[2.0, 0], [2.05, 0.45], [1.85, 1.2], [1.35, 1.9], [0.7, 2.3], [0.001, 2.42]], 16);
  // set stones (ten-chi-jin: 5:3:2) around a camp's fire or door
  function stoneSet(g, x, z, k = 1) {
    // one merged mesh (one draw call on phones)
    const geos = [[0.5, 0, 0], [0.3, 0.7, 0.35], [0.2, -0.5, 0.55]].map(([sz, dx, dz], i) => new THREE.IcosahedronGeometry(sz * k, 1).scale(1.2, 0.7 + i * 0.05, 1).rotateY(i * 1.3).translate(x + dx * k, sz * k * 0.45, z + dz * k));
    g.add(new THREE.Mesh(mergeGeometries(geos), mat('#8c877d', {}, 'rock')));
  }
  function propMesh(p) {
    const g = new THREE.Group(), F = p.f && D.factions[p.f];
    const A = ART[p.f] || ART.wardens;
    if (p.k === 'tent') {
      const t = new THREE.Mesh(DOME, mat(A.tent, { side: THREE.DoubleSide }, 'cloth')); g.add(t);
      for (let i = 0; i < 3; i++) { const a = i / 3 * Math.PI * 2 + 0.4, pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.0, 6), mat(A.wood, {}, 'made')); pole.position.set(Math.cos(a) * 0.12, 2.6, Math.sin(a) * 0.12); pole.rotation.set(Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35); g.add(pole); }
      const band = new THREE.Mesh(new THREE.TorusGeometry(1.9, 0.05, 5, 24), mat(A.cloth, {}, 'cloth')); band.rotation.x = Math.PI / 2; band.position.y = 0.95; band.scale.set(1, 1, 1); g.add(band);
      const door = new THREE.Mesh(lathe([[0.55, 0], [0.5, 0.7], [0.28, 1.2], [0.001, 1.32]], 10), mat(A.dark, {}, 'cloth')); door.scale.set(1, 1, 0.25); door.position.set(0, 0, 1.86); g.add(door);
      stoneSet(g, 1.6, 2.2, 0.8);
    }
    if (p.k === 'store') {
      const w = new THREE.Mesh(new RoundedBoxGeometry(3.6, 2.3, 3.2, 2, 0.12), mat(A.wood)); w.position.y = 1.15; g.add(w);
      const r = new THREE.Mesh(new THREE.ConeGeometry(2.9, 1.3, 4), mat(A.tent, {}, 'cloth')); r.position.y = 2.95; r.rotation.y = Math.PI / 4; g.add(r);
      if (p.gate) { const gate = new THREE.Group(); const leaf = new THREE.Mesh(new RoundedBoxGeometry(1.3, 1.9, 0.1, 1, 0.03), mat(A.dark)); leaf.position.x = 0.65; leaf.position.y = 0.95; gate.add(leaf); gate.position.set(p.gate.x - p.x - 0.65, 0, p.gate.z - p.z); gate.rotation.y = 0.6; g.add(gate); objs.gate = gate; }
    }
    if (p.k === 'fire') { for (let i = 0; i < 5; i++) { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.9, 6), mat('#4b3626')); l.rotation.z = Math.PI / 2; l.rotation.y = i * 1.25; l.position.y = 0.08; g.add(l); } const f = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.7, 7), mat('#ffb04a', { emissive: '#ff7a1a', emissiveIntensity: 1.4 })); f.position.y = 0.4; f.name = 'flame'; g.add(f); const ring = []; for (let i = 0; i < 9; i++) { const a = i / 9 * Math.PI * 2; ring.push(new THREE.IcosahedronGeometry(0.16 + (i % 3) * 0.04, 1).scale(1.2, 0.65, 1).rotateY(a).translate(Math.cos(a) * 0.72, 0.07, Math.sin(a) * 0.72)); } g.add(new THREE.Mesh(mergeGeometries(ring), mat('#7d786f', {}, 'rock'))); }
    if (p.k === 'banner') { const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 4.2, 6), mat(A.wood)); pole.position.y = 2.1; g.add(pole); const cl = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.5, 6, 1), mat('#ffffff', { side: THREE.DoubleSide, map: bannerMap(p.f) }, 'cloth')); cl.position.set(0.52, 3.3, 0); g.add(cl); }
    if (p.k === 'leanto') { const roof = new THREE.Mesh(new RoundedBoxGeometry(3.2, 0.12, 2.4, 1, 0.04), mat(A.tent, {}, 'cloth')); roof.position.y = 1.5; roof.rotation.x = -0.45; g.add(roof); for (const s of [-1.5, 1.5]) { const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 2.0, 6), mat(A.wood)); post.position.set(s, 1.0, -0.9); g.add(post); } const hide = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.9), mat('#7a5a40', { side: THREE.DoubleSide }, 'made')); hide.position.set(0, 0.9, -1.1); g.add(hide); }
    if (p.k === 'post') { const post = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 2.2, 7), mat(A.wood)); post.position.y = 1.1; g.add(post); }
    if (p.k === 'gully') { const pit = new THREE.Mesh(new THREE.CircleGeometry(4.2, 18), mat('#5b4a39')); pit.rotation.x = -Math.PI / 2; pit.position.y = 0.03; pit.scale.set(1.4, 0.6, 1); g.add(pit); for (let i = 0; i < 9; i++) { const r = new THREE.Mesh(new THREE.IcosahedronGeometry(0.35 + (i % 3) * 0.2, 1), mat('#7a7066', {}, 'rock')); const a = i / 9 * Math.PI * 2; r.position.set(Math.cos(a) * 4.6, 0.15, Math.sin(a) * 2.4 - 1.5); g.add(r); } }
    if (p.k === 'road') { for (let i = 0; i < 4; i++) { const s = new THREE.Mesh(new THREE.IcosahedronGeometry(0.32 - i * 0.06, 1), mat('#8d857a', {}, 'rock')); s.position.y = 0.2 + i * 0.36; g.add(s); } }
    g.position.set(p.x, gy(p.x, p.z), p.z);
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    // real things: every piece you can see stops you where its surface is (js/solids-bake.js bakes the meshes);
    // a pit dug into the ground and a flame are not walls
    g.name = 'camp-' + p.k;
    if (p.k === 'gully') g.traverse((o) => { if (o.isMesh && o.geometry.type === 'CircleGeometry') passable(o, 'a pit floor: ground'); });
    if (p.k === 'fire') g.traverse((o) => { if (o.name === 'flame') passable(o, 'fire is not a wall'); });
    solid(g, { name: 'camp-' + p.k });
    return g;
  }
  function cacheMesh() { const g = solid(new THREE.Group(), { name: 'camp-cache', whole: true }); for (let i = 0; i < 3; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.45, 0.45), mat('#7c6142')); b.position.set((i - 1) * 0.62, 0.23, 0); g.add(b); } const s = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), mat('#b29a6e')); s.scale.set(1, 0.8, 1); s.position.set(0, 0.62, 0); g.add(s); return g; }
  function packMesh() { const b = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.5, 0.24), mat('#6d5a3e')); b.position.y = 0.25; const g = passable(new THREE.Group(), 'a pack you pick up'); g.add(b); const strap = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.02, 4, 10), mat('#3b2e22')); strap.position.set(0, 0.5, 0); g.add(strap); return g; }

  // ---- build / sync with the current view
  function attach() {
    const sc = W()?.scene;
    if (sc !== scene) { scene?.remove(root); sc?.add(root); scene = sc; built = null; }
  }
  // the camp's colliders live in the current world's list, made from the camp's own meshes
  let bakedInto = null;
  function rebake() {
    const cols = ctx().player?.colliders || null;
    if (bakedInto && bakedInto !== cols) unbake(bakedInto, root.uuid);
    bakedInto = cols; if (cols) bakeSolids(root, cols, { ground: gy, tag: root.uuid });
  }
  function build(v) {
    const key = `${v.kind}:${v.anchor.x},${v.anchor.z}:${v.anchor.tile}`;
    if (built === key) return; built = key;
    for (const c of [...root.children]) root.remove(c);
    objs.npcs.clear(); objs.caches.clear(); objs.packs.clear(); objs.gate = null;
    for (const p of v.props) root.add(propMesh(p));
    try { root.add(campGround({ props: v.props, people: v.npcs, gy, stylize })); } catch (e) { console.warn('[factions] camp ground', e && e.message); }
    const ia = ctx().interact;
    for (const n of v.npcs) { const m = personMesh(n); root.add(m); objs.npcs.set(n.id, m); }
    for (const c of v.caches) { const m = cacheMesh(); m.position.set(c.x, gy(c.x, c.z), c.z); root.add(m); objs.caches.set(c.id, m); }
    for (const k of v.packs) { const m = packMesh(); root.add(m); objs.packs.set(k.id, m); }
    const pr = new THREE.InstancedMesh(new THREE.CircleGeometry(0.09, 8), new THREE.MeshBasicMaterial({ color: '#2b2118', transparent: true, opacity: 0.55, depthWrite: false }), 240);
    pr.count = 0; pr.frustumCulled = false; root.add(pr); objs.prints = pr; passable(pr, 'footprints');
    rebake();
    if (ia) wire(ia, v);
  }
  // interactions: what you can do depends on the state of each person or thing
  let wired = null;
  function wire(ia, v) {
    if (wired) for (const id of wired) ia.remove(id);
    wired = [];
    const add = (it) => { ia.add(it); wired.push(it.id); };
    for (const n0 of v.npcs) {
      const id = n0.id;
      add({ id: 'fa-' + id, r: 1.9, priority: 0.4, at: () => { const o = objs.npcs.get(id), n = npc(id); const low = n && n.st !== 'ok' && n.st !== 'returning'; return o ? { x: o.position.x, y: o.position.y + (low ? 0.45 : 1), z: o.position.z } : { x: 0, y: -99, z: 0 }; },
        enabled: () => { const n = npc(id); return !!n && n.st !== 'dead' && !(n.st === 'returning' && n.f === 'reavers' && n.stance === 'stranger'); },
        actions: () => actionsFor(npc(id)) });
    }
    for (const c of v.caches) add({ id: 'fa-' + c.id, r: 1.7, at: () => ({ x: c.x, y: gy(c.x, c.z) + 0.4, z: c.z }), enabled: () => { const cc = view?.caches.find((x) => x.id === c.id); return !!cc && cc.n > 0; },
      actions: () => [{ label: `Take from ${D.factions[c.f].name.replace(/^the /, 'the ')}' cache`, icon: 'leaf', run: () => doAct('steal', c.id) }] });
    for (const k of v.packs) add({ id: 'fa-' + k.id, r: 1.5, at: () => ({ x: k.x, y: gy(k.x, k.z) + 0.2, z: k.z }), enabled: () => view?.packs.find((x) => x.id === k.id)?.st === 'ground',
      actions: () => [{ label: `Pick up the pack (it has ${npc(k.owner)?.name || 'someone'}'s mark on it)`, icon: 'leaf', run: () => doAct('take', k.id) }] });
    if (objs.gate) { const gp = v.props.find((p) => p.gate); add({ id: 'fa-gate', r: 1.8, at: () => ({ x: gp.gate.x, y: 1, z: gp.gate.z }), actions: () => [{ label: gateOpen ? 'The storehouse is open to you' : 'The gate is barred', icon: 'leaf', run: async () => { if (!gateOpen) toast('Barred from inside. Oskar keeps the gate.'); } }] }); }
  }
  const npc = (id) => view?.npcs.find((n) => n.id === id);
  function actionsFor(n) {
    if (!n) return [];
    const L = (k) => D.acts[k].label;
    if (n.st === 'downed') return [{ label: L('spare'), icon: 'leaf', run: () => doAct('spare', n.id) }, { label: L('kill'), icon: 'leaf', run: () => doAct('kill', n.id) }];
    if (n.st === 'bound') return [{ label: L('free'), icon: 'leaf', run: () => doAct('free', n.id) }];
    if (n.st === 'hurt') return [{ label: L('help'), icon: 'leaf', run: () => doAct('help', n.id) }];
    const out = [];
    // a relic they asked for, in your hands (server items): hand it over
    const held = window.__zenHeld ? window.__zenHeld() : [];
    for (const q of asksOf(D, { kind: view.kind }, n)) if (q.k && held.includes(q.k) && D.acts['gift-' + q.k]) out.push({ label: `${D.acts['gift-' + q.k].label} to ${n.name}`, icon: 'leaf', run: () => doAct('gift-' + q.k, n.id) });
    const mine = view.packs.find((k) => k.mine && k.st === 'carried' && k.owner === n.id);
    if (mine) out.push({ label: `Give ${n.name} the pack back`, icon: 'leaf', run: () => doAct('return', n.id) });
    const tk = talks.get(n.id);
    if (tk && tk.offers.includes('settle')) out.push({ label: L('settle'), icon: 'leaf', run: () => doAct('settle', n.id) });
    if (tk && tk.offers.includes('teach')) out.push({ label: `Ask ${n.name} to teach you (${D.teach[n.teaches || 'tracking']?.name || 'a craft'})`, icon: 'leaf', run: () => learn(n.id) });
    if (tk && tk.offers.includes('gate') && !gateOpen) out.push({ label: `Ask ${n.name} to open the storehouse`, icon: 'leaf', run: () => gate(n.id) });
    if (tk && tk.offers.includes('trade')) out.push({ label: `Trade with ${n.name} for food`, icon: 'leaf', run: () => trade(n.id) });
    out.push({ label: `Talk to ${n.name}`, icon: 'leaf', run: () => talk(n.id) });
    return out.slice(0, 2);
  }

  // ---- asking (server or local) ----
  function ask(m, k) {
    if (mode === 'server') return new Promise((res) => { const key = k + ':' + (m.id || ''); wait.set(key, res); send({ t: 'fa', ...m }); setTimeout(() => { if (wait.get(key) === res) { wait.delete(key); res(null); } }, 4000); });
    return Promise.resolve(localAsk(m));
  }
  function localAsk(m) {
    const p = myPos(); if (!p || !local) return null; const t = now();
    local.pose(me, p.x, p.z, t);
    if (m.k === 'act') { const r = local.act(me, m.act, m.id, { x: p.x, z: p.z }, t, 'you'); save(true); refreshLocal(); return { ...r, seen: (r.seen || []).map((s) => ({ name: s.name, f: s.f, by: s.by })) }; }
    const n = local.st.npcs[m.id]; if (!n) return null;
    const q = posOf(local.st, n, t); if (Math.hypot(q.x - p.x, q.z - p.z) > 4.5) return { far: true };
    const tk = local.talk(m.id, me, t, known);
    if (m.k === 'talk') return { id: m.id, name: n.name, f: n.f, ...tk };
    if (m.k === 'learn') { if (!tk.offers.includes('teach')) return { ok: false }; known[n.teaches] = { kind: n.teaches, npc: n.name, at: t }; save(true); return { ok: true, skill: n.teaches, how: D.teach[n.teaches]?.how }; }
    if (m.k === 'gate') return { open: tk.offers.includes('gate') };
    if (m.k === 'trade') { const c = Object.values(local.st.caches).find((x) => x.f === n.f); if (!tk.offers.includes('trade') || !c || !(c.goods.food > 0)) return { ok: false }; c.goods.food--; save(true); return { ok: true, got: { food: 1 } }; }
    return null;
  }
  const WHY = { 'not-holding': 'You need to have it in your hands.', 'too-far': 'You need to be closer.', state: 'That is not possible now.', 'not-here': 'Not from here.', slow: '', empty: 'There is nothing left in it.' };
  async function doAct(act, id) {
    const r = await ask({ k: 'act', act, id }, 'did');
    if (!r) return toast('No answer. Try again in a moment.');
    if (!r.ok) { if (WHY[r.why]) toast(WHY[r.why]); return; }
    // led: the server's bag already gave and took (js/bag.js); only show it here
    const bagSide = (fn) => (r.led ? game.quiet(fn) : fn());
    bagSide(() => {
      for (const [k, n] of Object.entries(r.give || {})) game.add(k, n);
      for (const [k, n] of Object.entries(r.take || {})) game.take(k, Math.min(n, game.count(k)));
    });
    const N = (x) => npc(x)?.name || '';
    if (act.startsWith('gift-')) {
      const q = asksOf(D, { kind: view.kind }, npc(id) || { id }).find((x) => 'gift-' + x.k === act), got = Object.entries(r.give || {}).map(([k, n]) => `${n} ${k.replace('mat:', '')}`).join(', ');
      const saw = (r.seen || []).filter((s) => s.by === 'saw' && s.name !== N(id)).map((s) => s.name);
      toast(`${q && q.thanks ? q.thanks : `${N(id)} takes it.`}${got ? ` (+${got})` : ' (Their cache is empty: nothing to pay you with.)'}${saw.length ? ` ${saw.join(' and ')} saw it.` : ''}`, 8000);
      talks.delete(id); log(`${act} ${id} seen=${(r.seen || []).map((s) => s.name + ':' + s.by).join(',')}`); return;
    }
    const msg = {
      spare: `${N(id)} drinks, and you bind the wound. He gets up slowly and limps off toward the Reaver post.`,
      kill: `It is over quickly. ${N(id)} lies still in the gully.`,
      free: `The ropes fall away. ${N(id)} rubs her wrists and runs for the Warden camp.`,
      help: `You splint ${N(id)}'s ankle with a stick and cloth. She thanks you and starts limping home.`,
      take: 'You pick up the pack. It belongs to Ivo of the Wardens. Take it back to him, or press K to keep what is inside.',
      return: `${N(id)} takes the pack and looks at you a long moment. "I thought that was gone."`,
      keep: 'You empty the pack and keep what was in it.',
      steal: 'You take what you can carry.',
      settle: 'You hand it all back.',
    }[act];
    if (act === 'take') carrying = id;
    if (act === 'return' || act === 'keep') carrying = null;
    const saw = (r.seen || []).filter((s) => s.by === 'saw' && s.name !== N(id)).map((s) => s.name);
    toast(msg + (saw.length ? ` ${saw.join(' and ')} saw you.` : ''), 6500);
    log(`${act} ${id} seen=${(r.seen || []).map((s) => s.name + ':' + s.by).join(',')}`);
  }
  async function talk(id) {
    const r = await ask({ k: 'talk', id }, 'talk');
    if (!r || r.far) return toast(r?.far ? 'Get closer to talk.' : 'No answer.');
    talks.set(id, r);
    log(`talk ${id} ${r.stance} ${r.offers.join(',')}`);
    say(r.name || npc(id)?.name || '', r.lines.length ? r.lines : ['…']); // the dialog stays until tapped through
    return r;
  }
  async function learn(id) {
    const r = await ask({ k: 'learn', id }, 'taught');
    if (!r || !r.ok) return toast('Not now.');
    known[r.skill] = { kind: r.skill, npc: npc(id)?.name, at: now() };
    talks.delete(id);
    say(npc(id)?.name || '', [r.how]);
    return r;
  }
  async function gate(id) { const r = await ask({ k: 'gate', id }, 'gate'); if (r?.open) { gateOpen = true; toast(`${npc(id)?.name} lifts the bar. The storehouse is open to you, and you can rest by their fire.`); } else toast('"Not for you."'); }
  async function trade(id) {
    const offer = Object.entries(game.data.inv || {}).filter(([k, n]) => n > 0 && k !== 'food').sort((a, b) => b[1] - a[1])[0];
    if (!offer) return toast('You have nothing to offer.');
    const r = await ask({ k: 'trade', id }, 'traded');
    if (!r?.ok) return toast(r?.why === 'nothing' ? 'You have nothing to offer.' : '"We have nothing to spare right now."');
    const gave = r.led && typeof r.gave === 'string' ? r.gave : offer[0]; // led: the server's bag chose and swapped it
    const swap = () => { game.take(gave, Math.min(1, game.count(gave))); game.add('food', 1); };
    if (r.led) game.quiet(swap); else swap();
    toast(`You trade one of your ${gave.replace(/^.*:/, '')} for food.`);
  }
  addEventListener('keydown', (e) => {
    if (e.code !== 'KeyK' || e.repeat || !carrying || mode === 'off') return;
    if (document.activeElement && /input|textarea/i.test(document.activeElement.tagName)) return;
    doAct('keep', carrying);
  });

  // ---- server messages (net.js)
  function onMsg(m) {
    if (m.k === 'view') {
      off = (m.st || Date.now()) - Date.now(); view = m.view;
      if (m.known) for (const b of m.known) known[b.kind] = b;
      carrying = (view.packs.find((k) => k.mine && k.st === 'carried') || {}).id || null;
      return;
    }
    if (m.k === 'ambush') return ambushed(m);
    const key = m.k + ':' + (m.id || '');
    const res = wait.get(key); if (res) { wait.delete(key); res(m); }
  }
  function ambushed(e) {
    if (e.led) { // the server's bag already lost it (js/bag.js): show what went
      game.quiet(() => { for (const [k, n] of Object.entries(e.took || {})) game.take(k, Math.min(n, game.count(k))); });
      toast(e.seize ? `${e.name} steps out of the trees behind you and takes back what you stole. "Now we're square."` : `${e.name} followed your tracks here. He knocks you down and takes a share of what you carry. "That's for Brann."`, 7000);
      if (!e.seize) { const p = ctx().player; if (p && p.teleport) { const q = p.position; p.teleport(q.x + 1.2, q.z + 0.6, p.heading); } }
      return;
    }
    if (e.seize) { for (const [k, n] of Object.entries(e.seize)) game.take(k, Math.min(n, game.count(k))); toast(`${e.name} steps out of the trees behind you and takes back what you stole. "Now we're square."`, 7000); }
    else {
      const inv = Object.entries(game.data.inv || {}).filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1])[0];
      if (inv) game.take(inv[0], Math.ceil(inv[1] / 3));
      toast(`${e.name} followed your tracks here. He knocks you down and takes a share of what you carry. "That's for Brann."`, 7000);
      const p = ctx().player; if (p && p.teleport) { const q = p.position; p.teleport(q.x + 1.2, q.z + 0.6, p.heading); }
    }
  }

  // ---- offline: the same sim, saved locally (home garden only)
  function loadLocal() {
    let saved = null; try { saved = JSON.parse(localStorage.getItem(LS) || 'null'); } catch { /* */ }
    const st = saved && saved.st && saved.st.v === 1 ? saved.st : createScene(D, 'home', { x: 0, z: 0, tile: null });
    known = (saved && saved.known) || {};
    local = createSim(D, st, { world: 'local:home', label: 'home' });
    local.advance(Date.now());
  }
  function save(force) { if (!local) return; const t = Date.now(); if (!force && t - lastSave < 5000) return; lastSave = t; try { localStorage.setItem(LS, JSON.stringify({ st: local.st, known })); } catch { /* */ } }
  function refreshLocal() { if (!local) return; view = local.view(me, now()); for (const e of local.drainEvents()) if (e.k === 'ambush') ambushed(e); local.drainOut(); }

  // ---- every frame
  const tmpV = new THREE.Vector3();
  function frame() {
    requestAnimationFrame(frame);
    if (!D) return;
    const w = W(); if (!w || !w.scene) return;
    const t = now();
    if (mode !== 'server') {
      const garden = w.id === 'earth' && !tileNow();
      if (garden && !local) loadLocal();
      mode = garden ? 'local' : 'off';
      if (mode === 'local') {
        const p = myPos();
        if (p && t - lastPose > 250) { lastPose = t; local.pose(me, p.x, p.z, t); local.advance(t); refreshLocal(); save(); }
        else if (!view) refreshLocal();
      }
    } else if (t - lastLook > 3000 && near(160)) { lastLook = t; send({ t: 'fa', k: 'look' }); }
    const show = (mode === 'local' || mode === 'server') && view && (view.anchor.tile || null) === (tileNow() || null);
    attach(); root.visible = !!show;
    if (!show) return;
    build(view);
    draw(t);
  }
  function near(r) { const p = myPos(); return p && view && Math.hypot(p.x - view.anchor.x, p.z - view.anchor.z) < r + 60; }
  function draw(t) {
    const p = myPos(); const vst = { trails: {} };
    for (const n of view.npcs) {
      const o = objs.npcs.get(n.id); if (!o) continue;
      if (n.trail) vst.trails[n.mv.aid] = n.trail;
      const q = posOf(vst, n, t);
      o.position.set(q.x, gy(q.x, q.z), q.z);
      const u = o.userData, b = u.body;
      let yaw = q.yaw;
      const d = p ? Math.hypot(p.x - q.x, p.z - q.z) : 99;
      // people read you by how they stand: friends turn to you, the wronged turn their back
      if (p && d < 9 && !q.moving && n.st === 'ok' && STANCE_FACE[n.stance]) { yaw = Math.atan2(p.x - q.x, p.z - q.z); if (STANCE_FACE[n.stance] < 0) yaw += Math.PI; }
      if (p && n.f === 'reavers' && n.st === 'ok' && (n.stance === 'wary' || n.stance === 'hostile') && d < 25) yaw = Math.atan2(p.x - q.x, p.z - q.z); // they watch you
      o.rotation.y = yaw;
      b.rotation.set(0, 0, 0); b.position.set(0, 0, 0); u.rope.visible = false; u.legs.rotation.x = 0;
      for (const [i, a] of u.arms.entries()) { a.rotation.x = 0; a.rotation.z = (i ? 1 : -1) * 0.08; }
      for (const l of u.legs.children) l.rotation.x = 0;
      if (n.st === 'downed' || n.st === 'dead') { b.rotation.x = -Math.PI / 2; b.position.set(0, 0.2, -0.85); u.arms[0].rotation.z = -0.5; u.arms[1].rotation.x = n.st === 'dead' ? 0.2 : -1.2; }
      else if (n.st === 'hurt' || n.st === 'bound') {
        // sitting on the ground: legs out in front, hands round the ankle (hurt) or behind the post (bound)
        b.position.y = -0.8; u.legs.rotation.x = -Math.PI / 2; b.rotation.x = n.st === 'bound' ? 0.08 : -0.12;
        if (n.st === 'bound') { u.rope.visible = true; for (const a of u.arms) a.rotation.x = 0.5; } else for (const a of u.arms) a.rotation.x = -0.9;
      } else if (q.moving) {
        const lame = n.st === 'returning' && n.role === 'scout', w = t / 1000 * (lame ? 3 : 6.5) + u.phase, sw = Math.sin(w) * (lame ? 0.25 : 0.45);
        b.position.y = Math.abs(Math.sin(w)) * 0.05; u.legs.children[0].rotation.x = sw; u.legs.children[1].rotation.x = -sw; u.arms[0].rotation.x = -sw * 0.8; u.arms[1].rotation.x = sw * 0.8;
        if (n.mv.k === 'track') b.rotation.x = 0.25;
      } else if (p && d < 6 && n.st === 'ok' && (n.stance === 'friendly' || n.stance === 'grateful')) u.arms[1].rotation.x = -0.4 - Math.abs(Math.sin(t / 400)) * 0.3 * (n.stance === 'grateful' ? 1 : 0.3); // a raised hand
      u.tag.visible = d < 14 && n.st !== 'dead';
      u.tag.position.y = n.st === 'downed' ? 0.9 : n.st === 'hurt' || n.st === 'bound' ? 1.6 : 2.05;
      if (n.mv.k === 'track' && n.you && known.tracking && t - warned > 60e3) { warned = t; toast(`Fresh prints over yours, a long stride, toes in: ${n.name} is following your trail.`, 6000); }
    }
    for (const k of view.packs) {
      const o = objs.packs.get(k.id); if (!o) continue;
      if (k.st === 'ground') { o.visible = true; o.position.set(k.x, gy(k.x, k.z), k.z); }
      else if (k.st === 'carried' && k.mine && p) { o.visible = true; o.position.set(p.x, p.y + 0.95, p.z); o.rotation.y = (ctx().player?.heading || 0); tmpV.set(0, 0, -0.3).applyAxisAngle(THREE.Object3D.DEFAULT_UP, o.rotation.y); o.position.add(tmpV); }
      else if (k.st === 'home') { const ow = objs.npcs.get(k.owner); if (ow) { o.visible = true; o.position.set(ow.position.x + 0.5, ow.position.y, ow.position.z + 0.3); } }
      else o.visible = false;
    }
    if (objs.gate) objs.gate.rotation.y += ((gateOpen ? -1.4 : 0.6) - objs.gate.rotation.y) * 0.05;
    for (const c of root.children) { const f = c.getObjectByName && c.getObjectByName('flame'); if (f) f.scale.y = 0.85 + Math.sin(t / 90 + c.position.x) * 0.12; }
    prints(t);
  }
  // Reading tracks (taught by Maren): the trackers' footprints over the last few minutes, darker when fresh
  const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), S = new THREE.Vector3(), P = new THREE.Vector3();
  function prints(t) {
    const pr = objs.prints; if (!pr) return;
    pr.count = 0;
    if (!known.tracking) { pr.instanceMatrix.needsUpdate = true; return; }
    const vst = { trails: {} };
    for (const n of view.npcs) {
      if (n.role !== 'tracker' || n.st !== 'ok') continue;
      if (n.trail) vst.trails[n.mv.aid] = n.trail;
      let last = null;
      for (let k = 0; k < 120 && pr.count < 240; k++) {
        const q = posOf(vst, { ...n }, t - k * 1500); if (!q.moving && k > 0) continue;
        if (last && Math.hypot(q.x - last.x, q.z - last.z) < 0.7) continue; last = q;
        const side = pr.count % 2 ? 0.14 : -0.14;
        E.set(-Math.PI / 2, 0, -q.yaw); Q.setFromEuler(E);
        P.set(q.x + Math.cos(q.yaw) * side, gy(q.x, q.z) + 0.03, q.z - Math.sin(q.yaw) * side);
        const s = 1 - k / 140; S.set(s, s * 1.6, 1);
        M4.compose(P, Q, S); pr.setMatrixAt(pr.count++, M4);
      }
    }
    pr.instanceMatrix.needsUpdate = true;
  }

  ready.then(() => requestAnimationFrame(frame)).catch((e) => console.warn('[factions] data', e));
  const api = {
    // net.js: the server has factions; it gives us a way to send
    online(fn) { send = fn; mode = 'server'; view = null; built = null; send({ t: 'fa', k: 'hello' }); },
    offline() { if (mode === 'server') { mode = 'off'; view = null; built = null; send = null; } },
    onMsg,
    wantPose() { return mode === 'server' && near(160); },
    get state() { return { mode, kind: view?.kind, n: view?.npcs.length, known: Object.keys(known), carrying, gateOpen, log: debugLog.slice(-12), npcs: view?.npcs.map((n) => ({ id: n.id, st: n.st, stance: n.stance, mv: n.mv.k, at: (() => { const q = posOf({ trails: { [n.mv.aid]: n.trail || [] } }, n, now()); return [+q.x.toFixed(1), +q.z.toFixed(1)]; })() })) }; },
    act: doAct, talk, learn, gate, trade,
    lastTalk: (id) => talks.get(id),
    reset() { localStorage.removeItem(LS); local = null; view = null; built = null; known = {}; },
  };
  window.__factions = api;
  return api;
}
