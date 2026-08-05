import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanTranscript } from '../../hooks/recall-nudge-lib.mjs';

function assistantEntry(blocks) {
  return JSON.stringify({ type: 'assistant', message: { content: blocks } });
}

function toolUse(name, input = {}) {
  return { type: 'tool_use', name, input };
}

function text(t) {
  return { type: 'text', text: t };
}

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
