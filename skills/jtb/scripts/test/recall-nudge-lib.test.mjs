import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanTranscript, lastCapturePath, readLastCaptureAt, writeLastCaptureAt, hasRecentCapture, CAPTURE_FRESHNESS_MS, shouldNag } from '../../hooks/recall-nudge-lib.mjs';

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
