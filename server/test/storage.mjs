// node server/test/storage.mjs: things set down, chests and safes (server/src/storage.js) with an in-memory SQLite.
// Placing, depositing and withdrawing, the safe's lock and allow-list, no dupes when two people reach for the last of
// a stack, real objects in and out of hands, breaking a chest open, taking down, station checks, persistence.
import { DatabaseSync } from 'node:sqlite';
import { Storage, GARDEN_FIXTURES } from '../src/storage.js';
import { SHARED_HOME } from '../src/worlds.js';
import { FIXTURES, STACK, carryFor, room, slotsUsed } from '../../js/game/fixtures.js';
let ok = 0, bad = 0; const t = (c, m) => { if (c) ok++; else { bad++; console.log('FAIL', m); } };
const db = new DatabaseSync(':memory:');
const sql = { exec(q, ...p) { if (!p.length && /CREATE/i.test(q)) { db.exec(q); return { toArray: () => [] }; } const st = db.prepare(q); const r = /^\s*select/i.test(q) ? st.all(...p) : (st.run(...p), []); return { toArray: () => r }; } };
sql.exec('CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY, k TEXT NOT NULL, x REAL, z REAL, tile TEXT, holder TEXT, by TEXT, ts INTEGER);');
const socks = new Map(), sent = new Map(), strikes = [], seen = [];
const mk = (aid, name, x, z, y = 0) => { const a = { aid, name, world: SHARED_HOME, tile: null, x, y, z }; socks.set(aid, { a }); sent.set(aid, []); return a; };
const w = { sql, send: (ws, m) => sent.get(ws.a.aid).push(m), strike: (ws, a, n, why) => strikes.push(why), broadcast: (m) => { for (const s of socks.values()) sent.get(s.a.aid).push(m); }, att: (s) => s.a };
let opDid = [];
const games = { sock: (aid) => socks.get(aid) || null, att: (aid) => socks.get(aid)?.a || null, present: () => [...socks.values()].map((s) => s.a),
  dist: (a, p) => ((a.tile || null) === (p.tile || null) ? Math.hypot(a.x - p.x, a.z - p.z) : Infinity),
  held: (aid) => sql.exec('SELECT id, k FROM items WHERE holder = ?', aid).toArray(), pushItems() {}, witness: (tt, actors, text) => seen.push(text),
  bd: { all: () => [] }, op: { did: (a, ev) => opDid.push([a.aid, ev]) } };
let S = new Storage(w, games);
const A = mk('a'.repeat(32), 'Brock', 20, -20), C = mk('c'.repeat(32), 'Cousin', 21, -20);
const got = (a, k) => sent.get(a.aid).filter((m) => m.k === k);
const last = (a, k) => got(a, k).at(-1);
let T = 1e6; const go = (a, m) => S.msg(socks.get(a.aid), a, m, (T += 700));
const ids = () => S.all().filter((f) => f.owner !== 'world');

// the garden's own stations are there for everyone
S.hello(socks.get(A.aid), A);
t(GARDEN_FIXTURES.every((g) => S.get(g.id)), 'hello: the garden has its own bench, fire and forge');
t(last(A, 'sfix').list.length === 3 && last(A, 'sfix').carry === 3, 'and the client hears of them, with two hands (3 things)');
// place a chest and a safe on open lawn
await go(A, { k: 'splace', kind: 'chest', x: 21, y: 0, z: -21.5, yaw: 0, tile: '', ref: 'p1' });
t(got(A, 'sone').length === 1 && got(C, 'sone').length === 1, 'a chest set down: both players see it');
const chest = ids().find((f) => f.kind === 'chest');
await go(A, { k: 'splace', kind: 'safe', x: 18.5, y: 0, z: -21.5, yaw: 0, tile: '', ref: 'p2' });
const safe = ids().find((f) => f.kind === 'safe');
t(!!safe && safe.owner === A.aid, 'a safe set down, owned by who set it');
await go(A, { k: 'splace', kind: 'chest', x: 21.2, y: 0, z: -21.3, yaw: 0, tile: '' });
t(/Too close/.test(last(A, 'sno').text) && last(A, 'sgot').give['fx:chest'] === 1, 'not on top of another thing: refused, and the chest goes back in the bag');
await go(A, { k: 'splace', kind: 'chest', x: 10.2, y: 0, z: 1.2, yaw: 0, tile: '' });
t(/Too far|pond/.test(last(A, 'sno').text), 'not out of reach / in the pond');
await go(A, { k: 'splace', kind: 'tower', x: 21, y: 0, z: -18, yaw: 0, tile: '' }); t(!strikes.length && /can't be set down/.test(last(A, 'sno').text), 'an unknown kind: refused politely, no strike (a bad message never kicks)');
// deposit and withdraw bag items
await go(A, { k: 'sopen', id: chest.id }); t(last(A, 'sbox') && last(A, 'sbox').slots === 20, 'A opens the chest: 20 slots');
await go(A, { k: 'sput', id: chest.id, item: 'mat:wood', n: 30 });
t(S.get(chest.id).inv['mat:wood'] === 30, 'A puts 30 wood in');
await go(C, { k: 'sopen', id: chest.id }); t(last(C, 'sbox').inv['mat:wood'] === 30, 'C opens the same chest (chests are not locked) and sees the wood');
await go(C, { k: 'stake', id: chest.id, item: 'mat:wood', n: 10 });
t(last(C, 'sgot').give['mat:wood'] === 10 && S.get(chest.id).inv['mat:wood'] === 20, 'C takes 10: granted, 20 left');
t(seen.some((s) => /Cousin took 10 from Brock's crate/.test(s)), 'and that was witnessed (camp news)');
// no dupes: both reach for the last 20 in the same instant: the first gets 20, the second nothing
const before = got(A, 'sgot').length + got(C, 'sgot').length;
const tt = (T += 1000);
await S.msg(socks.get(A.aid), A, { k: 'stake', id: chest.id, item: 'mat:wood', n: 20 }, tt);
await S.msg(socks.get(C.aid), C, { k: 'stake', id: chest.id, item: 'mat:wood', n: 20 }, tt);
const grants = [...got(A, 'sgot'), ...got(C, 'sgot')].slice(before - got(A, 'sgot').length - got(C, 'sgot').length).filter((m) => m.give && m.give['mat:wood']);
const total = [...got(A, 'sgot'), ...got(C, 'sgot')].reduce((n, m) => n + ((m.give && m.from === chest.id && m.give['mat:wood']) || 0), 0);
t(total === 30 && !S.get(chest.id).inv['mat:wood'], `two at once: exactly the 30 that went in came out (got ${total}), none duplicated`); void grants;
await go(C, { k: 'stake', id: chest.id, item: 'mat:wood', n: 5 }); t(total === [...got(A, 'sgot'), ...got(C, 'sgot')].reduce((n, m) => n + ((m.give && m.from === chest.id && m.give['mat:wood']) || 0), 0), 'taking from an empty stack gives nothing');
// a full chest: 20 slots of 99
await go(A, { k: 'sput', id: chest.id, item: 'mat:stone', n: 99 * 20 + 5 });
t(slotsUsed(S.get(chest.id).inv) === 20 && last(A, 'sgot').give['mat:stone'] === 5, 'a chest holds 20 stacks of 99; the 5 that did not fit go back');
await go(A, { k: 'sput', id: chest.id, item: 'fibre', n: 1 }); t(/full/.test(last(A, 'sno').text) && last(A, 'sgot').give.fibre === 1, 'a full chest refuses more (refunded)');
await go(A, { k: 'stake', id: chest.id, item: 'mat:stone', n: 99 * 20 });
await go(A, { k: 'sput', id: chest.id, item: 'fx:safe', n: 1 }); t(!strikes.length && /can't go in/.test(last(A, 'sno').text), 'a safe cannot go in a chest (refused, no strike)');
// reach: from too far away
C.x = 40; await go(C, { k: 'stake', id: chest.id, item: 'mat:stone', n: 1 }); t(/Too far/.test(last(C, 'sno').text), 'from 20 m away: too far'); C.x = 21;
// the safe: locked to everyone but the owner and friends they add
await go(C, { k: 'sopen', id: safe.id }); t(/Locked/.test(last(C, 'sno').text), 'C cannot open A\'s safe');
await go(C, { k: 'sput', id: safe.id, item: 'fibre', n: 2 }); t(last(C, 'sgot').give.fibre === 2 && !S.get(safe.id).inv.fibre, 'C cannot put things in it either (refunded)');
await go(A, { k: 'sopen', id: safe.id }); await go(A, { k: 'sput', id: safe.id, item: 'mat:metal', n: 6 }); t(S.get(safe.id).inv['mat:metal'] === 6 && last(A, 'sbox').slots === 12, 'A puts 6 metal in the 12-slot safe');
await go(C, { k: 'stake', id: safe.id, item: 'mat:metal', n: 6 }); t(S.get(safe.id).inv['mat:metal'] === 6, 'C cannot take from it');
await go(C, { k: 'shit', id: safe.id, tool: 'axe' }); t(/Riveted/.test(last(C, 'sno').text), 'nor break it');
await go(C, { k: 'sdown', id: safe.id }); t(S.get(safe.id) && /Brock/.test(last(C, 'sno').text), 'nor take it down');
await go(C, { k: 'sallow', id: safe.id, to: C.aid, on: 1 }); t(!S.get(safe.id).allow.length, 'C cannot add themself');
await go(A, { k: 'sallow', id: safe.id, to: C.aid, on: 1 }); t(S.get(safe.id).allow.includes(C.aid), 'A adds C to the safe');
await go(C, { k: 'stake', id: safe.id, item: 'mat:metal', n: 2 }); t(last(C, 'sgot').give['mat:metal'] === 2, 'now C can open it and take metal');
await go(A, { k: 'sallow', id: safe.id, to: C.aid, on: 0 }); await go(C, { k: 'stake', id: safe.id, item: 'mat:metal', n: 1 }); t(S.get(safe.id).inv['mat:metal'] === 4, 'and once removed, C is locked out again');
// real objects: a relic from A's hands into the safe and back
sql.exec('INSERT INTO items (id, k, x, z, tile, holder, by, ts) VALUES (?, ?, 0, 0, ?, ?, NULL, 0)', 'relic1', 'coin', '', A.aid);
await go(A, { k: 'sputo', id: safe.id, iid: 'relic1' }); t(games.held(A.aid).length === 0 && S.objs(safe.id).length === 1, 'the silver coin goes from A\'s hands into the safe');
await go(C, { k: 'stakeo', id: safe.id, iid: 'relic1' }); t(S.objs(safe.id).length === 1, 'C cannot lift it out');
await go(A, { k: 'stakeo', id: safe.id, iid: 'relic1' }); t(games.held(A.aid).length === 1, 'A takes it back into their hands');
await go(A, { k: 'sputo', id: safe.id, iid: 'relic1' });
await go(A, { k: 'stakeo', id: safe.id, iid: 'relic1' }); await go(A, { k: 'stakeo', id: safe.id, iid: 'relic1' });
t(games.held(A.aid).length === 1 && !S.objs(safe.id).length, 'taking the same object twice gives it once');
for (let i = 0; i < 3; i++) sql.exec('INSERT INTO items (id, k, x, z, tile, holder, by, ts) VALUES (?, ?, 0, 0, ?, ?, NULL, 0)', 'h' + i, 'amber', '', 'f:' + safe.id);
await go(A, { k: 'stakeo', id: safe.id, iid: 'h0' }); await go(A, { k: 'stakeo', id: safe.id, iid: 'h1' }); await go(A, { k: 'stakeo', id: safe.id, iid: 'h2' });
t(games.held(A.aid).length === 3 && /hands are full/.test(last(A, 'sno').text), 'two hands hold 3: the fourth stays in the safe');
await go(A, { k: 'sgear', gear: ['satchel', 'bogus'] }); t(S.carry(A.aid) === 6 && last(A, 'scarry').carry === 6, 'a satchel: 6 in the hands (unknown gear ignored)');
await go(A, { k: 'stakeo', id: safe.id, iid: 'h2' }); t(games.held(A.aid).length === 4, 'now the fourth comes out');
t(carryFor(['satchel', 'acc_pack']) === 9, 'satchel and travel pack: 9');
// breaking a chest open: C (not the owner) with an axe, 4 blows; contents spill
await go(A, { k: 'sput', id: chest.id, item: 'salt', n: 7 });
sql.exec('UPDATE items SET holder = ? WHERE id = ?', 'f:' + chest.id, 'h0');
for (let i = 0; i < 3; i++) await go(C, { k: 'shit', id: chest.id, tool: 'axe' });
t(S.get(chest.id) && S.get(chest.id).hp === 10, 'three axe blows: cracked, still standing');
await S.msg(socks.get(C.aid), C, { k: 'shit', id: chest.id, tool: 'axe' }, T + 100); t(S.get(chest.id).hp === 10, 'blows faster than a person can swing do not count');
await go(C, { k: 'shit', id: chest.id, tool: 'axe' });
const spill = S.all().find((f) => f.kind === 'spill');
t(!S.get(chest.id) && spill && spill.inv.salt === 7, 'the fourth breaks it: the salt lies in a spilled heap');
t(sql.exec('SELECT holder FROM items WHERE id = ?', 'h0').toArray()[0].holder === null, 'the amber falls on the ground');
t(seen.some((s) => /broke open Brock's crate/.test(s)), 'and the break is witnessed');
await go(C, { k: 'stake', id: spill.id, item: 'salt', n: 7 }); t(last(C, 'sgot').give.salt === 7 && !S.get(spill.id), 'anyone can pick through it; empty, it is gone');
// taking down: owner only, empty first
await go(A, { k: 'sdown', id: safe.id }); t(/Empty it first/.test(last(A, 'sno').text), 'a safe with things in it cannot be taken down');
await go(A, { k: 'stake', id: safe.id, item: 'mat:metal', n: 4 });
await go(A, { k: 'sdown', id: safe.id }); t(!S.get(safe.id) && last(A, 'sgot').give['fx:safe'] === 1, 'empty: taken down and back in the bag');
await go(A, { k: 'sdown', id: 'g-bench' }); t(/belongs to the garden/.test(last(A, 'sno').text), 'nobody takes the garden\'s bench');
// caps
for (let i = 0; i < 6; i++) { const x = 24 + i * 1.6, z = -24; A.x = x; A.z = z + 1.5; await go(A, { k: 'splace', kind: 'fire', x, y: 0, z, yaw: 0, tile: '', ref: 'f' + i }); }
t(ids().filter((f) => f.kind === 'fire').length === 4 && /4 campfires/.test(last(A, 'sno').text), 'each player has at most 4 fires out');
// stations: crafting is checked against real stations
A.x = 40; A.z = -20; opDid = [];
await go(A, { k: 'scraft', r: 'spear', ref: 'c1' }); t(last(A, 'scraft').ok === false && /workbench/.test(last(A, 'scraft').why), 'a spear away from any bench: no');
A.x = 6.8; A.z = -21.5;
await go(A, { k: 'scraft', r: 'spear', ref: 'c2' }); t(last(A, 'scraft').ok === true && opDid.length === 1, 'at the cove bench: yes (and Ula hears of it)');
await go(A, { k: 'scraft', r: 'ingot', ref: 'c3' }); t(last(A, 'scraft').ok === false && /smelter/.test(last(A, 'scraft').why), 'metal is not smelted at a bench');
A.x = 16.2; A.z = -0.4; await go(A, { k: 'scraft', r: 'ingot', ref: 'c4' }); t(last(A, 'scraft').ok === true, 'at the forge by the shed: yes');
A.x = 20.2; A.z = 1.0; await go(A, { k: 'scraft', r: 'rod', ref: 'c5' }); t(last(A, 'scraft').ok === true, 'the shed\'s own bench counts');
const fire = ids().find((f) => f.kind === 'fire'); A.x = fire.x + 1.5; A.z = fire.z; await go(A, { k: 'scraft', r: 'cookfish', ref: 'c6' }); t(last(A, 'scraft').ok === true, 'cooking at your own fire');
await go(A, { k: 'scraft', r: 'nope', ref: 'c7' }); t(!strikes.length && last(A, 'scraft').ok === false && last(A, 'scraft').ref === 'c7', 'an unknown recipe: a polite no, no strike');
await go(A, { k: 'splace', kind: 'chest', x: 'NaN', y: null, z: {}, yaw: 0, tile: '' }); t(!strikes.length && last(A, 'sgot').give['fx:chest'] === 1, 'garbage numbers: refused, the chest goes back, no strike');
await go(A, { k: 'stake', id: 'nope', item: '../../x', n: 1e9 }); t(!strikes.length, 'a nonsense take: no strike');
// persistence: a new Storage on the same database (the Durable Object woke up, or the server restarted)
A.x = 20; A.z = -20; await go(A, { k: 'splace', kind: 'chest', x: 21, y: 0, z: -21.5, yaw: 0, tile: '' });
const c2 = ids().find((f) => f.kind === 'chest'); A.x = 21; A.z = -20.5;
await go(A, { k: 'sput', id: c2.id, item: 'cloth', n: 3 });
S = new Storage(w, games);
t(S.get(c2.id) && S.get(c2.id).inv.cloth === 3 && S.get(c2.id).owner === A.aid, 'after a restart: the chest, its owner and its cloth are all still there');
S.hello(socks.get(A.aid), A); t(last(A, 'sfix').list.some((x) => x[0] === c2.id) && last(A, 'sfix').carry === 6, 'reconnect: the list comes again, with your satchel-sized hands');
// an item id that is also an Object property name is just an item
await go(A, { k: 'sput', id: c2.id, item: 'constructor', n: 2 }); t(S.get(c2.id).inv.constructor === 2, 'an item called constructor is stored as 2 of it');
// helpers
t(room(FIXTURES.chest, { a: 50 }, 0, 'a') === 49 + 19 * STACK, 'room: the part-filled stack first, then free slots');
console.log(`storage: ${ok} ok, ${bad} failed`); process.exit(bad ? 1 : 0);
