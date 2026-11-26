// node server/test/places.mjs: the server's points of interest (server/src/places.js) without wrangler:
// a fake World with an in-memory SQLite. Found only where the server saw you, digs only within reach and at
// a human pace, shared progress, loot to everyone who helped, one relic on the ground, refill after a while.
import { DatabaseSync } from 'node:sqlite';
import { Places } from '../src/places.js';
import { SHARED_HOME } from '../src/worlds.js';
let ok = 0, bad = 0; const t = (c, m) => { if (c) ok++; else { bad++; console.log('FAIL', m); } };
const db = new DatabaseSync(':memory:');
const sql = { exec(q, ...p) { if (!p.length && /;\s*\S/.test(q.trim().replace(/;\s*$/, ''))) { db.exec(q); return { toArray: () => [] }; } const st = db.prepare(q); const r = /^\s*select/i.test(q) ? st.all(...p) : (st.run(...p), []); return { toArray: () => r }; } };
sql.exec('CREATE TABLE items (id TEXT PRIMARY KEY, k TEXT NOT NULL, x REAL, z REAL, tile TEXT, holder TEXT, by TEXT, ts INTEGER)');
const socks = new Map(), sent = new Map(), strikes = [];
const mk = (aid, name, x, z, y = 0) => { const a = { aid, name, world: SHARED_HOME, tile: null, x, y, z }; const ws = { a }; socks.set(aid, ws); sent.set(aid, []); return a; };
const w = { sql, env: { LOCAL_DEV: '1' }, send: (ws, m) => sent.get(ws.a.aid).push(m), att: (ws) => ws.a, strike: (ws, a, n, why) => strikes.push(why) };
let nid = 0;
const games = { sock: (aid) => socks.get(aid) || null, present: () => [...socks.values()].map((s) => s.a), sys: (ws, text) => w.send(ws, { t: 'g', k: 'say', text }),
  addItem: (k, p, holder = null) => { sql.exec('INSERT INTO items (id, k, x, z, tile, holder) VALUES (?, ?, ?, ?, ?, ?)', 'i' + ++nid, k, p.x, p.z, '', holder); }, pushItems() {},
  held: (aid) => sql.exec('SELECT id, k FROM items WHERE holder = ?', aid).toArray() };
const P = new Places(w, games);
const A = mk('a'.repeat(32), 'Ann', 3.5, 9.8), B = mk('b'.repeat(32), 'Ben', -24, -35.5);
const got = (a, k) => sent.get(a.aid).filter((m) => m.k === k);
P.hello(socks.get(A.aid), A);
t(got(A, 'pl').length === 1 && got(A, 'pl')[0].seen.length === 0 && got(A, 'pl')[0].digs.ruins.need === 8, 'hello: nothing found yet, the digs and what they need');
P.onPose(socks.get(A.aid), A); t(got(A, 'pfound').length === 0, 'standing at the spawn finds nothing');
A.x = -24; A.z = -33; P.onPose(socks.get(A.aid), A); t(got(A, 'pfound').length === 1 && got(A, 'pfound')[0].ids[0] === 'ruins', 'walking into the ruins finds them');
P.onPose(socks.get(A.aid), A); t(got(A, 'pfound').length === 1, 'found once');
let T = 1e6;
A.x = -20; A.z = -30; P.pdig(socks.get(A.aid), A, { id: 'ruins' }, T); t(got(A, 'pdig').length === 0 && got(A, 'say').length === 1, 'out of reach: no dig');
A.x = -24.27; A.z = -35.2;
P.pdig(socks.get(A.aid), A, { id: 'ruins' }, (T += 600)); t(got(A, 'pdig').at(-1).n === 1, 'one swing counts');
P.pdig(socks.get(A.aid), A, { id: 'ruins' }, (T += 100)); t(got(A, 'pdig').at(-1).n === 1, 'swinging faster than a person can does not count');
P.pdig(socks.get(B.aid), B, { id: 'ruins' }, (T += 50)); t(got(B, 'pdig').at(-1).n === 2, 'a second person moves the same rubble');
for (let i = 0; i < 6; i++) { P.pdig(socks.get(A.aid), A, { id: i % 2 ? 'ruins' : 'ruins' }, (T += 600)); }
t(got(A, 'grant').length === 1 && got(B, 'grant').length === 1, 'when it gives way both who helped get the materials');
t(got(A, 'grant')[0].give['mat:stone'] === 3, 'the loot comes from the server data');
t(sql.exec("SELECT id FROM items WHERE k = 'hearthstone'").toArray().length === 1, 'one hearthstone on the ground');
P.pdig(socks.get(A.aid), A, { id: 'ruins' }, (T += 600)); t(got(A, 'grant').length === 1 && /Nothing more/.test(got(A, 'say').at(-1).text), 'dug out: nothing more until it settles');
P.pdig(socks.get(A.aid), A, { id: 'ruins' }, (T += 91e3)); t(got(A, 'pdig').at(-1).n === 1, 'after the refill the dig starts again');
t(sql.exec("SELECT id FROM items WHERE k = 'hearthstone'").toArray().length === 1, 'still only one hearthstone (the first was never taken away)');
P.pdig(socks.get(A.aid), A, { id: 'zzz' }, (T += 600)); t(strikes.includes('pdig-id'), 'unknown dig is a strike');
const C = mk('c'.repeat(32), 'Cy', 30, -34, 5.0); P.onPose(socks.get(C.aid), C); t(got(C, 'pfound').some((m) => m.all && m.ids.length >= 5), 'the top of the lookout shows every place');
const D2 = mk('d'.repeat(32), 'Di', 30, -34, 0); D2.world = 'home:' + 'd'.repeat(32); P.onPose(socks.get(D2.aid), D2); t(got(D2, 'pfound').length === 0, 'other worlds keep the old game');
const E = mk('e'.repeat(32), 'Eve', 2, -51.4, 3.0); P.onPose(socks.get(E.aid), E); t(!got(E, 'pfound').some((m) => m.ids.includes('seacave')), 'standing on the headland above the cave does not find it');
P.pdig(socks.get(E.aid), E, { id: 'seacave' }, (T += 600)); t(!got(E, 'pdig').length, 'nor dig the shelf through the rock');
E.y = 0.1; P.onPose(socks.get(E.aid), E); t(got(E, 'pfound').some((m) => m.ids.includes('seacave')), 'on the shelf inside: the sea cave is found');
t(!got(C, 'pfound').some((m) => m.ids.includes('seacave')), 'the lookout does not show the sea cave');
const F = mk('f'.repeat(32), 'Fay', -1.37, -26.5);
for (let i = 0; i < 4; i++) P.ntake(socks.get(F.aid), F, { id: 'drift1' }, (T += 600));
t(got(F, 'grant').length === 3 && got(F, 'grant')[0].give['mat:wood'] === 1, 'driftwood: three pieces, then nothing');
t(/washes up/.test(got(F, 'say').at(-1).text), 'and it says so');
P.ntake(socks.get(F.aid), F, { id: 'drift1' }, (T += 20 * 60e3 + 10)); t(got(F, 'grant').length === 4, 'one piece comes back after a while');
F.x = 20; P.ntake(socks.get(F.aid), F, { id: 'reed0' }, (T += 600)); t(got(F, 'grant').length === 4, 'out of reach: no reeds');
P.ntake(socks.get(F.aid), F, { id: 'nope9' }, (T += 600)); t(strikes.includes('ntake-id'), 'unknown spot is a strike');
// fish at the cove: a shared stock, a real fish in your hands, a human pace
{ const G = mk('9'.repeat(32), 'Gus', 2, -40), H = mk('8'.repeat(32), 'Hal', 2, -26);
  const fish = () => sql.exec("SELECT holder FROM items WHERE k = 'fish'").toArray();
  P.catch(socks.get(G.aid), G, (T += 7000)); t(fish().length === 1 && fish()[0].holder === G.aid, 'a catch at the cove is a fish in your hands');
  P.catch(socks.get(G.aid), G, (T += 1000)); t(fish().length === 1, 'not two catches a second apart');
  for (let i = 0; i < 3; i++) P.catch(socks.get(G.aid), G, (T += 7000));
  t(fish().filter((f) => f.holder === G.aid).length === 3 && fish().length === 4, 'three in the hands, the fourth at your feet');
  for (let i = 0; i < 4; i++) P.catch(socks.get(H.aid), H, (T += 7000));
  t(fish().length === 8, 'the other player fishing the same cove takes from the same stock');
  P.catch(socks.get(H.aid), H, (T += 7000)); t(fish().length === 8 && got(H, 'fishout').length === 1, 'then it is fished out for both');
  P.catch(socks.get(G.aid), G, (T += 6 * 60e3)); t(fish().length === 9, 'one comes back after a while');
  const J = mk('7'.repeat(32), 'Jo', 30, 30); P.catch(socks.get(J.aid), J, (T += 7000)); t(fish().length === 9, 'not at the cove: no fish from the server'); }
console.log(`places: ${ok} ok, ${bad} failed`); process.exit(bad ? 1 : 0);
