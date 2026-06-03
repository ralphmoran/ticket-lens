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
  computeResponseMetrics,
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
  it('writes envelope { captured_at, tickets } to {configDir}/triage-history/YYYY-MM-DD/{profile}.json', () => {
    const now = new Date('2026-04-14T12:00:00Z');
    const tickets = [makeTicket('PROJ-1')];
    const configDir = mkdtempSync(join(tmpdir(), 'save-test-'));
    try {
      saveTriageSnapshot(tickets, { profile: 'myprofile', configDir, now });
      const expectedPath = join(configDir, 'triage-history', '2026-04-14', 'myprofile.json');
      assert.ok(existsSync(expectedPath), `Expected file at ${expectedPath}`);
      const parsed = JSON.parse(readFileSync(expectedPath, 'utf8'));
      assert.equal(parsed.captured_at, '2026-04-14T12:00:00.000Z');
      assert.equal(parsed.tickets.length, 1);
      assert.equal(parsed.tickets[0].ticketKey, 'PROJ-1');
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

  it('returns { captured_at, tickets } when new-format file exists', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'load-found-new-'));
    try {
      const now = new Date('2026-04-14T12:00:00Z');
      const dir = join(configDir, 'triage-history', '2026-04-13');
      mkdirSync(dir, { recursive: true });
      const tickets = [makeTicket('PROJ-99', 'aging')];
      const envelope = { captured_at: '2026-04-13T08:00:00.000Z', tickets };
      writeFileSync(join(dir, 'mypro.json'), JSON.stringify(envelope), 'utf8');
      const result = loadYesterdaySnapshot({ profile: 'mypro', configDir, now });
      assert.equal(result.captured_at, '2026-04-13T08:00:00.000Z');
      assert.equal(result.tickets.length, 1);
      assert.equal(result.tickets[0].ticketKey, 'PROJ-99');
    } finally {
      rmSync(configDir, { recursive: true });
    }
  });

  it('handles old flat-array format — returns { captured_at: null, tickets }', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'load-found-old-'));
    try {
      const now = new Date('2026-04-14T12:00:00Z');
      const dir = join(configDir, 'triage-history', '2026-04-13');
      mkdirSync(dir, { recursive: true });
      const tickets = [makeTicket('PROJ-77', 'clear')];
      writeFileSync(join(dir, 'mypro.json'), JSON.stringify(tickets), 'utf8');
      const result = loadYesterdaySnapshot({ profile: 'mypro', configDir, now });
      assert.equal(result.captured_at, null);
      assert.equal(result.tickets.length, 1);
      assert.equal(result.tickets[0].ticketKey, 'PROJ-77');
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

// ---------------------------------------------------------------------------
// computeResponseMetrics
// ---------------------------------------------------------------------------

describe('computeResponseMetrics', () => {
  function makeFs(files) {
    // files: { 'absolute/path': 'content', ... }
    return {
      existsSync: p => p in files,
      readFileSync: (p) => {
        if (!(p in files)) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; }
        return files[p];
      },
      mkdirSync: () => {},
      writeFileSync: () => {},
      readdirSync: () => [],
    };
  }

  function snap(tickets, capturedAt) {
    return JSON.stringify({ captured_at: capturedAt, tickets });
  }

  const DIR = '/fake';
  const PROFILE = 'test';

  it('returns all-null metrics and triageRunCount:0 when no snapshot files exist', () => {
    const fs = makeFs({});
    const now = new Date('2026-05-30T10:00:00Z');
    const result = computeResponseMetrics(PROFILE, { days: 7, configDir: DIR, fsModule: fs, now });
    assert.equal(result.triageRunCount, 0);
    assert.equal(result.avgResponseHours, null);
    assert.equal(result.medianResponseHours, null);
    assert.equal(result.clearRate, null);
    assert.equal(result.currentUrgency, null);
    assert.equal(result.trendHours, null);
    assert.equal(result.windowDays, 7);
  });

  it('returns triageRunCount:1 and null response metrics when only one snapshot (no pairs)', () => {
    const now = new Date('2026-05-30T10:00:00Z');
    const path = `${DIR}/triage-history/2026-05-30/${PROFILE}.json`;
    const fs = makeFs({ [path]: snap([makeTicket('A-1', 'needs-response')], '2026-05-30T08:00:00Z') });
    const result = computeResponseMetrics(PROFILE, { days: 1, configDir: DIR, fsModule: fs, now });
    assert.equal(result.triageRunCount, 1);
    assert.equal(result.avgResponseHours, null);
    assert.deepEqual(result.currentUrgency, { needsResponse: 1, aging: 0, stale: 0, clear: 0 });
  });

  it('computes avgResponseHours from a needs-response → clear transition', () => {
    const now = new Date('2026-05-30T10:00:00Z');
    const pathD1 = `${DIR}/triage-history/2026-05-29/${PROFILE}.json`;
    const pathD2 = `${DIR}/triage-history/2026-05-30/${PROFILE}.json`;
    // commented at 06:00, cleared at 08:00 = 2 hours
    const ticketNR = makeTicket('A-1', 'needs-response', {
      lastComment: { created: '2026-05-29T06:00:00.000Z', author: 'Bob', body: 'hey' },
    });
    const ticketClear = makeTicket('A-1', 'clear');
    const fs = makeFs({
      [pathD1]: snap([ticketNR],    '2026-05-29T07:00:00.000Z'),
      [pathD2]: snap([ticketClear], '2026-05-29T08:00:00.000Z'),
    });
    const result = computeResponseMetrics(PROFILE, { days: 2, configDir: DIR, fsModule: fs, now });
    assert.ok(result.avgResponseHours !== null, 'avgResponseHours should be computed');
    assert.ok(Math.abs(result.avgResponseHours - 2) < 0.001, `Expected ~2h, got ${result.avgResponseHours}`);
    assert.equal(result.triageRunCount, 2);
  });

  it('computes correct clearRate: 1 fast (<24h) out of 1 transition = 1.0', () => {
    const now = new Date('2026-05-30T10:00:00Z');
    const pathD1 = `${DIR}/triage-history/2026-05-29/${PROFILE}.json`;
    const pathD2 = `${DIR}/triage-history/2026-05-30/${PROFILE}.json`;
    const ticketNR = makeTicket('A-1', 'needs-response', {
      lastComment: { created: '2026-05-29T06:00:00.000Z', author: 'Bob', body: '' },
    });
    const fs = makeFs({
      [pathD1]: snap([ticketNR],             '2026-05-29T07:00:00.000Z'),
      [pathD2]: snap([makeTicket('A-1','clear')], '2026-05-29T08:00:00.000Z'),
    });
    const result = computeResponseMetrics(PROFILE, { days: 2, configDir: DIR, fsModule: fs, now });
    assert.equal(result.clearRate, 1.0);
  });

  it('clearRate=0 when transition takes >24h', () => {
    const now = new Date('2026-05-30T10:00:00Z');
    const pathD1 = `${DIR}/triage-history/2026-05-29/${PROFILE}.json`;
    const pathD2 = `${DIR}/triage-history/2026-05-30/${PROFILE}.json`;
    const ticketNR = makeTicket('A-1', 'needs-response', {
      lastComment: { created: '2026-05-28T00:00:00.000Z', author: 'Bob', body: '' },
    });
    const fs = makeFs({
      [pathD1]: snap([ticketNR],             '2026-05-29T07:00:00.000Z'),
      [pathD2]: snap([makeTicket('A-1','clear')], '2026-05-30T08:00:00.000Z'),
    });
    const result = computeResponseMetrics(PROFILE, { days: 2, configDir: DIR, fsModule: fs, now });
    assert.equal(result.clearRate, 0);
  });

  it('skips transition when lastComment.created is null — no duration, no clearRate', () => {
    const now = new Date('2026-05-30T10:00:00Z');
    const pathD1 = `${DIR}/triage-history/2026-05-29/${PROFILE}.json`;
    const pathD2 = `${DIR}/triage-history/2026-05-30/${PROFILE}.json`;
    const ticketNR = makeTicket('A-1', 'needs-response'); // lastComment: null by default
    const fs = makeFs({
      [pathD1]: snap([ticketNR],                       '2026-05-29T07:00:00.000Z'),
      [pathD2]: snap([makeTicket('A-1', 'clear')],     '2026-05-29T08:00:00.000Z'),
    });
    const result = computeResponseMetrics(PROFILE, { days: 2, configDir: DIR, fsModule: fs, now });
    assert.equal(result.avgResponseHours, null);
    assert.equal(result.medianResponseHours, null);
    assert.equal(result.clearRate, null); // no valid durations → clearRate is null
  });

  it('skips duration when captured_at is null (old-format snapshot)', () => {
    const now = new Date('2026-05-30T10:00:00Z');
    const pathD1 = `${DIR}/triage-history/2026-05-29/${PROFILE}.json`;
    const pathD2 = `${DIR}/triage-history/2026-05-30/${PROFILE}.json`;
    const ticketNR = makeTicket('A-1', 'needs-response', {
      lastComment: { created: '2026-05-29T06:00:00.000Z', author: 'Bob', body: '' },
    });
    const fs = makeFs({
      [pathD1]: snap([ticketNR],             '2026-05-29T07:00:00.000Z'),
      // old format — no captured_at
      [pathD2]: JSON.stringify([makeTicket('A-1','clear')]),
    });
    const result = computeResponseMetrics(PROFILE, { days: 2, configDir: DIR, fsModule: fs, now });
    assert.equal(result.avgResponseHours, null); // no duration possible without captured_at
  });

  it('computes medianResponseHours correctly for multiple transitions', () => {
    const now = new Date('2026-05-30T20:00:00Z');
    const d1 = `${DIR}/triage-history/2026-05-28/${PROFILE}.json`;
    const d2 = `${DIR}/triage-history/2026-05-29/${PROFILE}.json`;
    const d3 = `${DIR}/triage-history/2026-05-30/${PROFILE}.json`;
    // A-1: 2h (lastComment 2026-05-29T10:00, cleared d2 captured_at 2026-05-29T12:00)
    // A-2: 6h (lastComment 2026-05-30T12:00, cleared d3 captured_at 2026-05-30T18:00)
    // median([2, 6]) = 4
    const nr1 = makeTicket('A-1','needs-response',{lastComment:{created:'2026-05-29T10:00:00.000Z',author:'X',body:''}});
    const nr2 = makeTicket('A-2','needs-response',{lastComment:{created:'2026-05-30T12:00:00.000Z',author:'Y',body:''}});
    const fs = makeFs({
      [d1]: snap([nr1],                                        '2026-05-28T09:00:00.000Z'),
      [d2]: snap([makeTicket('A-1', 'clear'), nr2],            '2026-05-29T12:00:00.000Z'),
      [d3]: snap([makeTicket('A-2', 'clear')],                 '2026-05-30T18:00:00.000Z'),
    });
    const result = computeResponseMetrics(PROFILE, { days: 3, configDir: DIR, fsModule: fs, now });
    assert.ok(result.medianResponseHours !== null);
    assert.ok(Math.abs(result.medianResponseHours - 4) < 0.001, `Expected median=4, got ${result.medianResponseHours}`);
  });

  it('trendHours is null when prior window has no data', () => {
    const now = new Date('2026-05-30T10:00:00Z');
    const path = `${DIR}/triage-history/2026-05-30/${PROFILE}.json`;
    const fs = makeFs({ [path]: snap([makeTicket('A-1','clear')], '2026-05-30T08:00:00Z') });
    const result = computeResponseMetrics(PROFILE, { days: 1, configDir: DIR, fsModule: fs, now });
    assert.equal(result.trendHours, null);
  });

  it('currentUrgency reflects counts from most recent snapshot', () => {
    const now = new Date('2026-05-30T10:00:00Z');
    const path = `${DIR}/triage-history/2026-05-30/${PROFILE}.json`;
    const tickets = [
      makeTicket('A-1','needs-response'),
      makeTicket('A-2','needs-response'),
      makeTicket('A-3','aging'),
      makeTicket('A-4','clear'),
    ];
    const fs = makeFs({ [path]: snap(tickets, '2026-05-30T08:00:00Z') });
    const result = computeResponseMetrics(PROFILE, { days: 1, configDir: DIR, fsModule: fs, now });
    assert.deepEqual(result.currentUrgency, { needsResponse: 2, aging: 1, stale: 0, clear: 1 });
  });
});

// ── LOCK TESTS — pin existing API surface before Feature 12 (queryTicketHistory) ──

describe('triage-history — API surface lock', () => {
  it('saveTriageSnapshot is a function', () => {
    assert.equal(typeof saveTriageSnapshot, 'function');
  });

  it('loadYesterdaySnapshot is a function', () => {
    assert.equal(typeof loadYesterdaySnapshot, 'function');
  });

  it('diffSnapshots is a function', () => {
    assert.equal(typeof diffSnapshots, 'function');
  });

  it('buildDeltaSection is a function', () => {
    assert.equal(typeof buildDeltaSection, 'function');
  });

  it('computeResponseMetrics is a function', () => {
    assert.equal(typeof computeResponseMetrics, 'function');
  });

  it('diffSnapshots returns [] on identical input (shape unchanged)', () => {
    const tickets = [{ ticketKey: 'L-1', urgency: 'clear', daysSinceUpdate: 2 }];
    assert.deepEqual(diffSnapshots(tickets, tickets), []);
  });
});
