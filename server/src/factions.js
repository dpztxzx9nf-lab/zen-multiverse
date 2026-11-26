// Factions on the server: the authority for who did what, who saw it and what each world's people remember.
// The simulation itself is js/factions/sim.js (shared with the offline game); this file stores it in the
// World DO's SQLite, checks every act against where the server saw the player (and the act's own rules:
// the target exists, is in the right state, within reach), sends each client its own view, writes news
// that couriers carry off the world into D1, and brings in news that has had time to arrive.
// Optional protocol ({t:'fa'}): the server says fa:1 in 'hi'; a client that understands says hello.
// Old clients never send 'fa' and never receive it (their poses still leave footprints, as they should).
import D from '../../js/factions/factions.json';
import { createScene, createSim, transitMs, worldName } from '../../js/factions/sim.js';

const ACT_EVERY = 700, TALK_EVERY = 250, LOOK_EVERY = 1200, NEWS_EVERY = 20e3, SAVE_EVERY = 2500, TALK_R = 4.5;
const ID_RE = /^[a-z0-9-]{1,40}$/;
const hyp = Math.hypot;

export class Factions {
  constructor(w) {
    this.w = w; this.sql = w.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS fa (k TEXT PRIMARY KEY, data TEXT NOT NULL)');
    this.sim = undefined; this.dirty = false; this.saved = 0; this.newsT = 0;
    this.scale = w.env && w.env.LOCAL_DEV === '1' ? Math.max(1, +(w.env.FA_TIME_SCALE || 360)) : 1; // local dev: news crosses worlds in seconds
  }
  key(a) { return (a.world || '').split('#')[0]; }
  pKPa(a) { return a.kind === 'moon' ? 0 : 101.325; }
  // the world's people (created on first need: home = the garden frame, elsewhere near the first arrival)
  load(a, create) {
    if (this.sim !== undefined && this.sim) return this.sim;
    const row = this.sql.exec("SELECT data FROM fa WHERE k = 'state'").toArray()[0];
    let st = row ? JSON.parse(row.data) : null;
    if (!st) {
      if (!create) return null;
      if (a.kind === 'home') st = createScene(D, 'home', { x: 0, z: 0, tile: null });
      else { if (a.x == null) return null; st = createScene(D, 'outpost', { x: a.x, z: a.z, tile: a.tile || null }); }
      this.dirty = true;
    }
    this.sim = createSim(D, st, { pKPa: this.pKPa(a), world: this.key(a), label: worldName(this.key(a)) });
    return this.sim;
  }
  save(force) {
    if (!this.sim || !this.dirty) return;
    const t = Date.now(); if (!force && t - this.saved < SAVE_EVERY) return;
    this.sql.exec("INSERT OR REPLACE INTO fa (k, data) VALUES ('state', ?)", JSON.stringify(this.sim.st));
    this.dirty = false; this.saved = t;
  }
  here(a) { return this.sim && a.x != null && (a.tile || null) === (this.sim.st.anchor.tile || null); }
  socks() { return this.w.ctx.getWebSockets().filter((s) => this.w.att(s)?.fa); }
  push(aid, m) { for (const s of this.w.ctx.getWebSockets(aid)) if (this.w.att(s)?.fa) this.w.send(s, { t: 'fa', ...m }); }
  viewTo(ws, a, t) { this.w.send(ws, { t: 'fa', k: 'view', st: t, view: this.sim.view(a.aid, t) }); }
  viewAll(t) { for (const s of this.socks()) { const o = this.w.att(s); if (o) this.viewTo(s, o, t); } }

  // after anything moves the clock: ambushes, news leaving, state to disk
  async settle(t) {
    const ev = this.sim.drainEvents();
    for (const e of ev) {
      if (e.k === 'ambush') this.push(e.aid, { k: 'ambush', npc: e.npc, name: e.name, seize: e.seize, rough: e.rough });
    }
    if (ev.length) this.viewAll(t);
    const out = this.sim.drainOut();
    if (out.length) {
      try {
        const db = this.w.env.DB;
        await db.batch(out.map((n) => db.prepare('INSERT OR IGNORE INTO fa_news (id, faction, subject, act, data, origin, at, dep) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .bind(n.id, n.f, n.s, n.act, JSON.stringify(n), n.origin, n.at, n.dep)));
      } catch (e) { console.warn('[fa] news out', e && e.message); }
    }
    this.dirty = true; this.save();
  }
  // news about the people here that has had time to travel from wherever it happened
  async news(t, force, a) {
    if (!force && t - this.newsT < NEWS_EVERY) return 0;
    this.newsT = t;
    const me = this.key(a);
    const aids = [...new Set(this.w.ctx.getWebSockets().map((s) => this.w.att(s)?.aid).filter(Boolean))].slice(0, 32);
    if (!aids.length || !me) return 0;
    let got = 0;
    try {
      const q = `SELECT data, origin, dep FROM fa_news WHERE subject IN (${aids.map(() => '?').join(',')}) AND origin != ? ORDER BY dep DESC LIMIT 300`;
      const rows = (await this.w.env.DB.prepare(q).bind(...aids, me).all()).results || [];
      const ready = [];
      for (const r of rows) {
        if (r.dep + transitMs(D, r.origin, me, this.scale) > t) continue;
        const n = JSON.parse(r.data); ready.push({ ...n, originName: worldName(r.origin) });
      }
      got = this.sim.receive(ready.reverse(), t);
      if (got) this.dirty = true;
    } catch (e) { console.warn('[fa] news in', e && e.message); }
    return got;
  }
  async bonds(aid) {
    try { return ((await this.w.env.DB.prepare('SELECT kind, faction, npc, world, at FROM fa_bonds WHERE aid = ?').bind(aid).all()).results || []); } catch { return []; }
  }

  onPose(a, t) {
    if (!this.load(a, false) || !this.here(a)) return;
    this.sim.pose(a.aid, a.x, a.z, t, a.name);
    this.dirty = true;
    if (t - (this.lastAdv || 0) > 1000) { this.lastAdv = t; this.sim.advance(t); this.settle(t).catch(() => {}); }
  }

  async onMsg(ws, a, m, t) {
    const k = m.k;
    if (k === 'hello') {
      a.fa = 1; ws.serializeAttachment(a);
      if (!this.load(a, true)) { this.w.send(ws, { t: 'fa', k: 'wait' }); return; } // outpost: placed once we know where you are
      this.sim.advance(t); await this.news(t, true, a); await this.settle(t);
      const known = await this.bonds(a.aid);
      this.w.send(ws, { t: 'fa', k: 'view', st: t, view: this.sim.view(a.aid, t), known });
      return;
    }
    if (!a.fa || !this.load(a, false)) return this.w.strike(ws, a, 1, 'fa-order');
    if (k === 'look') {
      if (t - (a.faL || 0) < LOOK_EVERY) return; a.faL = t; ws.serializeAttachment(a);
      this.sim.advance(t); await this.news(t, false, a); await this.settle(t);
      this.viewTo(ws, a, t); return;
    }
    const id = typeof m.id === 'string' && ID_RE.test(m.id) ? m.id : null;
    if (!id) return this.w.strike(ws, a, 2, 'fa-shape');
    const busy = k === 'talk' || k === 'gate' ? TALK_EVERY : ACT_EVERY;
    if (t - (a.faA || 0) < busy) return this.w.send(ws, { t: 'fa', k: k === 'act' ? 'did' : k, ok: false, why: 'slow', id }); a.faA = t; ws.serializeAttachment(a);
    if (!this.here(a)) return this.w.send(ws, { t: 'fa', k: 'did', ok: false, why: 'not-here', id });
    const me = { x: a.x, z: a.z };
    if (k === 'act') {
      const act = typeof m.act === 'string' && D.acts[m.act] ? m.act : null;
      if (!act) return this.w.strike(ws, a, 2, 'fa-act');
      // a gift is a real object (server/src/games.js items): it has to be in your hands, and it leaves them
      const G = this.w.games, gift = D.acts[act].on === 'gift' ? (G ? G.held(a.aid).find((i) => i.k === D.acts[act].needs) : null) : undefined;
      if (gift === null) return this.w.send(ws, { t: 'fa', k: 'did', id, act, ok: false, why: 'not-holding', seen: [] });
      const r = this.sim.act(a.aid, act, id, me, t, a.name);
      if (r.ok && gift) { G.sql.exec('DELETE FROM items WHERE id = ?', gift.id); G.pushItems(); }
      if (!r.ok && (r.why === 'too-far' || r.why === 'no-target' || r.why === 'no-such-act')) { await this.w.flag(a, 'fa-spoof', `${act} ${id} ${r.why}`); await this.w.strike(ws, a, 1, 'fa-spoof'); }
      this.w.send(ws, { t: 'fa', k: 'did', id, act, ok: r.ok, why: r.why || null, give: r.give || null, take: r.take || null, seen: r.ok ? r.seen.map((s) => ({ name: s.name, f: s.f, by: s.by })) : [] });
      if (r.ok) { await this.settle(t); this.viewAll(t); this.save(true); }
      return;
    }
    const n = this.sim.st.npcs[id];
    if (!n) return this.w.strike(ws, a, 1, 'fa-who');
    const p = this.sim.pos(n, t);
    if (hyp(p.x - a.x, p.z - a.z) > TALK_R) return this.w.send(ws, { t: 'fa', k: 'talk', id, far: true });
    const known = Object.fromEntries((await this.bonds(a.aid)).map((b) => [b.kind, 1]));
    const tk = this.sim.talk(id, a.aid, t, known);
    if (k === 'talk') return this.w.send(ws, { t: 'fa', k: 'talk', id, name: n.name, f: n.f, ...tk });
    if (k === 'learn') {
      if (!tk.offers.includes('teach')) return this.w.send(ws, { t: 'fa', k: 'taught', id, ok: false });
      const skill = n.teaches;
      try { await this.w.env.DB.prepare('INSERT OR IGNORE INTO fa_bonds (aid, kind, faction, npc, world, at) VALUES (?, ?, ?, ?, ?, ?)').bind(a.aid, skill, n.f, n.name, this.key(a), t).run(); } catch (e) { console.warn('[fa] bond', e && e.message); }
      return this.w.send(ws, { t: 'fa', k: 'taught', id, ok: true, skill, how: D.teach[skill]?.how || '' });
    }
    if (k === 'gate') return this.w.send(ws, { t: 'fa', k: 'gate', id, open: tk.offers.includes('gate') });
    if (k === 'trade') {
      const c = Object.values(this.sim.st.caches).find((x) => x.f === n.f);
      if (!tk.offers.includes('trade') || !c || !(c.goods.food > 0)) return this.w.send(ws, { t: 'fa', k: 'traded', id, ok: false });
      c.goods.food -= 1; this.dirty = true; this.save();
      return this.w.send(ws, { t: 'fa', k: 'traded', id, ok: true, got: { food: 1 } });
    }
    return this.w.strike(ws, a, 1, 'fa-k');
  }
  onClose() { this.save(true); }
}
