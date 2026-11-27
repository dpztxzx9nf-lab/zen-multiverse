// The garden animals on the server (js/fauna.js is the simulation): stepped when people move in the shared
// home world (poses arrive several times a second; nobody moving = time stands still for them), sent to
// everyone there a few times a second, and the hunt / feed / brush intents checked against where the server
// saw you. Saved in DO storage now and then, so a tame hare is still tame tomorrow.
import { createFauna, stepFauna, faunaAct, wire } from '../../js/fauna.js';
import { SHARED_HOME } from './worlds.js';

const STEP_MS = 200, SEND_MS = 350, SAVE_MS = 15000, ACT_MS = 600;
export class Fauna {
  constructor(w, games) {
    this.w = w; this.g = games; this.sql = w.sql; this.lastStep = 0; this.lastSend = 0; this.lastSave = 0; this.last = new Map();
    this.sql.exec('CREATE TABLE IF NOT EXISTS fauna_state (k TEXT PRIMARY KEY, v TEXT NOT NULL);');
    const r = this.sql.exec("SELECT v FROM fauna_state WHERE k = 'home'").toArray()[0];
    try { this.st = r ? JSON.parse(r.v) : createFauna(); } catch { this.st = createFauna(); }
    if (!this.st || !Array.isArray(this.st.animals)) this.st = createFauna();
  }
  here(a) { return a && (a.world || '').split('#')[0] === SHARED_HOME && (a.tile || null) === null; }
  people() { return this.g.present().filter((o) => this.here(o) && o.x != null).map((o) => ({ aid: o.aid, x: o.x, z: o.z, sp: Math.min(9, (this.g.spd && this.g.spd.get(o.aid)) || 0) })); }
  step(t) {
    if (!this.lastStep) this.lastStep = t;
    let dt = (t - this.lastStep) / 1000; if (dt < STEP_MS / 1000) return false;
    this.lastStep = t; dt = Math.min(dt, 1.0); // gaps (nobody moving) don't fast-forward the hunt
    const P = this.people(); if (!P.length) return false;
    for (let s = dt; s > 1e-6; s -= 0.1) stepFauna(this.st, Math.min(0.1, s), P, t);
    return true;
  }
  send(t, force = false) {
    if (!force && t - this.lastSend < SEND_MS) return; this.lastSend = t;
    const m = { t: 'g', k: 'fauna', a: wire(this.st) };
    for (const o of this.g.present()) if (this.here(o)) { const s = this.g.sock(o.aid); if (s) this.w.send(s, m); }
    if (t - this.lastSave > SAVE_MS) this.save(t);
  }
  save(t) { this.lastSave = t; const s = { ...this.st, animals: this.st.animals.map(({ _lead, ...a }) => a) }; this.sql.exec("INSERT OR REPLACE INTO fauna_state (k, v) VALUES ('home', ?)", JSON.stringify(s)); }
  hello(ws, a) { if (this.here(a)) this.w.send(ws, { t: 'g', k: 'fauna', a: wire(this.st) }); }
  onPose(ws, a, t) { if (!this.here(a)) return; if (this.step(t)) this.send(t); }
  async act(ws, a, m, t) {
    if (!this.here(a) || a.x == null) return;
    const kind = { fhit: 'hit', ffeed: 'feed', fbrush: 'brush' }[m.k]; if (!kind || typeof m.id !== 'string' || m.id.length > 8) return this.w.strike(ws, a, 1, 'fauna-shape');
    if (t - (this.last.get(a.aid) || 0) < ACT_MS) return; this.last.set(a.aid, t);
    this.step(t);
    const r = faunaAct(this.st, kind, a.aid, { x: a.x, z: a.z }, m.id, t);
    this.w.send(ws, { t: 'g', k: 'fres', kind, id: m.id, ok: r.ok, why: r.why || null, text: r.text || null, tamed: !!r.tamed, killed: !!r.killed });
    if (r.ok && r.give) await this.g.grant(ws, a, { k: 'grant', why: 'node', give: r.give, text: r.text });
    if (r.ok && (r.killed || r.tamed)) { this.save(t); for (const o of this.g.present()) if (this.here(o) && o.aid !== a.aid && Math.hypot(o.x - a.x, o.z - a.z) < 30) { const s = this.g.sock(o.aid); if (s) this.g.sys(s, `${a.name || 'Someone'} ${r.killed ? 'killed' : 'tamed'} a ${m.id.startsWith('f') ? 'fox' : 'hare'} nearby.`); } }
    this.send(t, true);
  }
}
