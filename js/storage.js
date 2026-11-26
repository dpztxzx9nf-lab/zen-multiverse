// Things set down in the world, client side (server/src/storage.js decides; js/game/fixtures.js says what they are):
// draws workbenches, forges, cooking fires, chests and safes where the server says they stand, offers them to the
// world's own walk-up-and-press-E system, opens their menus (a station's recipes, a box's slots), places new ones from
// the bag with a ghost you aim, and asks the server before a station recipe is made (window.__zenStorage.ask).
// Started by compete.js (the shared server's games), so an older server never sees any of it.
import * as THREE from 'three';
import { FIXTURES, STATION_R, BOX_R, PLACE_R, STACK, slotsUsed, locked } from './game/fixtures.js';
import { game, itemInfo } from './game/store.js';
import { openStation, ensureG7, hasGear } from './game/skills.js';
import { icon } from './game/icons.js';
import { stylize } from './look.js';
import { solid, passable, bodyBox } from './solids-bake.js';
import { BODY } from './solids.js';

const LID_OPEN = { chest: -1.15, safe: -1.7, locker: -1.6 };
const SIDE_HINGE = { safe: 1, locker: 1 }; // doors swing on a side hinge (y), lids lift on a back hinge (x)
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function startStorage({ worlds, send, me, toLocal, peerList, held, nameOf, chatLine }) {
  const S = { fx: new Map(), carry: 3, view: null, hp: new Map(), lids: new Map() };
  const root = new THREE.Group(); root.name = 'storage';
  const meshes = new Map(); // id -> group
  let scene = null, inter = null, place = null, refN = 0;
  const pend = new Map(); // craft asks: ref -> { cb, t }

  const W = () => worlds.current;
  const dbg = () => W()?.debug || {};
  const core = () => dbg().game || dbg().core || null;
  const hud = () => core()?.hud || null;
  const player = () => { const d = dbg(); return d.player || d.core?.player || d.game?.player || null; };
  const camera = () => W()?.camera || null;
  const myTile = () => { const w = W(); const q = w && w.where && w.where(); return (q && q.tile) || w?.debug?.W?.tile || null; };
  const groundY = (x, z) => { const pl = player(); try { const y = pl?.ground ? pl.ground(x, z) : pl?.position?.y; return Number.isFinite(y) ? y : (pl?.position?.y || 0); } catch { return pl?.position?.y || 0; } };
  const loc = (f) => (f ? toLocal({ x: f.x, z: f.z, yaw: f.yaw || 0, tile: f.tile || null, y: f.y || 0 }) : null);
  const myId = () => me()?.id;
  const sound = (k, v = 0.6) => { try { const st = dbg().game?.steps || dbg().sb?.steps; if (st) st.play(k, v); } catch { /* */ } };

  // ---- models (Raked Light: soft river-stone masses, plain wood, ink-dark iron; one cached material per colour)
  const mats = new Map();
  const mat = (c, kind = 'made', o = {}) => { const k = c + kind + JSON.stringify(o); if (!mats.has(k)) mats.set(k, stylize(new THREE.MeshStandardMaterial({ color: c, roughness: 0.82, ...o }), kind)); return mats.get(k); };
  const box = (w, h, d, m, x = 0, y = 0, z = 0) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.castShadow = b.receiveShadow = true; return b; };
  const cyl = (rt, rb, h, m, x = 0, y = 0, z = 0, seg = 10) => { const c = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m); c.position.set(x, y, z); c.castShadow = c.receiveShadow = true; return c; };
  const stone = (r, m, x, y, z, s = 0.6) => { const g = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 1), m); g.position.set(x, y, z); g.scale.set(1, s, 0.9); g.rotation.y = x * 7 + z * 3; g.castShadow = g.receiveShadow = true; return g; };
  function benchMesh() {
    const g = new THREE.Group(), wood = mat('#9b7650', 'wood'), dark = mat('#6e5238', 'wood'), iron = mat('#3c3a38', 'made', { metalness: 0.5, roughness: 0.5 });
    g.add(box(1.5, 0.09, 0.66, wood, 0, 0.86, 0));
    for (const [x, z] of [[-0.66, -0.26], [0.66, -0.26], [-0.66, 0.26], [0.66, 0.26]]) g.add(box(0.09, 0.82, 0.09, dark, x, 0.41, z));
    g.add(box(1.36, 0.05, 0.08, dark, 0, 0.22, -0.26), box(1.36, 0.05, 0.08, dark, 0, 0.22, 0.26), box(1.3, 0.04, 0.5, wood, 0, 0.25, 0));
    g.add(box(0.16, 0.12, 0.2, iron, 0.62, 0.96, 0.18)); // the vice
    // a claw hammer on the top, and a pegboard of tools at the back (a wrench, a saw, a square)
    const hammer = new THREE.Group(); hammer.add(box(0.05, 0.05, 0.14, iron, 0, 0, 0)); hammer.add(box(0.025, 0.025, 0.28, mat('#2b2b2b', 'made'), 0.0, 0, 0.18)); hammer.rotation.y = 0.4; hammer.position.set(-0.35, 0.93, 0.05); g.add(hammer);
    g.add(box(0.05, 0.62, 0.05, dark, -0.7, 1.2, -0.3), box(0.05, 0.62, 0.05, dark, 0.7, 1.2, -0.3), box(1.44, 0.5, 0.02, mat('#c4a77c', 'wood'), 0, 1.2, -0.3));
    g.add(box(0.04, 0.26, 0.015, iron, -0.4, 1.22, -0.285), box(0.3, 0.12, 0.012, iron, 0.05, 1.28, -0.285), box(0.04, 0.22, 0.012, iron, 0.42, 1.2, -0.285), box(0.16, 0.04, 0.012, iron, 0.48, 1.29, -0.285));
    g.add(box(0.5, 0.02, 0.12, mat('#c9b48e', 'wood'), 0.1, 0.915, -0.15)); // a planed offcut
    return g;
  }
  function forgeMesh() { // a scrap-steel drum smelter on cinder blocks, a stovepipe chimney, an anvil on a steel stand
    const g = new THREE.Group(), block = mat('#8b8984', 'rock'), drum = mat('#4a4f52', 'made', { metalness: 0.55, roughness: 0.55 }), rust = mat('#7a4a2c', 'made', { metalness: 0.3, roughness: 0.8 });
    const iron = mat('#2f2e2d', 'made', { metalness: 0.6, roughness: 0.45 });
    for (const [x, z] of [[-0.22, -0.2], [0.22, -0.2], [-0.22, 0.2], [0.22, 0.2]]) g.add(box(0.36, 0.2, 0.3, block, x, 0.1, z - 0.1));
    g.add(cyl(0.36, 0.36, 0.78, drum, 0, 0.6, -0.1, 18));
    for (const y of [0.32, 0.88]) g.add(cyl(0.375, 0.375, 0.04, rust, 0, y, -0.1, 18));
    g.add(cyl(0.3, 0.36, 0.1, iron, 0, 1.04, -0.1, 18));
    const pipe = cyl(0.07, 0.07, 0.9, iron, 0.12, 1.5, -0.18, 10); g.add(pipe); g.add(cyl(0.11, 0.08, 0.06, iron, 0.12, 1.96, -0.18, 10));
    const glow = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.2, 0.04), new THREE.MeshStandardMaterial({ color: 0x2a1a12, emissive: 0xff6a1a, emissiveIntensity: 1.0, roughness: 1 })); glow.position.set(0, 0.52, 0.25); g.add(glow);
    g.add(box(0.32, 0.03, 0.05, iron, 0, 0.64, 0.26), box(0.32, 0.03, 0.05, iron, 0, 0.4, 0.26));
    const anvil = new THREE.Group(); anvil.add(cyl(0.05, 0.05, 0.42, iron, 0, 0.21, 0, 8)); anvil.add(box(0.34, 0.03, 0.26, iron, 0, 0.015, 0)); anvil.add(box(0.16, 0.12, 0.14, iron, 0, 0.48, 0)); anvil.add(box(0.42, 0.1, 0.16, iron, 0, 0.59, 0));
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.22, 8), iron); horn.rotation.z = Math.PI / 2; horn.position.set(0.31, 0.6, 0); anvil.add(horn);
    anvil.position.set(0.85, 0, 0.25); g.add(anvil);
    g.userData.glow = glow; return g;
  }
  function fireMesh() {
    const g = new THREE.Group(), st = mat('#8f8a82', 'rock'), wood = mat('#6b4c33', 'wood'), ash = mat('#5a5652', 'terrain');
    g.add(cyl(0.42, 0.46, 0.03, ash, 0, 0.015, 0, 16));
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; g.add(stone(0.12, st, Math.cos(a) * 0.48, 0.07, Math.sin(a) * 0.48, 0.7)); }
    for (let i = 0; i < 4; i++) { const l = cyl(0.04, 0.05, 0.62, wood, 0, 0.18, 0, 6); l.rotation.set(0.95, (i / 4) * Math.PI * 2, 0, 'YXZ'); l.position.set(Math.sin((i / 4) * Math.PI * 2) * 0.12, 0.18, Math.cos((i / 4) * Math.PI * 2) * 0.12); g.add(l); }
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.42, 7, 1, true), new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.75, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    flame.position.y = 0.32; g.add(flame);
    const coal = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 6), new THREE.MeshStandardMaterial({ color: 0x2a1a12, emissive: 0xff5a10, emissiveIntensity: 1.1 })); coal.scale.y = 0.35; coal.position.y = 0.06; g.add(coal);
    g.userData.flame = flame; g.userData.glow = coal; return g;
  }
  function chestMesh() { // a plank supply crate with corner battens, rope handles and a flat hinged lid
    const g = new THREE.Group(), wood = mat('#b08d5e', 'wood'), dark = mat('#7d5f3c', 'wood'), rope = mat('#c9b48a', 'made', { roughness: 0.95 }), iron = mat('#3a3734', 'made', { metalness: 0.55, roughness: 0.5 });
    g.add(box(0.9, 0.48, 0.58, wood, 0, 0.26, 0));
    for (const y of [0.12, 0.26, 0.4]) g.add(box(0.92, 0.012, 0.6, dark, 0, y, 0)); // plank seams
    for (const x of [-0.43, 0.43]) for (const z of [-0.27, 0.27]) g.add(box(0.06, 0.5, 0.06, dark, x, 0.26, z));
    for (const x of [-0.47, 0.47]) { const h = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.014, 6, 10, Math.PI), rope); h.rotation.y = Math.PI / 2; h.rotation.z = Math.PI; h.position.set(x, 0.36, 0); g.add(h); }
    const lid = new THREE.Group(); lid.position.set(0, 0.5, -0.29); // hinge at the back
    const top = box(0.94, 0.06, 0.62, wood, 0, 0.03, 0.29); top.castShadow = true; lid.add(top);
    for (const z of [0.06, 0.52]) lid.add(box(0.94, 0.02, 0.06, dark, 0, 0.07, z));
    lid.add(box(0.1, 0.1, 0.02, iron, 0, -0.03, 0.61)); // latch
    g.add(lid); g.userData.lid = lid; return g;
  }
  function lockerMesh() { // a tall steel locker: vent slots, a handle with a padlock, a door on a left hinge
    const g = new THREE.Group(), steel = mat('#6d7a82', 'made', { metalness: 0.6, roughness: 0.45 }), dark = mat('#3b4246', 'made', { metalness: 0.55, roughness: 0.5 });
    const brass = new THREE.MeshStandardMaterial({ color: 0xb9975a, metalness: 0.9, roughness: 0.35 });
    g.add(box(0.5, 1.7, 0.5, steel, 0, 0.89, 0), box(0.54, 0.04, 0.54, dark, 0, 1.76, 0), box(0.52, 0.06, 0.52, dark, 0, 0.03, 0));
    const door = new THREE.Group(); door.position.set(-0.24, 0.9, 0.26);
    door.add(box(0.48, 1.6, 0.03, steel, 0.24, 0, 0));
    for (let i = 0; i < 4; i++) door.add(box(0.28, 0.018, 0.01, dark, 0.24, 0.62 - i * 0.05, 0.02));
    for (let i = 0; i < 4; i++) door.add(box(0.28, 0.018, 0.01, dark, 0.24, -0.55 - i * 0.05, 0.02));
    door.add(box(0.03, 0.16, 0.04, dark, 0.42, 0.02, 0.03));
    const lock = box(0.06, 0.07, 0.025, brass, 0.42, -0.1, 0.05); door.add(lock);
    const shackle = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.006, 6, 10, Math.PI), brass); shackle.position.set(0.42, -0.065, 0.05); door.add(shackle);
    g.add(door); g.userData.lid = door; return g;
  }
  function safeMesh() {
    const g = new THREE.Group(), steel = mat('#5d6266', 'made', { metalness: 0.65, roughness: 0.42 }), dark = mat('#34383b', 'made', { metalness: 0.6, roughness: 0.5 });
    const chrome = new THREE.MeshStandardMaterial({ color: 0xc9ccd0, metalness: 1, roughness: 0.25 });
    g.add(box(0.72, 0.86, 0.66, steel, 0, 0.47, 0), box(0.78, 0.05, 0.72, dark, 0, 0.025, 0), box(0.76, 0.05, 0.7, dark, 0, 0.915, 0));
    for (const [x, y] of [[-0.32, 0.1], [0.32, 0.1], [-0.32, 0.84], [0.32, 0.84]]) { const f = box(0.08, 0.08, 0.08, dark, x, y, 0.3); g.add(f); }
    const door = new THREE.Group(); door.position.set(-0.3, 0.47, 0.34); // hinge on the left
    door.add(box(0.6, 0.7, 0.05, steel, 0.3, 0, 0));
    for (let i = 0; i < 6; i++) { const r = new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 4), dark); r.position.set(0.05 + (i % 3) * 0.25, i < 3 ? 0.3 : -0.3, 0.03); door.add(r); }
    const dial = cyl(0.08, 0.08, 0.04, dark, 0.38, 0.08, 0.04, 16); dial.rotation.x = Math.PI / 2; door.add(dial);
    const handle = box(0.03, 0.2, 0.03, chrome, 0.52, -0.1, 0.07); door.add(handle); // a chrome pull handle
    for (const y of [-0.19, -0.01]) door.add(box(0.02, 0.02, 0.05, chrome, 0.52, y, 0.045));
    g.add(door); g.userData.lid = door; g.userData.dial = dial; return g;
  }
  function spillMesh() {
    const g = new THREE.Group(), cloth = mat('#b09a76', 'cloth'), wood = mat('#8b6a48', 'wood');
    for (let i = 0; i < 5; i++) { const s = new THREE.Mesh(new THREE.SphereGeometry(0.16 + (i % 2) * 0.04, 10, 8), cloth); s.scale.set(1, 0.6, 0.9); s.position.set(Math.cos(i * 2.2) * 0.25, 0.09, Math.sin(i * 2.2) * 0.25); s.castShadow = true; g.add(s); }
    for (let i = 0; i < 3; i++) { const p = box(0.5, 0.03, 0.12, wood, Math.cos(i * 2) * 0.4, 0.02 + i * 0.02, Math.sin(i * 2) * 0.4); p.rotation.y = i * 1.3; g.add(p); }
    return g;
  }
  const MAKE = { bench: benchMesh, forge: forgeMesh, fire: fireMesh, chest: chestMesh, locker: lockerMesh, safe: safeMesh, spill: spillMesh };
  function label(text) {
    const c = document.createElement('canvas'); c.width = 320; c.height = 64;
    const x = c.getContext('2d'); x.font = '500 26px Georgia, serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    const tw = Math.min(310, x.measureText(text).width + 26);
    x.fillStyle = 'rgba(20,24,22,0.5)'; x.beginPath(); x.roundRect((320 - tw) / 2, 10, tw, 44, 22); x.fill();
    x.fillStyle = '#f4efe6'; x.fillText(text, 160, 33);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true, opacity: 0 }));
    s.scale.set(1.3, 0.26, 1); s.renderOrder = 10; return s;
  }
  const nameFor = (f) => {
    if (f.kind === 'spill') return 'Spilled things';
    const n = FIXTURES[f.kind].name;
    if (f.owner === 'world') return n;
    return f.owner === myId() ? `Your ${n.toLowerCase()}` : `${f.oname || 'Someone'}'s ${n.toLowerCase()}`;
  };

  // ---- scene sync
  function attach() {
    const sc = W()?.scene;
    if (sc !== scene) { scene?.remove(root); sc?.add(root); scene = sc; }
    const it = core()?.interact || dbg().interact || null;
    if (it !== inter) { if (inter) for (const id of S.fx.keys()) inter.remove('fx-' + id); inter = it; if (inter) for (const f of S.fx.values()) register(f); }
  }
  function sync(f) {
    let o = meshes.get(f.id);
    if (!o) { o = (MAKE[f.kind] || spillMesh)(); o.userData.kind = f.kind; const l = label(nameFor(f)); l.position.y = ({ fire: 0.95, chest: 0.95, safe: 1.15, locker: 1.95, spill: 0.8 })[f.kind] || 1.35; o.add(l); o.userData.label = l; meshes.set(f.id, o); root.add(o); }
    const l = loc(f); if (!l) { o.visible = false; return; }
    o.visible = true; o.position.set(l.x, f.tile && f.tile === myTile() ? f.y : groundY(l.x, l.z), l.z); o.rotation.y = l.yaw || 0;
    body(f.id, o);
  }
  // each thing set down is its own rigid body with one box from its own meshes (js/solids-bake.js bodyBox):
  // you bump into the crate you see, and moving, opening or taking it down only replaces that one entry
  const bodies = new Map(); // id -> the collider list holding its box
  function body(id, o) {
    const old = bodies.get(id); if (old) { old.removeWhere((c) => c.tag === 'fx:' + id); bodies.delete(id); }
    const cols = player()?.colliders; if (!o || !o.visible || !cols) return;
    if (!o.userData.phys) solid(o, { name: o.userData.kind || 'fixture' });
    const b = bodyBox(o); if (!b || b.top < o.position.y + BODY.stepOver) return; // low enough to step over
    cols.add({ ...b, tag: 'fx:' + id }); bodies.set(id, cols);
  }
  function syncAll() { attach(); for (const f of S.fx.values()) sync(f); }
  function drop(id) { body(id, null); const o = meshes.get(id); if (o) { root.remove(o); meshes.delete(id); } S.fx.delete(id); if (inter) inter.remove('fx-' + id); }
  const unwire = (w) => ({ id: w[0], kind: w[1], x: w[2], y: w[3], z: w[4], yaw: w[5], tile: w[6] || null, owner: w[7], oname: w[8], nAllow: w[9], hp: w[10] });
  const fpos = (f) => { const o = meshes.get(f.id); return o && o.visible ? o.position : null; };
  const near = (f, r) => { const p = fpos(f), q = player()?.position; return p && q ? Math.hypot(p.x - q.x, p.z - q.z) <= r + (FIXTURES[f.kind]?.r || 0.5) : false; };
  const bestTool = () => { const t = ensureG7().tools; return t.axe ? 'axe' : t.pick ? 'pick' : 'hand'; };

  // ---- walk up, press E: the world's own interact list (gaze prompt, click or E runs the first, R the second)
  function register(f) {
    if (!inter) return;
    const D = FIXTURES[f.kind];
    inter.add({ id: 'fx-' + f.id, r: (D?.r || 0.5) + 1.1, gazeH: 1.1, priority: 0.5,
      enabled: () => S.fx.has(f.id) && !!fpos(f),
      at: () => { const p = fpos(f) || { x: 1e9, y: 0, z: 1e9 }; return { x: p.x, y: p.y + 0.5, z: p.z }; },
      actions: () => {
        const g = S.fx.get(f.id); if (!g) return [];
        const mine = g.owner === myId(), out = [];
        if (g.kind === 'spill') return [{ label: 'Pick through the spilled things', icon: 'bag', run: async () => send({ k: 'sopen', id: g.id }) }];
        if (D.kind === 'station') out.push({ label: D.verb, icon: g.kind === 'fire' ? 'star' : 'leaf', run: async () => openStationMenu(g) });
        else out.push({ label: locked(g.kind) && !mine && g.owner !== 'world' ? `Try the ${g.kind}` : D.verb, icon: 'bag', run: async () => send({ k: 'sopen', id: g.id }) });
        if (mine) out.push({ label: 'Take it down', icon: 'build', run: async () => send({ k: 'sdown', id: g.id }) });
        else if (FIXTURES[g.kind].hp) out.push({ label: g.kind === 'locker' ? 'Pry it open' : 'Break it open', icon: 'build', run: async () => { send({ k: 'shit', id: g.id, tool: bestTool() }); hit(g); } });
        return out;
      } });
  }
  function hit(g) { const o = meshes.get(g.id); if (o) { o.userData.shake = 0.35; } sound(g.kind === 'locker' ? 'stone' : 'wood', 1); const p = player(); if (p?.act) { try { p.act('push', 0.4); } catch { /* */ } } }
  function openStationMenu(f) {
    const h = hud(); if (!h) return;
    const hooks = dbg().sb?.craftHooks || {};
    openStation(h, [f.kind], { onProp: hooks.onProp, after: (r) => { hooks.after && hooks.after(r); sound(f.kind === 'forge' ? 'stone' : 'wood', 0.8); } });
  }

  // ---- the craft gate (js/game/skills.js tryCraft): a station recipe is asked of the server first
  function ask(r, cb) {
    const ref = 'c' + (++refN);
    pend.set(ref, { cb, t: performance.now() });
    send({ k: 'scraft', r: r.id, ref });
    setTimeout(() => { const p = pend.get(ref); if (p) { pend.delete(ref); cb(false, 'No answer from the server. Try again in a moment.'); } }, 5000);
  }

  // ---- a box's own menu: its slots on the left, your bag and hands on the right; click moves one, shift-click
  // (or the "all" chip) moves the whole stack; drag from one side to the other works too
  let moveN = 1;
  const bagIds = () => Object.entries(game.data.inv).filter(([k, n]) => n > 0 && !/^fx:/.test(k)).map(([k]) => k);
  function boxTab() {
    return { id: 'box', label: S.view ? ({ spill: 'Heap', chest: 'Crate', locker: 'Locker', safe: 'Safe' }[S.view.kind] || 'Box') : 'Box', icon: 'bag', render: (b) => {
      const v = S.view; if (!v) { b.innerHTML = '<p class="muted">Closed.</p>'; return; }
      const f = S.fx.get(v.id) || { kind: v.kind };
      const slots = [];
      for (const [k, n] of Object.entries(v.inv)) { let left = n; while (left > 0) { const s = Math.min(STACK, left); slots.push({ k, n: s }); left -= s; } }
      for (const o of v.objs) slots.push({ obj: o });
      const cell = (inner, attrs = '') => `<div class="zs-c" ${attrs}>${inner}</div>`;
      const itemCell = (k, n, side) => { const inf = itemInfo(k); return cell(`<span class="ic" style="color:${inf.color}">${icon(inf.icon)}</span><span class="nm">${esc(inf.name)}</span><span class="n">${n}</span>`, `draggable="true" data-side="${side}" data-k="${esc(k)}" data-n="${n}" title="${esc(inf.name)}: click 1, shift-click all"`); };
      const objCell = (o, side) => cell(`<span class="ic" style="color:#d9c9a6">${icon('star')}</span><span class="nm">${esc(nameOf(o.k))}</span><span class="n">1</span>`, `draggable="true" data-side="${side}" data-o="${esc(o.id)}"`);
      const inBox = slots.map((s) => (s.obj ? objCell(s.obj, 'box') : itemCell(s.k, s.n, 'box')));
      for (let i = slots.length; i < v.slots; i++) inBox.push(cell('', 'data-empty="1"'));
      const hands = held();
      const who = v.kind === 'spill' ? 'Anyone can pick through what spilled from a broken crate, for a while.' : locked(v.kind) ? (v.mine ? `Your ${v.kind}. It opens only for you and the friends you add.${v.kind === 'locker' ? ' Someone with a real tool could pry it open: the safe is the one nothing breaks.' : ''}` : `${esc(f.oname || 'Someone')}'s ${v.kind}: they let you in.`) : f.owner === 'world' ? 'The garden\'s crate.' : v.mine ? 'Your crate. Anyone can open a crate: lock up what matters in a safe.' : `${esc(f.oname || 'Someone')}'s crate. It isn't locked.`;
      let allow = '';
      if (locked(v.kind) && v.mine) {
        const list = (v.allow || []).map((a) => `<span class="chip">${esc(a.name || 'a friend')} <button class="b sm" data-unallow="${a.id}">remove</button></span>`).join(' ') || '<span class="muted">nobody else</span>';
        const close = peerList().filter((p) => p.at && !(v.allow || []).some((a) => a.id === p.id) && (() => { const q = player()?.position; return q && Math.hypot(p.at[0] - q.x, p.at[2] - q.z) < 8; })());
        allow = `<h3>Opens for</h3><p>${list}</p>${close.length ? `<p class="muted" style="font-size:13px">Add someone standing near you: ${close.map((p) => `<button class="b sm" data-allow="${p.id}">${esc(p.name)}</button>`).join(' ')}</p>` : '<p class="muted" style="font-size:13px">To add a friend, stand here together and open it.</p>'}`;
      }
      b.innerHTML = `<style>
#hud-panel .zs-g{display:grid;grid-template-columns:repeat(5,1fr);gap:6px;margin:6px 0 10px}
#hud-panel .zs-c{min-height:54px;border-radius:10px;background:rgba(239,230,210,.06);border:1px solid rgba(239,230,210,.12);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:4px;font-size:11px;line-height:1.15;text-align:center;cursor:pointer;position:relative;user-select:none;-webkit-user-select:none}
#hud-panel .zs-c[data-empty]{cursor:default;opacity:.5}
#hud-panel .zs-c:hover:not([data-empty]){border-color:rgba(255,236,200,.5)}
#hud-panel .zs-c .ic{width:20px;height:20px;display:inline-flex}#hud-panel .zs-c .nm{opacity:.85;margin-top:2px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#hud-panel .zs-c .n{position:absolute;top:3px;right:6px;font-variant-numeric:tabular-nums;opacity:.9}
#hud-panel .zs-g.drop{outline:2px dashed rgba(255,236,200,.5);outline-offset:3px;border-radius:10px}
#hud-panel .zs-mv .chip{cursor:pointer}#hud-panel .zs-mv .chip.on{outline:1px solid rgba(255,236,200,.7)}
#hud-panel .b.sm{padding:2px 8px;font-size:12px}
</style>
<p class="muted" style="margin:4px 0 8px">${who}</p>
<div class="zs-mv">Move: ${[1, 10, 'all'].map((n) => `<span class="chip ${moveN === n ? 'on' : ''}" data-mv="${n}">${n}</span>`).join(' ')} <span class="muted" style="font-size:12px">(shift-click moves a whole stack)</span></div>
<h3>${esc(nameFor(f))} · ${v.used}/${v.slots} slots${FIXTURES[v.kind]?.hp && v.hp < FIXTURES[v.kind].hp ? ` · ${v.kind === 'locker' ? 'bent' : 'cracked'} (${v.hp}/${FIXTURES[v.kind].hp})` : ''}</h3>
<div class="zs-g" data-zone="box">${inBox.join('')}</div>
${v.kind === 'spill' ? '' : `<h3>Your hands · ${hands.length}/${S.carry}</h3><div class="zs-g" data-zone="me">${hands.map((o) => objCell(o, 'hands')).join('') || '<span class="muted" style="grid-column:1/-1;font-size:13px">Nothing in your hands.</span>'}</div>
<h3>Your bag</h3><div class="zs-g" data-zone="me">${bagIds().map((k) => itemCell(k, game.count(k), 'bag')).join('') || '<span class="muted" style="grid-column:1/-1;font-size:13px">Your bag is empty.</span>'}</div>`}
${v.kind === 'spill' ? `<h3>Your hands · ${hands.length}/${S.carry}</h3>` : ''}
${allow}`;
      const amount = (n, e) => (e.shiftKey || moveN === 'all' ? n : Math.min(n, moveN));
      const move = (d, e) => {
        if (d.dataset.o) { send({ k: d.dataset.side === 'box' ? 'stakeo' : 'sputo', id: v.id, iid: d.dataset.o }); sound('wood', 0.3); return; }
        const k = d.dataset.k; if (!k) return; const n = amount(+d.dataset.n, e);
        if (d.dataset.side === 'box') send({ k: 'stake', id: v.id, item: k, n });
        else if (v.kind !== 'spill') { const have = Math.min(n, game.count(k)); if (have > 0 && game.take(k, have)) send({ k: 'sput', id: v.id, item: k, n: have }); }
        sound('sand', 0.3);
      };
      b.querySelectorAll('.zs-c[data-side]').forEach((d) => {
        d.addEventListener('pointerdown', (e) => { e.stopPropagation(); });
        d.addEventListener('click', (e) => { e.stopPropagation(); move(d, e); });
        d.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', JSON.stringify({ side: d.dataset.side, k: d.dataset.k, n: d.dataset.n, o: d.dataset.o })); });
      });
      b.querySelectorAll('.zs-g[data-zone]').forEach((z) => {
        z.addEventListener('dragover', (e) => { e.preventDefault(); z.classList.add('drop'); });
        z.addEventListener('dragleave', () => z.classList.remove('drop'));
        z.addEventListener('drop', (e) => {
          e.preventDefault(); z.classList.remove('drop');
          let d; try { d = JSON.parse(e.dataTransfer.getData('text/plain')); } catch { return; }
          const fromBox = d.side === 'box', toBox = z.dataset.zone === 'box'; if (fromBox === toBox) return;
          move({ dataset: { side: d.side, k: d.k, n: d.n, o: d.o } }, { shiftKey: true });
        });
      });
      b.querySelectorAll('[data-mv]').forEach((c) => c.addEventListener('pointerdown', (e) => { e.stopPropagation(); moveN = c.dataset.mv === 'all' ? 'all' : +c.dataset.mv; hud()?.renderPanel(); }));
      b.querySelectorAll('[data-allow]').forEach((c) => c.addEventListener('pointerdown', (e) => { e.stopPropagation(); send({ k: 'sallow', id: v.id, to: c.dataset.allow, on: 1 }); }));
      b.querySelectorAll('[data-unallow]').forEach((c) => c.addEventListener('pointerdown', (e) => { e.stopPropagation(); send({ k: 'sallow', id: v.id, to: c.dataset.unallow, on: 0 }); }));
    } };
  }
  function showBox(m) {
    const first = !S.view || S.view.id !== m.id;
    S.view = m; if (m.carry) S.carry = m.carry;
    const h = hud(); if (!h) return;
    if (first || !h.panelOpen) { h.openPanel([boxTab()], 'box'); setLid(m.id, 1); sound('wood', 0.7); }
    else h.renderPanel();
  }
  function closeBox() { if (!S.view) return; send({ k: 'sclose', id: S.view.id }); setLid(S.view.id, 0); S.view = null; }
  function setLid(id, on) { S.lids.set(id, on); }

  // ---- setting a thing down: a ghost that follows your aim; E or click to set it down, R to turn it, Esc to stop
  const okM = new THREE.MeshBasicMaterial({ color: 0xbfe8b0, transparent: true, opacity: 0.35, depthWrite: false });
  const badM = new THREE.MeshBasicMaterial({ color: 0xe8a0a0, transparent: true, opacity: 0.35, depthWrite: false });
  function startPlace(item) {
    const kind = Object.keys(FIXTURES).find((k) => FIXTURES[k].item === item); if (!kind || !game.count(item)) return;
    stopPlace();
    const g = MAKE[kind](); g.traverse((o) => { if (o.isMesh) { o.material = okM; o.castShadow = false; } }); passable(g, 'placement preview'); root.add(g);
    place = { kind, item, g, yaw: 0, ok: false, x: 0, y: 0, z: 0 };
    hud()?.closePanel(); hud()?.toast(`Setting down the ${FIXTURES[kind].name.toLowerCase()}: aim where it goes, E or click to set it down, R to turn it, Esc to stop.`, 'build', 6000);
  }
  function stopPlace() { if (place) { root.remove(place.g); place = null; } }
  function placeTick() {
    if (!place) return;
    const cam = camera(), p = player()?.position; if (!cam || !p) return;
    const dir = new THREE.Vector3(); cam.getWorldDirection(dir); dir.y = 0; if (dir.lengthSq() < 1e-6) return; dir.normalize();
    const x = p.x + dir.x * 1.9, z = p.z + dir.z * 1.9, y = groundY(x, z);
    place.x = x; place.y = y; place.z = z;
    place.g.position.set(x, y, z); place.g.rotation.y = place.yaw + Math.atan2(dir.x, dir.z) + Math.PI;
    let ok = Math.hypot(x - p.x, z - p.z) < PLACE_R && Math.abs(y - p.y) < 2.4;
    for (const f of S.fx.values()) { const q = fpos(f); if (q && Math.hypot(q.x - x, q.z - z) < 1.2) ok = false; }
    if (ok !== place.ok) { place.ok = ok; place.g.traverse((o) => { if (o.isMesh) o.material = ok ? okM : badM; }); }
  }
  function confirmPlace() {
    if (!place) return false;
    if (!place.ok) { hud()?.toast('Not there: find open, level ground.', 'build', 2000); return true; }
    if (!game.take(place.item, 1)) { stopPlace(); return true; }
    const ref = 'p' + (++refN);
    send({ k: 'splace', kind: place.kind, x: +place.x.toFixed(2), y: +place.y.toFixed(2), z: +place.z.toFixed(2), yaw: +place.g.rotation.y.toFixed(3), tile: myTile() || '', ref });
    sound(place.kind === 'safe' || place.kind === 'locker' || place.kind === 'forge' ? 'stone' : 'wood', 1);
    stopPlace(); return true;
  }
  addEventListener('keydown', (e) => {
    if (!place || e.repeat) return;
    if (e.code === 'Escape') { stopPlace(); e.stopImmediatePropagation(); e.preventDefault(); }
    else if (e.code === 'KeyE' || e.code === 'Enter') { confirmPlace(); e.stopImmediatePropagation(); e.preventDefault(); }
    else if (e.code === 'KeyR') { place.yaw += Math.PI / 4; e.stopImmediatePropagation(); e.preventDefault(); }
  }, true);
  addEventListener('pointerdown', (e) => { if (place && e.button === 0 && !(e.target && e.target.closest && e.target.closest('#hud-panel,#hud-top,#mp,#cmp'))) { confirmPlace(); e.stopImmediatePropagation(); e.preventDefault(); } }, true);
  // the bag's "Set down" buttons (js/game/hud.js itemsHtml)
  addEventListener('pointerdown', (e) => { const b = e.target && e.target.closest && e.target.closest('[data-setdown]'); if (b) { e.stopPropagation(); e.preventDefault(); startPlace(b.dataset.setdown); } }, true);

  // ---- what you wear that lets you carry more, told to the server (it sizes your hands)
  let gearKey = '';
  function tellGear() { const g = ['satchel', 'acc_pack'].filter((k) => hasGear(k)); const key = g.join(','); if (key === gearKey) return; gearKey = key; send({ k: 'sgear', gear: g }); }
  game.on((e) => { if (e.type === 'unlock') tellGear(); });

  // ---- messages from the server
  function onMsg(m) {
    switch (m.k) {
      case 'sfix': for (const id of [...S.fx.keys()]) drop(id); for (const w of m.list || []) { const f = unwire(w); S.fx.set(f.id, f); register(f); } if (m.carry) S.carry = m.carry; gearKey = ''; tellGear(); break;
      case 'sone': { const f = unwire(m.f); const was = S.fx.get(f.id); S.fx.set(f.id, f); if (!was) register(f); if (m.by && m.by === myId() && m.ref) hud()?.toast(`${FIXTURES[f.kind].name} set down. Walk up to it and press E.`, 'build', 3600); else if (m.by && m.by !== myId() && !was) { /* someone else's: it simply appears */ } break; }
      case 'sgone': if (S.view && S.view.id === m.id) { hud()?.closePanel(); S.view = null; } drop(m.id); if (m.why === 'broken') sound('wood', 1); break;
      case 'sbox': showBox(m); break;
      case 'sshut': if (S.view && S.view.id === m.id) { S.view = null; hud()?.closePanel(); } break;
      case 'sno': hud()?.toast(m.text, 'build', 3200); break;
      case 'sgot': if (m.give) for (const [k, n] of Object.entries(m.give)) if (Number.isInteger(n) && n > 0 && n <= 9999 && typeof k === 'string') game.add(k, n); if (m.text) hud()?.toast(m.text, 'bag', 2600); if (S.view && hud()?.panelOpen) hud().renderPanel(); break;
      case 'scarry': S.carry = m.carry; break;
      case 'shp': { const f = S.fx.get(m.id); if (f) f.hp = m.hp; const o = meshes.get(m.id); if (o) o.userData.shake = 0.35; if (m.by === myId()) hud()?.toast(`${f && f.kind === 'locker' ? 'The locker door bends' : 'The crate cracks'}… ${Math.round((1 - m.hp / m.max) * 100)}%`, 'build', 1200); break; }
      case 'slid': setLid(m.id, m.on); break;
      case 'scraft': { const p = pend.get(m.ref); if (p) { pend.delete(m.ref); p.cb(!!m.ok, m.why); } break; }
      default: return;
    }
    syncAll();
  }
  function reset() { for (const id of [...S.fx.keys()]) drop(id); S.view = null; stopPlace(); }

  // ---- per frame: lids, flames, the ghost, a box menu closed by the player
  let last = performance.now();
  function tick() {
    const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000); last = now;
    attach(); placeTick();
    if (S.view && !hud()?.panelOpen) closeBox();
    if (S.view) { const f = S.fx.get(S.view.id); if (f && !near(f, BOX_R + 0.6)) { hud()?.closePanel(); closeBox(); } }
    for (const [id, o] of meshes) {
      const u = o.userData;
      if (u.lid) { const want = S.lids.get(id) ? LID_OPEN[u.kind] || -1.2 : 0; const ax = SIDE_HINGE[u.kind] ? 'y' : 'x'; u.lid.rotation[ax] += (want - u.lid.rotation[ax]) * Math.min(1, dt * (want ? 5 : 7)); }
      if (u.flame) { const k = 0.85 + 0.15 * Math.sin(now / 90 + id.length) + 0.08 * Math.sin(now / 37); u.flame.scale.set(1, k, 1); u.flame.material.opacity = 0.55 + 0.2 * k; }
      if (u.glow) u.glow.material.emissiveIntensity = 0.8 + 0.25 * Math.sin(now / 300 + id.length * 0.7);
      if (u.shake > 0) { u.shake = Math.max(0, u.shake - dt); o.rotation.z = Math.sin(now / 25) * 0.04 * (u.shake / 0.35); } else if (o.rotation.z) o.rotation.z = 0;
      if (u.label) { const p = player()?.position; const d = p ? Math.hypot(p.x - o.position.x, p.z - o.position.z) : 99; u.label.material.opacity += ((d < 4.5 ? 0.95 : 0) - u.label.material.opacity) * Math.min(1, dt * 4); u.label.visible = u.label.material.opacity > 0.02; }
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
  setInterval(() => { if (S.fx.size) syncAll(); }, 3000); // re-seat things when the ground under them streams in

  const api = { online: true, ask, get placing() { return !!place; }, onMsg, reset, state: S, startPlace, get carry() { return S.carry; }, near: (kind) => [...S.fx.values()].some((f) => f.kind === kind && near(f, STATION_R)), meshes };
  window.__zenStorage = api;
  void chatLine; void slotsUsed;
  return api;
}
