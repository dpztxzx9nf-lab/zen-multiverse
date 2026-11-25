// The physical world on a planet: diggable voxel ground, rigid props you can carry, stack, throw
// and break, freeform building with real support, crafting, tools and the four abilities. One
// object the world creates and ticks; everything here is game-only (planets are never part of
// mom's garden preview).
//   const sb = createSandbox({ scene, camera, P, renderer, core, steps, hf: { ground, height2, biome, groundColor, rebuild, trunks, fell }, terrainMat, params })
//   sb.load(PK, W)  sb.update(dt)  sb.env -> { top, solid, friction }  sb.clear()
import * as THREE from 'three';
import { createVoxels, CN } from './voxel.js';
import { createPhysics } from './physics.js';
import { createProps } from './props.js';
import { createBuild, PIECES } from './build.js';
import { createHotbar } from './hotbar.js';
import { RECIPES, ABILITIES } from './craft.js';
import { MATS, MAT, VS } from './materials.js';
import { game, UNLOCK_ALL } from '../store.js';
import { onKey, keyDown } from '../player-calm.js';
import { setPressHandler } from '../interact.js';
import { pad } from '../gamepad.js';
import { icon } from '../icons.js';

const CS = CN * VS;
const TOOLS = {
  hands: { label: 'hands', glyph: '✋' },
  pick: { label: 'pick', glyph: '⛏' },
  axe: { label: 'axe', glyph: '🪓' },
  shaper: { label: 'shape', glyph: '◒' },
  build: { label: 'build', glyph: '▦' },
};
const PIECE_ORDER = ['floor', 'wall', 'beam', 'post', 'ramp', 'block', 'bench'];
const hash = (...a) => { let h = 2166136261; for (const v of a) { h ^= (v * 2654435761) | 0; h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; };
const rng = (s) => { let x = Math.floor(s * 4294967296) || 1; return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return ((x >>> 0) % 1e6) / 1e6; }; };

export function createSandbox({ scene, camera, P, renderer, core, steps, hf, terrainMat, params }) {
  let fdT = 0; const fdSet = new Set();
  const floraDirty = (x, z) => { if (hf.floraDirty) fdSet.add(Math.floor(x / 128) * 128 + 1 + ',' + (Math.floor(z / 128) * 128 + 1)); };
  const lite = P.cls !== 'pc';
  const { player, hud, interact } = core;
  const G = game.data;
  G.g7 = G.g7 || { v: 1, tools: {}, abilities: {}, worlds: {} };
  const T7 = G.g7; T7.tools = T7.tools || {}; T7.abilities = T7.abilities || {}; T7.worlds = T7.worlds || {};
  if (UNLOCK_ALL) { T7.tools = { pick: 2, axe: 1, shaper: 1, build: 1 }; T7.abilities = { dash: 1, glide: 1, vine: 1, lift: 1 }; }
  let W = null, PK = null, rec = null;
  // ---- the ground, as one query surface: voxels where dug, heightfield elsewhere, plus builds and props
  const hfSolid = (x, y, z) => y < hf.ground(x, z);
  let vox = null, build = null;
  const terrainEnv = {
    top: (x, z, y) => (vox && vox.isActive(x, z) ? vox.top(x, z, y) : hf.ground(x, z)),
    solid: (x, y, z) => (vox && vox.isActive(x, z) ? vox.solid(x, y, z) : hfSolid(x, y, z)),
  };
  const restingProps = []; // large sleeping props you can stand on (rebuilt each frame, few)
  const env = {
    top(x, z, y) {
      let t = terrainEnv.top(x, z, y);
      if (build) { const b = build.top(x, z, y); if (b > t) t = b; }
      for (const o of restingProps) { const dx = x - o.x, dz = z - o.z, rr = dx * dx + dz * dz; if (rr < o.r * o.r) { const tt = o.y + Math.sqrt(o.r * o.r - rr) * o.k; if (tt <= y + 0.6 && tt > t) t = tt; } }
      return t;
    },
    solid(x, y, z) { return terrainEnv.solid(x, y, z) || (build ? build.solid(x, y, z) : false); },
    friction(x, y, z) { if (vox && vox.isActive(x, z)) { const m = vox.materialAt(x, y - 0.2, z); if (m && MATS[m]) return MATS[m].friction / 0.85; } return 1; },
  };
  const physics = createPhysics({ P, env, heightTile: (cx, cz) => heightTile(cx, cz) });
  const props = createProps({ scene, physics, P, renderer, steps, lite });
  build = createBuild({ scene, physics, props, env: terrainEnv, steps, lite });
  build.onChange = () => changed();
  function heightTile(cx, cz) {
    if (vox && vox.active.has(cx + ',' + cz)) return null;
    const n = 9, s = CS / (n - 1), pos = new Float32Array(n * n * 3), idx = [];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const x = cx * CS + i * s, z = cz * CS + j * s, k = (j * n + i) * 3; pos[k] = x; pos[k + 1] = hf.ground(x, z); pos[k + 2] = z; }
    for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) { const a = j * n + i, b = a + 1, c = a + n, d = c + 1; idx.push(a, c, b, b, c, d); }
    return { pos, idx: new Uint32Array(idx) };
  }
  // ---- tools, hotbar, aim
  const hot = createHotbar({ touch: P.cls !== 'pc' });
  let sel = 0, pieceI = 0, pieceMat = 'wood', rot = 0, carried = null, holdD = 1.8, useHeld = false, altHeld = false, useT = 0, chop = null;
  const slots = () => { const s = [{ id: 'hands', ...TOOLS.hands }]; if (T7.tools.pick) s.push({ id: 'pick', ...TOOLS.pick, label: T7.tools.pick > 1 ? 'pick+' : 'pick' }); if (T7.tools.axe) s.push({ id: 'axe', ...TOOLS.axe }); if (T7.tools.shaper) s.push({ id: 'shaper', ...TOOLS.shaper }); if (T7.tools.build) s.push({ id: 'build', ...TOOLS.build }); return s; };
  const tool = () => { const s = slots(); if (sel >= s.length) sel = 0; return s[sel].id; };
  hot.onPick = (i) => { sel = i; };
  for (let i = 1; i <= 5; i++) onKey('Digit' + i, () => { if (active()) sel = Math.min(i - 1, slots().length - 1); });
  addEventListener('zen-hotbar', (e) => { if (!active()) return; if (tool() === 'build' && pad.down('RT')) return; const n = slots().length; sel = (sel + e.detail + n) % n; });
  addEventListener('wheel', (e) => { if (!active() || hud.panelOpen) return; if (tool() === 'build') { if (keyDown('ShiftLeft')) rot += Math.sign(e.deltaY) * Math.PI / 12; else pieceI = (pieceI + Math.sign(e.deltaY) + PIECE_ORDER.length) % PIECE_ORDER.length; } else if (carried) holdD = THREE.MathUtils.clamp(holdD - Math.sign(e.deltaY) * 0.25, 1.2, T7.abilities.lift ? 8 : 2.6); else { const n = slots().length; sel = (sel + Math.sign(e.deltaY) + n) % n; } }, { passive: true });
  onKey('KeyT', () => { if (!active() || tool() !== 'build') return; const ms = Object.keys(PIECES[PIECE_ORDER[pieceI]].mats); pieceMat = ms[(ms.indexOf(pieceMat) + 1) % ms.length]; });
  onKey('KeyF', () => { if (active()) vineToggle(); });
  onKey('KeyQ', () => { if (active() && T7.abilities.dash && player.dash()) gust(); });
  let isActive = false; const active = () => isActive && !hud.panelOpen && !hud.dialogOpen && !core.drift && !core.cinematic;
  setPressHandler({
    down(btn) { if (!active()) return false; if (btn === 0) { if (useClaims()) { useHeld = true; useT = 0; useNow(true); return true; } return false; } if (btn === 2) { altHeld = true; altNow(); return true; } return false; },
    up(btn) { if (btn === 0) { useHeld = false; useT = 0; hot.progress(0); chop = null; } if (btn === 2) altHeld = false; },
  });
  hot.on('use', (d) => { if (d) { if (useClaims()) { useHeld = true; useNow(true); } else interact.run(0); } else { useHeld = false; hot.progress(0); chop = null; } });
  hot.on('alt', (d) => { altHeld = d; if (d) altNow(); });
  hot.on('jump', (d) => { player.touch.jump = d; if (d) player.jump(); });
  hot.on('slide', (d) => { player.touch.crouch = d; });
  hot.on('ability', (d) => { if (d && T7.abilities.dash && player.dash()) gust(); });
  hot.on('vine', (d) => { if (d) vineToggle(); });
  // secondary (R / right click / pad X-alt): rotate in build mode, drop when carrying
  function secondary() { if (!active()) return false; if (tool() === 'build') { rot += Math.PI / 2; return true; } if (carried) { drop(false); return true; } return false; }
  // ---- what is under the crosshair
  const eye = new THREE.Vector3(), dir = new THREE.Vector3();
  let aim = null;
  function computeAim() {
    player.eyePos(eye); player.aimDir(dir);
    const reachP = T7.abilities.lift ? 9 : 3.2, reachT = tool() === 'build' ? 9 : 5;
    const pb = physics.pick(eye, dir, reachP, (b) => b !== carried);
    const bh = build.raycast(eye, dir, reachT);
    const th = vox.raycast(eye, dir, Math.max(reachT, 6), hfSolid);
    const tr = hf.trunkRay ? hf.trunkRay(eye, dir, 4) : null;
    let best = null; const consider = (k, t, o) => { if (t != null && (!best || t < best.t)) best = { kind: k, t, ...o }; };
    if (pb) consider('prop', pb.t, { body: pb.body });
    if (bh) consider('piece', bh.t, { piece: bh.piece, point: bh.point, normal: bh.normal });
    if (th && th.t <= reachT) consider('ground', th.t, { point: th.point, normal: th.normal });
    if (tr) consider('tree', tr.t, { tree: tr.tree, point: tr.point });
    aim = best;
  }
  // the gaze prompt for what she aims at (uses the shared interact list, so the crosshair warms too)
  interact.add({ id: 'g7-aim', priority: 2, r: 9, gazeR: 0.6, enabled: () => !!(aim && aimAction()), at: () => (aim.kind === 'prop' ? { x: aim.body.pos.x, y: aim.body.pos.y - 0.4, z: aim.body.pos.z } : { x: aim.point.x, y: aim.point.y - 0.4, z: aim.point.z }), actions: () => { const a = aimAction(); return a ? [a] : []; } });
  function aimAction() {
    if (!aim) return null; const t = tool();
    if (carried) return { label: 'Throw (click) · drop (R)', icon: 'stone', run: async () => throwIt() };
    if (aim.kind === 'prop') {
      const b = aim.body;
      if (props.gatherable(b)) { const y = props.yieldOf(b); return { label: `Gather ${nameOf(y.item)}`, icon: 'stone', run: async () => gather(b) }; }
      if (canLift(b)) return { label: `Carry the ${b.data.kind}`, icon: 'stone', run: async () => grab(b) };
      return { label: `Push the ${b.data.kind}`, icon: 'stone', run: async () => push(b) };
    }
    if (aim.kind === 'tree' && t === 'axe') return { label: 'Fell the tree', icon: 'leaf', run: async () => {} };
    return null;
  }
  const nameOf = (id) => { const I = { 'mat:stone': 'stone', 'mat:wood': 'wood', 'mat:ice': 'ice', 'mat:crystal': 'crystal shards', 'find:shell': 'shell', 'mat:metal': 'metal' }; return I[id] || id; };
  const liftMax = () => (T7.abilities.lift ? 650 : 45);
  const canLift = (b) => b.mass <= liftMax();
  function useClaims() { const t = tool(); if (carried) return true; if (t !== 'hands') return true; if (aim && aim.kind === 'ground') return true; if (aim && aim.kind === 'prop' && !props.gatherable(aim.body) && !canLift(aim.body)) return true; return false; }
  // ---- inventory without a save per voxel (saved in batches, see commit())
  const add = (id, n) => { if (n <= 0) return; G.inv[id] = (G.inv[id] || 0) + n; changed(); };
  const take = (id, n) => { if ((G.inv[id] || 0) < n) return false; G.inv[id] -= n; if (!G.inv[id]) delete G.inv[id]; changed(); return true; };
  const pay = (cost) => { if (!Object.entries(cost).every(([k, n]) => (G.inv[k] || 0) >= n)) return false; for (const [k, n] of Object.entries(cost)) take(k, n); return true; };
  const frac = {};
  function credit(got) { for (const [m, v] of Object.entries(got)) { const M = MATS[m]; if (!M) continue; const per = 2; frac[M.item] = (frac[M.item] || 0) + v / per; const n = Math.floor(frac[M.item]); if (n > 0) { frac[M.item] -= n; add(M.item, n); toastGot(M.item, n); } if (m == MAT.SOIL && Math.random() < v * 0.08) add('fibre', 1); } }
  let gotAcc = {}, gotT = 0;
  function toastGot(item, n) { gotAcc[item] = (gotAcc[item] || 0) + n; gotT = 1.2; }
  // ---- actions
  function useNow(first) {
    const t = tool();
    if (carried) { if (first) throwIt(); return; }
    if (!aim) return;
    if (aim.kind === 'prop') {
      const b = aim.body;
      if (t === 'hands') { if (props.gatherable(b)) gather(b); else if (canLift(b)) grab(b); else push(b); return; }
      hitProp(b, t); return;
    }
    if (aim.kind === 'piece') { if (t === 'build') return place(); if (t === 'axe' || t === 'pick') { hitPiece(aim.piece); } return; }
    if (aim.kind === 'tree') { if (t === 'axe') chopTree(aim); return; }
    if (aim.kind === 'ground') {
      if (t === 'build') return place();
      if (t === 'shaper') return raiseHere();
      dig(t);
    }
  }
  const DIG = { hands: { r: 0.42, hard: 0.9, every: 0.42 }, pick1: { r: 0.62, hard: 2.7, every: 0.3 }, pick2: { r: 0.85, hard: 3.6, every: 0.24 } };
  function digSpec(t) { return t === 'pick' ? (T7.tools.pick > 1 ? DIG.pick2 : DIG.pick1) : DIG.hands; }
  function dig(t) {
    if (!aim || aim.kind !== 'ground') return;
    const D = digSpec(t), p = aim.point.clone().addScaledVector(dir, D.r * 0.35);
    const before = { x: p.x, z: p.z };
    const { got, blocked } = vox.carve(p.x, p.y, p.z, D.r, { maxHard: D.hard }); floraDirty(p.x, p.z);
    const m = Object.keys(got)[0];
    credit(got); void before;
    if (blocked && !m) { hot.sub(t === 'hands' ? 'too hard for bare hands: a pick would do it' : 'this needs a metal pick'); subT = 2.2; steps.play('stone', 0.5); }
    else steps.play(MATS[m]?.step || 'gravel', 1.1);
    pad.rumble(0.12, 0.05, 40);
  }
  function raiseHere() {
    const order = ['mat:stone', 'mat:soil', 'mat:sand', 'mat:ice']; const it = order.find((k) => (G.inv[k] || 0) > 0);
    if (!it) { hot.sub('the shaper needs soil, sand, stone or ice in your bag'); subT = 2.2; return; }
    const m = { 'mat:stone': MAT.STONE, 'mat:soil': MAT.PACKED, 'mat:sand': MAT.SAND, 'mat:ice': MAT.ICE }[it];
    const p = aim.point.clone().addScaledVector(aim.normal, 0.25);
    const used = vox.raise(p.x, p.y, p.z, 0.7, m, (G.inv[it] || 0) * 2); floraDirty(p.x, p.z);
    frac['-' + it] = (frac['-' + it] || 0) + used / 2; const n = Math.floor(frac['-' + it]); if (n) { frac['-' + it] -= n; take(it, Math.min(n, G.inv[it] || 0)); }
    steps.play(MATS[m].step, 0.9);
  }
  function altNow() {
    const t = tool();
    if (secondaryAlt(t)) return;
  }
  function secondaryAlt(t) {
    if (carried) { drop(false); return true; }
    if (t === 'build') { if (aim && aim.kind === 'piece') { const p = aim.piece; const cost = PIECES[p.type].mats[p.mat]; build.removePiece(p); for (const [k, n] of Object.entries(cost)) add(k, n); steps.play('wood', 0.7); } return true; }
    if (t === 'shaper') { const p = player.position; const r = vox.flatten(p.x + dir.x * 2, p.y - 0.02, p.z + dir.z * 2, 1.6, MAT.PACKED, (G.inv['mat:soil'] || 0) * 2); floraDirty(p.x, p.z); credit(r.got); steps.play('gravel', 0.9); return true; }
    return false;
  }
  function hitProp(b, t) {
    const S = b.data.mat; const power = t === 'pick' ? (S === 'stone' || S === 'ice' || S === 'crystal' ? 1 : 0.4) : t === 'axe' ? (S === 'wood' ? 1 : 0.3) : 0.2;
    b.data.hits = (b.data.hits || 0) + power; b.data.touched = true;
    physics.impulse(b, dir.clone().multiplyScalar(0.6 / Math.sqrt(b.mass / 20)));
    steps.play(S === 'wood' ? 'wood' : 'stone', 1.1);
    if (b.data.hits >= Math.max(1, b.data.size * 1.5)) props.breakBody(b, 5);
  }
  function hitPiece(p) { p.hits = (p.hits || 0) + 1; steps.play(p.mat === 'wood' ? 'wood' : 'stone', 1); if (p.hits >= 3) { const body = build.removePiece(p, true, dir.clone().multiplyScalar(1.5)); if (body) body.data.fragile = true; } }
  function chopTree(a) {
    chop = chop && chop.tree === a.tree ? chop : { tree: a.tree, n: 0 };
    chop.n++; steps.play('wood', 1.2); pad.rumble(0.2, 0.1, 50);
    if (chop.n >= 4) { const tr = a.tree; chop = null; const r = hf.fell(tr); if (r) {
      // the trunk becomes a real log that topples away from her
      const away = new THREE.Vector3(r.x - player.position.x, 0, r.z - player.position.z).normalize();
      const len = Math.min(4.2, Math.max(1.6, r.h * 0.55)), axis = new THREE.Vector3(away.z, 0, -away.x);
      const b = props.spawn('log', len, new THREE.Vector3(r.x, r.y + len / 2 + 0.05, r.z), { ang: axis.multiplyScalar(0.9), touched: true });
      if (b) { b.data.natural = false; physics.impulse(b, away.multiplyScalar(0.6)); }
      add('fibre', 2); changed(); hot.sub('timber…'); subT = 1.5;
    } }
  }
  function gather(b) { const y = props.yieldOf(b); props.remove(b); add(y.item, y.n); if (b.data.natural) goneNatural(b.data.id); steps.play('gravel', 0.7); toastGot(y.item, y.n); }
  function grab(b) { carried = b; b.data.touched = true; holdD = Math.max(1.4, b.radius + 1.0); if (b.data.natural) touchNatural(b); steps.play(b.data.mat === 'wood' ? 'wood' : 'stone', 0.5); }
  function push(b) { b.data.touched = true; if (b.data.natural) touchNatural(b); physics.impulse(b, dir.clone().setY(0.15).multiplyScalar(Math.min(3, 160 / b.mass))); steps.play('stone', 0.6); }
  function drop(gentle = true) { if (!carried) return; const b = carried; carried = null; physics.release(b); if (gentle) physics.setVel(b, player.velocity.clone().multiplyScalar(0.5)); changed(); }
  function throwIt() { if (!carried) return; const b = carried; drop(false); const v = Math.min(15, 9 * Math.sqrt(40 / Math.max(2, b.mass))) * (T7.abilities.lift ? 1.4 : 1); physics.setVel(b, dir.clone().multiplyScalar(v).add(player.velocity.clone().multiplyScalar(0.6)).add(new THREE.Vector3(0, 1.2, 0))); physics.spin(b, new THREE.Vector3((Math.random() - 0.5) * 4, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 4)); steps.play('sand', 0.6); pad.rumble(0.25, 0.1, 60); }
  function place() {
    const type = PIECE_ORDER[pieceI]; if (!PIECES[type].mats[pieceMat]) pieceMat = Object.keys(PIECES[type].mats)[0];
    const s = ghostSnap; if (!s || !ghostOk) return;
    const cost = PIECES[type].mats[pieceMat];
    if (!pay(cost)) { hot.sub('not enough: ' + Object.entries(cost).map(([k, n]) => `${n} ${nameOf(k)}`).join(', ')); subT = 2.4; return; }
    build.place(type, pieceMat, s.pos, s.yaw); changed();
  }
  // ---- abilities: wind gust (dash), grapple vine
  const gustFx = [];
  function gust() { steps.play('sand', 0.9); for (let i = 0; i < 5; i++) { const s = new THREE.Mesh(new THREE.PlaneGeometry(0.03, 1.4), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.25, depthWrite: false })); s.position.copy(camera.position).add(new THREE.Vector3((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 1, (Math.random() - 0.5) * 2)); s.lookAt(camera.position); s.rotateX(Math.PI / 2); scene.add(s); gustFx.push({ s, t: 0 }); } }
  let vine = null; const vineMat = new THREE.MeshStandardMaterial({ color: '#5f7a3c', roughness: 0.8 });
  function vineToggle() {
    if (!T7.abilities.vine) { hot.sub('craft a grapple vine at a workbench'); subT = 2; return; }
    if (vine) { endVine(); return; }
    player.eyePos(eye); player.aimDir(dir);
    const pb = physics.pick(eye, dir, 22), bh = build.raycast(eye, dir, 28), th = vox.raycast(eye, dir, 28, hfSolid), tr = hf.trunkRay ? hf.trunkRay(eye, dir, 28) : null;
    let best = null; for (const [k, h] of [['prop', pb], ['piece', bh], ['ground', th], ['tree', tr]]) if (h && (!best || h.t < best.t)) best = { k, ...h };
    if (!best) { hot.sub('the vine finds nothing to hold'); subT = 1.5; return; }
    const at = best.k === 'prop' ? best.body.pos.clone() : best.point.clone();
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1, 5, 1, true).translate(0, 0.5, 0).rotateX(Math.PI / 2), vineMat); scene.add(mesh);
    vine = { at, body: best.k === 'prop' ? best.body : null, mesh, t: 0 };
    steps.play('wood', 0.6);
  }
  function endVine() { if (!vine) return; scene.remove(vine.mesh); vine.mesh.geometry.dispose(); vine = null; }
  const _h = new THREE.Vector3();
  function stepVine(dt) {
    if (!vine) return; vine.t += dt;
    player.eyePos(eye);
    const hand = eye.clone().add(new THREE.Vector3(0, -0.35, 0)).addScaledVector(player.aimDir(_h), 0.3);
    if (vine.body) {
      // pull the thing to her (light things fly, heavy things slide)
      const b = vine.body; vine.at.copy(b.pos);
      const to = hand.clone().sub(b.pos), d = to.length();
      if (d < 2.2 || vine.t > 3 || !physics.bodies.has(b)) { if (physics.bodies.has(b) && canLift(b)) grab(b); endVine(); return; }
      physics.impulse(b, to.normalize().multiplyScalar(Math.min(0.5, 30 / b.mass) * dt * 30));
    } else {
      const to = vine.at.clone().sub(player.position), d = to.length();
      if (d < 1.6 || vine.t > 4) { endVine(); return; }
      to.normalize();
      const v = player.velocity, along = v.dot(to);
      const acc = 26 * dt; player.impulse(to.x * acc, to.y * acc + (player.airborne ? 9.81 * 0.55 * dt : 1.2), to.z * acc);
      if (along > 15) v.multiplyScalar(15 / along);
      if (keyDown('Space') && vine.t > 0.2) { player.impulse(0, 3.5, 0); endVine(); return; }
    }
    const L = hand.distanceTo(vine.at); vine.mesh.position.copy(hand); vine.mesh.lookAt(vine.at); vine.mesh.scale.set(1, 1, L);
  }
  // ---- natural props: rocks, fallen logs, sticks, shells, ice and crystals, per 16 m tile
  const live = new Map(); // id -> body (natural)
  function tileProps(tx, tz) {
    const r = rng(hash(W.seed, tx, tz, 77)), out = [];
    const cx = (tx + 0.5) * CS, cz = (tz + 0.5) * CS, y0 = hf.ground(cx, cz), b = hf.biome(cx, cz, y0);
    const plan = { forest: [['rock', 0.7], ['log', 0.45], ['stick', 1.4]], shore: [['shell', 1.6], ['rock', 0.4], ['log', 0.25], ['stick', 0.6]], salt: [['rock', 0.9], ['crystal', 0.15]], crystal: [['crystal', 0.9], ['rock', 0.6]], ice: [['ice', 0.8], ['rock', 0.5]] }[b] || [['rock', 0.6]];
    let i = 0;
    for (const [k, rate] of plan) {
      let n = Math.floor(rate + r()); while (n-- > 0) {
        const x = tx * CS + r() * CS, z = tz * CS + r() * CS, y = hf.ground(x, z);
        if (hf.isWater && hf.isWater(x, z, y)) { i++; continue; }
        if (x * x + z * z < 30) { i++; continue; }
        const size = k === 'rock' ? (r() < 0.75 ? 0.25 + r() * 0.35 : 0.6 + r() * 0.7) : k === 'log' ? 1.4 + r() * 1.6 : k === 'stick' ? 0.6 + r() * 0.5 : k === 'shell' ? 0.12 + r() * 0.1 : k === 'ice' ? 0.45 + r() * 0.5 : 0.35 + r() * 0.35;
        out.push({ id: `n${tx},${tz},${i++}`, kind: k === 'stick' ? 'splinter' : k, size, x, y, z, ry: r() * 6.28, seed: r() * 1e4 });
      }
    }
    return out;
  }
  const _qq = new THREE.Quaternion();
  function streamProps(px, pz) {
    const R = lite ? 1 : 2, tx0 = Math.floor(px / CS), tz0 = Math.floor(pz / CS), want = new Set();
    const cap = lite ? 30 : 90;
    for (let j = -R; j <= R; j++) for (let i = -R; i <= R; i++) for (const p of tileProps(tx0 + i, tz0 + j)) {
      if (rec.gone.includes(p.id) || rec.moved[p.id]) continue; want.add(p.id);
      if (live.has(p.id) || physics.count >= cap) continue;
      const lying = p.kind === 'log' || p.kind === 'splinter';
      const q = lying ? new THREE.Quaternion().setFromEuler(new THREE.Euler(0, p.ry, Math.PI / 2)) : _qq.setFromEuler(new THREE.Euler(0, p.ry, 0)).clone();
      const lift = lying ? (p.kind === 'log' ? 0.2 + p.size * 0.06 : 0.06) : p.kind === 'rock' ? p.size * 0.3 : p.kind === 'ice' ? p.size * 0.4 : p.size * 0.3;
      const y = terrainEnv.top(p.x, p.z, p.y + 3) + lift;
      const b = props.spawn(p.kind, p.size, new THREE.Vector3(p.x, y, p.z), { quat: q, seed: p.seed, sleep: true, id: p.id, natural: true });
      if (b) live.set(p.id, b);
    }
    for (const [id, b] of live) if (!want.has(id) && !b.data.touched && physics.bodies.has(b)) { props.remove(b); live.delete(id); }
  }
  function touchNatural(b) { b.data.natural = false; live.delete(b.data.id); rec.moved[b.data.id] = 1; changed(); }
  function goneNatural(id) { if (!rec.gone.includes(id)) rec.gone.push(id); live.delete(id); changed(); }
  // ---- crafting tab in the bag
  const stationNear = () => build.stations().some((s) => s.pos.distanceTo(player.position) < 7);
  const worldsN = () => Object.keys(G.journal?.planets || {}).length;
  function recipeOk(r) {
    if (r.needs?.worlds && worldsN() < r.needs.worlds) return 'visit ' + r.needs.worlds + ' world' + (r.needs.worlds > 1 ? 's' : '') + ' first';
    if (r.needs?.tool && (T7.tools[r.needs.tool[0]] || 0) < r.needs.tool[1]) return 'needs a ' + (r.needs.tool[0] === 'pick' ? 'metal pick' : r.needs.tool[0]);
    return null;
  }
  const owned = (r) => (r.give.tool ? (T7.tools[r.give.tool[0]] || 0) >= r.give.tool[1] : r.give.ability ? !!T7.abilities[r.give.ability] : false);
  function craft(r) {
    if (owned(r) || recipeOk(r)) return false;
    if (r.station && !stationNear()) { hud.toast('Make this at a workbench (build one with the building kit)'); return false; }
    if (!pay(r.cost)) { hud.toast('Not enough yet'); return false; }
    if (r.give.tool) T7.tools[r.give.tool[0]] = r.give.tool[1];
    if (r.give.ability) { T7.abilities[r.give.ability] = Date.now(); applyAbilities(); hud.toast(`${ABILITIES[r.give.ability]}: ${r.desc}`, null, 5200); }
    if (r.give.item) add(r.give.item[0], r.give.item[1]);
    if (r.give.prop) { const p = player.position.clone().addScaledVector(dir.clone().setY(0).normalize(), 1.6); p.y = env.top(p.x, p.z, p.y + 2) + 0.4; props.spawn(r.give.prop, 0.7, p, { touched: true }); }
    if (r.give.tool) { sel = slots().findIndex((s) => s.id === r.give.tool[0]); hud.toast(`${r.name}: ${r.desc}`, null, 4200); }
    steps.play('wood', 1); changed(); commit(true); return true;
  }
  core.extraTabs.push({ id: 'craft', label: 'Craft', icon: 'leaf', render: (b, rerender) => {
    const st = stationNear();
    b.innerHTML = `<p class="muted" style="margin:6px 0 12px">${st ? 'At the workbench: everything is open to you.' : 'Hand crafting. Build a workbench (building kit) for the rest.'}</p>` + RECIPES.map((r) => {
      const no = recipeOk(r), have = owned(r), far = r.station && !st;
      const chips = hud.cost ? hud.cost(r.cost) : Object.entries(r.cost).map(([k, n]) => `${n} ${k}`).join(', ');
      return `<div class="row" style="opacity:${no ? 0.5 : 1}"><div class="grow"><div><b style="font-weight:600">${r.name}</b>${r.station ? ' <span class="muted" style="font-size:12px">· workbench</span>' : ''}</div><div class="muted" style="font-size:13px;margin:3px 0">${r.desc}</div><div>${chips}</div></div>${have ? '<span class="muted">owned</span>' : no ? `<span class="muted" style="font-size:12px">${no}</span>` : `<button class="b" data-r="${r.id}" ${far ? 'disabled style="opacity:.5"' : ''}>Make</button>`}</div>`;
    }).join('') + `<p class="muted" style="font-size:13px;margin-top:12px">Tools: ${Object.entries(T7.tools).map(([k, v]) => (v ? k + (v > 1 ? '+' : '') : '')).filter(Boolean).join(', ') || 'bare hands'} · Abilities: ${Object.keys(T7.abilities).map((k) => ABILITIES[k]).join(', ') || 'none yet'}</p>`;
    b.querySelectorAll('[data-r]').forEach((el) => el.addEventListener('pointerdown', (e) => { e.stopPropagation(); const r = RECIPES.find((x) => x.id === el.dataset.r); if (craft(r)) rerender(); }));
  } });
  void icon;
  function applyAbilities() { player.abilities.glide = !!T7.abilities.glide; player.abilities.dash = !!T7.abilities.dash; }
  applyAbilities();
  // ---- save: batched (voxel diffs re-encoded only for chunks that changed)
  let dirtyT = -1, needFull = false;
  function changed() { if (dirtyT < 0) dirtyT = 1.8; }
  function commit(now = false) {
    if (!rec || UNLOCK_ALL) return;
    rec.vox = vox.save(); rec.builds = build.save();
    rec.props = [...props.list].filter((b) => !b.data.natural && b !== carried).slice(-120).map((b) => [b.data.kind, +b.data.size.toFixed(3), b.data.mat, +b.pos.x.toFixed(2), +b.pos.y.toFixed(2), +b.pos.z.toFixed(2), +b.quat.x.toFixed(3), +b.quat.y.toFixed(3), +b.quat.z.toFixed(3), +b.quat.w.toFixed(3), b.data.dims || 0, Math.round(b.data.seed)]);
    dirtyT = -1; needFull = false; game.save(); void now;
  }
  addEventListener('pagehide', () => { if (dirtyT >= 0) commit(true); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && dirtyT >= 0) commit(true); });
  // ---- per frame
  let ghostSnap = null, ghostOk = false, subT = 0, lastPos = new THREE.Vector3(), streamT = 0, hintShown = false;
  function update(dt) {
    if (fdSet.size && (fdT -= dt) <= 0) { fdT = 0.35; for (const k of fdSet) { const [a, b] = k.split(',').map(Number); hf.floraDirty(a, b); } fdSet.clear(); }
    if (!W) return;
    isActive = true;
    const t = tool();
    computeAim();
    vox.update(dt);
    // hold / repeat the tool
    if (useHeld && !carried && active()) {
      useT += dt; const every = t === 'axe' ? 0.5 : t === 'shaper' ? 0.35 : t === 'build' ? 9 : digSpec(t).every;
      hot.progress(t === 'axe' && chop ? chop.n / 4 : 0);
      if (useT >= every) { useT = 0; useNow(false); }
    }
    if (pad.connected && active()) {
      if (pad.pressed('RT')) { if (useClaims()) { useHeld = true; useNow(true); } else interact.run(0); } if (pad.released('RT')) { useHeld = false; chop = null; }
      if (pad.pressed('LT')) { if (!secondaryAlt(t)) { if (T7.abilities.dash && player.dash()) gust(); } }
      if (pad.pressed('R3')) vineToggle();
      if (t === 'build') { if (pad.pressed('Right')) pieceI = (pieceI + 1) % PIECE_ORDER.length; if (pad.pressed('Left')) pieceI = (pieceI + PIECE_ORDER.length - 1) % PIECE_ORDER.length; if (pad.pressed('Up')) rot += Math.PI / 2; if (pad.pressed('Down')) { const ms = Object.keys(PIECES[PIECE_ORDER[pieceI]].mats); pieceMat = ms[(ms.indexOf(pieceMat) + 1) % ms.length]; } }
    }
    // carrying: a stiff spring to a point in front of her eyes
    if (carried) {
      if (!physics.bodies.has(carried)) carried = null;
      else { player.eyePos(eye); player.aimDir(dir); const target = eye.clone().addScaledVector(dir, holdD + carried.radius * 0.6); physics.carry(carried, target, dt); if (carried.pos.distanceTo(target) > 3.5) drop(false); }
    }
    stepVine(dt);
    physics.step(dt, player.position);
    props.update(dt);
    build.update(dt);
    // big resting props are part of the walkable world (stand on a boulder, a crate, a log)
    restingProps.length = 0;
    for (const b of physics.bodies) { if (b === carried || b.mass < 25 || !b.sleep) continue; if (Math.abs(b.pos.x - player.position.x) > 6 || Math.abs(b.pos.z - player.position.z) > 6) continue; const r = b.shape.type === 'box' ? Math.min(b.shape.hx, b.shape.hz) * 1.25 : b.shape.type === 'cyl' ? b.shape.r * 1.1 : b.radius * 0.8; restingProps.push({ x: b.pos.x, y: b.pos.y, z: b.pos.z, r, k: b.shape.type === 'box' ? 0 : 1, top: b.pos.y + r }); if (b.shape.type === 'box') restingProps[restingProps.length - 1].y = b.pos.y + Math.min(b.shape.hy, b.shape.hx, b.shape.hz); }
    // walking into light props nudges them
    for (const b of physics.bodies) { if (b === carried || b.mass > 60) continue; const dx = b.pos.x - player.position.x, dz = b.pos.z - player.position.z, d = Math.hypot(dx, dz); if (d < b.radius + 0.35 && Math.abs(b.pos.y - player.position.y - 0.4) < 1 && player.speed > 1) { physics.impulse(b, new THREE.Vector3(dx / d, 0.1, dz / d).multiplyScalar(player.speed * 0.3 * Math.min(1, 10 / b.mass))); b.data.touched = true; if (b.data.natural) touchNatural(b); } }
    // build ghost
    if (t === 'build' && active()) {
      const type = PIECE_ORDER[pieceI]; if (!PIECES[type].mats[pieceMat]) pieceMat = Object.keys(PIECES[type].mats)[0];
      const hit = aim && (aim.kind === 'piece' || aim.kind === 'ground') ? { point: aim.point, normal: aim.normal, piece: aim.piece } : null;
      const yaw = (aim && aim.kind === 'piece' ? 0 : Math.round((player.heading + Math.PI) / (Math.PI / 12)) * (Math.PI / 12)) + rot;
      ghostSnap = hit ? build.snap(type, yaw, hit) : null;
      ghostOk = !!ghostSnap && build.fits(type, ghostSnap.pos, ghostSnap.quat) && Object.entries(PIECES[type].mats[pieceMat]).every(([k, n]) => (G.inv[k] || 0) >= n);
      build.showGhost(type, ghostSnap, ghostOk);
      const cost = Object.entries(PIECES[type].mats[pieceMat]).map(([k, n]) => `${n} ${nameOf(k)}`).join(' + ');
      if (subT <= 0) hot.sub(`${PIECES[type].name} · ${pieceMat} · ${cost}   ${P.cls === 'pc' ? 'wheel: piece · T: material · R: turn · right-click: take back' : ''}`);
    } else { build.showGhost(null, null); ghostSnap = null; }
    if (t !== 'build' && subT <= 0) hot.sub(carried ? (P.cls === 'pc' ? 'click to throw · R to set down · wheel: closer / further' : 'use: throw · place: set down') : t === 'pick' ? 'hold to dig' : t === 'axe' ? 'hold on a trunk to fell it, or split logs' : t === 'shaper' ? 'hold to raise ground · right-click: flatten a floor' : '');
    subT -= dt;
    // gathered: one soft toast per batch
    if (gotT > 0) { gotT -= dt; if (gotT <= 0) { hud.toast(Object.entries(gotAcc).map(([k, n]) => `+${n} ${nameOf(k)}`).join('  ')); gotAcc = {}; } }
    // stream natural props as she walks
    streamT -= dt; if (streamT <= 0 || lastPos.distanceToSquared(player.position) > 64) { streamT = 1.2; lastPos.copy(player.position); streamProps(player.position.x, player.position.z); }
    for (let i = gustFx.length - 1; i >= 0; i--) { const g = gustFx[i]; g.t += dt; g.s.material.opacity = 0.25 * (1 - g.t / 0.4); if (g.t > 0.4) { scene.remove(g.s); g.s.geometry.dispose(); g.s.material.dispose(); gustFx.splice(i, 1); } }
    hot.set(slots(), sel); hot.show(!hud.panelOpen && !core.drift && !core.cinematic);
    hot.touchBtn('ability', !!T7.abilities.dash); hot.touchBtn('vine', !!T7.abilities.vine, vine ? 'let go' : 'vine'); hot.touchBtn('alt', carried || t === 'build' || t === 'shaper', carried ? 'drop' : t === 'build' ? 'take' : 'flat');
    if (dirtyT >= 0) { dirtyT -= dt; if (dirtyT < 0) commit(); }
    if (!hintShown && W) { hintShown = true; let seen = false; try { seen = localStorage.getItem('g7-hint') === '1'; localStorage.setItem('g7-hint', '1'); } catch (e) { /* */ } if (!seen) setTimeout(() => hud.toast(P.cls === 'pc' ? 'Everything here is real: dig with a click, carry stones, craft tools in the bag (Craft)' : 'Everything here is real: hold use to dig, carry stones, craft in the bag', null, 7000), 6000); }
  }
  // ---- per planet
  function load(pk, w) {
    clear();
    W = w; PK = pk;
    rec = T7.worlds[pk] = T7.worlds[pk] || { vox: {}, builds: [], props: [], gone: [], moved: {}, felled: [] };
    rec.gone = rec.gone || []; rec.moved = rec.moved || {}; rec.felled = rec.felled || [];
    physics.setGravity(w.gravity || 9.81);
    vox = createVoxels({ scene, material: terrainMat, height: hf.height2, biome: hf.biome, groundColor: hf.groundColor, seed: w.seed, lite,
      onHoles: (cx, cz) => { hf.rebuild(cx, cz); physics.dropTile(cx + ',' + cz); },
      onMesh: (key, mesh) => physics.setTerrainMesh(key, mesh) });
    vox.load(rec.vox);
    build.load(rec.builds);
    for (const p of rec.props) { const [kind, size, mat, x, y, z, qx, qy, qz, qw, dims, seed] = p; props.spawn(kind, size, new THREE.Vector3(x, y, z), { quat: new THREE.Quaternion(qx, qy, qz, qw), matKey: mat, dims: dims || null, seed, sleep: true, touched: true }); }
    streamT = 0;
  }
  function clear() {
    endVine(); carried = null;
    for (const b of [...props.list]) props.remove(b); live.clear();
    build.clear(); if (vox) vox.clear(); W = null; rec = null; isActive = false;
  }
  const sb = {
    env, terrainEnv, physics, props, build, get vox() { return vox; }, update, load, clear, secondary, commit,
    deactivate() { isActive = false; hot.show(false); endVine(); if (carried) drop(); },
    isFelled: (key) => !!(rec && rec.felled.includes(key)), markFelled: (key) => { if (rec && !rec.felled.includes(key)) { rec.felled.push(key); changed(); } },
    surface(x, z) { if (!vox || !vox.isActive(x, z)) return null; const m = vox.materialAt(x, player.position.y - 0.2, z); return m && MATS[m] ? MATS[m].step : null; },
    // tests and shots
    debug: {
      get aim() { return aim; }, get carried() { return carried; }, get tool() { return tool(); },
      select(id) { sel = Math.max(0, slots().findIndex((s) => s.id === id)); return tool(); },
      use() { computeAim(); useNow(true); return aim && aim.kind; }, alt() { computeAim(); return secondaryAlt(tool()); },
      dig(x, y, z, r = 0.8, hard = 9) { const o = vox.carve(x, y, z, r, { maxHard: hard }); credit(o.got); floraDirty(x, z); return o; },
      raise(x, y, z, r, m = MAT.STONE) { const o = vox.raise(x, y, z, r, m); floraDirty(x, z); return o; },
      spawn: (kind, size, x, y, z, o = {}) => props.spawn(kind, size, new THREE.Vector3(x, y, z), { touched: true, ...o }),
      place: (type, mat, x, y, z, yaw = 0) => build.place(type, mat, new THREE.Vector3(x, y, z), yaw),
      piece: (i, mat) => { pieceI = PIECE_ORDER.indexOf(i); pieceMat = mat; },
      grab, throwIt, drop, craft: (id) => craft(RECIPES.find((r) => r.id === id)), vineToggle, get vine() { return vine; },
      stats: () => ({ bodies: physics.count, rapier: !!physics.rapier, lite: !!physics.lite, pieces: build.pieces.size, voxChunks: vox ? vox.chunks.size : 0, voxMeshes: vox ? vox.meshes.size : 0, activeCols: vox ? vox.active.size : 0, busy: vox ? vox.busy : 0, tools: T7.tools, abilities: Object.keys(T7.abilities) }),
      tris() { let n = 0; if (vox) for (const m of vox.meshes.values()) n += m.geometry.index.count / 3; let p = 0; for (const b of physics.bodies) b.mesh && b.mesh.traverse((o) => { if (o.isMesh) p += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; }); return { voxel: n, props: p, pieces: build.pieces.size * 12 }; },
      saveSize: () => JSON.stringify(rec || {}).length,
      // run the world forward in fixed 60 Hz steps (headless frames are slow)
      advance(sec = 1) { const n = Math.round(sec * 60); for (let i = 0; i < n; i++) { vox.update(1 / 60); physics.step(1 / 60, player.position); props.update(1 / 60); build.update(1 / 60); } return physics.count; },
    },
  };
  return sb;
}
