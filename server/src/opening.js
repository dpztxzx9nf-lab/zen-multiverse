// Ula's opening walk on the server (js/opening.js has the wording). Each step moves only when the real system
// did the thing: places.js says a node gave up wood or reeds, a recipe was made where it can be made, the cove's
// stock gave a fish, builds.js stood two pieces up by the water, factions.js took a fish into a camp's cache.
// Two people doing it together: when one of them does a step, a partner on the same step within a stone's throw
// gets it too (they were there, carrying the other end). Old clients never see {k:'open'} and lose nothing.
// Protocol (inside {t:'g'}): client {k:'made', id}; server {k:'open', step, n, text, by}.
import { OPEN_STEPS, OPEN_DONE, OPEN_TOGETHER_R, OPEN_BUILD_R, OPEN_BENCH_R, WORKSHOP } from '../../js/opening.js';
import { RECIPES } from '../../js/game/g7/craft.js';
import { atCove } from '../../js/places.js';
import { SHARED_HOME } from '../../js/spawn.js';

const RECIPE = Object.fromEntries(RECIPES.map((r) => [r.id, r]));
const MADE_EVERY = 1500;          // ms between two "made" claims (a hand can only work so fast)
const DONE = OPEN_STEPS.length + 1;

export class Opening {
  constructor(w, games) {
    this.w = w; this.g = games; this.sql = w.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS opening (aid TEXT PRIMARY KEY, step INTEGER NOT NULL, n INTEGER NOT NULL DEFAULT 0, ts INTEGER)');
    this.last = new Map();
  }
  here(a) { return a && (a.world || '').split('#')[0] === SHARED_HOME && (a.tile || null) === null; }
  of(aid) { const r = this.sql.exec('SELECT step, n FROM opening WHERE aid = ?', aid).toArray()[0]; return r ? { step: r.step, n: r.n } : { step: 0, n: 0 }; }
  set(aid, step, n, t) { this.sql.exec('INSERT OR REPLACE INTO opening (aid, step, n, ts) VALUES (?, ?, ?, ?)', aid, step, n, t); }
  wire(aid) { const o = this.of(aid); return o.step ? { step: o.step, n: o.n } : null; }
  // Ula speaks (games.talk): returns her line for this person, starting the walk for anyone close enough to hear
  talk(a, t, hearers) {
    const o = this.of(a.aid);
    if (o.step >= DONE) return null; // done: she goes back to her own business (the geode, her stories)
    if (o.step === 0) {
      for (const h of hearers) if (h.aid !== a.aid && this.here(h) && this.of(h.aid).step === 0) { this.set(h.aid, 1, 0, t); this.tell(h, 1, 0, OPEN_STEPS[0].ask, a.name); }
      this.set(a.aid, 1, 0, t); return { step: 1, text: OPEN_STEPS[0].ask };
    }
    const s = OPEN_STEPS[o.step - 1];
    return { step: o.step, text: s.need ? `${s.ask} (${o.n} of ${s.need} so far.)` : s.ask };
  }
  tell(a, step, n, text, by) { const s = this.g.sock(a.aid); if (s) this.w.send(s, { t: 'g', k: 'open', step, n, text, by: by || null }); }
  // something real happened; ev is the step id it proves
  did(a, ev, t, near = true) {
    if (!this.here(a)) return;
    const o = this.of(a.aid);
    if (o.step < 1 || o.step >= DONE || OPEN_STEPS[o.step - 1].id !== ev) return;
    const mates = near ? this.g.present().filter((p) => p.aid !== a.aid && this.here(p) && p.x != null && a.x != null
      && Math.hypot(p.x - a.x, p.z - a.z) <= OPEN_TOGETHER_R && this.of(p.aid).step === o.step) : [];
    this.step(a, o, t, null);
    for (const p of mates) this.step(p, this.of(p.aid), t, a.name);
  }
  step(a, o, t, by) {
    const s = OPEN_STEPS[o.step - 1], n = o.n + 1;
    if (s.need && n < s.need) { this.set(a.aid, o.step, n, t); return this.tell(a, o.step, n, `${s.short}: ${n} of ${s.need}.`, by); }
    const next = o.step + 1;
    this.set(a.aid, next, 0, t);
    if (next >= DONE) {
      this.g.bump(a.aid, a.name, { quests: 1 });
      this.w.broadcast({ t: 'g', k: 'board', board: this.g.board() });
      return this.tell(a, DONE, 0, OPEN_DONE, by);
    }
    this.tell(a, next, 0, OPEN_STEPS[next - 1].ask, by);
  }
  // the client made a recipe (crafting lives on the client): believed only where and as fast as it could happen
  made(ws, a, m, t) {
    if (!this.here(a) || a.x == null) return;
    const r = typeof m.id === 'string' ? RECIPE[m.id] : null;
    if (!r) return this.w.strike(ws, a, 1, 'made-id');
    if (t - (this.last.get(a.aid) || 0) < MADE_EVERY) return; this.last.set(a.aid, t);
    if (r.station && !this.atBench(a)) return;
    this.did(a, 'craft', t);
  }
  atBench(a) {
    if (Math.hypot(a.x - WORKSHOP.x, a.z - WORKSHOP.z) <= OPEN_BENCH_R) return true;
    return this.g.bd.hub().some((p) => p.type === 'bench' && Math.hypot(a.x - p.x, a.z - p.z) <= OPEN_BENCH_R);
  }
  // builds.js stood a piece up
  built(a, p, t) { if (atCove(p.x, p.z, OPEN_BUILD_R)) this.did(a, 'build', t); }
}
