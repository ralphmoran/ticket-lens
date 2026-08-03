import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { scanForLeaks } from './leak-scanner.mjs';

const LOCAL_RE = /localhost|127\.0\.0\.1|\.test(:\d+)?(\/|$)/i;

/**
 * @param {string} defaultApiBase
 * @param {string|undefined} tag
 * @returns {{ ok: boolean, reason: string }}
 */
export function checkApiBase(defaultApiBase, tag = 'latest') {
  const resolvedTag = tag || 'latest'; // treat undefined/empty as 'latest'
  if (resolvedTag !== 'latest') {
    return { ok: true, reason: `tag '${resolvedTag}' — skipping production URL check` };
  }
  if (LOCAL_RE.test(defaultApiBase)) {
    return {
      ok: false,
      reason: `DEFAULT_API_BASE is still a local URL (${defaultApiBase}). ` +
        `Update it to the production URL in api-utils.mjs before publishing to 'latest'.`,
    };
  }
  return { ok: true, reason: `production URL looks good (${defaultApiBase})` };
}

/**
 * @param {string} root  absolute path to the package root
 * @param {string[]} filesList  package.json's `files` array
 * @returns {{ ok: boolean, reason: string }}
 */
export function checkForLeaks(root, filesList) {
  const violations = scanForLeaks(root, filesList);
  if (violations.length > 0) {
    return {
      ok: false,
      reason: `Found ${violations.length} employer/pilot-client leak(s) in shipped files:\n` +
        violations.map(v => `  - ${v}`).join('\n'),
    };
  }
  return { ok: true, reason: 'no employer/pilot-client leaks found in shipped files' };
}

/**
 * Prints each check's reason. On any failure, prints failures to stderr as
 * ERRORs and exits 1 (no successes are printed in that case). Only reached
 * when every check passes does it print each success reason to stdout.
 * @param {{ ok: boolean, reason: string }[]} checks
 * @param {string} logPrefix  e.g. '[preflight]' or '[publish] Preflight:'
 */
export function runChecks(checks, logPrefix) {
  const failed = checks.filter(c => !c.ok);
  if (failed.length > 0) {
    for (const { reason } of failed) process.stderr.write(`\n${logPrefix} ERROR: ${reason}\n`);
    process.stderr.write('\n');
    process.exit(1);
  }
  for (const { reason } of checks) process.stdout.write(`${logPrefix} ${reason}\n`);
}

// Only run when invoked directly (not when imported by tests)
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const __dir = dirname(fileURLToPath(import.meta.url));
  const root = resolve(__dir, '..');
  const apiUtilsPath = join(__dir, '../skills/jtb/scripts/lib/api-utils.mjs');
  const source = readFileSync(apiUtilsPath, 'utf8');
  const match = source.match(/export const DEFAULT_API_BASE\s*=\s*'([^']+)'/);
  const defaultApiBase = match?.[1] ?? '';
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

  const tag = process.env.npm_config_tag;
  const checks = [checkApiBase(defaultApiBase, tag), checkForLeaks(root, pkg.files)];

  runChecks(checks, '[preflight]');
  process.exit(0);
}
