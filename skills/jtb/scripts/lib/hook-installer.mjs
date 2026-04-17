/**
 * Git hook installer for ticketlens compliance gate.
 * Installs a pre-push hook that blocks pushes when compliance coverage
 * is below the configured threshold.
 *
 * Named exports only. Injectable fsModule and platform for testability.
 */

import * as fs from 'node:fs';
import { join } from 'node:path';

const GUARD = '# ticketlens-compliance-gate';

/**
 * Generate the sh script content for the pre-push hook.
 *
 * @param {{ threshold?: number }} [opts]
 * @returns {string}
 */
export function generateHookScript({ threshold = 80 } = {}) {
  // Coerce to bounded integer to prevent shell injection via the threshold param
  const safeThreshold = Math.max(0, Math.min(100, Math.floor(Number(threshold))));
  if (!Number.isFinite(safeThreshold)) {
    throw new Error('threshold must be a number between 0 and 100');
  }
  threshold = safeThreshold;
  return [
    '#!/bin/sh',
    GUARD,
    'BRANCH=$(git symbolic-ref HEAD 2>/dev/null | sed \'s|refs/heads/||\')',
    'KEY=$(echo "$BRANCH" | grep -oE \'[A-Z][A-Z0-9]+-[0-9]+\' | head -1)',
    '[ -z "$KEY" ] && exit 0',
    `ticketlens compliance "$KEY" || { echo "Push blocked: compliance < ${threshold}% for $KEY"; exit 1; }`,
  ].join('\n') + '\n';
}

/**
 * Install the compliance gate as a git pre-push hook.
 *
 * @param {{
 *   cwd?: string,
 *   threshold?: number,
 *   fsModule?: typeof import('node:fs'),
 *   platform?: string,
 * }} [opts]
 * @returns {{ installed: true, path: string } | { skipped: true, reason: string }}
 */
export function installHook({ cwd = process.cwd(), threshold = 80, fsModule = fs, platform = process.platform } = {}) {
  if (platform === 'win32') {
    return { skipped: true, reason: 'Not supported on Windows' };
  }

  const hooksDir = join(cwd, '.git', 'hooks');
  if (!fsModule.existsSync(hooksDir)) {
    throw new Error(`.git/hooks/ directory not found at ${hooksDir}. Is this a git repository?`);
  }

  const hookPath = join(hooksDir, 'pre-push');

  // Read existing content — empty string when file is absent
  let existing = '';
  try {
    existing = fsModule.readFileSync(hookPath, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  // Idempotency: skip append if guard is already present
  if (!existing.includes(GUARD)) {
    const block = '\n' + generateHookScript({ threshold });
    fsModule.writeFileSync(hookPath, existing + block, 'utf8');
  }

  fsModule.chmodSync(hookPath, 0o755);

  // Write .ticketlens-hooks.json in cwd
  const configPath = join(cwd, '.ticketlens-hooks.json');
  fsModule.writeFileSync(configPath, JSON.stringify({ complianceThreshold: threshold }) + '\n', 'utf8');

  return { installed: true, path: hookPath };
}
