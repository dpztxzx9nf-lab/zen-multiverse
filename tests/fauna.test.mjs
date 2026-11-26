// node tests/fauna.test.mjs: the garden animals (js/fauna.js): senses, flight, the fox's hunt, taming, hunting.
import { createFauna, stepFauna, faunaAct, senses, walkable } from '../js/fauna.js';
let ok = 0, bad = 0; const t_ = (c, m) => { if (c) ok++; else { bad++; console.log('FAIL', m); } };
const run = (st, secs, players, T) => { for (let i = 0; i < secs * 10; i++) stepFauna(st, 0.1, players, (T.t += 100)); };
// senses: a hare looking away does not see a creeper behind it, but hears a runner
{ const a = { sp: 'hare', x: 0, z: 0, yaw: 0 }; // facing +z; 300 degree cone: blind straight behind
  t_(!senses(a, { x: 0, z: -10 }, 0.2), 'a creeper right behind, 10 m: unnoticed');
  t_(senses(a, { x: 0, z: -10 }, 6) && senses(a, { x: 0, z: -10 }, 6).how === 'heard', 'a runner right behind: heard');
  t_(senses(a, { x: 3, z: 10 }, 1) && senses(a, { x: 3, z: 10 }, 1).how === 'saw', 'someone walking in front: seen'); }
t_(walkable(22, -12) && !walkable(10.2, 1.2) && !walkable(2, -35), 'meadows are walkable; the pond and cove water are not');
// flight: a runner coming at a hare makes it bolt; a creeper gets closer
{ const T = { t: 1e6 }, st = createFauna(); st.animals = st.animals.filter((a) => a.id === 'h1'); const h = st.animals[0]; h.x = 22; h.z = -12; h.yaw = 0;
  run(st, 0.2, [{ aid: 'A', x: 22, z: -3, sp: 6 }], T); t_(h.st === 'flee', 'a runner 9 m away: the hare bolts');
  const st2 = createFauna(); st2.animals = st2.animals.filter((a) => a.id === 'h1'); const h2 = st2.animals[0]; h2.x = 22; h2.z = -12; h2.yaw = Math.PI;
  run(st2, 0.2, [{ aid: 'A', x: 22, z: -6, sp: 0.2 }], T); t_(h2.st !== 'flee', 'a creeper 6 m away: it keeps grazing'); }
// the fox hunts when hungry and no one is around
{ const T = { t: 2e6 }, st = createFauna(); const f = st.animals.find((a) => a.sp === 'fox'); f.hunger = 0.9; f.x = 10; f.z = -12;
  let killed = false; for (let s = 0; s < 600 && !killed; s++) { run(st, 1, [], T); killed = !!st.lastKill; }
  t_(killed, 'a hungry fox catches a hare within ten minutes');
  t_(killed && f.hunger < 0.2, 'and is fed'); }
// the fox keeps away from people
{ const T = { t: 3e6 }, st = createFauna(); const f = st.animals.find((a) => a.sp === 'fox'); f.x = -30; f.z = -18; f.yaw = 0; f.hunger = 0;
  run(st, 0.3, [{ aid: 'A', x: -30, z: -12, sp: 1.4 }], T); t_(f.st === 'flee', 'the fox slips away from someone walking up'); }
// taming: three handfuls, some time apart, from someone who never hurt one
{ const T = { t: 4e6 }, st = createFauna(); st.animals = st.animals.filter((a) => a.sp === 'hare'); const h = st.animals[0]; const P = { x: h.x + 1, z: h.z };
  let r = faunaAct(st, 'feed', 'A', P, h.id, (T.t += 100)); t_(r.ok && !r.tamed, 'first handful: it eats');
  r = faunaAct(st, 'feed', 'A', P, h.id, (T.t += 2000)); t_(!r.ok && r.why === 'full', 'too soon: still chewing');
  r = faunaAct(st, 'feed', 'A', P, h.id, (T.t += 16000)); r = faunaAct(st, 'feed', 'A', { x: h.x + 1, z: h.z }, h.id, (T.t += 16000));
  t_(r.ok && r.tamed && h.tame === 'A', 'third handful: tame');
  const lead = { aid: 'A', x: h.x + 12, z: h.z, sp: 1.2 }; run(st, 8, [lead], T);
  t_(Math.hypot(h.x - lead.x, h.z - lead.z) < 5, 'it follows its person');
  r = faunaAct(st, 'brush', 'A', { x: h.x + 1, z: h.z }, h.id, (T.t += 100)); t_(r.ok && r.give.fibre === 2, 'brushing gives underfur');
  r = faunaAct(st, 'brush', 'A', { x: h.x + 1, z: h.z }, h.id, (T.t += 1000)); t_(!r.ok, 'not again right away');
  r = faunaAct(st, 'brush', 'B', { x: h.x + 1, z: h.z }, h.id, (T.t += 1000)); t_(!r.ok, 'someone else cannot brush it'); }
// hunting: one thrust kills a hare; the others remember who
{ const T = { t: 5e6 }, st = createFauna(); const hs = st.animals.filter((a) => a.sp === 'hare'); const h = hs[0], o = hs[1]; o.x = h.x + 3; o.z = h.z;
  const r = faunaAct(st, 'hit', 'B', { x: h.x + 1, z: h.z }, h.id, (T.t += 100));
  t_(r.ok && r.killed && r.give.meat === 1 && r.give.hide === 1, 'a hare: one thrust, meat and a hide');
  t_(!faunaAct(st, 'hit', 'B', { x: h.x + 9, z: h.z }, o.id, (T.t += 100)).ok, 'out of reach: nothing');
  o.st = 'graze'; o.until = T.t + 1e5; run(st, 0.3, [{ aid: 'B', x: o.x + 11, z: o.z, sp: 1.2 }], T); t_(o.st === 'flee', 'a hare near the kill bolts from the hunter at 11 m');
  const st3 = createFauna(); const q = st3.animals.find((a) => a.id === 'h4'); q.st = 'graze'; q.until = T.t + 1e5; run(st3, 0.3, [{ aid: 'C', x: q.x + 11, z: q.z, sp: 1.2 }], T); t_(q.st !== 'flee', 'but not from someone it has no reason to fear');
  const r2 = faunaAct(st, 'feed', 'B', { x: o.x + 1, z: o.z }, o.id, (T.t += 100)); void r2;
  const f = st.animals.find((a) => a.sp === 'fox'); f.x = 0; f.z = 0; let a1 = faunaAct(st, 'hit', 'B', { x: 1, z: 0 }, f.id, (T.t += 100)); f.x = 0; f.z = 0; f.dead = 0;
  const a2 = faunaAct(st, 'hit', 'B', { x: 1, z: 0 }, f.id, (T.t += 100)); t_(a1.ok && !a1.killed && a2.killed && a2.give.hide === 2, 'a fox takes two thrusts and gives two hides'); }
console.log(`fauna: ${ok} ok, ${bad} failed`); process.exit(bad ? 1 : 0);
