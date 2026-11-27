// The bag on the server (js/game/bag-rules.js has the rules, migrations/0003_bag.sql the tables). Signed in, every
// count in a player's bag lives here, in D1, so it is the same in every world. The client shows it and asks:
//   client {t:'b', k:'hi', dev}            this device (a random id it keeps); the server answers with the bag
//          {t:'b', k:'imp', inv}           first time only: the save's old bag moves onto the server (cleaned, capped)
//          {t:'b', k:'ops', ops:[[seq, o, id, n]]}   numbered asks from this device: '-' spend, '+' the world gave
//                                          it, 'c' a recipe made offline (id = recipe). Each number is done once (a resend
//                                          after a dropped connection counts nothing twice).
//   server {t:'b', k:'bag', inv, seq, imp, rej}   the bag as it is, the last op done, the ones refused [seq, why, n]
// Everything else that moves bag items (a box, a craft at a station, a build, a find, a trade) is done here by the
// server itself, through take/give/swap below, and the client only shows it.
//
// Why it can't be duped: a spend is n = n - k in one D1 batch (a transaction) and the table says CHECK (n >= 0), so a
// bag that doesn't have it fails the whole batch and nothing moves, even with two worlds spending at once. Within one
// world, one account's bag moves go one at a time (serial).
import { itemOk, tokensNow, budgetOf, tierOf, cleanImport, resolve, RECIPE, recipeOut, BAG_MAX, ESC_MAX, OPS_MAX, IMPORT_CAP, NEW_CAP, BAG_SINCE } from '../../js/game/bag-rules.js';

const DEV_RE = /^[A-Za-z0-9_-]{8,32}$/;
const okN = (n) => Number.isInteger(n) && n > 0 && n <= BAG_MAX;
const isGuard = (e) => /CHECK|constraint|bag-op-again/i.test(String((e && e.message) || e));
export const goods = (o) => (o && typeof o === 'object' ? Object.entries(o).filter(([k, n]) => itemOk(k) && okN(n)) : []);

export class Bag {
  constructor(w) { this.w = w; this.lk = new Map(); }
  get db() { return this.w.env && this.w.env.DB; }
  get live() { return !!this.db; }
  // one account's bag moves, one at a time in this world
  serial(aid, fn) {
    const prev = this.lk.get(aid) || Promise.resolve();
    const p = prev.then(() => fn());
    const tail = p.then(() => {}, () => {}); this.lk.set(aid, tail);
    tail.then(() => { if (this.lk.get(aid) === tail) this.lk.delete(aid); });
    return p;
  }
  // ---- statements
  ins(aid, id, now) { return this.db.prepare('INSERT OR IGNORE INTO bag (aid, item, n, esc, tok, tt) VALUES (?1, ?2, 0, 0, ?3, ?4)').bind(aid, id, budgetOf(id).burst, now); }
  sub(aid, id, n, esc) { return this.db.prepare(`UPDATE bag SET n = n - ?3${esc ? `, esc = MIN(esc + ?3, ${ESC_MAX})` : ''} WHERE aid = ?1 AND item = ?2`).bind(aid, id, n); }
  add(aid, id, n) { return this.db.prepare(`UPDATE bag SET n = MIN(n + ?3, ${BAG_MAX}) WHERE aid = ?1 AND item = ?2`).bind(aid, id, n); }
  dev(aid, dev, s) { return this.db.prepare('UPDATE bag_dev SET seq = ?3 WHERE aid = ?1 AND dev = ?2').bind(aid, dev, s); }
  // all of it or none of it (false = a guard said no: not enough, or an op number used before)
  async batch(list) { try { await this.db.batch(list); return true; } catch (e) { if (isGuard(e)) return false; throw e; } }
  moves(aid, cost, give, now, esc = false) {
    const out = [];
    for (const [k, n] of Object.entries(cost || {})) if (n > 0) out.push(this.ins(aid, k, now), this.sub(aid, k, n, esc));
    for (const [k, n] of Object.entries(give || {})) if (n > 0) out.push(this.ins(aid, k, now), this.add(aid, k, n));
    return out;
  }
  async readInv(aid) {
    const r = await this.db.prepare('SELECT item, n FROM bag WHERE aid = ?1 AND n > 0').bind(aid).all();
    const o = {}; for (const x of r.results || []) o[x.item] = x.n; return o;
  }

  // ---- what the rest of the server uses (a = a signed-in player whose client keeps its bag here: a.bag)
  on(a) { return !!(a && a.bag && this.db); }
  inv(a) { return this.serial(a.aid, () => this.readInv(a.aid)); }
  take(a, cost) { const c = Object.fromEntries(goods(cost)); return Object.keys(c).length ? this.serial(a.aid, () => this.batch(this.moves(a.aid, c, null, Date.now()))) : Promise.resolve(true); }
  give(a, give) { const g = Object.fromEntries(goods(give)); return Object.keys(g).length ? this.serial(a.aid, () => this.batch(this.moves(a.aid, null, g, Date.now()))) : Promise.resolve(true); }
  swap(a, cost, give) { return this.serial(a.aid, () => this.batch(this.moves(a.aid, Object.fromEntries(goods(cost)), Object.fromEntries(goods(give)), Date.now()))); }
  // take up to n of each (a faction taking back what is owed: what you have of it)
  takeUpTo(a, cost) {
    return this.serial(a.aid, async () => {
      const inv = await this.readInv(a.aid), c = {};
      for (const [k, n] of goods(cost)) if (inv[k]) c[k] = Math.min(n, inv[k]);
      return Object.keys(c).length ? (await this.batch(this.moves(a.aid, c, null, Date.now()))) && c : {};
    });
  }
  // a recipe made by the server's say-so (a station craft): pay what this bag really has, add what it makes
  craft(a, r) {
    return this.serial(a.aid, async () => {
      const inv = await this.readInv(a.aid), paid = resolve(r.cost, inv);
      if (!paid) return null;
      return (await this.batch(this.moves(a.aid, paid, recipeOut(r), Date.now()))) ? paid : null;
    });
  }
  // the bag as it is now, to this player (after every change, in order with the change)
  push(ws, a, extra) {
    return this.serial(a.aid, async () => {
      const inv = await this.readInv(a.aid);
      const d = a.dev ? await this.db.prepare('SELECT seq FROM bag_dev WHERE aid = ?1 AND dev = ?2').bind(a.aid, a.dev).first() : null;
      this.w.send(ws, { t: 'b', k: 'bag', inv, seq: d ? d.seq : 0, imp: true, ...(extra || {}) });
    });
  }
  // after a change made by some handler: tell this player (errors are logged, never thrown at the socket)
  async show(ws, a) { if (this.on(a)) { try { await this.push(ws, a); } catch (e) { console.warn('[bag] push', e && e.message); } } }

  // ---- the client's own messages
  async msg(ws, a, m, t) {
    if (!this.db) return this.w.send(ws, { t: 'b', k: 'no', why: 'off' });
    switch (m.k) {
      case 'hi': return this.hi(ws, a, m, t);
      case 'imp': return this.imp(ws, a, m, t);
      case 'ops': return this.ops(ws, a, m, t);
      case 'dev': return this.devGive(ws, a, m, t);
      default: return this.w.send(ws, { t: 'b', k: 'no', why: 'kind' });
    }
  }
  async hi(ws, a, m) {
    const dev = typeof m.dev === 'string' && DEV_RE.test(m.dev) ? m.dev : null;
    if (!dev) return this.w.send(ws, { t: 'b', k: 'no', why: 'dev' });
    a.dev = dev;
    await this.db.prepare('INSERT OR IGNORE INTO bag_dev (aid, dev, seq) VALUES (?1, ?2, 0)').bind(a.aid, dev).run();
    const meta = await this.db.prepare('SELECT imported FROM bag_meta WHERE aid = ?1').bind(a.aid).first();
    a.bag = !!meta; ws.serializeAttachment(a);
    if (!meta) return this.w.send(ws, { t: 'b', k: 'bag', inv: {}, seq: 0, imp: false });
    return this.push(ws, a);
  }
  // the old save's bag, once per account: cleaned (known items only, whole counts, capped), all in one batch with the
  // row that says it is done (a second import, from this device or another, fails as a whole and changes nothing)
  async imp(ws, a, m, t) {
    if (!a.dev) return this.w.send(ws, { t: 'b', k: 'no', why: 'hi-first' });
    let raw = m.inv && typeof m.inv === 'object' && !Array.isArray(m.inv) ? m.inv : {};
    // a save moves into one account (this device's went into another already: this one starts empty), and an
    // account made since the server bag brings only a little (js/game/bag-rules.js NEW_CAP)
    const used = await this.db.prepare('SELECT aid FROM bag_meta WHERE dev = ?1 AND aid != ?2 LIMIT 1').bind(a.dev, a.aid).first();
    const acc = await this.db.prepare('SELECT created FROM accounts WHERE id = ?1').bind(a.aid).first().catch(() => null);
    const fresh = !acc || !(acc.created < BAG_SINCE);
    const note = used ? [['device-already-moved', Object.keys(raw).length, 0]] : [];
    if (used) raw = {};
    const { inv, cut } = cleanImport(raw, fresh ? NEW_CAP : IMPORT_CAP); cut.push(...note);
    const done = await this.serial(a.aid, async () => {
      const list = [this.db.prepare('INSERT INTO bag_meta (aid, imported, src, dev) VALUES (?1, ?2, ?3, ?4)').bind(a.aid, t, cut.length ? JSON.stringify(cut).slice(0, 1000) : null, a.dev)];
      for (const [k, n] of Object.entries(inv)) list.push(this.db.prepare(`INSERT INTO bag (aid, item, n, esc, tok, tt) VALUES (?1, ?2, ?3, 0, ?4, ?5) ON CONFLICT (aid, item) DO UPDATE SET n = MIN(bag.n + excluded.n, ${BAG_MAX})`).bind(a.aid, k, n, budgetOf(k).burst, t));
      try { await this.db.batch(list); return true; } catch (e) { if (/UNIQUE|constraint|PRIMARY/i.test(String(e && e.message))) return false; throw e; }
    });
    if (done && cut.length) await this.w.flag(a, 'bag-import-cut', JSON.stringify(cut));
    a.bag = true; ws.serializeAttachment(a);
    return this.push(ws, a, { moved: done ? Object.keys(inv).length : 0, cut: done ? cut.slice(0, 20) : [] });
  }
  async ops(ws, a, m, t) {
    if (!a.bag || !a.dev) return this.w.send(ws, { t: 'b', k: 'bag', inv: {}, seq: 0, imp: false });
    const list = Array.isArray(m.ops) ? m.ops.slice(0, OPS_MAX) : [];
    const rej = [], spoof = [];
    await this.serial(a.aid, async () => {
      const d = await this.db.prepare('SELECT seq FROM bag_dev WHERE aid = ?1 AND dev = ?2').bind(a.aid, a.dev).first();
      let seq = d ? d.seq : 0;
      const ordered = list.filter((op) => Array.isArray(op) && Number.isInteger(op[0]) && op[0] > seq && op[0] < 2 ** 52).sort((x, y) => x[0] - y[0]);
      for (const [s, o, id, n0] of ordered) {
        if (s <= seq) continue;
        const n = n0 === undefined ? 1 : n0, now = Date.now(), aid = a.aid, dv = this.dev(aid, a.dev, s);
        const skip = async (why, k) => { rej.push([s, why, k || 0]); await this.batch([dv]); seq = s; };
        if (o === 'c') {
          const r = typeof id === 'string' ? RECIPE[id] : null;
          // station recipes too: made at a station in your own world, offline (online, the station is checked by
          // scraft, server/src/storage.js). Either way the bag pays the whole cost here, so nothing is made from nothing.
          if (!r) { spoof.push(`c ${String(id).slice(0, 20)}`); await skip('bad'); continue; }
          const paid = resolve(r.cost, await this.readInv(aid));
          if (!paid || !(await this.batch([dv, ...this.moves(aid, paid, recipeOut(r), now)]))) { await skip('short'); continue; }
          seq = s; continue;
        }
        if ((o !== '+' && o !== '-') || !itemOk(id) || !okN(n)) { spoof.push(`${String(o).slice(0, 2)} ${String(id).slice(0, 30)} ${String(n).slice(0, 8)}`); await skip('bad'); continue; }
        if (o === '-') {
          if (!(await this.batch([dv, this.ins(aid, id, now), this.sub(aid, id, n, true)]))) { await skip('short', n); continue; }
          seq = s; continue;
        }
        // '+': first from what was spent here (escrow), then within the world's pace (budget)
        const row = await this.db.prepare('SELECT esc, tok, tt FROM bag WHERE aid = ?1 AND item = ?2').bind(aid, id).first();
        const esc = row ? row.esc : 0, tok = row ? tokensNow(id, row.tok, row.tt, now) : budgetOf(id).burst;
        const e = Math.min(n, esc), b = Math.min(n - e, Math.floor(tok)), acc = e + b;
        const up = this.db.prepare(`UPDATE bag SET n = MIN(n + ?3, ${BAG_MAX}), esc = esc - ?4, tok = ?5, tt = ?6 WHERE aid = ?1 AND item = ?2`).bind(aid, id, acc, e, tok - b, now);
        if (!(await this.batch([dv, this.ins(aid, id, now), up]))) { await skip('short', n); continue; }
        seq = s;
        if (acc < n) { rej.push([s, tierOf(id) === 'made' ? 'made' : 'pace', n - acc]); if (tierOf(id) === 'made' || n - acc > 50) spoof.push(`+ ${id} ${n - acc} over`); }
      }
    });
    if (spoof.length) await this.w.flag(a, 'bag-refused', spoof.slice(0, 6).join('; '));
    return this.push(ws, a, rej.length ? { rej: rej.slice(0, 32) } : null);
  }
  // local dev only (wrangler dev, LOCAL_DEV=1): put things in a test bag (shots, tests)
  async devGive(ws, a, m) {
    if (!(this.w.env && this.w.env.LOCAL_DEV === '1') || !a.bag) return this.w.send(ws, { t: 'b', k: 'no', why: 'dev-only' });
    await this.give(a, m.give); return this.push(ws, a);
  }
}
