// Compete and co-op games, Ula the stone-keeper, the hidden vault and real carried objects (client side).
// The server decides everything; this file only draws what the server says, shows prompts, and sends
// intents ({t:'g', k:'take', iid}). Keys: E = the nearest sensible action, Q = shove, H = hand over, Z = drop.
// Started by net.js only when the server says it has games (hi.games), so an older server never sees 't:g'.
import * as THREE from 'three';
import { OPEN_STEPS } from './opening.js';
import { VAULT, vaultBlocks, vaultShapes, placeShapes, BODY } from './solids.js';
import { solid, passable } from './solids-bake.js';
import { startStorage } from './storage.js';

const STONE_COL = { quartz: 0xe9e4da, jasper: 0xb2442f, agate: 0x8c6fb0, obsidian: 0x1b1a20 };
const STONE_PTS = { quartz: 1, jasper: 2, agate: 3, obsidian: 5 };
const ITEM_NAME = { fish: 'fish', hearthstone: 'cracked hearthstone', cell: 'propellant cell', pearl: 'sea-cave pearl', geode: 'geode', amber: 'amber', trilobite: 'trilobite fossil', meteorite: 'meteorite iron', coin: 'old silver coin', blade: 'obsidian blade' };
const MODE_NAME = { race: 'Checkpoint race', hunt: 'Stone hunt', cairn: 'Raise a cairn (co-op)', ring: 'Sparring ring' };
const MODE_HELP = {
  race: 'Lay gates by walking the course (Add gate here at each one), then race it. Fastest time wins.',
  hunt: 'Pick up stones (E), carry up to 3, bank them at your cache (E). Rarer stones score more. Raid the other cache (E) and shove (Q) to knock stones loose.',
  cairn: 'Work together: gather stones, hand them over (H), and stack them on the cairn (E) before time runs out.',
  ring: 'Shove (Q) your rival out of the ring. Best of three.',
};
const REACH = 1.9;

export function startCompete({ worlds, send, me, peerList, toLocal, chatLine }) {
  const S = { game: null, course: [], board: [], keeper: null, quest: 0, items: { ground: [], carried: {} }, vault: null, ula: { yaw: 0 }, off: 0, warm: 0, digN: 0, open: null };
  const root = new THREE.Group(); root.name = 'compete';
  let scene = null;
  // things set down: stations, chests and safes (js/storage.js); it also knows how many things your hands hold
  const ST = startStorage({ worlds, send, me, toLocal, peerList, chatLine, held: () => S.items.carried[me()?.id] || [], nameOf: (k) => ITEM_NAME[k] || k });
  const objs = { stones: new Map(), items: new Map(), gates: [], caches: [], cairn: null, ring: null, ula: null, vault: null };

  const W = () => worlds.current;
  const player = () => { const w = W(); return w?.debug?.player || w?.debug?.core?.player || w?.debug?.game?.player || null; };
  const myId = () => me()?.id;
  const loc = (p) => (p ? toLocal({ x: p.x, z: p.z, yaw: 0, tile: p.tile || null, y: 0 }) : null);
  const groundY = (x, z) => { const pl = player(); try { const y = pl?.ground ? pl.ground(x, z) : pl?.position?.y; return Number.isFinite(y) ? y : (pl?.position?.y || 0); } catch { return pl?.position?.y || 0; } };
  const myPos = () => { const p = player(); return p ? p.position : null; };
  const dist2 = (p, l) => { const m = myPos(); return m && l ? Math.hypot(m.x - l.x, m.z - l.z) : Infinity; };

  // ---- meshes
  const mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, ...o });
  function label(text, w = 1.4) {
    const c = document.createElement('canvas'); c.width = 320; c.height = 64;
    const x = c.getContext('2d'); x.font = '600 28px system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    const tw = Math.min(310, x.measureText(text).width + 26);
    x.fillStyle = 'rgba(20,26,34,0.6)'; x.beginPath(); x.roundRect((320 - tw) / 2, 8, tw, 48, 24); x.fill();
    x.fillStyle = '#f6f1e7'; x.fillText(text, 160, 33);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
    s.scale.set(w, w * 0.2, 1); s.renderOrder = 10; return s;
  }
  function stoneMesh(k) {
    const m = new THREE.Mesh(new THREE.DodecahedronGeometry(0.14, 0), mat(STONE_COL[k] || 0xcccccc, { roughness: k === 'obsidian' ? 0.15 : 0.7, emissive: STONE_COL[k], emissiveIntensity: 0.12 }));
    m.castShadow = true; m.scale.set(1, 0.75, 1.1); return m;
  }
  function itemMesh(k) {
    let m;
    if (k === 'geode') { m = new THREE.Group(); const a = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 10), mat(0x8a8580)); const b = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), mat(0x9a62c8, { emissive: 0x5a2a88, emissiveIntensity: 0.5 })); b.position.y = 0.08; m.add(a, b); }
    else if (k === 'amber') m = new THREE.Mesh(new THREE.SphereGeometry(0.11, 14, 10), mat(0xe39a2c, { roughness: 0.2, transparent: true, opacity: 0.85, emissive: 0x7a3c00, emissiveIntensity: 0.4 }));
    else if (k === 'trilobite') { m = new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 8), mat(0x8c8273)); m.scale.set(1, 0.3, 1.4); }
    else if (k === 'meteorite') m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.14, 1), mat(0x3b3631, { metalness: 0.7, roughness: 0.5 }));
    else if (k === 'coin') { m = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.015, 20), mat(0xb8bcc0, { metalness: 0.9, roughness: 0.35 })); }
    else if (k === 'blade') { m = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.3, 4), mat(0x101014, { roughness: 0.1 })); m.rotation.z = Math.PI / 2; }
    // the place relics (js/places.js): a flat river-stone slab with a family mark, a sealed metal cell, a pearl
    else if (k === 'hearthstone') { m = new THREE.Mesh(new THREE.DodecahedronGeometry(0.2, 1), mat(0x8c8579, { roughness: 0.9 })); m.scale.set(1.2, 0.32, 0.9); }
    else if (k === 'cell') { m = new THREE.Group(); const c = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.32, 14), mat(0x6b6e70, { metalness: 0.6, roughness: 0.45 })); c.rotation.z = Math.PI / 2; const b = new THREE.Mesh(new THREE.CylinderGeometry(0.078, 0.078, 0.06, 14), mat(0xa0703a, { roughness: 0.7 })); b.rotation.z = Math.PI / 2; m.add(c, b); }
    else if (k === 'pearl') m = new THREE.Mesh(new THREE.SphereGeometry(0.06, 18, 12), new THREE.MeshPhysicalMaterial({ color: 0xe9e3d6, roughness: 0.25, sheen: 1, sheenColor: new THREE.Color(0xd8e4ee), clearcoat: 0.6 }));
    // a fish from the cove: a slim spindle, darker back, pale belly, a forked tail
    else if (k === 'fish') { m = new THREE.Group(); const b = new THREE.Mesh(new THREE.SphereGeometry(0.06, 14, 10), mat(0x6f7a72, { roughness: 0.35, metalness: 0.15 })); b.scale.set(3.2, 1, 0.7); m.add(b);
      const tl = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.1, 3), mat(0x5b655e, { roughness: 0.5 })); tl.rotation.z = Math.PI / 2; tl.scale.set(1, 1, 0.25); tl.position.x = -0.22; m.add(tl); }
    else m = stoneMesh('quartz');
    m.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    return m;
  }
  function gateMesh(i, n) {
    const g = new THREE.Group();
    const col = i === 0 ? 0x8fd39a : i === n - 1 ? 0xe6c86e : 0x9db4c0;
    for (const s of [-1.6, 1.6]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 2.3, 8), mat(0x6b5a45)); p.position.set(s, 1.15, 0); g.add(p); const f = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.3, 3), mat(col, { emissive: col, emissiveIntensity: 0.3 })); f.position.set(s, 2.4, 0); g.add(f); }
    const l = label(i === 0 ? 'Start' : i === n - 1 ? 'Finish' : `Gate ${i + 1}`, 1.2); l.position.y = 2.75; g.add(l);
    g.userData.col = col; return g;
  }
  function ringLine(r, col) {
    const pts = []; for (let i = 0; i <= 72; i++) { const a = (i / 72) * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r)); }
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.9 }));
    line.userData.r = r; return line;
  }
  function ulaMesh() {
    const g = new THREE.Group();
    const robe = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.35, 14), mat(0x8a5a33)); robe.position.y = 0.68; g.add(robe);
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.35, 6, 12), mat(0x6d4a2c)); body.position.y = 1.25; g.add(body);
    const head = new THREE.Group(); head.position.y = 1.62; g.add(head);
    head.add(new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), mat(0xc79a72)));
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xd9d4cc)); hair.position.y = 0.02; hair.rotation.x = -0.35; head.add(hair);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.07, 6), mat(0xb88a62)); nose.rotation.x = Math.PI / 2; nose.position.set(0, -0.01, 0.16); head.add(nose);
    const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 1.8, 6), mat(0x5a4632)); staff.position.set(0.38, 0.9, 0.1); g.add(staff);
    const pile = new THREE.Group(); for (let i = 0; i < 7; i++) { const s = stoneMesh(['quartz', 'jasper', 'agate', 'obsidian'][i % 4]); s.position.set(-0.6 + Math.cos(i) * 0.25, 0.08 + (i > 4 ? 0.15 : 0), 0.3 + Math.sin(i) * 0.25); pile.add(s); } g.add(pile);
    const l = label('Ula, the stone-keeper', 1.6); l.position.y = 2.1; g.add(l);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    g.userData.head = head; return g;
  }
  function vaultMesh(v) {
    const g = new THREE.Group();
    const stone = mat(0x77736b), dark = mat(0x4d4a45);
    const R = VAULT.R, B = VAULT.block; // one definition (js/solids.js) for these stones and for what blocks you
    for (const k of vaultBlocks()) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(B.w, B.h, B.d), stone); b.position.set(k.x, B.h / 2, k.z); b.rotation.y = k.ry; b.castShadow = b.receiveShadow = true;
      b.userData.back = k.back; g.add(b);
    }
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.4, R + 0.5, 0.35, 20), dark); roof.position.y = 2.25; roof.castShadow = true; g.add(roof);
    const slab = new THREE.Mesh(new THREE.BoxGeometry(VAULT.slab.w, VAULT.slab.h, VAULT.slab.d), dark); slab.position.set(R, VAULT.slab.h / 2, 0); slab.castShadow = true; g.add(slab);
    const lockM = new THREE.Mesh(new THREE.BoxGeometry(VAULT.lock.s, VAULT.lock.s, VAULT.lock.s), mat(0x5a5650)); g.add(lockM);
    const socket = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.05, 6), mat(0x222222, { emissive: 0x000000 })); socket.rotation.z = Math.PI / 2; socket.position.x = 0.16; lockM.add(socket);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.12, 1.4), mat(0x8d7f6a)); g.add(plate);
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1, 5), mat(0x9b8a63)); g.add(rope);
    const dirt = new THREE.Mesh(new THREE.SphereGeometry(0.7, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x6b5136)); dirt.visible = false; g.add(dirt);
    g.userData = { slab, lockM, socket, plate, rope, dirt, slabY: VAULT.slab.h / 2 };
    solid(g, { name: 'vault' }); passable(plate, 'pressure plate, flush with the ground'); passable(dirt, 'loose spoil from the tunnel'); passable(rope, 'counterweight rope, overhead');
    return g;
  }

  // ---- scene sync
  function attach() {
    const sc = W()?.scene;
    if (sc !== scene) { scene?.remove(root); sc?.add(root); scene = sc; }
  }
  function place(o, p, lift = 0) {
    const l = loc(p); if (!l) { o.visible = false; return null; }
    o.visible = true; o.position.set(l.x, groundY(l.x, l.z) + lift, l.z); return l;
  }
  function clearMap(mp) { for (const o of mp.values()) root.remove(o); mp.clear(); }
  function syncStones() {
    const want = new Map((S.game?.stones || []).map((s) => [s.id, s]));
    for (const [id, o] of objs.stones) if (!want.has(id)) { root.remove(o); objs.stones.delete(id); }
    for (const [id, s] of want) { let o = objs.stones.get(id); if (!o) { o = stoneMesh(s.k); objs.stones.set(id, o); root.add(o); } place(o, s, 0.1); o.userData.s = s; }
  }
  function syncItems() {
    const want = new Map(S.items.ground.map((s) => [s.id, s]));
    for (const [id, o] of objs.items) if (!want.has(id)) { root.remove(o); objs.items.delete(id); }
    for (const [id, s] of want) { let o = objs.items.get(id); if (!o) { o = itemMesh(s.k); objs.items.set(id, o); root.add(o); } place(o, s, 0.12); o.userData.s = s; }
  }
  function syncGates() {
    for (const o of objs.gates) root.remove(o); objs.gates = [];
    const gates = S.game?.mode === 'race' && S.game.gates ? S.game.gates : S.course;
    gates.forEach((gp, i) => { const o = gateMesh(i, gates.length); place(o, gp); const nx = gates[i + 1] || gates[i - 1]; const l = loc(gp), ln = nx && loc(nx); if (l && ln) o.rotation.y = Math.atan2(ln.x - l.x, ln.z - l.z) + Math.PI / 2; objs.gates.push(o); root.add(o); });
  }
  function syncArena() {
    for (const o of objs.caches) root.remove(o); objs.caches = [];
    if (objs.cairn) { root.remove(objs.cairn); objs.cairn = null; }
    if (objs.ring) { root.remove(objs.ring); objs.ring = null; }
    const g = S.game; if (!g) return;
    for (const [id, c] of Object.entries(g.caches || {})) {
      const o = new THREE.Group();
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.8, 0.12, 14), mat(id === myId() ? 0x6f9a78 : 0x9a6f6f)); base.position.y = 0.06; o.add(base);
      c.n.forEach((k, i) => { const s = stoneMesh(k); s.position.set(Math.cos(i * 2.4) * 0.35, 0.18 + Math.floor(i / 5) * 0.16, Math.sin(i * 2.4) * 0.35); o.add(s); });
      const l = label(`${g.players[id]?.name || '?'}'s cache`, 1.3); l.position.y = 1.2; o.add(l);
      place(o, c); objs.caches.push(o); root.add(o);
    }
    if (g.cairn) {
      const o = new THREE.Group();
      for (let i = 0; i < g.cairn.n; i++) { const s = new THREE.Mesh(new THREE.DodecahedronGeometry(0.28 - Math.min(0.18, i * 0.012), 0), mat([0x9a948a, 0x857f76, 0xa59f94][i % 3])); s.scale.y = 0.6; s.position.set(Math.sin(i * 1.7) * 0.06, 0.12 + i * 0.2, Math.cos(i * 1.7) * 0.06); s.castShadow = true; o.add(s); }
      const l = label(`Cairn ${g.cairn.n} / ${g.cairn.goal}`, 1.3); l.position.y = 0.6 + g.cairn.n * 0.2 + 0.4; o.add(l);
      place(o, g.cairn); objs.cairn = o; root.add(o);
    }
    if (g.ring) { objs.ring = ringLine(g.ring.r, 0xe6c86e); place(objs.ring, g.ring, 0.05); root.add(objs.ring); }
  }
  function syncUla() {
    if (!S.keeper) return;
    if (!objs.ula) { objs.ula = ulaMesh(); root.add(objs.ula); }
    place(objs.ula, S.keeper);
  }
  function syncVault() {
    if (!S.vault) return;
    if (!objs.vault) { objs.vault = vaultMesh(S.vault); root.add(objs.vault); }
    const v = S.vault, o = objs.vault, l = place(o, v); if (!l) return;
    const u = o.userData;
    const pl = loc(v.plate), lk = loc(v.lock);
    if (pl) { u.plate.position.set(pl.x - l.x, groundY(pl.x, pl.z) - o.position.y + (v.open ? 0.02 : 0.08), pl.z - l.z); u.rope.position.set((pl.x - l.x + v.r) / 2, 2.2, 0); u.rope.scale.y = 1; u.rope.rotation.z = Math.PI / 2; u.rope.scale.y = Math.max(0.5, pl.x - l.x - v.r); }
    if (lk) u.lockM.position.set(lk.x - l.x, VAULT.lock.y, lk.z - l.z);
    u.socket.material.emissive.setHex(v.locked ? 0x000000 : 0x7a3cc8); u.socket.material.emissiveIntensity = v.locked ? 0 : 0.9;
    u.target = v.open ? 3.0 : u.slabY;
    for (const c of o.children) if (c.userData.back) c.visible = !v.tunnel;
    u.dirt.visible = !!v.tunnel; u.dirt.position.set(-v.r - 1.2, 0, 0);
  }
  function syncAll() { attach(); syncStones(); syncItems(); syncGates(); syncArena(); syncUla(); syncVault(); hud.render(); }

  // a new world (or a reconnect): forget the old world's things; the server sends them again
  function reset() {
    clearMap(objs.stones); clearMap(objs.items);
    for (const k of ['ula', 'vault']) if (objs[k]) { root.remove(objs[k]); objs[k] = null; }
    S.vault = null; S.items = { ground: [], carried: {} }; S.keeper = null; S.warm = 0;
    if (window.__zenPlaces) window.__zenPlaces.onServer({ k: 'reset' });
    if (window.__zenBuild) window.__zenBuild.onServer({ k: 'reset' }); else window.__zenBuildQ = [];
    if (window.__zenFauna) window.__zenFauna.onServer({ k: 'reset' });
    ST.reset();
  }
  // ---- messages from the server
  function onMsg(m) {
    switch (m.k) {
      case 'hello': reset(); send({ k: 'v' }); S.game = m.game; S.course = m.course || []; S.board = m.board || []; S.keeper = m.keeper; S.quest = m.quest || 0; S.open = m.open || null; hud.track(); if (m.ula) S.ula.yaw = m.ula.yaw; if (m.game) S.off = m.game.now - Date.now(); break;
      case 'state': { const was = S.game?.phase; S.game = m.game; if (m.game) S.off = m.game.now - Date.now(); if (m.game?.phase === 'done' && was !== 'done') announce(m.game); if (m.game?.phase === 'live' && was !== 'live') hud.flash(m.game.mode === 'race' ? 'GO!' : 'Go!'); break; }
      case 'invite': hud.invite(m); break;
      case 'course': S.course = m.gates || []; chatLine(null, m.gates.length ? `${m.by} laid gate ${m.gates.length}` : `${m.by} cleared the race course`); break;
      case 'board': S.board = m.board || []; break;
      case 'say': chatLine(null, m.text); break;
      case 'kb': { const p = player(); if (p?.impulse) p.impulse(m.dx * m.v, m.up, m.dz * m.v); hud.flash('Shoved!'); break; }
      case 'fx': if (m.hit === myId()) break; if (m.by === myId() && !m.hit) hud.flash('Missed'); break;
      case 'keeper': S.keeper = m.keeper; break;
      case 'ula': S.ula.yaw = m.yaw; S.ula.look = m.look; break;
      case 'npc': S.quest = m.quest; if (m.open) { S.open = { step: m.open, n: 0 }; hud.track(); } hud.npc(m.text); break;
      // Ula's opening walk (server/src/opening.js): her next ask, or how far along a counted step is
      case 'open': S.open = { step: m.step, n: m.n || 0 }; hud.track(); if (/^Ula:/.test(m.text)) hud.npc(m.by ? `Done together with ${m.by}. ${m.text}` : m.text); else hud.flash(m.text); break;
      case 'warm': S.warm = m.lvl; hud.flash(m.lvl >= 2 ? 'Something glints right near you…' : 'You catch a faint glint nearby…'); break;
      case 'egg': egg(m); break;
      case 'items': S.items = { ground: m.ground || [], carried: m.carried || {} }; break;
      case 'vault': { const first = !S.vault; S.vault = m.vault; if (first) chatLine(null, 'You see an old stone chamber, half buried. Its slab door has a socket in the lock.'); break; }
      case 'dig': S.digN = m.n; hud.flash(`Digging… ${Math.round((m.n / m.need) * 100)}%`); break;
      // points of interest (server/src/places.js): the garden game's places module draws and announces them
      case 'fauna': case 'fres': if (window.__zenFauna) window.__zenFauna.onServer(m); else if (m.k === 'fauna') window.__zenFaunaQ = [m]; break;
      case 'builds': case 'bput': case 'bdel': case 'bno': if (window.__zenBuild) window.__zenBuild.onServer(m); else (window.__zenBuildQ = window.__zenBuildQ || []).push(m); break;
      case 'fishok': hud.flash(m.full ? 'Caught! Your hands are full: it is at your feet.' : 'Caught! A fish in your hands.'); break;
      case 'fishout': hud.flash('It slipped the hook'); chatLine(null, m.text); break;
      case 'sfix': case 'sone': case 'sgone': case 'sbox': case 'sshut': case 'sno': case 'sgot': case 'scarry': case 'shp': case 'slid': case 'scraft': ST.onMsg(m); return;
      case 'pl': case 'pfound': case 'pdig': case 'pnode': case 'grant': PL.last = m; if (window.__zenPlaces) window.__zenPlaces.onServer(m); else PL.q.push(m); break;
    }
    syncAll();
  }
  function egg(m) {
    if (m.e === 'geode') { chatLine(null, m.id === myId() ? (m.full ? 'You found a hidden geode! Your hands are full, so it sits at your feet.' : 'You found a hidden geode! Ula would want to see it.') : `${m.name} found a hidden geode.`); hud.flash('Geode!'); }
    if (m.e === 'standoff') { chatLine(null, `Standoff! ${m.an} and ${m.bn} are staring each other down. First to move loses.`); hud.flash('Standoff! Don\'t move.'); }
    if (m.e === 'standoff-end') { chatLine(null, m.winner ? `${m.lname} flinched. ${m.name} wins the standoff.` : 'Nobody blinked. A draw.'); }
  }
  function announce(g) {
    const r = g.result; if (!r) return;
    const nm = (id) => g.players[id]?.name || '?';
    if (g.mode === 'cairn') chatLine(null, r.team ? `You raised the cairn together (${r.cairn}/${r.goal})!` : `Time's up: the cairn reached ${r.cairn}/${r.goal}.`);
    else if (r.winner) chatLine(null, `${nm(r.winner)} wins the ${MODE_NAME[g.mode].toLowerCase()}!`);
    else chatLine(null, `${MODE_NAME[g.mode]}: no winner${r.why ? ' (' + r.why + ')' : ''}.`);
    if (g.mode === 'race') for (const row of r.rows) chatLine(null, `${row.name}: ${row.ms != null ? (row.ms / 1000).toFixed(2) + ' s' : 'did not finish'}`);
    hud.flash(r.winner === myId() ? 'You win!' : g.mode === 'cairn' && r.team ? 'Cairn raised!' : 'Round over');
  }

  // ---- what E would do right here (nearest first)
  function context() {
    const g = S.game, me_ = myId(), live = g && g.phase === 'live' && g.players?.[me_];
    const mine = S.items.carried[me_] || [];
    const P = myPos(); if (!P) return null;
    const opts = [];
    if (S.keeper) { const l = loc(S.keeper); const d = dist2(null, l); if (d < 2.8) opts.push({ d, label: 'Talk to Ula', go: () => send({ k: 'talk' }) }); }
    for (const it of S.items.ground) { const l = loc(it); const d = dist2(null, l); if (d < REACH && mine.length < ST.carry) opts.push({ d: d - 0.3, label: `Pick up the ${ITEM_NAME[it.k] || it.k}`, go: () => send({ k: 'take', iid: it.id }) }); }
    if (live && (g.mode === 'hunt' || g.mode === 'cairn')) {
      const carry = g.players[me_].carry || [];
      for (const s of g.stones || []) { const d = dist2(null, loc(s)); if (d < REACH && carry.length < 3) opts.push({ d, label: `Pick up ${s.k} (${STONE_PTS[s.k]} pt)`, go: () => send({ k: 'grab', sid: s.id }) }); }
      if (g.mode === 'hunt') {
        for (const [id, c] of Object.entries(g.caches || {})) { const d = dist2(null, loc(c)); if (d > 2.6) continue; if (id === me_ && carry.length) opts.push({ d: d - 1, label: `Bank ${carry.length} stone${carry.length > 1 ? 's' : ''}`, go: () => send({ k: 'bank' }) }); if (id !== me_ && c.n.length && carry.length < 3) opts.push({ d, label: `Raid ${g.players[id]?.name}'s cache`, go: () => send({ k: 'raid' }) }); }
      } else if (g.cairn && carry.length) { const d = dist2(null, loc(g.cairn)); if (d < 2.6) opts.push({ d: d - 1, label: `Stack ${carry.length} on the cairn`, go: () => send({ k: 'bank' }) }); }
    }
    // a fish in your hands can go in your bag (to cook, salt or cut for bait); hand it to a Ranger or Raider instead to trade
    { const f = mine.find((i) => i.k === 'fish'); if (f) opts.push({ d: 9, label: 'Put the fish in your bag', go: () => send({ k: 'stow', id: f.id }) }); }
    if (S.vault) {
      const v = S.vault, lk = loc(v.lock), c = loc(v);
      if (lk && dist2(null, lk) < 2.4 && v.locked) opts.push({ d: dist2(null, lk), label: mine.some((i) => i.k === 'geode') ? 'Set the geode crystal in the lock' : 'Look at the lock', go: () => send({ k: 'unlock' }) });
      if (c && !v.locked && !v.open && !v.tunnel && dist2(null, c) < v.r - 0.2) opts.push({ d: 5, label: 'Dig at the loose back wall', go: () => send({ k: 'dig' }) });
    }
    opts.sort((a, b) => a.d - b.d);
    return opts[0] || null;
  }
  function nearestPeer(maxD = 2.4) {
    let best = null, bd = maxD;
    for (const p of peerList()) { if (!p.at) continue; const d = dist2(null, { x: p.at[0], z: p.at[2] }); if (d < bd) { bd = d; best = p; } }
    return best;
  }
  function shove() { send({ k: 'shove', ago: 80 }); const p = player(); if (p?.act) { try { p.act('push', 0.5); } catch { /* */ } } }
  function hand() {
    const p = nearestPeer(); if (!p) { hud.flash('Nobody close enough to hand to'); return; }
    const g = S.game;
    if (g && g.phase === 'live' && g.players?.[myId()]?.carry?.length && g.players[p.id]) send({ k: 'give', to: p.id });
    else send({ k: 'hand', to: p.id });
  }
  function drop() { send({ k: 'drop' }); }
  const typing = (e) => e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName);
  addEventListener('keydown', (e) => {
    if (e.repeat || typing(e) || !player() || ST.placing || document.querySelector('#gmenu.open,.menu.open')) return;
    if (e.code === 'KeyE') { const c = context(); if (c) { c.go(); e.stopImmediatePropagation(); e.preventDefault(); } }
    else if (e.code === 'KeyQ') { shove(); e.stopImmediatePropagation(); }
    else if (e.code === 'KeyH') { hand(); e.stopImmediatePropagation(); }
    else if (e.code === 'KeyZ') { if ((S.items.carried[myId()] || []).length) { drop(); e.stopImmediatePropagation(); } }
  }, true);

  // ---- HUD
  const hud = buildHud();
  // the places module may load after the first messages: it drains this queue when it hooks in
  const PL = (window.__zenPlacesNet = { q: [], last: null, send: (m) => send(m) });
  window.__zenMe = () => myId();
  window.__zenHeld = () => (S.items.carried[myId()] || []).map((i) => i.k); // what is in your hands (factions gifts)
  window.__zenVault = () => { const v = S.vault; if (!v || v.tile) return null; return { x: v.x, y: 0, z: v.z }; }; // map seal (garden frame only)
  function buildHud() {
    const css = document.createElement('style');
    css.textContent = `
#cmp{position:fixed;top:52px;right:12px;z-index:30;font:13px/1.35 system-ui,sans-serif;color:#f3eee4;user-select:none;-webkit-user-select:none;display:flex;flex-direction:column;align-items:flex-end;gap:6px}
#cmp .chip{background:rgba(18,24,32,.52);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,.12);border-radius:16px;padding:6px 11px;cursor:pointer}
#cmp .panel{width:290px;background:rgba(18,24,32,.8);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,.12);border-radius:14px;padding:12px;display:none;max-height:70vh;overflow:auto}
#cmp .panel.open{display:block}
#cmp h4{margin:8px 0 6px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#c9d6c4;font-weight:600}
#cmp button{background:#6f9a78;border:0;border-radius:9px;color:#fff;padding:6px 10px;font:inherit;cursor:pointer;margin:3px 4px 3px 0}
#cmp button.ghost{background:rgba(255,255,255,.1)}#cmp button.sel{outline:2px solid #e6c86e}
#cmp select{background:rgba(255,255,255,.08);color:#fff;border:1px solid rgba(255,255,255,.16);border-radius:8px;padding:5px;font:inherit;width:100%}
#cmp .muted{color:#aab3ad;font-size:12px}#cmp table{width:100%;border-collapse:collapse;font-size:12px}#cmp td{padding:2px 4px;border-bottom:1px solid rgba(255,255,255,.06)}#cmp td.r{text-align:right}
#cmpbar{position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:30;font:600 15px/1.3 system-ui,sans-serif;color:#fff;background:rgba(18,24,32,.6);border-radius:14px;padding:6px 14px;display:none;text-align:center;text-shadow:0 1px 2px rgba(0,0,0,.5)}
#cmpbar small{display:block;font-weight:400;font-size:12px;color:#d6e3d0}
#cmpflash{position:fixed;top:30%;left:50%;transform:translate(-50%,-50%);z-index:31;font:700 34px system-ui,sans-serif;color:#fff;text-shadow:0 2px 10px rgba(0,0,0,.6);pointer-events:none;opacity:0;transition:opacity .4s}
#cmpprompt{position:fixed;bottom:150px;left:50%;transform:translateX(-50%);z-index:30;font:14px system-ui,sans-serif;color:#fff;background:rgba(14,18,24,.55);border-radius:12px;padding:6px 12px;display:none}
#cmpprompt b{display:inline-block;min-width:18px;text-align:center;background:rgba(255,255,255,.18);border-radius:5px;margin-right:6px;padding:0 4px}
#cmpinv{position:fixed;top:64px;left:50%;transform:translateX(-50%);z-index:32;background:rgba(18,24,32,.88);border:1px solid rgba(255,255,255,.15);border-radius:14px;padding:10px 14px;font:14px system-ui,sans-serif;color:#fff;display:none;text-align:center}
#cmpinv button{background:#6f9a78;border:0;border-radius:9px;color:#fff;padding:6px 12px;font:inherit;cursor:pointer;margin:6px 4px 0}#cmpinv button.ghost{background:rgba(255,255,255,.12)}
#cmpnpc{position:fixed;bottom:200px;left:50%;transform:translateX(-50%);z-index:31;max-width:min(560px,86vw);background:rgba(40,30,20,.82);border:1px solid rgba(230,200,140,.35);border-radius:14px;padding:10px 14px;font:15px/1.45 Georgia,serif;color:#f6ecd8;display:none}
#cmpopen{position:fixed;top:14px;left:14px;z-index:30;display:none;max-width:240px;font:600 13px system-ui,sans-serif;color:#efe9dc;background:rgba(36,32,27,.66);border-left:3px solid #b9a27a;border-radius:4px 12px 12px 4px;padding:6px 12px 7px}
#cmpopen small{display:block;font-weight:500;font-size:11px;letter-spacing:.04em;color:#cfc5b2;margin-bottom:1px}
#cmptouch{position:fixed;right:14px;bottom:170px;z-index:30;display:none;flex-direction:column;gap:8px}
#cmptouch button{width:62px;height:62px;border-radius:50%;border:1px solid rgba(255,255,255,.25);background:rgba(18,24,32,.55);color:#fff;font:600 12px system-ui,sans-serif}
@media (pointer:coarse){#cmptouch{display:flex}}`;
    document.head.appendChild(css);
    const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
    const wrap = el('div'); wrap.id = 'cmp';
    const chip = el('div', 'chip', 'Compete & co-op'); const panel = el('div', 'panel');
    wrap.append(chip, panel); document.body.appendChild(wrap);
    chip.onclick = () => { panel.classList.toggle('open'); render(); };
    const bar = el('div'); bar.id = 'cmpbar'; document.body.appendChild(bar);
    const flashEl = el('div'); flashEl.id = 'cmpflash'; document.body.appendChild(flashEl);
    const prompt = el('div'); prompt.id = 'cmpprompt'; document.body.appendChild(prompt);
    const inv = el('div'); inv.id = 'cmpinv'; document.body.appendChild(inv);
    const npcBox = el('div'); npcBox.id = 'cmpnpc'; document.body.appendChild(npcBox);
    const openEl = el('div'); openEl.id = 'cmpopen'; document.body.appendChild(openEl);
    function track() {
      const o = S.open, st = o && o.step >= 1 && o.step <= OPEN_STEPS.length ? OPEN_STEPS[o.step - 1] : null;
      if (!st) { openEl.style.display = 'none'; return; }
      openEl.replaceChildren(el('small', null, `Ula \u00b7 ${o.step} of ${OPEN_STEPS.length}`), document.createTextNode(st.short + (st.need ? ` (${o.n}/${st.need})` : '')));
      openEl.style.display = 'block';
    }
    const touch = el('div'); touch.id = 'cmptouch'; document.body.appendChild(touch);
    const tb = (t, f) => { const b = el('button', null, t); b.onclick = (e) => { e.stopPropagation(); f(); }; touch.appendChild(b); return b; };
    const tAct = tb('Use', () => { const c = context(); if (c) c.go(); }); tb('Shove', shove); tb('Hand', hand); tb('Drop', drop);
    let flashT = 0, npcT = 0, mode = 'race', target = '';
    function flash(t) { flashEl.textContent = t; flashEl.style.opacity = 1; clearTimeout(flashT); flashT = setTimeout(() => { flashEl.style.opacity = 0; }, 1400); }
    function npc(t) { npcBox.textContent = t; npcBox.style.display = 'block'; chatLine(null, t); clearTimeout(npcT); npcT = setTimeout(() => { npcBox.style.display = 'none'; }, Math.min(16000, 3000 + t.length * 45)); }
    function invite(m) {
      inv.replaceChildren(el('div', null, `${m.from} challenges you: ${MODE_NAME[m.mode]}`), el('div', 'muted', MODE_HELP[m.mode]));
      const y = el('button', null, 'Accept'), n = el('button', 'ghost', 'Not now');
      y.onclick = () => { send({ k: 'ac', yes: true }); inv.style.display = 'none'; };
      n.onclick = () => { send({ k: 'ac', yes: false }); inv.style.display = 'none'; };
      inv.append(y, n); inv.style.display = 'block';
      setTimeout(() => { inv.style.display = 'none'; }, 60000);
    }
    function render() {
      if (!panel.classList.contains('open')) return;
      panel.replaceChildren();
      const g = S.game, me_ = myId();
      if (g && g.phase !== 'done') {
        panel.appendChild(el('h4', null, MODE_NAME[g.mode]));
        panel.appendChild(el('div', 'muted', MODE_HELP[g.mode]));
        for (const [id, p] of Object.entries(g.players)) panel.appendChild(el('div', null, `${p.name}${id === g.host ? ' (challenger)' : ''}`));
        if (g.phase === 'lobby') {
          const waiting = g.invited.filter((x) => !g.players[x]);
          if (waiting.length) panel.appendChild(el('div', 'muted', `Waiting for ${waiting.length} to accept…`));
          if (g.host === me_) { const s = el('button', null, 'Start now'); s.onclick = () => send({ k: 'go' }); panel.appendChild(s); }
          if (g.invited.includes(me_) && !g.players[me_]) { const a = el('button', null, 'Accept'); a.onclick = () => send({ k: 'ac', yes: true }); panel.appendChild(a); }
        }
        if (g.players[me_]) { const q = el('button', 'ghost', g.phase === 'lobby' && g.host === me_ ? 'Cancel' : 'Leave game'); q.onclick = () => send({ k: 'quit' }); panel.appendChild(q); }
      } else {
        panel.appendChild(el('h4', null, 'Challenge'));
        const row = el('div');
        for (const k of Object.keys(MODE_NAME)) { const b = el('button', 'ghost' + (k === mode ? ' sel' : ''), MODE_NAME[k]); b.onclick = () => { mode = k; render(); }; row.appendChild(b); }
        panel.appendChild(row);
        panel.appendChild(el('div', 'muted', MODE_HELP[mode]));
        const sel = el('select'); const all = el('option', null, 'Everyone here'); all.value = ''; sel.appendChild(all);
        for (const p of peerList()) { const o = el('option', null, p.name); o.value = p.id; sel.appendChild(o); }
        sel.value = target; sel.onchange = () => { target = sel.value; };
        panel.appendChild(sel);
        const go = el('button', null, mode === 'cairn' ? 'Team up' : 'Send challenge'); go.onclick = () => send({ k: 'ch', mode, ...(target ? { to: target } : {}) });
        panel.appendChild(go);
        if (mode === 'race') {
          panel.appendChild(el('h4', null, `Race course: ${S.course.length} gate${S.course.length === 1 ? '' : 's'}`));
          const add = el('button', 'ghost', 'Add gate here'); add.onclick = () => send({ k: 'gate' });
          const clr = el('button', 'ghost', 'Clear course'); clr.onclick = () => send({ k: 'clr' });
          panel.append(add, clr, el('div', 'muted', 'Walk the route and add a gate at each turn. The first is the start, the last is the finish.'));
        }
      }
      const mine = S.items.carried[me_] || [];
      if (mine.length) { panel.appendChild(el('h4', null, `In your hands (${mine.length} of ${ST.carry})`)); panel.appendChild(el('div', null, mine.map((i) => ITEM_NAME[i.k] || i.k).join(', '))); panel.appendChild(el('div', 'muted', 'H hands one to the person next to you. Z drops it here.')); }
      if (S.board.length) {
        panel.appendChild(el('h4', null, 'Scoreboard'));
        const t = el('table'); const h = el('tr'); for (const c of ['', 'Wins', 'Best race', 'Cairns', 'Finds']) h.appendChild(el('td', c ? 'r muted' : 'muted', c)); t.appendChild(h);
        for (const r of S.board) { const tr = el('tr'); tr.append(el('td', null, r.name), el('td', 'r', String(r.wins)), el('td', 'r', r.best_ms ? (r.best_ms / 1000).toFixed(1) + ' s' : '–'), el('td', 'r', String(r.cairns)), el('td', 'r', String(r.eggs + r.quests))); t.appendChild(tr); }
        panel.appendChild(t);
      }
      panel.appendChild(el('div', 'muted', 'Keys: E use · Q shove · H hand over · Z drop'));
    }
    function frame() {
      const g = S.game, now = Date.now() + S.off, me_ = myId();
      if (g && g.phase !== 'done' && g.phase !== 'lobby') {
        let top = MODE_NAME[g.mode], sub = '';
        if (g.phase === 'count') top = `${MODE_NAME[g.mode]} in ${Math.max(1, Math.ceil((g.tCount - now) / 1000))}`;
        else if (g.phase === 'wait') top = `Round ${g.ring?.round}: step inside the ring`;
        else if (g.phase === 'live') {
          const left = Math.max(0, (g.tEnd - now) / 1000);
          if (g.mode === 'race') { const p = g.players[me_]; top = p?.fin != null ? `Finished: ${(p.fin / 1000).toFixed(2)} s` : `${((now - g.t0) / 1000).toFixed(1)} s · gate ${Math.min((p?.gi || 0) + 1, g.gates.length)} of ${g.gates.length}`; }
          else top = `${MODE_NAME[g.mode]} · ${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`;
          if (g.mode === 'hunt') sub = Object.values(g.players).map((p) => `${p.name} ${p.score}${p.carry.length ? ` (+${p.carry.length} carried)` : ''}`).join(' · ');
          if (g.mode === 'cairn') sub = `Cairn ${g.cairn.n} / ${g.cairn.goal} · carrying ${g.players[me_]?.carry?.length || 0}`;
          if (g.mode === 'ring') sub = Object.values(g.players).map((p) => `${p.name} ${p.wins}${p.out ? ' (out)' : ''}`).join(' · ');
        }
        bar.replaceChildren(document.createTextNode(top)); if (sub) { const s = el('small', null, sub); bar.appendChild(s); }
        bar.style.display = 'block';
      } else bar.style.display = 'none';
      const c = context();
      if (c) { prompt.replaceChildren(el('b', null, 'E'), document.createTextNode(c.label)); prompt.style.display = 'block'; tAct.textContent = 'Use'; }
      else prompt.style.display = 'none';
    }
    return { render, flash, invite, npc, frame, track };
  }

  // ---- per frame: follow scene changes, animate gates/slab/Ula
  let last = performance.now(), vaultKey = '', vaultCols = null;
  function syncVaultSolids() {
    const cols = player()?.colliders, o = objs.vault, v = S.vault;
    if (vaultCols && vaultCols !== cols) { vaultCols.removeWhere((c) => c.tag === 'vault'); vaultCols = null; vaultKey = ''; }
    if (!cols) return;
    // the slab blocks until its bottom edge clears a standing head
    const slabShut = !!o && o.userData.slab.position.y - VAULT.slab.h / 2 < BODY.height;
    const key = o && o.visible && v ? [o.position.x.toFixed(2), o.position.z.toFixed(2), o.rotation.y.toFixed(3), !!v.tunnel, slabShut].join() : '';
    if (key === vaultKey) return;
    vaultKey = key; vaultCols = cols; cols.removeWhere((c) => c.tag === 'vault');
    if (!key) return;
    for (const sh of placeShapes(vaultShapes({ tunnel: !!v.tunnel, slabShut }), o.position.x, o.position.z, o.rotation.y)) cols.add({ ...sh, top: o.position.y + sh.h, bottom: o.position.y + (sh.y0 || 0), tag: 'vault', src: 'vault (js/solids.js)' });
  }
  function tick() {
    const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000); last = now;
    attach();
    const g = S.game, me_ = myId();
    if (g?.mode === 'race' && g.phase === 'live') { const gi = g.players[me_]?.gi ?? -1; objs.gates.forEach((o, i) => { o.scale.setScalar(i === gi ? 1 + 0.05 * Math.sin(now / 150) : 1); }); }
    for (const o of objs.stones.values()) o.rotation.y += dt * 0.6;
    for (const o of objs.items.values()) o.rotation.y += dt * 0.4;
    // the vault's walls, slab and lock block you through the same shapes the server enforces (js/solids.js vaultShapes)
    syncVaultSolids();
    if (objs.vault) { const u = objs.vault.userData; if (u.target != null) u.slab.position.y += (u.target - u.slab.position.y) * Math.min(1, dt * (u.target > u.slab.position.y ? 1.5 : 8)); }
    if (objs.ula) {
      const u = objs.ula; let want = S.ula.yaw;
      const lp = S.ula.look && peerList().find((p) => p.id === S.ula.look);
      const tgt = S.ula.look === me_ ? myPos() : lp?.at ? { x: lp.at[0], z: lp.at[2] } : null;
      if (tgt && Math.hypot(tgt.x - u.position.x, tgt.z - u.position.z) < 30) want = Math.atan2(tgt.x - u.position.x, tgt.z - u.position.z);
      const d = ((want - u.rotation.y + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI; u.rotation.y += d * Math.min(1, dt * 2.5);
      u.userData.head.rotation.x = Math.sin(now / 1400) * 0.05;
    }
    hud.frame();
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
  // re-place things when the ground under them loads in (tiles stream in after a scene change)
  setInterval(() => { if (S.game || S.items.ground.length || S.vault || S.keeper) syncAll(); }, 3000);

  // a recipe made in the craft tab (js/game/skills.js): the server counts it for Ula's walk where it could be made
  // (station recipes are already counted by the server when it said yes: storage.js scraft)
  window.addEventListener('zen-made', (e) => { const id = e.detail && e.detail.id; if (typeof id === 'string' && !e.detail.confirmed && S.open && S.open.step <= OPEN_STEPS.length) send({ k: 'made', id }); });
  return { onMsg, state: S, context, shove, hand, drop, send, objs, storage: ST };
}
