// Land animals around the home garden, as one small simulation shared by the server (server/src/fauna.js,
// the truth online) and the offline client. Hares graze in two meadows; a fox dens by the ruins and hunts
// them when hungry. Everything is perception and memory, no meters:
//   - senses: sight (a wide cone for hares, a narrower one for the fox, plus a short 'feel it' radius) and
//     hearing (how loud you move: sprint > walk > creep, spherical spreading and air absorption)
//   - hares bolt from what they perceive coming too close (closer when you move slowly; a creeper or someone
//     standing still can get right up to one), and bolt sooner from
//     anyone they remember hurting one of them; they bolt from a fox they notice stalking or chasing
//   - the fox gets hungry, stalks a hare it can see, then sprints; it tires after a few seconds; it keeps
//     away from people
//   - a hare fed by the same person a few times, unharmed, remembers that and follows them (tame); a tame
//     hare can be brushed for underfur now and then. Animals hurt by someone remember who.
//   const st = createFauna()   stepFauna(st, dt, players, t)   faunaAct(st, kind, aid, P, id, t)
import { gardenNoGo } from './garden-rules.js';
export const SPECIES = {
  hare: { name: 'hare', hp: 1, walk: 1.1, run: 6.0, sight: 24, cone: 300, near: 2.5, hearDb: 12, flee: 5, give: { meat: 1, hide: 1 } }, // raw meat: roast it at a campfire
  fox: { name: 'fox', hp: 2, walk: 1.3, stalk: 0.9, run: 7.6, sight: 28, cone: 220, near: 2.0, hearDb: 14, flee: 8, chaseS: 5, give: { hide: 2 } },
};
export const HOMES = [
  { id: 'h1', sp: 'hare', x: 22, z: -12, r: 8 }, { id: 'h2', sp: 'hare', x: 23, z: -10, r: 8 }, { id: 'h3', sp: 'hare', x: 20, z: -14, r: 8 },
  { id: 'h4', sp: 'hare', x: -14, z: -22, r: 6 }, { id: 'h5', sp: 'hare', x: -12, z: -20, r: 6 },
  { id: 'f1', sp: 'fox', x: -30, z: -18, r: 30 },
];
export const RESPAWN_MS = 4 * 60e3, FEEDS_TO_TAME = 3, FEED_GAP_MS = 15e3, BRUSH_MS = 8 * 60e3, REACH = 2.4;
const hyp = Math.hypot, rnd = Math.random;
// where an animal can stand: inside the garden and off every no-go spot the server uses too (js/garden-rules.js:
// the garden's own solids, the pond, the raked sand, the beds, the cove water); they may cross the path and the places
export function walkable(x, z) {
  if (hyp(x - 1.5, z + 0.5) > 50) return false;
  const why = gardenNoGo(x, z, 0.15);
  return !why || why === 'path' || why === 'spawn' || why.startsWith('place:');
}
export function createFauna() {
  return { v: 1, animals: HOMES.map((h) => fresh(h)), t: 0 };
}
function fresh(h) { const a = rnd() * 6.283, r = rnd() * h.r * 0.5; return { id: h.id, sp: h.sp, home: h.id, x: h.x + Math.cos(a) * r, z: h.z + Math.sin(a) * r, yaw: rnd() * 6.283, st: 'graze', until: 0, tx: h.x, tz: h.z, v: 0, hp: SPECIES[h.sp].hp, hunger: rnd() * 0.4, mem: [], tame: null, dead: 0 }; }
const homeOf = (a) => HOMES.find((h) => h.id === a.home);
// how loud someone moving at sp m/s is at 1 m (dB): creeping, walking, running
const loudOf = (sp) => (sp > 5.5 ? 58 : sp > 2 ? 46 : sp > 0.3 ? 34 : 0);
export function senses(a, P, sp) {
  const S = SPECIES[a.sp], d = hyp(P.x - a.x, P.z - a.z);
  if (d <= S.near) return { d, how: 'felt' };
  if (d <= S.sight && sp > 0.15) { let ang = Math.atan2(P.x - a.x, P.z - a.z) - a.yaw; ang = Math.atan2(Math.sin(ang), Math.cos(ang)); if (Math.abs(ang) <= (S.cone * Math.PI / 180) / 2) return { d, how: 'saw' }; }
  const lvl = loudOf(sp) - 20 * Math.log10(Math.max(1, d)) - 0.05 * d;
  return lvl >= S.hearDb ? { d, how: 'heard' } : null;
}
const remembers = (a, who, what, t, ms = 30 * 60e3) => a.mem.some((m) => (who == null || m.who === who) && m.what === what && t - m.at < ms);
const note = (a, who, what, t) => { a.mem.push({ who, what, at: t }); if (a.mem.length > 24) a.mem.splice(0, a.mem.length - 24); };
function goTo(a, x, z, st, until) { a.tx = x; a.tz = z; a.st = st; a.until = until; }
function fleeFrom(a, fx, fz, t, dist = 14) {
  let ang = Math.atan2(a.x - fx, a.z - fz), best = null;
  for (let k = 0; k < 9 && !best; k++) { const tryA = ang + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.45, x = a.x + Math.sin(tryA) * dist, z = a.z + Math.cos(tryA) * dist; if (walkable(x, z)) best = [x, z]; }
  if (best) goTo(a, best[0], best[1], 'flee', t + 3500);
}
function wander(a, t) {
  const h = homeOf(a); const tame = a.tame && a._lead;
  if (tame) { goTo(a, a._lead.x + (rnd() - 0.5) * 3, a._lead.z + (rnd() - 0.5) * 3, 'follow', t + 2500); return; }
  const r = rnd();
  if (r < 0.45) { a.st = 'graze'; a.until = t + 3000 + rnd() * 6000; return; }
  if (r < 0.6) { a.st = 'idle'; a.until = t + 2000 + rnd() * 3000; return; }
  for (let k = 0; k < 6; k++) { const ang = rnd() * 6.283, d = rnd() * h.r, x = h.x + Math.cos(ang) * d, z = h.z + Math.sin(ang) * d; if (walkable(x, z)) { goTo(a, x, z, 'walk', t + 9000); return; } }
  a.st = 'idle'; a.until = t + 2000;
}
// players: [{ aid, x, z, sp }]
export function stepFauna(st, dt, players, t) {
  const A = st.animals; st.t = t;
  for (const a of A) {
    const S = SPECIES[a.sp];
    if (a.dead) { if (t >= a.dead) Object.assign(a, fresh(homeOf(a)), { mem: a.mem }); continue; }
    a._lead = a.tame ? players.find((p) => p.aid === a.tame && hyp(p.x - a.x, p.z - a.z) < 35) || null : null;
    // people: the nearest one it perceives, and whether that one is too close
    let threat = null;
    for (const p of players) {
      if (a.tame && p.aid === a.tame && !remembers(a, p.aid, 'hurt', t, 5 * 60e3)) continue; // its person
      const s = senses(a, p, p.sp); if (!s) continue;
      const scared = remembers(a, p.aid, 'hurt', t) || (a.sp === 'hare' && A.some((o) => o.sp === 'hare' && remembers(o, p.aid, 'hurt', t) && hyp(o.x - a.x, o.z - a.z) < 20));
      // someone creeping or standing still is tolerated up close (that is how you feed one, or hunt one);
      // moving faster widens the flight distance, and a remembered hurt makes it bolt even from a creeper
      const fear = p.sp < 0.4 ? (scared ? 7 : 0) : S.flee + p.sp * 1.5 + (scared ? 8 : 0) - (a.sp === 'hare' && remembers(a, p.aid, 'fed', t, 20 * 60e3) ? 3 : 0);
      if (s.d < fear && (!threat || s.d < threat.d)) threat = { x: p.x, z: p.z, d: s.d, who: p.aid };
    }
    if (a.sp === 'hare') {
      // a fox it notices: a chasing fox is loud; a stalking one only up close or in full view
      for (const f of A) if (f.sp === 'fox' && !f.dead && (f.st === 'chase' || f.st === 'stalk')) {
        const d = hyp(f.x - a.x, f.z - a.z), s = senses(a, f, f.st === 'chase' ? 6 : 0.4);
        if (s && (f.st === 'chase' ? d < 18 : d < 7)) { if (!threat || d < threat.d) threat = { x: f.x, z: f.z, d, who: 'fox' }; }
      }
      if (threat && a.st !== 'flee') { fleeFrom(a, threat.x, threat.z, t); if (threat.who === 'fox') note(a, 'fox', 'chased', t); }
    } else {
      a.hunger = Math.min(1, a.hunger + dt / 300);
      if (threat && a.st !== 'flee') { fleeFrom(a, threat.x, threat.z, t, 16); a.chaseT = 0; }
      else if (a.st !== 'flee' && a.st !== 'eat' && a.hunger > 0.5) {
        let prey = null; for (const h of A) if (h.sp === 'hare' && !h.dead) { const s = senses(a, h, h.v); const d = hyp(h.x - a.x, h.z - a.z); if ((s || d < 12) && d < S.sight && (!prey || d < prey.d)) prey = { h, d }; }
        if (prey) {
          if (a.st === 'chase') { a.chaseT = (a.chaseT || 0) + dt; if (a.chaseT > S.chaseS) { a.st = 'rest'; a.until = t + 15000; a.chaseT = 0; } else { a.tx = prey.h.x; a.tz = prey.h.z; } }
          else if (a.st !== 'rest') { if (prey.d < 9) { a.st = 'chase'; a.chaseT = 0; a.until = t + 8000; } else goTo(a, prey.h.x, prey.h.z, 'stalk', t + 4000); a.tx = prey.h.x; a.tz = prey.h.z; }
          if (prey.d < 0.9 && a.st === 'chase') { prey.h.dead = t + RESPAWN_MS; prey.h.st = 'dead'; prey.h.tame = null; a.st = 'eat'; a.until = t + 25000; a.hunger = 0; st.lastKill = { t, x: prey.h.x, z: prey.h.z, by: a.id, prey: prey.h.id }; }
        }
      }
    }
    if (t >= a.until && a.st !== 'flee' || (a.st === 'flee' && t >= a.until)) wander(a, t);
    if (a.tame && a._lead && (a.st === 'graze' || a.st === 'idle') && hyp(a._lead.x - a.x, a._lead.z - a.z) > 5) goTo(a, a._lead.x, a._lead.z, 'follow', t + 2500);
    // move toward the target at the state's pace
    const pace = a.st === 'flee' ? S.run : a.st === 'chase' ? S.run : a.st === 'stalk' ? S.stalk : a.st === 'follow' ? (hyp(a.tx - a.x, a.tz - a.z) > 8 ? 4 : S.walk * 1.4) : a.st === 'walk' ? S.walk : 0;
    const ex = a.tx - a.x, ez = a.tz - a.z, d = hyp(ex, ez);
    if (pace > 0 && d > 0.3) {
      const want = Math.atan2(ex, ez); let dh = want - a.yaw; dh = Math.atan2(Math.sin(dh), Math.cos(dh)); a.yaw += dh * Math.min(1, dt * 5);
      const step = Math.min(d, pace * dt), nx = a.x + Math.sin(a.yaw) * step, nz = a.z + Math.cos(a.yaw) * step;
      if (walkable(nx, nz)) { a.x = nx; a.z = nz; a.v = pace; } else { a.v = 0; if (a.st !== 'chase') a.until = 0; }
    } else { a.v = 0; if ((a.st === 'walk' || a.st === 'follow') && d <= 0.3) a.until = Math.min(a.until, t); }
  }
}
// something a person does to an animal: hunt (a spear thrust), feed (a handful of fibre: grass and stems), brush
export function faunaAct(st, kind, aid, P, id, t) {
  const a = st.animals.find((x) => x.id === id); if (!a || a.dead) return { ok: false, why: 'gone' };
  const d = hyp(P.x - a.x, P.z - a.z), S = SPECIES[a.sp];
  if (d > REACH) return { ok: false, why: 'far' };
  if (kind === 'hit') {
    a.hp -= 1; note(a, aid, 'hurt', t); if (a.tame === aid) a.tame = null;
    if (a.hp <= 0) { a.dead = t + RESPAWN_MS; a.st = 'dead'; a.tame = null; return { ok: true, killed: true, give: { ...S.give }, text: a.sp === 'fox' ? 'The fox is dead. You skin it.' : 'The hare is dead. Meat, and a small hide.' }; }
    fleeFrom(a, P.x, P.z, t, 18); return { ok: true, text: `The ${S.name} is hurt and bolts.` };
  }
  if (kind === 'feed') {
    if (a.sp !== 'hare') return { ok: false, why: 'wont' };
    if (a.st === 'flee') return { ok: false, why: 'scared' };
    if (remembers(a, aid, 'hurt', t, 24 * 3600e3)) { fleeFrom(a, P.x, P.z, t); return { ok: false, why: 'remembers', text: 'It remembers you. It bolts.' }; }
    const fed = a.mem.filter((m) => m.who === aid && m.what === 'fed');
    if (fed.length && t - fed[fed.length - 1].at < FEED_GAP_MS) return { ok: false, why: 'full', text: 'It is still chewing the last handful.' };
    note(a, aid, 'fed', t); a.st = 'graze'; a.until = t + 6000;
    if (fed.length + 1 >= FEEDS_TO_TAME && !a.tame) { a.tame = aid; return { ok: true, tamed: true, text: 'The hare has decided you are food, not danger. It follows you now.' }; }
    return { ok: true, text: fed.length ? 'It eats from your hand.' : 'It sniffs, then eats.' };
  }
  if (kind === 'brush') {
    if (a.tame !== aid) return { ok: false, why: 'wont' };
    const last = a.mem.filter((m) => m.who === aid && m.what === 'brushed').pop();
    if (last && t - last.at < BRUSH_MS) return { ok: false, why: 'soon', text: 'Not much loose fur yet. Later.' };
    note(a, aid, 'brushed', t); return { ok: true, give: { fibre: 2 }, text: 'A handful of soft underfur.' };
  }
  return { ok: false, why: 'kind' };
}
export const wire = (st) => st.animals.map((a) => [a.id, a.sp, +a.x.toFixed(2), +a.z.toFixed(2), +a.yaw.toFixed(2), a.st, a.tame, +a.v.toFixed(1)]);
