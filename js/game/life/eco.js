// Ecosystems at two resolutions. Far away: every species is a population number per 128 m cell of a
// province, and once a second those numbers breed, starve, get eaten and walk to better ground
// (logistic growth, predator-prey, diffusion). Near the player: real animals are spawned in proportion
// to the local numbers, so a hunted-out valley really is empty and a boom really is crowded.
// Animals also learn: being chased or startled by the player raises a species' wariness in that
// region, and part of that is passed to the next generation (heritable fear). Quiet, patient visits
// slowly lower it again.
import * as THREE from 'three';
import { fitness, mutate, planOf, bodySize, describeBody, prefTemp } from './traits.js';
import { rng, hash } from '../names.js';
import { N } from './history.js';

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));

// world species -> what the creature renderer needs (camouflage from the ground it prefers)
export function renderSpecies(W, R, WH) {
  return WH.species.filter((s) => !s.sapient).map((s, i) => {
    const r = rng(hash(W.seed, s.id, 0xc0a7));
    const biome = s.pref < R.tempC - 15 ? 'ice' : s.pref > R.tempC + 12 ? 'salt' : s.g.diet > 0.6 ? 'crystal' : 'forest';
    const pal = W.pal[biome] || W.pal.forest;
    const back = pal[1].clone().lerp(new THREE.Color('#3a2e24'), 0.35 + r() * 0.2).multiplyScalar(0.8 + s.g.insulation * 0.3);
    const belly = pal[0].clone().lerp(new THREE.Color('#e8dcc4'), 0.4 + s.g.insulation * 0.3);
    const plan = planOf(s.g);
    const scale = clamp(s.size / 1.3, 0.42, 1.8);
    const biomes = ['forest', 'shore', 'salt', 'crystal', 'ice'].filter((b) => b === biome || r() < 0.4);
    return { i, id: s.id, plan, size: scale, back, belly, alien: R.biochem !== 'carbon-water' ? 1 : 0, lean: 0.9 + s.g.legs * 0.2,
      speed: (plan === 'crawler' ? 0.6 : plan === 'strider' ? 1.2 : 1.0) * (0.7 + s.g.metabolism * 0.6) * Math.sqrt(9.81 / R.g),
      baseShy: 3 + (1 - s.g.size) * 6 + (1 - s.g.diet) * 3, shy: 0, biomes, curious: s.g.cognition > 0.25 && s.g.diet < 0.6, nocturnal: s.g.nocturnal > 0.65,
      name: s.name, label: describeBody(s.g, R), herd: s.g.social > 0.65 ? 2 + Math.round(s.g.social * 4) : s.g.social > 0.35 ? 1 + Math.round(s.g.social * 2) : 1,
      diet: s.g.diet, g: s.g, mats: null };
  });
}

// one province's ecosystem: pop[species][cell]
export function makeEco(W, R, WH, prov, RS) {
  const cells = prov.cells, S = RS.length;
  const pop = RS.map(() => new Float32Array(cells.length));
  const K = RS.map(() => new Float32Array(cells.length));
  const fitAt = (sp, c, prey) => (c.land ? fitness(sp.g, R, { tempC: c.tempC, o2: R.o2, food: c.food * (1 - (c.felled || 0)), prey }) : 0);
  for (let s = 0; s < S; s++) for (const c of cells) { const f = fitAt(RS[s], c, 0.5); K[s][c.k] = f; pop[s][c.k] = f * 0.6; }
  return { pop, K, wary: new Float32Array(S), hunted: new Float32Array(cells.length), fitAt, gen: 0, RS, prov };
}

// one tick of the far simulation (dt in game days)
export function stepEco(E, days, settlements) {
  const { pop, RS, prov } = E, cells = prov.cells, S = RS.length, n = cells.length;
  const herb = new Float32Array(n);
  for (let s = 0; s < S; s++) if (RS[s].diet < 0.6) for (let k = 0; k < n; k++) herb[k] += pop[s][k] * (0.5 + RS[s].g.size);
  // hunting pressure from peoples: a ring around each settlement, stronger where food is dear
  E.hunted.fill(0);
  for (const st of settlements || []) { const c = cells[st.k]; if (!c) continue; const press = 0.02 + (st.market ? Math.min(0.2, (st.market.stock.food < st.market.people ? 0.1 : 0)) : 0); for (const q of cells) { const d = Math.hypot(q.i - c.i, q.j - c.j); if (d < 3) E.hunted[q.k] += press * (1 - d / 3); } }
  const k1 = Math.min(1, days * 0.2);
  for (let s = 0; s < S; s++) {
    const sp = RS[s], P = pop[s], hunter = sp.diet >= 0.6;
    for (let k = 0; k < n; k++) {
      const c = cells[k]; if (!c.land) { P[k] = 0; continue; }
      const cap = hunter ? clamp(herb[k] * 0.35) * E.fitAt(sp, c, 1) : E.fitAt(sp, c, 0.5);
      const growth = (0.3 + sp.g.fecundity * 0.6) * P[k] * (1 - P[k] / Math.max(0.01, cap));
      P[k] = clamp(P[k] + k1 * (growth - E.hunted[k] * P[k] * (1 - E.wary[s] * 0.5)));
      if (!hunter) { // eaten: proportional to hunters here
        let eat = 0; for (let h = 0; h < S; h++) if (RS[h].diet >= 0.6) eat += pop[h][k] * RS[h].g.size; P[k] = clamp(P[k] - k1 * eat * P[k] * 0.25);
      }
    }
    // migration: a share walks to the best-looking neighbour (fear of hunters counts against a cell)
    for (let k = 0; k < n; k++) {
      if (P[k] < 0.02) continue; const c = cells[k]; let best = -1, bv = -1;
      for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const i = c.i + a, j = c.j + b; if (i < 0 || j < 0 || i >= N || j >= N) continue; const q = j * N + i; const v = E.fitAt(sp, cells[q], 0.5) - E.hunted[q] * (1 + E.wary[s] * 3) - P[q]; if (v > bv) { bv = v; best = q; } }
      if (best >= 0 && bv > E.fitAt(sp, c, 0.5) - E.hunted[k] * (1 + E.wary[s] * 3) - P[k]) { const m = P[k] * 0.08 * k1 * 5 * (0.5 + sp.g.legs); P[k] -= m; P[best] = clamp(P[best] + m); }
    }
  }
  // generations: genes drift toward what the land now selects for; learned wariness half carries over
  E.genT = (E.genT || 0) + days;
  if (E.genT > 30) {
    E.genT = 0; E.gen++;
    const r = rng(hash(prov.seed, E.gen));
    for (let s = 0; s < S; s++) {
      const sp = RS[s]; const k = cells.reduce((b, c) => (pop[s][c.k] > pop[s][b.k] ? c : b), cells[0]);
      const cand = mutate(sp.g, r, 0.03);
      if (E.fitAt({ g: cand }, k, 0.5) >= E.fitAt(sp, k, 0.5)) sp.g = cand;
      E.wary[s] = E.wary[s] * 0.5 + clamp(E.wary[s]) * 0.25; // instinct keeps a part of what parents learned
    }
  }
}
export const localAbundance = (E, s, k) => (E && E.pop[s] ? E.pop[s][k] || 0 : 0);
export { prefTemp, bodySize };
