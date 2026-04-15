/**
 * Spec drift detection: compares key ticket fields against a stored snapshot
 * to detect when a ticket's status, description, or requirements have changed.
 */

import { createHash } from 'node:crypto';
import * as fsDefault from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DEFAULT_CONFIG_DIR } from './config.mjs';
import { extractRequirements } from './requirement-extractor.mjs';

/**
 * Validate that a path component does not contain traversal sequences.
 * @param {string} value
 * @param {'profile'|'ticket key'} label
 */
function assertSafe(value, label) {
  if (value.includes('/') || value.includes('\\') || value.includes('..')) {
    throw new Error(`Invalid ${label}`);
  }
}

/**
 * Get the current git branch name.
 * @param {{ execFn?: Function, cwd?: string }} opts
 * @returns {string} Branch name, 'DETACHED' for detached HEAD, '' if not in a git repo.
 */
export function getCurrentBranch({ execFn = spawnSync, cwd } = {}) {
  const spawnOpts = { encoding: 'utf8' };
  if (cwd) spawnOpts.cwd = cwd;
  const result = execFn('git', ['rev-parse', '--abbrev-ref', 'HEAD'], spawnOpts);
  if (result.status !== 0) return '';
  const branch = (result.stdout ?? '').trim();
  return branch === 'HEAD' ? 'DETACHED' : branch;
}

/**
 * Read a stored snapshot for the given ticket + profile.
 * @param {string} ticketKey
 * @param {{ profile?: string, configDir?: string, fsModule?: object }} opts
 * @returns {object|null}
 */
export function readSnapshot(ticketKey, { profile = 'default', configDir = DEFAULT_CONFIG_DIR, fsModule = fsDefault } = {}) {
  assertSafe(profile, 'profile name');
  assertSafe(ticketKey, 'ticket key');
  const filePath = join(configDir, 'drift', profile, `${ticketKey}.json`);
  try {
    const raw = fsModule.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Write a snapshot for the given ticket + profile.
 * @param {string} ticketKey
 * @param {object} ticket  Raw Jira ticket object from fetchTicket()
 * @param {{ profile?: string, configDir?: string, fsModule?: object, branch?: string }} opts
 */
export function writeSnapshot(ticketKey, ticket, { profile = 'default', configDir = DEFAULT_CONFIG_DIR, fsModule = fsDefault, branch = '' } = {}) {
  assertSafe(profile, 'profile name');
  assertSafe(ticketKey, 'ticket key');
  const dir = join(configDir, 'drift', profile);
  fsModule.mkdirSync(dir, { recursive: true });
  const desc = ticket.fields?.description ?? '';
  const descriptionHash = createHash('sha256').update(desc).digest('hex');
  const requirements = extractRequirements(desc);
  const snapshot = {
    fetchedAt: new Date().toISOString(),
    branch,
    status: ticket.fields?.status?.name ?? '',
    descriptionHash,
    requirements,
  };
  fsModule.writeFileSync(join(dir, `${ticketKey}.json`), JSON.stringify(snapshot, null, 2), 'utf8');
}

/**
 * Compare current ticket fields against a prior snapshot.
 * @param {{ status: string, descriptionHash: string, requirements: string[] }} current
 * @param {object|null} prior  Snapshot object, or null if no prior snapshot exists.
 * @returns {{ drifted: boolean, changes: string[] }}
 */
export function detectDrift(current, prior) {
  if (!prior) return { drifted: false, changes: [] };

  const changes = [];

  if (current.status !== prior.status) {
    changes.push(`status: "${prior.status}" \u2192 "${current.status}"`);
  }

  if (current.descriptionHash !== prior.descriptionHash) {
    changes.push('description changed');
  }

  const priorReqCount = Array.isArray(prior.requirements) ? prior.requirements.length : 0;
  const currentReqCount = Array.isArray(current.requirements) ? current.requirements.length : 0;
  if (currentReqCount !== priorReqCount) {
    changes.push(`requirements: ${priorReqCount} \u2192 ${currentReqCount}`);
  }

  return { drifted: changes.length > 0, changes };
}

/**
 * Format a drift warning string for output to stderr.
 * @param {string} ticketKey
 * @param {string[]} changes
 * @returns {string}
 */
export function formatDriftWarning(ticketKey, changes) {
  const lines = [`  \u26a0  ${ticketKey} spec drift detected:`];
  for (const change of changes) {
    lines.push(`  \u2022 ${change}`);
  }
  return lines.join('\n') + '\n';
}
