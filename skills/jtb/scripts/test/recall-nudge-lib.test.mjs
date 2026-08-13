import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanTranscript, lastCapturePath, readLastCaptureAt, writeLastCaptureAt, hasRecentCapture, lastNagPath, readLastNagAt, writeLastNagAt, hasRecentNag, CAPTURE_FRESHNESS_MS, shouldNag } from '../../hooks/recall-nudge-lib.mjs';

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

describe('shouldNag (Stop hook trigger decision)', () => {
  describe('balanced (today\'s exact trigger — LOCK)', () => {
    it('does not nag when no ticket work happened', () => {
      assert.equal(shouldNag({ sawTicketKey: false, sawRecallFlag: false, sawNoteAdd: false, recallStrictness: 'balanced' }), false);
    });

    it('does not nag when a note was already added', () => {
      assert.equal(shouldNag({ sawTicketKey: true, sawRecallFlag: false, sawNoteAdd: true, recallStrictness: 'balanced' }), false);
    });

    it('does not nag when a note was added even if a flag was also raised', () => {
      assert.equal(shouldNag({ sawTicketKey: true, sawRecallFlag: true, sawNoteAdd: true, recallStrictness: 'balanced' }), false);
    });

    it('nags when ticket work happened with no note and no flag', () => {
      assert.equal(shouldNag({ sawTicketKey: true, sawRecallFlag: false, sawNoteAdd: false, recallStrictness: 'balanced' }), true);
    });

    it('nags when a flag was raised but never followed by a note', () => {
      assert.equal(shouldNag({ sawTicketKey: true, sawRecallFlag: true, sawNoteAdd: false, recallStrictness: 'balanced' }), true);
    });
  });

  describe('strict (deliberately identical to balanced — not widened, spec §5)', () => {
    it('matches every balanced case exactly', () => {
      const cases = [
        { sawTicketKey: false, sawRecallFlag: false, sawNoteAdd: false },
        { sawTicketKey: true, sawRecallFlag: false, sawNoteAdd: true },
        { sawTicketKey: true, sawRecallFlag: true, sawNoteAdd: true },
        { sawTicketKey: true, sawRecallFlag: false, sawNoteAdd: false },
        { sawTicketKey: true, sawRecallFlag: true, sawNoteAdd: false },
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
      assert.equal(shouldNag({ sawTicketKey: true, sawRecallFlag: false, sawNoteAdd: false, recallStrictness: 'loose' }), false);
    });

    it('still nags when a flag was raised but never followed by a note', () => {
      assert.equal(shouldNag({ sawTicketKey: true, sawRecallFlag: true, sawNoteAdd: false, recallStrictness: 'loose' }), true);
    });

    it('does not nag when no ticket work happened', () => {
      assert.equal(shouldNag({ sawTicketKey: false, sawRecallFlag: true, sawNoteAdd: false, recallStrictness: 'loose' }), false);
    });

    it('does not nag when a note was already added, even with a flag', () => {
      assert.equal(shouldNag({ sawTicketKey: true, sawRecallFlag: true, sawNoteAdd: true, recallStrictness: 'loose' }), false);
    });
  });

  it('defaults to balanced behavior when recallStrictness is omitted', () => {
    assert.equal(
      shouldNag({ sawTicketKey: true, sawRecallFlag: false, sawNoteAdd: false }),
      true,
    );
  });
});
