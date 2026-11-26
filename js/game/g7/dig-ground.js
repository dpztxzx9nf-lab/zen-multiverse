// Diggable ground for the hand-made worlds (Earth around the garden, the Moon): the same 0.5 m
// voxels as the planets, but only where she actually digs. Untouched ground stays the world's own
// mesh; a 16 m column turns into voxels on the first dig and the host ground hides that square with
// a tiny hole mask (one texel per column, discard in its shader), so no triangles are rebuilt or
// duplicated (and nothing here touches props or their batching: rocks and trees stay the world's).
// Edits are saved as per-chunk diffs (run-length against the untouched ground) in T7.worlds[key].vox.
//
// Real rules: bare hands move soft soil, sand and snow slowly; stone, ore and ice need the pick she
// earned on a planet (better pick, harder rock, faster). What comes out goes into the bag (2 voxel
// units per item); filling a hole uses up what she carries. Nothing is dug under buildings, rocks,
// trees, the pad or (on Earth) the garden itself.
//   const dig = createDigGround({ key, scene, P, player, hud, interact, height, biome, groundColor,
//     groundMats, voxMat, area: { cx, cz, half }, noDig(x,z), itemFor(m), fillOrder, sound })
//   dig.update(dt)  dig.env (for player.setEnv)  dig.setActive(on)  dig.debugDig(x,z,n)
import * as THREE from 'three';
import { createVoxels, CN } from './voxel.js';
import { MATS, MAT, VS } from './materials.js';
import { ensureG7, practice } from '../skills.js';
import { game, UNLOCK_ALL } from '../store.js';
import { addPressHandler } from '../interact.js';
import { equip } from '../equip.js';

export { MAT, MATS };
const CS = CN * VS;
const DIG = { hands: { r: 0.42, hard: 0.9, every: 0.42, reach: 2.6 }, pick1: { r: 0.62, hard: 2.7, every: 0.3, reach: 3.4 }, pick2: { r: 0.85, hard: 3.6, every: 0.24, reach: 3.6 } };

// hide the host ground over voxel columns: chain the material's own shader hooks
export function addHoleMask(mat, U, yMax = null) {
  const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey ? mat.customProgramCacheKey.bind(mat) : null;
  mat.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    sh.uniforms.uHoles = U.tex; sh.uniforms.uHoleO = U.o; sh.uniforms.uHoleN = U.n;
    sh.vertexShader = 'varying vec3 vHoleW;\n' + sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
      #ifdef USE_INSTANCING
        vHoleW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
      #else
        vHoleW = (modelMatrix * vec4(transformed, 1.0)).xyz;
      #endif`);
    sh.fragmentShader = 'varying vec3 vHoleW; uniform sampler2D uHoles; uniform vec2 uHoleO; uniform float uHoleN;\n' + sh.fragmentShader.replace('void main() {', `void main() {
      { vec2 hc = (vHoleW.xz - uHoleO) / ${CS.toFixed(1)};
        if (hc.x >= 0.0 && hc.y >= 0.0 && hc.x < uHoleN && hc.y < uHoleN${yMax != null ? ' && vHoleW.y < ' + yMax.toFixed(3) : ''} && texture2D(uHoles, (floor(hc) + 0.5) / uHoleN).r > 0.5) discard; }`);
  };
  mat.customProgramCacheKey = () => (prevKey ? prevKey() : '') + '|holes' + (yMax != null ? yMax : '');
  mat.needsUpdate = true;
}
// a copy of the host ground material for the voxel meshes (same textures and shader hooks, no mask)
export function voxelCopy(mat, extra = null) {
  const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey ? mat.customProgramCacheKey.bind(mat) : null;
  // Material.copy deep-copies userData through JSON (textures there only warn and vanish): share it instead
  const ud = mat.userData; mat.userData = {}; const m = mat.clone(); mat.userData = ud; m.userData = { ...ud };
  m.onBeforeCompile = (sh, r) => { if (prev) prev(sh, r); if (extra) extra(sh, r); };
  m.customProgramCacheKey = () => (prevKey ? prevKey() : '') + '|vox';
  m.vertexColors = true;
  return m;
}

export function createDigGround({ key, scene, camera = null, P, player, hud, interact, height, biome, groundColor, groundMats = [], voxMat, area, noDig = () => null, itemFor = (m) => MATS[m] && MATS[m].item, fillOrder = ['mat:soil', 'mat:sand', 'mat:stone', 'mat:ice'], sound = () => {}, fibre = false, soilDepth = 1, tint = {} }) {
  const G = game.data, T7 = ensureG7(G);
  T7.worlds = T7.worlds || {};
  const rec = (T7.worlds[key] = T7.worlds[key] || {});
  const lite = !!(P && P.lite);
  // ---- hole mask over the playable square (whole 16 m columns)
  const N = Math.ceil((area.half * 2) / CS), o = new THREE.Vector2(Math.floor((area.cx - area.half) / CS) * CS, Math.floor((area.cz - area.half) / CS) * CS);
  const data = new Uint8Array(N * N * 4);
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat); tex.magFilter = tex.minFilter = THREE.NearestFilter; tex.needsUpdate = true;
  const U = { tex: { value: tex }, o: { value: o }, n: { value: N } };
  for (const m of groundMats) addHoleMask(m, U);
  const inArea = (x, z) => x >= o.x && z >= o.y && x < o.x + N * CS && z < o.y + N * CS;
  const vox = createVoxels({
    scene, material: voxMat, height, biome, groundColor, seed: 4242, lite, soilDepth, tint,
    uvScale: voxMat.userData.uvScale || [1 / 3.5, 1 / 3.5],
    onHoles: (cx, cz) => {
      const i = cx - Math.round(o.x / CS), j = cz - Math.round(o.y / CS);
      if (i < 0 || j < 0 || i >= N || j >= N) return;
      data[(j * N + i) * 4] = 255; tex.needsUpdate = true;
    },
  });
  try { vox.load(rec.vox); } catch (e) { console.warn('[dig] bad save', e); }
  // ---- the walker stands on (and bumps into) the dug ground; elsewhere the world's own ground
  const env0 = { top: null, solid: null, liquid: null };
  const env = {
    top(x, z, y) {
      const base = env0.top ? env0.top(x, z, y) : height(x, z);
      if (!vox.isActive(x, z)) return base;
      const t = vox.top(x, z, y);
      return Math.abs(t - height(x, z)) < 0.05 ? base : t; // untouched voxels: keep the world's own little steps
    },
    solid(x, y, z) { return (env0.solid ? env0.solid(x, y, z) : false) || (vox.isActive(x, z) && vox.density(x, y, z) > 0.02 && y > height(x, z) - 40); },
    liquid(x, z) { return env0.liquid ? env0.liquid(x, z) : null; }, // still water the world has here (the cove)
  };
  // ---- tool: hands, or the pick she earned on a planet
  let on = true, lastU = -1e9, holding = 0, digT = 0, fillHeld = false, fillT = 0, msgT = 0, saveT = -1, aimHit = null;
  const frac = {};
  const spec = () => (T7.tools && T7.tools.pick ? (T7.tools.pick > 1 ? DIG.pick2 : DIG.pick1) : DIG.hands);
  // only the world being ticked right now answers clicks (other worlds keep their handler but go quiet)
  const busy = () => !on || performance.now() - lastU > 300 || hud.panelOpen || hud.dialogOpen || (hud.mode && hud.mode !== 'walk');
  const R = { eye: new THREE.Vector3(), dir: new THREE.Vector3() };
  const hfSolid = (x, y, z) => y < height(x, z);
  function aim() {
    if (camera) equip.bindView(camera, player); // Earth has no walkcore to bind the aim view
    const r = equip.ray(); R.eye.copy(r.origin).addScaledVector(r.dir, r.start); R.dir.copy(r.dir);
    const D = spec(); const h = vox.raycast(R.eye, R.dir, D.reach, hfSolid);
    if (!h || !inArea(h.point.x, h.point.z)) return null;
    const why = noDig(h.point.x, h.point.z); return { ...h, why };
  }
  const say = (t) => { if (msgT > 0) return; msgT = 2.4; hud.toast ? hud.toast(t, 'dig', 2200) : null; };
  function credit(got) {
    for (const [m, v] of Object.entries(got)) {
      const it = itemFor(+m); if (!it) continue;
      frac[it] = (frac[it] || 0) + v / 2; const n = Math.floor(frac[it]);
      if (n > 0) { frac[it] -= n; G.inv[it] = (G.inv[it] || 0) + n; }
      if (fibre && +m === MAT.SOIL && Math.random() < v * 0.08) G.inv.fibre = (G.inv.fibre || 0) + 1;
    }
  }
  function digOnce() {
    const a = aim(); aimHit = a; if (!a) return false;
    if (a.why) { say(a.why); return false; }
    const D = spec(), p = a.point.clone().addScaledVector(R.dir, D.r * 0.35);
    const { got, blocked } = vox.carve(p.x, p.y, p.z, D.r, { maxHard: D.hard });
    const m = Object.keys(got)[0];
    if (m) { credit(got); practice('gathering', 1); sound(MATS[m] ? MATS[m].step : 'gravel'); dirty(); }
    else if (blocked) { say(D === DIG.hands ? 'Too hard for bare hands. A pick would break it' : 'Too hard for this pick'); sound('stone'); }
    return true;
  }
  function fillOnce() {
    const a = aim(); if (!a) return false;
    if (a.why) { say(a.why); return false; }
    const it = fillOrder.find((k) => (G.inv[k] || 0) > 0);
    if (!it) { say('Nothing in your bag to fill with'); return true; }
    const m = { 'mat:stone': MAT.STONE, 'mat:soil': MAT.PACKED, 'mat:sand': MAT.SAND, 'mat:ice': MAT.ICE, regolith: MAT.SAND, ice: MAT.ICE }[it] || MAT.PACKED;
    const p = a.point.clone().addScaledVector(a.normal, 0.25);
    // never bury her: keep the new ground off the spot she is standing on
    const pp = player.position; if (Math.hypot(p.x - pp.x, p.z - pp.z) < 0.9 && p.y > pp.y - 0.4) { say('Step back to fill there'); return true; }
    const used = vox.raise(p.x, p.y, p.z, 0.55, m, (G.inv[it] || 0) * 2);
    frac['-' + it] = (frac['-' + it] || 0) + used / 2; const n = Math.floor(frac['-' + it]);
    if (n) { frac['-' + it] -= n; G.inv[it] = Math.max(0, (G.inv[it] || 0) - n); if (!G.inv[it]) delete G.inv[it]; }
    if (used) { sound(MATS[m].step); dirty(); }
    return true;
  }
  function dirty() { if (saveT < 0) saveT = 2; }
  function commit() { saveT = -1; if (UNLOCK_ALL) return; rec.vox = vox.save(); game.save(); }
  // left click digs, right click fills, but only when aiming at open ground in reach and not at something to use
  const claim = () => !busy() && !(interact && interact.current) && !!aim();
  const off = addPressHandler({
    down(b) {
      if (b !== 0 && b !== 2) return false;
      if (!claim()) return false;
      if (b === 0) { holding = 1; digT = 0; digOnce(); } else { fillHeld = true; fillT = 0; fillOnce(); }
      return true;
    },
    up(b) { if (b === 0) holding = 0; if (b === 2) fillHeld = false; },
  });
  const api = {
    vox, env, player,
    wrapEnv(e) { env0.top = e && e.top; env0.solid = e && e.solid; env0.liquid = (e && e.liquid) || null; return env; },
    setActive(v) { on = !!v; if (!on) { holding = 0; fillHeld = false; } },
    get active() { return on; },
    update(dt) {
      lastU = performance.now(); msgT -= dt;
      if (holding && !busy()) { digT += dt; const D = spec(); if (digT >= D.every) { digT -= D.every; digOnce(); } }
      if (fillHeld && !busy()) { fillT += dt; if (fillT >= 0.3) { fillT -= 0.3; fillOnce(); } }
      vox.update(dt);
      if (saveT >= 0) { saveT -= dt; if (saveT < 0) commit(); }
    },
    save: commit,
    stats() { let tris = 0; for (const m of vox.meshes.values()) tris += (m.geometry.index ? m.geometry.index.count : 0) / 3; return { columns: vox.active.size, meshes: vox.meshes.size, tris, chunks: vox.chunks.size, busy: vox.busy, bytes: JSON.stringify(rec.vox || {}).length }; },
    // dev/test hook: dig n bites straight down at (x, z) with the current tool
    debugDig(x, z, n = 6, r = null) {
      const D = spec(); let y = height(x, z); const out = {};
      for (let k = 0; k < n; k++) { const { got } = vox.carve(x, y, z, r || D.r, { maxHard: D.hard }); for (const [m, v] of Object.entries(got)) out[MATS[m].id] = (out[MATS[m].id] || 0) + v; credit(got); y -= (r || D.r) * 0.6; }
      dirty(); return out;
    },
    get aim() { return aimHit; },
    // things lying on the old surface (leaf litter) hide over dug columns below yMax
    maskMaterial(mat, yMax = null) { addHoleMask(mat, U, yMax); },
    rayInfo() { if (camera) equip.bindView(camera, player); const r = equip.ray(); const f = (v) => [+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2)]; const h = vox.raycast(r.origin, r.dir, 20, hfSolid); return { o: f(r.origin), d: f(r.dir), start: +r.start.toFixed(2), hit: h && { t: +h.t.toFixed(2), p: f(h.point) }, reach: spec().reach }; },
    why: (x, z) => noDig(x, z), aimDig: () => digOnce(), aimFill: () => fillOnce(),
    dispose() { off(); vox.clear(); },
    // dev only (?unlock=all): try the pick tiers
    devTool(n) { if (UNLOCK_ALL) { T7.tools = T7.tools || {}; T7.tools.pick = n; } return spec(); },
  };
  if (typeof window !== 'undefined') (window.__zenDig = window.__zenDig || {})[key] = api;
  return api;
}
