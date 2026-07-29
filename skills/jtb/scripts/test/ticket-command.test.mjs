import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { runTicketComment, runTicketTransitionList, runTicketTransition, classifyWriteFailure } from '../lib/ticket-command.mjs';

function makeStream() {
  const lines = [];
  return { write: (s) => lines.push(s), lines };
}

function fakeAdapter(overrides = {}) {
  return {
    type: 'jira',
    addComment: async () => ({ id: 'c1', url: 'https://example/c1' }),
    getTransitions: async () => [{ id: '1', name: 'Done', to: 'Done' }],
    transition: async () => ({ executed: true, to: 'Done' }),
    ...overrides,
  };
}

function baseDeps(overrides = {}) {
  return {
    configDir: '/fake/config',
    stream: makeStream(),
    isLicensedFn: () => true,
    resolveConnectionFn: () => ({ baseUrl: 'https://jira.example.com' }),
    resolveAdapterFn: () => fakeAdapter(),
    checkCooldownFn: () => ({ active: false, remainingMs: 0 }),
    recordActionFn: () => {},
    logActionFn: () => {},
    actor: 'ralph',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// classifyWriteFailure
// ---------------------------------------------------------------------------
describe('classifyWriteFailure', () => {
  test('classifies a rateLimit-carrying error as rate-limited without losing the sub-kind', () => {
    const err = Object.assign(new Error('x'), { rateLimit: { kind: 'secondary-rate-limit', retryAfterSeconds: 30 } });
    const result = classifyWriteFailure(err);
    assert.equal(result.kind, 'rate-limited');
    assert.equal(result.detail.kind, 'secondary-rate-limit');
    assert.equal(result.detail.retryAfterSeconds, 30);
  });

  test('classifies a statusless error as network-or-timeout', () => {
    const result = classifyWriteFailure(new Error('fetch failed'));
    assert.equal(result.kind, 'network-or-timeout');
  });

  test('classifies status >= 500 as server-error', () => {
    const err = Object.assign(new Error('x'), { status: 502 });
    assert.equal(classifyWriteFailure(err).kind, 'server-error');
  });

  test('classifies any other status as terminal', () => {
    const err = Object.assign(new Error('x'), { status: 400, details: { errors: ['bad'] } });
    const result = classifyWriteFailure(err);
    assert.equal(result.kind, 'terminal');
    assert.deepEqual(result.details, { errors: ['bad'] });
  });
});

// ---------------------------------------------------------------------------
// runTicketComment
// ---------------------------------------------------------------------------
describe('runTicketComment — license gate', () => {
  test('unlicensed: never resolves a connection, never comments', async () => {
    let resolveCalls = 0;
    const deps = baseDeps({
      isLicensedFn: () => false,
      resolveConnectionFn: () => { resolveCalls++; return { baseUrl: 'x' }; },
    });
    const result = await runTicketComment(['PROJ-1', '--body=hi'], deps);
    assert.equal(result.ok, false);
    assert.equal(resolveCalls, 0);
  });
});

describe('runTicketComment — usage validation', () => {
  test('missing ticket key shows usage', async () => {
    const deps = baseDeps();
    const result = await runTicketComment(['--body=hi'], deps);
    assert.equal(result.ok, false);
    assert.match(deps.stream.lines.join(''), /Usage/);
  });

  test('malformed ticket key shows usage', async () => {
    const deps = baseDeps();
    const result = await runTicketComment(['not-a-key', '--body=hi'], deps);
    assert.equal(result.ok, false);
    assert.match(deps.stream.lines.join(''), /Usage/);
  });

  test('missing --body shows usage', async () => {
    const deps = baseDeps();
    const result = await runTicketComment(['PROJ-1'], deps);
    assert.equal(result.ok, false);
    assert.match(deps.stream.lines.join(''), /Usage/);
  });
});

describe('runTicketComment — cooldown', () => {
  test('active cooldown skips the write entirely', async () => {
    let addCalled = false;
    const deps = baseDeps({
      checkCooldownFn: () => ({ active: true, remainingMs: 4000 }),
      resolveAdapterFn: () => fakeAdapter({ addComment: async () => { addCalled = true; return {}; } }),
    });
    const result = await runTicketComment(['PROJ-1', '--body=hi'], deps);
    assert.equal(result.ok, false);
    assert.equal(addCalled, false);
    assert.match(deps.stream.lines.join(''), /Skipped/);
  });
});

describe('runTicketComment — connection resolution', () => {
  test('no configured connection reports an error and does not call the adapter', async () => {
    let adapterResolved = false;
    const deps = baseDeps({
      resolveConnectionFn: () => ({ baseUrl: null }),
      resolveAdapterFn: () => { adapterResolved = true; return fakeAdapter(); },
    });
    const result = await runTicketComment(['PROJ-1', '--body=hi'], deps);
    assert.equal(result.ok, false);
    assert.equal(adapterResolved, false);
  });
});

describe('runTicketComment — happy path', () => {
  test('posts the comment, records the cooldown, and logs the action', async () => {
    let recorded, logged;
    const deps = baseDeps({
      recordActionFn: (key, action) => { recorded = { key, action }; },
      logActionFn: (entry) => { logged = entry; },
    });
    const result = await runTicketComment(['PROJ-1', '--body=Looks good'], deps);
    assert.equal(result.ok, true);
    assert.deepEqual(recorded, { key: 'PROJ-1', action: 'comment' });
    assert.equal(logged.ticketKey, 'PROJ-1');
    assert.equal(logged.action, 'comment');
    assert.equal(logged.tracker, 'jira');
    assert.match(deps.stream.lines.join(''), /Comment posted to PROJ-1/);
  });
});

describe('runTicketComment — write failure', () => {
  test('a thrown error is classified and reported, cooldown/log are never recorded', async () => {
    let recorded = false, logged = false;
    const deps = baseDeps({
      resolveAdapterFn: () => fakeAdapter({ addComment: async () => { throw Object.assign(new Error('boom'), { status: 500 }); } }),
      recordActionFn: () => { recorded = true; },
      logActionFn: () => { logged = true; },
    });
    const result = await runTicketComment(['PROJ-1', '--body=hi'], deps);
    assert.equal(result.ok, false);
    assert.equal(recorded, false);
    assert.equal(logged, false);
    assert.match(deps.stream.lines.join(''), /server error/);
  });
});

// ---------------------------------------------------------------------------
// runTicketTransitionList
// ---------------------------------------------------------------------------
describe('runTicketTransitionList', () => {
  test('unlicensed shows upgrade prompt and never resolves a connection', async () => {
    let resolveCalls = 0;
    const deps = baseDeps({
      isLicensedFn: () => false,
      resolveConnectionFn: () => { resolveCalls++; return { baseUrl: 'x' }; },
    });
    const result = await runTicketTransitionList(['PROJ-1'], deps);
    assert.equal(result.ok, false);
    assert.equal(resolveCalls, 0);
  });

  test('lists valid transitions without mutating anything', async () => {
    let transitionCalled = false;
    const deps = baseDeps({
      resolveAdapterFn: () => fakeAdapter({ transition: async () => { transitionCalled = true; return {}; } }),
    });
    const result = await runTicketTransitionList(['PROJ-1'], deps);
    assert.equal(result.ok, true);
    assert.equal(result.options.length, 1);
    assert.equal(transitionCalled, false);
    assert.match(deps.stream.lines.join(''), /Done/);
  });

  test('reports zero valid transitions distinctly from a failure', async () => {
    const deps = baseDeps({ resolveAdapterFn: () => fakeAdapter({ getTransitions: async () => [] }) });
    const result = await runTicketTransitionList(['PROJ-1'], deps);
    assert.equal(result.ok, true);
    assert.deepEqual(result.options, []);
  });
});

// ---------------------------------------------------------------------------
// runTicketTransition
// ---------------------------------------------------------------------------
describe('runTicketTransition — usage validation', () => {
  test('missing --target shows usage', async () => {
    const deps = baseDeps();
    const result = await runTicketTransition(['PROJ-1', '--confirm'], deps);
    assert.equal(result.ok, false);
    assert.match(deps.stream.lines.join(''), /Usage/);
  });

  test('--target without --confirm refuses to execute', async () => {
    let transitionCalled = false;
    const deps = baseDeps({
      resolveAdapterFn: () => fakeAdapter({ transition: async () => { transitionCalled = true; return { executed: true, to: 'Done' }; } }),
    });
    const result = await runTicketTransition(['PROJ-1', '--target=Done'], deps);
    assert.equal(result.ok, false);
    assert.equal(transitionCalled, false);
    assert.match(deps.stream.lines.join(''), /--confirm/);
  });
});

describe('runTicketTransition — cooldown', () => {
  test('active cooldown skips execution', async () => {
    let transitionCalled = false;
    const deps = baseDeps({
      checkCooldownFn: () => ({ active: true, remainingMs: 2000 }),
      resolveAdapterFn: () => fakeAdapter({ transition: async () => { transitionCalled = true; return { executed: true, to: 'Done' }; } }),
    });
    const result = await runTicketTransition(['PROJ-1', '--target=Done', '--confirm'], deps);
    assert.equal(result.ok, false);
    assert.equal(transitionCalled, false);
  });
});

describe('runTicketTransition — happy path', () => {
  test('executes, records cooldown, and logs the action', async () => {
    let recorded, logged;
    const deps = baseDeps({
      recordActionFn: (key, action) => { recorded = { key, action }; },
      logActionFn: (entry) => { logged = entry; },
    });
    const result = await runTicketTransition(['PROJ-1', '--target=Done', '--confirm'], deps);
    assert.equal(result.ok, true);
    assert.deepEqual(recorded, { key: 'PROJ-1', action: 'transition' });
    assert.equal(logged.detail.to, 'Done');
    assert.match(deps.stream.lines.join(''), /transitioned to "Done"/);
  });
});

describe('runTicketTransition — unresolved target', () => {
  test('executed:false is reported with valid options, cooldown/log never recorded', async () => {
    let recorded = false, logged = false;
    const deps = baseDeps({
      resolveAdapterFn: () => fakeAdapter({
        transition: async () => ({ executed: false, reason: 'not-found', options: [{ id: '1', name: 'Done', to: 'Done' }] }),
      }),
      recordActionFn: () => { recorded = true; },
      logActionFn: () => { logged = true; },
    });
    const result = await runTicketTransition(['PROJ-1', '--target=Bogus', '--confirm'], deps);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'not-found');
    assert.equal(recorded, false);
    assert.equal(logged, false);
    assert.match(deps.stream.lines.join(''), /Done/);
  });
});

describe('runTicketTransition — write failure', () => {
  test('a thrown error during execution is classified and reported', async () => {
    const deps = baseDeps({
      resolveAdapterFn: () => fakeAdapter({ transition: async () => { throw new Error('network down'); } }),
    });
    const result = await runTicketTransition(['PROJ-1', '--target=Done', '--confirm'], deps);
    assert.equal(result.ok, false);
    assert.match(deps.stream.lines.join(''), /Network error or timeout/);
  });
});
