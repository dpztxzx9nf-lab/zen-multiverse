// node server/test/builds.mjs: the retired garden building (server/src/builds.js) and its support model.
// Xenia (0.2.20) moved building onto the hub frame as ordinary world builds (World.editBuild; live checks in
// server/test/xenia.mjs). Clients from before Xenia that still ask the old way get a word back, never a strike.
import { DatabaseSync } from 'node:sqlite';
import { Builds, grounded, standing } from '../src/builds.js';
import { SHARED_HOME } from '../src/worlds.js';
let ok = 0, bad = 0; const t = (c, m) => { if (c) ok++; else { bad++; console.log('FAIL', m); } };
const db = new DatabaseSync(':memory:');
const sql = { exec(q, ...p) { if (!p.length && /CREATE/i.test(q)) { db.exec(q); return { toArray: () => [] }; } const st = db.prepare(q); const r = /^\s*select/i.test(q) ? st.all(...p) : (st.run(...p), []); return { toArray: () => r }; } };
db.exec("CREATE TABLE builds (id TEXT PRIMARY KEY, tile TEXT NOT NULL, typ TEXT NOT NULL, mat TEXT NOT NULL, x REAL, y REAL, z REAL, yaw REAL, aid TEXT, ts INTEGER, rg TEXT)");
const sent = [], strikes = [];
const a = { aid: 'a'.repeat(32), world: SHARED_HOME, tile: null, x: 20, y: 0, z: -20 }, ws = { a };
const w = { sql, send: (s, m) => sent.push(m), strike: (s, x, n, why) => strikes.push(why) };
const B = new Builds(w, { sock: () => ws, present: () => [a] });
B.place(ws, a, { type: 'floor', mat: 'wood', x: 21, y: 0.1, z: -21, yaw: 0 }, 1e6);
B.place(ws, a, { type: 'tower', mat: 'gold', x: 'x' }, 1e6 + 300);
B.remove(ws, a, { id: 'nope' }, 1e6 + 600);
t(sent.length === 3 && sent.every((m) => m.k === 'bno' && /update the game/.test(m.text)), 'an old client asking to build gets told to update');
t(strikes.length === 0, 'never a strike, however odd the request');
t(B.all().length === 0, 'nothing goes into the old table');
db.prepare("INSERT INTO builds (id, tile, typ, mat, x, y, z, yaw, aid, ts) VALUES ('b1', '', 'bench', 'wood', 5, 0.45, 5, 0, 'x', 1), ('b2', '4:0:1', 'bench', 'wood', 5, 0.45, 5, 0, 'x', 1)").run();
t(B.hub().length === 1 && B.hub()[0].type === 'bench', 'hub(): world builds on the hub frame, in the old row shape');
// the support model (still used by the pieces' checks): the cove bank is lower than the lawn
t(grounded({ type: 'post', x: 2, y: -4.67 + 1 - 0.06, z: 330, yaw: 0 }), 'a post on the cove bed stands');
t(!grounded({ type: 'post', x: 2, y: 3, z: 330, yaw: 0 }), 'a post hanging over the cove does not');
t(standing([{ id: 'a', type: 'floor', x: 0, y: 0.1, z: 30, yaw: 0 }, { id: 'b', type: 'floor', x: 2, y: 0.1, z: 30, yaw: 0 }]).size === 2, 'standing: two floors side by side');
console.log(`builds: ${ok} ok, ${bad} failed`); process.exit(bad ? 1 : 0);
