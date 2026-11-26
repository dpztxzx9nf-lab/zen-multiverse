// Xenia: the home planet (the Earth-like world everyone starts on). Pure data and maths, shared by the game
// (terrain, map, region names) and the server (region tags on positions, ground checks). No three.js here.
//
// The hub: Home Valley at 25 N, 0 E. Near the hub the game uses one fixed frame, the hub frame ("tile null"
// on the wire, 'hub' in the client): x = east, z = south (so -z is north), y up, metres along the surface
// (exponential map at HUB_DIR). Its origin is the old garden's origin, so old garden coordinates, saves and
// builds stay valid as they are. Beyond HUB_OUT the game switches to the normal cube-sphere tiles.
//
// Regions are laid out around the globe by distance and bearing from the hub (bearing clockwise from north),
// as on the plan Page. Risk: safe (Home Valley), guarded, contested, wild. The server stores the risk with
// every position for the later raid rules.
export const XENIA = { name: 'Xenia', R: 6400, lat: 25, lon: 0, sea: -0.35, seed: 7 };
export const HUB_OUT = 4400, HUB_IN = 4000; // leave the hub frame past HUB_OUT, come back inside HUB_IN (hysteresis)
import { coveGround, COVE } from '../cove.js';
const D2R = Math.PI / 180;
const phi = XENIA.lat * D2R;
// spin axis = +y (planetgen's climate uses the same); lon 0 looks down +z
export const HUB_DIR = [0, Math.sin(phi), Math.cos(phi)];
const HE = [1, 0, 0];                                 // east at the hub
const HS = [0, -Math.cos(phi), Math.sin(phi)];        // south at the hub (= east x up)
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// the hub frame: same shape as js/universe/sphere.js makeFrame() (id, R, a, e, s, toDir, fromDir)
const frames = new Map();
export function hubFrame(R = XENIA.R) {
  let f = frames.get(R); if (f) return f;
  const a = HUB_DIR, e = HE, s = HS;
  f = {
    id: 'hub', R, a, e, s,
    toDir(x, z, out = [0, 0, 0]) {
      const d = Math.hypot(x, z);
      if (d < 1e-9) { out[0] = a[0]; out[1] = a[1]; out[2] = a[2]; return out; }
      const th = d / R, c = Math.cos(th), k = Math.sin(th) / d;
      out[0] = a[0] * c + (e[0] * x + s[0] * z) * k; out[1] = a[1] * c + (e[1] * x + s[1] * z) * k; out[2] = a[2] * c + (e[2] * x + s[2] * z) * k;
      return out;
    },
    fromDir(d) {
      const c = Math.max(-1, Math.min(1, dot(a, d))), th = Math.acos(c);
      const t = [d[0] - a[0] * c, d[1] - a[1] * c, d[2] - a[2] * c], tl = Math.hypot(t[0], t[1], t[2]);
      if (tl < 1e-12) return [0, 0];
      const k = th * R / tl; return [dot(t, e) * k, dot(t, s) * k];
    },
  };
  frames.set(R, f); return f;
}
// metres along the surface from the hub, and the bearing (degrees clockwise from north)
export function hubPolar(d, R = XENIA.R) {
  const c = Math.max(-1, Math.min(1, dot(HUB_DIR, d)));
  const x = dot(d, HE), z = dot(d, HS);
  let b = Math.atan2(x, -z) / D2R; if (b < 0) b += 360;
  return { D: Math.acos(c) * R, b };
}

// ---- noise (value noise on a hashed lattice, smooth; deterministic everywhere)
function hash3(i, j, k) {
  let h = (i * 374761393 + j * 668265263 + k * 2147483647 + XENIA.seed * 1013904223) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return (h & 0xffff) / 32767.5 - 1;
}
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
export function noise3(x, y, z) {
  const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z), fx = x - i, fy = y - j, fz = z - k;
  const u = fade(fx), v = fade(fy), w = fade(fz);
  const l = (a, b, t) => a + (b - a) * t;
  return l(
    l(l(hash3(i, j, k), hash3(i + 1, j, k), u), l(hash3(i, j + 1, k), hash3(i + 1, j + 1, k), u), v),
    l(l(hash3(i, j, k + 1), hash3(i + 1, j, k + 1), u), l(hash3(i, j + 1, k + 1), hash3(i + 1, j + 1, k + 1), u), v), w);
}
function fbm(x, y, z, o) { let s = 0, a = 0.5, f = 1, n = 0; for (let i = 0; i < o; i++) { s += a * noise3(x * f + i * 17.1, y * f, z * f); n += a; f *= 2.03; a *= 0.5; } return s / n; }
function ridged(x, y, z, o) { let s = 0, a = 0.5, f = 1, n = 0; for (let i = 0; i < o; i++) { const r = 1 - Math.abs(noise3(x * f, y * f + i * 9.3, z * f)); s += a * r * r; n += a; f *= 2.1; a *= 0.5; } return s / n; }
const ss = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---- the regions (distances in metres for R = 6400; scaled with R)
export const RISK = { safe: 0, guarded: 1, contested: 2, wild: 3 };
export const REGIONS = [
  { id: 'home', name: 'Home Valley', risk: 'safe', r0: 0, r1: 1500, b0: 0, b1: 360, what: 'The spawn town, the garden, the cove and the camps. Nobody can raid here.' },
  { id: 'salt', name: 'Salt Coast', risk: 'guarded', r0: 1500, r1: 5000, b0: 80, b1: 245, what: 'Salt flats, beaches and the wreck. The Wardens patrol it.' },
  { id: 'cedar', name: 'Cedar Highlands', risk: 'guarded', r0: 1500, r1: 14000, b0: 245, b1: 330, what: 'Rolling forested hills to the west.' },
  { id: 'grey', name: 'Grey Ridge', risk: 'contested', r0: 1500, r1: 6500, b0: 330, b1: 80, what: 'Rock ridges and Grey Peak (900 m). Reavers hold the passes.' },
  { id: 'ice', name: 'North Ice', risk: 'wild', r0: 6500, r1: 14000, b0: 330, b1: 30, what: 'Ice domes up to the pole.' },
  { id: 'badlands', name: 'Red Badlands', risk: 'contested', r0: 6500, r1: 14000, b0: 30, b1: 140, what: 'Red mesas. The Reaver fort sits on the tallest one.' },
  { id: 'sea', name: 'Warm Sea', risk: 'contested', r0: 5000, r1: 14000, b0: 140, b1: 245, what: 'Open water and islands.' },
  { id: 'ember', name: 'Ember Highlands', risk: 'wild', r0: 14000, r1: 99999, b0: 0, b1: 360, what: 'Black rock and old volcanoes on the far side of the world.' },
];
export const REGION = Object.fromEntries(REGIONS.map((r) => [r.id, r]));
const inArc = (b, b0, b1) => (b0 <= b1 ? b >= b0 && b < b1 : b >= b0 || b < b1);
// angular distance outside [b0, b1) (0 inside)
const arcOut = (b, b0, b1) => { if (b1 - b0 >= 360) return 0; if (inArc(b, b0, b1)) return 0; const d0 = ((b0 - b) % 360 + 360) % 360, d1 = ((b - b1) % 360 + 360) % 360; return Math.min(d0, d1); };
// borders wander a little (no straight spokes): warped distance and bearing
function warped(d, R) {
  const p = hubPolar(d, R), k = R / XENIA.R, X = d[0] * R / 2600, Y = d[1] * R / 2600, Z = d[2] * R / 2600;
  return { D: p.D / k + 420 * noise3(X + 3.1, Y, Z), b: (p.b + 9 * noise3(X, Y + 7.7, Z) + 360) % 360, rawD: p.D / k, rawB: p.b };
}
// the region at a unit direction (hard borders: what the name toast and the server use)
export function regionAt(d, R = XENIA.R) {
  const w = warped(d, R);
  for (const r of REGIONS) if (w.D >= r.r0 && w.D < r.r1 && inArc(w.b, r.b0, r.b1)) return r;
  // gaps between the table's rows: nearest by bearing
  if (w.D < 1500) return REGION.home;
  if (w.D >= 14000) return REGION.ember;
  if (inArc(w.b, 80, 140)) return REGION.salt;
  return REGION.cedar;
}
export const riskAt = (d, R = XENIA.R) => regionAt(d, R).risk;

// ---- hand-placed features in hub metres (x east, z south)
const polar = (D, b) => ({ x: D * Math.sin(b * D2R), z: -D * Math.cos(b * D2R) });
export const PEAK = { ...polar(3000, 40), top: 900, r: 1750, name: 'Grey Peak' };
export const LOOKOUT = { x: 564, z: 205, top: 120, r: 300 };
export const FORT = { ...polar(9000, 85), top: 300, r: 380, name: 'Reaver fort' };
export const PLATEAU = { r0: 230, r1: 470 }; // the spawn town: dead flat at y = 0 inside r0
// the inlet: the sea reaches north up a narrow sound to just south of the cove (sea level XENIA.sea)
export const INLET = { z0: 395, z1: 5600 };
export const inletX = (z) => 34 * Math.sin(z / 300) + 16 * Math.sin(z / 97 + 1.3);
const inletW = (z) => 16 + Math.max(0, z - INLET.z0) * 0.035;
// hand-placed sites in the hub frame, each on a flat pad (h: fixed height, else the ground's own there)
// camps: the Wardens' and the Reavers' camps and the gully between them (js/factions/factions.json scenes.home.offset)
export const SITES = {
  camps: { x: -1060, z: -560, r: 70 },
  ruins: { x: -1290, z: -330, r: 22 },
  wreck: { x: 1000, z: 1732, r: 24 },
  cove: { x: COVE.x, z: COVE.z - 4, r: 30, h: 0 },
};
export const HUB_PADS = Object.values(SITES);
const PADS = HUB_PADS.map((p) => ({ x: p.x, z: p.z, r: p.r, h: p.h != null ? p.h : null }));
// the cove carves its own basin out of the pad
const carve = (X, Z) => (Math.abs(X - COVE.x) < 30 && Math.abs(Z - COVE.z) < 30 ? coveGround(X, Z) : null);

// ---- terrain: height in metres above the hub's lawn (sea level XENIA.sea) at a unit direction
const tmpD = [0, 0, 0];
function base(d, R) {
  const k = R / XENIA.R, P0 = d[0] * XENIA.R, P1 = d[1] * XENIA.R, P2 = d[2] * XENIA.R;
  const w = warped(d, R);
  const f = hubFrame(R), [hx, hz] = w.rawD < 16000 ? f.fromDir(d) : [0, 0];
  const X = hx / k, Z = hz / k;
  // region weights: smooth borders (500 m across, 10 degrees around)
  let sw = 0, h = 0;
  for (const r of REGIONS) {
    const wr = (1 - ss(0, 10, arcOut(w.b, r.b0, r.b1))) * ss(r.r0 - 500, r.r0 + 250, w.D + (r.r0 === 0 ? 1e9 : 0)) * (1 - ss(r.r1 - 250, r.r1 + 500, w.D));
    if (wr < 1e-3) continue;
    h += wr * regionHeight(r.id, P0, P1, P2, X, Z, w); sw += wr;
  }
  h = sw > 0 ? h / sw : regionHeight('cedar', P0, P1, P2, X, Z, w);
  // Grey Peak and the lookout hill rise out of whatever is around them
  if (w.rawD < 6000) {
    const rp = Math.hypot(X - PEAK.x, Z - PEAK.z);
    if (rp < PEAK.r) { const t = 1 - rp / PEAK.r, pk = PEAK.top * Math.pow(t, 1.7) + 55 * ridged(P0 / 300, P1 / 300, P2 / 300, 3) * t; h = smax(h, pk, 60); }
    const rl = Math.hypot(X - LOOKOUT.x, Z - LOOKOUT.z);
    if (rl < LOOKOUT.r) { const t = 1 - rl / LOOKOUT.r; h = smax(h, LOOKOUT.top * t * t * (3 - 2 * t), 8); }
  }
  // the Reaver fort's mesa
  { const rf = Math.hypot(X - FORT.x, Z - FORT.z); if (rf < FORT.r * 1.6) { const m = FORT.top * (1 - ss(FORT.r * 0.85, FORT.r * 1.6, rf)); h = Math.max(h, m); } }
  return { h, X, Z, D: w.rawD };
}
const smax = (a, b, k) => { const t = Math.max(0, Math.min(1, 0.5 + 0.5 * (b - a) / k)); return a + (b - a) * t + k * t * (1 - t) * 0.5; };
function regionHeight(id, x, y, z, X, Z, w) {
  switch (id) {
    case 'home': { const v = ss(500, 1600, w.D); return 3 + 45 * v + (5 + 25 * v) * fbm(x / 260, y / 260, z / 260, 3); }
    case 'salt': { const n = fbm(x / 500, y / 500, z / 500, 2); return 2.5 + 3 * n - 30 * ss(3700, 5000, w.D) * ss(100, 150, w.b); }
    case 'cedar': return 60 + 150 * (fbm(x / 900, y / 900, z / 900, 4) * 0.5 + 0.5) * ss(1300, 4000, w.D) + 25 * fbm(x / 160, y / 160, z / 160, 2);
    case 'grey': return 90 + 360 * ridged(x / 1500, y / 1500, z / 1500, 4) * ss(1400, 2600, w.D);
    case 'ice': return 70 + 170 * (fbm(x / 1100, y / 1100, z / 1100, 3) * 0.5 + 0.5) + 35 * Math.abs(noise3(x / 220, y / 220, z / 220));
    case 'badlands': { const n = (fbm(x / 1300, y / 1300, z / 1300, 3) * 0.5 + 0.5) * 5, f = n - Math.floor(n); return 25 + 48 * (Math.floor(n) + ss(0.72, 0.94, f)) + 4 * noise3(x / 60, y / 60, z / 60); }
    case 'sea': { const n = fbm(x / 800 + 4, y / 800, z / 800, 3); return -60 + 95 * ss(0.22, 0.6, n); }
    case 'ember': { const n = ridged(x / 1700, y / 1700, z / 1700, 4); return 160 + 380 * n + 120 * Math.pow(Math.max(0, noise3(x / 900, y / 900, z / 900)), 2) * 4; }
  }
  return 0;
}
// the full height: regions, then the spawn town's flat ground, pads under the camps, the inlet and the carved basins
export function xeniaHeight(d, R = XENIA.R) {
  const b = base(d, R); let h = b.h;
  if (b.D < 6000) {
    const X = b.X, Z = b.Z, r = Math.hypot(X, Z);
    if (r < PLATEAU.r1) h = h * ss(PLATEAU.r0, PLATEAU.r1, r);
    for (const p of PADS) {
      const rp = Math.hypot(X - p.x, Z - p.z); if (rp > p.r * 2.2) continue;
      if (p.h == null) { const pd = hubFrame(XENIA.R).toDir(p.x, p.z, [0, 0, 0]); p.h = Math.max(XENIA.sea + 1.5, padBase(pd, R)); }
      h = h + (p.h - h) * (1 - ss(p.r, p.r * 2.2, rp));
    }
    // the inlet (a sound from the Warm Sea up to the cove)
    if (Z > INLET.z0 - 40 && Z < INLET.z1) {
      const zc = Math.max(Z, INLET.z0), dx = Math.hypot(X - inletX(zc), Z - zc), wd = inletW(zc);
      if (dx < wd + 60) { const bed = XENIA.sea - 1.4 - 12 * ss(INLET.z0, INLET.z0 + 900, Z); h = Math.min(h, bed + (h - bed) * ss(wd - 6, wd + 60, dx)); }
    }
    if (carve) { const c = carve(X, Z); if (c != null) h = c; }
  }
  return h;
}
function padBase(d, R) { const b = base(d, R); const r = Math.hypot(b.X, b.Z); return r < PLATEAU.r1 ? b.h * ss(PLATEAU.r0, PLATEAU.r1, r) : b.h; }
// height at a hub-frame point (metres)
export function hubHeight(x, z, R = XENIA.R) { return xeniaHeight(hubFrame(R).toDir(x, z, tmpD), R); }
// which region a hub-frame point is in
export function hubRegion(x, z, R = XENIA.R) { return regionAt(hubFrame(R).toDir(x, z, tmpD), R); }
// a rough ground class for colouring: which of planetgen's biomes this region draws with
export const REGION_BIOME = { home: 'forest', salt: 'salt', cedar: 'forest', grey: 'crystal', ice: 'ice', badlands: 'crystal', sea: 'shore', ember: 'crystal' };
export function regionWeights(d, R = XENIA.R) {
  const w = warped(d, R), out = { salt: 0, forest: 0, crystal: 0, ice: 0, red: 0 };
  let s = 0;
  for (const r of REGIONS) {
    const wr = (1 - ss(0, 10, arcOut(w.b, r.b0, r.b1))) * ss(r.r0 - 500, r.r0 + 250, w.D + (r.r0 === 0 ? 1e9 : 0)) * (1 - ss(r.r1 - 250, r.r1 + 500, w.D));
    if (wr < 1e-3) continue; const bm = REGION_BIOME[r.id] === 'shore' ? 'forest' : REGION_BIOME[r.id]; out[bm] += wr; s += wr;
    if (r.id === 'badlands') out.red += wr;
  }
  for (const k in out) out[k] /= s || 1;
  return out;
}
