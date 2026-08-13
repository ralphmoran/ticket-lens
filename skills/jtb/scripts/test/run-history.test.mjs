import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runHistory } from '../lib/run-history.mjs';

// ---------------------------------------------------------------------------
// Helpers — mirrors stats.test.mjs's snapshot-fixture convention
// ---------------------------------------------------------------------------

function makeSnap(configDir, dateStr, profile, tickets) {
  const dir = join(configDir, 'triage-history', dateStr);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${profile}.json`), JSON.stringify(tickets));
}

function capture() {
  const parts = [];
  return { write: (s) => { parts.push(s); }, get text() { return parts.join(''); } };
}

function freshConfigDir() {
  return mkdtempSync(join(tmpdir(), 'run-history-test-'));
}

// ---------------------------------------------------------------------------
// License gate
// ---------------------------------------------------------------------------

describe('runHistory — --help through injected print (protocol-corruption regression guard)', () => {
  it('writes help text through the injected print, never real stdout, when the sole arg is --help', async () => {
    const configDir = freshConfigDir();
    const print = capture();
    try {
      await runHistory(['--help'], { configDir, isLicensed: () => true, print: print.write });
      assert.match(print.text, /ticketlens history TICKET-KEY/);
    } finally {
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it('writes help text through the injected print, never real stdout, when the sole arg is -h', async () => {
    const configDir = freshConfigDir();
    const print = capture();
    try {
      await runHistory(['-h'], { configDir, isLicensed: () => true, print: print.write });
      assert.match(print.text, /ticketlens history TICKET-KEY/);
    } finally {
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it('regression guard: a caller-supplied ticket value of literally "--help" must still route through the injected print, not leak to real stdout (bare positional arg matches printHistoryHelp\'s own trigger)', async () => {
    const configDir = freshConfigDir();
    const print = capture();
    const origWrite = process.stdout.write;
    const realStdoutChunks = [];
    process.stdout.write = (s) => { realStdoutChunks.push(String(s)); return origWrite.call(process.stdout, s); };
    try {
      await runHistory(['--help'], { configDir, isLicensed: () => true, print: print.write });
      assert.ok(
        !realStdoutChunks.some((s) => s.includes('ticketlens history TICKET-KEY')),
        'help text must never reach the real process.stdout when print is injected',
      );
      assert.match(print.text, /ticketlens history TICKET-KEY/);
    } finally {
      process.stdout.write = origWrite;
      rmSync(configDir, { recursive: true, force: true });
    }
  });
});

describe('runHistory — license gate', () => {
  it('prints the Pro upgrade prompt through the injected warn, not real stderr, when unlicensed', async () => {
    const configDir = freshConfigDir();
    const warn = capture();
    const print = capture();
    try {
      await runHistory(['PROJ-1'], {
        configDir,
        isLicensed: () => false,
        print: print.write,
        warn: warn.write,
      });
      assert.match(warn.text, /ticketlens history/);
      assert.match(warn.text, /Pro/);
      assert.equal(print.text, '', 'no report content should be printed when gated');
    } finally {
      rmSync(configDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Usage error
// ---------------------------------------------------------------------------

describe('runHistory — usage error', () => {
  it('warns Usage and sets exitCode=1 when no ticket key is given', async () => {
    const configDir = freshConfigDir();
    const warn = capture();
    const print = capture();
    const origExit = process.exitCode;
    try {
      await runHistory([], {
        configDir,
        isLicensed: () => true,
        print: print.write,
        warn: warn.write,
      });
      assert.match(warn.text, /Usage: ticketlens history TICKET-KEY/);
      assert.equal(process.exitCode, 1);
      assert.equal(print.text, '');
    } finally {
      process.exitCode = origExit;
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it('warns Usage when the first arg looks like a flag, not a ticket key', async () => {
    const configDir = freshConfigDir();
    const warn = capture();
    const origExit = process.exitCode;
    try {
      await runHistory(['--bogus'], { configDir, isLicensed: () => true, warn: warn.write });
      assert.match(warn.text, /Usage: ticketlens history TICKET-KEY/);
      assert.equal(process.exitCode, 1);
    } finally {
      process.exitCode = origExit;
      rmSync(configDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// No history found
// ---------------------------------------------------------------------------

describe('runHistory — empty result', () => {
  it('prints "No triage history found for KEY." when queryTicketHistory returns []', async () => {
    const configDir = freshConfigDir();
    const print = capture();
    try {
      await runHistory(['PROJ-999'], { configDir, isLicensed: () => true, print: print.write });
      assert.equal(print.text, 'No triage history found for PROJ-999.\n');
    } finally {
      rmSync(configDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Formatted output — locks the exact shape previously inlined in
// bin/ticketlens.mjs's 'history' case (pre-extraction).
// ---------------------------------------------------------------------------

describe('runHistory — formatted output (lock)', () => {
  it('prints a header with the entry count and one line per entry: date, profile, urgency, reason', async () => {
    const configDir = freshConfigDir();
    makeSnap(configDir, '2026-08-01', 'work', [
      { ticketKey: 'PROJ-1', urgency: 'needs-response', status: 'In Progress', reason: 'reply owed' },
    ]);
    makeSnap(configDir, '2026-08-02', 'work', [
      { ticketKey: 'PROJ-1', urgency: 'clear', status: 'In Progress', reason: 'replied' },
    ]);
    const print = capture();
    try {
      await runHistory(['PROJ-1'], { configDir, isLicensed: () => true, print: print.write });
      assert.match(print.text, /History for PROJ-1 \(2 entries\)/);
      assert.match(print.text, /2026-08-01.*\[work\].*needs-response.*reply owed/s);
      assert.match(print.text, /2026-08-02.*\[work\].*clear.*replied/s);
    } finally {
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it('flags a bounce when urgency changes direction on consecutive days for the same profile', async () => {
    const configDir = freshConfigDir();
    makeSnap(configDir, '2026-08-01', 'work', [
      { ticketKey: 'PROJ-2', urgency: 'needs-response', status: 'In Progress', reason: 'reply owed' },
    ]);
    makeSnap(configDir, '2026-08-02', 'work', [
      { ticketKey: 'PROJ-2', urgency: 'aging', status: 'In Progress', reason: 'no reply' },
    ]);
    const print = capture();
    try {
      await runHistory(['PROJ-2'], { configDir, isLicensed: () => true, print: print.write });
      assert.match(print.text, /bounced/);
    } finally {
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it('supports an injected queryTicketHistoryFn (dependency injection, same convention as run-stats.mjs metricsCalculator)', async () => {
    const configDir = freshConfigDir();
    let seenKey, seenOpts;
    const queryTicketHistoryFn = (ticketKey, opts) => {
      seenKey = ticketKey;
      seenOpts = opts;
      return [{ date: '2026-08-05', profile: 'x', urgency: 'clear', status: '', reason: 'ok', bounced: false }];
    };
    const print = capture();
    try {
      await runHistory(['ABC-1'], { configDir, isLicensed: () => true, print: print.write, queryTicketHistoryFn });
      assert.equal(seenKey, 'ABC-1');
      assert.equal(seenOpts.configDir, configDir);
      assert.match(print.text, /History for ABC-1 \(1 entries\)/);
    } finally {
      rmSync(configDir, { recursive: true, force: true });
    }
  });
});
