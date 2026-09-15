import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanTranscript, lastCapturePath, readLastCaptureAt, writeLastCaptureAt, hasRecentCapture, lastNagPath, readLastNagAt, writeLastNagAt, hasRecentNag, lastAutoCaptureAttemptPath, readLastAutoCaptureAttemptAt, writeLastAutoCaptureAttemptAt, hasRecentAutoCaptureAttempt, CAPTURE_FRESHNESS_MS, shouldNag, buildCaptureExcerpt } from '../../hooks/recall-nudge-lib.mjs';

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

  it('detects a real code edit (Edit tool) as mutating', () => {
    const p = writeTranscript([assistantEntry([toolUse('Edit', { file_path: '/x.mjs', old_string: 'a', new_string: 'b' })])]);
    assert.equal(scanTranscript(p).sawMutatingAction, true);
  });

  it('detects a real code write (Write tool) as mutating', () => {
    const p = writeTranscript([assistantEntry([toolUse('Write', { file_path: '/x.mjs', content: 'x' })])]);
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
