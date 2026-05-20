/**
 * Shared constants and utilities used across multiple TicketLens modules.
 * Single source of truth — import from here, do not redefine locally.
 */

import { readFileSync, realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

/** Canonical config directory: ~/.ticketlens */
export const DEFAULT_CONFIG_DIR = join(homedir(), '.ticketlens');

/** Read package.json version once per process, memoized.
 * Uses realpathSync to resolve symlinks before navigating, so the correct
 * package.json is found whether the module is loaded via a symlink or directly.
 */
let _version;
export function getVersion() {
  if (_version) return _version;
  try {
    const realDir = dirname(realpathSync(fileURLToPath(import.meta.url)));
    const pkg = JSON.parse(readFileSync(join(realDir, '..', '..', '..', '..', 'package.json'), 'utf8'));
    _version = pkg.version || '0.0.0';
  } catch {
    _version = '0.0.0';
  }
  return _version;
}

/** Human-readable relative time from an ISO date string. */
export function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Collapse newlines and truncate to max visible characters. */
export function truncate(str, max) {
  if (!str) return '';
  const oneLine = str.replace(/[\r\n]+/g, ' ').trim();
  if (oneLine.length <= max) return oneLine;
  return oneLine.slice(0, max - 3) + '...';
}

/** Strip carriage returns, preserving all other whitespace. */
export function stripCr(str) {
  if (!str) return '';
  return str.replace(/\r/g, '');
}

/**
 * Build the env-like object expected by jira-client functions.
 * @param {{ baseUrl: string, pat?: string, email?: string, apiToken?: string }} conn
 * @returns {{ JIRA_BASE_URL: string, JIRA_PAT?: string, JIRA_EMAIL?: string, JIRA_API_TOKEN?: string }}
 */
export function buildJiraEnv(conn) {
  return {
    JIRA_BASE_URL: conn.baseUrl,
    ...(conn.pat ? { JIRA_PAT: conn.pat } : { JIRA_EMAIL: conn.email, JIRA_API_TOKEN: conn.apiToken }),
  };
}
