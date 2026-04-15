import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  saveTriageSnapshot,
  loadYesterdaySnapshot,
  diffSnapshots,
  buildDeltaSection,
} from '../lib/triage-history.mjs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTicket(ticketKey, urgency = 'clear', overrides = {}) {
  return {
    ticketKey,
    summary: `Summary of ${ticketKey}`,
    status: 'In Progress',
    urgency,
    reason: 'test',
    lastComment: null,
    daysSinceUpdate: 3,
    ...overrides,
  };
}

function toDateString(d) {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function yesterday(now) {
  const d = new Date(now);
  d.setDate(d.getDate() - 1);
  return d;
}

// ---------------------------------------------------------------------------
// Shared tmp dir
// ---------------------------------------------------------------------------

let tmpDir;
before(() => { tmpDir = mkdtempSync(join(tmpdir(), 'triage-history-test-')); });
after(() => { rmSync(tmpDir, { recursive: true }); });

// ---------------------------------------------------------------------------
// saveTriageSnapshot
// ---------------------------------------------------------------------------

describe('saveTriageSnapshot', () => {
  it('writes file to {configDir}/triage-history/YYYY-MM-DD/{profile}.json', () => {
    const now = new Date('2026-04-14T12:00:00Z');
    const tickets = [makeTicket('PROJ-1')];
    const configDir = mkdtempSync(join(tmpdir(), 'save-test-'));
    try {
      saveTriageSnapshot(tickets, { profile: 'myprofile', configDir, now });
      const expectedPath = join(configDir, 'triage-history', '2026-04-14', 'myprofile.json');
      assert.ok(existsSync(expectedPath), `Expected file at ${expectedPath}`);
      const parsed = JSON.parse(readFileSync(expectedPath, 'utf8'));
      assert.equal(parsed.length, 1);
      assert.equal(parsed[0].ticketKey, 'PROJ-1');
    } finally {
      rmSync(configDir, { recursive: true });
    }
  });

  it('creates directory if absent', () => {
    const now = new Date('2026-04-14T09:00:00Z');
    const configDir = mkdtempSync(join(tmpdir(), 'save-mkdir-'));
    try {
      // No triage-history subdirectory pre-created
      saveTriageSnapshot([makeTicket('PROJ-2')], { profile: 'p', configDir, now });
      const dir = join(configDir, 'triage-history', '2026-04-14');
      assert.ok(existsSync(dir), 'Directory should have been created');
    } finally {
      rmSync(configDir, { recursive: true });
    }
  });

  it('sanitizes profile name — rejects slash', () => {
    assert.throws(
      () => saveTriageSnapshot([], { profile: 'a/b', configDir: tmpDir, now: new Date() }),
      { message: /invalid profile name/i }
    );
  });

  it('sanitizes profile name — rejects backslash', () => {
    assert.throws(
      () => saveTriageSnapshot([], { profile: 'a\\b', configDir: tmpDir, now: new Date() }),
      { message: /invalid profile name/i }
    );
  });

  it('sanitizes profile name — rejects dotdot', () => {
    assert.throws(
      () => saveTriageSnapshot([], { profile: '..', configDir: tmpDir, now: new Date() }),
      { message: /invalid profile name/i }
    );
  });
});

// ---------------------------------------------------------------------------
// loadYesterdaySnapshot
// ---------------------------------------------------------------------------

describe('loadYesterdaySnapshot', () => {
  it('returns null when no file for previous date', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'load-null-'));
    try {
      const now = new Date('2026-04-14T12:00:00Z');
      const result = loadYesterdaySnapshot({ profile: 'p', configDir, now });
      assert.equal(result, null);
    } finally {
      rmSync(configDir, { recursive: true });
    }
  });

  it('returns parsed array when file exists', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'load-found-'));
    try {
      const now = new Date('2026-04-14T12:00:00Z');
      const yestDate = '2026-04-13';
      const dir = join(configDir, 'triage-history', yestDate);
      mkdirSync(dir, { recursive: true });
      const tickets = [makeTicket('PROJ-99', 'aging')];
      writeFileSync(join(dir, 'mypro.json'), JSON.stringify(tickets), 'utf8');
      const result = loadYesterdaySnapshot({ profile: 'mypro', configDir, now });
      assert.ok(Array.isArray(result));
      assert.equal(result.length, 1);
      assert.equal(result[0].ticketKey, 'PROJ-99');
    } finally {
      rmSync(configDir, { recursive: true });
    }
  });
});

// ---------------------------------------------------------------------------
// diffSnapshots
// ---------------------------------------------------------------------------

describe('diffSnapshots', () => {
  it('returns [] when both arrays identical', () => {
    const tickets = [makeTicket('PROJ-1', 'clear')];
    assert.deepEqual(diffSnapshots(tickets, tickets), []);
  });

  it('detects urgency worsening: clear → aging', () => {
    const today = [makeTicket('PROJ-1', 'aging')];
    const yest  = [makeTicket('PROJ-1', 'clear')];
    const deltas = diffSnapshots(today, yest);
    assert.equal(deltas.length, 1);
    assert.equal(deltas[0].ticketKey, 'PROJ-1');
    assert.ok(deltas[0].changes.some(c => c.includes('aging')));
  });

  it('detects urgency worsening: aging → needs-response', () => {
    const today = [makeTicket('PROJ-2', 'needs-response')];
    const yest  = [makeTicket('PROJ-2', 'aging')];
    const deltas = diffSnapshots(today, yest);
    assert.equal(deltas.length, 1);
    assert.ok(deltas[0].changes.some(c => c.includes('needs-response')));
  });

  it('detects urgency worsening: clear → needs-response', () => {
    const today = [makeTicket('PROJ-3', 'needs-response')];
    const yest  = [makeTicket('PROJ-3', 'clear')];
    const deltas = diffSnapshots(today, yest);
    assert.equal(deltas.length, 1);
    assert.ok(deltas[0].changes.some(c => c.includes('needs-response')));
  });

  it('detects new comments: lastComment.created different from yesterday', () => {
    const today = [makeTicket('PROJ-4', 'clear', {
      lastComment: { created: '2026-04-14T10:00:00Z', author: 'Bob', body: 'New' },
    })];
    const yest = [makeTicket('PROJ-4', 'clear', {
      lastComment: { created: '2026-04-12T10:00:00Z', author: 'Alice', body: 'Old' },
    })];
    const deltas = diffSnapshots(today, yest);
    assert.equal(deltas.length, 1);
    assert.ok(deltas[0].changes.some(c => c.includes('comment')));
  });

  it('detects staleness threshold crossed: daysSinceUpdate was <7, now >=7', () => {
    const today = [makeTicket('PROJ-5', 'clear', { daysSinceUpdate: 8 })];
    const yest  = [makeTicket('PROJ-5', 'clear', { daysSinceUpdate: 6 })];
    const deltas = diffSnapshots(today, yest);
    assert.equal(deltas.length, 1);
    assert.ok(deltas[0].changes.some(c => c.includes('stale threshold crossed')));
  });

  it('ignores tickets that improved (urgency order went toward clear)', () => {
    const today = [makeTicket('PROJ-6', 'clear')];
    const yest  = [makeTicket('PROJ-6', 'needs-response')];
    const deltas = diffSnapshots(today, yest);
    assert.equal(deltas.length, 0);
  });

  it('ignores tickets present only in today (new tickets, no yesterday match)', () => {
    const today = [makeTicket('PROJ-7', 'needs-response'), makeTicket('PROJ-8', 'aging')];
    const yest  = [makeTicket('PROJ-8', 'aging')];
    const deltas = diffSnapshots(today, yest);
    // PROJ-7 is new (not in yesterday), so should be ignored
    assert.ok(deltas.every(d => d.ticketKey !== 'PROJ-7'));
  });
});

// ---------------------------------------------------------------------------
// buildDeltaSection
// ---------------------------------------------------------------------------

describe('buildDeltaSection', () => {
  it('returns empty string when deltas array is empty', () => {
    assert.equal(buildDeltaSection([]), '');
  });

  it('returns string starting with delta header', () => {
    const deltas = [{ ticketKey: 'PROJ-1', summary: 'S', changes: ['aging → needs-response'] }];
    const result = buildDeltaSection(deltas);
    assert.ok(result.startsWith('── What got worse since yesterday ──'));
  });

  it('includes ▼ prefix for each worsening ticket', () => {
    const deltas = [
      { ticketKey: 'PROJ-1', summary: 'Fix it', changes: ['aging → needs-response'] },
      { ticketKey: 'PROJ-2', summary: 'Do it', changes: ['stale threshold crossed (7 days idle)'] },
    ];
    const result = buildDeltaSection(deltas);
    assert.ok(result.includes('▼ PROJ-1'));
    assert.ok(result.includes('▼ PROJ-2'));
  });

  it('shows urgency change: aging → needs-response', () => {
    const deltas = [{ ticketKey: 'PROJ-1', summary: 'S', changes: ['aging → needs-response'] }];
    const result = buildDeltaSection(deltas);
    assert.ok(result.includes('aging → needs-response'));
  });

  it('shows staleness crossing: stale threshold crossed (N days idle)', () => {
    const deltas = [{ ticketKey: 'PROJ-5', summary: 'S', changes: ['stale threshold crossed (8 days idle)'] }];
    const result = buildDeltaSection(deltas);
    assert.ok(result.includes('stale threshold crossed (8 days idle)'));
  });
});
