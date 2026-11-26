// The living ground: a 2.5-D field of 0.5 m cells that follows the player, where heat, fire,
// oxygen, water, ice, snow, soil moisture, mud, compaction, footprints, nutrients and plants all
// run on one small set of local rules (see mom-garden-notes/simulation.md).
// Pure: no three.js, no DOM, no Math.random. Typed arrays, fixed 10 Hz tick, deterministic from
// (inputs, tick), so the same module can run in a Worker or on the multiplayer server.
//   const f = createField({ tiles: 5, initTile(gx0, gz0, base) {...} })
//   f.recentre(x, z)   f.step()   f.env.rain = ...   f.ignite(x, z, r)   f.stamp(x, z, k)
import { GROUND, MUD, G, L_VAP, L_FUS, C_WATER } from './matter.js';

export const TC = 32;          // cells per tile side (a tile = 16 m, same as a voxel column)
export const TICK = 0.1;       // seconds per tick
export const NATURE = 30;      // slow rules (plants, soil drying) run this much faster than real time
const SUB = 3;                 // water sub-steps per tick
const SIGMA = 5.67e-8;
// per-cell fields (Float32) that travel with a tile when the window moves
const FIELDS = ['H', 'T', 'M', 'W', 'I', 'S', 'C', 'Nu', 'V', 'Fu', 'Ch', 'Fi', 'O', 'Sc', 'Ash', 'Pr', 'Bk', 'Sed', 'E', 'Hv', 'Ta', 'Mb', 'Vc', 'fL', 'fR', 'fU', 'fD'];
const BYTES = ['mat', 'sea', 'cover'];
const SOFTISH = new Set([1, 2, 7, 8]);
const hash = (a, b, c) => { let h = (a * 374761393 + b * 668265263 + c * 1442695041) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function createField({ tiles = 5, cell = 0.5, initTile, seaLevel = -1e4 }) {
  const NT = tiles, N = NT * TC, NN = N * N, A = cell * cell;
  const f = {}; for (const k of FIELDS) f[k] = new Float32Array(NN); for (const k of BYTES) f[k] = new Uint8Array(NN);
  const { H, T, M, W, I, S, C, Nu, V, Fu, Ch, Fi, O, Sc, Ash, Pr, Bk, Sed, E, Hv, Ta, Mb, Vc, fL, fR, fU, fD, mat, sea, cover } = f;
  const tmp = new Float32Array(NN), sf = new Float32Array(NN);
  const awake = new Uint8Array(NT * NT);
  const fireT = new Uint8Array(NT * NT);
  const wetT = new Uint8Array(NT * NT);     // has surface water    // a fire burned in or next to this tile recently     // ticks left before a quiet tile sleeps
  const touched = new Uint8Array(NT * NT);   // differs from its generated state (saved / stashed)
  const ready = new Uint8Array(NT * NT);     // initialised
  const store = new Map();                   // tiles that left the window: "tgx,tgz" -> snapshot
  // laws (set from the world's rules, sim/rules.js; Earth until told otherwise): gravity, water's boiling point at this
  // pressure and whether it can be liquid at all, oxygen relative to Earth, air density (convection), evaporation, life
  const env = { tick: 0, air: 0, wind: [0, 0], rain: 0, sun: 0.8, sea: seaLevel, time: 0,
    g: G, boil: 100, liquid: true, o2: 1, burn: true, conv: 1, evap: 1, life: 1, lifeMin: 0, lifeMax: 45, micro: 1 };
  const events = { steam: [], ignite: 0, burning: 0, hiss: 0, sizzle: [] };
  let ox = 0, oz = 0, placed = false;        // window origin in global cells (multiple of TC)
  const stats = { ms: 0, active: 0, cells: 0, ticks: 0 };

  // ---------- tiles
  const tkey = (tx, tz) => ((ox / TC) + tx) + ',' + ((oz / TC) + tz);
  function stash(tx, tz) {
    const t = tz * NT + tx; if (!ready[t]) return;
    if (!touched[t]) { store.delete(tkey(tx, tz)); return; }
    const snap = {};
    for (const k of [...FIELDS, ...BYTES]) { const src = f[k], dst = new src.constructor(TC * TC); for (let j = 0; j < TC; j++) dst.set(src.subarray((tz * TC + j) * N + tx * TC, (tz * TC + j) * N + tx * TC + TC), j * TC); snap[k] = dst; }
    store.set(tkey(tx, tz), snap);
    if (store.size > 160) store.delete(store.keys().next().value);
  }
  const base = {}; for (const k of [...FIELDS, ...BYTES]) base[k] = new (BYTES.includes(k) ? Uint8Array : Float32Array)(TC * TC);
  function fillTile(tx, tz) {
    const t = tz * NT + tx, key = tkey(tx, tz), snap = store.get(key);
    let src = snap;
    if (!snap) {
      for (const k in base) base[k].fill(0);
      base.O.fill(1);
      initTile(ox + tx * TC, oz + tz * TC, base, TC, cell);
      for (let i = 0; i < TC * TC; i++) { base.T[i] = base.Ta[i] + env.air + (base.cover[i] ? 0 : env.sun * 14); base.Mb[i] = base.Mb[i] || base.M[i]; base.Vc[i] = base.Vc[i] || base.V[i]; }
      src = base;
    }
    for (const k of [...FIELDS, ...BYTES]) { const dst = f[k], s = src[k]; for (let j = 0; j < TC; j++) dst.set(s.subarray(j * TC, j * TC + TC), (tz * TC + j) * N + tx * TC); }
    ready[t] = 1; touched[t] = snap ? 1 : 0; awake[t] = 20; wetT[t] = 1;
  }
  // centre the window on a world point; moves by whole tiles, keeping everything that overlaps
  function recentre(x, z, maxNew = 99) {
    const cx = Math.floor(x / cell / TC) - (NT >> 1), cz = Math.floor(z / cell / TC) - (NT >> 1);
    const nox = cx * TC, noz = cz * TC;
    if (!placed || Math.abs(nox - ox) >= N || Math.abs(noz - oz) >= N) {
      if (placed) for (let tz = 0; tz < NT; tz++) for (let tx = 0; tx < NT; tx++) stash(tx, tz);
      ox = nox; oz = noz; placed = true; ready.fill(0);
    } else if (nox !== ox || noz !== oz) {
      const dx = (nox - ox) / TC, dz = (noz - oz) / TC;
      for (let tz = 0; tz < NT; tz++) for (let tx = 0; tx < NT; tx++) { const ntx = tx - dx, ntz = tz - dz; if (ntx < 0 || ntz < 0 || ntx >= NT || ntz >= NT) stash(tx, tz); }
      const sx = dx * TC, sz = dz * TC;
      for (const k of [...FIELDS, ...BYTES]) shiftArr(f[k], sx, sz);
      shiftTiles(ready, dx, dz); shiftTiles(touched, dx, dz); shiftTiles(awake, dx, dz); shiftTiles(fireT, dx, dz); shiftTiles(wetT, dx, dz);
      ox = nox; oz = noz;
    }
    let n = 0;
    // fill the missing tiles nearest the centre first (a few per frame when walking)
    const order = []; for (let tz = 0; tz < NT; tz++) for (let tx = 0; tx < NT; tx++) if (!ready[tz * NT + tx]) order.push([tx, tz, Math.abs(tx - (NT >> 1)) + Math.abs(tz - (NT >> 1))]);
    order.sort((a, b) => a[2] - b[2]);
    for (const [tx, tz] of order) { if (n >= maxNew) break; fillTile(tx, tz); n++; }
    return order.length - n;
  }
  function shiftArr(a, sx, sz) {
    // content moves by (-sx, -sz) cells
    const rows = new a.constructor(NN);
    for (let j = 0; j < N; j++) { const sj = j + sz; if (sj < 0 || sj >= N) continue; for (let i = 0; i < N; i++) { const si = i + sx; if (si >= 0 && si < N) rows[j * N + i] = a[sj * N + si]; } }
    a.set(rows);
  }
  function shiftTiles(a, dx, dz) { const b = new Uint8Array(NT * NT); for (let tz = 0; tz < NT; tz++) for (let tx = 0; tx < NT; tx++) { const s = tx + dx, t = tz + dz; if (s >= 0 && t >= 0 && s < NT && t < NT) b[tz * NT + tx] = a[t * NT + s]; } a.set(b); }

  // ---------- helpers
  const idxAt = (x, z) => { const i = Math.floor(x / cell) - ox, j = Math.floor(z / cell) - oz; return i < 0 || j < 0 || i >= N || j >= N ? -1 : j * N + i; };
  const tileOf = (k) => (((k / N) | 0) / TC | 0) * NT + ((k % N) / TC | 0);
  const wake = (k, n = 30) => { const t = tileOf(k); if (n >= 30) fireT[t] = Math.max(fireT[t], 20); if (awake[t] < n) awake[t] = n; touched[t] = 1; };
  const airAt = (k) => Ta[k] + env.air;
  function activeList() {
    const out = [];
    for (let tz = 0; tz < NT; tz++) for (let tx = 0; tx < NT; tx++) {
      const t = tz * NT + tx; if (!ready[t]) continue;
      let on = awake[t] > 0 || env.rain > 0;
      if (!on) for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const u = tx + a, v = tz + b; if (u >= 0 && v >= 0 && u < NT && v < NT && awake[v * NT + u] > 1) { on = true; break; } }
      if (on) out.push(t);
    }
    return out;
  }

  // ---------- water: virtual pipes (O'Brien & Hodgins; Mei et al. 2007)
  function water(dt, list) {
    const kf = dt * cell * env.g;
    for (const t of list) {
      const tx = t % NT, tz = (t / NT) | 0;
      for (let j = tz * TC; j < tz * TC + TC; j++) for (let i = tx * TC; i < tx * TC + TC; i++) {
        const k = j * N + i, w = W[k];
        if (w <= 1e-6) { fL[k] = fR[k] = fU[k] = fD[k] = 0; sf[k] = 0; continue; }
        const h = H[k] + I[k] + w;
        let l = 0, r = 0, u = 0, d = 0;
        // bed friction: a thin sheet drags on the ground far more than a deep channel does (Manning-like)
        const fr = 1 / (1 + (0.05 * dt) / (w + 0.01)); const damp = 0.985 * fr;
        if (i > 0) l = Math.max(0, fL[k] * damp + kf * (h - H[k - 1] - I[k - 1] - W[k - 1]));
        if (i < N - 1) r = Math.max(0, fR[k] * damp + kf * (h - H[k + 1] - I[k + 1] - W[k + 1]));
        if (j > 0) u = Math.max(0, fU[k] * damp + kf * (h - H[k - N] - I[k - N] - W[k - N]));
        if (j < N - 1) d = Math.max(0, fD[k] * damp + kf * (h - H[k + N] - I[k + N] - W[k + N]));
        const s = (l + r + u + d) * dt;
        if (s > w * A) { const q = (w * A) / s; l *= q; r *= q; u *= q; d *= q; }
        fL[k] = l; fR[k] = r; fU[k] = u; fD[k] = d;
        const o = l + r + u + d; sf[k] = o > 0 ? Math.min(1, (o * dt) / (w * A)) / o : 0; // share of the load leaving, per unit flux
      }
    }
    for (const t of list) {
      const tx = t % NT, tz = (t / NT) | 0; let moved = 0, any = 0;
      for (let j = tz * TC; j < tz * TC + TC; j++) for (let i = tx * TC; i < tx * TC + TC; i++) {
        const k = j * N + i;
        if (W[k] > 0) any = 1;
        const inn = (i > 0 ? fR[k - 1] : 0) + (i < N - 1 ? fL[k + 1] : 0) + (j > 0 ? fD[k - N] : 0) + (j < N - 1 ? fU[k + N] : 0);
        const out = fL[k] + fR[k] + fU[k] + fD[k];
        if (inn === 0 && out === 0) continue;
        const dw = (dt * (inn - out)) / A; W[k] = Math.max(0, W[k] + dw);
        // sediment rides with the water (upwind share of the neighbour's load)
        if (Sed[k] > 1e-7 || inn > 0) {
          // flux-weighted and exactly conservative: what leaves one cell arrives in the next
          let sin = 0;
          if (i > 0) sin += Sed[k - 1] * fR[k - 1] * sf[k - 1];
          if (i < N - 1) sin += Sed[k + 1] * fL[k + 1] * sf[k + 1];
          if (j > 0) sin += Sed[k - N] * fD[k - N] * sf[k - N];
          if (j < N - 1) sin += Sed[k + N] * fU[k + N] * sf[k + N];
          tmp[k] = sin - Sed[k] * out * sf[k];
        }
        if (Math.abs(dw) > 2e-5) moved++;
      }
      if (moved) { awake[t] = Math.max(awake[t], 25); if (env.rain < 1e-7) touched[t] = 1; } // rain is weather, not a change worth saving
      wetT[t] = any;
    }
    for (const t of list) {
      const tx = t % NT, tz = (t / NT) | 0;
      for (let j = tz * TC; j < tz * TC + TC; j++) for (let i = tx * TC; i < tx * TC + TC; i++) {
        const k = j * N + i; if (tmp[k] !== 0) { Sed[k] = Math.max(0, Sed[k] + tmp[k]); tmp[k] = 0; }
        if (sea[k]) { W[k] = Math.max(0, env.sea - H[k] - I[k]); Sed[k] = 0; }
      }
    }
  }
  // flow speed (m/s) through a cell, from the pipe fluxes
  function speedAt(k) {
    const i = k % N, j = (k / N) | 0, d = Math.max(0.01, W[k]);
    const vx = ((i > 0 ? fR[k - 1] : 0) - fL[k] + fR[k] - (i < N - 1 ? fL[k + 1] : 0)) / (2 * cell * d);
    const vz = ((j > 0 ? fD[k - N] : 0) - fU[k] + fD[k] - (j < N - 1 ? fU[k + N] : 0)) / (2 * cell * d);
    return [vx, vz];
  }

  // ---------- per-tick local rules: soaking, evaporation, freezing, erosion, heat, fire, oxygen
  const N8 = [[-1, 0, 1], [1, 0, 1], [0, -1, 1], [0, 1, 1], [-1, -1, 0.7], [1, -1, 0.7], [-1, 1, 0.7], [1, 1, 0.7]].map(([a, b, w]) => [a, b, w, a / Math.hypot(a, b), b / Math.hypot(a, b)]);
  function local(dt, list) {
    const [wx, wz] = env.wind, wm = Math.hypot(wx, wz), rain = env.rain, sun = env.sun;
    events.burning = 0;
    for (const t of list) {
      const tx = t % NT, tz = (t / NT) | 0; let hot = 0, busy = 0, burnT = 0;
      let fireNear = 0; for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) { const u = tx + a, v = tz + b; if (u >= 0 && v >= 0 && u < NT && v < NT && fireT[v * NT + u]) fireNear = 1; }
      for (let j = tz * TC; j < tz * TC + TC; j++) for (let i = tx * TC; i < tx * TC + TC; i++) {
        const k = j * N + i, m = mat[k], Gm = GROUND[m] || GROUND[1], ta = airAt(k), wPrev = W[k];
        // -- rain and snowfall (not under a roof)
        if (rain > 0 && !cover[k]) { if (ta < 0.5) S[k] += rain * dt * 6; else W[k] += rain * dt; }
        // -- soaking into the ground (sand fast, packed earth slow, stone/ice never; frozen ground never)
        if (W[k] > 0 && Gm.ksat > 0 && T[k] > 0 && !sea[k]) {
          const cap = Gm.por * 0.1, room = (1 - M[k]) * cap;
          const inf = Math.min(W[k], room, Gm.ksat * 0.0015 * dt * (1 - 0.85 * C[k]) * (1 - 0.5 * Bk[k]));
          if (inf > 0) { W[k] -= inf; M[k] += inf / cap; }
        }
        // -- evaporation (time-compressed): warmer, windier, sunnier = faster
        if (W[k] > 0 && !sea[k]) { const e = dt * (1.5e-5 + 1.2e-6 * Math.max(0, T[k]) + 6e-6 * wm + 2e-5 * sun * (1 - cover[k])) * env.evap; W[k] = Math.max(0, W[k] - e); }
        // -- freezing and thawing (water <-> ice), snow melt
        if (T[k] < 0 && W[k] > 0 && !sea[k]) { const fr = Math.min(W[k], 4e-5 * dt * -T[k]); W[k] -= fr; I[k] += fr * 1.09; }
        else if (T[k] > 0 && I[k] > 0) { const mt = Math.min(I[k], 3e-5 * dt * T[k] + (Fi[k] > 0 ? 0.004 * dt : 0)); I[k] -= mt; if (env.liquid) W[k] += mt / 1.09; } // no liquid phase: ice sublimates
        if (T[k] > 0 && S[k] > 0) { const mt = Math.min(S[k], 6e-5 * dt * T[k] + (Fi[k] > 0 ? 0.02 * dt : 0)); S[k] -= mt; if (env.liquid) W[k] += mt * 0.3; busy++; }
        // -- erosion lite: fast water picks up soft ground and drops it where it slows
        if (W[k] > 0.004 && !sea[k]) {
          const [vx, vz] = speedAt(k), v = Math.hypot(vx, vz), cap = 0.02 * v * W[k];
          if (Sed[k] < cap && Gm.erode > 0 && E[k] > -0.6) { const d = Math.min(cap - Sed[k], 0.0006 * Gm.erode * dt * (1 - 0.7 * C[k])); H[k] -= d; E[k] -= d; Sed[k] += d; }
          else if (Sed[k] > cap && E[k] < 0.6) { const d = (Sed[k] - cap) * Math.min(1, 1.5 * dt); H[k] += d; E[k] += d; Sed[k] -= d; }
        }
        // -- heat. Quiet tiles: temperature just eases toward air + sun warmth (cheap path)
        const fuel = Fu[k] + V[k] * 0.5;
        if (!fireNear && W[k] <= 0.003 && S[k] <= 0 && I[k] <= 0 && T[k] < 150) {
          const teq = ta + (cover[k] ? 0 : sun * 14) - (rain > 0 ? 3 : 0);
          T[k] += (teq - T[k]) * 0.01;
          if (Math.abs(T[k] - teq) > 1.5) hot++;
          continue;
        }
        let q = 0; const qO = Math.min(1.8, Math.max(0.5, 0.55 + 0.45 * env.o2)); // hotter flames in richer air reach further
        if (fireNear) for (let n = 0; n < 8; n++) {
          const a = i + N8[n][0], b = j + N8[n][1]; if (a < 0 || b < 0 || a >= N || b >= N) continue;
          const kk = b * N + a; if (Fi[kk] <= 0) continue;
          const cos = -(N8[n][3] * wx + N8[n][4] * wz) / (wm || 1);
          q += Fi[kk] * N8[n][2] * 150000 * qO * Math.max(0.08, 1 + 0.4 * wm * cos);
        }
        // flames lean downwind: a second ring two cells upwind of here also reaches
        if (fireNear && wm > 1.5) { const a = i - Math.round(wx / wm * 2), b = j - Math.round(wz / wm * 2); if (a >= 0 && b >= 0 && a < N && b < N) q += Fi[b * N + a] * 30000 * Math.min(3, wm / 3); }
        const cs = Gm.rho * Gm.c * 0.0012 + fuel * 1800 + I[k] * 917 * 2100 + S[k] * 300 * 2100;
        const t0 = T[k];
        if (W[k] > 0.003) {
          // standing water: pinned at its boiling point (set by the air pressure); heat boils it off (steam)
          const BP = env.boil, boil = Math.max(0, (q * dt + Math.max(0, t0 - BP) * cs) / (L_VAP * 1000));
          if (boil > 0 && (q > 0 || t0 > BP)) { W[k] = Math.max(0, W[k] - boil); if (events.steam.length < 64 && (env.tick + k) % 3 === 0) events.steam.push(k); events.hiss += boil * 1e3; }
          if (Fi[k] > 0) { Fi[k] = 0; events.hiss += 1; if (events.sizzle.length < 32) events.sizzle.push(k); }
          T[k] = Math.min(BP, t0 + (q * dt - 40 * env.conv * (t0 - ta) * dt) / (cs + W[k] * 1000 * C_WATER * 0.05));
        } else {
          let dT = q * dt / cs;
          if (rain > 0 && !cover[k] && t0 > ta) dT -= Math.min(t0 - ta, (rain * 1000 * (t0 > env.boil ? L_VAP : C_WATER * (t0 - ta)) * dt * 0.25) / cs);
          dT += sun * 230 * (1 - cover[k]) * (1 - Math.min(1, S[k] * 8)) * dt / cs;
          dT -= ((12 + 7 * wm) * env.conv * (t0 - ta) + 0.9 * SIGMA * (t0 > 60 ? ((t0 + 273) * (t0 + 273)) ** 2 - ((ta + 273) * (ta + 273)) ** 2 : 0)) * dt / cs;
          let tn = t0 + dT;
          // wet fuel and soil: the heat goes into drying before anything gets hotter than boiling
          const BP = env.boil;
          if (tn > Math.max(BP, t0) && M[k] > 0.02) { const excess = (tn - Math.max(BP, t0)) * cs; const dry = excess / (L_VAP * Gm.por * 0.1 * 1000 * 0.04); const dm = Math.min(M[k], dry); M[k] -= dm; tn = Math.max(t0, BP) + (dm < dry ? (excess * (1 - dm / dry)) / cs : 0); if (dm > 0.001 && events.steam.length < 64 && (env.tick + k) % 7 === 0) events.steam.push(k); }
          // melting snow and ice costs heat too
          if (tn > 0 && (S[k] > 0 || I[k] > 0)) { const melt = Math.min(S[k] * 0.3 + I[k], (tn * cs) / (L_FUS * 1000)); const fromS = Math.min(S[k], melt / 0.3); S[k] -= fromS; const fromI = Math.min(I[k], melt - fromS * 0.3); I[k] -= fromI; if (env.liquid) W[k] += fromS * 0.3 + fromI; tn -= ((fromS * 0.3 + fromI) * L_FUS * 1000) / cs; }
          T[k] = tn;
        }
        // -- combustion: hot enough + fuel + dry + oxygen
        const wet = M[k] * 0.8 + W[k] * 60 + S[k] * 40; // litter on top dries ahead of the soil under it
        const fuelT = fuel + Ch[k];
        // oxygen here = what's left locally x the atmosphere's share (relative to Earth); under ~13 kPa O2 nothing flames
        const oxL = O[k] * env.o2;
        if (Fi[k] > 0 && (!env.burn || oxL < 0.25)) { Fi[k] = 0; }
        else if (Fi[k] > 0 || (env.burn && T[k] > 255 && fuelT > 0.02 && wet < 0.45 && oxL > 0.3 && (cover[k] || rain < 1.2e-4))) {
          if (Fi[k] <= 0) { Fi[k] = 0.25; events.ignite++; }
          const ox2 = Math.min(2.5, oxL) * (0.7 + 0.12 * wm);
          const rf = Math.min(fuel, (0.012 + fuel * 0.05) * Fi[k] * ox2 * dt);           // grass, litter, wood
          const rc = Math.min(Ch[k], Ch[k] * 0.012 * ox2 * (1 + 0.35 * wm) * dt + (fuel < 0.02 && Ch[k] > 0 ? 0.0008 * dt * ox2 : 0)); // glowing charcoal
          const heat = (rf * 15e6 + rc * 30e6) / dt;                                     // W/m2
          if (fuel > 0) { const fromV = Math.min(V[k] * 0.5, rf * (V[k] * 0.5) / fuel); V[k] -= fromV / 0.5; Fu[k] = Math.max(0, Fu[k] - (rf - fromV)); }
          Ch[k] -= rc;
          Ch[k] += rf * 0.18 * (1 - O[k]) + rf * 0.02;                                     // starved of air: more charcoal
          Ash[k] = Math.min(1, Ash[k] + rf * 2 + rc * 3); Nu[k] = Math.min(1, Nu[k] + rf * 0.6);
          Sc[k] = Math.max(Sc[k], Math.min(1, Fi[k] * 1.3));
          // a quarter of the heat stays in the bed; the rest rises with the plume
          T[k] += (0.5 * heat * dt) / cs;
          const flameCap = (Ch[k] > fuel ? 1050 + 260 * Math.min(1, wm / 6) : 880) * Math.max(0.75, Math.min(1.5, 0.7 + 0.3 * env.o2)); // richer air burns hotter
          if (T[k] > flameCap) T[k] = flameCap;
          O[k] = Math.max(0, O[k] - (rf + rc) * 9);
          const target = clamp01(heat / 260000);
          Fi[k] += (target - Fi[k]) * 0.45;
          if (rain > 0 && !cover[k]) Fi[k] -= rain * dt * 12000; // a downpour beats flames down (heavy rain ~0.26 per tick)
          if (fuelT < 0.004 || T[k] < 180 || wet > 0.9) Fi[k] *= 0.6;
          if (Fi[k] < 0.02) Fi[k] = 0;
          else events.burning++;
        }
        // -- oxygen comes back by diffusion and wind
        if (O[k] < 1) O[k] = Math.min(1, O[k] + (1 - O[k]) * (0.35 + 0.22 * wm) * dt);
        // -- baking: wet earth that gets very hot dries into hard clay
        if ((m === 1 || m === 7) && T[k] > 110 && (Bk[k] > 0 || M[k] > 0.55)) { Bk[k] = Math.min(1, Bk[k] + dt * (T[k] - 110) / 3000); if (Bk[k] >= 1) { mat[k] = 9; } }
        if (Fi[k] > 0) burnT = 1;
        if (Fi[k] > 0 || Math.abs(T[k] - t0) > 0.05 || (W[k] > 0 && !sea[k] && Math.abs(W[k] - wPrev) > 1e-6)) hot++;
      }
      if (hot || busy) awake[t] = Math.max(awake[t], hot ? 30 : 10);
      if (burnT) touched[t] = 1; // sun and night are not changes; a fire is
      if (burnT) fireT[t] = 40; else if (fireT[t] > 0) fireT[t]--;
    }
  }
  // ---------- slow rules: soil moisture, plants, decay, prints, compaction, frost heave (1 tile in 10 per tick)
  function slow(t) {
    const dt = TICK * 10 * NATURE, tx = t % NT, tz = (t / NT) | 0, rain = env.rain, sun = env.sun, wm = Math.hypot(env.wind[0], env.wind[1]);
    let change = 0;
    for (let j = tz * TC; j < tz * TC + TC; j++) for (let i = tx * TC; i < tx * TC + TC; i++) {
      const k = j * N + i, m = mat[k], Gm = GROUND[m] || GROUND[1], ta = airAt(k);
      if (sea[k]) continue;
      const v0 = V[k], m0 = M[k], c0 = C[k], p0 = Pr[k];
      // soil water: plants drink, the sun dries the top, deep water slowly evens it toward the climate
      if (Gm.por > 0.05) {
        M[k] -= dt * (2.5e-7 * Math.max(0, ta) * (1 - cover[k]) * (0.5 + sun) + 4e-7 * V[k]) * (M[k] > 0 ? 1 : 0);
        M[k] += (Mb[k] - M[k]) * dt * 4e-6;
        // water spreads sideways through the soil (and out from any standing water beside it)
        const wN = (kk) => (W[kk] > 0.01 ? 1 : M[kk]);
        const avg = ((i > 0 ? wN(k - 1) : M[k]) + (i < N - 1 ? wN(k + 1) : M[k]) + (j > 0 ? wN(k - N) : M[k]) + (j < N - 1 ? wN(k + N) : M[k])) * 0.25;
        if (avg > M[k]) M[k] += (avg - M[k]) * Math.min(0.5, dt * 6e-4 * Gm.ksat);
        M[k] = clamp01(M[k]);
      }
      // plants: logistic growth limited by water, warmth, light, nutrients, trampling and snow
      const cap = Vc[k] * Gm.grows * (1 - Math.min(1, C[k] * 1.25)) * (S[k] > 0.05 ? 0 : 1);
      if (Gm.grows > 0) {
        // the world's biology decides whether anything grows here at all, and in what warmth
        const lo = env.lifeMin + 4, hi = env.lifeMax - 9, mid = (lo + hi) / 2, half = Math.max(1, (hi - lo) / 2 + 2);
        const fM = clamp01((M[k] - 0.08) / 0.25) * (M[k] > 0.92 ? 0.3 : 1), fT = ta > lo && ta < hi ? 1 - Math.abs(ta - mid) / half : 0;
        const fL = 0.25 + 0.75 * sun * (cover[k] ? 0.2 : 1), fN = 0.4 + 0.6 * Nu[k];
        const g = 6e-4 * dt * fM * fT * fL * fN * env.life;
        if (V[k] > 0.01) V[k] += g * V[k] * (1 - V[k] / Math.max(0.01, cap)) * 4;
        // seeds from greener neighbours (bare ground fills in from its edges)
        else if (cap > 0.05 && g > 0) {
          const nb = (i > 0 ? V[k - 1] : 0) + (i < N - 1 ? V[k + 1] : 0) + (j > 0 ? V[k - N] : 0) + (j < N - 1 ? V[k + N] : 0);
          if (nb > 0.2 && hash(ox + i, oz + j, env.tick >> 4) < 0.35 * nb) V[k] = 0.03;
          else if (hash(ox + i, oz + j, env.tick >> 6) < (Sc[k] > 0.3 ? 0.05 : 0.004) * cap) V[k] = 0.02; // roots that survived a fire, the seed bank, wind-blown seed
        }
        if (V[k] > cap) V[k] -= (V[k] - cap) * Math.min(1, dt * 0.004);
        // drought: grass dries out and stands as fuel
        if (M[k] < 0.07 && V[k] > 0) { const d = Math.min(V[k], dt * 6e-4); V[k] -= d; Fu[k] += d * 0.4; }
        // frost kills the tops
        if (ta < -4 && V[k] > 0.1) { const d = dt * 2e-4 * V[k]; V[k] -= d; Fu[k] += d * 0.3; }
        if (V[k] < 0) V[k] = 0;
        Nu[k] = clamp01(Nu[k] - (V[k] - v0 > 0 ? (V[k] - v0) * 0.05 : 0));
      }
      // dead stuff rots into the soil (faster when damp and warm)
      if (Fu[k] > 0 && env.micro > 0) { const d = Fu[k] * dt * 4e-5 * (0.3 + M[k]) * (ta > 0 ? 1 : 0.1) * env.micro; Fu[k] -= d; Nu[k] = clamp01(Nu[k] + d * 0.5); }
      // ash and scorch fade: rain washes ash in, new growth hides the black
      if (Ash[k] > 0) Ash[k] = Math.max(0, Ash[k] - dt * (2e-5 + rain * 0.15 + wm * 2e-6));
      if (Sc[k] > 0) Sc[k] = Math.max(0, Math.min(Sc[k] - dt * 6e-6, 1.15 - V[k] * 1.6));
      // footprints fill in (rain, wind on sand, fresh snow), mud ones last until it dries
      if (Pr[k] > 0) { const soft = m === 2 ? 1 : 0.4; Pr[k] = Math.max(0, Pr[k] - dt * (1.2e-4 + rain * 1.5 + (ta < 0.5 && rain > 0 ? 3 : 0) + wm * 1.2e-5 * soft) * (M[k] > 0.6 ? 0.4 : 1)); }
      // ground slowly loosens again (roots, worms, frost)
      if (C[k] > 0) C[k] = Math.max(0, C[k] - dt * 3e-7 * (0.3 + V[k]));
      // frost heave: wet soil freezing lifts it a few cm; the thaw leaves it saturated (spring mud)
      if (SOFTISH.has(m) && m !== 8) {
        if (T[k] < -1 && M[k] > 0.45 && Hv[k] < 0.03) { const d = Math.min(0.03 - Hv[k], dt * 2e-6); Hv[k] += d; H[k] += d; }
        else if (T[k] > 1 && Hv[k] > 0) { const d = Math.min(Hv[k], dt * 4e-6); Hv[k] -= d; H[k] -= d; M[k] = Math.min(1, M[k] + d * 20); }
      }
      // baked clay crumbles back to soil over a long time when wet
      if (m === 9 && M[k] > 0.8 && Bk[k] > 0) Bk[k] = Math.max(0, Bk[k] - dt * 1e-6);
      if (c0 !== C[k] || p0 !== Pr[k] || Math.abs(V[k] - v0) > 0.003 || Math.abs(M[k] - m0) > 0.002) change++;
    }
    void change;
  }

  // ---------- the tick
  function step() {
    env.tick++; env.time += TICK; stats.ticks++;
    events.steam.length = 0; events.ignite = 0; events.hiss = 0; events.sizzle.length = 0;
    const list = activeList();
    stats.active = list.length; stats.cells = list.length * TC * TC;
    if (list.length) {
      const wl = list.filter((t) => { const tx = t % NT, tz = (t / NT) | 0; if (env.rain > 0 || wetT[t]) return true; for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const u = tx + a, v = tz + b; if (u >= 0 && v >= 0 && u < NT && v < NT && wetT[v * NT + u]) return true; } return false; });
      for (let s = 0; s < SUB; s++) water(TICK / SUB, wl);
      local(TICK, list);
    }
    // slow rules: every tile once a second (round-robin), awake or not
    for (let t = env.tick % 10; t < NT * NT; t += 10) if (ready[t]) slow(t);
    for (let t = 0; t < NT * NT; t++) if (awake[t] > 0 && env.rain <= 0) awake[t]--;
  }

  // ---------- things that happen to the ground (players, tools, props, weather)
  function forDisc(x, z, r, fn) {
    const i0 = Math.floor((x - r) / cell) - ox, i1 = Math.floor((x + r) / cell) - ox, j0 = Math.floor((z - r) / cell) - oz, j1 = Math.floor((z + r) / cell) - oz;
    for (let j = Math.max(0, j0); j <= Math.min(N - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(N - 1, i1); i++) {
      const cx = (ox + i + 0.5) * cell, cz = (oz + j + 0.5) * cell, d = Math.hypot(cx - x, cz - z); if (d > r + cell * 0.5) continue;
      const k = j * N + i; fn(k, 1 - Math.min(1, d / (r + cell * 0.5))); wake(k);
    }
  }
  // a flame or spark: heat it past ignition (only catches if there is dry fuel and air)
  function ignite(x, z, r = 0.4, temp = 600) { let any = false; forDisc(x, z, r, (k) => { T[k] = Math.max(T[k], temp); any = any || (Fu[k] + V[k] * 0.5 + Ch[k] > 0.02 && W[k] < 0.003); }); return any; }
  function heat(x, z, r, temp, k0 = 0.5) { forDisc(x, z, r, (k, w) => { T[k] += (temp - T[k]) * k0 * w; }); }
  function addWater(x, z, vol, r = 0.5) { let n = 0; forDisc(x, z, r, () => n++); if (!n) return; forDisc(x, z, r, (k) => { W[k] += vol / (n * A); wetT[tileOf(k)] = 1; }); }
  function takeWater(x, z, r = 0.6) { let got = 0; forDisc(x, z, r, (k) => { if (sea[k]) { got += 0.02; return; } const d = Math.min(W[k], 0.05); W[k] -= d; got += d * A; }); return got; }
  function addFuel(x, z, kg, r = 0.5, charcoal = 0) { let n = 0; forDisc(x, z, r, () => n++); if (!n) return; forDisc(x, z, r, (k) => { Fu[k] += kg / (n * A); Ch[k] += charcoal / (n * A); }); }
  // a footstep: soft ground compacts and keeps a print, plants get trampled
  function stamp(x, z, k0 = 1, r = 0.22) {
    forDisc(x, z, r, (k, w) => {
      const m = mat[k], Gm = GROUND[m] || GROUND[1];
      let soft = Gm.soft; if (S[k] > 0.02) soft = 1; if ((m === 1 || m === 7) && M[k] > 0.62) soft = 1;
      if (W[k] > 0.01) soft *= 0.5;
      Pr[k] = Math.min(1, Math.max(Pr[k], soft * 0.7 * k0 * (0.5 + 0.5 * w)) + soft * 0.05 * k0);
      C[k] = Math.min(1, C[k] + 0.012 * k0 * w * (0.4 + soft));
      if (V[k] > 0) V[k] = Math.max(0, V[k] - 0.004 * k0 * w);
      if (S[k] > 0) S[k] = Math.max(0, S[k] - 0.004 * k0 * w);
    });
  }
  // weight on soft ground: returns how far a load (Pa) sinks this step
  function bearing(x, z) {
    const k = idxAt(x, z); if (k < 0) return 1e9;
    const m = mat[k], Gm = GROUND[m] || GROUND[1];
    let b = Gm.bear * 1000; if ((m === 1 || m === 7 || m === 2) && M[k] > 0.62) b = MUD.bear * 1000 * (1 + C[k] * 2); if (S[k] > 0.05) b = Math.min(b, GROUND[8].bear * 1000 * (1 + C[k] * 4));
    return b;
  }
  // the ground was dug or raised: take the new surface height (and material) there
  function groundChanged(x, z, r, sample) {
    forDisc(x, z, r + cell, (k) => { const i = k % N, j = (k / N) | 0; const o = sample((ox + i + 0.5) * cell, (oz + j + 0.5) * cell); if (!o) return; H[k] = o.h; if (o.mat) mat[k] = o.mat; if (env.sea > -1e3 && o.h < env.sea) { sea[k] = 0; } });
  }
  // what the ground is like here, for feet and sound
  const _s = { mat: 1, step: 'grass', friction: 1, speed: 1, sink: 0, mud: 0, wet: 0, water: 0, snow: 0, T: 15, fire: 0, ice: 0 };
  function surface(x, z) {
    const k = idxAt(x, z); if (k < 0) return null;
    const m = mat[k], Gm = GROUND[m] || GROUND[1];
    const mud = (m === 1 || m === 7 || m === 2) ? clamp01((M[k] - 0.58) / 0.25) : 0;
    _s.mat = m; _s.T = T[k]; _s.fire = Fi[k]; _s.water = W[k]; _s.snow = S[k]; _s.ice = I[k]; _s.mud = mud; _s.wet = clamp01(M[k] * 1.2 + W[k] * 100);
    _s.friction = (Gm.friction / 0.85) * (1 - mud) + (MUD.friction / 0.85) * mud;
    _s.speed = 1 - (1 - MUD.speed) * mud;
    _s.sink = MUD.sink * mud * (1 - C[k] * 0.6);
    _s.step = Gm.step;
    if (m === 1 && V[k] < 0.2) _s.step = 'gravel';
    if (mud > 0.4) _s.step = 'mud';
    if (S[k] > 0.03) { _s.step = 'snow'; _s.speed = Math.min(_s.speed, 1 - Math.min(0.35, S[k] * 1.5)); _s.sink = Math.max(_s.sink, Math.min(0.2, S[k] * 0.6) * (1 - C[k])); }
    if (I[k] > 0.004) { _s.step = 'snow'; _s.friction = 0.08; }
    if (W[k] > 0.03) { _s.step = 'water'; _s.speed = Math.min(_s.speed, 1 - Math.min(0.5, W[k] * 0.9)); }
    if (m === 2 && M[k] < 0.15) { _s.speed *= 0.93; }
    return _s;
  }

  // ---------- save: changed tiles, each field quantised to a byte, run-length coded
  const Q = { M: [0, 1], W: [0, 1.5, 'sq'], I: [0, 0.5], S: [0, 1], C: [0, 1], Nu: [0, 1], V: [0, 1], Fu: [0, 3], Ch: [0, 3], Sc: [0, 1], Ash: [0, 1], Pr: [0, 1], Bk: [0, 1], E: [-0.6, 0.6], Hv: [0, 0.04] };
  function snapOf(tx, tz) {
    const t = tz * NT + tx; const o = {};
    for (const k of [...FIELDS, 'mat']) { const src = f[k], dst = new src.constructor(TC * TC); for (let j = 0; j < TC; j++) dst.set(src.subarray((tz * TC + j) * N + tx * TC, (tz * TC + j) * N + tx * TC + TC), j * TC); o[k] = dst; }
    void t; return o;
  }
  function encodeSnap(s) {
    const out = [];
    for (const [k, [lo, hi, sq]] of Object.entries(Q)) {
      const a = s[k]; let i = 0;
      const q = (v) => { let u = (v - lo) / (hi - lo); u = u < 0 ? 0 : u > 1 ? 1 : u; if (sq) u = Math.sqrt(u); return Math.round(u * 255); };
      const row = [];
      while (i < a.length) { const v = q(a[i]); let n = 1; while (i + n < a.length && n < 255 && q(a[i + n]) === v) n++; row.push(n, v); i += n; }
      out.push(row);
    }
    const mrow = []; { const a = s.mat; let i = 0; while (i < a.length) { const v = a[i]; let n = 1; while (i + n < a.length && n < 255 && a[i + n] === v) n++; mrow.push(n, v); i += n; } }
    out.push(mrow);
    const flat = []; for (const r of out) { flat.push(r.length >> 8, r.length & 255); flat.push(...r); }
    let bin = ''; for (let i = 0; i < flat.length; i += 4096) bin += String.fromCharCode.apply(null, flat.slice(i, i + 4096));
    return btoa(bin);
  }
  function decodeInto(b64, s) {
    const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    let p = 0; const keys = [...Object.keys(Q), 'mat'];
    for (const k of keys) {
      const len = (u[p] << 8) | u[p + 1]; p += 2; const end = p + len; let i = 0;
      const [lo, hi, sq] = Q[k] || [0, 255]; const a = s[k];
      while (p < end) { const n = u[p++], v = u[p++]; let val = v; if (Q[k]) { let x = v / 255; if (sq) x *= x; val = lo + x * (hi - lo); } for (let m = 0; m < n; m++) a[i++] = val; }
    }
  }
  function save() {
    const o = {};
    const keep = [...store].slice(-48); // the most recent changes off-window; older ones heal back to the world as generated
    for (const [key, s] of keep) o[key] = encodeSnap(s);
    for (let tz = 0; tz < NT; tz++) for (let tx = 0; tx < NT; tx++) if (ready[tz * NT + tx] && touched[tz * NT + tx]) o[tkey(tx, tz)] = encodeSnap(snapOf(tx, tz));
    return o;
  }
  // saved tiles come back on top of their freshly generated state
  const saved = new Map();
  function load(o) { saved.clear(); for (const [k, v] of Object.entries(o || {})) saved.set(k, v); }
  const initRaw = initTile;
  initTile = (gx0, gz0, b, n, c) => {
    initRaw(gx0, gz0, b, n, c);
    const key = (gx0 / TC) + ',' + (gz0 / TC), s = saved.get(key);
    if (s) { try { decodeInto(s, b); for (let i = 0; i < n * n; i++) b.H[i] += b.E[i] + b.Hv[i]; } catch (e) { /* a bad tile just starts fresh */ } }
  };
  function clear() { store.clear(); saved.clear(); ready.fill(0); touched.fill(0); awake.fill(0); placed = false; for (const k of FIELDS) f[k].fill(0); }

  return {
    N, NT, TC, cell, f, env, events, stats, awake, ready, touched,
    get ox() { return ox; }, get oz() { return oz; },
    idxAt, recentre, step, ignite, heat, addWater, takeWater, addFuel, stamp, bearing, groundChanged, surface, speedAt, wake,
    save, load, clear, airAt,
    cellX: (k) => (ox + (k % N) + 0.5) * cell, cellZ: (k) => (oz + ((k / N) | 0) + 0.5) * cell,
  };
}
