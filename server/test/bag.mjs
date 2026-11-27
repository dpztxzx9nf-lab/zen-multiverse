// node server/test/bag.mjs: the server-owned bag (server/src/bag.js, js/game/bag-rules.js) over a D1 stand-in.
// Moving an old save in (once, cleaned and capped), spends that can't overdraw, claims within the world's pace,
// refunds only of what was spent, hand recipes, resent ops counting once, spoofed items refused with a reply,
// and races: two worlds spending one bag at once, two players and a box, deposit vs. withdraw.
import { d1 } from './lib/d1mock.mjs';
import { Bag } from '../src/bag.js';
import { Storage } from '../src/storage.js';
import { SHARED_HOME } from '../src/worlds.js';
import { DatabaseSync } from 'node:sqlite';
import { BUDGET, BAG_SINCE } from '../../js/game/bag-rules.js';
let ok = 0, bad = 0; const t = (c, m) => { if (c) ok++; else { bad++; console.log('FAIL', m); } };
const DB = d1();
const flags = [], closed = [];
// a "world": its own Bag (one Durable Object) over the one shared D1
function world() {
  const sent = new Map();
  const w = { env: { DB, LOCAL_DEV: '0' }, sent, send: (ws, m) => (sent.get(ws.a.aid) || sent.set(ws.a.aid, []).get(ws.a.aid)).push(m), flag: async (a, k, d) => flags.push([k, d]), att: (s) => s.a, strike: () => closed.push('strike') };
  w.bag = new Bag(w); return w;
}
const W1 = world(), W2 = world();
const sock = (a) => ({ a, serializeAttachment() {}, close() { closed.push('close'); } });
const A = { aid: 'a'.repeat(32), name: 'Brock' }, B = { aid: 'b'.repeat(32), name: 'Cousin' };
const sa = sock(A), sb = sock(B);
// accounts from before the server bag (an account made after it brings only a little: tested below)
for (const [x, i] of [[A, 1], [B, 2]]) DB.raw.prepare('INSERT INTO accounts (id, email_hash, name, tag, created) VALUES (?, ?, ?, ?, ?)').run(x.aid, 'h' + i, x.name, '000' + i, Date.UTC(2026, 0, 1));
const last = (w, a, k = 'bag') => (w.sent.get(a.aid) || []).filter((m) => m.k === k).at(-1);
const inv = (w, a) => last(w, a).inv;

// ---- first contact: no bag yet, the old save moves in once
await W1.bag.msg(sa, A, { k: 'hi', dev: 'devA0001' }, 1);
t(last(W1, A).imp === false && !A.bag, 'hi: no bag on the server yet (imp false), not a bag client yet');
await W1.bag.msg(sa, A, { k: 'ops', ops: [[1, '+', 'mat:wood', 5]] }, 2);
t(last(W1, A).imp === false, 'ops before the import are not taken');
await W1.bag.msg(sa, A, { k: 'imp', inv: { 'mat:wood': 40, 'mat:stone': 12, fibre: 9, 'fx:chest': 2, tank: 1, 'seed:poppy': 3, 'sample:Kepler shore': 2, 'mat:metal': 99999, gold: 50, 'fx:dragon': 1, constructor: 3, 'mat:ore': -4, salt: 2.7 } }, 3);
let b = inv(W1, A);
t(A.bag === true, 'after the import the client is a bag client');
t(b['mat:wood'] === 40 && b['mat:stone'] === 12 && b['fx:chest'] === 2 && b['sample:Kepler shore'] === 2 && b.salt === 2, 'import: known items moved in whole (2.7 salt is 2)');
t(b['mat:metal'] === 400, `import: an impossible stack is capped (metal 99999 -> ${b['mat:metal']})`);
t(!b.gold && !b['fx:dragon'] && !Object.hasOwn(b, 'constructor') && !b['mat:ore'], 'import: unknown items, prototype names and negative counts are dropped');
t(flags.some(([k]) => k === 'bag-import-cut'), 'import: what was cut is flagged for review');
await W1.bag.msg(sa, A, { k: 'imp', inv: { 'mat:wood': 5000 } }, 4);
t(inv(W1, A)['mat:wood'] === 40 && last(W1, A).moved === 0, 'a second import (same or other device) changes nothing');
// a brand-new account (made since the server bag) on a fresh device brings only a little; one that reuses a device
// whose save already moved into another account starts empty (no copying one save into many accounts)
const N = { aid: '9'.repeat(32), name: 'Newbie' }, sn = sock(N);
DB.raw.prepare('INSERT INTO accounts (id, email_hash, name, tag, created) VALUES (?, ?, ?, ?, ?)').run(N.aid, 'h9', 'Newbie', '0009', BAG_SINCE + 1000);
await W1.bag.msg(sn, N, { k: 'hi', dev: 'devN0001' }, 6); await W1.bag.msg(sn, N, { k: 'imp', inv: { 'mat:wood': 900, 'seed:poppy': 3, 'fx:safe': 9 } }, 7);
t(inv(W1, N)['mat:wood'] === 200 && inv(W1, N)['seed:poppy'] === 3 && inv(W1, N)['fx:safe'] === 2, 'a new account: its play from before signing up comes in, but only a little (200 wood, 2 safes)');
const M = { aid: '8'.repeat(32), name: 'Alt' }, sm = sock(M);
DB.raw.prepare('INSERT INTO accounts (id, email_hash, name, tag, created) VALUES (?, ?, ?, ?, ?)').run(M.aid, 'h8', 'Alt', '0008', Date.UTC(2026, 0, 1));
await W1.bag.msg(sm, M, { k: 'hi', dev: 'devA0001' }, 8); await W1.bag.msg(sm, M, { k: 'imp', inv: { 'mat:wood': 40, 'fx:chest': 2 } }, 9);
t(Object.keys(inv(W1, M)).length === 0 && M.bag === true, 'another account on a device whose save already moved: starts with an empty bag');
const sa2 = sock(A); const A2 = { ...A, bag: false };
await W2.bag.msg(sa2, A2, { k: 'hi', dev: 'devA0002' }, 5);
t(A2.bag === true && inv(W2, A2)['mat:wood'] === 40, 'another device, another world: the same bag, no import asked');

// ---- spends can't overdraw
await W1.bag.msg(sa, A, { k: 'ops', ops: [[1, '-', 'mat:wood', 10], [2, '-', 'mat:stone', 50]] }, 10);
b = inv(W1, A);
t(b['mat:wood'] === 30 && b['mat:stone'] === 12, 'spend 10 wood: done; spend 50 of 12 stone: refused, nothing taken');
t(last(W1, A).rej.some(([s, why]) => s === 2 && why === 'short') && last(W1, A).seq === 2, 'the refusal is told (short) and both ops are done with (seq 2)');
// ---- resent ops count once
await W1.bag.msg(sa, A, { k: 'ops', ops: [[1, '-', 'mat:wood', 10], [2, '-', 'mat:stone', 5], [3, '-', 'mat:wood', 1]] }, 11);
t(inv(W1, A)['mat:wood'] === 29 && inv(W1, A)['mat:stone'] === 12, 'resent after a dropped connection: ops 1 and 2 are not done again, op 3 is');
// even a direct replay of an old op number through the database guard fails (the trigger), not just the check above
let guard = false; try { await DB.batch([W1.bag.dev(A.aid, 'devA0001', 2), W1.bag.ins(A.aid, 'mat:wood', 1), W1.bag.add(A.aid, 'mat:wood', 100)]); } catch { guard = true; }
t(guard && (await W1.bag.inv(A))['mat:wood'] === 29, 'the database itself refuses an op number used before, and the whole batch is undone');

// ---- spoofed items and claims
await W1.bag.msg(sa, A, { k: 'ops', ops: [[4, '+', 'fx:safe', 3], [5, '+', 'gold', 10], [6, '+', 'tank', 2], [7, '+', 'mat:wood', -5], [8, '+', 'mat:wood', 1e9], [9, 'x', 'mat:wood', 1], [10, '+', '__proto__', 1]] }, 12);
b = inv(W1, A); const rj = last(W1, A).rej;
t(!b['fx:safe'] && !b.gold && b.tank === 1 && b['mat:wood'] === 29, 'spoofed: a safe from nowhere, an unknown item, a tank from nowhere, negative and huge counts, a bad op: none counted');
t(rj.length === 7 && rj.find(([s]) => s === 4)[1] === 'made' && rj.find(([s]) => s === 5)[1] === 'bad', 'each refused with a reason (made: only crafted or from a box; bad: not a thing)');
t(flags.some(([k, d]) => k === 'bag-refused' && /gold/.test(d)), 'spoofs are flagged for review');
t(!closed.length, 'and nothing kicks: no strike, no close');
// claims within the world's pace
await W1.bag.msg(sa, A, { k: 'ops', ops: [[11, '+', 'mat:soil', 5000]] }, 13);
const burst = BUDGET.bulk.burst;
t(inv(W1, A)['mat:soil'] === burst && last(W1, A).rej[0][1] === 'pace' && last(W1, A).rej[0][2] === 5000 - burst, `5000 soil at once: the pace allows ${burst} (a real dig gives a few a second)`);
const row = DB.raw.prepare('SELECT tt FROM bag WHERE aid = ? AND item = ?').get(A.aid, 'mat:soil');
DB.raw.prepare('UPDATE bag SET tt = ? WHERE aid = ? AND item = ?').run(row.tt - 60e3, A.aid, 'mat:soil'); // a minute later
await W1.bag.msg(sa, A, { k: 'ops', ops: [[12, '+', 'mat:soil', 1000]] }, 14);
t(inv(W1, A)['mat:soil'] === burst + BUDGET.bulk.per, `a minute later another ${BUDGET.bulk.per} come`);
// refunds: what you spent in your own world comes back, never more
await W1.bag.msg(sa, A, { k: 'ops', ops: [[13, '-', 'tank', 1], [14, '+', 'tank', 1], [15, '+', 'tank', 1]] }, 15);
b = inv(W1, A);
t(b.tank === 1 && last(W1, A).rej.length === 1 && last(W1, A).rej[0][0] === 15, 'a tank put in a rocket and taken back out: back; a second one from nowhere: refused');
// ---- hand recipes: the server pays and makes
await W1.bag.msg(sa, A, { k: 'ops', ops: [[16, 'c', 'cloth'], [17, 'c', 'cloth'], [18, 'c', 'cloth'], [19, 'c', 'ingot'], [20, 'c', 'nope']] }, 16);
b = inv(W1, A); const r2 = last(W1, A).rej;
t(b.cloth === 2 && b.fibre === 1, `cloth twice from 9 fibre (4 each), the third short (fibre ${b.fibre || 0}, cloth ${b.cloth})`);
t(r2.find(([s]) => s === 18)[1] === 'short' && r2.find(([s]) => s === 19)[1] === 'short' && r2.find(([s]) => s === 20)[1] === 'bad', 'short (a bar from no ore), an unknown recipe refused');

// ---- races: two worlds spend one bag at once; only what is there is spent
await W1.bag.give(A, { 'mat:crystal': 5 });
const rs = await Promise.all([W1.bag.take(A, { 'mat:crystal': 5 }), W2.bag.take(A2, { 'mat:crystal': 5 }), W1.bag.take(A, { 'mat:crystal': 3 })]);
t(rs.filter(Boolean).length === 1 && !(await W1.bag.inv(A))['mat:crystal'], `two worlds and a second ask spend the same 5 crystal at once: one wins (${rs}), 0 left, never below`);
const many = await Promise.all(Array.from({ length: 12 }, (_, i) => (i % 2 ? W1 : W2).bag.take(i % 2 ? A : A2, { 'mat:wood': 3 })));
t(many.filter(Boolean).length === 9 && (await W1.bag.inv(A))['mat:wood'] === 2, `12 spends of 3 from 29 wood across two worlds: exactly 9 go through (${many.filter(Boolean).length}), 2 left can't pay 3`);
t(DB.raw.prepare('SELECT MIN(n) m FROM bag').get().m >= 0, 'no stack anywhere is below zero');
// a multi-item cost is all or nothing
await W1.bag.give(A, { 'mat:stone': 1 });
const before = await W1.bag.inv(A);
t((await W1.bag.take(A, { 'mat:stone': 1, 'mat:metal': 999 })) === false && (await W1.bag.inv(A))['mat:stone'] === before['mat:stone'], 'a cost with one part short takes nothing at all');

// ---- storage with the server bag: deposits come out of the server's bag first
const db = new DatabaseSync(':memory:');
const sql = { exec(q, ...p) { if (!p.length && /CREATE/i.test(q)) { db.exec(q); return { toArray: () => [] }; } const st = db.prepare(q); const r = /^\s*select/i.test(q) ? st.all(...p) : (st.run(...p), []); return { toArray: () => r }; } };
sql.exec('CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY, k TEXT NOT NULL, x REAL, z REAL, tile TEXT, holder TEXT, by TEXT, ts INTEGER);');
const socks = new Map();
W1.sql = sql; W1.broadcast = (m) => { for (const s of socks.values()) W1.send(s, m); };
const games = { sock: (aid) => socks.get(aid) || null, att: (aid) => socks.get(aid)?.a || null, present: () => [...socks.values()].map((s) => s.a),
  dist: (a, p) => ((a.tile || null) === (p.tile || null) ? Math.hypot(a.x - p.x, a.z - p.z) : Infinity), held: () => [], pushItems() {}, witness() {}, bd: { all: () => [] }, op: { did() {} } };
const S = new Storage(W1, games);
Object.assign(A, { world: SHARED_HOME, tile: null, x: 20, y: 0, z: -20 }); socks.set(A.aid, sa);
await W1.bag.msg(sb, B, { k: 'hi', dev: 'devB0001' }, 20); await W1.bag.msg(sb, B, { k: 'imp', inv: { 'mat:wood': 10 } }, 21);
Object.assign(B, { world: SHARED_HOME, tile: null, x: 21, y: 0, z: -20 }); socks.set(B.aid, sb);
let T = 1e6; const go = (s, m) => S.msg(s, s.a, m, (T += 700));
await W1.bag.take(A, { 'mat:wood': 2 }); await W1.bag.give(A, { 'fx:chest': 1, 'mat:wood': 20 });
S.hello(sa, A);
const chests = () => S.all().filter((f) => f.kind === 'chest');
await go(sa, { k: 'splace', kind: 'chest', x: 21, y: 0, z: -21.5, yaw: 0, tile: '' });
t(chests().length === 1 && (await W1.bag.inv(A))['fx:chest'] === 2, 'a crate set down comes out of the server bag (3 -> 2)');
const chest = chests()[0];
await go(sa, { k: 'sopen', id: chest.id }); await go(sb, { k: 'sopen', id: chest.id });
await go(sa, { k: 'sput', id: chest.id, item: 'mat:wood', n: 15 });
t(S.get(chest.id).inv['mat:wood'] === 15 && (await W1.bag.inv(A))['mat:wood'] === 5, 'deposit 15 wood: out of the server bag (20 -> 5), into the crate');
t(last(W1, A).inv['mat:wood'] === 5, 'and the client is sent its bag as it is');
await go(sa, { k: 'sput', id: chest.id, item: 'mat:wood', n: 50 });
t(S.get(chest.id).inv['mat:wood'] === 15 && (await W1.bag.inv(A))['mat:wood'] === 5 && /don't have/.test(last(W1, A, 'sno').text), 'the dupe hole: deposit 50 wood with 5 in the bag: refused, the crate gets nothing');
await go(sa, { k: 'sput', id: chest.id, item: 'fx:dragon', n: 1 });
t(!S.get(chest.id).inv['fx:dragon'] && /can't go in/.test(last(W1, A, 'sno').text), 'a made-up item into a crate: refused with a reply');
// deposit and withdraw racing: A puts in her last 5 while B takes; everything adds up
const wB0 = (await W1.bag.inv(B))['mat:wood'] || 0;
await Promise.all([go(sa, { k: 'sput', id: chest.id, item: 'mat:wood', n: 5 }), go(sb, { k: 'stake', id: chest.id, item: 'mat:wood', n: 99 }), go(sa, { k: 'sput', id: chest.id, item: 'mat:wood', n: 5 })]);
const inBox = S.get(chest.id).inv['mat:wood'] || 0, wA = (await W1.bag.inv(A))['mat:wood'] || 0, wB = ((await W1.bag.inv(B))['mat:wood'] || 0) - wB0;
t(inBox + wA + wB === 20, `deposit, withdraw and a second deposit at once: crate ${inBox} + A ${wA} + B took ${wB} = 20, nothing made or lost`);
// two players take the last stack at once
await W1.bag.give(A, { 'mat:stone': 10 }); await go(sa, { k: 'sput', id: chest.id, item: 'mat:stone', n: 10 });
const sA0 = (await W1.bag.inv(A))['mat:stone'] || 0, sB0 = (await W1.bag.inv(B))['mat:stone'] || 0;
await Promise.all([go(sa, { k: 'stake', id: chest.id, item: 'mat:stone', n: 10 }), go(sb, { k: 'stake', id: chest.id, item: 'mat:stone', n: 10 })]);
const gotS = ((await W1.bag.inv(A))['mat:stone'] || 0) - sA0 + ((await W1.bag.inv(B))['mat:stone'] || 0) - sB0;
t(gotS === 10 && !S.get(chest.id).inv['mat:stone'], `two hands on the last 10 stone: 10 come out in all (${gotS}), into server bags`);
// a client from before the server bag can't move bag items
const O = { aid: 'd'.repeat(32), name: 'Old', world: SHARED_HOME, tile: null, x: 20.5, y: 0, z: -20 }, so = sock(O); socks.set(O.aid, so);
await go(so, { k: 'sopen', id: chest.id }); await go(so, { k: 'sput', id: chest.id, item: 'mat:wood', n: 5 });
t(/Update Zen Multiverse/.test(last(W1, O, 'sno').text) && (last(W1, O, 'sgot') || {}).give['mat:wood'] === 5, 'an old client depositing: refused politely, its own count given back');
const n0 = S.get(chest.id).inv['mat:wood'] || 0; await go(so, { k: 'stake', id: chest.id, item: 'mat:wood', n: 1 });
t((S.get(chest.id).inv['mat:wood'] || 0) === n0, 'and it cannot take bag items out either');
// a station recipe: the server pays and makes it
await W1.bag.give(A, { 'mat:ore': 4, 'mat:wood': 2 }); Object.assign(A, { x: 15.4, z: -1.0 });
await go(sa, { k: 'scraft', r: 'ingot', ref: 'c1' });
let ib = await W1.bag.inv(A);
t(last(W1, A, 'scraft').ok && last(W1, A, 'scraft').led === 1 && ib['mat:ore'] === 2 && ib['mat:metal'] >= 1, 'smelting at the garden smelter: 2 ore and a wood paid by the server, a bar made');
await W1.bag.take(A, { 'mat:ore': 2 });
await go(sa, { k: 'scraft', r: 'ingot', ref: 'c2' });
t(last(W1, A, 'scraft').ok === false && /Not enough/.test(last(W1, A, 'scraft').why), 'with no ore left: refused');
// taking a crate down puts it back in the server bag
Object.assign(A, { x: 20, z: -20 });
for (const k of Object.keys(S.get(chest.id).inv)) await go(sa, { k: 'stake', id: chest.id, item: k, n: 9999 });
await go(sa, { k: 'sdown', id: chest.id });
t(!S.get(chest.id) && (await W1.bag.inv(A))['fx:chest'] === 3, 'the crate taken down: back in the server bag');
t(!closed.length, 'through all of it nobody was kicked');
console.log(`${ok} ok, ${bad} failed`); if (bad) process.exit(1);
