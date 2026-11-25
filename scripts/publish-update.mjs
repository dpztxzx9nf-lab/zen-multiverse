#!/usr/bin/env node
// CI helper for auto-updates (no npm deps). Copies every installer/updater bundle named in the
// release's latest.json (plus the .dmg/.msi/.exe installers for fresh downloads) to a public R2 bucket
// under <tag>/, points latest.json at the public copies, and writes it to <outDir>/latest.json.
// Usage: node scripts/publish-update.mjs <releaseDir> <outDir> <tag> <filesBaseUrl> <r2Bucket>
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [releaseDir, outDir, tag, filesUrl, bucket] = process.argv.slice(2);
if (!releaseDir || !outDir || !tag || !filesUrl || !bucket) {
  console.error('usage: publish-update.mjs <releaseDir> <outDir> <tag> <filesBaseUrl> <r2Bucket>');
  process.exit(2);
}
const base = filesUrl.replace(/\/+$/, '');
const latest = JSON.parse(await readFile(path.join(releaseDir, 'latest.json'), 'utf8'));
const files = new Set(await readdir(releaseDir));

const put = (name) => {
  const key = `${bucket}/${tag}/${name}`;
  console.log(`upload ${name} -> r2://${key}`);
  execFileSync('npx', ['--yes', 'wrangler@4', 'r2', 'object', 'put', key,
    '--file', path.join(releaseDir, name), '--remote'], { stdio: 'inherit' });
};

const uploaded = new Set();
for (const [platform, entry] of Object.entries(latest.platforms || {})) {
  const name = decodeURIComponent(new URL(entry.url).pathname.split('/').pop());
  if (!files.has(name)) throw new Error(`${platform}: ${name} is not in the release assets`);
  if (!uploaded.has(name)) { put(name); uploaded.add(name); }
  entry.url = `${base}/${tag}/${encodeURIComponent(name)}`;
}
// first-time installers too, so the public host can serve fresh downloads later
for (const name of files) {
  if (/\.(dmg|msi|exe)$/i.test(name) && !uploaded.has(name)) { put(name); uploaded.add(name); }
}

await mkdir(outDir, { recursive: true });
await writeFile(path.join(outDir, 'latest.json'), JSON.stringify(latest, null, 2) + '\n');
await writeFile(path.join(outDir, '_headers'), '/latest.json\n  Cache-Control: no-cache\n  Access-Control-Allow-Origin: *\n');
console.log(`latest.json -> ${Object.keys(latest.platforms || {}).join(', ')} at ${base}/${tag}/`);
