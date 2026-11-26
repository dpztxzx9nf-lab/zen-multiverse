// Living worlds: the runtime. Ties the deep-time history, the far simulation (ecosystems, markets,
// politics) and the near simulation (individual people and animals) to one planet, and keeps going
// while the player is away (at low resolution, capped). Player actions feed back into the same model:
// trade moves prices, theft spreads by gossip and shifts a whole people's view, scaring animals
// teaches them, hunting pressure empties valleys, and peoples' power rises and falls on its own.
//   const life = createLife({ scene, P, hud, interact, player, game, ground });
//   life.load(W, PK, core); life.species(); life.pickSpecies(x, z, biome); life.update(dt, ctx)
import * as THREE from 'three';
import { rulesOf, describeRules, breathable } from './rules.js';
import { worldHistory, provinceHistory, PROV, N, CELL, TECH } from './history.js';
import { renderSpecies, makeEco, stepEco, localAbundance } from './eco.js';
import { makeMarket, stepMarket, tradeBetween, price, GOODS, GOOD_LABEL, itemOf } from './economy.js';
import { person, savedFields, experience, gossip, choose, liveNeeds, satisfy, speak, ageing, remember } from './mind.js';
import { createLifeRender } from './render.js';
import { rng, hash } from '../names.js';

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const DAY_S = 600;              // one game day = 10 real minutes while playing
const AWAY_H_PER_DAY = 1;       // while away: one game day per real hour
const AWAY_CAP = 120;           // at most this many days are caught up on a visit
const fmtAge = (y, my) => (my ? (y >= 1000 ? `${(y / 1000).toFixed(1)} billion years ago` : `${y} million years ago`) : y <= 0 ? 'in living memory' : `${y} years ago`);

export function createLife({ scene, P, hud, interact, player, game, ground, lite }) {
  const gfx = createLifeRender(scene, { lite, shadows: !lite && P.cls === 'pc' });
  const NPC_R = lite ? 95 : 150, BUILD_R = lite ? 650 : 1000;
  let W = null, R = null, WH = null, RS = [], PK = null, Wd = null, provs = new Map(), agents = [], day = 0, clock = 0;
  const G = () => game.data;
  const pkey = (px, pz) => px + ',' + pz;

  // ------------------------------------------------------------ provinces: made on demand (no edge)
  function province(px, pz) {
    const k = pkey(px, pz); let pr = provs.get(k); if (pr) return pr;
    const H = provinceHistory(W, R, WH, px, pz);
    pr = { key: k, H, settlements: [], polities: new Map(), eco: null };
    const sv = Wd.prov[k] || null;
    for (const Pl of H.polities) {
      if (!Pl.alive) continue; pr.polities.set(Pl.id, Pl);
      if (sv && sv.rel && sv.rel[Pl.id]) Pl.rel = sv.rel[Pl.id];
      for (const s of Pl.settlements) {
        const key = `${k}/${s.k}`, cell = H.cells[s.k];
        const people = s.tier === 'camp' ? 6 + Pl.pop * 8 : s.tier === 'village' ? 20 + Pl.pop * 40 : s.tier === 'sealed' ? 30 + Pl.pop * 40 : 120 + Pl.pop * 200;
        const st = { ...s, key, seed: hash(H.seed, s.k), polity: Pl.id, pkey: k, sea: W.hasSea ? W.sea : null, npcCap: Math.min(lite ? 9 : 18, Math.round(people / (s.tier === 'city' ? 8 : 3))) };
        st.market = makeMarket(cell, Pl, people, R);
        if (sv && sv.m && sv.m[s.k]) { Object.assign(st.market.stock, sv.m[s.k].stock); st.market.people = sv.m[s.k].people; }
        st.people = []; for (let i = 0; i < st.npcCap; i++) st.people.push(person(st, Pl, i, Wd.ppl[`${key}#${i}`]));
        pr.settlements.push(st);
      }
    }
    pr.ruins = H.ruins.map((ru) => { const cap = ru.cells.find((k2) => H.cells[k2].ruin && H.cells[k2].ruin.capital) ?? ru.cells[0]; const c = H.cells[cap]; return { ...ru, x: c.x, z: c.z, k: cap, seed: hash(H.seed, cap, 3), sea: W.hasSea ? W.sea : null, place: c.ruin ? c.ruin.place : ru.name }; }).filter((ru) => ru.x != null);
    pr.eco = RS.length ? makeEco(W, R, WH, H, RS) : null;
    if (pr.eco && sv && sv.eco) { sv.eco.forEach((arr, s) => { if (pr.eco.pop[s] && arr) for (let i = 0; i < arr.length; i++) pr.eco.pop[s][i] = arr[i] / 255; }); if (sv.wary) pr.eco.wary.set(sv.wary.slice(0, pr.eco.wary.length)); }
    provs.set(k, pr);
    // a first visit: let the present settle for a few days so markets and herds are not 'factory fresh'
    if (!sv) for (let i = 0; i < 6; i++) stepProvince(pr, 2);
    return pr;
  }
  const around = (x, z, r = 1) => { const px = Math.floor(x / PROV), pz = Math.floor(z / PROV), o = []; for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) { const pr = provs.get(pkey(px + i, pz + j)); if (pr) o.push(pr); } return o; };
  function ensureAround(x, z, budget = 1) { const px = Math.floor(x / PROV), pz = Math.floor(z / PROV); let made = 0; for (const [i, j] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) { if (!provs.has(pkey(px + i, pz + j))) { province(px + i, pz + j); if (++made >= budget) return; } } }

  // ------------------------------------------------------------ the far simulation (present day)
  function stepProvince(pr, days) {
    if (pr.eco) stepEco(pr.eco, days, pr.settlements);
    for (const st of pr.settlements) {
      const Pl = pr.polities.get(st.polity);
      const war = Pl && Object.entries(Pl.rel || {}).some(([, v]) => v < -0.5);
      stepMarket(st.market, days, war ? 0.15 : 0);
    }
    // caravans between friendly neighbours; relations drift with need and temperament
    for (const a of pr.settlements) for (const b of pr.settlements) {
      if (a.key >= b.key) continue; const A = pr.polities.get(a.polity), B = pr.polities.get(b.polity);
      if (Math.hypot(a.x - b.x, a.z - b.z) > 900) continue;
      if (A === B) { tradeBetween(a.market, b.market, days); continue; }
      const v = (A.rel[B.id] || 0);
      if (v > -0.2) tradeBetween(a.market, b.market, days * (0.5 + v));
      const hungry = a.market.stock.food < a.market.people * 0.2 || b.market.stock.food < b.market.people * 0.2;
      const nv = clamp(v + days * ((A.culture.open + B.culture.open - 1) * 0.01 - (hungry ? 0.02 : 0) - (A.culture.martial + B.culture.martial - 1) * 0.008), -1, 1);
      A.rel[B.id] = B.rel[A.id] = nv;
      if (v >= -0.5 && nv < -0.5) chron(`War broke out between the ${A.name} and the ${B.name}${hungry ? ', over food' : ''}.`);
      if (v < -0.5 && nv >= -0.5) chron(`The ${A.name} and the ${B.name} made peace.`);
      if (nv < -0.5) { const [w, l] = a.market.people * (1 + A.tech) * (0.5 + A.culture.martial) > b.market.people * (1 + B.tech) * (0.5 + B.culture.martial) ? [a, b] : [b, a]; l.market.people *= 1 - 0.01 * days; w.market.people *= 1 - 0.003 * days; }
    }
    // generations of people (a year is 365 game days; slices of a year age everyone a little)
    pr.ageT = (pr.ageT || 0) + days;
    if (pr.ageT > 30) { const yrs = pr.ageT / 365; pr.ageT = 0; const rr = rng(hash(pr.H.seed, Math.floor(day))); for (const st of pr.settlements) { const n = ageing(st.people, yrs, day, rr); if (n) dirtyPeople(st); } }
  }
  function chron(text) { Wd.chron.push({ day: Math.round(day), text }); if (Wd.chron.length > 40) Wd.chron.shift(); }

  // ------------------------------------------------------------ the player's standing
  const repKey = (pr, Pl) => `${pr.key}:${Pl.id}`;
  const rep = (pr, Pl) => Wd.rep[repKey(pr, Pl)] || 0;
  function shiftRep(pr, Pl, d, why) {
    const k = repKey(pr, Pl); Wd.rep[k] = clamp((Wd.rep[k] || 0) + d, -1, 1);
    // word travels: allies feel some of it, enemies of the wronged feel the opposite
    for (const Q of pr.polities.values()) if (Q !== Pl) { const rel = Pl.rel[Q.id] || 0; if (Math.abs(rel) > 0.35) { const kq = repKey(pr, Q); Wd.rep[kq] = clamp((Wd.rep[kq] || 0) + d * rel * 0.4, -1, 1); } }
    if (Math.abs(d) >= 0.15 && why) chron(`The ${Pl.name} ${d > 0 ? 'speak well of you' : 'turned against you'}: you ${why}.`);
    save();
  }
  const dirty = new Set();
  function dirtyPeople(st) { for (const p of st.people) dirty.add(p); }

  // ------------------------------------------------------------ near simulation: individuals
  function spawnAgents(px, pz) {
    const want = new Set();
    for (const pr of around(px, pz)) for (const st of pr.settlements) if (Math.hypot(st.x - px, st.z - pz) < NPC_R) want.add(st.key);
    agents = agents.filter((a) => { if (want.has(a.st.key)) return true; interact.remove('npc-' + a.p.id); dirty.add(a.p); return false; });
    const have = new Set(agents.map((a) => a.st.key));
    for (const pr of around(px, pz)) for (const st of pr.settlements) {
      if (!want.has(st.key) || have.has(st.key)) continue;
      const Pl = pr.polities.get(st.polity), r = rng(hash(st.seed, 0xa9));
      const sp = WH.sapient, h = clamp(sp.size * 1.3, 0.9, 2.6) * (st.tier === 'sealed' ? 1 : 1), wide = clamp(1.1 * Math.pow(R.g / 9.81, 0.5), 0.8, 1.5) * h * 0.55;
      const skin = new THREE.Color().setHSL((Pl.culture.hue + 0.5) % 1, 0.18, 0.42 + sp.g.insulation * 0.2).getHex();
      for (const p of st.people) {
        if (!p.alive) continue;
        const a0 = r() * 6.283, d0 = 3 + r() * 14;
        const x = st.x + Math.cos(a0) * d0, z = st.z + Math.sin(a0) * d0;
        const ag = { p, st, pr, Pl, x, z, y: ground(x, z), heading: r() * 6.28, tx: x, tz: z, home: { x, z }, act: 'work', think: r() * 3, phase: r() * 6,
          h: h * (p.age < 14 ? 0.6 : 1) * (0.92 + r() * 0.16), wide, skin, cloth: new THREE.Color().setHSL(Pl.culture.hue + (r() - 0.5) * 0.06, 0.35 + (p.role === 'guard' ? 0.2 : 0), p.role === 'elder' ? 0.6 : 0.3 + r() * 0.15).getHex(), moving: false };
        agents.push(ag);
        interact.add({ id: 'npc-' + p.id, at: () => ({ x: ag.x, y: ag.y + ag.h * 0.8, z: ag.z }), r: 2.4, gazeR: 0.6, gazeH: ag.h, priority: 0.6,
          actions: () => npcActions(ag) });
      }
      interact.add({ id: 'mkt-' + st.key, at: () => ({ x: st.x, y: ground(st.x, st.z) + 0.6, z: st.z }), r: 3.2, priority: 0.4, actions: () => marketActions(st, pr, Pl) });
    }
  }
  const workSpot = (st, good) => { const a = (hash(st.seed, good.length * 13) % 628) / 100, d = good === 'water' ? 18 : good === 'food' ? 28 : 40; return { x: st.x + Math.cos(a) * d, z: st.z + Math.sin(a) * d }; };
  function stepAgents(dt, ctxW) {
    const pp = player.position, gd = dt / DAY_S;
    for (const ag of agents) {
      const { p, st, pr, Pl } = ag; const m = st.market;
      const dP = Math.hypot(pp.x - ag.x, pp.z - ag.z);
      const hostile = rep(pr, Pl) < -0.35 || p.opinion < -0.6;
      // threats: a hostile player nearby, or a big hunter animal
      let threat = hostile && dP < 25 ? 1 - dP / 25 : 0, from = threat ? pp : null;
      for (const an of ctxW.animals || []) if (an.S.diet >= 0.6 && an.S.size > 0.8) { const d = Math.hypot(an.root.position.x - ag.x, an.root.position.z - ag.z); if (d < 18 && 1 - d / 18 > threat) { threat = 1 - d / 18; from = an.root.position; } }
      const cold = clamp((8 - (m.cell.tempC - ctxW.night * R.swing * 0.3)) / 30);
      const air = breathable(R) || WH.sapient ? 1 : 0.3; // natives breathe their own air
      liveNeeds(p, gd, { cold, air, threat });
      ag.think -= dt;
      if (ag.think <= 0 || (threat > 0.4 && ag.act !== 'flee' && ag.act !== 'defend')) {
        ag.think = 2.5 + Math.random() * 3;
        ag.act = choose(p, { night: ctxW.night, threat, hostile, playerNear: dP < 14, market: m });
        let t;
        switch (ag.act) {
          case 'eat': case 'drink': case 'trade': t = { x: st.x + (Math.random() - 0.5) * 4, z: st.z + (Math.random() - 0.5) * 4 }; break;
          case 'sleep': case 'warm': t = ag.home; break;
          case 'work': t = workSpot(st, p.workGood || 'food'); t = { x: t.x + (Math.random() - 0.5) * 8, z: t.z + (Math.random() - 0.5) * 8 }; break;
          case 'flee': t = from ? { x: ag.x - (from.x - ag.x) * 1.5, z: ag.z - (from.z - ag.z) * 1.5 } : ag.home; break;
          case 'defend': t = from ? { x: from.x + (ag.x - from.x) * 0.25, z: from.z + (ag.z - from.z) * 0.25 } : { x: st.x, z: st.z }; break;
          case 'meet': t = { x: pp.x + (ag.x - pp.x) / (dP || 1) * 2.4, z: pp.z + (ag.z - pp.z) / (dP || 1) * 2.4 }; break;
          case 'social': { const f = agents.find((o) => p.friends.includes(o.p.id) || p.kin.includes(o.p.id)); t = f ? { x: f.x + 1, z: f.z } : { x: st.x, z: st.z }; if (f && Math.hypot(f.x - ag.x, f.z - ag.z) < 3 && gossip(p, f.p, day)) dirty.add(f.p); break; }
          default: t = ag.home;
        }
        ag.tx = t.x; ag.tz = t.z;
      }
      // move
      const ex = ag.tx - ag.x, ez = ag.tz - ag.z, d = Math.hypot(ex, ez);
      const sp = (ag.act === 'flee' ? 3.2 : ag.act === 'defend' ? 2.4 : 1.25) * Math.sqrt(9.81 / R.g) ** 0.5;
      ag.moving = d > 0.6 && ag.act !== 'sleep';
      if (ag.moving) { const want = Math.atan2(ex, ez); let dh = want - ag.heading; dh = Math.atan2(Math.sin(dh), Math.cos(dh)); ag.heading += dh * Math.min(1, dt * 4); const nx = ag.x + Math.sin(ag.heading) * sp * dt, nz = ag.z + Math.cos(ag.heading) * sp * dt; const ny = ground(nx, nz); if (!(st.sea != null && ny < st.sea + 0.2)) { ag.x = nx; ag.z = nz; ag.y = ny; } else ag.tx = ag.x; }
      else { satisfy(p, ag.act, m); if (ag.act === 'meet' || dP < 4) { let dh = Math.atan2(pp.x - ag.x, pp.z - ag.z) - ag.heading; dh = Math.atan2(Math.sin(dh), Math.cos(dh)); ag.heading += dh * Math.min(1, dt * 3); } }
      // guards hold a line: a hostile player is pushed back from the settlement
      if (ag.act === 'defend' && hostile && dP < 2.2 && player.teleport) { const k = 2.2 / (dP || 1); player.teleport(ag.x + (pp.x - ag.x) * k * 1.4, ag.z + (pp.z - ag.z) * k * 1.4, player.heading); if (!ag.warned) { ag.warned = 1; hud.toast(`${p.name} shoves you back`, 'star', 2200); } }
      if (ag.act === 'sleep' && !ag.moving) ag.y = ground(ag.x, ag.z) - ag.h * 0.6; // lying down (inside)
    }
  }

  // ------------------------------------------------------------ what the player can do
  const placeOf = (st) => st.name + (st.tier === 'city' ? ' (city)' : st.tier === 'camp' ? ' (camp)' : '');
  function storyFor(pr, Pl) {
    const mine = pr.H.chronicle.filter((c) => c.text.includes(Pl.name) || c.kind === 'air' || c.kind === 'fall');
    const pool = mine.length ? mine : WH.chronicle;
    if (!pool.length) return null;
    const c = pool[Math.floor(clock / 7) % pool.length];
    return `${fmtAge(c.age, pool === WH.chronicle && !c.yrs)}, ${c.text[0].toLowerCase() + c.text.slice(1)}`;
  }
  function npcActions(ag) {
    const { p, st, pr, Pl } = ag, hostile = rep(pr, Pl) < -0.35 || p.opinion < -0.6, acts = [];
    acts.push({ label: `Talk to ${p.name}`, icon: 'star', run: async () => {
      const rel = Object.entries(Pl.rel || {}), en = rel.find(([, v]) => v < -0.5), fr = rel.find(([, v]) => v > 0.4);
      const name = (id) => (pr.polities.get(+id) || {}).name;
      const lines = speak(p, { hostile, market: st.market, place: placeOf(st), enemy: en && name(en[0]), friend: fr && name(fr[0]), story: storyFor(pr, Pl) });
      if (!p.metYou) { p.metYou = 1; remember(p, day, 'came to talk with us', 0.05); dirty.add(p); }
      await hud.say(`${p.name} · ${Pl.name}`, lines);
    } });
    const N = p.needs, need = N.food < 0.45 && game.count('food') > 0 ? 'food' : N.water < 0.45 && game.count('water') > 0 ? 'water' : null;
    if (need && !hostile) acts.unshift({ label: `Give ${p.name} ${need}`, icon: 'leaf', run: async () => {
      if (!game.take(need, 1)) return; N[need] = 1; experience(p, day, `shared your ${need} when I was in need`, 1, 0.9); dirty.add(p);
      shiftRep(pr, Pl, 0.04 + p.t.kind * 0.03); hud.toast(`${p.name} won't forget that`, 'leaf');
    } });
    else if (!hostile) acts.push({ label: 'Trade', icon: 'map', run: async () => openTrade(st, pr, Pl, p) });
    return acts.slice(0, 2);
  }
  function marketActions(st, pr, Pl) {
    const hostile = rep(pr, Pl) < -0.35;
    const acts = [];
    if (!hostile) acts.push({ label: `Trade at ${st.name}`, icon: 'map', run: async () => openTrade(st, pr, Pl, null) });
    const g = ['food', 'water', 'metal', 'cloth'].find((k) => st.market.stock[k] >= 1);
    if (g) acts.push({ label: `Take ${GOOD_LABEL[g]} from the stores`, icon: 'leaf', run: async () => {
      st.market.stock[g] -= 1; game.add(itemOf(g), 1);
      const pp = player.position; const seen = agents.filter((a) => a.st === st && Math.hypot(a.x - pp.x, a.z - pp.z) < 18 && a.act !== 'sleep');
      if (seen.length) { for (const a of seen) { experience(a.p, day, `stole ${GOOD_LABEL[g]} from our stores`, -1, 1); dirty.add(a.p); } shiftRep(pr, Pl, -0.08 - 0.03 * seen.length, `stole from ${st.name}`); hud.toast(`${seen[0].p.name} saw that`, 'star'); }
      else hud.toast('Nobody saw', 'leaf');
    } });
    return acts;
  }
  function openTrade(st, pr, Pl, who) {
    const m = st.market; Wd.credit = Wd.credit || {};
    const disc = () => 1 - clamp(rep(pr, Pl) * 0.15 + (who ? who.opinion * 0.1 : 0), -0.3, 0.25); // friends get better deals
    const render = (body) => {
      const cr = Wd.credit[st.key] || 0;
      body.innerHTML = `<p class="muted">${Pl.name}: ${Pl.desc}. ${TECH[Math.floor(Pl.tech)]}. Prices follow what ${st.name} has and lacks right now.</p><h3>Your credit here: ${cr.toFixed(1)}</h3>` +
        Object.keys(GOODS).map((g) => { const pBuy = +(price(m, g) * disc() * 1.15).toFixed(1), pSell = +(price(m, g) * 0.85 / disc()).toFixed(1); return `<div class="row"><span class="grow">${GOOD_LABEL[g]} <span class="muted">· they have ${Math.floor(m.stock[g])} · you ${game.count(itemOf(g))}</span></span><button class="b" data-s="${g}" ${game.count(itemOf(g)) ? '' : 'disabled'}>Sell ${pSell}</button><button class="b" data-b="${g}" ${cr >= pBuy && m.stock[g] >= 1 ? '' : 'disabled'}>Buy ${pBuy}</button></div>`; }).join('');
      body.querySelectorAll('button[data-s]').forEach((b) => b.onclick = () => { const g = b.dataset.s; if (!game.take(itemOf(g), 1)) return; const v = price(m, g) * 0.85 / disc(); m.stock[g] += 1; Wd.credit[st.key] = (Wd.credit[st.key] || 0) + v; if (who) { who.opinion = clamp(who.opinion + 0.02, -1, 1); dirty.add(who); } shiftRep(pr, Pl, 0.005); render(body); });
      body.querySelectorAll('button[data-b]').forEach((b) => b.onclick = () => { const g = b.dataset.b; const v = price(m, g) * disc() * 1.15; if ((Wd.credit[st.key] || 0) < v || m.stock[g] < 1) return; m.stock[g] -= 1; Wd.credit[st.key] -= v; game.add(itemOf(g), 1); render(body); });
    };
    hud.openPanel([{ id: 'trade', label: placeOf(st), icon: 'map', render }], 'trade');
  }

  // ------------------------------------------------------------ ruins: the stone that remembers
  let ruinIds = [];
  function registerRuins() {
    for (const id of ruinIds) interact.remove(id); ruinIds = [];
    for (const pr of provs.values()) for (const ru of pr.ruins) {
      const id = `lore-${pr.key}-${ru.k}`; ruinIds.push(id);
      interact.add({ id, at: () => ({ x: ru.x + 2, y: ground(ru.x + 2, ru.z) + 1.3, z: ru.z }), r: 2.6, priority: 0.5, actions: () => [{ label: `Read the carvings of ${ru.place}`, icon: 'stone', run: async () => {
        const lines = pr.H.chronicle.filter((c) => c.text.includes(ru.name) && c.kind !== 'fall').map((c) => `${fmtAge(c.age)}: ${c.text}`).slice(-3);
        lines.push(`The carvings end ${fmtAge(ru.age)}. They fell ${ru.why}.`);
        if (WH.airLoss && ru.why.includes('air')) lines.push(`(The world's air: ${WH.airLoss.cause}.)`);
        G().journal.lore = G().journal.lore || {}; G().journal.lore[`${PK}:${pr.key}:${ru.k}`] = { name: ru.name, place: ru.place, why: ru.why }; game.save();
        await hud.say(`${ru.place}, ruins of the ${ru.name}`, lines);
      } }] });
    }
  }

  // ------------------------------------------------------------ animals (fed by the far ecosystem)
  function cellAt(x, z) { const pr = provs.get(pkey(Math.floor(x / PROV), Math.floor(z / PROV))); if (!pr) return null; const i = clamp(Math.floor((x - Math.floor(x / PROV) * PROV) / CELL), 0, N - 1), j = clamp(Math.floor((z - Math.floor(z / PROV) * PROV) / CELL), 0, N - 1); return { pr, k: j * N + i }; }
  function pickSpecies(x, z, biome) {
    const c = cellAt(x, z); if (!c || !c.pr.eco) return RS.length ? RS[0] : null;
    const w = RS.map((S, s) => localAbundance(c.pr.eco, s, c.k) * (S.biomes.includes(biome) ? 1 : 0.35)); const sum = w.reduce((a, b) => a + b, 0);
    if (sum < 0.05 || Math.random() > sum * 2.5) return null; // sparse land: fewer animals, really
    let u = Math.random() * sum; for (let s = 0; s < RS.length; s++) { u -= w[s]; if (u <= 0) return RS[s]; } return RS[0];
  }
  // predators hunt what is near; prey run from them; startled herds teach their kind
  function stepAnimals(animals, dt, removeAnimal) {
    const pp = player.position;
    for (const a of animals) {
      const S = a.S; if (S.diet == null) continue;
      const c = cellAt(a.root.position.x, a.root.position.z); const E = c && c.pr.eco, s = RS.indexOf(S);
      if (E && s >= 0) S.shy = S.baseShy * (1 + E.wary[s] * 2.5);
      if (a.state === 'flee' && !a._learned && Math.hypot(pp.x - a.root.position.x, pp.z - a.root.position.z) < S.shy * 1.6 && E && s >= 0) { a._learned = 1; E.wary[s] = clamp(E.wary[s] + 0.03); }
      if (a.state !== 'flee') a._learned = 0;
      if (S.diet >= 0.6 && a.state !== 'rest') {
        let prey = null, bd = 30; for (const b of animals) if (b !== a && b.S.diet < 0.6 && b.S.size < S.size * 1.4) { const d = Math.hypot(b.root.position.x - a.root.position.x, b.root.position.z - a.root.position.z); if (d < bd) { bd = d; prey = b; } }
        if (prey) {
          a.state = 'flee'; a.timer = 2; a.tx = prey.root.position.x; a.tz = prey.root.position.z; a.note = 'hunt';  // 'flee' = run speed
          if (bd < 12 && prey.state !== 'flee') { const dx = prey.root.position.x - a.root.position.x, dz = prey.root.position.z - a.root.position.z; prey.state = 'flee'; prey.timer = 3; prey.tx = prey.root.position.x + dx / bd * 16; prey.tz = prey.root.position.z + dz / bd * 16; prey.note = 'flee'; }
          if (bd < 1.2 * S.size + 0.5) { removeAnimal(prey); const ce = cellAt(prey.root.position.x, prey.root.position.z); const ps = RS.indexOf(prey.S); if (ce && ce.pr.eco && ps >= 0) ce.pr.eco.pop[ps][ce.k] = Math.max(0, ce.pr.eco.pop[ps][ce.k] - 0.02); a.state = 'rest'; a.timer = 20; }
        }
      }
    }
  }
  // the player changes the land: felling trees thins the food here (and what lives on it)
  function recordFell(x, z) { const c = cellAt(x, z); if (!c) return; const cell = c.pr.H.cells[c.k]; cell.felled = clamp((cell.felled || 0) + 0.01, 0, 0.9); }

  // ------------------------------------------------------------ load / save / update
  function save() {
    if (!Wd) return;
    for (const p of dirty) Wd.ppl[p.id] = savedFields(p); dirty.clear();
    for (const pr of provs.values()) {
      const o = Wd.prov[pr.key] = Wd.prov[pr.key] || {};
      o.m = {}; for (const st of pr.settlements) o.m[st.k] = { people: +st.market.people.toFixed(1), stock: Object.fromEntries(Object.entries(st.market.stock).map(([k, v]) => [k, +v.toFixed(1)])) };
      o.rel = {}; for (const Pl of pr.polities.values()) o.rel[Pl.id] = Object.fromEntries(Object.entries(Pl.rel).map(([k, v]) => [k, +v.toFixed(2)]));
      if (pr.eco) { o.eco = pr.eco.pop.map((a) => Array.from(a, (v) => Math.round(v * 255))); o.wary = Array.from(pr.eco.wary, (v) => +v.toFixed(3)); }
    }
    Wd.day = day; Wd.last = Date.now(); game.save();
  }
  function load(W0, pk, core) {
    unload();
    W = W0; PK = pk; R = rulesOf(W, core); WH = worldHistory(W, R); RS = renderSpecies(W, R, WH);
    const L = (G().life = G().life || {}); Wd = L[pk] = L[pk] || { day: 0, last: Date.now(), rep: {}, ppl: {}, prov: {}, chron: [], credit: {} };
    day = Wd.day || 0;
    ensureAround(0, 0, 9);
    // time passed while the player was away: the world kept living, coarsely
    const away = Math.min(AWAY_CAP, (Date.now() - (Wd.last || Date.now())) / 3600e3 / AWAY_H_PER_DAY);
    if (away > 0.5) { const steps = Math.min(30, Math.ceil(away / 4)); for (let i = 0; i < steps; i++) { for (const pr of provs.values()) stepProvince(pr, away / steps); day += away / steps; } Wd.awayDays = Math.round(away); }
    registerRuins();
    gfx.clear();
    return { R, WH };
  }
  function unload() { for (const a of agents) interact.remove('npc-' + a.p.id); for (const pr of provs.values()) for (const st of pr.settlements) interact.remove('mkt-' + st.key); for (const id of ruinIds) interact.remove(id); if (Wd) save(); agents = []; provs = new Map(); gfx.clear(); }
  let farT = 0, saveT = 0, spawnT = 0, provCount = 0;
  function update(dt, ctxW) {
    if (!W) return;
    clock += dt; day += dt / DAY_S;
    const pp = player.position;
    ensureAround(pp.x, pp.z, 1);
    if (provs.size !== provCount) { provCount = provs.size; registerRuins(); }
    farT += dt; if (farT > 1) { for (const pr of around(pp.x, pp.z)) stepProvince(pr, farT / DAY_S); farT = 0; }
    spawnT -= dt; if (spawnT <= 0) { spawnT = 1; spawnAgents(pp.x, pp.z); }
    // buildings in range (rebuilt only when the set changes)
    const S = [], Ru = []; for (const pr of around(pp.x, pp.z)) { for (const st of pr.settlements) if (Math.hypot(st.x - pp.x, st.z - pp.z) < BUILD_R) S.push({ st, P: pr.polities.get(st.polity) }); for (const ru of pr.ruins) if (Math.hypot(ru.x - pp.x, ru.z - pp.z) < BUILD_R) Ru.push(ru); }
    gfx.rebuild({ settlements: S, ruins: Ru }, ground, S.map((s) => s.st.key).join('|') + '/' + Ru.map((r) => r.seed).join('|'));
    stepAgents(dt, ctxW);
    if (ctxW.animals) stepAnimals(ctxW.animals, dt, ctxW.removeAnimal);
    gfx.people(agents, ctxW.camera || pp, clock);
    saveT += dt; if (saveT > 20) { saveT = 0; save(); }
  }
  // what the HUD / notes / tests can read
  function info() {
    const pp = player.position, ps = around(pp.x, pp.z);
    return { rules: R && describeRules(R), from: R && R.from, sapient: WH && WH.sapient ? WH.sapient.name : null, species: RS.length, extinct: WH ? WH.extinct.length : 0,
      level: ps.map((p) => p.H.level), settlements: ps.reduce((a, p) => a + p.settlements.length, 0), ruins: ps.reduce((a, p) => a + p.ruins.length, 0), agents: agents.length, day: +day.toFixed(2), awayDays: Wd && Wd.awayDays, chron: Wd ? Wd.chron.slice(-5) : [] };
  }
  function find(kind) {
    for (const pr of [...provs.values()].sort((a, b) => Math.hypot(...a.key.split(',').map(Number)) - Math.hypot(...b.key.split(',').map(Number)))) {
      if (kind === 'ruin' && pr.ruins.length) return pr.ruins[0];
      if (kind !== 'ruin' && kind !== 'eco') { const st = pr.settlements.find((s) => !kind || kind === 'any' || s.tier === kind) || null; if (st) return st; }
      if (kind === 'eco' && pr.eco) { let best = null, bv = 0; for (const c of pr.H.cells) { let v = 0; for (let s = 0; s < RS.length; s++) v += pr.eco.pop[s][c.k]; if (v > bv && !c.owner) { bv = v; best = c; } } if (best) return best; }
    }
    return null;
  }
  // settlements clear the ground they stand on (trees are cut for timber and space)
  function cleared(x, z) {
    for (const pr of provs.values()) for (const st of pr.settlements) { const r = st.tier === 'city' ? 75 : st.tier === 'camp' ? 12 : st.tier === 'sealed' ? 30 : 38; const dx = x - st.x, dz = z - st.z; if (dx * dx + dz * dz < r * r) return true; }
    return false;
  }
  return { load, unload, update, cleared, save, species: () => RS, pickSpecies, recordFell, info, find, get WH() { return WH; }, get R() { return R; }, get provs() { return provs; }, get agents() { return agents; }, gfx, chronicle: () => ({ world: WH ? WH.chronicle : [], recent: Wd ? Wd.chron : [] }) };
}
