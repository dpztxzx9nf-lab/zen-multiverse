// node tests/camp-wear.test.mjs: where the camps' ground is worn (js/factions/wear.js) comes from the camp itself
import fs from 'node:fs';
import { campsOf, wearOf, wearAt, DOOR } from '../js/factions/wear.js';
let ok = 0, bad = 0; const t = (c, m) => { if (c) ok++; else { bad++; console.log('FAIL', m); } };
const D = JSON.parse(fs.readFileSync(new URL('../js/factions/factions.json', import.meta.url)));
const S = D.scenes.home, people = S.people.map((p) => ({ f: p.f, home: p.home }));
const camps = campsOf(S.props, people);
const W = camps.find((c) => c.f === 'wardens'), R = camps.find((c) => c.f === 'reavers');
t(W && R && camps.length === 2, 'two camps, one per faction');
t(W.fire && W.hearth.x === -29 && W.hearth.z === 38.5, 'the Rangers gather at their own fire');
t(R.fire && R.hearth.x === 38.5 && R.hearth.z === 26, 'the Raiders at theirs');
t(W.folk.length === 6 && R.folk.length === 4, 'each camp knows its people');
t(W.road && W.road.x === -46 && R.road && R.road.x === 47, 'and its trail marker');
const ws = wearOf(W);
t(wearAt(ws, W.hearth.x + 0.5, W.hearth.z) > 0.7, 'the ground round the hearth is packed');
for (const p of S.props.filter((q) => q.k === 'tent' && q.f === 'wardens')) {
  t(wearAt(ws, p.x, p.z + DOOR + 0.5) > 0.4, `in front of the tent door at ${p.x},${p.z}: worn`);
  const mx = (p.x + W.hearth.x) / 2, mz = (p.z + DOOR + W.hearth.z) / 2;
  t(wearAt(ws, mx, mz) > 0.3, `a path from that door to the fire`);
}
const st = S.props.find((q) => q.k === 'store'); t(wearAt(ws, st.gate.x, st.gate.z) > 0.6, 'the storehouse gate is well trodden');
t(wearAt(ws, -46, 18) > 0.2, 'the trail reaches the road marker');
t(wearAt(ws, -46 + (-46 + 29) / 26 * 30, 18 + (18 - 38.5) / 26 * 30) === 0, 'and fades out beyond it');
t(wearAt(ws, -18, 46) === 0 && wearAt(ws, -40, 50) === 0, 'away from where anyone walks the crust is whole');
const trail = ws.find((q) => q.fade).pts, near = wearAt(ws, (trail[0][0] + trail[1][0]) / 2, (trail[0][1] + trail[1][1]) / 2), far = wearAt(ws, (trail[2][0] * 3 + trail[3][0]) / 4, (trail[2][1] * 3 + trail[3][1]) / 4);
t(near > far, `the trail is more worn near camp than out past the marker (${near.toFixed(2)} > ${far.toFixed(2)})`);
console.log(`camp-wear: ${ok} ok, ${bad} failed`); process.exit(bad ? 1 : 0);
