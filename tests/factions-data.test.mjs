// node tests/factions-data.test.mjs — the faction/act data file is well formed and self-consistent
import { readFileSync } from 'node:fs';
const D = JSON.parse(readFileSync(new URL('../js/factions/factions.json', import.meta.url), 'utf8'));
const A = []; const ok = (c, m) => { A.push([c, m]); if (!c) console.log('FAIL', m); };
const F = Object.keys(D.factions);
ok(F.length === 2 && F.includes('wardens') && F.includes('reavers'), 'two factions: wardens help, reavers hunt');
for (const [k, a] of Object.entries(D.acts)) {
  ok(typeof a.loud === 'number' && a.loud > 0 && a.loud < 140, `${k}: loudness in dB at 1 m`);
  ok(['pack', 'owner', 'cache', 'person'].includes(a.on), `${k}: acts on a real thing`);
  for (const [f, m] of Object.entries(a.means)) { ok(F.includes(f), `${k}: means for a known faction (${f})`); for (const v of Object.values(m)) ok(v === 'right' || v === 'wrong', `${k}/${f}: right or wrong`); }
  ok(typeof D.said[k] === 'string', `${k}: has words people use when they tell it`);
}
for (const [sk, s] of Object.entries(D.scenes)) {
  const ids = new Set();
  for (const p of s.people) {
    ok(!ids.has(p.id), `${sk}: unique id ${p.id}`); ids.add(p.id);
    ok(F.includes(p.f), `${sk}/${p.id}: faction`);
    ok(Array.isArray(p.home) && p.home.length === 2, `${sk}/${p.id}: has a home spot`);
    ok(Array.isArray(p.path) || Array.isArray(p.at), `${sk}/${p.id}: path or a place to lie`);
    if (p.role === 'teacher') ok(D.teach[p.teaches], `${sk}/${p.id}: teaches a known craft`);
  }
  for (const pk of s.packs) ok(ids.has(pk.owner), `${sk}/${pk.id}: owner is a person in the scene`);
  ok(s.people.some((p) => p.role === 'courier' && p.f === 'wardens') && s.people.some((p) => p.role === 'courier' && p.f === 'reavers'), `${sk}: both factions have a courier (news leaves the world on foot)`);
}
const fails = A.filter((x) => !x[0]).length;
console.log(`${A.length - fails}/${A.length} data checks passed`);
process.exit(fails ? 1 : 0);
