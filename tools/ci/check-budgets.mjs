// Compare the shipped web app's code and asset totals to the baseline in budgets.json.
// Baseline is from main when the budgets were added. CI fails if either total is exceeded.
//   node tools/ci/check-budgets.mjs
//   node tools/ci/check-budgets.mjs --write-baseline   (refresh budgets.json from the current tree)
import { readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const BUDGET_PATH = join(dirname(fileURLToPath(import.meta.url)), 'budgets.json');

const BUNDLE_DIRS = ['js', 'vendor', 'css', 'icons'];
const BUNDLE_FILES = ['index.html', 'sw.js', 'manifest.webmanifest'];
const ASSET_DIRS = ['assets'];

function walk(abs, acc) {
  let st;
  try { st = statSync(abs); } catch { return; }
  if (st.isDirectory()) {
    for (const name of readdirSync(abs).sort()) walk(join(abs, name), acc);
    return;
  }
  if (!st.isFile()) return;
  acc.bytes += st.size;
  acc.files += 1;
  acc.list.push({ path: relative(ROOT, abs).split('\\').join('/'), bytes: st.size });
}

export function measure(root = ROOT) {
  const bundle = { bytes: 0, files: 0, list: [] };
  const assets = { bytes: 0, files: 0, list: [] };
  for (const d of BUNDLE_DIRS) walk(join(root, d), bundle);
  for (const f of BUNDLE_FILES) walk(join(root, f), bundle);
  for (const d of ASSET_DIRS) walk(join(root, d), assets);
  bundle.list.sort((a, b) => b.bytes - a.bytes);
  assets.list.sort((a, b) => b.bytes - a.bytes);
  return { bundle, assets };
}

export function loadBudgets(path = BUDGET_PATH) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function compare(sizes, budgets) {
  const rows = [
    { name: 'bundle-size', bytes: sizes.bundle.bytes, files: sizes.bundle.files, budget: budgets.bundleBytes },
    { name: 'asset-weight', bytes: sizes.assets.bytes, files: sizes.assets.files, budget: budgets.assetBytes },
  ];
  return rows.map((r) => ({ ...r, over: r.bytes > r.budget, delta: r.bytes - r.budget }));
}

export function formatBytes(n) {
  return `${n} bytes (${(n / 1e6).toFixed(3)} MB)`;
}

function writeBaseline(sizes, sha) {
  const body = {
    bundleBytes: sizes.bundle.bytes,
    assetBytes: sizes.assets.bytes,
    from: {
      sha: sha || '',
      bundleFiles: sizes.bundle.files,
      assetFiles: sizes.assets.files,
    },
  };
  writeFileSync(BUDGET_PATH, JSON.stringify(body, null, 2) + '\n');
}

function main(argv) {
  const sizes = measure();
  if (argv.includes('--write-baseline')) {
    writeBaseline(sizes, argv[argv.indexOf('--write-baseline') + 1] || '');
    console.log(`wrote ${relative(ROOT, BUDGET_PATH)}: bundle ${sizes.bundle.bytes}, assets ${sizes.assets.bytes}`);
    return 0;
  }
  const budgets = loadBudgets();
  const rows = compare(sizes, budgets);
  let fail = 0;
  for (const r of rows) {
    const head = r.over ? 'FAIL' : 'ok  ';
    const sign = r.delta > 0 ? '+' : '';
    console.log(`${head} ${r.name}: ${formatBytes(r.bytes)} of ${formatBytes(r.budget)} (${sign}${r.delta}, ${r.files} files)`);
    if (r.over) fail = 1;
  }
  if (fail) {
    console.log('Size budget exceeded. If the growth is intended, raise the numbers in tools/ci/budgets.json.');
    return 1;
  }
  console.log('ALL PASSED');
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(main(process.argv.slice(2)));
}
