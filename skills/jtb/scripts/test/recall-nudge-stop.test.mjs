import { describe, it, beforeEach, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isolateHookEnv } from './helpers/isolate-hook-env.mjs';
import { statePath, writeLastCaptureAt, readLastCaptureAt, lastCapturePath, writeLastNagAt, readLastNagAt, lastNagPath, lastAutoCaptureAttemptPath, privateTmpDir, CAPTURE_FRESHNESS_MS } from '../../hooks/recall-nudge-lib.mjs';

const HOOK_PATH = fileURLToPath(new URL('../../hooks/recall-nudge-stop.mjs', import.meta.url));

// Resolved before any TMPDIR isolation — the machine-wide log real Stop hooks write to.
const REAL_AUTO_CAPTURE_LOG = join(privateTmpDir(), 'auto-capture.log');
after(isolateHookEnv());

function fingerprint(path) {
  return existsSync(path) ? statSync(path).size : null;
}

async function waitFor(predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return false;
}

function transcriptWith(entries) {
  return entries.map(e => JSON.stringify(e)).join('\n') + '\n';
}

function assistantText(t) {
  return { type: 'assistant', message: { content: [{ type: 'text', text: t }] } };
}

function assistantToolUse(name, input = {}) {
  return { type: 'assistant', message: { content: [{ type: 'tool_use', name, input }] } };
}

function runHook({ sessionId, transcriptPath, cwd, home, env = {} }) {
  return spawnSync(process.execPath, [HOOK_PATH], {
    input: JSON.stringify({ session_id: sessionId, transcript_path: transcriptPath, cwd }),
    encoding: 'utf8',
    env: { ...process.env, HOME: home, ...env },
  });
}

// Truly concurrent (async spawn, not spawnSync) — required to reproduce the
// backlog #40 race: N processes fired back-to-back via Promise.all all reach
// the hook's session-state read before any of them has written it.
function runHookAsync({ sessionId, transcriptPath, cwd, home, env = {} }) {
  return new Promise((resolveHook) => {
    const child = spawn(process.execPath, [HOOK_PATH], {
      env: { ...process.env, HOME: home, ...env },
    });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (status) => resolveHook({ status, stderr }));
    child.stdin.write(JSON.stringify({ session_id: sessionId, transcript_path: transcriptPath, cwd }));
    child.stdin.end();
  });
}

function writeCliTokenFile(home, token) {
  const configDir = join(home, '.ticketlens');
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, 'cli-token.json'), JSON.stringify({ token }));
}

function writeProfile(home, recallStrictness) {
  const configDir = join(home, '.ticketlens');
  mkdirSync(configDir, { recursive: true });
  const profile = recallStrictness ? { baseUrl: 'https://x.atlassian.net', recallStrictness } : { baseUrl: 'https://x.atlassian.net' };
  writeFileSync(join(configDir, 'profiles.json'), JSON.stringify({ profiles: { test: profile }, default: 'test' }));
}

// Two profiles with distinct ticketPrefixes and distinct recallStrictness —
// used to prove the Stop hook resolves the SAME profile as the ticket key
// mentioned in the transcript, not just cwd/default (backlog #12).
function writeMultiProfile(home, { defaultName, profiles }) {
  const configDir = join(home, '.ticketlens');
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, 'profiles.json'), JSON.stringify({ profiles, default: defaultName }));
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
    try { rmSync(lastNagPath(dir)); } catch { /* not written this test — fine */ }
    try { rmSync(lastAutoCaptureAttemptPath(dir)); } catch { /* not written this test — fine */ }
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

  it('exits 0 when a ticket-key-shaped string appears but no fetch tool was ever called (the reported false positive — backlog #15)', () => {
    writeFileSync(transcriptPath, transcriptWith([assistantText('Looking at PROD-1234 now.')]));
    const result = runHook({ sessionId, transcriptPath, cwd: dir, home });
    assert.equal(result.status, 0);
  });

  it('exits 2 when jtb\'s fetch actually ran (MCP form), with real ticket work and no note or flag', () => {
    writeFileSync(transcriptPath, transcriptWith([
      assistantText('Looking at PROD-1234 now.'),
      assistantToolUse('mcp__ticketlens__fetch', { ticket: 'PROD-1234' }),
      assistantToolUse('mcp__ticketlens__ticket_comment', { ticket: 'PROD-1234', body: 'Found the cause.' }),
    ]));
    const result = runHook({ sessionId, transcriptPath, cwd: dir, home });
    assert.equal(result.status, 2);
  });

  describe('backlog #44 (9th/10th reports): entitled accounts get a silent exit 0, never the hard block', () => {
    function realTicketWorkNoNote() {
      writeFileSync(transcriptPath, transcriptWith([
        assistantText('Looking at PROD-1234 now.'),
        assistantToolUse('mcp__ticketlens__fetch', { ticket: 'PROD-1234' }),
        assistantToolUse('mcp__ticketlens__ticket_comment', { ticket: 'PROD-1234', body: 'Found the cause.' }),
      ]));
    }

    it('exits 0 (not 2) for a licensed + logged-in account on the exact scenario that hard-blocks free tier', () => {
      realTicketWorkNoNote();
      writeCliTokenFile(home, 'tl_key');
      const result = runHook({ sessionId, transcriptPath, cwd: dir, home, env: { TICKETLENS_SKIP_LICENSE: 'true' } });
      assert.equal(result.status, 0);
    });

    it('still writes the reminder to stderr even on the silent exit-0 path — a diagnostic trail if the async job silently failed', () => {
      realTicketWorkNoNote();
      writeCliTokenFile(home, 'tl_key');
      const result = runHook({ sessionId, transcriptPath, cwd: dir, home, env: { TICKETLENS_SKIP_LICENSE: 'true' } });
      assert.match(result.stderr, /nothing was ever captured to Recall/);
    });

    it('LOCK: licensed but logged out (no cli-token.json) still hard-blocks — safety net requires BOTH', () => {
      realTicketWorkNoNote();
      const result = runHook({ sessionId, transcriptPath, cwd: dir, home, env: { TICKETLENS_SKIP_LICENSE: 'true' } });
      assert.equal(result.status, 2);
    });

    it('LOCK: a valid token but unlicensed (no TICKETLENS_SKIP_LICENSE) still hard-blocks — safety net requires BOTH', () => {
      realTicketWorkNoNote();
      writeCliTokenFile(home, 'tl_key');
      const result = runHook({ sessionId, transcriptPath, cwd: dir, home });
      assert.equal(result.status, 2);
    });

    it('LOCK: free tier (neither license nor token) is completely unchanged — same exit 2, same message', () => {
      realTicketWorkNoNote();
      const result = runHook({ sessionId, transcriptPath, cwd: dir, home });
      assert.equal(result.status, 2);
      assert.match(result.stderr, /nothing was ever captured to Recall/);
    });

    it('HARD TEST: corrupted cli-token.json fails safe to exit 2, never crashes (readCliToken must swallow the parse error)', () => {
      realTicketWorkNoNote();
      const configDir = join(home, '.ticketlens');
      mkdirSync(configDir, { recursive: true });
      writeFileSync(join(configDir, 'cli-token.json'), '{not valid json');
      const result = runHook({ sessionId, transcriptPath, cwd: dir, home, env: { TICKETLENS_SKIP_LICENSE: 'true' } });
      assert.equal(result.status, 2, `must fail safe to the hard block, not crash — got status=${result.status}, stderr=${result.stderr}`);
      assert.equal(result.signal, null, 'must not have crashed/been killed by a signal');
    });

    it('the broken-promise case (🔖 Recall-flag never followed by a note) also goes silent for entitled accounts', () => {
      writeFileSync(transcriptPath, transcriptWith([
        assistantToolUse('mcp__ticketlens__fetch', { ticket: 'PROD-1234' }),
        assistantToolUse('mcp__ticketlens__ticket_comment', { ticket: 'PROD-1234', body: 'x' }),
        assistantText('🔖 Recall-flag: worth remembering'),
      ]));
      writeCliTokenFile(home, 'tl_key');
      const result = runHook({ sessionId, transcriptPath, cwd: dir, home, env: { TICKETLENS_SKIP_LICENSE: 'true' } });
      assert.equal(result.status, 0);
    });
  });

  it('exits 0 on a pure read-only lookup — fetch ran, no mutation at all (the reported false positive — backlog #24, 6th report)', () => {
    writeFileSync(transcriptPath, transcriptWith([
      assistantToolUse('mcp__ticketlens__fetch', { ticket: 'PROD-1234' }),
      assistantText('Status: Done.'),
    ]));
    const result = runHook({ sessionId, transcriptPath, cwd: dir, home });
    assert.equal(result.status, 0);
  });

  // Backlog #38 / #24b: all three real false-positive nags (2026-09-17 x2, 2026-09-21)
  // were armed only by assistant Edit/Write of memory files or scratch comment drafts.
  it('exits 0 when fetch ran and the only "work" was Write/Edit of assistant memory files (backlog #38, 2026-09-21 incident shape)', () => {
    writeFileSync(transcriptPath, transcriptWith([
      assistantToolUse('mcp__ticketlens__fetch', { ticket: 'PROD-1234' }),
      assistantToolUse('Write', { file_path: '/Users/u/.claude-work/projects/-proj/memory/attachment-digests/abc-digest.md', content: 'x' }),
      assistantToolUse('Edit', { file_path: '/Users/u/.claude-work/projects/-proj/memory/MEMORY.md', old_string: 'a', new_string: 'b' }),
      assistantText('Plan ready, awaiting approval.'),
    ]));
    const result = runHook({ sessionId, transcriptPath, cwd: dir, home });
    assert.equal(result.status, 0);
  });

  it('exits 0 when fetch ran and the only "work" was a scratch Jira comment draft file (backlog #38, 2026-09-17 incident shape)', () => {
    writeFileSync(transcriptPath, transcriptWith([
      assistantToolUse('mcp__ticketlens__fetch', { ticket: 'PROD-1234' }),
      assistantToolUse('Write', { file_path: '/repo/tickets/proj/tmp_PROD-1234_jira_comment.txt', content: 'h2. Draft' }),
      assistantText('Draft saved, not posted yet.'),
    ]));
    const result = runHook({ sessionId, transcriptPath, cwd: dir, home });
    assert.equal(result.status, 0);
  });

  it('exits 0 when fetch ran and the only "work" was a source-file Edit — no ticket write (backlog #38)', () => {
    writeFileSync(transcriptPath, transcriptWith([
      assistantToolUse('mcp__ticketlens__fetch', { ticket: 'PROD-1234' }),
      assistantToolUse('Edit', { file_path: '/repo/src/a.mjs', old_string: 'a', new_string: 'b' }),
    ]));
    const result = runHook({ sessionId, transcriptPath, cwd: dir, home });
    assert.equal(result.status, 0);
  });

  it('LOCK: still exits 2 when a real ticket write happened alongside memory/draft file writes (backlog #38)', () => {
    writeFileSync(transcriptPath, transcriptWith([
      assistantToolUse('mcp__ticketlens__fetch', { ticket: 'PROD-1234' }),
      assistantToolUse('Write', { file_path: '/repo/tickets/proj/tmp_PROD-1234_jira_comment.txt', content: 'h2. Draft' }),
      assistantToolUse('Edit', { file_path: '/Users/u/.claude-work/projects/-proj/memory/MEMORY.md', old_string: 'a', new_string: 'b' }),
      assistantToolUse('mcp__ticketlens__ticket_comment', { ticket: 'PROD-1234', body: 'Found the cause.' }),
    ]));
    const result = runHook({ sessionId, transcriptPath, cwd: dir, home });
    assert.equal(result.status, 2);
  });

  it('exits 2 when jtb\'s fetch ran via the bare CLI form (ticketlens TICKET-KEY), plus real ticket work, with no note', () => {
    writeFileSync(transcriptPath, transcriptWith([
      assistantToolUse('Bash', { command: 'ticketlens PROD-1234' }),
      assistantToolUse('Bash', { command: 'ticketlens transition PROD-1234 --target="Done" --confirm' }),
    ]));
    const result = runHook({ sessionId, transcriptPath, cwd: dir, home });
    assert.equal(result.status, 2);
  });

  it('loose profile: exits 0 when fetch + real work happened but nothing was ever flagged', () => {
    writeProfile(home, 'loose');
    writeFileSync(transcriptPath, transcriptWith([
      assistantText('Looking at PROD-1234 now.'),
      assistantToolUse('mcp__ticketlens__fetch', { ticket: 'PROD-1234' }),
      assistantToolUse('mcp__ticketlens__ticket_comment', { ticket: 'PROD-1234', body: 'x' }),
    ]));
    const result = runHook({ sessionId, transcriptPath, cwd: dir, home });
    assert.equal(result.status, 0);
  });

  it('loose profile: still exits 2 when a flag was raised but never followed by a note (real work present)', () => {
    writeProfile(home, 'loose');
    // A real fetch call is required here too (backlog #15): shouldNag's gate
    // is now sawFetch, not sawTicketKey — sawRecallFlag alone, with no fetch
    // ever run, is NOT enough to nag even in loose mode. sawMutatingAction is
    // required too (backlog #24, 6th report) — a flag with pure read-only
    // work still can't nag, so a real mutating action is included here.
    writeFileSync(transcriptPath, transcriptWith([
      assistantText('Looking at PROD-1234 now.'),
      assistantToolUse('mcp__ticketlens__fetch', { ticket: 'PROD-1234' }),
      assistantToolUse('mcp__ticketlens__ticket_comment', { ticket: 'PROD-1234', body: 'x' }),
      assistantText('🔖 Recall-flag: found a gotcha'),
    ]));
    const result = runHook({ sessionId, transcriptPath, cwd: dir, home });
    assert.equal(result.status, 2);
  });

  it('strict profile: behaves identically to no profile (balanced) — exits 2 when fetch + real work happened with no note', () => {
    writeProfile(home, 'strict');
    writeFileSync(transcriptPath, transcriptWith([
      assistantText('Looking at PROD-1234 now.'),
      assistantToolUse('mcp__ticketlens__fetch', { ticket: 'PROD-1234' }),
      assistantToolUse('mcp__ticketlens__ticket_comment', { ticket: 'PROD-1234', body: 'x' }),
    ]));
    const result = runHook({ sessionId, transcriptPath, cwd: dir, home });
    assert.equal(result.status, 2);
  });

  describe('backlog #20: team Console default, via the local settings cache', () => {
    function writeCliToken(home, token) {
      const configDir = join(home, '.ticketlens');
      mkdirSync(configDir, { recursive: true });
      writeFileSync(join(configDir, 'cli-token.json'), JSON.stringify({ token }));
    }

    function writeSettingsCache(home, values, tokenHash) {
      const configDir = join(home, '.ticketlens');
      mkdirSync(configDir, { recursive: true });
      writeFileSync(join(configDir, 'recall-settings-cache.json'), JSON.stringify({
        values, tokenHash, fetchedAt: new Date().toISOString(),
      }));
    }

    it('applies the cached team default when the profile has no local override', async () => {
      const { hashToken } = await import('../lib/recall-sync.mjs');
      writeCliToken(home, 'tl_key');
      writeSettingsCache(home, { recall_strictness: 'loose' }, hashToken('tl_key'));
      // No writeProfile() call — profile has no recallStrictness of its own.
      // fetch ran, nothing flagged, no note: loose exits 0, balanced/strict exit 2
      // (see the sibling tests above) — this is the discriminating scenario that
      // proves the cached 'loose' value was actually applied, not just defaulted.
      writeFileSync(transcriptPath, transcriptWith([
        assistantText('Looking at PROD-1234 now.'),
        assistantToolUse('mcp__ticketlens__fetch', { ticket: 'PROD-1234' }),
        assistantToolUse('mcp__ticketlens__ticket_comment', { ticket: 'PROD-1234', body: 'x' }),
      ]));
      const result = runHook({ sessionId, transcriptPath, cwd: dir, home });
      assert.equal(result.status, 0);
    });

    it('a local profile override still wins over the cached team default', async () => {
      const { hashToken } = await import('../lib/recall-sync.mjs');
      writeCliToken(home, 'tl_key');
      writeSettingsCache(home, { recall_strictness: 'loose' }, hashToken('tl_key'));
      writeProfile(home, 'strict'); // explicit local override
      writeFileSync(transcriptPath, transcriptWith([
        assistantText('Looking at PROD-1234 now.'),
        assistantToolUse('mcp__ticketlens__fetch', { ticket: 'PROD-1234' }),
        assistantToolUse('mcp__ticketlens__ticket_comment', { ticket: 'PROD-1234', body: 'x' }),
      ]));
      const result = runHook({ sessionId, transcriptPath, cwd: dir, home });
      assert.equal(result.status, 2); // strict, not the cached loose
    });

    // ── Red-team pass (Scenario C: CLI offline resolution) ─────────────────

    it('attack: a cache written under a different account\'s tokenHash is ignored, even reached through the real hook subprocess', async () => {
      const { hashToken } = await import('../lib/recall-sync.mjs');
      writeCliToken(home, 'attacker_key');
      // Cache was legitimately written for a DIFFERENT account (e.g. a shared
      // machine, or a stale cache surviving an account switch).
      writeSettingsCache(home, { recall_strictness: 'loose' }, hashToken('victim_key'));
      // fetch + real work ran, nothing flagged, no note — loose would exit 0;
      // balanced (the safe fallback) exits 2. A mismatched-tokenHash cache
      // must NOT apply.
      writeFileSync(transcriptPath, transcriptWith([
        assistantText('Looking at PROD-1234 now.'),
        assistantToolUse('mcp__ticketlens__fetch', { ticket: 'PROD-1234' }),
        assistantToolUse('mcp__ticketlens__ticket_comment', { ticket: 'PROD-1234', body: 'x' }),
      ]));
      const result = runHook({ sessionId, transcriptPath, cwd: dir, home });
      assert.equal(result.status, 2);
    });

    it('attack: a garbage/malicious recall_strictness value in the cache file never crashes the hook or gets used as-is', async () => {
      const { hashToken } = await import('../lib/recall-sync.mjs');
      writeCliToken(home, 'tl_key');
      writeSettingsCache(home, { recall_strictness: "'; process.exit(1); //__proto__" }, hashToken('tl_key'));
      writeFileSync(transcriptPath, transcriptWith([
        assistantText('Looking at PROD-1234 now.'),
        assistantToolUse('mcp__ticketlens__fetch', { ticket: 'PROD-1234' }),
        assistantToolUse('mcp__ticketlens__ticket_comment', { ticket: 'PROD-1234', body: 'x' }),
      ]));
      const result = runHook({ sessionId, transcriptPath, cwd: dir, home });
      // Must fall through to the safe default (balanced → exit 2), not crash
      // (a non-0/non-2 status, e.g. from an uncaught exception, would fail this).
      assert.equal(result.status, 2);
      assert.equal(result.signal, null);
    });

    it('attack: a corrupted (non-JSON) cache file degrades to platform default instead of crashing the hook', () => {
      const configDir = join(home, '.ticketlens');
      mkdirSync(configDir, { recursive: true });
      writeFileSync(join(configDir, 'cli-token.json'), JSON.stringify({ token: 'tl_key' }));
      writeFileSync(join(configDir, 'recall-settings-cache.json'), '{not valid json at all');
      writeFileSync(transcriptPath, transcriptWith([
        assistantText('Looking at PROD-1234 now.'),
        assistantToolUse('mcp__ticketlens__fetch', { ticket: 'PROD-1234' }),
        assistantToolUse('mcp__ticketlens__ticket_comment', { ticket: 'PROD-1234', body: 'x' }),
      ]));
      const result = runHook({ sessionId, transcriptPath, cwd: dir, home });
      assert.equal(result.status, 2); // balanced default, not a crash
      assert.equal(result.signal, null);
    });

    it('attack: a maliciously large cache file (10MB) does not hang or crash the hook that runs on every session end', () => {
      const configDir = join(home, '.ticketlens');
      mkdirSync(configDir, { recursive: true });
      writeFileSync(join(configDir, 'cli-token.json'), JSON.stringify({ token: 'tl_key' }));
      // A 10MB junk value in an otherwise-valid JSON shape — proves the hook
      // doesn't choke on file size alone (it must complete well under any
      // reasonable session-end timeout).
      writeFileSync(join(configDir, 'recall-settings-cache.json'), JSON.stringify({
        values: { recall_strictness: 'x'.repeat(10 * 1024 * 1024) },
        tokenHash: 'irrelevant',
        fetchedAt: new Date().toISOString(),
      }));
      writeFileSync(transcriptPath, transcriptWith([
        assistantText('Looking at PROD-1234 now.'),
        assistantToolUse('mcp__ticketlens__fetch', { ticket: 'PROD-1234' }),
        assistantToolUse('mcp__ticketlens__ticket_comment', { ticket: 'PROD-1234', body: 'x' }),
      ]));
      const start = Date.now();
      const result = runHook({ sessionId, transcriptPath, cwd: dir, home });
      assert.ok(Date.now() - start < 5000, 'hook must not hang on an oversized cache file');
      assert.equal(result.signal, null);
    });
  });

  it('LOCK: the hook source never imports the live/async settings-fetch path — it must stay network-free on every session end', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(fileURLToPath(new URL('../../hooks/recall-nudge-stop.mjs', import.meta.url)), 'utf8');
    assert.doesNotMatch(source, /fetchRecallSettings|getEffectiveRecallSettings\b/);
  });

  it('LOCK: never blocks a second time for the same session_id, at every strictness level', () => {
    const transcriptByLevel = {
      loose: transcriptWith([
        assistantText('Looking at PROD-1234 now.'),
        assistantToolUse('mcp__ticketlens__fetch', { ticket: 'PROD-1234' }),
        assistantToolUse('mcp__ticketlens__ticket_comment', { ticket: 'PROD-1234', body: 'x' }),
        assistantText('🔖 Recall-flag: found a gotcha'),
      ]),
      balanced: transcriptWith([
        assistantText('Looking at PROD-1234 now.'),
        assistantToolUse('mcp__ticketlens__fetch', { ticket: 'PROD-1234' }),
        assistantToolUse('mcp__ticketlens__ticket_comment', { ticket: 'PROD-1234', body: 'x' }),
      ]),
      strict: transcriptWith([
        assistantText('Looking at PROD-1234 now.'),
        assistantToolUse('mcp__ticketlens__fetch', { ticket: 'PROD-1234' }),
        assistantToolUse('mcp__ticketlens__ticket_comment', { ticket: 'PROD-1234', body: 'x' }),
      ]),
    };
    for (const level of ['loose', 'balanced', 'strict']) {
      writeProfile(home, level);
      const sid = `${sessionId}-${level}`;
      // Distinct cwd per iteration: this test isolates per-session_id dedup
      // specifically, so it must not trigger the (separate, intentional)
      // cross-session lastNag bridge (backlog #14) that now legitimately
      // suppresses a repeat nag for the SAME cwd across different session_ids.
      const levelDir = join(dir, `lock-${level}`);
      mkdirSync(levelDir, { recursive: true });
      writeFileSync(transcriptPath, transcriptByLevel[level]);
      const first = runHook({ sessionId: sid, transcriptPath, cwd: levelDir, home });
      const second = runHook({ sessionId: sid, transcriptPath, cwd: levelDir, home });
      try {
        assert.equal(first.status, 2, `${level} first (must actually block)`);
        assert.equal(second.status, 0, `${level} second (cap must hold)`);
      } finally {
        try { rmSync(statePath(sid)); } catch { /* fine */ }
        try { rmSync(lastNagPath(levelDir)); } catch { /* fine */ }
      }
    }
  });

  it('LOCK: hasRecentCapture bridge suppresses the nag across a session_id rollover, at every strictness level', () => {
    const transcriptByLevel = {
      loose: transcriptWith([
        assistantText('Looking at PROD-1234 now.'),
        assistantToolUse('mcp__ticketlens__fetch', { ticket: 'PROD-1234' }),
        assistantToolUse('mcp__ticketlens__ticket_comment', { ticket: 'PROD-1234', body: 'x' }),
        assistantText('🔖 Recall-flag: found a gotcha'),
      ]),
      balanced: transcriptWith([
        assistantText('Looking at PROD-1234 now.'),
        assistantToolUse('mcp__ticketlens__fetch', { ticket: 'PROD-1234' }),
        assistantToolUse('mcp__ticketlens__ticket_comment', { ticket: 'PROD-1234', body: 'x' }),
      ]),
      strict: transcriptWith([
        assistantText('Looking at PROD-1234 now.'),
        assistantToolUse('mcp__ticketlens__fetch', { ticket: 'PROD-1234' }),
        assistantToolUse('mcp__ticketlens__ticket_comment', { ticket: 'PROD-1234', body: 'x' }),
      ]),
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

  it('LOCK-NEW: hasRecentNag bridge suppresses a repeat nag across a session_id rollover, when the first session already nagged with no capture in between (backlog #14 — compaction/resume rollover)', () => {
    // Same ongoing work, no note added between the two invocations — simulates
    // a compaction/resume event minting a brand-new session_id mid-session,
    // which resets the per-session_id stopChecked gate. Before this fix, only
    // a REAL capture (hasRecentCapture) bridged that boundary; a dismissed nag
    // was never remembered, so the same still-ongoing work got nagged again.
    writeFileSync(transcriptPath, transcriptWith([
      assistantText('Looking at PROD-1234 now.'),
      assistantToolUse('mcp__ticketlens__fetch', { ticket: 'PROD-1234' }),
      assistantToolUse('mcp__ticketlens__ticket_comment', { ticket: 'PROD-1234', body: 'x' }),
    ]));
    const sidA = `${sessionId}-nag-a`;
    const sidB = `${sessionId}-nag-b`;
    const first = runHook({ sessionId: sidA, transcriptPath, cwd: dir, home });
    const second = runHook({ sessionId: sidB, transcriptPath, cwd: dir, home });
    try {
      assert.equal(first.status, 2, 'first session must actually block (sanity — no capture, no prior nag yet)');
      assert.equal(second.status, 0, 'second session (new session_id, same cwd, no capture in between, within the freshness window) must NOT re-nag');
    } finally {
      try { rmSync(statePath(sidA)); } catch { /* fine */ }
      try { rmSync(statePath(sidB)); } catch { /* fine */ }
    }
  });

  describe('sliding marker window (backlog #24, 7th report)', () => {
    // Real incident: a capture in one session at 17:48 kept the marker fresh,
    // but a later session with ongoing ticket work never renewed it, so it
    // expired mid-work at 19:48 and the hook nagged "nothing was ever captured".
    const NEARLY_EXPIRED_MS = CAPTURE_FRESHNESS_MS - 60_000;
    const JUST_EXPIRED_MS = CAPTURE_FRESHNESS_MS + 60_000;

    const ticketWorkTranscript = () => transcriptWith([
      assistantText('Looking at PROD-1234 now.'),
      assistantToolUse('mcp__ticketlens__fetch', { ticket: 'PROD-1234' }),
      assistantToolUse('mcp__ticketlens__ticket_comment', { ticket: 'PROD-1234', body: 'x' }),
    ]);

    function runStop(label) {
      const sid = `${sessionId}-${label}`;
      const result = runHook({ sessionId: sid, transcriptPath, cwd: dir, home });
      try { rmSync(statePath(sid)); } catch { /* not written this run — fine */ }
      return result;
    }

    it('LOCK: a capture marker past the window does not suppress the nag and is not revived', () => {
      writeFileSync(transcriptPath, ticketWorkTranscript());
      const staleAt = Date.now() - JUST_EXPIRED_MS;
      writeLastCaptureAt(dir, staleAt);

      assert.equal(runStop('stale-capture').status, 2, 'idle past the window must allow a nag');
      assert.equal(readLastCaptureAt(dir), staleAt, 'a lapsed marker must stay lapsed');
    });

    it('LOCK: a nag marker past the window does not suppress a repeat nag', () => {
      writeFileSync(transcriptPath, ticketWorkTranscript());
      writeLastNagAt(dir, Date.now() - JUST_EXPIRED_MS);

      assert.equal(runStop('stale-nag').status, 2, 'idle past the window must allow a nag');
    });

    it('LOCK: a Stop with no marker ever recorded nags and never invents a capture marker', () => {
      writeFileSync(transcriptPath, ticketWorkTranscript());

      assert.equal(runStop('no-marker').status, 2, 'first session with real ticket work and no capture must nag');
      assert.equal(readLastCaptureAt(dir), 0, 'only a real note-add may create the capture marker');
    });

    it('LOCK: a Stop with no ticket work does not renew an aging marker', () => {
      writeFileSync(transcriptPath, transcriptWith([assistantText('Refactoring a helper, no ticket involved.')]));
      const agingAt = Date.now() - NEARLY_EXPIRED_MS;
      writeLastCaptureAt(dir, agingAt);
      writeLastNagAt(dir, agingAt);

      assert.equal(runStop('non-ticket').status, 0);
      assert.equal(readLastCaptureAt(dir), agingAt, 'unrelated work in the same cwd must not keep the capture marker alive');
      assert.equal(readLastNagAt(dir), agingAt, 'unrelated work in the same cwd must not keep the nag marker alive');
    });

    it('ongoing ticket work renews a still-fresh capture marker, so it cannot expire mid-work', () => {
      writeFileSync(transcriptPath, ticketWorkTranscript());
      writeLastCaptureAt(dir, Date.now() - NEARLY_EXPIRED_MS);
      const before = Date.now();

      assert.equal(runStop('renew-capture').status, 0);
      assert.ok(readLastCaptureAt(dir) >= before, 'marker must restart its window from this Stop');
    });

    it('ongoing ticket work renews a still-fresh nag marker, so a dismissed nag stays dismissed', () => {
      writeFileSync(transcriptPath, ticketWorkTranscript());
      writeLastNagAt(dir, Date.now() - NEARLY_EXPIRED_MS);
      const before = Date.now();

      assert.equal(runStop('renew-nag').status, 0);
      assert.ok(readLastNagAt(dir) >= before, 'marker must restart its window from this Stop');
    });

    it('a read-only lookup (fetch, no mutation) does not renew an aging marker', () => {
      // Such a session could never nag itself (backlog #24, 6th report), so it
      // must not extend the suppression of a later session that could.
      writeFileSync(transcriptPath, transcriptWith([
        assistantText('Looking at PROD-1234 now.'),
        assistantToolUse('mcp__ticketlens__fetch', { ticket: 'PROD-1234' }),
      ]));
      const agingAt = Date.now() - NEARLY_EXPIRED_MS;
      writeLastCaptureAt(dir, agingAt);
      writeLastNagAt(dir, agingAt);

      assert.equal(runStop('read-only').status, 0);
      assert.equal(readLastCaptureAt(dir), agingAt, 'lookups must not keep the capture marker alive');
      assert.equal(readLastNagAt(dir), agingAt, 'lookups must not keep the nag marker alive');
    });
  });

  describe('multi-profile resolution by matched ticket key (backlog #12)', () => {
    it('nags per the NON-default profile matching the transcript\'s ticket key, not the default\'s strictness', () => {
      // Default profile ('alpha') is 'loose' — ticket-work-only would NOT nag under loose.
      // But the transcript's ticket key (BETA-42) belongs to 'beta', which is 'strict'
      // (same trigger as balanced: ticket work with no note/flag DOES nag). Before the
      // fix, the hook always resolved 'alpha' (the default) since it never saw the
      // ticket key — this proves it now resolves 'beta' instead.
      writeMultiProfile(home, {
        defaultName: 'alpha',
        profiles: {
          alpha: { baseUrl: 'https://a.atlassian.net', ticketPrefixes: ['ALPHA'], recallStrictness: 'loose' },
          beta: { baseUrl: 'https://b.atlassian.net', ticketPrefixes: ['BETA'], recallStrictness: 'strict' },
        },
      });
      writeFileSync(transcriptPath, transcriptWith([
        assistantText('Looking at BETA-42 now.'),
        assistantToolUse('mcp__ticketlens__fetch', { ticket: 'BETA-42' }),
        assistantToolUse('mcp__ticketlens__ticket_comment', { ticket: 'BETA-42', body: 'x' }),
      ]));
      const result = runHook({ sessionId, transcriptPath, cwd: dir, home });
      assert.equal(result.status, 2);
    });

    it('suppresses the nag per the NON-default profile\'s looser strictness, not the default\'s stricter one', () => {
      // Default profile ('alpha') is 'strict' — ticket-work-only WOULD nag under strict.
      // The transcript's ticket key (BETA-42) belongs to 'beta', which is 'loose'
      // (ticket-work-only, no flag, does NOT nag under loose). Before the fix, the hook
      // always resolved 'alpha' (the default) and would have wrongly nagged.
      writeMultiProfile(home, {
        defaultName: 'alpha',
        profiles: {
          alpha: { baseUrl: 'https://a.atlassian.net', ticketPrefixes: ['ALPHA'], recallStrictness: 'strict' },
          beta: { baseUrl: 'https://b.atlassian.net', ticketPrefixes: ['BETA'], recallStrictness: 'loose' },
        },
      });
      writeFileSync(transcriptPath, transcriptWith([
        assistantText('Looking at BETA-42 now.'),
        assistantToolUse('mcp__ticketlens__fetch', { ticket: 'BETA-42' }),
        assistantToolUse('mcp__ticketlens__ticket_comment', { ticket: 'BETA-42', body: 'x' }),
      ]));
      const result = runHook({ sessionId, transcriptPath, cwd: dir, home });
      assert.equal(result.status, 0);
    });
  });

  describe('autonomous background auto-capture: license/token pre-check + per-cwd throttle (code review, 2026-09-15)', () => {
    beforeEach(() => {
      writeFileSync(transcriptPath, transcriptWith([
        assistantText('Looking at PROD-1234 now.'),
        assistantToolUse('mcp__ticketlens__fetch', { ticket: 'PROD-1234' }),
        assistantToolUse('mcp__ticketlens__ticket_comment', { ticket: 'PROD-1234', body: 'x' }),
        assistantToolUse('Bash', { command: 'ticketlens note add --title=x' }), // avoids the sync nag entirely — this block only cares about the spawn gate
      ]));
    });

    it('does NOT write the auto-capture-attempt marker when unlicensed (no Pro, no TICKETLENS_SKIP_LICENSE) — never spawns for free tier', () => {
      writeCliTokenFile(home, 'tl_key');
      runHook({ sessionId, transcriptPath, cwd: dir, home });
      assert.equal(existsSync(lastAutoCaptureAttemptPath(dir)), false);
    });

    it('does NOT write the marker when licensed but logged out (no cli-token.json) — never spawns without a token', () => {
      runHook({ sessionId, transcriptPath, cwd: dir, home, env: { TICKETLENS_SKIP_LICENSE: 'true' } });
      assert.equal(existsSync(lastAutoCaptureAttemptPath(dir)), false);
    });

    it('writes the auto-capture-attempt marker when licensed + logged in', () => {
      writeCliTokenFile(home, 'tl_key');
      runHook({ sessionId, transcriptPath, cwd: dir, home, env: { TICKETLENS_SKIP_LICENSE: 'true' } });
      assert.equal(existsSync(lastAutoCaptureAttemptPath(dir)), true);
    });

    it('throttles a second spawn within the freshness window — same cwd, different session_id (the per-turn duplicate-spawn bug)', () => {
      writeCliTokenFile(home, 'tl_key');
      const env = { TICKETLENS_SKIP_LICENSE: 'true' };
      runHook({ sessionId: `${sessionId}-a`, transcriptPath, cwd: dir, home, env });
      const firstMtime = statSync(lastAutoCaptureAttemptPath(dir)).mtimeMs;
      // A brand-new session_id (simulates the next turn's Stop check) — if the
      // throttle didn't hold, this would rewrite the marker with a new mtime.
      runHook({ sessionId: `${sessionId}-b`, transcriptPath, cwd: dir, home, env });
      const secondMtime = statSync(lastAutoCaptureAttemptPath(dir)).mtimeMs;
      assert.equal(secondMtime, firstMtime, 'second Stop check within the window must not re-write the marker (proves it did not re-spawn)');
      try { rmSync(statePath(`${sessionId}-a`)); } catch { /* fine */ }
      try { rmSync(statePath(`${sessionId}-b`)); } catch { /* fine */ }
      try { rmSync(lastNagPath(dir)); } catch { /* fine */ }
    });

    it('the detached auto-capture child never writes to the real machine-wide auto-capture.log (backlog #33)', async () => {
      const isolatedLog = join(privateTmpDir(), 'auto-capture.log');
      assert.notEqual(isolatedLog, REAL_AUTO_CAPTURE_LOG, 'this suite must run against an isolated TMPDIR');
      const realLogBefore = fingerprint(REAL_AUTO_CAPTURE_LOG);
      const isolatedLogBefore = fingerprint(isolatedLog) ?? 0;
      writeCliTokenFile(home, 'tl_key');
      runHook({ sessionId, transcriptPath, cwd: dir, home, env: { TICKETLENS_SKIP_LICENSE: 'true' } });
      // Growth, not existence: earlier tests' children may already have created the isolated log.
      const childLogged = await waitFor(() => (fingerprint(isolatedLog) ?? 0) > isolatedLogBefore);
      assert.equal(childLogged, true, 'the spawned child must log into the test-isolated tmp dir');
      assert.equal(fingerprint(REAL_AUTO_CAPTURE_LOG), realLogBefore, 'real log must be untouched by the test suite');
    });

    it('a different cwd gets its own independent throttle window', () => {
      writeCliTokenFile(home, 'tl_key');
      const env = { TICKETLENS_SKIP_LICENSE: 'true' };
      runHook({ sessionId, transcriptPath, cwd: dir, home, env });
      const otherDir = join(dir, 'other-cwd');
      mkdirSync(otherDir, { recursive: true });
      const otherTranscript = join(otherDir, 'transcript.jsonl');
      writeFileSync(otherTranscript, transcriptWith([
        assistantToolUse('mcp__ticketlens__fetch', { ticket: 'PROD-9999' }),
      ]));
      runHook({ sessionId: `${sessionId}-other`, transcriptPath: otherTranscript, cwd: otherDir, home, env });
      assert.equal(existsSync(lastAutoCaptureAttemptPath(otherDir)), true);
      try { rmSync(statePath(`${sessionId}-other`)); } catch { /* fine */ }
      try { rmSync(lastAutoCaptureAttemptPath(otherDir)); } catch { /* fine */ }
    });
  });
});

describe('concurrent Stop hooks, same session_id — atomic claim (backlog #40, HARD TEST)', () => {
  let dir, home, transcriptPath, sessionId;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ticketlens-hook-race-'));
    home = join(dir, 'home');
    mkdirSync(home, { recursive: true });
    transcriptPath = join(dir, 'transcript.jsonl');
    sessionId = `race-${Math.random().toString(36).slice(2)}`;
  });

  afterEach(() => {
    try { rmSync(statePath(sessionId)); } catch { /* not written this test — fine */ }
    try { rmSync(lastNagPath(dir)); } catch { /* not written this test — fine */ }
    rmSync(dir, { recursive: true, force: true });
  });

  it('HARD TEST: exactly one of 8 truly concurrent runs blocks — real fetch + real mutation, no note', async () => {
    writeFileSync(transcriptPath, transcriptWith([
      assistantText('Looking at PROD-1234 now.'),
      assistantToolUse('mcp__ticketlens__fetch', { ticket: 'PROD-1234' }),
      assistantToolUse('mcp__ticketlens__ticket_comment', { ticket: 'PROD-1234', body: 'x' }),
    ]));
    const results = await Promise.all(
      Array.from({ length: 8 }, () => runHookAsync({ sessionId, transcriptPath, cwd: dir, home })),
    );
    const blocked = results.filter((r) => r.status === 2);
    assert.equal(blocked.length, 1, `expected exactly 1 block, got ${blocked.length} of 8`);
  });

  it('HARD TEST: exactly one of 8 concurrent runs blocks — loose profile, recall-flag path (different shouldNag branch)', async () => {
    writeProfile(home, 'loose');
    writeFileSync(transcriptPath, transcriptWith([
      assistantText('Looking at PROD-1234 now.'),
      assistantToolUse('mcp__ticketlens__fetch', { ticket: 'PROD-1234' }),
      assistantToolUse('mcp__ticketlens__ticket_comment', { ticket: 'PROD-1234', body: 'x' }),
      assistantText('🔖 Recall-flag: found a gotcha'),
    ]));
    const results = await Promise.all(
      Array.from({ length: 8 }, () => runHookAsync({ sessionId, transcriptPath, cwd: dir, home })),
    );
    const blocked = results.filter((r) => r.status === 2);
    assert.equal(blocked.length, 1, `expected exactly 1 block, got ${blocked.length} of 8`);
  });

  it('HARD TEST (backlog #44): 8 concurrent runs, entitled account — all exit 0, never 2, none crash', async () => {
    writeCliTokenFile(home, 'tl_race_test');
    writeFileSync(transcriptPath, transcriptWith([
      assistantText('Looking at PROD-1234 now.'),
      assistantToolUse('mcp__ticketlens__fetch', { ticket: 'PROD-1234' }),
      assistantToolUse('mcp__ticketlens__ticket_comment', { ticket: 'PROD-1234', body: 'x' }),
    ]));
    const results = await Promise.all(
      Array.from({ length: 8 }, () => runHookAsync({ sessionId, transcriptPath, cwd: dir, home, env: { TICKETLENS_SKIP_LICENSE: 'true' } })),
    );
    const blocked = results.filter((r) => r.status === 2);
    assert.equal(blocked.length, 0, `entitled account must never hard-block, got ${blocked.length} of 8`);
    assert.ok(results.every((r) => r.status === 0), `every run must exit 0 cleanly, got statuses: ${results.map(r => r.status)}`);
    try { rmSync(lastAutoCaptureAttemptPath(dir)); } catch { /* fine */ }
  });

  it('HARD TEST: 16-way concurrency still yields exactly one block', async () => {
    writeFileSync(transcriptPath, transcriptWith([
      assistantToolUse('mcp__ticketlens__fetch', { ticket: 'PROD-1234' }),
      assistantToolUse('mcp__ticketlens__ticket_comment', { ticket: 'PROD-1234', body: 'x' }),
    ]));
    const results = await Promise.all(
      Array.from({ length: 16 }, () => runHookAsync({ sessionId, transcriptPath, cwd: dir, home })),
    );
    const blocked = results.filter((r) => r.status === 2);
    assert.equal(blocked.length, 1, `expected exactly 1 block, got ${blocked.length} of 16`);
  });

  it('adversarial bypass: a pre-planted garbage file at the claim path is treated as already-claimed, no crash, no double-nag', () => {
    writeFileSync(transcriptPath, transcriptWith([
      assistantToolUse('mcp__ticketlens__fetch', { ticket: 'PROD-1234' }),
      assistantToolUse('mcp__ticketlens__ticket_comment', { ticket: 'PROD-1234', body: 'x' }),
    ]));
    writeFileSync(statePath(sessionId), 'not json{{{'); // pre-planted before the hook ever runs
    const result = runHook({ sessionId, transcriptPath, cwd: dir, home });
    assert.equal(result.status, 0);
  });

  it('sequential runs (not concurrent) still cap at exactly one block — must not regress the existing dedup behaviour', () => {
    writeFileSync(transcriptPath, transcriptWith([
      assistantToolUse('mcp__ticketlens__fetch', { ticket: 'PROD-1234' }),
      assistantToolUse('mcp__ticketlens__ticket_comment', { ticket: 'PROD-1234', body: 'x' }),
    ]));
    const first = runHook({ sessionId, transcriptPath, cwd: dir, home });
    const second = runHook({ sessionId, transcriptPath, cwd: dir, home });
    assert.equal(first.status, 2);
    assert.equal(second.status, 0);
  });
});
