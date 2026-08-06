/**
 * Implements `tl doctor`. Runs a fixed set of diagnostic checks
 * (doctor-checks.mjs) and reports pass/fail with hints. Free tier,
 * fully unrestricted.
 */

import fs from 'node:fs';
import { DEFAULT_CONFIG_DIR } from './config.mjs';
import { handleUnknownFlags } from './arg-validator.mjs';
import { createStyler } from './ansi.mjs';
import {
  checkProfileConfig, checkLicenseFreshness, checkConnectivity,
  checkCacheHealth, checkRecallQueue,
} from './doctor-checks.mjs';
import { revalidateLicense } from './license.mjs';
import { flushQueue } from './recall-queue.mjs';
import { readCliToken } from './cli-auth.mjs';

const KNOWN_FLAGS = ['--format=', '--fix', '--profile=', '--help', '-h'];

function renderPlain(checks, { fixed, skipped, stream }) {
  const s = createStyler({ isTTY: stream.isTTY });
  stream.write('\n');
  for (const check of checks) {
    const icon = check.ok ? s.green('✔') : s.red('✖');
    stream.write(`  ${icon} ${check.label}: ${check.message}\n`);
    if (!check.ok && check.hint) stream.write(`      ${s.dim(check.hint)}\n`);
  }
  if (fixed.length > 0) {
    stream.write(`\n  ${s.green('Fixed:')} ${fixed.join(', ')}\n`);
  }
  if (skipped.length > 0) {
    stream.write(`\n  ${s.yellow('Skipped:')}\n`);
    for (const sk of skipped) stream.write(`    ${sk.id}: ${sk.reason}\n`);
  }
  stream.write('\n');
}

async function applyFixes(rawResults, {
  configDir, profileName, format, stream,
  revalidateLicenseFn, checkLicenseFreshnessFn,
  unlinkFn, checkCacheHealthFn,
  flushQueueFn, checkRecallQueueFn, readCliTokenFn,
}) {
  const fixed = [];
  const skipped = [];
  const byId = Object.fromEntries(rawResults.map(r => [r.id, r]));

  if (byId['license-freshness'] && !byId['license-freshness'].ok && byId['license-freshness'].fixable) {
    if (format === 'plain') stream.write('Revalidating license...\n');
    await revalidateLicenseFn({ configDir });
    const recheck = checkLicenseFreshnessFn({ configDir });
    byId['license-freshness'] = recheck;
    if (recheck.ok) fixed.push('license-freshness');
  }

  if (byId['cache-health'] && !byId['cache-health'].ok && byId['cache-health'].fixable) {
    if (format === 'plain') stream.write('Clearing corrupt cache entries...\n');
    for (const entry of byId['cache-health'].corruptEntries ?? []) {
      try { unlinkFn(entry.localPath); } catch { /* already gone */ }
    }
    const recheck = checkCacheHealthFn({ configDir, profileName });
    byId['cache-health'] = recheck;
    if (recheck.ok) fixed.push('cache-health');
  }

  if (byId['recall-queue'] && !byId['recall-queue'].ok && byId['recall-queue'].fixable) {
    const cliToken = readCliTokenFn(configDir);
    if (!cliToken) {
      skipped.push({ id: 'recall-queue', reason: 'Not logged in — run `ticketlens login` first.' });
    } else {
      if (format === 'plain') stream.write('Flushing recall queue...\n');
      await flushQueueFn({ cliToken, configDir });
      const recheck = checkRecallQueueFn({ configDir });
      byId['recall-queue'] = recheck;
      if (recheck.ok) fixed.push('recall-queue');
    }
  }

  return { results: Object.values(byId), fixed, skipped };
}

export async function runDoctor(args, {
  configDir = DEFAULT_CONFIG_DIR,
  stream = process.stderr,
  out = process.stdout,
  cwd = process.cwd(),
  checkProfileConfigFn = checkProfileConfig,
  checkLicenseFreshnessFn = checkLicenseFreshness,
  checkConnectivityFn = checkConnectivity,
  checkCacheHealthFn = checkCacheHealth,
  checkRecallQueueFn = checkRecallQueue,
  revalidateLicenseFn = revalidateLicense,
  unlinkFn = (p) => fs.unlinkSync(p),
  flushQueueFn = flushQueue,
  readCliTokenFn = readCliToken,
} = {}) {
  const validated = await handleUnknownFlags(args, KNOWN_FLAGS, { stream });
  if (validated === null) return { ok: false };

  const formatArg = validated.find(a => a.startsWith('--format='));
  const format = formatArg ? formatArg.split('=')[1] : 'plain';
  if (format !== 'plain' && format !== 'json') {
    stream.write(`Error: --format must be plain or json, got: ${format}\n`);
    return { ok: false };
  }

  const profileArg = validated.find(a => a.startsWith('--profile='));
  const profileName = profileArg ? profileArg.split('=')[1] : null;
  const shouldFix = validated.includes('--fix');

  const rawResults = [
    checkProfileConfigFn({ configDir, profileName, cwd }),
    checkLicenseFreshnessFn({ configDir }),
    await checkConnectivityFn({ configDir, profileName, cwd }),
    checkCacheHealthFn({ configDir, profileName }),
    checkRecallQueueFn({ configDir }),
  ];

  let fixed = [];
  let skipped = [];
  let finalResults = rawResults;
  if (shouldFix) {
    const applied = await applyFixes(rawResults, {
      configDir, profileName, format, stream,
      revalidateLicenseFn, checkLicenseFreshnessFn,
      unlinkFn, checkCacheHealthFn,
      flushQueueFn, checkRecallQueueFn, readCliTokenFn,
    });
    finalResults = applied.results;
    fixed = applied.fixed;
    skipped = applied.skipped;
  }

  const checks = finalResults.map(({ id, label, ok, message, hint, fixable }) => ({ id, label, ok, message, hint, fixable }));
  const ok = checks.every(c => c.ok);

  if (format === 'json') {
    out.write(JSON.stringify({ schemaVersion: 1, ok, checks, fixed, skipped }, null, 2) + '\n');
    return { ok };
  }

  renderPlain(checks, { fixed, skipped, stream: out });
  return { ok };
}
