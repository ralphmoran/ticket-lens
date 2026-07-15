import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  incrementFetch,
  incrementTriageRun,
  incrementInvocation,
  incrementCommand,
  recordTokensSaved,
  readAndResetActivity,
  incrementDraftKept,
  incrementDraftDeleted,
  incrementBriefWithRecall,
  recordPulseResponse,
  shouldPromptPulse,
} from '../lib/activity-counter.mjs';

const EMPTY_SNAPSHOT = {
  fetch_count: 0,
  triage_run_count: 0,
  invocations: 0,
  commands: {},
  drafts_kept: 0,
  drafts_deleted: 0,
  briefs_with_recall_injection: 0,
};

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tl-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('incrementFetch', () => {
  it('increments fetch_count from zero', () => {
    incrementFetch(tmpDir);
    const data = JSON.parse(fs.readFileSync(path.join(tmpDir, 'activity.json'), 'utf8'));
    assert.equal(data.fetch_count, 1);
  });

  it('accumulates multiple increments', () => {
    incrementFetch(tmpDir);
    incrementFetch(tmpDir);
    incrementFetch(tmpDir);
    const data = JSON.parse(fs.readFileSync(path.join(tmpDir, 'activity.json'), 'utf8'));
    assert.equal(data.fetch_count, 3);
  });
});

describe('incrementTriageRun', () => {
  it('increments triage_run_count independently', () => {
    incrementFetch(tmpDir);
    incrementTriageRun(tmpDir);
    incrementTriageRun(tmpDir);
    const data = JSON.parse(fs.readFileSync(path.join(tmpDir, 'activity.json'), 'utf8'));
    assert.equal(data.fetch_count, 1);
    assert.equal(data.triage_run_count, 2);
  });
});

describe('incrementInvocation', () => {
  it('increments invocations independently', () => {
    incrementInvocation(tmpDir);
    const data = JSON.parse(fs.readFileSync(path.join(tmpDir, 'activity.json'), 'utf8'));
    assert.equal(data.invocations, 1);
    assert.equal(data.fetch_count, 0);
  });
});

describe('readAndResetActivity', () => {
  it('returns zeros when no file exists', () => {
    const result = readAndResetActivity(tmpDir);
    assert.deepStrictEqual(result, EMPTY_SNAPSHOT);
  });

  it('returns accumulated counts', () => {
    incrementFetch(tmpDir);
    incrementFetch(tmpDir);
    incrementTriageRun(tmpDir);
    incrementInvocation(tmpDir);
    incrementInvocation(tmpDir);
    incrementInvocation(tmpDir);

    const result = readAndResetActivity(tmpDir);
    assert.equal(result.fetch_count, 2);
    assert.equal(result.triage_run_count, 1);
    assert.equal(result.invocations, 3);
  });

  it('resets counters to zero after read', () => {
    incrementFetch(tmpDir);
    incrementFetch(tmpDir);
    readAndResetActivity(tmpDir);

    const data = JSON.parse(fs.readFileSync(path.join(tmpDir, 'activity.json'), 'utf8'));
    assert.equal(data.fetch_count, 0);
    assert.equal(data.triage_run_count, 0);
    assert.equal(data.invocations, 0);
  });

  it('returns zero after reset — second call is clean', () => {
    incrementFetch(tmpDir);
    readAndResetActivity(tmpDir);
    const second = readAndResetActivity(tmpDir);
    assert.deepStrictEqual(second, EMPTY_SNAPSHOT);
  });

  it('handles corrupt file gracefully — treats as zero', () => {
    fs.writeFileSync(path.join(tmpDir, 'activity.json'), 'not-json', 'utf8');
    const result = readAndResetActivity(tmpDir);
    assert.deepStrictEqual(result, EMPTY_SNAPSHOT);
  });

  it('lock — commands snapshot returned and then reset to empty object', () => {
    incrementCommand(tmpDir, 'fetch', []);
    incrementCommand(tmpDir, 'fetch', []);
    const result = readAndResetActivity(tmpDir);
    assert.equal(result.commands.fetch.count, 2);
    const second = readAndResetActivity(tmpDir);
    assert.deepStrictEqual(second.commands, {});
  });
});

describe('recordTokensSaved', () => {
  it('accumulates tokens_saved for a command', () => {
    recordTokensSaved(tmpDir, 'fetch', 1200);
    recordTokensSaved(tmpDir, 'fetch', 800);
    const data = JSON.parse(fs.readFileSync(path.join(tmpDir, 'activity.json'), 'utf8'));
    assert.equal(data.commands.fetch.tokens_saved, 2000);
  });

  it('initialises command entry when not yet tracked by incrementCommand', () => {
    recordTokensSaved(tmpDir, 'fetch', 500);
    const data = JSON.parse(fs.readFileSync(path.join(tmpDir, 'activity.json'), 'utf8'));
    assert.equal(data.commands.fetch.tokens_saved, 500);
  });

  it('tokens_saved does not affect count field', () => {
    incrementCommand(tmpDir, 'fetch', []);
    recordTokensSaved(tmpDir, 'fetch', 300);
    const data = JSON.parse(fs.readFileSync(path.join(tmpDir, 'activity.json'), 'utf8'));
    assert.equal(data.commands.fetch.count, 1);
    assert.equal(data.commands.fetch.tokens_saved, 300);
  });

  it('readAndResetActivity returns tokens_saved and resets it', () => {
    recordTokensSaved(tmpDir, 'fetch', 1000);
    const result = readAndResetActivity(tmpDir);
    assert.equal(result.commands.fetch.tokens_saved, 1000);
    const second = readAndResetActivity(tmpDir);
    assert.deepStrictEqual(second.commands, {});
  });

  it('tokens_saved key does not start with dash — not stored in flags by PushController filter', () => {
    // Invariant: PushController filters metadata flags with str_starts_with($k, '-').
    // tokens_saved must not start with '-' or it would be silently dropped.
    assert.equal('tokens_saved'.startsWith('-'), false);
  });
});

describe('incrementCommand', () => {
  it('lock — initialises command entry with count 1 on first call', () => {
    incrementCommand(tmpDir, 'triage', []);
    const data = JSON.parse(fs.readFileSync(path.join(tmpDir, 'activity.json'), 'utf8'));
    assert.equal(data.commands.triage.count, 1);
  });

  it('lock — accumulates count across calls', () => {
    incrementCommand(tmpDir, 'fetch', []);
    incrementCommand(tmpDir, 'fetch', []);
    incrementCommand(tmpDir, 'fetch', []);
    const data = JSON.parse(fs.readFileSync(path.join(tmpDir, 'activity.json'), 'utf8'));
    assert.equal(data.commands.fetch.count, 3);
  });

  it('lock — tracks flags by name only, stripping values', () => {
    incrementCommand(tmpDir, 'fetch', ['--depth=2', '--profile=work']);
    const data = JSON.parse(fs.readFileSync(path.join(tmpDir, 'activity.json'), 'utf8'));
    assert.equal(data.commands.fetch['--depth'], 1);
    assert.equal(data.commands.fetch['--profile'], 1);
    assert.equal(Object.keys(data.commands.fetch).includes('--depth=2'), false);
  });

  it('lock — non-flag args (no leading dash) are ignored', () => {
    incrementCommand(tmpDir, 'fetch', ['PROJ-123', '--depth=1']);
    const data = JSON.parse(fs.readFileSync(path.join(tmpDir, 'activity.json'), 'utf8'));
    assert.equal(Object.keys(data.commands.fetch).includes('PROJ-123'), false);
    assert.equal(data.commands.fetch['--depth'], 1);
  });

  it('lock — multiple commands tracked independently', () => {
    incrementCommand(tmpDir, 'fetch', []);
    incrementCommand(tmpDir, 'triage', []);
    incrementCommand(tmpDir, 'fetch', []);
    const data = JSON.parse(fs.readFileSync(path.join(tmpDir, 'activity.json'), 'utf8'));
    assert.equal(data.commands.fetch.count, 2);
    assert.equal(data.commands.triage.count, 1);
  });
});

describe('Recall graduation counters', () => {
  it('incrementDraftKept increments drafts_kept independently of other counters', () => {
    incrementFetch(tmpDir);
    incrementDraftKept(tmpDir);
    incrementDraftKept(tmpDir);
    const data = JSON.parse(fs.readFileSync(path.join(tmpDir, 'activity.json'), 'utf8'));
    assert.equal(data.drafts_kept, 2);
    assert.equal(data.fetch_count, 1);
  });

  it('incrementDraftDeleted increments drafts_deleted independently', () => {
    incrementDraftDeleted(tmpDir);
    const data = JSON.parse(fs.readFileSync(path.join(tmpDir, 'activity.json'), 'utf8'));
    assert.equal(data.drafts_deleted, 1);
    assert.equal(data.drafts_kept, 0);
  });

  it('incrementBriefWithRecall increments briefs_with_recall_injection independently', () => {
    incrementBriefWithRecall(tmpDir);
    incrementBriefWithRecall(tmpDir);
    incrementBriefWithRecall(tmpDir);
    const data = JSON.parse(fs.readFileSync(path.join(tmpDir, 'activity.json'), 'utf8'));
    assert.equal(data.briefs_with_recall_injection, 3);
  });

  it('readAndResetActivity includes and resets the new counters, same as the existing ones', () => {
    incrementDraftKept(tmpDir);
    incrementDraftDeleted(tmpDir);
    incrementBriefWithRecall(tmpDir);
    const result = readAndResetActivity(tmpDir);
    assert.equal(result.drafts_kept, 1);
    assert.equal(result.drafts_deleted, 1);
    assert.equal(result.briefs_with_recall_injection, 1);
    const second = readAndResetActivity(tmpDir);
    assert.deepStrictEqual(second, EMPTY_SNAPSHOT);
  });
});

describe('recordPulseResponse — local-only, survives readAndResetActivity', () => {
  it('appends a pulse response with a timestamp', () => {
    recordPulseResponse(tmpDir, 'y');
    const data = JSON.parse(fs.readFileSync(path.join(tmpDir, 'activity.json'), 'utf8'));
    assert.equal(data.pulses.length, 1);
    assert.equal(data.pulses[0].response, 'y');
    assert.equal(typeof data.pulses[0].ts, 'string');
  });

  it('keeps only the most recent 20 pulse responses', () => {
    for (let i = 0; i < 25; i++) recordPulseResponse(tmpDir, 'y');
    const data = JSON.parse(fs.readFileSync(path.join(tmpDir, 'activity.json'), 'utf8'));
    assert.equal(data.pulses.length, 20);
  });

  it('is not reset by readAndResetActivity — pulses are a persistent local log, not a pushed counter', () => {
    recordPulseResponse(tmpDir, 'n');
    readAndResetActivity(tmpDir);
    const data = JSON.parse(fs.readFileSync(path.join(tmpDir, 'activity.json'), 'utf8'));
    assert.equal(data.pulses.length, 1);
  });
});

describe('incrementBriefWithRecall — returns the new count', () => {
  it('returns 1 on the first call', () => {
    assert.equal(incrementBriefWithRecall(tmpDir), 1);
  });

  it('returns the running total across calls', () => {
    incrementBriefWithRecall(tmpDir);
    incrementBriefWithRecall(tmpDir);
    assert.equal(incrementBriefWithRecall(tmpDir), 3);
  });
});

describe('shouldPromptPulse', () => {
  it('is false for counts that are not a multiple of 25', () => {
    assert.equal(shouldPromptPulse(1), false);
    assert.equal(shouldPromptPulse(24), false);
    assert.equal(shouldPromptPulse(26), false);
  });

  it('is true on exact multiples of 25', () => {
    assert.equal(shouldPromptPulse(25), true);
    assert.equal(shouldPromptPulse(50), true);
    assert.equal(shouldPromptPulse(100), true);
  });

  it('is false for zero', () => {
    assert.equal(shouldPromptPulse(0), false);
  });
});
