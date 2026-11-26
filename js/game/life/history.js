// History by simulation, not by table. From a world's seed and rules this runs a fast, coarse model of
// deep time: lineages of life evolve to fit (or fail to fit) the land; a thinking species may arise;
// its peoples settle, farm, trade, fight, split and fall to plague, climate swings, exhaustion or the
// loss of their air. What the player meets is whatever is left at the end: living peoples, ruins,
// borders, customs, species, and a chronicle of why. Same seed, same past, on every device.
//
//   worldHistory(W, R)              -> { species, extinct, sapient, ceiling, airLoss, events, chronicle }
//   provinceHistory(W, R, WH, px, pz) -> { cells, polities, ruins, chronicle }  (a 2 km region)
// Provinces are made on demand wherever the player goes, so the world has no edge.
import { rng, hash, makeName } from '../names.js';
import { randomGenome, mutate, fitness, prefTemp, describeBody, planOf, makeLanguage, cultureFrom, describeCulture, bodySize } from './traits.js';
import { breathable } from './rules.js';

export const PROV = 2048, N = 16, CELL = PROV / N;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const BIOME_T = { ice: -24, salt: 9, crystal: -5, shore: 3, forest: 0 };
const BIOME_F = { forest: 1, shore: 0.65, salt: 0.06, crystal: 0.18, ice: 0.05 };

// what a patch of ground offers: temperature, plant food, water, wood, stone, ore, salt
export function sampleSite(W, R, x, z) {
  const h = W.height(x, z), w = W.biomesAt(x, z, h);
  const land = !(W.hasSea && h < W.sea + 0.3);
  let t = R.tempC, f = 0;
  for (const k in w) { t += (BIOME_T[k] || 0) * w[k]; f += (BIOME_F[k] || 0) * w[k]; }
  const slope = Math.abs(W.height(x + 12, z) - h) + Math.abs(W.height(x, z + 12) - h);
  const liquid = t > -10 && t < 70;
  const water = clamp((w.shore || 0) * 1.2 + (w.forest || 0) * 0.6 + (liquid ? R.water * 0.4 : 0));
  const food = clamp(f * R.richness * 1.6 * (liquid ? 1 : 0.15) * (1 - slope / 14));
  return { x, z, h, land, tempC: t, o2: R.o2, food, water, wood: clamp((w.forest || 0) * R.richness * 1.5), stone: clamp((w.crystal || 0) + slope / 10), ore: clamp((w.crystal || 0) * 0.9 + slope / 25), salt: clamp((w.salt || 0) + (w.shore || 0) * 0.3), biome: W.dominant(w) };
}

// ------------------------------------------------------------------ deep time (whole world)
const EPOCHS = 36;
export function worldHistory(W, R) {
  const r = rng(hash(W.seed, 0x4157));
  const lang = makeLanguage(hash(W.seed, 9));
  const chronicle = [], events = [];
  const say = (age, text, kind = 'life') => chronicle.push({ age, text, kind });
  // a spread of sites across ~10 km stands in for the planet's range of climates
  const sites = [];
  for (let i = 0; i < 48; i++) { const a = r() * 6.283, d = 300 + r() * 5000; const s = sampleSite(W, R, Math.cos(a) * d, Math.sin(a) * d); if (s.land) sites.push(s); }
  if (!sites.length) sites.push(sampleSite(W, R, 0, 0));
  const ageMy = Math.round(R.ageGyr * 1000);
  // did the air change? small, weakly shielded worlds bleed atmosphere to space over time (Mars).
  // If today's air is poor but the world is old and could once have held more, it was lost.
  let airLoss = null;
  const leaky = R.g < 8.5 || R.magField < 0.35;
  if (!breathable(R) && R.water > 0.2 && R.ageGyr > 2 && leaky && r() < 0.75) airLoss = { epoch: EPOCHS + 1, yearsAgo: Math.round(800 + r() * 3500), pastO2: 0.16 + r() * 0.08, cause: R.magField < 0.35 ? 'the planet\'s magnetic shield failed and the star\'s wind stripped the air away' : 'the world was too small to hold its air, and it thinned into space' };
  const pastR = airLoss ? { ...R, o2: airLoss.pastO2, pressure: Math.max(R.pressure, 0.8), richness: Math.max(R.richness, 0.35 + r() * 0.3) } : R;
  const R_at = (e) => (airLoss && e < airLoss.epoch ? pastR : R);
  if (pastR.richness < 0.03) {
    say(ageMy, R.life === 'plants' ? 'Plants spread over the land, but nothing ever learned to move and eat them.' : R.life === 'microbial' ? 'Microbes live here, in films and mats. Nothing larger ever arose.' : R.tempC < -15 ? 'Too cold for liquid water to stay: nothing ever began here.' : R.radiation > 0.6 ? 'Hard light from the star sterilised every pool before life could start.' : R.water < 0.1 ? 'Bone-dry from the start: life never found a foothold.' : 'Life never began here. The chemistry was there; the luck was not.', 'origin');
    return { species: [], extinct: [], sapient: null, ceiling: 0, airLoss: null, events, chronicle, lang, sites };
  }
  // climate swings: ice ages and hot ages, each a real temperature offset applied to every site
  const climate = new Float32Array(EPOCHS + 1); let cl = 0;
  for (let e = 0; e <= EPOCHS; e++) { if (r() < 0.12) { const d = (r() - 0.5) * 22; cl += d; events.push({ e, kind: d < 0 ? 'cold' : 'heat', d }); } cl *= 0.85; climate[e] = cl; }
  // founders
  let lines = []; let lid = 0;
  const nFound = 2 + Math.floor(pastR.richness * 6 + r() * 2);
  const newLine = (genome, parent, e) => { const id = ++lid; const L = { id, g: genome, pop: new Float32Array(sites.length), born: e, parent: parent ? parent.id : null, name: (parent && r() < 0.5 ? parent.lang : lang).word(hash(W.seed, id, 31)), lang: parent ? parent.lang : makeLanguage(hash(W.seed, id, 5)) }; return L; };
  for (let i = 0; i < nFound; i++) { const L = newLine(randomGenome(r), null, 0); L.g.diet = i === 0 ? 0.1 : L.g.diet; for (let s = 0; s < sites.length; s++) L.pop[s] = 0.2; lines.push(L); }
  say(ageMy, `Life began in the ${R.water > 0.5 ? 'seas' : 'damp low places'}, ${R.biochem === 'carbon-water' ? 'carbon in water as on Earth' : R.biochem + ' chemistry, nothing like Earth'}.`, 'origin');
  const extinct = [];
  const myPerEpoch = Math.max(5, Math.round(ageMy * 0.5 / EPOCHS));
  for (let e = 1; e <= EPOCHS; e++) {
    const Re = R_at(e), when = Math.round(ageMy - (ageMy * 0.5 + e * myPerEpoch) + ageMy * 0.5) ;
    const ago = Math.max(0, (EPOCHS - e) * myPerEpoch);
    // plant-eater biomass at each site feeds the hunters
    const prey = sites.map((_, s) => lines.reduce((a, L) => a + L.pop[s] * (1 - L.g.diet) * (0.4 + L.g.size), 0));
    for (const L of lines) {
      let total = 0;
      for (let s = 0; s < sites.length; s++) {
        const S = sites[s];
        const f = fitness(L.g, Re, { tempC: S.tempC + climate[e], o2: Re.o2, food: S.food * (Re.richness / Math.max(0.01, R.richness)), prey: clamp(prey[s] * 0.8) });
        const grow = (0.5 + L.g.fecundity) * (f - 0.25);
        L.pop[s] = clamp(L.pop[s] + L.pop[s] * grow * (1 - L.pop[s]) + (f > 0.4 ? 0.01 : 0));
        if (L.pop[s] < 0.01) L.pop[s] = 0; total += L.pop[s];
      }
      L.total = total;
      // selection: drift toward the traits that do better where it lives now
      let best = null, bf = -1; const S0 = sites[(L.id * 7 + e) % sites.length];
      for (let k = 0; k < 3; k++) { const g = mutate(L.g, r, 0.12); const f = fitness(g, Re, { tempC: S0.tempC + climate[e], o2: Re.o2, food: S0.food, prey: 0.5 }); if (f > bf) { bf = f; best = g; } }
      if (bf > fitness(L.g, Re, { tempC: S0.tempC + climate[e], o2: Re.o2, food: S0.food, prey: 0.5 })) L.g = best;
      // minds grow where living is social, mixed in diet and the climate keeps changing
      const swingE = Math.abs(climate[e] - climate[Math.max(0, e - 3)]) / 10;
      if (L.g.social > 0.45 && L.g.diet > 0.25 && L.g.diet < 0.8) L.g.cognition = clamp(L.g.cognition + 0.015 + swingE * 0.03 + r() * 0.02);
    }
    // extinctions, with the reason the model actually saw
    for (const L of lines) if (L.total < 0.02 && e - L.born > 1) {
      const S = sites[0]; const why = airLoss && e >= airLoss.epoch && e <= airLoss.epoch + 3 ? 'when the air thinned' : climate[e] < -6 ? 'in a long cold age' : climate[e] > 6 ? 'in a hot, dry age' : L.g.diet > 0.6 ? 'when its prey ran out' : 'outcompeted';
      L.dead = { ago, why }; extinct.push(L); void S;
      if (L.total === 0 || r() < 0.6) say(ago, `The ${describeBody(L.g, Re)} called ${L.name} died out ${why}.`, 'extinct');
    }
    lines = lines.filter((L) => !L.dead);
    // speciation: a widespread lineage splits, the daughter adapted to another part of its range
    if (lines.length < 9 + pastR.richness * 6) for (const L of [...lines]) if (L.total > sites.length * 0.25 && r() < 0.35) {
      const d = newLine(mutate(L.g, r, 0.25), L, e); d.pop.set(L.pop.map((p) => p * 0.5)); lines.push(d);
      if (lines.length > 4 && r() < 0.25) say(ago, `${d.name}, a ${describeBody(d.g, Re)}, branched from the ${L.name}.`, 'life');
    }
    // nothing left: a new start from survivors of the hardiest kind (microbes are not modelled; restart thin)
    if (!lines.length && Re.richness > 0.05 && r() < 0.5) { const L = newLine(randomGenome(r), null, e); L.g.lowAir = 0.9; L.pop.fill(0.05); lines.push(L); say(ago, 'After the dying, hardy small things spread again.', 'life'); }
    void when;
  }
  // a thinking species? the most capable lineage, if its mind crossed the line
  lines.sort((a, b) => b.g.cognition - a.g.cognition);
  let sapient = null;
  const minds = R.civHint ? R.civHint !== 'none' : R.ageGyr > 1.5 && lines.length && lines[0].g.cognition > 0.6 + r() * 0.15 && r() < 0.55;
  if (lines.length && minds) {
    const L = lines[0]; L.sapient = true;
    // natives breathe the air they evolved in, so their limits are the world's, not ours
    const fire = R_at(EPOCHS - 2).o2 >= 0.13;            // fire needs enough oxygen to keep burning
    const farmland = sites.some((s) => s.food > 0.35);
    const ceiling = !fire ? 1 : !farmland ? 2 : 4;        // tech ceiling the world itself allows
    sapient = { line: L, name: L.name, g: L.g, body: describeBody(L.g, R), size: bodySize(L.g, R), fire, ceiling, lang: L.lang };
    say(Math.round(myPerEpoch * 3), `The ${L.name}, a ${describeBody(L.g, R)}, began to think. They learned to ${fire ? 'make fire' : 'shape stone, though fire would never burn in this air'}.`, 'mind');
  }
  // a world the universe marks as ruins had a people who all fell: find the cause in its own conditions
  let doom = null;
  if (sapient && R.civHint === 'ruins') {
    const ya = Math.round(600 + r() * 3500);
    if (airLoss) doom = { kind: 'air', yearsAgo: airLoss.yearsAgo = ya, why: 'when the air failed' };
    else if (R.radiation > 0.5) doom = { kind: 'storm', yearsAgo: ya, why: 'when their star flared and burned the land' };
    else if (R.tempC < 5) doom = { kind: 'cold', yearsAgo: ya, why: 'in the great cold that never lifted' };
    else if (R.water < 0.3) doom = { kind: 'drought', yearsAgo: ya, why: 'when the rains stopped for good' };
    else doom = { kind: 'plague', yearsAgo: ya, why: 'to a plague that took every town' };
    if (doom.kind !== 'air') chronicle.push({ age: ya, yrs: true, kind: 'doom', text: { storm: 'The star flared. Fields and forests burned, and the sky stayed hot for a generation.', cold: 'A cold came that did not lift. The growing season shrank to nothing.', drought: 'The rains failed, and kept failing. The rivers became roads of dust.', plague: 'A sickness came that no one had seen before, and it travelled with the traders.' }[doom.kind] });
  }
  // the air fails in the recent past (after minds arose, so their ruins remember it); in years, not epochs
  if (airLoss) chronicle.push({ age: airLoss.yearsAgo, yrs: true, kind: 'air', text: `The air began to fail: ${airLoss.cause}.` });
  const species = lines.map((L) => ({ id: L.id, name: L.name, g: L.g, body: describeBody(L.g, R), plan: planOf(L.g), size: bodySize(L.g, R), pref: prefTemp(L.g, R), sapient: !!L.sapient, parent: L.parent, lang: L.lang }));
  chronicle.sort((a, b) => (b.yrs ? b.age / 1e6 : b.age) - (a.yrs ? a.age / 1e6 : a.age));
  return { species, extinct: extinct.map((L) => ({ name: L.name, body: describeBody(L.g, R), g: L.g, ...L.dead })), sapient, ceiling: sapient ? sapient.ceiling : 0, airLoss, doom, climate, events, chronicle, lang, sites };
}

// ------------------------------------------------------------------ peoples (one 2 km province)
const STEPS = 40;                     // civilisation steps
export const TECH = ['foragers', 'farmers', 'bronze-workers', 'iron-workers', 'engineers', 'sealed-hall builders'];
// a province is one square of ground: a 2 km sphere tile (in that tile's own frame) or a grid square
export const keyHash = (k) => { let h = 2166136261; for (let i = 0; i < k.length; i++) { h ^= k.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
export function provinceHistory(W, R, WH, { key, ox, oz, size = PROV }) {
  const seed = hash(W.seed, keyHash(String(key)), 0xc1f), cs = size / N;
  const r = rng(seed);
  const cells = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = ox + (i + 0.5) * cs + (r() - 0.5) * cs * 0.5, z = oz + (j + 0.5) * cs + (r() - 0.5) * cs * 0.5;
    const s = sampleSite(W, R, x, z); s.i = i; s.j = j; s.k = cells.length; s.owner = 0; s.depl = 0; s.ruin = null; cells.push(s);
  }
  const chronicle = [], polities = [], ruins = [];
  const out = { key, ox, oz, size, seed, cells, polities, ruins, chronicle, level: 'none' };
  const S = WH.sapient;
  if (!S || R.era === 'primordial') return out;
  const yearsPer = 60 + Math.floor(r() * 90), span = STEPS * yearsPer;
  const ago = (t) => (STEPS - t) * yearsPer;
  const say = (t, text, kind = 'people') => chronicle.push({ age: ago(t), text, kind });
  // air loss lands at a fixed point in this region's recent past (a world event, so every province shares it)
  const lossStep = WH.airLoss ? Math.max(2, Math.min(STEPS - 1, STEPS - Math.round(WH.airLoss.yearsAgo / yearsPer))) : -1;
  const doomStep = WH.doom ? Math.max(2, Math.min(STEPS - 1, STEPS - Math.round(WH.doom.yearsAgo / yearsPer))) : -1;
  const habit = (c, t) => { if (!c.land) return 0; const o2 = lossStep >= 0 && t < lossStep ? WH.airLoss.pastO2 : R.o2; const f = fitness(S.g, R, { tempC: c.tempC + (WH.climate ? WH.climate[Math.min(WH.climate.length - 1, Math.floor(t / 4))] * 0.3 : 0), o2, food: c.food * (1 - c.depl), prey: 0.5 }); return f; };
  // founding: one to four peoples arrive in the best land
  const ranked = cells.filter((c) => c.land).sort((a, b) => habit(b, 0) + b.water * 0.3 - habit(a, 0) - a.water * 0.3);
  const nFound = Math.min(ranked.length, Math.max(0, Math.round((ranked[0] ? habit(ranked[0], 0) : 0) * (1 + r() * 3))));
  let pid = 0;
  const local = (c) => ({ water: c.water, cold: clamp(-c.tempC / 30), hot: clamp((c.tempC - 25) / 20), wood: c.wood, stone: c.stone, moons: (W.sky && W.sky.moons || 0) * 0.3, herds: c.food, salt: c.salt });
  const found = (c, parent, t) => {
    const id = ++pid; const cu = cultureFrom(hash(seed, id), parent ? parent.culture : null, local(c), r);
    if (!parent) cu.lang = makeLanguage(hash(seed, id, 3)), cu.name = cu.lang.word(hash(seed, id, 1));
    const P = { id, culture: cu, name: cu.name, cells: [c.k], pop: parent ? 0.6 : 0.4, tech: parent ? parent.tech : 0, rel: {}, wealth: 0.2, alive: true, born: t, capital: c.k, places: {} };
    c.owner = id; polities.push(P); return P;
  };
  const placeName = (P, c) => P.places[c.k] || (P.places[c.k] = P.culture.lang.word(hash(seed, c.k, 17)));
  for (let i = 0; i < nFound; i++) { const c = ranked[Math.floor(i * ranked.length / Math.max(1, nFound) * 0.3)]; if (c && !c.owner) { const P = found(c, null, 0); say(0, `The ${P.name} people settled at ${placeName(P, c)}.`); } }
  const nb = (c) => [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([a, b]) => cells[(c.j + b) * N + c.i + a]).filter((q) => q && c.i + (q.i - c.i) === q.i && Math.abs(q.i - c.i) + Math.abs(q.j - c.j) === 1);
  const rel = (A, B) => A.rel[B.id] || 0;
  const setRel = (A, B, v) => { A.rel[B.id] = B.rel[A.id] = clamp(v, -1, 1); };
  const fall = (P, t, why) => {
    P.alive = false; P.fell = { age: ago(t), why };
    for (const k of P.cells) { const c = cells[k]; c.owner = 0; c.ruin = { by: P.id, name: P.name, place: placeName(P, c), tech: P.tech, age: ago(t), why, capital: k === P.capital }; }
    ruins.push({ polity: P.id, name: P.name, cells: [...P.cells], tech: P.tech, age: ago(t), why, culture: P.culture });
    say(t, `The ${P.name} ${TECH[Math.floor(P.tech)]} fell ${why}. ${placeName(P, cells[P.capital])} was left empty.`, 'fall');
    P.cells = [];
  };
  for (let t = 1; t <= STEPS; t++) {
    if (t === doomStep && doomStep >= 0) {
      for (const P of polities) if (P.alive) { if (WH.doom.kind === 'air' && P.tech >= 3 && r() < 0.3) { P.sealed = true; P.tech = 5; say(t, `The ${P.name} sealed themselves into halls of stone and glass as the air failed.`, 'tech'); } else fall(P, t, WH.doom.why); }
    }
    if (t === lossStep) say(t, `The air grew thin. Crops failed, fires guttered and the old ones could not breathe on the heights.`, 'air');
    for (const P of polities) {
      if (!P.alive) continue;
      const own = P.cells.map((k) => cells[k]);
      // food: land x farming, minus exhaustion; ore and wood carry the tech
      const farm = 0.5 + Math.min(P.tech, 3) * 0.35;
      let food = 0, ore = 0, wood = 0, hab = 0;
      for (const c of own) { const h = habit(c, t); hab += h; food += c.food * (1 - c.depl) * farm * (0.3 + h); ore += c.ore * (1 - c.depl * 0.5); wood += c.wood * (1 - c.depl); c.depl = clamp(c.depl + P.pop / own.length * 0.012 * (1 + P.tech * 0.3) - 0.006); }
      const need = P.pop * own.length * 0.55;
      P.pop = clamp(P.pop + 0.08 * P.pop * (food / Math.max(0.05, need) - 1), 0, 1.5);
      P.wealth = clamp(P.wealth * 0.9 + (food - need) * 0.05 + ore * 0.02);
      // tech: needs people, contact and the world's permission (fire, metal)
      const contact = polities.filter((Q) => Q.alive && Q !== P && rel(P, Q) > 0.2).length;
      const can = Math.min(WH.ceiling + (P.tech >= 3 && R.pressure < 0.4 ? 1 : 0), ore > 0.4 ? 5 : 2, wood + ore > 0.3 ? 5 : 1);
      if (P.tech < can) { const before = Math.floor(P.tech); P.tech = Math.min(can, P.tech + 0.075 * (P.pop + contact * 0.5) * (0.5 + P.culture.craft)); if (Math.floor(P.tech) > before) say(t, `The ${P.name} became ${TECH[Math.floor(P.tech)]}.`, 'tech'); }
      // grow into neighbouring land
      if (P.pop > 0.7 && r() < 0.5 + P.culture.roam * 0.3) {
        const opts = own.flatMap(nb).filter((q) => q.land && !q.owner && !q.ruinBlock).sort((a, b) => habit(b, t) - habit(a, t));
        if (opts[0] && habit(opts[0], t) > 0.15) { opts[0].owner = P.id; P.cells.push(opts[0].k); P.pop *= 0.85; }
      }
      // splits: a big, loose realm breaks in two (a new people with a drifted culture)
      if (P.cells.length > 6 && r() < 0.06 * (1 - P.culture.kin)) {
        const k = P.cells.splice(Math.floor(P.cells.length / 2)); const Q = found(cells[k[0]], P, t); Q.cells = k; k.forEach((kk) => { cells[kk].owner = Q.id; }); Q.pop = P.pop * 0.7; setRel(P, Q, -0.3);
        say(t, `${placeName(Q, cells[k[0]])} broke away from the ${P.name} and called themselves the ${Q.name}.`, 'split');
      }
      // neighbours: trade if both lean open and have different goods, fight over scarce land
      for (const Q of polities) {
        if (Q === P || !Q.alive || Q.id < P.id) continue;
        const touch = own.some((c) => nb(c).some((q) => q.owner === Q.id)) || Math.hypot(cells[P.capital].i - cells[Q.capital].i, cells[P.capital].j - cells[Q.capital].j) < 6;
        if (!touch) continue;
        const scarce = need > food;
        const v = rel(P, Q) + (P.culture.open + Q.culture.open - 1) * 0.08 - (scarce ? 0.1 : 0) - (P.culture.martial + Q.culture.martial - 1) * 0.05 + (r() - 0.5) * 0.1;
        setRel(P, Q, v);
        if (v > 0.4 && !P.traded?.[Q.id]) { (P.traded = P.traded || {})[Q.id] = 1; say(t, `The ${P.name} and the ${Q.name} opened trade.`, 'trade'); }
        if (v < -0.5) {
          // war: the stronger takes a border cell; both lose people
          const sP = P.pop * (1 + P.tech) * (0.5 + P.culture.martial), sQ = Q.pop * (1 + Q.tech) * (0.5 + Q.culture.martial);
          const [Wn, L] = sP >= sQ ? [P, Q] : [Q, P];
          const take = L.cells.find((k) => nb(cells[k]).some((q) => q.owner === Wn.id));
          P.pop *= 0.85; Q.pop *= 0.85;
          if (take != null && L.cells.length > 1) { L.cells = L.cells.filter((k) => k !== take); cells[take].owner = Wn.id; Wn.cells.push(take); }
          if (!P.war?.[Q.id]) { (P.war = P.war || {})[Q.id] = 1; say(t, `War between the ${P.name} and the ${Q.name}${scarce ? ', over land that could no longer feed them both' : ''}.`, 'war'); }
          if (r() < 0.25) setRel(P, Q, -0.1); // exhaustion brings a truce
        }
      }
      // plague: crowded, connected peoples catch it
      if (P.pop > 0.9 && r() < 0.02 + contact * 0.015) { P.pop *= 0.45; say(t, `A sickness swept the ${P.name}; ${P.pop < 0.3 ? 'few' : 'many'} survived.`, 'plague'); }
      // collapse
      if (hab / own.length < 0.12 && lossStep >= 0 && t >= lossStep) {
        if (P.tech >= 3 && r() < 0.35) { P.sealed = true; P.tech = Math.max(P.tech, 5); if (!P.sealSaid) { P.sealSaid = 1; say(t, `The ${P.name} sealed themselves into halls of stone and glass, breathing air they made.`, 'tech'); } }
        else fall(P, t, 'when the air could no longer keep them');
      } else if (P.pop < 0.08) fall(P, t, lossStep >= 0 && t >= lossStep ? 'as the air thinned and their fields failed' : own.some((c) => c.depl > 0.7) ? 'after they wore out their land' : polities.some((Q) => Q.alive && rel(P, Q) < -0.5) ? 'at the end of a long war' : WH.climate && WH.climate[Math.min(WH.climate.length - 1, Math.floor(t / 4))] < -5 ? 'in a cold age' : 'when their numbers dwindled');
    }
    // a newcomer people occasionally wanders into empty, good land
    if (r() < 0.03 && (doomStep < 0 || t < doomStep)) { const c = ranked.find((q) => !q.owner && habit(q, t) > 0.4); if (c) { const P = found(c, null, t); say(t, `Wanderers who called themselves the ${P.name} came to ${placeName(P, c)}.`); } }
  }
  // seen from another era: in the far future every people here has long since fallen
  if (R.era === 'future') for (const P of polities) if (P.alive) fall(P, STEPS, 'in the long ages after them');
  // present: settlement tier for each owned cell, and the region's overall level
  for (const P of polities) if (P.alive) {
    // a people lives in a few places, not on every field it farms: the capital, then the best
    // land at least three cells from any other settlement (one more place per ~5 cells held)
    if (!P.cells.includes(P.capital)) P.capital = P.cells[0];
    const spots = [P.capital], maxN = P.tech < 1 ? 1 : 1 + Math.floor(P.cells.length / 5);
    for (const k of [...P.cells].sort((a, b) => cells[b].food + cells[b].water - cells[a].food - cells[a].water)) {
      if (spots.length >= maxN) break; const c = cells[k];
      if (spots.every((q) => Math.hypot(cells[q].i - c.i, cells[q].j - c.j) >= 3)) spots.push(k);
    }
    P.settlements = spots.map((k) => { const c = cells[k]; const big = k === P.capital; const tier = P.tech < 1 ? 'camp' : P.tech >= 3 && big ? 'city' : 'village'; return { k, x: c.x, z: c.z, tier: P.sealed ? 'sealed' : tier, name: placeName(P, c), capital: big }; });
    P.desc = describeCulture(P.culture);
  }
  const alive = polities.filter((P) => P.alive);
  out.level = alive.some((P) => P.settlements.some((s) => s.tier === 'city' || s.tier === 'sealed')) ? 'cities' : alive.some((P) => P.tech >= 1) ? 'villages' : alive.length ? 'tribe' : ruins.length ? 'ruins' : 'none';
  out.span = span; out.yearsPer = yearsPer;
  chronicle.sort((a, b) => b.age - a.age);
  return out;
}
export { makeName };
