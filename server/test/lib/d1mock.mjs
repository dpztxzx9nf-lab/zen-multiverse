// A small stand-in for Cloudflare D1 over node:sqlite, for unit tests (server/test/bag.mjs, storage.mjs): prepare /
// bind / run / all / first, and batch() as one transaction (any error rolls it all back, like D1). Every call
// yields to the event loop first, so two "worlds" calling at once really interleave.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
export function d1(migrations = ['0001_init.sql', '0003_bag.sql']) {
  const db = new DatabaseSync(':memory:');
  for (const f of migrations) db.exec(fs.readFileSync(new URL('../../migrations/' + f, import.meta.url), 'utf8'));
  const tick = () => new Promise((r) => setImmediate(r));
  const stmt = (q, p = []) => ({
    q, p,
    bind: (...v) => stmt(q, v),
    runNow() { const r = db.prepare(q).run(...p); return { success: true, meta: { changes: Number(r.changes) } }; },
    async run() { await tick(); return this.runNow(); },
    async all() { await tick(); return { results: db.prepare(q).all(...p) }; },
    async first() { await tick(); return db.prepare(q).get(...p) || null; },
  });
  return {
    raw: db,
    prepare: (q) => stmt(q),
    async batch(list) {
      await tick();
      db.exec('BEGIN');
      try { const out = list.map((s) => (/^\s*select/i.test(s.q) ? { results: db.prepare(s.q).all(...s.p) } : s.runNow())); db.exec('COMMIT'); return out; } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
  };
}
