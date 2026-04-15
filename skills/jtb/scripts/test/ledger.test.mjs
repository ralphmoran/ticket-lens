import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHmac } from 'node:crypto';

import { appendLedger, readLedger, exportLedger } from '../lib/ledger.mjs';

let tmpDir;

before(() => { tmpDir = mkdtempSync(join(tmpdir(), 'ledger-test-')); });
after(() => { rmSync(tmpDir, { recursive: true }); });

// ── appendLedger ─────────────────────────────────────────────────────────────

describe('appendLedger', () => {
  it('writes a valid JSON line to ledger.jsonl', () => {
    const dir = mkdtempSync(join(tmpDir, 'append1-'));
    const record = { ticketKey: 'PROJ-1', commitSha: 'abc', author: 'a@b.com', coverage: 80, missing: [] };
    appendLedger(record, { configDir: dir, isPro: true });

    const raw = readFileSync(join(dir, 'ledger.jsonl'), 'utf8').trim();
    const parsed = JSON.parse(raw);
    assert.equal(parsed.ticketKey, 'PROJ-1');
    assert.equal(parsed.coverage, 80);
    assert.ok(typeof parsed.ts === 'string');
  });

  it('appends (does not overwrite) on second call', () => {
    const dir = mkdtempSync(join(tmpDir, 'append2-'));
    const record = { ticketKey: 'PROJ-2', commitSha: 'abc', author: 'a@b.com', coverage: 70, missing: [] };
    appendLedger(record, { configDir: dir, isPro: true });
    appendLedger({ ...record, coverage: 90 }, { configDir: dir, isPro: true });

    const lines = readFileSync(join(dir, 'ledger.jsonl'), 'utf8').trim().split('\n');
    assert.equal(lines.length, 2);
    assert.equal(JSON.parse(lines[0]).coverage, 70);
    assert.equal(JSON.parse(lines[1]).coverage, 90);
  });

  it('creates configDir if missing', () => {
    const dir = join(tmpDir, 'nonexistent-' + Date.now());
    appendLedger({ ticketKey: 'PROJ-3', commitSha: 'abc', author: 'a@b.com', coverage: 60, missing: [] }, { configDir: dir, isPro: true });
    const raw = readFileSync(join(dir, 'ledger.jsonl'), 'utf8').trim();
    assert.ok(raw.length > 0);
  });

  it('is a no-op when isPro is false', () => {
    const dir = mkdtempSync(join(tmpDir, 'noop-'));
    appendLedger({ ticketKey: 'PROJ-4', commitSha: 'abc', author: 'a@b.com', coverage: 50, missing: [] }, { configDir: dir, isPro: false });
    let exists = false;
    try { readFileSync(join(dir, 'ledger.jsonl'), 'utf8'); exists = true; } catch { /* expected */ }
    assert.equal(exists, false);
  });
});

// ── readLedger ────────────────────────────────────────────────────────────────

describe('readLedger', () => {
  it('returns [] when file absent', () => {
    const dir = mkdtempSync(join(tmpDir, 'read-empty-'));
    const result = readLedger({ configDir: dir });
    assert.deepEqual(result, []);
  });

  it('parses all records and returns array', () => {
    const dir = mkdtempSync(join(tmpDir, 'read-all-'));
    appendLedger({ ticketKey: 'A-1', commitSha: 's1', author: 'x@y.com', coverage: 10, missing: [] }, { configDir: dir, isPro: true });
    appendLedger({ ticketKey: 'A-2', commitSha: 's2', author: 'x@y.com', coverage: 20, missing: ['req1'] }, { configDir: dir, isPro: true });
    const result = readLedger({ configDir: dir });
    assert.equal(result.length, 2);
    assert.equal(result[0].ticketKey, 'A-1');
    assert.equal(result[1].ticketKey, 'A-2');
  });

  it('filters records by ts >= since date', () => {
    const dir = mkdtempSync(join(tmpDir, 'read-since-'));
    appendFileSync(join(dir, 'ledger.jsonl'), JSON.stringify({ ts: '2026-01-01T00:00:00.000Z', ticketKey: 'OLD-1', commitSha: 's', author: 'a', coverage: 1, missing: [] }) + '\n');
    appendFileSync(join(dir, 'ledger.jsonl'), JSON.stringify({ ts: '2026-06-01T00:00:00.000Z', ticketKey: 'NEW-1', commitSha: 's', author: 'a', coverage: 2, missing: [] }) + '\n');

    const result = readLedger({ configDir: dir, since: '2026-03-01' });
    assert.equal(result.length, 1);
    assert.equal(result[0].ticketKey, 'NEW-1');
  });
});

// ── exportLedger ──────────────────────────────────────────────────────────────

describe('exportLedger', () => {
  it('returns { records, exportedAt, signature } for json format', () => {
    const dir = mkdtempSync(join(tmpDir, 'export-json-'));
    appendLedger({ ticketKey: 'E-1', commitSha: 's1', author: 'e@f.com', coverage: 55, missing: [] }, { configDir: dir, isPro: true });
    const result = exportLedger('json', { configDir: dir });
    assert.ok(typeof result === 'object');
    assert.ok(Array.isArray(result.records));
    assert.ok(typeof result.exportedAt === 'string');
    assert.ok(typeof result.signature === 'string');
  });

  it('returns CSV string with header row for csv format', () => {
    const dir = mkdtempSync(join(tmpDir, 'export-csv-'));
    appendLedger({ ticketKey: 'E-2', commitSha: 's2', author: 'e@f.com', coverage: 65, missing: ['req1'] }, { configDir: dir, isPro: true });
    const result = exportLedger('csv', { configDir: dir });
    assert.equal(typeof result, 'string');
    assert.ok(result.startsWith('ts,ticketKey,commitSha,author,coverage,missing'));
  });

  it('HMAC signature in JSON export verifies correctly with stored key', () => {
    const dir = mkdtempSync(join(tmpDir, 'export-hmac-'));
    appendLedger({ ticketKey: 'H-1', commitSha: 's1', author: 'h@i.com', coverage: 75, missing: [] }, { configDir: dir, isPro: true });
    const result = exportLedger('json', { configDir: dir });
    const key = readFileSync(join(dir, 'ledger-key'), 'utf8').trim();
    const payload = JSON.stringify({ records: result.records, exportedAt: result.exportedAt });
    const expected = createHmac('sha256', key).update(payload).digest('hex');
    assert.equal(result.signature, expected);
  });

  it('generates ledger-key on first call when file missing', () => {
    const dir = mkdtempSync(join(tmpDir, 'export-keygen-'));
    appendLedger({ ticketKey: 'K-1', commitSha: 's1', author: 'k@l.com', coverage: 85, missing: [] }, { configDir: dir, isPro: true });
    exportLedger('json', { configDir: dir });
    const key = readFileSync(join(dir, 'ledger-key'), 'utf8').trim();
    assert.ok(key.length === 64); // 32 bytes hex = 64 chars
  });
});
