// Supply and demand with real goods. Every settlement keeps stocks; its people make what their land
// allows and use what their bodies and climate demand. A price is how badly the place wants a thing
// right now: scarcity raises it, a glut drops it. Goods are the player's own inventory items.
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
// id -> [base value, inventory item, days of buffer a household wants]
export const GOODS = {
  food: [2, 'food', 6], water: [1, 'water', 4], wood: [1.5, 'mat:wood', 5], stone: [1, 'mat:stone', 2],
  ore: [3, 'mat:ore', 2], metal: [7, 'mat:metal', 1.5], salt: [2.5, 'salt', 2], fibre: [1.2, 'fibre', 2], cloth: [4, 'cloth', 1], crystal: [5, 'mat:crystal', 0.5],
};
export const GOOD_LABEL = { food: 'food', water: 'water', wood: 'wood', stone: 'stone', ore: 'metal ore', metal: 'metal', salt: 'salt', fibre: 'fibre', cloth: 'cloth', crystal: 'crystal' };
export const itemOf = (g) => GOODS[g][1];
export const goodOfItem = (id) => Object.keys(GOODS).find((g) => GOODS[g][1] === id) || null;

// a fresh market from the land around it and the people's skills
export function makeMarket(cell, P, people, R) {
  const m = { people, stock: {}, tech: P.tech, cell, cold: clamp((10 - cell.tempC) / 25, 0, 1), credit: 0 };
  for (const g in GOODS) m.stock[g] = Math.round(people * GOODS[g][2] * 0.6 * (0.4 + (yieldOf(m, g) > 0 ? 1 : 0.2)));
  void R; return m;
}
// what one worker-day makes here (0 = cannot make it at all)
export function yieldOf(m, g) {
  const c = m.cell, t = m.tech;
  switch (g) {
    case 'food': return (0.4 + c.food) * (1 + Math.min(t, 3) * 0.5) * 2.4; // foraging, then farming
    case 'water': return (0.3 + c.water) * 5; // wells reach water even where the surface is dry
    case 'wood': return c.wood * 3;
    case 'stone': return c.stone * 3;
    case 'ore': return t >= 2 ? c.ore * 2 : 0;
    case 'metal': return t >= 2 ? Math.min(m.stock.ore, m.stock.wood) > 1 ? 0.6 : 0 : 0;
    case 'salt': return c.salt * 3;
    case 'fibre': return c.food * 1.5;
    case 'cloth': return t >= 1 && m.stock.fibre > 2 ? 0.5 : 0;
    case 'crystal': return c.ore * 0.3;
  }
  return 0;
}
// daily use per person (cold places burn wood for heat)
export function useOf(m, g) { return g === 'food' ? 1 : g === 'water' ? 1 : g === 'wood' ? 0.15 + m.cold * 0.6 : g === 'cloth' ? 0.02 : g === 'salt' ? 0.03 : g === 'metal' ? 0.01 * m.tech : 0; }

export function price(m, g) {
  const want = Math.max(1, m.people * (useOf(m, g) + 0.05) * GOODS[g][2]);
  return +(GOODS[g][0] * clamp(Math.pow(want / (m.stock[g] + 1), 0.65), 0.25, 8)).toFixed(2);
}
// the good this place is shortest of (relative to need), and its biggest glut
export function shortage(m) { let best = null, bv = 0; for (const g in GOODS) { const r = price(m, g) / GOODS[g][0]; if (r > bv) { bv = r; best = g; } } return { good: best, ratio: bv }; }
export function glut(m) { let best = null, bv = 1e9; for (const g in GOODS) { const r = price(m, g) / GOODS[g][0]; if (r < bv && m.stock[g] > 2) { bv = r; best = g; } } return best; }

// days of work and life: workers go where the price says the need is (that is the 'work' utility)
export function stepMarket(m, days, extraLoss = 0) {
  const workers = m.people * 0.55;
  const goods = Object.keys(GOODS);
  // hands go where the need is sharpest: weight = (how dear it is relative to normal)^3 x what a day's work yields
  const w = goods.map((g) => yieldOf(m, g) > 0 ? Math.pow(price(m, g) / GOODS[g][0], 3) * yieldOf(m, g) * GOODS[g][0] : 0); const sw = w.reduce((a, b) => a + b, 0) || 1;
  goods.forEach((g, i) => {
    const made = workers * (w[i] / sw) * yieldOf(m, g) * days;
    if (g === 'metal') { const k = Math.min(made, m.stock.ore, m.stock.wood); m.stock.ore -= k; m.stock.wood -= k; m.stock.metal += k; }
    else if (g === 'cloth') { const k = Math.min(made, m.stock.fibre / 2); m.stock.fibre -= k * 2; m.stock.cloth += k; }
    else m.stock[g] += made;
    m.stock[g] = Math.max(0, m.stock[g] - m.people * useOf(m, g) * days * (1 + extraLoss));
    m.stock[g] = Math.min(m.stock[g], m.people * GOODS[g][2] * 6 + 30); // storage is finite; extra spoils
  });
  // hunger and thirst move people: starving places shrink, fed ones grow a little
  const fed = Math.min(1, (m.stock.food + 1) / (m.people * 0.5 + 1)), wet = Math.min(1, (m.stock.water + 1) / (m.people * 0.5 + 1));
  m.people = Math.max(1, m.people * (1 + (Math.min(fed, wet) - 0.8) * 0.01 * days));
  return { fed, wet };
}
// caravans between two markets of friendly peoples: goods flow from cheap to dear
export function tradeBetween(a, b, days) {
  for (const g in GOODS) {
    const pa = price(a, g), pb = price(b, g);
    if (Math.abs(pa - pb) < GOODS[g][0] * 0.3) continue;
    const [from, to] = pa < pb ? [a, b] : [b, a];
    const k = Math.min(from.stock[g] * 0.1, 2 * days);
    from.stock[g] -= k; to.stock[g] += k;
  }
}
