// delta-only move state: what a sender sends, and what a receiver rebuilds (node tests/net-delta.test.mjs)
import { moveDelta, mergeMove } from '../js/net-delta.js';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const A = { sp: 1.4, g: true, vy: 0, st: 'walk', a: [], by: 3.13, ay: 0.5, ap: 0, tl: 0 };
ok(JSON.stringify(moveDelta(null, A)) === JSON.stringify(A), 'first send is the full state');
ok(moveDelta(A, { ...A, sp: 1.42, by: 3.135 }) === null, 'changes below what shows (2 cm/s, 0.3 deg) send nothing');
ok(JSON.stringify(moveDelta(A, { ...A, by: -3.14 })) === 'null', 'yaw across +-pi is a tiny turn, not a full one');
ok(JSON.stringify(moveDelta(A, { ...A, st: 'run', sp: 4.2 })) === '{"sp":4.2,"st":"run"}', 'a state change sends just the changed fields');
ok(JSON.stringify(moveDelta(A, { ...A, a: ['carry'] })) === '{"a":["carry"]}', 'overlay actions compare by content');
ok(JSON.stringify(moveDelta(A, { ...A, g: false })) === '{"g":false}', 'leaving the ground is sent');
// receiver: a stream of parts rebuilds exactly the sender's state, whatever the step
let have = null, sent = null, cur = { ...A };
for (let i = 0; i < 400; i++) {
  cur = { ...cur, by: Math.atan2(Math.sin(cur.by + 0.013), Math.cos(cur.by + 0.013)), sp: i % 50 < 25 ? 1.4 : 4.2, st: i % 50 < 25 ? 'walk' : 'run', g: i % 97 !== 0 };
  const part = moveDelta(sent, cur); sent = mergeMove(sent, part); have = mergeMove(have, part);
}
const err = Math.abs(Math.atan2(Math.sin(have.by - cur.by), Math.cos(have.by - cur.by)));
ok(have.st === cur.st && have.sp === cur.sp && err < 0.02, `receiver tracks the sender within tolerance (yaw err ${err.toFixed(4)} rad)`);
console.log(fails ? `${fails} FAILED` : 'ALL PASSED'); process.exit(fails ? 1 : 0);
