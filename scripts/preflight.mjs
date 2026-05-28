import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

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

// Only run when invoked directly (not when imported by tests)
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const __dir = dirname(fileURLToPath(import.meta.url));
  const apiUtilsPath = join(__dir, '../skills/jtb/scripts/lib/api-utils.mjs');
  const source = readFileSync(apiUtilsPath, 'utf8');
  const match = source.match(/export const DEFAULT_API_BASE\s*=\s*'([^']+)'/);
  const defaultApiBase = match?.[1] ?? '';

  const tag = process.env.npm_config_tag;
  const { ok, reason } = checkApiBase(defaultApiBase, tag);

  if (!ok) {
    process.stderr.write(`\n[preflight] ERROR: ${reason}\n\n`);
    process.exit(1);
  }

  process.stdout.write(`[preflight] ${reason}\n`);
  process.exit(0);
}
