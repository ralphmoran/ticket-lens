/**
 * Compliance Ledger — append-only JSONL audit trail for compliance checks (Pro tier).
 * Named exports only. All fs operations accept an injectable fsModule param.
 */

import * as _fs from 'node:fs';
import { join } from 'node:path';
import { createHmac, randomBytes } from 'node:crypto';
import { DEFAULT_CONFIG_DIR } from './config.mjs';

const LEDGER_FILE = 'ledger.jsonl';
const KEY_FILE    = 'ledger-key';

/**
 * Append one compliance record to ledger.jsonl.
 * No-op when isPro is false.
 *
 * @param {{ ticketKey: string, commitSha: string, author: string, coverage: number, missing: string[] }} record
 * @param {{ configDir?: string, fsModule?: object, isPro?: boolean }} opts
 */
export function appendLedger(record, { configDir = DEFAULT_CONFIG_DIR, fsModule = _fs, isPro = false } = {}) {
  if (!isPro) return;

  fsModule.mkdirSync(configDir, { recursive: true });

  const line = JSON.stringify({ ts: new Date().toISOString(), ...record }) + '\n';
  fsModule.appendFileSync(join(configDir, LEDGER_FILE), line, 'utf8');
}

/**
 * Read all records from ledger.jsonl, optionally filtered by a since date.
 *
 * @param {{ configDir?: string, fsModule?: object, since?: string }} opts
 * @returns {object[]}
 */
export function readLedger({ configDir = DEFAULT_CONFIG_DIR, fsModule = _fs, since } = {}) {
  const ledgerPath = join(configDir, LEDGER_FILE);
  let raw;
  try {
    raw = fsModule.readFileSync(ledgerPath, 'utf8');
  } catch {
    return [];
  }

  const sinceMs = since ? new Date(since).getTime() : null;

  return raw
    .split('\n')
    .filter(line => line.trim().length > 0)
    .map(line => JSON.parse(line))
    .filter(record => sinceMs === null || new Date(record.ts).getTime() >= sinceMs);
}

/**
 * Export the ledger in the specified format.
 *
 * @param {'json'|'csv'} format
 * @param {{ configDir?: string, fsModule?: object }} opts
 * @returns {object|string}  Object for 'json', string for 'csv'
 */
export function exportLedger(format, { configDir = DEFAULT_CONFIG_DIR, fsModule = _fs } = {}) {
  const records = readLedger({ configDir, fsModule });

  if (format === 'csv') {
    const header = 'ts,ticketKey,commitSha,author,coverage,missing';
    const rows = records.map(r => {
      const missing = Array.isArray(r.missing) ? r.missing.join('|') : (r.missing ?? '');
      return [r.ts, r.ticketKey, r.commitSha, r.author, r.coverage, missing]
        .map(v => `"${String(v ?? '').replace(/"/g, '""')}"`)
        .join(',');
    });
    return [header, ...rows].join('\n');
  }

  // JSON format
  const key = _getOrCreateKey(configDir, fsModule);
  const exportedAt = new Date().toISOString();
  const payload = JSON.stringify({ records, exportedAt });
  const signature = createHmac('sha256', key).update(payload).digest('hex');

  return { records, exportedAt, signature };
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function _getOrCreateKey(configDir, fsModule) {
  const keyPath = join(configDir, KEY_FILE);
  try {
    return fsModule.readFileSync(keyPath, 'utf8').trim();
  } catch {
    const key = randomBytes(32).toString('hex');
    fsModule.mkdirSync(configDir, { recursive: true });
    fsModule.writeFileSync(keyPath, key, { encoding: 'utf8', mode: 0o600 });
    return key;
  }
}
