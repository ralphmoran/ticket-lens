import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { logAction, readActionLog } from '../lib/ticket-action-log.mjs';

function freshConfigDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tl-ticket-log-test-'));
}

describe('logAction', () => {
  it('appends one JSON line per call, readable back via readActionLog', () => {
    const configDir = freshConfigDir();
    logAction({ ticketKey: 'PROJ-1', action: 'comment', actor: 'ralph', tracker: 'jira', detail: { id: 'c1' } }, { configDir });
    logAction({ ticketKey: 'PROJ-1', action: 'transition', actor: 'ralph', tracker: 'jira', detail: { to: 'Done' } }, { configDir });
    const entries = readActionLog(configDir);
    assert.equal(entries.length, 2);
    assert.equal(entries[0].action, 'comment');
    assert.equal(entries[1].action, 'transition');
  });

  it('records ticketKey, actor, tracker, detail, and an ISO timestamp', () => {
    const configDir = freshConfigDir();
    logAction({ ticketKey: 'PROJ-1', action: 'comment', actor: 'ralph', tracker: 'github', detail: { id: '99' } }, {
      configDir,
      now: () => new Date('2026-07-29T12:00:00.000Z'),
    });
    const [entry] = readActionLog(configDir);
    assert.equal(entry.ticketKey, 'PROJ-1');
    assert.equal(entry.actor, 'ralph');
    assert.equal(entry.tracker, 'github');
    assert.deepEqual(entry.detail, { id: '99' });
    assert.equal(entry.at, '2026-07-29T12:00:00.000Z');
  });

  it('throws and refuses to write when ticketKey is malformed (cannot forge a fake log line)', () => {
    const configDir = freshConfigDir();
    assert.throws(() => logAction({ ticketKey: 'not-a-key', action: 'comment', actor: 'x', tracker: 'jira' }, { configDir }));
    assert.deepEqual(readActionLog(configDir), []);
  });

  it('throws on a ticketKey carrying an embedded newline (log-injection attempt)', () => {
    const configDir = freshConfigDir();
    assert.throws(() => logAction({ ticketKey: 'PROJ-1\n{"forged":true}', action: 'comment', actor: 'x', tracker: 'jira' }, { configDir }));
  });

  it('a comment body containing a literal newline in detail never produces a forged extra line', () => {
    const configDir = freshConfigDir();
    logAction({ ticketKey: 'PROJ-1', action: 'comment', actor: 'ralph', tracker: 'jira', detail: { body: 'line one\nline two\n{"forged":true}' } }, { configDir });
    const entries = readActionLog(configDir);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].detail.body, 'line one\nline two\n{"forged":true}');
  });
});

describe('readActionLog', () => {
  it('returns an empty array when the log file does not exist yet', () => {
    const configDir = freshConfigDir();
    assert.deepEqual(readActionLog(configDir), []);
  });

  it('skips a corrupt line without losing the rest of the trail', () => {
    const configDir = freshConfigDir();
    logAction({ ticketKey: 'PROJ-1', action: 'comment', actor: 'ralph', tracker: 'jira' }, { configDir });
    fs.appendFileSync(path.join(configDir, 'ticket-action-log.jsonl'), 'not valid json\n', 'utf8');
    logAction({ ticketKey: 'PROJ-2', action: 'comment', actor: 'ralph', tracker: 'jira' }, { configDir });
    const entries = readActionLog(configDir);
    assert.equal(entries.length, 2);
    assert.equal(entries[0].ticketKey, 'PROJ-1');
    assert.equal(entries[1].ticketKey, 'PROJ-2');
  });
});
