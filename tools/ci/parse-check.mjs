// CI parse check: every JS file in the app, server, tests and tools must parse (as an ES module where it
// uses import/export, as a script otherwise). Catches syntax slips before a headless boot would.
//   node tools/ci/parse-check.mjs
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
const ROOTS = ['js', 'server/src', 'server/test', 'tests', 'tools', 'scripts', 'sw.js'];
const files = [];
const walk = (p) => { const s = statSync(p, { throwIfNoEntry: false }); if (!s) return; if (s.isDirectory()) { for (const n of readdirSync(p)) if (n !== 'node_modules' && !n.startsWith('.')) walk(join(p, n)); } else if (/\.(m?js)$/.test(p)) files.push(p); };
ROOTS.forEach(walk);
let bad = 0;
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const esm = f.endsWith('.mjs') || /^\s*(import|export)\b/m.test(src);
  try {
    if (esm) new vm.SourceTextModule(src, { identifier: f });
    else new vm.Script(src, { filename: f });
  } catch (e) { bad++; console.log(`FAIL ${f}: ${e.message}`); }
}
console.log(`${files.length} files parsed, ${bad} failed`);
process.exit(bad ? 1 : 0);
