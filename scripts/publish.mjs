#!/usr/bin/env node
/**
 * Pack and publish ticketlens to npm.
 *
 * Swaps DEFAULT_API_BASE to the production URL, runs npm pack, reverts the
 * source file (always — even on failure), then publishes the tarball.
 * Source code always stays at the local dev URL; only the tarball gets prod.
 *
 * Usage:
 *   node scripts/publish.mjs                         # --tag beta, prod URL default
 *   node scripts/publish.mjs --tag=latest            # only when hosting is live
 *   node scripts/publish.mjs --prod-url=https://...  # override prod URL
 */

import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir  = dirname(fileURLToPath(import.meta.url));
const ROOT   = resolve(__dir, '..');
const API_UTILS = join(ROOT, 'skills/jtb/scripts/lib/api-utils.mjs');
const PROD_URL  = 'https://api.ticketlens.app';

const args    = process.argv.slice(2);
const tag     = args.find(a => a.startsWith('--tag='))?.split('=')[1] ?? 'beta';
const prodUrl = args.find(a => a.startsWith('--prod-url='))?.split('=')[1] ?? PROD_URL;

const original = readFileSync(API_UTILS, 'utf8');
const swapped  = original.replace(
  /export const DEFAULT_API_BASE\s*=\s*'[^']+'/,
  `export const DEFAULT_API_BASE = '${prodUrl}'`,
);

if (original === swapped) {
  process.stderr.write('Error: DEFAULT_API_BASE not found in api-utils.mjs\n');
  process.exit(1);
}

let tarball = null;

try {
  log(`Swapping DEFAULT_API_BASE → ${prodUrl}`);
  writeFileSync(API_UTILS, swapped, 'utf8');

  log('Running npm pack...');
  const raw  = execSync('npm pack --json', { cwd: ROOT }).toString().trim();
  const info = JSON.parse(raw);
  tarball    = Array.isArray(info) ? info[0]?.filename : info?.filename;

  if (!tarball) throw new Error('npm pack did not return a filename');
  log(`Packed: ${tarball}`);

} finally {
  log('Reverting DEFAULT_API_BASE → local dev URL');
  writeFileSync(API_UTILS, original, 'utf8');
}

try {
  log(`Publishing ${tarball} --tag ${tag}...`);
  execSync(`npm publish "${tarball}" --tag ${tag}`, { cwd: ROOT, stdio: 'inherit' });
  log(`Done — ticketlens published with tag: ${tag}`);
} finally {
  rmSync(join(ROOT, tarball), { force: true });
}

function log(msg) {
  process.stdout.write(`[publish] ${msg}\n`);
}
