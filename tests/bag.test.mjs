// The game's bag kept in step with the server's (js/bag.js + js/game/store.js against the real server/src/bag.js
// over a D1 stand-in): the old save moves in once, every change is asked and counted once (even when a reply is lost
// and it is sent again), a save edited by hand shows the server's truth, and offline changes are sent on reconnect.
// node tests/bag.test.mjs
globalThis.localStorage = { _s: {}, getItem(k) { return this._s[k] ?? null; }, setItem(k, v) { this._s[k] = String(v); }, removeItem(k) { delete this._s[k]; } };
globalThis.location = { search: '', hostname: 'localhost', href: 'http://localhost/' }; globalThis.window = globalThis; globalThis.addEventListener = () => {}; globalThis.document = { addEventListener() {}, visibilityState: 'visible' };
const { game } = await import('../js/game/store.js');
const B = await import('../js/bag.js');
const { Bag } = await import('../server/src/bag.js');
const { d1 } = await import('../server/test/lib/d1mock.mjs');
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// the server side: one world over one D1
const w = { env: { DB: d1() }, flag: async () => {}, send: (s, m) => { if (!dropNext) setImmediate(() => B.onMsg(m)); else dropNext--; } };
w.bag = new Bag(w);
let dropNext = 0, sentOps = 0;
const a = { aid: 'e'.repeat(32), name: 'Brock' }, ws = { a, serializeAttachment() {} };
const server = () => w.bag.inv({ ...a, bag: true });
const connect = () => B.online({ send: (o) => { if (o.k === 'ops') sentOps++; w.bag.msg(ws, a, o, Date.now()); } });

// a save from before the server bag
game.add('mat:wood', 30); game.add('fx:chest', 1);
const seeds = game.count('seed:snapdragon');
B.account(a.aid); connect(); await wait(50);
let s = await server();
ok(s['mat:wood'] === 30 && s['fx:chest'] === 1 && s['seed:snapdragon'] === seeds, 'first time online: the save\'s bag moves onto the server');
ok(B.state().live && game.data.bagLocal && game.data.bagLocal.inv['mat:wood'] === 30, 'and the save keeps a copy of the bag it had');
// a change is asked and counted once
game.add('mat:wood', 5); game.take('fx:chest', 1); await wait(900);
s = await server();
ok(s['mat:wood'] === 35 && !s['fx:chest'] && B.state().pending === 0, 'wood gathered and a crate used: the server has it, nothing waiting');
// a save edited by hand: the server's bag is what shows
game.data.inv['fx:safe'] = 5; game.add('fx:safe', 3); await wait(900);
ok(!(await server())['fx:safe'] && !game.count('fx:safe'), 'a save edited to hold safes: the server never had them and the bag shows none');
// offline: changes wait in the save and go on reconnect, counted once even if the reply is lost
B.offline(); game.take('mat:wood', 10); game.add('fibre', 8); await wait(900);
ok(B.state().pending === 2 && (await server())['mat:wood'] === 35, 'offline: two changes wait (the server still says 35 wood)');
dropNext = 1; connect(); await wait(30); // the bag reply to hi is lost... the client is not live, asks again on the next connect
B.offline(); connect(); await wait(900);
s = await server();
ok(s['mat:wood'] === 25 && s.fibre === 8 && game.count('mat:wood') === 25, 'back online: sent and counted (25 wood, 8 fibre)');
game.add('mat:stone', 4); await wait(50);
const before = sentOps; dropNext = 1; await wait(900); // the ops reply is lost on the way back
ok(sentOps > before && (await server())['mat:stone'] === 4, 'the server did it though the reply was lost');
B.offline(); connect(); await wait(1200);
ok((await server())['mat:stone'] === 4 && B.state().pending === 0, 'sent again on reconnect: still 4 stone, not 8');
// a recipe made by hand is one ask: the server pays and makes it
game.made('cloth', () => { game.pay({ fibre: 4 }); game.add('cloth', 1); }); await wait(900);
s = await server();
ok(s.cloth === 1 && s.fibre === 4 && game.count('cloth') === 1, 'cloth woven by hand: 4 fibre paid, 1 cloth, on the server');
// what the server did itself (a box, a find) is shown quietly, not asked again
await w.bag.give({ ...a, bag: true }, { 'find:agate': 2 }); game.quiet(() => game.add('find:agate', 2)); await w.bag.push(ws, { ...a, bag: true, dev: game.data.bagq.dev }); await wait(900);
ok((await server())['find:agate'] === 2 && game.count('find:agate') === 2, 'a find handed over by the server: 2 agates, not 4');
// signing in as someone else on this device: their bag, nothing of the first account carried over
const b = { aid: 'f'.repeat(32), name: 'Cousin' }; ws.a = b; a.aid = b.aid; delete a.bag; delete a.dev;
B.account(b.aid); connect(); await wait(900);
const sb = await w.bag.inv({ aid: b.aid });
ok(!Object.keys(sb).length && B.state().aid === b.aid && !game.count('mat:wood'), 'another account on this device: the save already moved into the first one, so it starts empty (no copying one save into many)');
ok(game.data.bagLocal && game.data.bagLocal.aid === b.aid && game.data.bagLocal.inv['mat:wood'] === 25, 'what the device showed before is kept in the save (never thrown away)');
console.log(fails ? `${fails} FAILED` : 'all passed'); process.exit(fails ? 1 : 0);
