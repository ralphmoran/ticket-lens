/**
 * Implements `tl doctor`. Runs a fixed set of diagnostic checks
 * (doctor-checks.mjs) and reports pass/fail with hints. Free tier,
 * fully unrestricted.
 */

import { DEFAULT_CONFIG_DIR } from './config.mjs';
import { handleUnknownFlags } from './arg-validator.mjs';
import { createStyler } from './ansi.mjs';
import {
  checkProfileConfig, checkLicenseFreshness, checkConnectivity,
  checkCacheHealth, checkRecallQueue,
} from './doctor-checks.mjs';

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

export async function runDoctor(args, {
  configDir = DEFAULT_CONFIG_DIR,
  stream = process.stderr,
  cwd = process.cwd(),
  checkProfileConfigFn = checkProfileConfig,
  checkLicenseFreshnessFn = checkLicenseFreshness,
  checkConnectivityFn = checkConnectivity,
  checkCacheHealthFn = checkCacheHealth,
  checkRecallQueueFn = checkRecallQueue,
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

  const rawResults = [
    checkProfileConfigFn({ configDir, profileName, cwd }),
    checkLicenseFreshnessFn({ configDir }),
    await checkConnectivityFn({ configDir, profileName, cwd }),
    checkCacheHealthFn({ configDir, profileName }),
    checkRecallQueueFn({ configDir }),
  ];

  const fixed = [];
  const skipped = [];
  const checks = rawResults.map(({ id, label, ok, message, hint, fixable }) => ({ id, label, ok, message, hint, fixable }));
  const ok = checks.every(c => c.ok);

  if (format === 'json') {
    stream.write(JSON.stringify({ schemaVersion: 1, ok, checks, fixed, skipped }, null, 2) + '\n');
    return { ok };
  }

  renderPlain(checks, { fixed, skipped, stream });
  return { ok };
}
