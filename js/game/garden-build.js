// Building in the home garden with the planet building system (g7/build.js: snapping pieces, a support model,
// real rigid bodies when something falls). Offline the garden keeps your pieces in the save and the support
// model decides what falls. In the shared world the server keeps everyone's pieces (server/src/builds.js):
// you ask, it checks reach / open ground / that it stands, and every client places what it says; when a piece
// is taken down the server says what falls with it, and each client drops those as bodies.
// The physics and the pieces load the first time they are needed (you own a building kit, or there are builds).
//   const gb = createGardenBuild({ scene, camera, P, renderer, steps, player, hud, game, equip, walking, send })
//   gb.env(base) -> walker env with the pieces in it    gb.update(dt)    gb.onServer(m)
import * as THREE from 'three';
import { PIECES } from './g7/pieces.js';

const ORDER = ['floor', 'wall', 'beam', 'post', 'ramp', 'block', 'bench'];
const NAME = { 'mat:wood': 'wood', 'mat:stone': 'stone', 'mat:metal': 'metal', 'mat:ice': 'ice' };

export function createGardenBuild({ scene, camera, P, renderer, steps, player, hud, game, equip, walking, send, baseEnv }) {
  let build = null, physics = null, props = null, loading = null, online = false;
  const pend = []; // server messages that came before the pieces loaded
  const T7 = () => (game.data.g7 && game.data.g7.tools) || {};
  const inv = () => game.data.inv || {};
  const env0 = () => baseEnv();
  // ground for the physics and the build checks: the walker's ground (lawn, cove, lookout) without the pieces
  const groundEnv = { top: (x, z, y = 50) => env0().top(x, z, y), solid: (x, y, z) => { const e = env0(); return (e.solid && e.solid(x, y, z)) || y < e.top(x, z, y + 0.01); }, friction: () => 1 };
  function heightTile(cx, cz) {
    const CS = 16, n = 9, s = CS / (n - 1), pos = new Float32Array(n * n * 3), idx = [];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const x = cx * CS + i * s, z = cz * CS + j * s, k = (j * n + i) * 3; pos[k] = x; pos[k + 1] = groundEnv.top(x, z, 40); pos[k + 2] = z; }
    for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) { const a = j * n + i, b = a + 1, c = a + n, d = c + 1; idx.push(a, c, b, b, c, d); }
    return { pos, idx: new Uint32Array(idx) };
  }
  function ensure() {
    if (build || loading) return loading;
    loading = Promise.all([import('./g7/physics.js'), import('./g7/props.js'), import('./g7/build.js')]).then(([Ph, Pr, Bu]) => {
      physics = Ph.createPhysics({ P, env: groundEnv, heightTile });
      props = Pr.createProps({ scene, physics, P, renderer, steps, lite: !!P.lite });
      build = Bu.createBuild({ scene, physics, props, env: groundEnv, steps, lite: !!P.lite, autoCollapse: () => !online, sync: false });
      build.onChange = () => { if (!online) { game.data.gbuild = build.save(); game.save && game.save(); } };
      if (!online && game.data.gbuild) build.load(game.data.gbuild);
      for (const m of pend.splice(0)) api.onServer(m); // was a bare onServer(): a ReferenceError that dropped the garden's builds when server messages came before the pieces loaded
      return build;
    }).catch((e) => { console.warn('[garden-build] could not load', e); loading = null; });
    return loading;
  }
  if (T7().build || (game.data.gbuild && game.data.gbuild.length)) ensure();

  // ---- the tool
  let pieceI = 0, mat = 'wood', rot = 0, ghost = null, ghostOk = false, aimPiece = null, subT = 0;
  const me = () => (window.__zenMe ? window.__zenMe() : null);
  const tool = () => { const c = equip.current; return c && c.id === 'build-garden'; };
  setTimeout(() => equip.register({ id: 'build-garden', order: 20, glyph: '▦', label: () => 'build · ' + PIECES[ORDER[pieceI]].name.toLowerCase(), available: () => false,
    equip() { ensure(); }, unequip() { if (build) build.showGhost(null, null); } }), 0); // after the garden's 'walking' exists
  const costOf = (t, m) => PIECES[t].mats[m] || {};
  const canPay = (c) => Object.entries(c).every(([k, n]) => (inv()[k] || 0) >= n);
  const costText = (c) => Object.entries(c).map(([k, n]) => `${n} ${NAME[k] || k}`).join(' + ');
  const eye = new THREE.Vector3(), dir = new THREE.Vector3();
  function aim() {
    const R = equip.ray(); if (!R) return null; eye.copy(R.origin).addScaledVector(R.dir, R.start || 0); dir.copy(R.dir);
    const bh = build.raycast(eye, dir, 9);
    // the ground: march the ray (the walker's ground has no ray query of its own)
    let gh = null; for (let t = 0.2; t <= 9; t += 0.08) { const x = eye.x + dir.x * t, y = eye.y + dir.y * t, z = eye.z + dir.z * t; const top = groundEnv.top(x, z, y + 0.5); if (y <= top) { gh = { t, point: new THREE.Vector3(x, top, z), normal: new THREE.Vector3(0, 1, 0) }; break; } }
    if (bh && (!gh || bh.t <= gh.t)) return { point: bh.point, normal: bh.normal, piece: bh.piece };
    return gh;
  }
  function frame() {
    if (!build) return;
    if (!tool() || !walking() || hud.panelOpen) { build.showGhost(null, null); ghost = null; aimPiece = null; return; }
    const type = ORDER[pieceI]; if (!PIECES[type].mats[mat]) mat = Object.keys(PIECES[type].mats)[0];
    const hit = aim(); aimPiece = hit && hit.piece ? hit.piece : null;
    const yaw = (hit && hit.piece ? 0 : Math.round(((player.heading || 0) + Math.PI) / (Math.PI / 12)) * (Math.PI / 12)) + rot;
    ghost = hit ? build.snap(type, yaw, hit) : null;
    ghostOk = !!ghost && build.fits(type, ghost.pos, ghost.quat) && canPay(costOf(type, mat));
    build.showGhost(type, ghost, ghostOk);
    if ((subT -= 1 / 60) <= 0 && window.__zenGardenBar) window.__zenGardenBar.sub(`${PIECES[type].name} · ${mat} · ${costText(costOf(type, mat))}${P.cls === 'pc' ? '   wheel: piece · T: material · R: turn · right-click: take back' : ''}`);
  }
  const say = (t) => { if (window.__zenGardenBar) { window.__zenGardenBar.sub(t); subT = 2.4; } else hud.toast(t, null, 2200); };
  let refN = 0; const waiting = new Map(); // ref -> cost, paid when the server puts it up
  function place() {
    if (!build || !ghost) return;
    const type = ORDER[pieceI], c = costOf(type, mat);
    if (!canPay(c)) return say('Not enough: ' + costText(c));
    if (!ghostOk) return say('It does not fit there.');
    if (online) { const ref = 'r' + (++refN); waiting.set(ref, c); send({ k: 'bplace', type, mat, x: +ghost.pos.x.toFixed(3), y: +ghost.pos.y.toFixed(3), z: +ghost.pos.z.toFixed(3), yaw: +ghost.yaw.toFixed(4), ref }); return; }
    if (game.pay(c) === false) return;
    build.place(type, mat, ghost.pos, ghost.yaw);
  }
  function takeBack() {
    if (!build || !aimPiece) return;
    if (online) { send({ k: 'bremove', id: aimPiece.id }); return; }
    const c = costOf(aimPiece.type, aimPiece.mat); build.removePiece(aimPiece); for (const [k, n] of Object.entries(c)) game.add(k, n); steps && steps.play && steps.play('wood', 0.7);
  }
  const api = {
    get build() { return build; }, get online() { return online; }, ensure,
    isTool: tool,
    primary(down) { if (down && tool()) { place(); return true; } return tool(); },
    secondary(down) { if (down && tool()) { if (aimPiece) takeBack(); else rot += Math.PI / 2; return true; } return tool(); },
    key(e) {
      if (!tool()) return false;
      if (e.code === 'KeyR') { rot += Math.PI / 12 * (e.shiftKey ? -1 : 1) * 2; return true; }
      if (e.code === 'KeyT') { const ms = Object.keys(PIECES[ORDER[pieceI]].mats); mat = ms[(ms.indexOf(mat) + 1) % ms.length]; return true; }
      return false;
    },
    wheel(dy) { if (!tool()) return false; pieceI = (pieceI + Math.sign(dy) + ORDER.length) % ORDER.length; return true; },
    // the walker stands on pieces and bumps into them
    env(base) {
      return {
        top: (x, z, y) => { const b = base.top(x, z, y); if (!build) return b; const t = build.top(x, z, y); return t > b ? t : b; },
        solid: (x, y, z) => (base.solid ? base.solid(x, y, z) : false) || (build ? build.solid(x, y, z) : false),
        liquid: base.liquid,
      };
    },
    update(dt) {
      if (!build) return;
      physics.step(dt, player.position); props.update(dt); build.update(dt); frame();
    },
    onServer(m) {
      if (m.k === 'reset') { if (online && build) { build.clear(); online = false; if (game.data.gbuild) build.load(game.data.gbuild); } online = false; return; }
      if (m.k === 'bno') { say(m.text); return; }
      if (!build) { if (m.k === 'builds' && !m.list.length) { online = true; return; } pend.push(m); ensure(); return; }
      if (m.k === 'builds') { online = true; build.clear(); for (const [id, t, mt, x, y, z, yaw] of m.list) if (PIECES[t]) build.place(t, mt, new THREE.Vector3(x, y, z), yaw, { id, quiet: true }); return; }
      if (m.k === 'bput') {
        online = true; const [id, t, mt, x, y, z, yaw] = m.p;
        if (!build.pieces.has(id) && PIECES[t]) build.place(t, mt, new THREE.Vector3(x, y, z), yaw, { id, quiet: m.by !== me() });
        if (m.ref && waiting.has(m.ref) && m.by === me()) { game.pay(waiting.get(m.ref)); waiting.delete(m.ref); }
        return;
      }
      if (m.k === 'bdel') {
        for (const id of m.ids || []) { const p = build.pieces.get(id); if (p) build.removePiece(p); }
        for (const id of m.fall || []) { const p = build.pieces.get(id); if (p) build.removePiece(p, true, new THREE.Vector3(0, -0.3, 0)); }
      }
    },
  };
  return api;
}
