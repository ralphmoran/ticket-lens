import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { exportTriage } from '../lib/triage-exporter.mjs';

const SAMPLE_TICKETS = [
  {
    ticketKey: 'PROJ-1',
    summary: 'Fix empty cart',
    status: 'Code Review',
    urgency: 'needs-response',
    lastComment: { author: 'Sarah QA', created: '2026-03-05T10:00:00Z', body: 'Edge case found' },
    daysSinceUpdate: null,
    url: 'https://jira.example.com/browse/PROJ-1',
  },
  {
    ticketKey: 'PROJ-2',
    summary: 'Update API docs',
    status: 'In Progress',
    urgency: 'aging',
    lastComment: null,
    daysSinceUpdate: 8,
    url: 'https://jira.example.com/browse/PROJ-2',
  },
];

describe('exportTriage', () => {
  let tmpDir;
  before(() => { tmpDir = mkdtempSync(join(tmpdir(), 'triage-export-test-')); });
  after(() => { rmSync(tmpDir, { recursive: true }); });

  it('writes CSV file and returns absolute path', () => {
    const path = exportTriage({ tickets: SAMPLE_TICKETS, format: 'csv', profile: 'test', configDir: tmpDir });
    assert.ok(path.endsWith('.csv'), 'path should end with .csv');
    assert.ok(existsSync(path), 'file should exist');
    const content = readFileSync(path, 'utf8');
    assert.ok(content.startsWith('#,Ticket,Summary'), 'CSV header missing');
    assert.ok(content.includes('PROJ-1'), 'PROJ-1 missing');
    assert.ok(content.includes('PROJ-2'), 'PROJ-2 missing');
  });

  it('CSV header has all required columns', () => {
    const path = exportTriage({ tickets: SAMPLE_TICKETS, format: 'csv', profile: 'test', configDir: tmpDir });
    const [header] = readFileSync(path, 'utf8').split('\n');
    assert.equal(header, '#,Ticket,Summary,Status,Urgency,LastCommentFrom,LastCommentDate,DaysSinceUpdate,URL');
  });

  it('writes JSON file and returns absolute path', () => {
    const path = exportTriage({ tickets: SAMPLE_TICKETS, format: 'json', profile: 'test', configDir: tmpDir });
    assert.ok(path.endsWith('.json'));
    assert.ok(existsSync(path));
    const data = JSON.parse(readFileSync(path, 'utf8'));
    assert.equal(data.tickets.length, 2);
    assert.equal(data.tickets[0].ticketKey, 'PROJ-1');
    assert.equal(data.profile, 'test');
    assert.ok(data.exportedAt);
    assert.equal(data.summary.total, 2);
    assert.equal(data.summary.needsResponse, 1);
    assert.equal(data.summary.aging, 1);
  });

  it('auto-creates exports/ directory inside configDir', () => {
    const freshDir = mkdtempSync(join(tmpdir(), 'fresh-'));
    try {
      const path = exportTriage({ tickets: SAMPLE_TICKETS, format: 'csv', profile: 'test', configDir: freshDir });
      assert.ok(existsSync(path));
    } finally {
      rmSync(freshDir, { recursive: true });
    }
  });

  it('handles empty tickets array without throwing', () => {
    const path = exportTriage({ tickets: [], format: 'json', profile: 'test', configDir: tmpDir });
    const data = JSON.parse(readFileSync(path, 'utf8'));
    assert.equal(data.tickets.length, 0);
    assert.equal(data.summary.total, 0);
  });

  it('escapes CSV fields containing commas', () => {
    const tickets = [{ ...SAMPLE_TICKETS[0], summary: 'Fix, the bug' }];
    const path = exportTriage({ tickets, format: 'csv', profile: 'test', configDir: tmpDir });
    const content = readFileSync(path, 'utf8');
    assert.ok(content.includes('"Fix, the bug"'));
  });

  it('escapes CSV fields containing double quotes', () => {
    const tickets = [{ ...SAMPLE_TICKETS[0], summary: 'Say "hello"' }];
    const path = exportTriage({ tickets, format: 'csv', profile: 'test', configDir: tmpDir });
    const content = readFileSync(path, 'utf8');
    assert.ok(content.includes('"Say ""hello"""'));
  });

  it('strips newlines from summary in CSV', () => {
    const tickets = [{ ...SAMPLE_TICKETS[0], summary: 'Line1\nLine2' }];
    const path = exportTriage({ tickets, format: 'csv', profile: 'test', configDir: tmpDir });
    const content = readFileSync(path, 'utf8');
    assert.ok(!content.includes('Line1\nLine2'));
    assert.ok(content.includes('Line1 Line2'));
  });

  it('rejects path traversal in profile name', () => {
    assert.throws(
      () => exportTriage({ tickets: [], format: 'csv', profile: '../../etc', configDir: '/tmp' }),
      { message: /invalid/i }
    );
  });
});
