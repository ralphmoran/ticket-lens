import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { pickTicketPrefixes, pickTriageStatuses, DEFAULT_TRIAGE_STATUSES } from '../lib/wizard-pickers.mjs';

function mockStream(isTTY = true) {
  const chunks = [];
  const s = new Writable({
    write(chunk, _enc, cb) { chunks.push(chunk.toString()); cb(); },
  });
  s.isTTY = isTTY;
  s.columns = 80;
  s.output = () => chunks.join('');
  return s;
}

function fakeStdin() {
  const ee = new EventEmitter();
  ee.isRaw = false;
  ee.setRawMode = (v) => { ee.isRaw = v; return ee; };
  ee.resume = () => {};
  ee.pause = () => {};
  ee.setEncoding = () => {};
  return ee;
}

async function send(stdin, keys) {
  while (stdin.listenerCount('data') === 0) await new Promise(r => setImmediate(r));
  for (const k of keys) {
    stdin.emit('data', Buffer.from(k));
    await new Promise(r => setImmediate(r));
  }
}

const DOWN = '\x1b[B';
const ENTER = '\r';
const ESC = '\x1b';
const SPACE = ' ';

const PROJECTS = [
  { key: 'ALPHA', name: 'Alpha App' },
  { key: 'BETA', name: 'Beta App' },
];

describe('DEFAULT_TRIAGE_STATUSES', () => {
  it('matches the historical wizard defaults', () => {
    assert.deepStrictEqual(DEFAULT_TRIAGE_STATUSES, ['In Progress', 'Code Review', 'QA']);
  });
});

describe('pickTicketPrefixes', () => {
  it('returns null on non-TTY stream (caller falls back to free text)', async () => {
    const result = await pickTicketPrefixes({
      fetchProjects: async () => PROJECTS,
      stream: mockStream(false),
      stdin: fakeStdin(),
    });
    assert.equal(result, null);
  });

  it('returns null and warns when the fetch fails', async () => {
    const stream = mockStream(true);
    const result = await pickTicketPrefixes({
      fetchProjects: async () => { throw new Error('ECONNREFUSED'); },
      stream,
      stdin: fakeStdin(),
    });
    assert.equal(result, null);
    assert.ok(/could not fetch/i.test(stream.output()), 'should warn before falling back');
    assert.ok(!stream.output().includes('ECONNREFUSED'), 'raw error must not leak to the user');
  });

  it('returns null when the server reports no projects', async () => {
    const result = await pickTicketPrefixes({
      fetchProjects: async () => [],
      stream: mockStream(true),
      stdin: fakeStdin(),
    });
    assert.equal(result, null);
  });

  it('maps checked rows to project keys', async () => {
    const stream = mockStream(true);
    const stdin = fakeStdin();
    const p = pickTicketPrefixes({ fetchProjects: async () => PROJECTS, stream, stdin });
    await send(stdin, [SPACE, ENTER]); // check ALPHA
    assert.deepStrictEqual(await p, ['ALPHA']);
    assert.ok(stream.output().includes('Alpha App'), 'rows should show project names');
  });

  it('Enter with nothing checked returns [] — prefixes are optional', async () => {
    const stdin = fakeStdin();
    const p = pickTicketPrefixes({ fetchProjects: async () => PROJECTS, stream: mockStream(true), stdin });
    await send(stdin, [ENTER]);
    assert.deepStrictEqual(await p, []);
  });

  it('pre-checks current values; bare Enter keeps them (edit baseline)', async () => {
    const stdin = fakeStdin();
    const p = pickTicketPrefixes({
      fetchProjects: async () => PROJECTS,
      current: ['BETA'],
      stream: mockStream(true),
      stdin,
    });
    await send(stdin, [ENTER]);
    assert.deepStrictEqual(await p, ['BETA']);
  });

  it('deselecting a current value removes it (replace semantics)', async () => {
    const stdin = fakeStdin();
    const p = pickTicketPrefixes({
      fetchProjects: async () => PROJECTS,
      current: ['ALPHA', 'BETA'],
      stream: mockStream(true),
      stdin,
    });
    await send(stdin, [DOWN, SPACE, ENTER]); // uncheck BETA
    assert.deepStrictEqual(await p, ['ALPHA']);
  });

  it('keeps a current value missing from the server as a marked, pre-checked row', async () => {
    const stream = mockStream(true);
    const stdin = fakeStdin();
    const p = pickTicketPrefixes({
      fetchProjects: async () => PROJECTS,
      current: ['GONE'],
      stream,
      stdin,
    });
    await send(stdin, [ENTER]);
    assert.deepStrictEqual(await p, ['GONE'], 'user data must never be silently dropped');
    assert.ok(stream.output().includes('not on server'), 'missing value should be marked');
  });

  it('preserveMissing: false drops current values missing from the server (init defaults)', async () => {
    const stream = mockStream(true);
    const stdin = fakeStdin();
    const p = pickTicketPrefixes({
      fetchProjects: async () => PROJECTS,
      current: ['GONE', 'ALPHA'],
      preserveMissing: false,
      stream,
      stdin,
    });
    await send(stdin, [ENTER]);
    assert.deepStrictEqual(await p, ['ALPHA']);
    assert.ok(!stream.output().includes('GONE'), 'dropped default should not render a phantom row');
  });

  it('Esc returns null (manual entry escape hatch)', async () => {
    const stdin = fakeStdin();
    const p = pickTicketPrefixes({ fetchProjects: async () => PROJECTS, stream: mockStream(true), stdin });
    await send(stdin, [ESC]);
    assert.equal(await p, null);
  });
});

describe('pickTriageStatuses', () => {
  const AVAILABLE = ['Code Review', 'Done', 'In Progress', 'QA Testing'];

  it('returns null and warns when the fetch fails', async () => {
    const stream = mockStream(true);
    const result = await pickTriageStatuses({
      fetchStatuses: async () => { throw new Error('boom'); },
      stream,
      stdin: fakeStdin(),
    });
    assert.equal(result, null);
    assert.ok(/could not fetch/i.test(stream.output()));
  });

  it('pre-checks current values case-insensitively and returns canonical server casing', async () => {
    const stdin = fakeStdin();
    const p = pickTriageStatuses({
      fetchStatuses: async () => AVAILABLE,
      current: ['in progress', 'CODE REVIEW'],
      stream: mockStream(true),
      stdin,
    });
    await send(stdin, [ENTER]);
    assert.deepStrictEqual(await p, ['Code Review', 'In Progress']);
  });

  it('requires at least one status — bare Enter after unchecking everything is vetoed', async () => {
    const stream = mockStream(true);
    const stdin = fakeStdin();
    const p = pickTriageStatuses({
      fetchStatuses: async () => AVAILABLE,
      current: ['Code Review'],
      stream,
      stdin,
    });
    // uncheck the only checked row, try to confirm (vetoed), recheck, confirm
    await send(stdin, [SPACE, ENTER, SPACE, ENTER]);
    assert.deepStrictEqual(await p, ['Code Review']);
    assert.ok(stream.output().includes('at least 1'), 'veto should flash a hint');
  });

  it('collapses case-duplicate current values into a single stale row', async () => {
    const stream = mockStream(true);
    const stdin = fakeStdin();
    const p = pickTriageStatuses({
      fetchStatuses: async () => AVAILABLE,
      current: ['Retired', 'retired'], // legacy free-text merge never deduped within itself
      stream,
      stdin,
    });
    await send(stdin, [ENTER]);
    assert.deepStrictEqual(await p, ['Retired'], 'first-seen casing wins, no duplicate value');
    const staleRows = (stream.output().match(/not on server/g) || []).length;
    assert.equal(staleRows, 1, 'must not render two toggleable rows for the same value');
  });

  it('keeps a stale configured status as a marked, pre-checked row', async () => {
    const stream = mockStream(true);
    const stdin = fakeStdin();
    const p = pickTriageStatuses({
      fetchStatuses: async () => AVAILABLE,
      current: ['Retired Status'],
      stream,
      stdin,
    });
    await send(stdin, [ENTER]);
    assert.deepStrictEqual(await p, ['Retired Status']);
    assert.ok(stream.output().includes('not on server'));
  });

  it('preserveMissing: false drops defaults the server does not have', async () => {
    const stdin = fakeStdin();
    const p = pickTriageStatuses({
      fetchStatuses: async () => AVAILABLE,
      current: DEFAULT_TRIAGE_STATUSES, // 'QA' not on this server
      preserveMissing: false,
      stream: mockStream(true),
      stdin,
    });
    await send(stdin, [ENTER]);
    assert.deepStrictEqual(await p, ['Code Review', 'In Progress']);
  });

  it('Esc returns null (manual entry escape hatch)', async () => {
    const stdin = fakeStdin();
    const p = pickTriageStatuses({ fetchStatuses: async () => AVAILABLE, stream: mockStream(true), stdin });
    await send(stdin, [ESC]);
    assert.equal(await p, null);
  });
});
