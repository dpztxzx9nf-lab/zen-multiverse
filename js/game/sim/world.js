// The living world, wired into a planet: the ground field (field.js) fed from the voxels and the
// heightfield, weather and day/night, props that warm, burn, char, smelt, melt, float and sink,
// trees that catch fire, power networks on build pieces, feet that leave prints and feel the mud,
// creatures that run from fire, and the tools that start fires and carry water.
//   const sim = createSim({ scene, P, core, sb, hf, terrainMat, steps, audio })
//   sim.load(pk, W, rec)  sim.update(dt)  sim.feel(x, z)  sim.surface(x, z)  sim.save()
import * as THREE from 'three';
import { createField, TICK, TC } from './field.js';
import { createPower, ELECTRIC } from './power.js';
import { createSimView } from './view.js';
import { worldRules, EARTH_RULES } from './rules.js';
import { CLIMATE, SOLIDS, G } from './matter.js';
import { MAT } from '../g7/materials.js';
import { equip } from '../equip.js';
import { inside, closestPoint } from '../g7/obb.js';

const fl = Math.floor;
const h2 = (a, b, s = 0) => { let h = (a * 374761393 + b * 668265263 + s * 1442695041) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const smooth1 = (t, s) => { const i = Math.floor(t), f = t - i, u = f * f * (3 - 2 * f); return h2(i, s) * (1 - u) + h2(i + 1, s) * u; };

export function createSim({ scene, P, core, camera, sb, hf, terrainMat, steps, audio, params }) {
  const lite = P.cls !== 'pc';
  const { player, hud } = core;
  const tiles = lite ? 3 : 5;
  const budgetMs = lite ? 1.5 : 4;
  let field = null, W = null, rec = null, on = false, acc = 0;
  const power = createPower();
  const view = createSimView({ scene, terrainMat, P, renderer: null });
  const wx = { rain: 0, wind: [0, 0], cloud: 0, air: 0, sun: 0.8, night: 0, override: {} };
  let R = EARTH_RULES; // this world's laws (sim/rules.js reads core.worldRules; Earth until it exists)

  // ---------- a fresh tile of ground, read from the world itself
  function initTile(gx0, gz0, b, n, cell) {
    const top = sb.terrainEnv.top;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = j * n + i, x = (gx0 + i + 0.5) * cell, z = (gz0 + j + 0.5) * cell;
      const g = hf.ground(x, z);
      const vx = sb.vox && sb.vox.isActive(x, z);
      const h = vx ? top(x, z, g + 3) : g;
      b.H[k] = h;
      const bio = hf.biome(x, z, h) || 'forest', C = CLIMATE[bio] || CLIMATE.forest;
      const sl = Math.hypot(hf.ground(x + 0.5, z) - hf.ground(x - 0.5, z), hf.ground(x, z + 0.5) - hf.ground(x, z - 0.5));
      let m = vx ? sb.vox.materialAt(x, h - 0.2, z) : 0;
      if (!m) m = sl > 1.25 ? MAT.STONE : bio === 'shore' || bio === 'salt' ? MAT.SAND : bio === 'ice' ? MAT.SNOW : MAT.SOIL;
      if (m === MAT.SNOW && !vx) { m = MAT.SOIL; b.S[k] = (C.snow || 0.2) * (0.7 + 0.6 * h2(gx0 + i, gz0 + j, 3)); }
      b.mat[k] = m;
      const patch = 0.55 + 0.45 * smooth1((gx0 + i) * 0.11 + (gz0 + j) * 0.07, 9) * smooth1((gz0 + j) * 0.13 - (gx0 + i) * 0.05, 4);
      const grows = m === MAT.SOIL ? 1 : m === MAT.SAND ? 0.35 : m === MAT.PACKED ? 0.5 : 0;
      b.Ta[k] = C.air + R.airC - 0.0065 * Math.max(0, h - (W && W.hasSea ? W.sea : 0));
      // only as much life as the world's biology, air and water allow (none at all on a dead world)
      const life = Math.min(1, R.plants * Math.min(1, R.co2) * (R.liquid ? 1 : 0));
      b.Vc[k] = C.veg * grows * patch * life; b.V[k] = b.Vc[k];
      b.M[k] = b.Mb[k] = R.liquid ? C.moist * Math.min(1.3, 0.4 + 0.6 * R.rain) * (0.8 + 0.4 * h2(gx0 + i, gz0 + j, 5)) * (sl > 1.25 ? 0.4 : 1) : 0;
      b.Fu[k] = C.fuel * patch * grows * life; b.Nu[k] = 0.45 * Math.max(0.2, Math.min(1, R.microbes));
      if (!R.liquid) b.S[k] = 0;
      if (W && W.hasSea && h < W.sea) { b.sea[k] = 1; b.W[k] = W.sea - h; b.V[k] = b.Vc[k] = 0; b.Fu[k] = 0; b.mat[k] = m === MAT.STONE ? m : MAT.SAND; b.M[k] = b.Mb[k] = 1; b.S[k] = 0; }
      if (sb.build && sb.build.top(x, z, h + 30) > h + 1.2) b.cover[k] = 1;
    }
  }
  function load(pk, w, r) {
    W = w; rec = r; rec.sim = rec.sim || {};
    R = worldRules(core, w);
    field = createField({ tiles, cell: 0.5, seaLevel: w.hasSea ? w.sea : -1e4, initTile });
    applyLaws();
    field.load(rec.sim.ground);
    power.load(rec.sim.power);
    burning.clear(); treeHeat.clear(); propT.clear();
    acc = 0; on = true; wx.override = {};
    const p = player.position; field.recentre(p.x, p.z);
    view.attach(field);
    piecesChanged();
  }
  // the world's laws into the field: gravity, boiling point, liquid water, oxygen, air density, life
  function applyLaws() {
    const E = field.env;
    E.g = R.g; E.boil = R.boilC; E.liquid = R.liquid; E.o2 = R.o2; E.burn = R.allows('combustion'); E.conv = R.conv; E.evap = R.evap;
    E.life = Math.min(1.5, R.plants * Math.min(1.5, R.co2) * (R.liquid ? 1 : 0)); E.lifeMin = R.lifeTMin; E.lifeMax = R.lifeTMax; E.micro = R.microbes;
  }
  function clear() { on = false; field = null; view.attach(null); burning.clear(); }

  // ---------- weather and the day: the same for everyone on this world (seeded, from the clock)
  function weather(dt) {
    const t = Date.now() / 1000, s = W.seed || 1, bio = hf.biome(player.position.x, player.position.z, player.position.y) || 'forest';
    const wet = { forest: 0.55, shore: 0.5, crystal: 0.45, ice: 0.4, salt: 0.12 }[bio] ?? 0.4;
    // storms come and go over ~10-20 minutes; windier before and during rain
    const storm = smooth1(t / 700, s * 7 + 1) * 0.7 + smooth1(t / 170, s * 7 + 2) * 0.3;
    const rainK = Math.max(0, (storm - (1 - wet * 0.75)) / (wet * 0.75));
    const want = wx.override.rain ?? rainK * R.rain; // no liquid water, no rain
    wx.rain += (want - wx.rain) * Math.min(1, dt * 0.3);
    wx.cloud = wx.override.cloud ?? Math.min(1, Math.max(wx.rain * 1.4, storm * 0.6));
    const ang = smooth1(t / 900, s * 3) * 12.6, sp = (wx.override.wind ?? (1 + 5 * smooth1(t / 240, s * 3 + 1) + 4 * wx.rain));
    wx.wind[0] = Math.sin(wx.override.windDir ?? ang) * sp; wx.wind[1] = Math.cos(wx.override.windDir ?? ang) * sp;
    const hr = new Date().getHours() + new Date().getMinutes() / 60;
    wx.night = params && params.has('night') ? 1 : hr >= 21 || hr < 5.5 ? 1 : hr >= 19.5 ? (hr - 19.5) / 1.5 : hr < 7 ? (7 - hr) / 1.5 : 0;
    const elev = W.sky ? Math.max(0.05, Math.sin(W.sky.sunElev)) : 0.6;
    wx.sun = (1 - wx.night) * Math.min(1, elev * 1.6) * (1 - wx.cloud * 0.7) * R.sun;
    // thin air holds less heat: bigger day/night swings (a vacuum world swings hardest)
    const swing = R.swing * (1 + Math.max(0, 1 - R.conv) * 2);
    wx.air = ((wx.night * -7) + (wx.sun - 0.5) * 3) * swing - wx.rain * 3 + (wx.override.air || 0);
    const E = field.env; E.rain = wx.rain * 2.2e-4; E.wind = wx.wind; E.sun = wx.sun; E.air = wx.air;
  }

  // ---------- props: warm up, burn, char, smelt, melt, float, sink
  const propT = new Map(); // body -> { T, burn, smelt, sunk }
  const _v = new THREE.Vector3();
  function props() {
    const f = field.f;
    for (const b of sb.physics.bodies) {
      const k = field.idxAt(b.pos.x, b.pos.z); if (k < 0) continue;
      const mat = b.data.mat === 'stone' && b.data.ore ? 'ore' : b.data.mat, S = SOLIDS[mat] || SOLIDS.stone;
      let s = propT.get(b); if (!s) propT.set(b, (s = { T: field.airAt(k) + 10, burn: 0, smelt: 0, sunk: 0 }));
      const ground = f.H[k] + f.I[k], surf = ground + f.W[k], bottom = b.pos.y - b.radius;
      const touching = bottom < ground + 0.25;
      // heat: lies in the cell's heat (fire, hot ground), or eases toward the air
      const env = touching ? f.T[k] : field.airAt(k);
      const tau = Math.max(2, (b.mass * S.c) / (Math.max(0.3, b.radius * b.radius * 12) * 60)); // m c / (h A), seconds
      s.T += (env - s.T) * Math.min(1, TICK / tau);
      if (f.W[k] > 0.02 && bottom < surf) s.T = Math.min(s.T, R.boilC - (R.boilC - field.airAt(k)) * 0.5); // water holds it near boiling (pressure-set)
      // wood burns: it feeds the fire under it and turns to charcoal; dry wood only
      if (mat === 'wood') {
        const oxL = f.O[k] * field.env.o2;
        if (!s.burn && field.env.burn && oxL > 0.3 && s.T > (SOLIDS.wood.ignite) && !(f.W[k] > 0.003) && field.env.rain < 1e-4) { s.burn = 1; b.data.burning = true; }
        if (s.burn && (!field.env.burn || oxL < 0.25)) { s.burn = 0; b.data.burning = false; } // starved of oxygen: it goes out, charred
        if (s.burn) {
          s.burn += TICK; const kg = Math.min(b.mass, b.mass * 0.012 * TICK * (0.6 + Math.min(2.5, oxL)));
          field.addFuel(b.pos.x, b.pos.z, kg * 0.6, Math.max(0.3, b.radius * 0.8), kg * 0.05);
          field.heat(b.pos.x, b.pos.z, Math.max(0.3, b.radius * 0.7), 720, 0.25);
          s.T = Math.max(s.T, 650);
          b.data.charred = Math.min(1, (b.data.charred || 0) + TICK * 0.03);
          view.charProp(b, b.data.charred);
          if (f.W[k] > 0.004 && bottom < surf) { s.burn = 0; b.data.burning = false; s.T = 90; view.steamAt(b.pos.x, b.pos.y, b.pos.z, 8); }
          if (s.burn > 20 + b.mass * 0.9) { // burnt through: what is left is charcoal on the ground
            field.addFuel(b.pos.x, b.pos.z, 0, Math.max(0.4, b.radius), b.mass * 0.2);
            sb.props.remove(b); propT.delete(b); continue;
          }
        }
      }
      // ore in a fire hot enough (charcoal + air) runs out as metal
      if (b.data.ore && s.T > SOLIDS.ore.smelt) { s.smelt += TICK; if (s.smelt > 4) { const at = b.pos.clone(); sb.props.remove(b); propT.delete(b); const m = sb.props.spawn('block', 0.3, at.setY(at.y + 0.1), { dims: [0.28, 0.08, 0.14], matKey: 'metal', touched: true }); if (m) { view.glow(m, 1); hud.toast('Metal ran out of the ore', null, 2600); } continue; } }
      // ice melts into water where it lies
      if (mat === 'ice' && s.T > 0.5) { s.melt = (s.melt || 0) + TICK * (s.T / 15); if (s.melt > 3 + b.mass * 0.05) { field.addWater(b.pos.x, b.pos.z, b.volume * 0.92, Math.max(0.3, b.radius)); sb.props.remove(b); propT.delete(b); continue; } }
      // water: buoyancy (Archimedes) and drag
      if (f.W[k] > 0.01 && bottom < surf && !b.held) {
        const sub = Math.min(1, (surf - bottom) / (2 * b.radius)), vSub = b.volume * sub;
        const up = (1000 * vSub * R.g) / b.mass * TICK; // dv from buoyancy this tick (gravity is the engine's)
        const [vx, vz] = field.speedAt(k);
        _v.set((vx - b.vel.x) * 0.25 * sub, up - b.vel.y * 0.35 * sub, (vz - b.vel.z) * 0.25 * sub);
        if (_v.lengthSq() > 1e-5) sb.physics.impulse(b, _v);
      }
      // weight on soft ground: a heavy thing resting on mud or snow sinks a little
      if (b.sleep && touching && s.sunk < b.radius * 0.6) {
        const area = Math.max(0.05, Math.PI * b.radius * b.radius * 0.5), press = (b.mass * R.g) / area, bear = field.bearing(b.pos.x, b.pos.z);
        if (press > bear) { const d = Math.min(0.004, (press / bear - 1) * 0.0015); s.sunk += d; b.pos.y -= d; if (b.rb) b.rb.setTranslation({ x: b.pos.x, y: b.pos.y, z: b.pos.z }, false); if (b.mesh) b.mesh.position.y = b.pos.y; f.C[k] = Math.min(1, f.C[k] + 0.01); f.Pr[k] = Math.min(1, f.Pr[k] + 0.02); }
      }
      // impacts on build pieces: kinetic energy against what the piece can take
      if (!b.sleep && sb.build) { const ke = 0.5 * b.mass * b.vel.lengthSq(); if (ke > 300) hitPieces(b, ke); }
    }
    for (const b of propT.keys()) if (!sb.physics.bodies.has(b)) propT.delete(b);
  }
  const TOUGH_J = { wood: 900, stone: 3500, metal: 12000, ice: 500, crystal: 1500 };
  function hitPieces(b, ke) {
    for (const p of sb.build.pieces.values()) {
      if (Math.abs(p.pos.x - b.pos.x) > 3 || Math.abs(p.pos.z - b.pos.z) > 3) continue;
      const cp = closestPoint(p.box, b.pos, _v); if (cp.distanceTo(b.pos) > b.radius + 0.1) continue;
      const need = TOUGH_J[p.mat] || 2000;
      p.dmg = (p.dmg || 0) + ke / need;
      if (p.dmg >= 1) { const kick = b.vel.clone().multiplyScalar(0.3); sb.build.removePiece(p, true, kick); steps && steps.play(p.mat === 'wood' ? 'wood' : 'stone', 1.4); }
      b.data.hitT = performance.now(); return;
    }
  }

  // ---------- trees catch fire from the ground, burn standing, throw embers downwind, then fall
  const treeHeat = new Map(), burning = new Map();
  function trees() {
    if (!hf.trunksNear) return;
    const f = field.f, N = field.N;
    // only look near fire
    const seen = new Set();
    for (let t = 0; t < field.NT * field.NT; t++) {
      if (!field.awake[t]) continue;
      const tx = t % field.NT, tz = (t / field.NT) | 0; let any = false;
      for (let j = tz * TC; j < tz * TC + TC && !any; j += 2) for (let i = tx * TC; i < tx * TC + TC; i += 2) if (f.Fi[j * N + i] > 0.2) { any = true; break; }
      if (!any) continue;
      const cx = field.cellX(tz * TC * N + tx * TC) + 7.75, cz = field.cellZ(tz * TC * N + tx * TC) + 7.75;
      for (const tr of hf.trunksNear(cx, cz, 12)) {
        const key = Math.round(tr[0] * 10) + ':' + Math.round(tr[1] * 10); if (seen.has(key) || burning.has(key)) continue; seen.add(key);
        const k = field.idxAt(tr[0], tr[1]); if (k < 0) continue;
        let h = treeHeat.get(key) || 0; h += f.Fi[k] * 0.12 + (f.T[k] > 300 ? 0.04 : 0) - 0.01; h = Math.max(0, h);
        if (h > 1 && f.M[k] < 0.5 && field.env.burn) { burning.set(key, { tr, t: 0, h: Math.min(12, (tr[4] || 8)) }); treeHeat.delete(key); }
        else if (h > 0) treeHeat.set(key, h); else treeHeat.delete(key);
      }
    }
    for (const [key, B] of burning) {
      B.t += TICK; const [x, z, r] = B.tr; const k = field.idxAt(x, z);
      if (k < 0) { burning.delete(key); continue; }
      field.addFuel(x, z, 0.02, 0.6); field.heat(x, z, 0.7, 800, 0.2);
      // embers: blown downwind, landing up to ~10 m away (spotting), seeded so the server would agree
      const [wx0, wz0] = field.env.wind, wm = Math.hypot(wx0, wz0);
      if (h2(field.env.tick, Math.round(x * 7), 77) < 0.03 * (1 + wm * 0.3)) { const d = 3 + 7 * h2(field.env.tick, Math.round(z * 7), 78), a = (h2(field.env.tick, 5, 79) - 0.5) * 0.8; const dx = wm ? wx0 / wm : 1, dz = wm ? wz0 / wm : 0; field.ignite(x + (dx * Math.cos(a) - dz * Math.sin(a)) * d, z + (dz * Math.cos(a) + dx * Math.sin(a)) * d, 0.3, 420); }
      if ((field.env.rain > 1e-4 && B.t > 6) || field.f.W[k] > 0.02) { B.t = Math.max(B.t, 999); }
      if (B.t > 28) {
        burning.delete(key);
        const r2 = hf.fellTree ? hf.fellTree(B.tr) : null;
        if (r2) { const len = Math.min(4.2, Math.max(1.6, r2.h * 0.55)); const away = new THREE.Vector3(wm ? wx0 / wm : 1, 0, wm ? wz0 / wm : 0); const axis = new THREE.Vector3(away.z, 0, -away.x);
          const lg = sb.props.spawn('log', len, new THREE.Vector3(r2.x, r2.y + len / 2 + 0.05, r2.z), { ang: axis.multiplyScalar(0.9), touched: true }); if (lg) { lg.data.charred = 0.8; view.charProp(lg, 0.8); propT.set(lg, { T: 500, burn: 1, smelt: 0, sunk: 0 }); lg.data.burning = true; } }
      }
    }
    void seen;
  }

  // ---------- power on build pieces
  const SIDE = new THREE.Vector3();
  function contactsOf(p) {
    const out = []; const r = p.box.r + 0.3;
    for (const q of sb.build.pieces.values()) {
      if (q === p || Math.abs(q.pos.x - p.pos.x) > r + q.box.r || Math.abs(q.pos.z - p.pos.z) > r + q.box.r || Math.abs(q.pos.y - p.pos.y) > r + q.box.r) continue;
      const cp = closestPoint(q.box, p.box.c, new THREE.Vector3());
      if (!inside(p.box, cp.x, cp.y, cp.z, 0.06)) continue;
      SIDE.subVectors(cp, p.box.c).applyQuaternion(p.box.qi); const h = p.box.h;
      const side = SIDE.y < -h.y + 0.05 ? 'bottom' : SIDE.z > h.z - 0.05 ? 'front' : SIDE.y > h.y - 0.05 ? 'top' : 'ctl';
      out.push({ id: q.id, side });
    }
    return out;
  }
  let piecesDirty = true;
  function piecesChanged() { piecesDirty = true; }
  function powerTick() {
    if (!sb.build) return;
    if (piecesDirty) {
      piecesDirty = false;
      const list = []; for (const p of sb.build.pieces.values()) if (p.mat === 'metal' || ELECTRIC[p.type]) list.push({ id: p.id, type: p.type, mat: p.mat, contacts: contactsOf(p) });
      power.rebuild(list);
      for (const p of sb.build.pieces.values()) if (ELECTRIC[p.type]) view.decorate(p);
      // roofs keep rain off the ground under them
      if (field) for (const p of sb.build.pieces.values()) if (p.type === 'floor' || p.type === 'wall' || p.type === 'ramp') { const k = field.idxAt(p.pos.x, p.pos.z); if (k >= 0) { const r = 1.0; for (let dz = -r; dz <= r; dz += 0.5) for (let dx = -r; dx <= r; dx += 0.5) { const kk = field.idxAt(p.pos.x + dx, p.pos.z + dz); if (kk >= 0 && p.pos.y > field.f.H[kk] + 1.2 && p.type === 'floor') field.f.cover[kk] = 1; } } }
    }
    power.tick((p) => {
      const q = sb.build.pieces.get(p.id); if (!q) return 0; const k = field.idxAt(q.pos.x, q.pos.z);
      if (p.type === 'solar') return 120 * wx.sun * (k >= 0 && field.f.cover[k] ? 0.1 : 1) * 0.18 * 1.2; // W/m2 * efficiency * area
      if (p.type === 'wheel') { if (k < 0) return 0; const d = field.f.W[k]; if (d < 0.03) return 0; const [vx, vz] = field.speedAt(k); const v = Math.hypot(vx, vz); return 0.5 * 1000 * (1.6 * Math.min(0.8, d)) * v * v * v * 0.3; }
      if (p.type === 'vane') { const v = Math.hypot(wx.wind[0], wx.wind[1]) * (1 + Math.max(0, q.pos.y - (k >= 0 ? field.f.H[k] : 0)) * 0.03); return 0.5 * 1.2 * Math.PI * v * v * v * 0.35; }
      return 0;
    }, TICK);
    for (const p of sb.build.pieces.values()) {
      const E = ELECTRIC[p.type]; if (!E) continue; const s = power.state(p.id);
      view.pieceState(p, s, power.netOf(p.id));
      if (p.type === 'heater' && s.level > 0.3) field.heat(p.pos.x, p.pos.z, 0.5, 150 + 500 * s.level, 0.15);
    }
  }
  // hands on a switch flip it; on a relay change what it does
  function usePiece(p) {
    if (!p || !ELECTRIC[p.type]) return false;
    if (p.type === 'switch') { const o = power.toggle(p.id); piecesChanged(); steps && steps.play('stone', 0.5); hud.toast(o ? 'Switch on' : 'Switch off', null, 1200); changed(); return true; }
    if (p.type === 'relay') { const m = power.cycleMode(p.id); hud.toast('Relay: ' + m.toUpperCase() + ' (power from below, out the front, control from the back and sides)', null, 2600); changed(); return true; }
    return false;
  }
  function pieceHint(p) {
    const E = p && ELECTRIC[p.type]; if (!E) return null; const s = power.state(p.id), n = power.netOf(p.id);
    if (p.type === 'switch') return `switch ${s.on ? 'on' : 'off'} · click to flip`;
    if (p.type === 'relay') return `relay ${s.mode.toUpperCase()} · ${s.out ? 'passing power' : 'open'} · click to change`;
    if (E.source) return `${p.type}: ${Math.round(s.watts)} W`;
    if (E.store) return `battery ${Math.round((s.charge / E.store) * 100)}% · ${s.watts > 0 ? 'giving ' + Math.round(s.watts) + ' W' : s.watts < 0 ? 'charging ' + Math.round(-s.watts) + ' W' : 'idle'}`;
    if (E.consumer) return `${p.type}: ${Math.round(s.level * 100)}% of ${E.consumer} W${n ? ` · network ${Math.round(n.supply)} W in` : ' · not connected'}`;
    return null;
  }

  // ---------- feet: the ground decides grip, speed, sinking and the sound; steps leave prints
  let strideAcc = 0, foot = 0; const lastP = new THREE.Vector3(); let wasAir = false;
  function feet(dt) {
    const p = player.position;
    const air = player.airborne;
    if (!air) {
      const d = Math.hypot(p.x - lastP.x, p.z - lastP.z); strideAcc += d;
      const stride = 0.75;
      if (strideAcc > stride || (wasAir && !air)) {
        strideAcc = 0; foot ^= 1;
        const yaw = player.heading, sx = Math.cos(yaw) * 0.14 * (foot ? 1 : -1), sz = -Math.sin(yaw) * 0.14 * (foot ? 1 : -1);
        const k = wasAir ? 1.6 : Math.min(1.4, 0.6 + player.speed * 0.12);
        field.stamp(p.x + sx, p.z + sz, k, 0.2);
        view.footprint(p.x + sx, p.z + sz, yaw, foot, field.surface(p.x + sx, p.z + sz), k);
        const s = field.surface(p.x, p.z); if (s && s.water > 0.02 && audio && audio.splash) view.splash(p.x, p.y, p.z, Math.min(1, s.water * 10));
      }
    }
    wasAir = air; lastP.copy(p);
    void dt;
  }
  function feel(x, z) { if (!field) return null; const s = field.surface(x, z); if (!s) return null; return { friction: s.friction, speed: s.speed, sink: s.sink, accel: s.ice > 0.004 ? 0.25 : 1 }; }
  function surface(x, z) { if (!field) return null; const s = field.surface(x, z); return s ? s.step : null; }

  // ---------- creatures: run from fire and heat, go to water to drink
  function danger(x, z) {
    if (!field || !field.events.burning) return null;
    const f = field.f; let sx = 0, sz = 0, n = 0;
    for (let dz = -9; dz <= 9; dz += 1.5) for (let dx = -9; dx <= 9; dx += 1.5) { const k = field.idxAt(x + dx, z + dz); if (k >= 0 && (f.Fi[k] > 0.1 || f.T[k] > 120)) { sx -= dx; sz -= dz; n++; } }
    if (!n) return null; const l = Math.hypot(sx, sz) || 1; return { dx: sx / l, dz: sz / l };
  }
  function waterNear(x, z) {
    if (!field) return null; const f = field.f;
    for (let r = 2; r <= 14; r += 3) for (let a = 0; a < 6.28; a += 0.6) { const px = x + Math.sin(a) * r, pz = z + Math.cos(a) * r, k = field.idxAt(px, pz); if (k >= 0 && f.W[k] > 0.03 && !f.sea[k]) return { x: px, z: pz }; }
    return null;
  }

  // ---------- tools: a fire drill and a water skin
  const T7 = () => sb.T7 || {};
  let skin = 0; const SKIN = 0.012; // m3 (12 litres)
  let drillT = 0, drilling = false;
  const _o = new THREE.Vector3(), _d = new THREE.Vector3();
  function groundHit(ray, maxD = 4.2) {
    _o.copy(ray.origin); _d.copy(ray.dir); let prev = 0;
    for (let t = Math.max(0.2, ray.start); t < ray.start + maxD; t += 0.08) {
      const x = _o.x + _d.x * t, y = _o.y + _d.y * t, z = _o.z + _d.z * t;
      const k = field ? field.idxAt(x, z) : -1; const wTop = k >= 0 ? field.f.H[k] + field.f.I[k] + field.f.W[k] : -1e9;
      if (sb.env.solid(x, y, z) || y < wTop) return { x, y, z, t, k, water: y < wTop && field.f.W[k] > 0.01 };
      prev = t;
    }
    void prev; return null;
  }
  function pickProp(ray) { const h = sb.physics.pick(ray.origin, ray.dir, ray.start + 3.5); return h ? h.body : null; }
  equip.register({ id: 'drill', order: 16, glyph: '🔥', label: 'fire', sim: true, available: () => on && !!(T7().tools && T7().tools.drill),
    primary(down) { drilling = down; drillT = 0; return true; },
    update(dt, ray) {
      if (!drilling || !field) return; drillT += dt; const b = pickProp(ray), g = b ? null : groundHit(ray);
      const at = b ? b.pos : g; if (!at) return;
      if (drillT % 0.25 < dt) view.smokePuff(at.x, (b ? b.pos.y : g.y) + 0.05, at.z, 0.4); // telegraph: smoke first
      if (drillT > 1.6) {
        drilling = false;
        if (b) { const s = propT.get(b) || { T: 20, burn: 0, smelt: 0, sunk: 0 }; propT.set(b, s); if (b.data.mat === 'wood') { s.T = 420; hud.toast(field.env.burn ? 'It caught' : `It chars but won't flame: ${R.pO2.toFixed(1)} kPa of oxygen is too little`, null, 1800); } else hud.toast('Only sparks: stone and metal don\'t burn', null, 1800); return; }
        const caught = field.ignite(g.x, g.z, 0.3, 520);
        const s = field.surface(g.x, g.z);
        if (!caught) hud.toast(!field.env.burn ? `No flame here: only ${R.pO2.toFixed(1)} kPa of oxygen in this air` : s && (s.wet > 0.5 || s.water > 0.003) ? 'Too damp to catch' : 'Nothing here to burn', null, 2200);
      }
    } });
  equip.register({ id: 'skin', order: 17, glyph: '💧', label: () => 'water ' + Math.round((skin / SKIN) * 100) + '%', sim: true, available: () => on && !!(T7().tools && T7().tools.skin),
    primary(down, ray) {
      if (!down || !field) return true; const g = groundHit(ray); if (!g) return true;
      if (g.water || (g.k >= 0 && field.f.sea[g.k])) { const got = field.takeWater(g.x, g.z, 0.6); skin = Math.min(SKIN, skin + Math.max(got, 0.004)); steps && steps.pour && steps.pour(0.3); hud.toast('Water skin ' + Math.round((skin / SKIN) * 100) + '%', null, 1000); return true; }
      if (skin <= 0) { hud.toast('The skin is empty: fill it at water', null, 1500); return true; }
      const v = Math.min(skin, 0.004); skin -= v; field.addWater(g.x, g.z, v, 0.45); view.splash(g.x, g.y, g.z, 1); steps && steps.pour && steps.pour(0.5);
      return true;
    } });

  // ---------- save
  let dirtyT = -1; function changed() { if (dirtyT < 0) dirtyT = 4; }
  function save() { if (!field || !rec) return; rec.sim.ground = field.save(); rec.sim.power = power.save(); }

  // ---------- burnt flora goes from the planet's instanced plants (and comes back as the grass does)
  let floraT = 0;
  function floraSync(dt) {
    floraT -= dt; if (floraT > 0 || !hf.floraDirty) return; floraT = 4;
    for (let t = 0; t < field.NT * field.NT; t++) { if (!field.awake[t]) continue; const tx = t % field.NT, tz = (t / field.NT) | 0; const k0 = (tz * TC) * field.N + tx * TC; let hot = false; for (let j = 0; j < TC && !hot; j += 4) for (let i = 0; i < TC; i += 4) if (field.f.Fi[k0 + j * field.N + i] > 0.1) { hot = true; break; } if (hot) hf.floraDirty(field.cellX(k0) + 8, field.cellZ(k0) + 8); }
  }
  function burnt(x, z) { if (!field) return false; const k = field.idxAt(x, z); return k >= 0 && field.f.Sc[k] > 0.45 && field.f.V[k] < 0.3; }
  // ---------- frame
  const stats = { ms: 0, ticks: 0, avg: 0 };
  function update(dt) {
    if (!on || !field) return;
    const t0 = performance.now();
    const p = player.position;
    field.recentre(p.x, p.z, 2);
    weather(dt);
    acc += Math.min(dt, 0.25); let n = 0;
    while (acc >= TICK && n < 3) {
      acc -= TICK; n++;
      field.step(); props(); trees(); powerTick();
      if (performance.now() - t0 > budgetMs) { acc = Math.min(acc, TICK); break; }
    }
    feet(dt);
    floraSync(dt);
    view.update(dt, { ticked: n > 0, wind: wx.wind, rain: wx.rain, cloud: wx.cloud, night: wx.night, camera, burningTrees: burning, propT });
    if (field.events.hiss > 0 && audio && audio.splash && Math.random() < 0.2) audio.splash();
    if (dirtyT >= 0) { dirtyT -= dt; if (dirtyT < 0) save(); }
    if (n && field.events.burning) changed();
    const ms = performance.now() - t0; stats.ms = ms; stats.avg = stats.avg * 0.95 + ms * 0.05; stats.ticks += n;
  }

  return {
    get field() { return field; }, get rules() { return R; }, power, view, burnt, weather: wx, load, clear, update, feel, surface, danger, waterNear, usePiece, pieceHint, piecesChanged, save, stats,
    groundChanged(x, z, r) { if (field) { field.groundChanged(x, z, r, (px, pz) => { const g = hf.ground(px, pz); const h = sb.terrainEnv.top(px, pz, g + 3); const m = sb.vox && sb.vox.isActive(px, pz) ? sb.vox.materialAt(px, h - 0.2, pz) : 0; return { h, mat: m }; }); field.wake(field.idxAt(x, z)); changed(); } },
    debug: {
      ignite: (x, z, r = 0.5) => field.ignite(x, z, r, 650),
      water: (x, z, litres = 50, r = 0.6) => field.addWater(x, z, litres / 1000, r),
      setWeather: (o) => Object.assign(wx.override, o),
      run(sec = 1) { const n = Math.round(sec / TICK); const t0 = performance.now(); for (let i = 0; i < n; i++) { weather(TICK); field.step(); props(); trees(); powerTick(); } return { ms: +((performance.now() - t0) / n).toFixed(3), active: field.stats.active, burning: field.events.burning }; },
      at(x, z) { const k = field.idxAt(x, z); if (k < 0) return null; const f = field.f; const o = {}; for (const key of ['H', 'T', 'M', 'W', 'I', 'S', 'C', 'V', 'Fu', 'Ch', 'Fi', 'O', 'Sc', 'Ash', 'Pr', 'Bk', 'Sed']) o[key] = +f[key][k].toFixed(3); o.mat = f.mat[k]; o.sea = f.sea[k]; return o; },
      stats: () => ({ ...stats, ...field.stats, burning: field.events.burning, trees: burning.size, nets: power.nets.length, saveBytes: JSON.stringify(field.save()).length }),
      give: () => { const t = T7(); t.tools = t.tools || {}; t.tools.drill = 1; t.tools.skin = 1; skin = SKIN; },
      tick: () => field.step(),
      // try other laws on this world (testing): sim.debug.laws({ atmosphere: { pressureKPa: 30, composition: { O2: 0.05 } } })
      laws(raw) { R = worldRules({ worldRules: raw }, W); applyLaws(); return R.summary; },
      trunks: (x, z, r = 4) => (hf.trunksNear ? hf.trunksNear(x, z, r).length : -1),
    },
  };
}
