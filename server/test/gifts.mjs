// node server/test/gifts.mjs: asks and gifts in the factions sim (js/factions/sim.js), no server needed.
// Dagna asks for the propellant cell; B hands it over at the Raider post and is paid from the Raider cache.
// Tove, tied to the post, sees it. C cuts her loose; she walks home and tells the Rangers, and from then on
// the Rangers treat B warily and say why. Nothing is a score: it is all what people saw and were told.
import { readFileSync } from 'node:fs';
import { createScene, createSim, asksOf } from '../../js/factions/sim.js';
const D = JSON.parse(readFileSync(new URL('../../js/factions/factions.json', import.meta.url)));
let ok = 0, bad = 0; const t = (c, m) => { if (c) ok++; else { bad++; console.log('FAIL', m); } };
const st = createScene(D, 'home'); const sim = createSim(D, st, { world: 'home:test' });
const A = 'a'.repeat(32), B = 'b'.repeat(32), C = 'c'.repeat(32);
let T = 1e12; sim.advance(T);
const dagna = st.npcs['r-dagna'], P = sim.pos(dagna, T);
let tk = sim.talk('r-dagna', B, T);
t(tk.offers.includes('gift-cell') && tk.lines.some((l) => /propellant cell/.test(l)), 'Dagna asks a stranger for the propellant cell');
t(asksOf(D, { kind: 'home' }, { id: 'w-ivo' }).some((q) => q.k === 'pearl'), 'Ivo asks for a pearl');
let r = sim.act(B, 'gift-cell', 'r-dagna', { x: P.x + 8, z: P.z }, (T += 1000), 'Ben');
t(!r.ok && r.why === 'too-far', 'out of reach: no gift');
// (B stands on the open side of the lean-to: from her post Tove can see them; behind it she could not)
r = sim.act(B, 'gift-cell', 'r-dagna', { x: P.x + 1.5, z: P.z + 2 }, (T += 1000), 'Ben');
t(r.ok && r.give && r.give['mat:metal'] === 3, 'the gift is paid in metal from the Raider cache');
t(st.caches['cache-reavers'].goods['mat:metal'] === 0, 'and the cache really has less in it');
t(r.seen.some((s) => s.name === 'Tove' && s.by === 'saw'), 'Tove, tied at the post, saw it');
{ const s2 = createScene(D, 'home'), q = createSim(D, s2, { world: 'home:t2' }); q.advance(T); const r2 = q.act(B, 'gift-cell', 'r-dagna', { x: P.x + 1, z: P.z }, T, 'Ben'); t(r2.ok && !r2.seen.some((s) => s.name === 'Tove'), 'behind the lean-to Tove does not see it'); }
tk = sim.talk('r-dagna', B, (T += 1000));
t(!tk.offers.includes('gift-cell') && /Good|square|owe/.test(tk.lines.join(' ')) || tk.stance === 'grateful', 'Dagna remembers: no more asking, she is grateful');
r = sim.act(A, 'gift-cell', 'r-dagna', { x: P.x + 1, z: P.z }, (T += 1000), 'Ann');
t(r.ok && Object.keys(r.give).length === 0, 'a second cell: the cache has nothing left to pay with');
r = sim.act(B, 'gift-hearthstone', 'r-dagna', { x: P.x + 1, z: P.z }, (T += 1000), 'Ben');
t(!r.ok && r.why === 'state', 'Dagna never asked for the hearthstone');
const oskar = st.npcs['w-oskar'];
t(sim.talk('w-oskar', B, T).stance === 'stranger', 'the Rangers know nothing of it yet');
const tove = st.npcs['w-tove'], tp = sim.pos(tove, T);
r = sim.act(C, 'free', 'w-tove', { x: tp.x + 1, z: tp.z }, (T += 1000), 'Cy');
t(r.ok, 'C cuts Tove loose');
for (let i = 0; i < 200; i++) sim.advance((T += 5000)); // she walks home (about 80 m) and talks with whoever is at camp
const ok2 = sim.talk('w-oskar', B, T);
t(ok2.stance === 'wary' && ok2.lines.some((l) => /told me you gave Dagna the propellant cell/.test(l)), 'Oskar is wary of B and says why: ' + ok2.lines[0]);
t(sim.talk('w-oskar', C, T).stance === 'friendly', 'and friendly with C, who freed her');
t(!sim.talk('w-oskar', C, T).lines.some((l) => /They took Tove/.test(l)), 'Oskar stops asking about Tove once she is home');
const mp = sim.pos(st.npcs['w-maren'], T);
t(sim.talk('w-maren', A, T).offers.includes('gift-hearthstone'), 'Maren asks for the hearthstone');
r = sim.act(A, 'gift-hearthstone', 'w-maren', { x: mp.x + 1, z: mp.z }, (T += 1000), 'Ann');
t(r.ok && r.give.cloth === 2, 'Maren pays two cloth from the storehouse');
t(!sim.talk('w-maren', A, (T += 1000)).offers.includes('gift-hearthstone'), 'and stops asking once she has it');
// fish: a standing ask, paid every time from the real stock, and the camp's food goes up
{ const ip = sim.pos(st.npcs['w-ivo'], T), wc = st.caches['cache-wardens'], food0 = wc.goods.food, water0 = wc.goods.water;
  t(sim.talk('w-ivo', C, T).offers.includes('gift-fish'), 'Ivo asks for fish');
  let f1 = sim.act(C, 'gift-fish', 'w-ivo', { x: ip.x + 1, z: ip.z }, (T += 1000), 'Cy'), f2 = sim.act(C, 'gift-fish', 'w-ivo', { x: ip.x + 1, z: ip.z }, (T += 1000), 'Cy');
  t(f1.ok && f2.ok && f1.give.water === 1 && f2.give.water === 1, 'a skin of water for each fish');
  t(wc.goods.food === food0 + 2 && wc.goods.water === water0 - 2, 'the camp has two more food and two fewer skins');
  const tk2 = sim.talk('w-ivo', C, (T += 1000)); t(tk2.offers.includes('gift-fish') && tk2.lines.some((l) => /Another fish/.test(l)), 'and keeps asking');
  for (let i = 0; i < 10; i++) { T += 1000; const q = sim.pos(st.npcs['w-ivo'], T); f1 = sim.act(C, 'gift-fish', 'w-ivo', { x: q.x + 1, z: q.z }, T, 'Cy'); }
  t(f1.ok && !f1.give.water && wc.goods.water === 0, 'once the water is gone he takes the fish but has nothing to pay'); }
console.log(`gifts: ${ok} ok, ${bad} failed`); process.exit(bad ? 1 : 0);
