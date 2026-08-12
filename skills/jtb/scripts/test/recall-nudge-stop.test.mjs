import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { statePath, writeLastCaptureAt, lastCapturePath } from '../../hooks/recall-nudge-lib.mjs';

const HOOK_PATH = fileURLToPath(new URL('../../hooks/recall-nudge-stop.mjs', import.meta.url));

function transcriptWith(entries) {
  return entries.map(e => JSON.stringify(e)).join('\n') + '\n';
}

function assistantText(t) {
  return { type: 'assistant', message: { content: [{ type: 'text', text: t }] } };
}

function assistantToolUse(name, input = {}) {
  return { type: 'assistant', message: { content: [{ type: 'tool_use', name, input }] } };
}

function runHook({ sessionId, transcriptPath, cwd, home }) {
  return spawnSync(process.execPath, [HOOK_PATH], {
    input: JSON.stringify({ session_id: sessionId, transcript_path: transcriptPath, cwd }),
    encoding: 'utf8',
    env: { ...process.env, HOME: home },
  });
}

function writeProfile(home, recallStrictness) {
  const configDir = join(home, '.ticketlens');
  mkdirSync(configDir, { recursive: true });
  const profile = recallStrictness ? { baseUrl: 'https://x.atlassian.net', recallStrictness } : { baseUrl: 'https://x.atlassian.net' };
  writeFileSync(join(configDir, 'profiles.json'), JSON.stringify({ profiles: { test: profile }, default: 'test' }));
}

describe('recall-nudge-stop hook (subprocess)', () => {
  let dir, home, transcriptPath, sessionId;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ticketlens-hook-'));
    home = join(dir, 'home');
    mkdirSync(home, { recursive: true });
    transcriptPath = join(dir, 'transcript.jsonl');
    sessionId = `test-${Math.random().toString(36).slice(2)}`;
  });

  afterEach(() => {
    try { rmSync(statePath(sessionId)); } catch { /* not written this test — fine */ }
    try { rmSync(lastCapturePath(dir)); } catch { /* not written this test — fine */ }
    rmSync(dir, { recursive: true, force: true });
  });

  it('exits 0 with no profile configured (default balanced) when a note was added', () => {
    writeFileSync(transcriptPath, transcriptWith([
      assistantText('Looking at PROD-1234 now.'),
      assistantToolUse('Bash', { command: 'ticketlens note add --title=x' }),
    ]));
    const result = runHook({ sessionId, transcriptPath, cwd: dir, home });
    assert.equal(result.status, 0);
  });

  it('exits 2 with no profile configured (default balanced) when ticket work happened with no note and no flag', () => {
    writeFileSync(transcriptPath, transcriptWith([assistantText('Looking at PROD-1234 now.')]));
    const result = runHook({ sessionId, transcriptPath, cwd: dir, home });
    assert.equal(result.status, 2);
  });

  it('loose profile: exits 0 when ticket work happened but nothing was ever flagged', () => {
    writeProfile(home, 'loose');
    writeFileSync(transcriptPath, transcriptWith([assistantText('Looking at PROD-1234 now.')]));
    const result = runHook({ sessionId, transcriptPath, cwd: dir, home });
    assert.equal(result.status, 0);
  });

  it('loose profile: still exits 2 when a flag was raised but never followed by a note', () => {
    writeProfile(home, 'loose');
    // Ticket-key mention is required here: shouldNag's own committed contract
    // (recall-nudge-lib.test.mjs:162) is that sawRecallFlag alone, with no
    // ticket key ever seen, is NOT enough to nag — the flag text alone
    // (as the brief's original fixture had it) never sets sawTicketKey true.
    writeFileSync(transcriptPath, transcriptWith([
      assistantText('Looking at PROD-1234 now.'),
      assistantText('🔖 Recall-flag: found a gotcha'),
    ]));
    const result = runHook({ sessionId, transcriptPath, cwd: dir, home });
    assert.equal(result.status, 2);
  });

  it('strict profile: behaves identically to no profile (balanced) — exits 2 on ticket work with no note', () => {
    writeProfile(home, 'strict');
    writeFileSync(transcriptPath, transcriptWith([assistantText('Looking at PROD-1234 now.')]));
    const result = runHook({ sessionId, transcriptPath, cwd: dir, home });
    assert.equal(result.status, 2);
  });

  it('LOCK: never blocks a second time for the same session_id, at every strictness level', () => {
    const transcriptByLevel = {
      loose: transcriptWith([
        assistantText('Looking at PROD-1234 now.'),
        assistantText('🔖 Recall-flag: found a gotcha'),
      ]),
      balanced: transcriptWith([assistantText('Looking at PROD-1234 now.')]),
      strict: transcriptWith([assistantText('Looking at PROD-1234 now.')]),
    };
    for (const level of ['loose', 'balanced', 'strict']) {
      writeProfile(home, level);
      const sid = `${sessionId}-${level}`;
      writeFileSync(transcriptPath, transcriptByLevel[level]);
      const first = runHook({ sessionId: sid, transcriptPath, cwd: dir, home });
      const second = runHook({ sessionId: sid, transcriptPath, cwd: dir, home });
      try {
        assert.equal(first.status, 2, `${level} first (must actually block)`);
        assert.equal(second.status, 0, `${level} second (cap must hold)`);
      } finally {
        try { rmSync(statePath(sid)); } catch { /* fine */ }
      }
    }
  });

  it('LOCK: hasRecentCapture bridge suppresses the nag across a session_id rollover, at every strictness level', () => {
    const transcriptByLevel = {
      loose: transcriptWith([
        assistantText('Looking at PROD-1234 now.'),
        assistantText('🔖 Recall-flag: found a gotcha'),
      ]),
      balanced: transcriptWith([assistantText('Looking at PROD-1234 now.')]),
      strict: transcriptWith([assistantText('Looking at PROD-1234 now.')]),
    };
    for (const level of ['loose', 'balanced', 'strict']) {
      writeProfile(home, level);
      const sid = `${sessionId}-bridge-${level}`;
      writeFileSync(transcriptPath, transcriptByLevel[level]);
      writeLastCaptureAt(dir, Date.now());
      const result = runHook({ sessionId: sid, transcriptPath, cwd: dir, home });
      try {
        assert.equal(result.status, 0, `${level}: bridge must suppress the nag`);
      } finally {
        try { rmSync(statePath(sid)); } catch { /* fine */ }
      }
    }
  });
});
