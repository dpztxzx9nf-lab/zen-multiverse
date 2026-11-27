// Walls are real for everyone: the server refuses a step into anything solid, using exactly the shapes the client
// collides with. Nothing here is hand-measured:
//   - fixed scenery:   js/solids-data.js, generated from the game's own baked meshes (tools/ci/solids-export.py),
//                      keeping only cells that are solid on every device class and in every season;
//   - camp props:      the same file's per-kind grids, placed where this world's camps stand (js/factions/sim.js);
//   - the camp gate:   its leaf as a box at the hinge, closed unless the camp has opened it to you;
//   - set-down things: each fixture kind's rigid-body box (crates, lockers, stations), placed at its pose;
//   - build pieces:    upright pieces as boxes from js/game/g7/pieces.js (pitched ramps/beams are left to the client);
//   - the vault:       server/src/games.js blocks() with js/solids.js vaultShapes().
// Bodies (people, camp folk, animals) are upright capsules (js/solids.js BODY_R); pressed against one for
// BODY_YIELD_MS you slip past, so nobody can wall someone in. A refused step is a snap back, never a strike.
import { SOLIDS } from '../../js/solids-data.js';
import { placeShapes, stepBlocked, bodyStepBlocked, bodyShape, blocksBody, nearest, inBand, BODY, BODY_YIELD_MS } from '../../js/solids.js';
import { GARDEN_WATER } from '../../js/garden-shapes.js';
import { lookoutHeight } from '../../js/places.js';
import { PIECES } from '../../js/game/g7/pieces.js';
import { HUB_BOXES, EARTH_SITE, gardenToPlanet, HUB_PAD_Y, liftGardenPose } from '../../js/hub.js';

export const SOLIDS_V = SOLIDS.v;
const bbox = (c) => {
  if (c.type === 'cells' && c.ox == null) return [c.x0, c.z0, c.x0 + c.nx * c.cs, c.z0 + c.nz * c.cs];
  if (c.type === 'cells') { const r = Math.hypot(c.nx, c.nz) * c.cs + Math.hypot(c.x0, c.z0); return [c.ox - r, c.oz - r, c.ox + r, c.oz + r]; }
  if (c.type === 'box') { const r = Math.hypot(c.hw, c.hd); return [c.x - r, c.z - r, c.x + r, c.z + r]; }
  if (c.type === 'circle') return [c.x - c.r, c.z - c.r, c.x + c.r, c.z + c.r];
  return [-Infinity, -Infinity, Infinity, Infinity];
};
const withBox = (c) => { c.bb = bbox(c); return c; };
// fixed scenery (garden frame), decoded once per isolate
let GARDEN = null;
export function gardenSolids() { return GARDEN || (GARDEN = SOLIDS.garden.map((c) => withBox({ ...c, tag: 'garden' }))); }
function liftSolid(c) {
  const o = { ...c, tag: 'garden' };
  if (o.bottom != null) o.bottom += HUB_PAD_Y;
  if (o.top != null) o.top += HUB_PAD_Y;
  if (o.x != null && o.z != null) { const p = gardenToPlanet(o.x, o.z); o.x = p.x; o.z = p.z; }
  if (o.x0 != null && o.z0 != null) { const p = gardenToPlanet(o.x0, o.z0); o.x0 = p.x; o.z0 = p.z; }
  if (o.ox != null && o.oz != null) { const p = gardenToPlanet(o.ox, o.oz); o.ox = p.x; o.oz = p.z; }
  return withBox(o);
}
let GARDEN_P = null;
export function gardenSolidsPlanet() { return GARDEN_P || (GARDEN_P = SOLIDS.garden.map(liftSolid)); }
let HUB = null;
export function hubSolids() { return HUB || (HUB = HUB_BOXES.map((c) => withBox({ ...c, tag: 'hub' }))); }
const near = (list, x0, z0, x1, z1, m) => list.filter((c) => c.bb[0] <= Math.max(x0, x1) + m && c.bb[2] >= Math.min(x0, x1) - m && c.bb[1] <= Math.max(z0, z1) + m && c.bb[3] >= Math.min(z0, z1) - m);

// a prefab grid list (baked at the origin) placed at (x, z) on ground y
const placed = (grids, x, z, y, extra = {}) => grids.map((g) => withBox({ ...g, ox: x, oz: z, ry: 0, top: g.top + y, bottom: g.bottom + y, ...extra }));
const boxAt = (b, x, z, ry, y, extra = {}) => withBox({ ...placeShapes([b], x, z, ry)[0], top: b.top + y, bottom: b.bottom + y, ...extra });

export class Solids {
  constructor(w, games) { this.w = w; this.g = games; this.gateOk = new Set(); this.camp = null; this.campKey = ''; this.memo = new Map(); }
  // set-down things and build pieces live in SQL: re-read at most twice a second
  cached(k, fn) { const t = Date.now(), m = this.memo.get(k); if (m && t - m.t < 500) return m.v; const v = fn(); this.memo.set(k, { t, v }); return v; }
  forget() { this.memo.clear(); }
  // camp props from the world's faction scene: rebuilt when the scene changes (camps are fixed while they stand)
  campShapes() {
    const sim = this.w.fa && this.w.fa.sim; if (!sim || !sim.st || !Array.isArray(sim.st.props)) return [];
    const st = sim.st, key = st.kind + ':' + st.anchor.x + ',' + st.anchor.z + ':' + (st.anchor.tile || '') + ':' + st.props.length + ':' + Object.keys(st.caches || {}).length;
    if (key === this.campKey && this.camp) return this.camp;
    const out = [], P = SOLIDS.prefabs || {}, ground = (x, z) => (st.anchor.tile ? 0 : lookoutHeight(x, z));
    for (const p of st.props) {
      const grids = P['camp-' + p.k]; if (grids) out.push(...placed(grids, p.x, p.z, ground(p.x, p.z), { name: 'camp-' + p.k, tile: st.anchor.tile || null }));
      if (p.gate && SOLIDS.gate) { const G = SOLIDS.gate, hx = p.gate.x + G.hinge.dx, hz = p.gate.z + G.hinge.dz; out.push(boxAt(G.box, hx, hz, G.hinge.closed, ground(hx, hz), { name: 'camp-gate', gate: true, tile: st.anchor.tile || null })); }
    }
    for (const c of Object.values(st.caches || {})) if (P['camp-cache']) out.push(...placed(P['camp-cache'], c.x, c.z, ground(c.x, c.z), { name: 'camp-cache', tile: st.anchor.tile || null }));
    this.camp = out; this.campKey = key; return out;
  }
  fixtureShapes(tile) { return this.cached('fx:' + (tile || ''), () => this.fixtureRead(tile)); }
  fixtureRead(tile) {
    const st = this.g.st; if (!st || !st.all) return [];
    const F = SOLIDS.fixtures || {}, out = [];
    for (const f of st.all()) { if ((f.tile || null) !== (tile || null) || !F[f.kind]) continue; out.push(boxAt(F[f.kind], f.x, f.z, f.yaw || 0, f.y || 0, { name: f.kind, fx: f.id })); }
    return out;
  }
  pieceShapes(a) { const bd = this.g.bd; if (!bd || !bd.here || !bd.here(a)) return []; return this.cached('pieces', () => this.pieceRead()); }
  pieceRead() {
    const bd = this.g.bd;
    const out = [];
    for (const p of bd.all()) {
      const D = PIECES[p.type]; if (!D || D.pitch) continue; // a ramp or a slanted beam: walked up, not into (client only)
      const [w, h, d] = D.dims;
      out.push(withBox({ type: 'box', kind: 'solid', x: p.x, z: p.z, hw: w / 2, hd: d / 2, ry: p.yaw || 0, top: p.y + h / 2, bottom: p.y - h / 2, name: 'piece-' + p.type }));
    }
    return out;
  }
  // everything solid near a step, for this mover (the gate leaf is open to people the camp has let in)
  shapesFor(a, next) {
    const tile = next.tile || null, m = 3;
    let s = [];
    const kind = ((this.w.parsed && this.w.parsed(a.world)) || { kind: a.kind }).kind;
    if (kind === 'home' && tile === EARTH_SITE.tile) {
      s.push(...near(hubSolids(), a.x, a.z, next.x, next.z, m));
      s.push(...near(gardenSolidsPlanet(), a.x, a.z, next.x, next.z, m));
    }
    for (const c of near(this.campShapes(), a.x, a.z, next.x, next.z, m)) if ((c.tile || null) === tile && !(c.gate && this.gateOk.has(a.aid))) s.push(c);
    s.push(...near(this.fixtureShapes(tile), a.x, a.z, next.x, next.z, m));
    if (kind === 'home' && tile === EARTH_SITE.tile) s.push(...near(this.pieceShapes(a), a.x, a.z, next.x, next.z, m));
    return s;
  }
  // would this step go into something solid? (only shapes that reach her body band at her height)
  wall(a, next) { return stepBlocked(this.shapesFor(a, next), a, next, next.y); }
  // ending inside something solid (a re-seat after a quiet spell, a frame switch): the end spot alone
  inside(a, next) { const s = this.shapesFor({ ...a, x: next.x, z: next.z }, next).filter((c) => inBand(c, next.y)); return s.length > 0 && nearest(s, next.x, next.z) < 0; }

  // ---- bodies
  bodiesFor(a, next) {
    const tile = next.tile || null, out = [];
    for (const o of this.g.present()) if (o.aid !== a.aid && o.x != null && (o.tile || null) === tile && Math.hypot(o.x - next.x, o.z - next.z) < 3) out.push(bodyShape('person', o.x, o.z, o.y || 0, { aid: o.aid }));
    const sim = this.w.fa && this.w.fa.sim, t = Date.now();
    if (sim && sim.st && (sim.st.anchor.tile || null) === tile) {
      for (const n of Object.values(sim.st.npcs || {})) {
        if (n.st !== 'ok' && n.st !== 'returning') continue; // lying down, tied up or gone: not standing in the way
        let p; try { p = sim.pos(n, t); } catch { continue; }
        if (p && Math.hypot(p.x - next.x, p.z - next.z) < 3) out.push(bodyShape('person', p.x, p.z, tile ? 0 : lookoutHeight(p.x, p.z), { npc: n.id }));
      }
    }
    const fz = this.g.fa;
    if (fz && fz.here && fz.here({ ...a, tile }) && fz.st && Array.isArray(fz.st.animals)) {
      for (const an of fz.st.animals) {
        if (an.dead || !blocksBody(an.sp)) continue;
        const p = liftGardenPose({ x: an.x, z: an.z, y: lookoutHeight(an.x, an.z), tile: null });
        if (Math.hypot(p.x - next.x, p.z - next.z) < 3) out.push(bodyShape(an.sp, p.x, p.z, p.y, { animal: an.id }));
      }
    }
    return out;
  }
  // a step into someone: refused until she has pressed against them for a while, then she slips past
  body(a, next, t) {
    const B = this.bodiesFor(a, next);
    const blocked = B.length > 0 && bodyStepBlocked(B, a, next, next.y);
    if (!blocked) {
      const clear = !B.length || B.every((c) => Math.hypot(c.x - next.x, c.z - next.z) > c.r + BODY.radius + 0.25);
      if (clear) a.bpT = 0;
      return false;
    }
    if (!a.bpT) a.bpT = t;
    return t - a.bpT < BODY_YIELD_MS - 500; // the server gives way a little before the client does
  }
  // where things may be set down or spawn in the garden: clear of every solid (by `m` metres) and off the water
  open(x, z, m = 0) {
    if (GARDEN_WATER.sdf(x, z) < m) return 'pond';
    const s = near(gardenSolids(), x, z, x, z, m + 0.5);
    if (s.length && nearest(s, x, z) < m) return 'solid:' + (s.find((c) => nearest([c], x, z) < m) || {}).name;
    return null;
  }
}
