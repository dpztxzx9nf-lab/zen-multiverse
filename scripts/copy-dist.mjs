#!/usr/bin/env node
// Copy the static web app into dist/ for Tauri to bundle.
// Keep this script free of npm deps so CI can run it with Node alone.
import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dest = path.join(root, 'dist');

await rm(dest, { recursive: true, force: true });
await mkdir(dest, { recursive: true });

const entries = [
  'index.html',
  'css',
  'js',
  'vendor',
  'assets',
  'manifest.webmanifest',
  'sw.js',
];

for (const name of entries) {
  await cp(path.join(root, name), path.join(dest, name), { recursive: true });
}

// PWA icons, but not the source artwork in icons/src
const iconsSrc = path.join(root, 'icons');
await cp(iconsSrc, path.join(dest, 'icons'), {
  recursive: true,
  filter: (src) => {
    const rel = path.relative(iconsSrc, src);
    if (!rel || rel === '.') return true;
    return rel.split(path.sep)[0] !== 'src';
  },
});

console.log('copied frontend into dist/');
