import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { statePath, writeLastCaptureAt, lastCapturePath, lastNagPath } from '../../hooks/recall-nudge-lib.mjs';

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

  it('exits 2 when jtb\'s fetch actually ran (MCP form), with no note and no flag', () => {
    writeFileSync(transcriptPath, transcriptWith([
      assistantText('Looking at PROD-1234 now.'),
      assistantToolUse('mcp__ticketlens__fetch', { ticket: 'PROD-1234' }),
    ]));
    const result = runHook({ sessionId, transcriptPath, cwd: dir, home });
    assert.equal(result.status, 2);
  });

  it('exits 2 when jtb\'s fetch ran via the bare CLI form (ticketlens TICKET-KEY), with no note', () => {
    writeFileSync(transcriptPath, transcriptWith([
      assistantToolUse('Bash', { command: 'ticketlens PROD-1234' }),
    ]));
    const result = runHook({ sessionId, transcriptPath, cwd: dir, home });
    assert.equal(result.status, 2);
  });

  it('loose profile: exits 0 when fetch ran but nothing was ever flagged', () => {
    writeProfile(home, 'loose');
    writeFileSync(transcriptPath, transcriptWith([
      assistantText('Looking at PROD-1234 now.'),
      assistantToolUse('mcp__ticketlens__fetch', { ticket: 'PROD-1234' }),
    ]));
    const result = runHook({ sessionId, transcriptPath, cwd: dir, home });
    assert.equal(result.status, 0);
  });

  it('loose profile: still exits 2 when a flag was raised but never followed by a note', () => {
    writeProfile(home, 'loose');
    // A real fetch call is required here too (backlog #15): shouldNag's gate
    // is now sawFetch, not sawTicketKey — sawRecallFlag alone, with no fetch
    // ever run, is NOT enough to nag even in loose mode.
    writeFileSync(transcriptPath, transcriptWith([
      assistantText('Looking at PROD-1234 now.'),
      assistantToolUse('mcp__ticketlens__fetch', { ticket: 'PROD-1234' }),
      assistantText('🔖 Recall-flag: found a gotcha'),
    ]));
    const result = runHook({ sessionId, transcriptPath, cwd: dir, home });
    assert.equal(result.status, 2);
  });

  it('strict profile: behaves identically to no profile (balanced) — exits 2 when fetch ran with no note', () => {
    writeProfile(home, 'strict');
    writeFileSync(transcriptPath, transcriptWith([
      assistantText('Looking at PROD-1234 now.'),
      assistantToolUse('mcp__ticketlens__fetch', { ticket: 'PROD-1234' }),
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
      // fetch ran, nothing flagged, no note — loose would exit 0; balanced (the
      // safe fallback) exits 2. A mismatched-tokenHash cache must NOT apply.
      writeFileSync(transcriptPath, transcriptWith([
        assistantText('Looking at PROD-1234 now.'),
        assistantToolUse('mcp__ticketlens__fetch', { ticket: 'PROD-1234' }),
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
        assistantText('🔖 Recall-flag: found a gotcha'),
      ]),
      balanced: transcriptWith([
        assistantText('Looking at PROD-1234 now.'),
        assistantToolUse('mcp__ticketlens__fetch', { ticket: 'PROD-1234' }),
      ]),
      strict: transcriptWith([
        assistantText('Looking at PROD-1234 now.'),
        assistantToolUse('mcp__ticketlens__fetch', { ticket: 'PROD-1234' }),
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
        assistantText('🔖 Recall-flag: found a gotcha'),
      ]),
      balanced: transcriptWith([
        assistantText('Looking at PROD-1234 now.'),
        assistantToolUse('mcp__ticketlens__fetch', { ticket: 'PROD-1234' }),
      ]),
      strict: transcriptWith([
        assistantText('Looking at PROD-1234 now.'),
        assistantToolUse('mcp__ticketlens__fetch', { ticket: 'PROD-1234' }),
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
      ]));
      const result = runHook({ sessionId, transcriptPath, cwd: dir, home });
      assert.equal(result.status, 0);
    });
  });
});
