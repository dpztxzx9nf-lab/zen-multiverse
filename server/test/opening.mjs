// node server/test/opening.mjs: Ula's opening walk is retired (OPEN_ENABLED = false).
// The class still loads and keeps its table so old rows do not break, but talk/did never start a walk.
import { DatabaseSync } from 'node:sqlite';
import { Opening } from '../src/opening.js';
import { SHARED_HOME } from '../src/worlds.js';
import { OPEN_ENABLED, WORKSHOP } from '../../js/opening.js';
import { readFileSync } from 'node:fs';
let ok = 0, bad = 0; const t = (c, m) => { if (c) ok++; else { bad++; console.log('FAIL', m); } };
const db = new DatabaseSync(':memory:');
const sql = { exec(q, ...p) { if (!p.length && /CREATE/i.test(q)) { db.exec(q); return { toArray: () => [] }; } const st = db.prepare(q); const r = /^\s*select/i.test(q) ? st.all(...p) : (st.run(...p), []); return { toArray: () => r }; } };
const socks = new Map(), sent = new Map();
const mk = (aid, x, z) => { const a = { aid, name: aid.slice(0, 3), world: SHARED_HOME, tile: null, x, y: 0, z }; socks.set(aid, { a }); sent.set(aid, []); return a; };
const w = { sql, send: (ws, m) => sent.get(ws.a.aid).push(m), strike: () => {}, broadcast: () => {}, env: {} };
const games = { sock: (aid) => socks.get(aid) || null, present: () => [...socks.values()].map((s) => s.a), sys: () => {}, held: () => [], addItem: () => {}, pushItems: () => {}, bump: () => {}, board: () => [] };
const O = new Opening(w, games);
const A = mk('a'.repeat(32), 0, 0), B = mk('b'.repeat(32), 2, 0);
t(OPEN_ENABLED === false, 'the opening walk is off');
t(O.talk(A, 1e7, [A, B]) === null && O.of(A.aid).step === 0 && O.of(B.aid).step === 0, 'talking to Ula does not start a walk, even with someone standing by');
t(O.wire(A.aid) === null, 'the client is not sent an opening step');
O.did(A, 'gather', 1e7 + 1000);
O.built(A, { x: 0, z: -20 }, 1e7 + 2000);
O.made(socks.get(A.aid), A, { id: 'spear' }, 1e7 + 3000);
t(O.of(A.aid).step === 0 && sent.get(A.aid).length === 0 && sent.get(B.aid).length === 0, 'gather, craft and build do not move a retired walk or send open messages');
t(/SHED = \{ x: 20\.2, z: 2\.6/.test(readFileSync(new URL('../../js/game/earth-rocket.js', import.meta.url), 'utf8')) && WORKSHOP.x === 20.2 && WORKSHOP.z === 2.6, 'workbench spot still matches the shed');
console.log(bad ? `${bad} FAILED` : `${ok} PASSED`);
process.exit(bad ? 1 : 0);
