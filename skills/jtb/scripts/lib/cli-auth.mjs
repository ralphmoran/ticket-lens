/**
 * CLI authentication token — stored locally, never transmitted except to the
 * TicketLens API. The server stores only the sha256 hash; this file holds the
 * plaintext so the CLI can use it as a Bearer token.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_CONFIG_DIR } from './config.mjs';

const TOKEN_FILE = 'cli-token.json';

export function cliTokenPath(configDir = DEFAULT_CONFIG_DIR) {
  return join(configDir, TOKEN_FILE);
}

export function readCliToken(configDir = DEFAULT_CONFIG_DIR) {
  const p = cliTokenPath(configDir);
  if (!existsSync(p)) return null;
  try {
    const data = JSON.parse(readFileSync(p, 'utf8'));
    return typeof data.token === 'string' ? data.token : null;
  } catch {
    return null;
  }
}

export function saveCliToken(token, configDir = DEFAULT_CONFIG_DIR) {
  mkdirSync(configDir, { recursive: true });
  const p = cliTokenPath(configDir);
  writeFileSync(p, JSON.stringify({ token }, null, 2) + '\n', 'utf8');
  chmodSync(p, 0o600);
}

export function deleteCliToken(configDir = DEFAULT_CONFIG_DIR) {
  const p = cliTokenPath(configDir);
  if (existsSync(p)) {
    writeFileSync(p, JSON.stringify({}, null, 2) + '\n', 'utf8');
  }
}
