import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanTranscript, statePath, lastCapturePath, readLastCaptureAt, writeLastCaptureAt, hasRecentCapture, lastNagPath, readLastNagAt, writeLastNagAt, hasRecentNag, lastAutoCaptureAttemptPath, readLastAutoCaptureAttemptAt, writeLastAutoCaptureAttemptAt, hasRecentAutoCaptureAttempt, CAPTURE_FRESHNESS_MS, shouldNag, buildCaptureExcerpt, stripHeredocs, splitShellStatements, stripLeadingNoise, isRealInvocation, claimStopNag, FETCH_RE, MUTATING_ACTION_RE, NOTE_ADD_RE } from '../../hooks/recall-nudge-lib.mjs';
import { resolve } from 'node:path';

function assistantEntry(blocks) {
  return JSON.stringify({ type: 'assistant', message: { content: blocks } });
}

function toolUse(name, input = {}) {
  return { type: 'tool_use', name, input };
}

function text(t) {
  return { type: 'text', text: t };
}

describe('lastCapture marker (cross-session, survives a session_id rollover)', () => {
  const cwd = '/fake/test/cwd-for-recall-nudge-lib-tests';

  afterEach(() => {
    try { rmSync(lastCapturePath(cwd)); } catch { /* not written this test — fine */ }
  });

  it('hasRecentCapture is false when nothing was ever recorded for this cwd', () => {
    assert.equal(hasRecentCapture(cwd), false);
  });

  it('readLastCaptureAt is 0 when nothing was ever recorded', () => {
    assert.equal(readLastCaptureAt(cwd), 0);
  });

  it('writeLastCaptureAt then hasRecentCapture is true within the freshness window', () => {
    const now = Date.now();
    writeLastCaptureAt(cwd, now);
    assert.equal(hasRecentCapture(cwd, now + 1000), true);
  });

  it('hasRecentCapture is false once the freshness window has fully elapsed', () => {
    const now = Date.now();
    writeLastCaptureAt(cwd, now);
    assert.equal(hasRecentCapture(cwd, now + CAPTURE_FRESHNESS_MS + 1), false);
  });

  it('different cwds get independent markers — one directory\'s capture never masks another\'s', () => {
    writeLastCaptureAt(cwd, Date.now());
    assert.equal(hasRecentCapture('/a/totally/different/cwd-never-written'), false);
  });

  it('CAPTURE_FRESHNESS_MS is 2 hours, per the user-set window', () => {
    assert.equal(CAPTURE_FRESHNESS_MS, 2 * 60 * 60 * 1000);
  });
});

describe('lastNag marker (cross-session, survives a session_id rollover — backlog #14)', () => {
  const cwd = '/fake/test/cwd-for-recall-nudge-lib-nag-tests';

  afterEach(() => {
    try { rmSync(lastNagPath(cwd)); } catch { /* not written this test — fine */ }
  });

  it('hasRecentNag is false when nothing was ever recorded for this cwd', () => {
    assert.equal(hasRecentNag(cwd), false);
  });

  it('readLastNagAt is 0 when nothing was ever recorded', () => {
    assert.equal(readLastNagAt(cwd), 0);
  });

  it('writeLastNagAt then hasRecentNag is true within the freshness window', () => {
    const now = Date.now();
    writeLastNagAt(cwd, now);
    assert.equal(hasRecentNag(cwd, now + 1000), true);
  });

  it('hasRecentNag is false once the freshness window has fully elapsed', () => {
    const now = Date.now();
    writeLastNagAt(cwd, now);
    assert.equal(hasRecentNag(cwd, now + CAPTURE_FRESHNESS_MS + 1), false);
  });

  it('different cwds get independent markers — one directory\'s nag never masks another\'s', () => {
    writeLastNagAt(cwd, Date.now());
    assert.equal(hasRecentNag('/a/totally/different/cwd-never-written'), false);
  });

  it('nag and capture markers are independent — recording one does not satisfy the other', () => {
    writeLastNagAt(cwd, Date.now());
    assert.equal(hasRecentCapture(cwd), false);
  });
});

describe('lastAutoCaptureAttempt marker (throttles the background auto-capture spawn — code review 2026-09-15)', () => {
  const cwd = '/fake/test/cwd-for-recall-nudge-lib-autocapture-tests';

  afterEach(() => {
    try { rmSync(lastAutoCaptureAttemptPath(cwd)); } catch { /* not written this test — fine */ }
  });

  it('hasRecentAutoCaptureAttempt is false when nothing was ever recorded for this cwd', () => {
    assert.equal(hasRecentAutoCaptureAttempt(cwd), false);
  });

  it('readLastAutoCaptureAttemptAt is 0 when nothing was ever recorded', () => {
    assert.equal(readLastAutoCaptureAttemptAt(cwd), 0);
  });

  it('writeLastAutoCaptureAttemptAt then hasRecentAutoCaptureAttempt is true within the freshness window', () => {
    const now = Date.now();
    writeLastAutoCaptureAttemptAt(cwd, now);
    assert.equal(hasRecentAutoCaptureAttempt(cwd, now + 1000), true);
  });

  it('hasRecentAutoCaptureAttempt is false once the freshness window has fully elapsed', () => {
    const now = Date.now();
    writeLastAutoCaptureAttemptAt(cwd, now);
    assert.equal(hasRecentAutoCaptureAttempt(cwd, now + CAPTURE_FRESHNESS_MS + 1), false);
  });

  it('different cwds get independent markers — one directory\'s attempt never masks another\'s', () => {
    writeLastAutoCaptureAttemptAt(cwd, Date.now());
    assert.equal(hasRecentAutoCaptureAttempt('/a/totally/different/cwd-never-written'), false);
  });

  it('auto-capture-attempt and nag markers are independent — recording one does not satisfy the other', () => {
    writeLastAutoCaptureAttemptAt(cwd, Date.now());
    assert.equal(hasRecentNag(cwd), false);
  });
});

// Backlog #38 hard-test findings (2026-09-21): reproduced against the real hook, not hypothetical.
describe('statePath sanitizes session_id (path traversal, hard-test finding)', () => {
  const prefix = resolve(join(tmpdir(), 'ticketlens-recall-nudge-'));

  it('a session_id containing ../ resolves under the ticketlens-recall-nudge- prefix, not a sibling path', () => {
    const p = resolve(statePath('../../etc/evil'));
    assert.ok(p.startsWith(prefix), `escaped the state-file prefix: ${p}`);
  });

  it('a session_id containing a path separator resolves under the ticketlens-recall-nudge- prefix', () => {
    const p = resolve(statePath('foo/bar/baz'));
    assert.ok(p.startsWith(prefix), `escaped the state-file prefix: ${p}`);
  });

  it('a normal UUID-shaped session_id is unaffected', () => {
    const id = '56ec7d14-ab8d-4986-958d-4be4b0c0a801';
    assert.ok(statePath(id).includes(id));
  });
});

describe('scanTranscript survives malformed transcript content (hard-test finding)', () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'recall-nudge-test-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  function writeRaw(content) {
    const p = join(dir, 'transcript.jsonl');
    writeFileSync(p, content, 'utf8');
    return p;
  }

  it('does not throw on a bare JSON `null` line, and keeps reading real entries around it', () => {
    const p = writeRaw([
      assistantEntry([toolUse('mcp__ticketlens__fetch', { ticket: 'PROD-1234' })]),
      'null',
      assistantEntry([toolUse('mcp__ticketlens__ticket_comment', { ticket: 'PROD-1234', body: 'x' })]),
    ].join('\n'));
    assert.doesNotThrow(() => scanTranscript(p));
    const result = scanTranscript(p);
    assert.equal(result.sawFetch, true);
    assert.equal(result.sawMutatingAction, true);
  });

  it('does not throw on bare JSON array/string/number lines', () => {
    const p = writeRaw(['[]', '"str"', '42', 'true'].join('\n'));
    assert.doesNotThrow(() => scanTranscript(p));
  });

  it('does not throw on a `null` element inside the content array, and keeps reading real blocks around it', () => {
    const p = writeRaw([
      JSON.stringify({ type: 'assistant', message: { content: [null, toolUse('mcp__ticketlens__fetch', { ticket: 'PROD-1234' }), null] } }),
      assistantEntry([toolUse('mcp__ticketlens__ticket_comment', { ticket: 'PROD-1234', body: 'x' })]),
    ].join('\n'));
    assert.doesNotThrow(() => scanTranscript(p));
    const result = scanTranscript(p);
    assert.equal(result.sawFetch, true);
    assert.equal(result.sawMutatingAction, true);
  });

  it('strips a leading UTF-8 BOM so the first line is still parsed', () => {
    const p = writeRaw('﻿' + [
      assistantEntry([toolUse('mcp__ticketlens__fetch', { ticket: 'PROD-1234' })]),
    ].join('\n'));
    assert.equal(scanTranscript(p).sawFetch, true);
  });
});

describe('buildCaptureExcerpt survives malformed transcript content (same class as scanTranscript, hard-test finding)', () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'recall-nudge-test-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('does not throw on a bare JSON `null` line', () => {
    const p = join(dir, 'transcript.jsonl');
    writeFileSync(p, ['null', assistantEntry([text('real insight')])].join('\n'), 'utf8');
    assert.doesNotThrow(() => buildCaptureExcerpt(p));
    assert.ok(buildCaptureExcerpt(p).includes('real insight'));
  });

  it('does not throw on a `null` element inside the content array', () => {
    const p = join(dir, 'transcript.jsonl');
    writeFileSync(p, JSON.stringify({ type: 'assistant', message: { content: [null, text('real insight'), null] } }), 'utf8');
    assert.doesNotThrow(() => buildCaptureExcerpt(p));
    assert.ok(buildCaptureExcerpt(p).includes('real insight'));
  });

  it('strips a leading UTF-8 BOM so the first assistant text block is still captured', () => {
    const p = join(dir, 'transcript.jsonl');
    writeFileSync(p, '﻿' + assistantEntry([text('first-line insight')]), 'utf8');
    assert.ok(buildCaptureExcerpt(p).includes('first-line insight'));
  });
});

describe('scanTranscript', () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'recall-nudge-test-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  function writeTranscript(lines) {
    const p = join(dir, 'transcript.jsonl');
    writeFileSync(p, lines.join('\n'), 'utf8');
    return p;
  }

  it('detects a CLI `ticketlens note add` Bash call as sawNoteAdd', () => {
    const p = writeTranscript([
      assistantEntry([toolUse('Bash', { command: 'ticketlens note add --title="x" --ticket=PROD-1' })]),
    ]);
    assert.equal(scanTranscript(p).sawNoteAdd, true);
  });

  it('detects the ticketlens MCP recall_add tool call as sawNoteAdd — the reported gap', () => {
    const p = writeTranscript([
      assistantEntry([toolUse('mcp__ticketlens__recall_add', { title: 'Test recall', body: 'x', tags: ['test'] })]),
    ]);
    assert.equal(scanTranscript(p).sawNoteAdd, true);
  });

  it('detects an aliased MCP server name (user renamed the server in their own .mcp.json)', () => {
    const p = writeTranscript([
      assistantEntry([toolUse('mcp__my-ticketlens-alias__recall_add', { title: 'x', body: 'x' })]),
    ]);
    assert.equal(scanTranscript(p).sawNoteAdd, true);
  });

  it('does not false-positive on an unrelated ticketlens MCP tool (e.g. recall_search)', () => {
    const p = writeTranscript([
      assistantEntry([toolUse('mcp__ticketlens__recall_search', { query: 'PROD-1' })]),
    ]);
    assert.equal(scanTranscript(p).sawNoteAdd, false);
  });

  it('does not false-positive on an unrelated Bash command', () => {
    const p = writeTranscript([
      assistantEntry([toolUse('Bash', { command: 'ls -la' })]),
    ]);
    assert.equal(scanTranscript(p).sawNoteAdd, false);
  });

  it('still detects the /jtb note skill invocation form via Bash', () => {
    const p = writeTranscript([
      assistantEntry([toolUse('Bash', { command: '/jtb note --title="x"' })]),
    ]);
    assert.equal(scanTranscript(p).sawNoteAdd, true);
  });

  it('ticketKey is null when no ticket key ever appears', () => {
    const p = writeTranscript([assistantEntry([text('Just chatting, no ticket work.')])]);
    const result = scanTranscript(p);
    assert.equal(result.sawTicketKey, false);
    assert.equal(result.ticketKey, null);
  });

  it('ticketKey captures the matched text, not just the boolean', () => {
    const p = writeTranscript([assistantEntry([text('Looking at PROD-1234 now.')])]);
    const result = scanTranscript(p);
    assert.equal(result.sawTicketKey, true);
    assert.equal(result.ticketKey, 'PROD-1234');
  });

  it('ticketKey is the FIRST match when a session mentions more than one ticket', () => {
    const p = writeTranscript([
      assistantEntry([text('Looking at PROD-1234 now.')]),
      assistantEntry([text('Also touching OTHER-99 while I\'m here.')]),
    ]);
    assert.equal(scanTranscript(p).ticketKey, 'PROD-1234');
  });
});

describe('sawFetch detection (backlog #15 — nag-trigger precision)', () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'recall-nudge-test-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  function writeTranscript(lines) {
    const p = join(dir, 'transcript.jsonl');
    writeFileSync(p, lines.join('\n'), 'utf8');
    return p;
  }

  it('detects the bare CLI form ("ticketlens TICKET-KEY") as sawFetch', () => {
    const p = writeTranscript([
      assistantEntry([toolUse('Bash', { command: 'ticketlens PROD-1234 --depth=2' })]),
    ]);
    assert.equal(scanTranscript(p).sawFetch, true);
  });

  it('does NOT treat "ticketlens fetch TICKET-KEY" as sawFetch — there is no such subcommand; it falls through to the catch-all and errors as an invalid ticket key, so counting it would mask a broken invocation', () => {
    const p = writeTranscript([
      assistantEntry([toolUse('Bash', { command: 'ticketlens fetch PROD-1234' })]),
    ]);
    assert.equal(scanTranscript(p).sawFetch, false);
  });

  it('detects the "ticketlens get TICKET-KEY" CLI alias as sawFetch', () => {
    const p = writeTranscript([
      assistantEntry([toolUse('Bash', { command: 'ticketlens get PROD-1234' })]),
    ]);
    assert.equal(scanTranscript(p).sawFetch, true);
  });

  it('detects the "tl" bin alias (bare and "get" forms) as sawFetch', () => {
    const bare = writeTranscript([
      assistantEntry([toolUse('Bash', { command: 'tl PROD-1234' })]),
    ]);
    assert.equal(scanTranscript(bare).sawFetch, true);

    const withGet = writeTranscript([
      assistantEntry([toolUse('Bash', { command: 'tl get PROD-1234' })]),
    ]);
    assert.equal(scanTranscript(withGet).sawFetch, true);
  });

  it('does not false-positive on "tl" appearing mid-word (e.g. "html", "ctl")', () => {
    const p = writeTranscript([
      assistantEntry([toolUse('Bash', { command: 'html PROD-1234' })]),
    ]);
    assert.equal(scanTranscript(p).sawFetch, false);
  });

  it('detects the /jtb skill wrapper form as sawFetch', () => {
    const p = writeTranscript([
      assistantEntry([toolUse('Bash', { command: '/jtb PROD-1234' })]),
    ]);
    assert.equal(scanTranscript(p).sawFetch, true);
  });

  it('detects the ticketlens MCP fetch tool call as sawFetch', () => {
    const p = writeTranscript([
      assistantEntry([toolUse('mcp__ticketlens__fetch', { ticket: 'PROD-1234' })]),
    ]);
    assert.equal(scanTranscript(p).sawFetch, true);
  });

  it('detects an aliased MCP server name for fetch (user renamed the server in their own .mcp.json)', () => {
    const p = writeTranscript([
      assistantEntry([toolUse('mcp__my-ticketlens-alias__fetch', { ticket: 'PROD-1234' })]),
    ]);
    assert.equal(scanTranscript(p).sawFetch, true);
  });

  it('does not false-positive on an unrelated ticketlens MCP tool (e.g. triage)', () => {
    const p = writeTranscript([
      assistantEntry([toolUse('mcp__ticketlens__triage', {})]),
    ]);
    assert.equal(scanTranscript(p).sawFetch, false);
  });

  it('does not false-positive on an unrelated CLI subcommand that also takes a ticket key (e.g. compliance)', () => {
    const p = writeTranscript([
      assistantEntry([toolUse('Bash', { command: 'ticketlens compliance PROD-1234' })]),
    ]);
    assert.equal(scanTranscript(p).sawFetch, false);
  });

  it('the reported repro: a ticket-key-shaped string with no fetch tool call at all does not set sawFetch', () => {
    const p = writeTranscript([assistantEntry([text('Looking at PROD-1234 now.')])]);
    const result = scanTranscript(p);
    assert.equal(result.sawTicketKey, true); // still captured — used for profile resolution only
    assert.equal(result.sawFetch, false); // but no fetch ever ran, so the Stop hook must not nag
  });
});

describe('shouldNag (Stop hook trigger decision)', () => {
  // Every case below models real ticket work (an edit, comment, transition,
  // etc — not just a fetch), so sawMutatingAction: true is set explicitly
  // throughout: these tests predate the sawMutatingAction gate (backlog #24,
  // 6th report) and their intent was always "real work happened," never a
  // pure read-only lookup — see the dedicated sawMutatingAction describe
  // block below for that dimension in isolation.
  describe('balanced (today\'s exact trigger — LOCK)', () => {
    it('does not nag when no ticket work happened', () => {
      assert.equal(shouldNag({ sawFetch: false, sawMutatingAction: false, sawRecallFlag: false, sawNoteAdd: false, recallStrictness: 'balanced' }), false);
    });

    it('does not nag when a note was already added', () => {
      assert.equal(shouldNag({ sawFetch: true, sawMutatingAction: true, sawRecallFlag: false, sawNoteAdd: true, recallStrictness: 'balanced' }), false);
    });

    it('does not nag when a note was added even if a flag was also raised', () => {
      assert.equal(shouldNag({ sawFetch: true, sawMutatingAction: true, sawRecallFlag: true, sawNoteAdd: true, recallStrictness: 'balanced' }), false);
    });

    it('nags when ticket work happened with no note and no flag', () => {
      assert.equal(shouldNag({ sawFetch: true, sawMutatingAction: true, sawRecallFlag: false, sawNoteAdd: false, recallStrictness: 'balanced' }), true);
    });

    it('nags when a flag was raised but never followed by a note', () => {
      assert.equal(shouldNag({ sawFetch: true, sawMutatingAction: true, sawRecallFlag: true, sawNoteAdd: false, recallStrictness: 'balanced' }), true);
    });
  });

  describe('strict (deliberately identical to balanced — not widened, spec §5)', () => {
    it('matches every balanced case exactly', () => {
      const cases = [
        { sawFetch: false, sawMutatingAction: false, sawRecallFlag: false, sawNoteAdd: false },
        { sawFetch: true, sawMutatingAction: true, sawRecallFlag: false, sawNoteAdd: true },
        { sawFetch: true, sawMutatingAction: true, sawRecallFlag: true, sawNoteAdd: true },
        { sawFetch: true, sawMutatingAction: true, sawRecallFlag: false, sawNoteAdd: false },
        { sawFetch: true, sawMutatingAction: true, sawRecallFlag: true, sawNoteAdd: false },
      ];
      for (const c of cases) {
        assert.equal(
          shouldNag({ ...c, recallStrictness: 'strict' }),
          shouldNag({ ...c, recallStrictness: 'balanced' }),
        );
      }
    });
  });

  describe('loose (narrowed to the broken-promise case only)', () => {
    it('does not nag when ticket work happened but nothing was ever flagged', () => {
      assert.equal(shouldNag({ sawFetch: true, sawMutatingAction: true, sawRecallFlag: false, sawNoteAdd: false, recallStrictness: 'loose' }), false);
    });

    it('still nags when a flag was raised but never followed by a note', () => {
      assert.equal(shouldNag({ sawFetch: true, sawMutatingAction: true, sawRecallFlag: true, sawNoteAdd: false, recallStrictness: 'loose' }), true);
    });

    it('does not nag when no ticket work happened', () => {
      assert.equal(shouldNag({ sawFetch: false, sawMutatingAction: false, sawRecallFlag: true, sawNoteAdd: false, recallStrictness: 'loose' }), false);
    });

    it('does not nag when a note was already added, even with a flag', () => {
      assert.equal(shouldNag({ sawFetch: true, sawMutatingAction: true, sawRecallFlag: true, sawNoteAdd: true, recallStrictness: 'loose' }), false);
    });
  });

  it('defaults to balanced behavior when recallStrictness is omitted', () => {
    assert.equal(
      shouldNag({ sawFetch: true, sawMutatingAction: true, sawRecallFlag: false, sawNoteAdd: false }),
      true,
    );
  });

  describe('sawMutatingAction gate (backlog #24, 6th report — read-only lookups false-positived)', () => {
    it('LOCK: still nags on real ticket work (edit/comment/transition/etc), balanced', () => {
      assert.equal(shouldNag({ sawFetch: true, sawMutatingAction: true, sawRecallFlag: false, sawNoteAdd: false, recallStrictness: 'balanced' }), true);
    });

    it('LOCK: still nags on real ticket work, strict', () => {
      assert.equal(shouldNag({ sawFetch: true, sawMutatingAction: true, sawRecallFlag: false, sawNoteAdd: false, recallStrictness: 'strict' }), true);
    });

    it('LOCK: still nags on real ticket work, loose, when flagged', () => {
      assert.equal(shouldNag({ sawFetch: true, sawMutatingAction: true, sawRecallFlag: true, sawNoteAdd: false, recallStrictness: 'loose' }), true);
    });

    it('does NOT nag on a pure read-only lookup (fetch only, no edit/write/ticket-mutation), balanced', () => {
      assert.equal(shouldNag({ sawFetch: true, sawMutatingAction: false, sawRecallFlag: false, sawNoteAdd: false, recallStrictness: 'balanced' }), false);
    });

    it('does NOT nag on a pure read-only lookup, strict', () => {
      assert.equal(shouldNag({ sawFetch: true, sawMutatingAction: false, sawRecallFlag: false, sawNoteAdd: false, recallStrictness: 'strict' }), false);
    });

    it('does NOT nag on a pure read-only lookup even when flagged, loose', () => {
      assert.equal(shouldNag({ sawFetch: true, sawMutatingAction: false, sawRecallFlag: true, sawNoteAdd: false, recallStrictness: 'loose' }), false);
    });
  });
});

describe('sawMutatingAction detection (scanTranscript)', () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'recall-nudge-test-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  function writeTranscript(lines) {
    const p = join(dir, 'transcript.jsonl');
    writeFileSync(p, lines.join('\n'), 'utf8');
    return p;
  }

  it('detects a CLI `ticketlens comment TICKET-KEY` Bash call', () => {
    const p = writeTranscript([assistantEntry([toolUse('Bash', { command: 'ticketlens comment PROD-1234 --body="x"' })])]);
    assert.equal(scanTranscript(p).sawMutatingAction, true);
  });

  it('detects a CLI `ticketlens transition TICKET-KEY` Bash call', () => {
    const p = writeTranscript([assistantEntry([toolUse('Bash', { command: 'ticketlens transition PROD-1234 --target="Done" --confirm' })])]);
    assert.equal(scanTranscript(p).sawMutatingAction, true);
  });

  it('detects a CLI `ticketlens assign TICKET-KEY` Bash call, "tl" alias', () => {
    const p = writeTranscript([assistantEntry([toolUse('Bash', { command: 'tl assign PROD-1234 --to=me' })])]);
    assert.equal(scanTranscript(p).sawMutatingAction, true);
  });

  it('detects a CLI `ticketlens update TICKET-KEY` Bash call, /jtb wrapper form', () => {
    const p = writeTranscript([assistantEntry([toolUse('Bash', { command: '/jtb update PROD-1234 --priority="High"' })])]);
    assert.equal(scanTranscript(p).sawMutatingAction, true);
  });

  it('detects the MCP ticket_comment tool call', () => {
    const p = writeTranscript([assistantEntry([toolUse('mcp__ticketlens__ticket_comment', { ticket: 'PROD-1234', body: 'x' })])]);
    assert.equal(scanTranscript(p).sawMutatingAction, true);
  });

  it('detects the MCP ticket_update/ticket_transition/ticket_assign tool calls', () => {
    for (const name of ['mcp__ticketlens__ticket_update', 'mcp__ticketlens__ticket_transition', 'mcp__ticketlens__ticket_assign']) {
      const p = writeTranscript([assistantEntry([toolUse(name, { ticket: 'PROD-1234' })])]);
      assert.equal(scanTranscript(p).sawMutatingAction, true, `expected ${name} to set sawMutatingAction`);
    }
  });

  it('detects an aliased MCP server name for a mutating tool', () => {
    const p = writeTranscript([assistantEntry([toolUse('mcp__my-alias__ticket_transition', { ticket: 'PROD-1234' })])]);
    assert.equal(scanTranscript(p).sawMutatingAction, true);
  });

  // Backlog #38 / #24b: every real false-positive nag was armed only by an
  // assistant Edit/Write of a memory file or a scratch comment draft. A file
  // write is never a ticket write, so none of these may set sawMutatingAction.
  it('does NOT count an Edit tool call as mutating — a file edit is not a ticket write (backlog #38)', () => {
    const p = writeTranscript([assistantEntry([toolUse('Edit', { file_path: '/x.mjs', old_string: 'a', new_string: 'b' })])]);
    assert.equal(scanTranscript(p).sawMutatingAction, false);
  });

  it('does NOT count a Write tool call as mutating — a file write is not a ticket write (backlog #38)', () => {
    const p = writeTranscript([assistantEntry([toolUse('Write', { file_path: '/x.mjs', content: 'x' })])]);
    assert.equal(scanTranscript(p).sawMutatingAction, false);
  });

  it('does NOT count a Write to an assistant memory file as mutating (real incident shape, backlog #38)', () => {
    const p = writeTranscript([
      assistantEntry([toolUse('Write', { file_path: '/Users/u/.claude-work/projects/-proj/memory/attachment-digests/abc-digest.md', content: 'x' })]),
      assistantEntry([toolUse('Edit', { file_path: '/Users/u/.claude-work/projects/-proj/memory/MEMORY.md', old_string: 'a', new_string: 'b' })]),
    ]);
    assert.equal(scanTranscript(p).sawMutatingAction, false);
  });

  it('does NOT count a Write to an in-repo scratch comment draft as mutating (real incident shape, backlog #38)', () => {
    const p = writeTranscript([
      assistantEntry([toolUse('Write', { file_path: '/repo/tickets/proj/tmp_PROD-1234_jira_comment.txt', content: 'h2. Draft' })]),
      assistantEntry([toolUse('Edit', { file_path: '/repo/tickets/proj/tmp_PROD-1234_jira_comment.txt', old_string: 'a', new_string: 'b' })]),
    ]);
    assert.equal(scanTranscript(p).sawMutatingAction, false);
  });

  it('does NOT count other file-tool shapes as mutating: unicode path, missing input, CLI-like path text, NotebookEdit, MultiEdit (backlog #38)', () => {
    const shapes = [
      toolUse('Write', { file_path: '/tmp/ドラフト_PROD-1_コメント.txt', content: 'x' }),
      { type: 'tool_use', name: 'Write' },
      toolUse('Edit', { file_path: '/tmp/ticketlens comment PROD-1234.txt', old_string: 'a', new_string: 'b' }),
      toolUse('NotebookEdit', { notebook_path: '/tmp/a.ipynb', new_source: 'x' }),
      toolUse('MultiEdit', { file_path: '/tmp/a.mjs', edits: [] }),
    ];
    for (const shape of shapes) {
      const p = writeTranscript([assistantEntry([shape])]);
      assert.equal(scanTranscript(p).sawMutatingAction, false, `expected no mutation for ${JSON.stringify(shape).slice(0, 80)}`);
    }
  });

  it('LOCK: a real ticket write still sets sawMutatingAction when file edits surround it', () => {
    const p = writeTranscript([
      assistantEntry([toolUse('Write', { file_path: '/repo/tmp_draft.txt', content: 'x' })]),
      assistantEntry([toolUse('mcp__ticketlens__ticket_comment', { ticket: 'PROD-1234', body: 'x' })]),
      assistantEntry([toolUse('Edit', { file_path: '/repo/src/a.mjs', old_string: 'a', new_string: 'b' })]),
    ]);
    assert.equal(scanTranscript(p).sawMutatingAction, true);
  });

  it('does NOT set sawMutatingAction on a pure fetch/read-only session — the reported false positive', () => {
    const p = writeTranscript([
      assistantEntry([toolUse('mcp__ticketlens__fetch', { ticket: 'PROD-1234' })]),
      assistantEntry([toolUse('mcp__ticketlens__fetch', { ticket: 'OTHER-99' })]),
      assistantEntry([text('Both tickets are Done.')]),
    ]);
    assert.equal(scanTranscript(p).sawMutatingAction, false);
  });

  it('does not false-positive on an unrelated ticketlens MCP tool (e.g. recall_search)', () => {
    const p = writeTranscript([assistantEntry([toolUse('mcp__ticketlens__recall_search', { query: 'x' })])]);
    assert.equal(scanTranscript(p).sawMutatingAction, false);
  });

  it('does not false-positive on an unrelated CLI subcommand also taking a ticket key (e.g. compliance)', () => {
    const p = writeTranscript([assistantEntry([toolUse('Bash', { command: 'ticketlens compliance PROD-1234' })])]);
    assert.equal(scanTranscript(p).sawMutatingAction, false);
  });
});

describe('buildCaptureExcerpt', () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'recall-nudge-test-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  function writeTranscript(lines) {
    const p = join(dir, 'transcript.jsonl');
    writeFileSync(p, lines.join('\n'), 'utf8');
    return p;
  }

  it('joins assistant text blocks in order', () => {
    const p = writeTranscript([
      assistantEntry([text('First insight.')]),
      assistantEntry([text('Second insight.')]),
    ]);
    const excerpt = buildCaptureExcerpt(p);
    assert.ok(excerpt.includes('First insight.'));
    assert.ok(excerpt.includes('Second insight.'));
    assert.ok(excerpt.indexOf('First insight.') < excerpt.indexOf('Second insight.'));
  });

  it('ignores tool_use blocks and user entries, only assistant text', () => {
    const p = writeTranscript([
      JSON.stringify({ type: 'user', message: { content: [{ type: 'text', text: 'ignore me' }] } }),
      assistantEntry([toolUse('Bash', { command: 'ls' }), text('Real insight here.')]),
    ]);
    const excerpt = buildCaptureExcerpt(p);
    assert.ok(!excerpt.includes('ignore me'));
    assert.ok(excerpt.includes('Real insight here.'));
  });

  it('caps at 8000 chars, keeping the END of the session (most recent synthesis)', () => {
    const early = 'EARLY-MARKER ' + 'x'.repeat(9000);
    const late = 'LATE-MARKER end of session insight';
    const p = writeTranscript([
      assistantEntry([text(early)]),
      assistantEntry([text(late)]),
    ]);
    const excerpt = buildCaptureExcerpt(p);
    assert.ok(excerpt.length <= 8000);
    assert.ok(excerpt.includes('LATE-MARKER'));
    assert.ok(!excerpt.includes('EARLY-MARKER'));
  });

  it('returns empty string, not throw, on a missing/unreadable transcript', () => {
    assert.equal(buildCaptureExcerpt(join(dir, 'nonexistent.jsonl')), '');
  });

  it('returns empty string when the session had no assistant text at all', () => {
    const p = writeTranscript([assistantEntry([toolUse('Bash', { command: 'ls' })])]);
    assert.equal(buildCaptureExcerpt(p), '');
  });
});

describe('stripHeredocs', () => {
  it('removes a heredoc body between quoted markers, keeping surrounding text', () => {
    const input = 'cat <<\'EOF\'\nticketlens comment PROD-1234\nEOF\necho done';
    const result = stripHeredocs(input);
    assert.equal(/ticketlens comment/.test(result), false);
    assert.equal(/echo done/.test(result), true);
  });

  it('removes an unquoted heredoc body too', () => {
    const input = 'cat <<EOF\nticketlens note add --title=x\nEOF';
    assert.equal(/ticketlens note add/.test(stripHeredocs(input)), false);
  });

  it('leaves a command with no heredoc unchanged', () => {
    const input = 'ticketlens comment PROD-1234 --body=x';
    assert.equal(stripHeredocs(input), input);
  });

  it('does not hang or throw on an unterminated heredoc marker', () => {
    const input = 'cat <<EOF\nno terminator here';
    assert.doesNotThrow(() => stripHeredocs(input));
  });

  it('does NOT treat a <<< here-string as a heredoc (code review finding)', () => {
    const input = 'diff <<<foo <<<bar';
    assert.equal(stripHeredocs(input), input); // nothing to strip — no real heredoc here
  });

  it('does NOT treat an arithmetic << (bit shift) as a heredoc (code review finding)', () => {
    const input = '$((1 << FOO))';
    assert.equal(stripHeredocs(input), input);
  });

  it('strips BOTH bodies when two <<DELIM markers share one command line (code review finding)', () => {
    const input = 'cat <<A <<B\nbody-of-A\nA\nticketlens comment PROD-1234 hi\nB\necho done';
    const result = stripHeredocs(input);
    assert.equal(/body-of-A/.test(result), false);
    assert.equal(/ticketlens comment/.test(result), false);
    assert.equal(/echo done/.test(result), true);
  });

  it('a quoted "((" does not block a real heredoc after it from being stripped (2nd-round review finding)', () => {
    const input = 'echo "((" && cat <<EOF\nticketlens comment PROD-1234 hi\nEOF';
    const result = stripHeredocs(input);
    assert.equal(/ticketlens comment/.test(result), false);
  });

  it('<<-DELIM (dash variant) recognizes a tab-indented terminator', () => {
    const input = 'cat <<-EOF\nticketlens comment PROD-1234 hi\n\tEOF\necho done';
    const result = stripHeredocs(input);
    assert.equal(/ticketlens comment/.test(result), false);
    assert.equal(/echo done/.test(result), true);
  });

  it('plain <<DELIM (no dash) does NOT treat an indented delimiter line as the terminator (2nd-round review finding)', () => {
    // The indented "  EOF" must NOT end the heredoc early — only the exact,
    // unindented "EOF" line does. If it ended early, "real end marker below"
    // and the actual terminator would leak out as fake statement text.
    const input = 'cat <<EOF\nticketlens comment PROD-1234 fake\n  EOF\nreal end marker below\nEOF\necho done';
    const result = stripHeredocs(input);
    assert.equal(/ticketlens comment/.test(result), false);
    assert.equal(/real end marker below/.test(result), false);
    assert.equal(/echo done/.test(result), true);
  });
});

describe('splitShellStatements', () => {
  it('splits on &&, ||, ;, |, and newline outside quotes', () => {
    assert.deepEqual(splitShellStatements('a && b; c | d\ne'), ['a', 'b', 'c', 'd', 'e']);
  });

  it('does not split on separators inside a double-quoted string', () => {
    assert.deepEqual(splitShellStatements('echo "a && b; c"'), ['echo "a && b; c"']);
  });

  it('does not split on separators inside a single-quoted string', () => {
    assert.deepEqual(splitShellStatements("echo 'a && b; c'"), ["echo 'a && b; c'"]);
  });
});

describe('isRealInvocation + anchored regexes (backlog #39/#62 — mention vs. execution)', () => {
  it('rejects a mention inside a git commit -m string', () => {
    assert.equal(isRealInvocation('git commit -m "fix: ticketlens comment PROD-1234 done"', MUTATING_ACTION_RE), false);
  });

  it('rejects a mention inside an echo >> string', () => {
    assert.equal(isRealInvocation('echo "run: ticketlens comment PROD-1234" >> notes.md', MUTATING_ACTION_RE), false);
  });

  it('rejects a mention inside a grep search string', () => {
    assert.equal(isRealInvocation('grep -r "ticketlens comment PROD-1234" .', MUTATING_ACTION_RE), false);
  });

  it('rejects a mention inside a heredoc doc example', () => {
    assert.equal(isRealInvocation('cat <<\'EOF\'\nticketlens comment PROD-1234 --body="x"\nEOF', MUTATING_ACTION_RE), false);
  });

  it('still accepts a real invocation chained after cd via &&', () => {
    assert.equal(isRealInvocation('cd ~/proj && ticketlens comment PROD-1234 --body="x"', MUTATING_ACTION_RE), true);
  });

  it('still accepts a real invocation chained after a mention via ;', () => {
    assert.equal(isRealInvocation('grep "ticketlens comment PROD-1234" . ; ticketlens comment PROD-1234 --body=real', MUTATING_ACTION_RE), true);
  });

  it('still accepts a real fetch with an env-var prefix and sudo', () => {
    assert.equal(isRealInvocation('FOO=bar sudo ticketlens PROD-1234', FETCH_RE), true);
  });

  it('still accepts a real note add after a mention-only echo, via &&', () => {
    assert.equal(isRealInvocation('echo "reminder: ticketlens note add" && ticketlens note add --title=x', NOTE_ADD_RE), true);
  });

  it('still detects a real mutation chained after a <<< here-string (code review finding — was a false negative)', () => {
    assert.equal(isRealInvocation('diff <<<foo <<<bar && ticketlens comment PROD-1234 hi', MUTATING_ACTION_RE), true);
  });

  it('does not false-positive on doc text inside the SECOND of two same-line heredocs (code review finding)', () => {
    const cmd = 'cat <<A <<B\nbody-of-A\nA\nticketlens comment PROD-1234 hi\nB';
    assert.equal(isRealInvocation(cmd, MUTATING_ACTION_RE), false);
  });
});

describe('shell-aware matching at the scanTranscript level (backlog #39/#62 ROADMAP repros)', () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'recall-nudge-test-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  function writeTranscript(lines) {
    const p = join(dir, 'transcript.jsonl');
    writeFileSync(p, lines.join('\n'), 'utf8');
    return p;
  }

  it('does NOT set sawMutatingAction on a git commit -m that only mentions the command', () => {
    const p = writeTranscript([assistantEntry([toolUse('Bash', { command: 'git commit -m "fix: ticketlens comment PROD-1234 done"' })])]);
    assert.equal(scanTranscript(p).sawMutatingAction, false);
  });

  it('does NOT set sawMutatingAction on an echo appending a usage example to a doc', () => {
    const p = writeTranscript([assistantEntry([toolUse('Bash', { command: 'echo "run: ticketlens comment PROD-1234 --body=x" >> README.md' })])]);
    assert.equal(scanTranscript(p).sawMutatingAction, false);
  });

  it('does NOT set sawMutatingAction on a grep searching for the invocation text', () => {
    const p = writeTranscript([assistantEntry([toolUse('Bash', { command: 'grep -r "ticketlens comment PROD-1234" .' })])]);
    assert.equal(scanTranscript(p).sawMutatingAction, false);
  });

  it('does NOT set sawMutatingAction on a heredoc doc example', () => {
    const p = writeTranscript([assistantEntry([toolUse('Bash', { command: 'cat <<\'EOF\'\nticketlens comment PROD-1234 --body="x"\nEOF' })])]);
    assert.equal(scanTranscript(p).sawMutatingAction, false);
  });

  it('does NOT set sawFetch on a mention-only ticketlens key inside a commit message', () => {
    const p = writeTranscript([assistantEntry([toolUse('Bash', { command: 'git commit -m "docs: ticketlens PROD-1234 example"' })])]);
    assert.equal(scanTranscript(p).sawFetch, false);
  });

  it('does NOT set sawNoteAdd on a mention-only "ticketlens note add" inside a doc heredoc', () => {
    const p = writeTranscript([assistantEntry([toolUse('Bash', { command: 'cat <<\'EOF\' >> SKILL.md\nExample: ticketlens note add --title="x"\nEOF' })])]);
    assert.equal(scanTranscript(p).sawNoteAdd, false);
  });

  it('STILL detects a real mutation chained after cd (must not miss "cd x && ticketlens comment KEY")', () => {
    const p = writeTranscript([assistantEntry([toolUse('Bash', { command: 'cd ~/Desktop/Projects/ticket-lens && ticketlens comment PROD-1234 --body="x"' })])]);
    assert.equal(scanTranscript(p).sawMutatingAction, true);
  });

  it('STILL detects a real mutation chained after an unrelated mention via ;', () => {
    const p = writeTranscript([assistantEntry([toolUse('Bash', { command: 'grep -r "ticketlens comment PROD-1234" . ; ticketlens comment PROD-1234 --body="real"' })])]);
    assert.equal(scanTranscript(p).sawMutatingAction, true);
  });

  it('STILL detects a real fetch with an env-var prefix and sudo', () => {
    const p = writeTranscript([assistantEntry([toolUse('Bash', { command: 'FOO=bar sudo ticketlens PROD-1234' })])]);
    assert.equal(scanTranscript(p).sawFetch, true);
  });

  it('STILL detects a real note add after a mention-only echo in the same command, via &&', () => {
    const p = writeTranscript([assistantEntry([toolUse('Bash', { command: 'echo "reminder: ticketlens note add" && ticketlens note add --title="x"' })])]);
    assert.equal(scanTranscript(p).sawNoteAdd, true);
  });
});

describe('claimStopNag (atomic per-session claim, backlog #40)', () => {
  let sessionId;
  beforeEach(() => { sessionId = `claim-test-${Math.random().toString(36).slice(2)}`; });
  afterEach(() => { try { rmSync(statePath(sessionId)); } catch { /* fine */ } });

  it('returns true on first claim, false on every subsequent claim for the same session_id', () => {
    assert.equal(claimStopNag(sessionId), true);
    assert.equal(claimStopNag(sessionId), false);
    assert.equal(claimStopNag(sessionId), false);
  });

  it('exactly one winner across many repeated claims for the same session_id', () => {
    const results = Array.from({ length: 20 }, () => claimStopNag(sessionId));
    assert.equal(results.filter(Boolean).length, 1);
  });

  it('a pre-existing file at the claim path (even garbage content) is treated as already-claimed', () => {
    writeFileSync(statePath(sessionId), 'not json{{{');
    assert.equal(claimStopNag(sessionId), false);
  });

  it('different session_ids claim independently', () => {
    const other = `${sessionId}-other`;
    try {
      assert.equal(claimStopNag(sessionId), true);
      assert.equal(claimStopNag(other), true);
    } finally {
      try { rmSync(statePath(other)); } catch { /* fine */ }
    }
  });

  it('fails open (returns true, does not throw) on a non-EEXIST fs error (code review finding)', () => {
    const previousTmpdir = process.env.TMPDIR;
    process.env.TMPDIR = join(tmpdir(), 'ticketlens-nonexistent-dir-for-test', 'nested');
    try {
      assert.doesNotThrow(() => {
        const result = claimStopNag(sessionId);
        assert.equal(result, true); // ENOENT, not EEXIST — best-effort fail-open
      });
    } finally {
      if (previousTmpdir === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = previousTmpdir;
    }
  });
});
