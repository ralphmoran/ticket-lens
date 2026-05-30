/**
 * Feature 12 — Ticket history: queryTicketHistory CLI command
 * RED phase: all tests must fail until implementation is added.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { queryTicketHistory } from '../lib/triage-history.mjs';

let tmpDir;

function writeSnapshot(configDir, dateStr, profile, tickets) {
  const dir = join(configDir, 'triage-history', dateStr);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${profile}.json`), JSON.stringify(tickets), 'utf8');
}

before(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'feature12-test-'));
});
after(() => rmSync(tmpDir, { recursive: true }));

describe('queryTicketHistory', () => {
  it('is a named export of triage-history.mjs', () => {
    assert.equal(typeof queryTicketHistory, 'function');
  });

  it('returns empty array when no triage-history dir exists', () => {
    const empty = mkdtempSync(join(tmpdir(), 'empty-hist-'));
    try {
      const result = queryTicketHistory('PROJ-1', { configDir: empty });
      assert.deepEqual(result, []);
    } finally {
      rmSync(empty, { recursive: true });
    }
  });

  it('returns empty array when ticket not found in any snapshot', () => {
    writeSnapshot(tmpDir, '2026-03-01', 'work', [{ ticketKey: 'OTHER-1', urgency: 'clear', status: 'In Progress', reason: 'ok' }]);
    const result = queryTicketHistory('PROJ-NOTHERE', { configDir: tmpDir });
    assert.deepEqual(result, []);
  });

  it('returns timeline entry for each day the ticket appears', () => {
    const dir2 = mkdtempSync(join(tmpdir(), 'hist-days-'));
    try {
      writeSnapshot(dir2, '2026-03-01', 'work', [{ ticketKey: 'PROJ-5', urgency: 'clear', status: 'In Progress', reason: 'ok' }]);
      writeSnapshot(dir2, '2026-03-02', 'work', [{ ticketKey: 'PROJ-5', urgency: 'aging', status: 'In Progress', reason: 'No activity for 5 days' }]);
      const result = queryTicketHistory('PROJ-5', { configDir: dir2 });
      assert.equal(result.length, 2);
      assert.equal(result[0].date, '2026-03-01');
      assert.equal(result[1].date, '2026-03-02');
    } finally {
      rmSync(dir2, { recursive: true });
    }
  });

  it('each timeline entry has date, profile, urgency, status, reason fields', () => {
    const dir3 = mkdtempSync(join(tmpdir(), 'hist-shape-'));
    try {
      writeSnapshot(dir3, '2026-03-03', 'mywork', [{ ticketKey: 'SHAPE-1', urgency: 'needs-response', status: 'Code Review', reason: 'Alice commented' }]);
      const result = queryTicketHistory('SHAPE-1', { configDir: dir3 });
      assert.equal(result.length, 1);
      const entry = result[0];
      assert.ok('date' in entry, 'date missing');
      assert.ok('profile' in entry, 'profile missing');
      assert.ok('urgency' in entry, 'urgency missing');
      assert.ok('status' in entry, 'status missing');
      assert.ok('reason' in entry, 'reason missing');
    } finally {
      rmSync(dir3, { recursive: true });
    }
  });

  it('returns results in chronological order (oldest first)', () => {
    const dir4 = mkdtempSync(join(tmpdir(), 'hist-order-'));
    try {
      writeSnapshot(dir4, '2026-03-05', 'work', [{ ticketKey: 'ORD-1', urgency: 'aging', status: 'QA', reason: 'stale' }]);
      writeSnapshot(dir4, '2026-03-03', 'work', [{ ticketKey: 'ORD-1', urgency: 'clear', status: 'QA', reason: 'ok' }]);
      writeSnapshot(dir4, '2026-03-04', 'work', [{ ticketKey: 'ORD-1', urgency: 'needs-response', status: 'QA', reason: 'Bob commented' }]);
      const result = queryTicketHistory('ORD-1', { configDir: dir4 });
      assert.equal(result[0].date, '2026-03-03');
      assert.equal(result[1].date, '2026-03-04');
      assert.equal(result[2].date, '2026-03-05');
    } finally {
      rmSync(dir4, { recursive: true });
    }
  });

  it('detects bounce count — urgency oscillations across entries', () => {
    const dir5 = mkdtempSync(join(tmpdir(), 'hist-bounce-'));
    try {
      writeSnapshot(dir5, '2026-03-01', 'work', [{ ticketKey: 'BNCE-1', urgency: 'clear', status: 'In Progress', reason: 'ok' }]);
      writeSnapshot(dir5, '2026-03-02', 'work', [{ ticketKey: 'BNCE-1', urgency: 'needs-response', status: 'Code Review', reason: 'Alice' }]);
      writeSnapshot(dir5, '2026-03-03', 'work', [{ ticketKey: 'BNCE-1', urgency: 'clear', status: 'In Progress', reason: 'ok' }]);
      writeSnapshot(dir5, '2026-03-04', 'work', [{ ticketKey: 'BNCE-1', urgency: 'needs-response', status: 'Code Review', reason: 'Alice' }]);
      const result = queryTicketHistory('BNCE-1', { configDir: dir5 });
      const bounceCount = result.filter(e => e.bounced).length;
      assert.ok(bounceCount >= 1, `Expected at least 1 bounced entry, got ${bounceCount}`);
    } finally {
      rmSync(dir5, { recursive: true });
    }
  });

  it('reads across multiple profiles for the same date', () => {
    const dir6 = mkdtempSync(join(tmpdir(), 'hist-multiprof-'));
    try {
      writeSnapshot(dir6, '2026-03-10', 'profileA', [{ ticketKey: 'MULTI-1', urgency: 'clear', status: 'In Progress', reason: 'ok' }]);
      writeSnapshot(dir6, '2026-03-10', 'profileB', [{ ticketKey: 'MULTI-1', urgency: 'aging', status: 'QA', reason: 'stale' }]);
      const result = queryTicketHistory('MULTI-1', { configDir: dir6 });
      assert.ok(result.some(e => e.profile === 'profileA'), 'profileA entry missing');
      assert.ok(result.some(e => e.profile === 'profileB'), 'profileB entry missing');
    } finally {
      rmSync(dir6, { recursive: true });
    }
  });
});
