// People with a mind of their own. Every person in a settlement is a persistent individual: a name in
// their people's language, a temperament (inherited from parents, drifting a little each generation),
// needs, a mood, kin and friends, a memory of what they saw and heard, and an opinion of the player
// that moves with experience and gossip. Nothing is scripted: what they do is whichever action scores
// highest for them right now; what they say is built from their state, their memories and their past.
import { rng, hash } from '../names.js';
import { price, shortage, GOOD_LABEL } from './economy.js';

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const TRAITS = ['bold', 'kind', 'greedy', 'curious', 'temper', 'diligent', 'stubborn'];
const ROLE_OF = { food: 'farmer', water: 'water-carrier', wood: 'woodcutter', stone: 'quarrier', ore: 'miner', metal: 'smith', salt: 'salter', fibre: 'gatherer', cloth: 'weaver', crystal: 'cutter' };

// person #i of a settlement. Deterministic from the seed; saved fields (mem, opinion, alive...) overlay it.
export function person(st, P, i, saved) {
  const id = `${st.key}#${i}`;
  const r = rng(hash(st.seed, i, 0x9e0));
  const c = P.culture, t = {};
  // temperament leans on the culture (a martial people breeds tempers, an open one curiosity)
  const lean = { bold: c.martial, kind: 1 - c.martial * 0.5, greedy: 1 - c.kin, curious: c.open, temper: c.martial, diligent: c.craft, stubborn: c.kin };
  for (const k of TRAITS) t[k] = clamp(lean[k] * 0.5 + r() * 0.6 - 0.05);
  const guards = st.tier === 'camp' ? 0 : Math.max(1, Math.round(st.npcCap * (0.08 + c.martial * 0.12)));
  const role = i === 0 ? 'elder' : i <= guards ? 'guard' : i % 7 === 3 ? 'trader' : null;
  const p = {
    id, i, name: c.lang.word(hash(st.seed, i, 5)), role, t, age: 16 + Math.floor(r() * 50),
    opinion: 0, mood: 0.2, mem: [], kin: [], friends: [], gen: 0, alive: true,
    needs: { food: 0.7 + r() * 0.3, water: 0.7 + r() * 0.3, air: 1, warmth: 1, safety: 1, rest: 0.6 + r() * 0.4 },
  };
  // kin and friends inside the settlement: who they care about (and hear news from first)
  const n = st.npcCap; if (n > 1) { p.kin.push(`${st.key}#${(i + 1 + Math.floor(r() * 2)) % n}`); p.friends.push(`${st.key}#${Math.floor(r() * n)}`); }
  if (saved) Object.assign(p, saved);
  return p;
}
// only what changed is saved (small)
export const savedFields = (p) => ({ opinion: +p.opinion.toFixed(3), mood: +p.mood.toFixed(2), mem: p.mem, t: p.t, gen: p.gen, age: p.age, alive: p.alive, name: p.name, role: p.role });

// ------------------------------------------------------------------ memory and learning
// remember something; strong memories push out weak ones (8 slots, fading with time)
export function remember(p, day, what, w, about = 'you') { p.mem.push({ d: Math.round(day * 10) / 10, what, w, about }); p.mem.sort((a, b) => Math.abs(b.w) - Math.abs(a.w)); if (p.mem.length > 8) p.mem.length = 8; }
// learn from an experience with the player: the more stubborn, the slower the opinion moves
export function experience(p, day, what, signal, strength = 1) {
  const lr = 0.35 * strength * (1.2 - p.t.stubborn);
  p.opinion = clamp(p.opinion + (signal - p.opinion) * lr, -1, 1);
  p.mood = clamp(p.mood + signal * 0.2 * strength, -1, 1);
  remember(p, day, what, signal * strength);
}
// gossip: the speaker's strongest memory of the player travels, softened, to the listener
export function gossip(a, b, day) {
  const m = a.mem.find((x) => x.about === 'you' && !x.heard); if (!m) return false;
  if (b.mem.some((x) => x.what === m.what)) return false;
  const trust = b.friends.includes(a.id) || b.kin.includes(a.id) ? 0.6 : 0.3;
  b.opinion = clamp(b.opinion + (Math.sign(m.w) - b.opinion) * 0.15 * trust * (1.2 - b.t.stubborn), -1, 1);
  remember(b, day, m.what, m.w * 0.5, 'you'); b.mem[b.mem.findIndex((x) => x.what === m.what)].heard = a.name;
  return true;
}

// ------------------------------------------------------------------ choosing what to do
// ctx: { night, cold (0..1), air (1 = breathable for them), threat (0..1), threatIsPlayer, hostile, playerNear, market }
export function choose(p, ctx) {
  const N = p.needs, t = p.t, m = ctx.market;
  const short = m ? shortage(m) : { good: 'food', ratio: 1 };
  const S = {
    eat: (1 - N.food) * 2.2 * (m && m.stock.food > 0.5 ? 1 : 0.2),
    drink: (1 - N.water) * 2.4 * (m && m.stock.water > 0.5 ? 1 : 0.2),
    warm: (1 - N.warmth) * 1.6,
    sleep: ctx.night * (1.1 - N.rest) * 1.4 + (1 - N.rest) * 0.5,
    work: 0.35 + t.diligent * 0.5 + Math.min(1, short.ratio / 4) * 0.4 - ctx.night * 0.5,
    trade: p.role === 'trader' ? 0.7 : t.greedy * 0.3,
    social: 0.25 + (1 - t.diligent) * 0.25,
    flee: ctx.threat * (1.4 - t.bold) * 2 * (p.role === 'guard' ? 0.2 : 1),
    defend: ctx.threat * (p.role === 'guard' ? 2.2 : t.bold * t.temper * 1.4) * (ctx.hostile ? 1 : 0.3),
    meet: ctx.playerNear && !ctx.hostile ? t.curious * 0.7 + Math.max(0, p.opinion) * 0.5 - (ctx.night ? 0.3 : 0) : 0,
  };
  let best = 'work', bv = -1; for (const k in S) if (S[k] > bv) { bv = S[k]; best = k; }
  p.goal = best === 'work' ? (p.role && p.role !== 'elder' ? p.role : ROLE_OF[short.good] || 'farmer') : best;
  p.workGood = short.good;
  return best;
}
// needs drift with time and the world: no air for them = no rest, cold = warmth falls
export function liveNeeds(p, days, ctx) {
  const N = p.needs;
  N.food = clamp(N.food - days * 0.9); N.water = clamp(N.water - days * 1.4); N.rest = clamp(N.rest - days * 0.6);
  N.warmth = clamp(N.warmth + (0.4 - ctx.cold) * days * 2); N.air = clamp(ctx.air); N.safety = clamp(1 - ctx.threat);
  const lack = (1 - N.food) + (1 - N.water) + (1 - N.warmth) + (1 - N.air) * 2 + (1 - N.safety);
  p.mood = clamp(p.mood + (0.3 - lack * 0.35 - p.mood) * Math.min(1, days * 4), -1, 1);
}
// doing the action (at the market or the hearth): needs filled from the settlement's real stock
export function satisfy(p, act, m) {
  const N = p.needs;
  if (act === 'eat' && m && m.stock.food >= 0.3) { m.stock.food -= 0.3; N.food = 1; }
  if (act === 'drink' && m && m.stock.water >= 0.3) { m.stock.water -= 0.3; N.water = 1; }
  if (act === 'warm') { if (m && m.stock.wood >= 0.2) m.stock.wood -= 0.2; N.warmth = 1; }
  if (act === 'sleep') N.rest = 1;
}

// ------------------------------------------------------------------ talking
// built from state, never from a quest table
export function speak(p, ctx) {
  const L = [], o = p.opinion, m = ctx.market;
  const mood = p.mood > 0.4 ? 'cheerful' : p.mood < -0.3 ? 'grim' : 'steady';
  if (ctx.hostile) L.push(o < -0.6 ? 'You. I remember you. Walk away while you still can.' : 'Our people have no welcome for you. Go.');
  else if (o > 0.5) L.push(`${p.name}! Good to see you again.`);
  else if (o < -0.3) L.push(`${p.name} looks at you warily. "What do you want?"`);
  else L.push(`"I am ${p.name}${p.role ? ', ' + p.role : ''} of ${ctx.place}." ${mood === 'grim' ? 'They look worn down.' : ''}`.trim());
  // what is on their mind: their worst need, their goal, what their place lacks
  const N = p.needs, worst = Object.entries(N).sort((a, b) => a[1] - b[1])[0];
  if (worst[1] < 0.35) L.push({ food: 'We have not eaten properly in days.', water: 'The water is running short. My throat is dust.', warmth: 'The cold gets into the bones here. We are burning the last of the wood.', air: 'The air is thin today. Every step costs.', safety: 'Something is out there. I do not feel safe.', rest: 'I have barely slept.' }[worst[0]]);
  if (m) { const s = shortage(m); if (s.ratio > 2.2) L.push(`We are short of ${GOOD_LABEL[s.good]}. It costs ${price(m, s.good)} here now. Bring some and you will be paid well.`); }
  // a memory of the player, or something heard
  const mem = p.mem.find((x) => x.about === 'you');
  if (mem) L.push(mem.heard ? `${mem.heard} told me you ${mem.what}.` : `I remember when you ${mem.what}.`);
  // relations with other peoples
  if (ctx.enemy) L.push(`The ${ctx.enemy} want our land. ${p.t.temper > 0.6 ? 'Let them come.' : 'I hope it does not come to blood.'}`);
  else if (ctx.friend && p.t.curious > 0.5) L.push(`We trade with the ${ctx.friend}. ${p.t.greedy > 0.6 ? 'They drive a hard bargain.' : 'Good people.'}`);
  // the past, told the way their people tell it
  if (ctx.story && (p.role === 'elder' || p.t.curious > 0.55)) L.push(`${p.role === 'elder' ? 'The old songs say' : 'They say'}: ${ctx.story}`);
  return L.filter(Boolean).slice(0, 4);
}

// ------------------------------------------------------------------ generations
// people age; when one dies, their strongest memory of the player becomes a family story, and a child
// is born with a blend of the parents' temperament plus a small mutation
export function ageing(people, years, day, rr) {
  const born = [];
  for (const p of people) {
    if (!p.alive) continue;
    p.age += years;
    if (p.age > 60 + p.t.diligent * 15 && rr() < (p.age - 60) / 40 * years) {
      p.alive = false; const kin = people.find((q) => p.kin.includes(q.id) && q.alive);
      const m = p.mem.find((x) => x.about === 'you');
      if (kin && m) remember(kin, day, `${m.what} (so ${p.name} told us, before the end)`, m.w * 0.6);
      born.push(p);
    }
  }
  for (const dead of born) { // a newborn takes the place, heir to the family temperament
    const parent = people.find((q) => dead.kin.includes(q.id) && q.alive) || dead;
    dead.alive = true; dead.age = 0; dead.gen += 1; dead.mem = dead.mem.filter((x) => x.what.includes('told us')).slice(0, 2); dead.opinion = parent.opinion * 0.5;
    for (const k of TRAITS) dead.t[k] = clamp((dead.t[k] + parent.t[k]) / 2 + (rr() - 0.5) * 0.15);
    dead.name = dead.name.split(' ')[0] + (dead.gen > 0 ? ` ${['the younger', 'the third', 'of the new line'][Math.min(2, dead.gen - 1)]}` : '');
  }
  return born.length;
}
