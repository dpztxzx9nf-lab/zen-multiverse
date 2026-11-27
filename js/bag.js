// The bag, signed in: the server owns every count (server/src/bag.js, js/game/bag-rules.js). This keeps the game's
// bag (js/game/store.js) in step with it:
//   * every change the game makes is noted as an ask ('+' the world gave it, '-' spent, 'c' made by hand), numbered
//     on this device and kept in the save until the server has answered, so nothing is lost on a dropped connection
//     or a closed tab, and nothing counts twice when it is sent again
//   * the server answers with the bag as it is; the game shows that plus its own asks still on the way
//   * the first time an account comes online with this version, the save's bag moves onto the server (once per
//     account; cleaned and capped, see bag-rules.js cleanImport). The save keeps a copy of the bag it had then
//     (game.data.bagLocal) and is never thrown away.
// Signed out (or ?unlock=all) nothing here runs and the bag is the save's own, as before.
import { game, UNLOCK_ALL } from './game/store.js';
import { applyOps, OPS_MAX } from './game/bag-rules.js';

const FLUSH_MS = 700, ANSWER_MS = 8000, KEEP = 4000;
let send = null, aid = null, live = false, inflight = 0, flushT = 0, importing = false, last = null;
const rid = () => { const b = new Uint8Array(12); crypto.getRandomValues(b); return [...b].map((x) => (x % 36).toString(36)).join(''); };
function Q() {
  const g = game.data;
  if (!g.bagq || typeof g.bagq !== 'object' || !Array.isArray(g.bagq.ops)) g.bagq = { dev: rid(), seq: 0, aid: null, ops: [] };
  if (typeof g.bagq.dev !== 'string' || g.bagq.dev.length < 8) g.bagq.dev = rid();
  return g.bagq;
}
// this account is signed in on this device (null: signed out). From now on bag changes are asked of the server.
export function account(id) {
  if (UNLOCK_ALL) return;
  aid = id || null;
  if (!aid) { game.record(null); live = false; return; }
  const q = Q();
  if (q.aid !== aid) { q.ops = []; q.aid = aid; game.save(); } // asks noted for another account are not this one's
  game.record(note);
}
function note(o, id, n) {
  const q = Q(), end = q.ops[q.ops.length - 1];
  // one ask per run of the same change (a dig noting each voxel's soil), but never into one already sent
  if (end && !end.x && o !== 'c' && end.o === o && end.id === id) end.n += n;
  else q.ops.push({ s: ++q.seq, o, id, n });
  if (q.ops.length > KEEP) q.ops.splice(0, q.ops.length - KEEP); // a very long time offline: the oldest asks go
  soon();
}
function soon() { if (live && !flushT) flushT = setTimeout(flush, FLUSH_MS); }
function flush() {
  flushT = 0;
  if (!live || !send || inflight) return;
  const q = Q(), out = q.ops.filter((op) => !op.sent).slice(0, OPS_MAX);
  if (!out.length) return;
  for (const op of out) { op.sent = 1; op.x = 1; }
  inflight = setTimeout(() => { inflight = 0; for (const op of Q().ops) op.sent = 0; soon(); }, ANSWER_MS); // no answer: ask again (counted once)
  send({ k: 'ops', ops: out.map((op) => (op.o === 'c' ? [op.s, 'c', op.id] : [op.s, op.o, op.id, op.n])) });
}
// connected to a server that keeps bags: say which device this is (it answers with the bag)
export function online(o) {
  if (UNLOCK_ALL || !aid) return;
  send = o.send; live = false; importing = false; clearTimeout(inflight); inflight = 0;
  for (const op of Q().ops) op.sent = 0;
  send({ k: 'hi', dev: Q().dev });
}
export function offline() { live = false; send = null; clearTimeout(inflight); inflight = 0; clearTimeout(flushT); flushT = 0; for (const op of Q().ops) op.sent = 0; }
export function onMsg(m) {
  if (!aid || !send) return;
  if (m.k === 'no') { if (m.why === 'slow') { clearTimeout(inflight); inflight = 0; for (const op of Q().ops) op.sent = 0; setTimeout(soon, 1500); } return; }
  if (m.k !== 'bag') return;
  const q = Q();
  if (!m.imp) { // the first time: this save's bag moves onto the server (what was asked so far is in it already)
    if (importing) return; importing = true;
    const inv = {}; for (const [k, n] of Object.entries(game.data.inv || {})) if (Number.isFinite(n) && n > 0) inv[k] = Math.floor(n);
    game.data.bagLocal = { aid, at: Date.now(), inv: { ...inv } };
    q.ops = []; game.save();
    send({ k: 'imp', inv });
    return;
  }
  importing = false;
  if (!game.data.bagLocal || game.data.bagLocal.aid !== aid) { game.data.bagLocal = { aid, at: Date.now(), inv: { ...(game.data.inv || {}) } }; } // what this device had before it showed the server's bag
  const seq = Number.isInteger(m.seq) ? m.seq : 0;
  if (seq > q.seq) q.seq = seq; // a save restored from an older copy: number on from the server's count
  q.ops = q.ops.filter((op) => op.s > seq);
  if (inflight && !q.ops.some((op) => op.sent)) { clearTimeout(inflight); inflight = 0; }
  last = { inv: m.inv || {}, seq, rej: m.rej || [], at: Date.now(), moved: m.moved, cut: m.cut };
  live = true;
  game.setInv(applyOps(last.inv, q.ops));
  if (m.rej && m.rej.length) console.info('[bag] not counted', JSON.stringify(m.rej).slice(0, 200));
  if (q.ops.some((op) => !op.sent)) soon();
}
// for tests and the debug console
export const state = () => ({ aid, live, pending: Q().ops.length, dev: Q().dev, seq: Q().seq, last });
// local dev servers only: put things in a test bag (the server refuses this anywhere else)
export function devGive(give) { if (send) send({ k: 'dev', give }); }
if (typeof window !== 'undefined') window.__bag = { state, devGive };
