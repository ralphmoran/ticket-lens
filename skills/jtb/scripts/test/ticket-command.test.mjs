import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { runTicketComment, runTicketTransitionList, runTicketTransition, runTicketAssign, runTicketDuplicates, runTicketLinkList, runTicketLink, classifyWriteFailure } from '../lib/ticket-command.mjs';

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
    assignToSelf: async () => ({ assignee: 'Ralph Moran' }),
    fetchTicket: async () => ({ key: 'PROJ-1', summary: 'Login button broken on mobile', description: 'Tapping login does nothing on iOS Safari' }),
    findCandidates: async () => ([{ key: 'PROJ-9', summary: 'Login button broken on mobile Safari', description: 'unrelated body' }]),
    getLinkTypes: async () => ['blocks', 'duplicate', 'related'],
    linkTo: async () => ({ executed: true }),
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

// ---------------------------------------------------------------------------
// runTicketAssign
// ---------------------------------------------------------------------------
describe('runTicketAssign — license gate', () => {
  test('unlicensed: never resolves a connection, never assigns', async () => {
    let resolveCalls = 0;
    const deps = baseDeps({
      isLicensedFn: () => false,
      resolveConnectionFn: () => { resolveCalls++; return { baseUrl: 'x' }; },
    });
    const result = await runTicketAssign(['PROJ-1', '--to=me'], deps);
    assert.equal(result.ok, false);
    assert.equal(resolveCalls, 0);
  });
});

describe('runTicketAssign — usage validation', () => {
  test('missing ticket key shows usage', async () => {
    const deps = baseDeps();
    const result = await runTicketAssign(['--to=me'], deps);
    assert.equal(result.ok, false);
    assert.match(deps.stream.lines.join(''), /Usage/);
  });

  test('missing --to shows usage', async () => {
    const deps = baseDeps();
    const result = await runTicketAssign(['PROJ-1'], deps);
    assert.equal(result.ok, false);
    assert.match(deps.stream.lines.join(''), /Usage/);
  });

  test('--to value other than "me" is rejected with an explicit not-yet-supported message, never reaches the adapter', async () => {
    let assignCalled = false;
    const deps = baseDeps({
      resolveAdapterFn: () => fakeAdapter({ assignToSelf: async () => { assignCalled = true; return { assignee: 'x' }; } }),
    });
    const result = await runTicketAssign(['PROJ-1', '--to=someone@else.com'], deps);
    assert.equal(result.ok, false);
    assert.equal(assignCalled, false);
    assert.match(deps.stream.lines.join(''), /not yet supported/);
  });
});

describe('runTicketAssign — cooldown', () => {
  test('active cooldown skips the write entirely', async () => {
    let assignCalled = false;
    const deps = baseDeps({
      checkCooldownFn: () => ({ active: true, remainingMs: 3000 }),
      resolveAdapterFn: () => fakeAdapter({ assignToSelf: async () => { assignCalled = true; return { assignee: 'x' }; } }),
    });
    const result = await runTicketAssign(['PROJ-1', '--to=me'], deps);
    assert.equal(result.ok, false);
    assert.equal(assignCalled, false);
    assert.match(deps.stream.lines.join(''), /Skipped/);
  });
});

describe('runTicketAssign — happy path', () => {
  test('assigns to self, records cooldown, and logs the action', async () => {
    let recorded, logged;
    const deps = baseDeps({
      recordActionFn: (key, action) => { recorded = { key, action }; },
      logActionFn: (entry) => { logged = entry; },
    });
    const result = await runTicketAssign(['PROJ-1', '--to=me'], deps);
    assert.equal(result.ok, true);
    assert.deepEqual(recorded, { key: 'PROJ-1', action: 'assign' });
    assert.equal(logged.detail.assignee, 'Ralph Moran');
    assert.match(deps.stream.lines.join(''), /assigned to Ralph Moran/);
  });
});

describe('runTicketAssign — write failure', () => {
  test('a thrown error is classified and reported, cooldown/log are never recorded', async () => {
    let recorded = false, logged = false;
    const deps = baseDeps({
      resolveAdapterFn: () => fakeAdapter({ assignToSelf: async () => { throw Object.assign(new Error('boom'), { status: 500 }); } }),
      recordActionFn: () => { recorded = true; },
      logActionFn: () => { logged = true; },
    });
    const result = await runTicketAssign(['PROJ-1', '--to=me'], deps);
    assert.equal(result.ok, false);
    assert.equal(recorded, false);
    assert.equal(logged, false);
    assert.match(deps.stream.lines.join(''), /server error/);
  });
});

// ---------------------------------------------------------------------------
// runTicketDuplicates
// ---------------------------------------------------------------------------
describe('runTicketDuplicates — license gate', () => {
  test('unlicensed: never resolves a connection, never searches', async () => {
    let resolveCalls = 0;
    const deps = baseDeps({
      isLicensedFn: () => false,
      resolveConnectionFn: () => { resolveCalls++; return { baseUrl: 'x' }; },
    });
    const result = await runTicketDuplicates(['PROJ-1'], deps);
    assert.equal(result.ok, false);
    assert.equal(resolveCalls, 0);
  });
});

describe('runTicketDuplicates — usage validation', () => {
  test('missing ticket key shows usage', async () => {
    const deps = baseDeps();
    const result = await runTicketDuplicates([], deps);
    assert.equal(result.ok, false);
    assert.match(deps.stream.lines.join(''), /Usage/);
  });

  test('invalid --threshold is rejected before any network call', async () => {
    let fetchCalled = false;
    const deps = baseDeps({
      resolveAdapterFn: () => fakeAdapter({ fetchTicket: async () => { fetchCalled = true; return {}; } }),
    });
    const result = await runTicketDuplicates(['PROJ-1', '--threshold=notanumber'], deps);
    assert.equal(result.ok, false);
    assert.equal(fetchCalled, false);
    assert.match(deps.stream.lines.join(''), /--threshold/);
  });
});

describe('runTicketDuplicates — happy path', () => {
  test('reports ranked matches above threshold', async () => {
    const deps = baseDeps();
    const result = await runTicketDuplicates(['PROJ-1'], deps);
    assert.equal(result.ok, true);
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].key, 'PROJ-9');
    assert.match(deps.stream.lines.join(''), /PROJ-9/);
  });

  test('a custom --threshold is honored and forwarded to scoring', async () => {
    const deps = baseDeps({
      resolveAdapterFn: () => fakeAdapter({ findCandidates: async () => ([{ key: 'PROJ-9', summary: 'barely related mention of login', description: '' }]) }),
    });
    const result = await runTicketDuplicates(['PROJ-1', '--threshold=0.95'], deps);
    assert.equal(result.ok, true);
    assert.deepEqual(result.results, []);
    assert.match(deps.stream.lines.join(''), /No likely duplicates/);
  });

  test('reports no likely duplicates when nothing scores above threshold', async () => {
    const deps = baseDeps({
      resolveAdapterFn: () => fakeAdapter({ findCandidates: async () => ([]) }),
    });
    const result = await runTicketDuplicates(['PROJ-1'], deps);
    assert.equal(result.ok, true);
    assert.deepEqual(result.results, []);
    assert.match(deps.stream.lines.join(''), /No likely duplicates/);
  });
});

describe('runTicketDuplicates — read failure', () => {
  test('a thrown error from fetchTicket (e.g. a 404) is reported with its message, no crash', async () => {
    const deps = baseDeps({
      resolveAdapterFn: () => fakeAdapter({ fetchTicket: async () => { throw Object.assign(new Error('not found'), { status: 404 }); } }),
    });
    const result = await runTicketDuplicates(['PROJ-1'], deps);
    assert.equal(result.ok, false);
    assert.match(deps.stream.lines.join(''), /not found/);
  });

  test('a thrown error from findCandidates (e.g. a 404) is reported with its message, no crash', async () => {
    const deps = baseDeps({
      resolveAdapterFn: () => fakeAdapter({ findCandidates: async () => { throw Object.assign(new Error('search failed'), { status: 404 }); } }),
    });
    const result = await runTicketDuplicates(['PROJ-1'], deps);
    assert.equal(result.ok, false);
    assert.match(deps.stream.lines.join(''), /search failed/);
  });

  test('a rate-limited error is reported with rate-limit-aware wording, not swallowed generically', async () => {
    const deps = baseDeps({
      resolveAdapterFn: () => fakeAdapter({
        findCandidates: async () => { throw Object.assign(new Error('rate limited'), { rateLimit: { kind: 'secondary-rate-limit', retryAfterSeconds: 30 } }); },
      }),
    });
    const result = await runTicketDuplicates(['PROJ-1'], deps);
    assert.equal(result.ok, false);
    assert.match(deps.stream.lines.join(''), /rate limited/i);
    assert.match(deps.stream.lines.join(''), /30s/);
  });

  test('a statusless network/timeout error gets network-aware wording, not a raw stack-trace-style message', async () => {
    const deps = baseDeps({
      resolveAdapterFn: () => fakeAdapter({ findCandidates: async () => { throw new Error('fetch failed'); } }),
    });
    const result = await runTicketDuplicates(['PROJ-1'], deps);
    assert.equal(result.ok, false);
    assert.match(deps.stream.lines.join(''), /network error or timeout/i);
  });
});

// ---------------------------------------------------------------------------
// runTicketLinkList
// ---------------------------------------------------------------------------
describe('runTicketLinkList — license gate', () => {
  test('unlicensed: never resolves a connection, never lists link types', async () => {
    let resolveCalls = 0;
    const deps = baseDeps({
      isLicensedFn: () => false,
      resolveConnectionFn: () => { resolveCalls++; return { baseUrl: 'x' }; },
    });
    const result = await runTicketLinkList(['PROJ-1', 'PROJ-2'], deps);
    assert.equal(result.ok, false);
    assert.equal(resolveCalls, 0);
  });
});

describe('runTicketLinkList — usage validation', () => {
  test('missing target key shows usage', async () => {
    const deps = baseDeps();
    const result = await runTicketLinkList(['PROJ-1'], deps);
    assert.equal(result.ok, false);
    assert.match(deps.stream.lines.join(''), /Usage/);
  });

  test('malformed source key shows usage', async () => {
    const deps = baseDeps();
    const result = await runTicketLinkList(['not-a-key', 'PROJ-2'], deps);
    assert.equal(result.ok, false);
    assert.match(deps.stream.lines.join(''), /Usage/);
  });

  test('malformed target key shows usage', async () => {
    const deps = baseDeps();
    const result = await runTicketLinkList(['PROJ-1', 'not-a-key'], deps);
    assert.equal(result.ok, false);
    assert.match(deps.stream.lines.join(''), /Usage/);
  });
});

describe('runTicketLinkList — happy path', () => {
  test('lists the tracker\'s available link types without mutating anything', async () => {
    let linkCalled = false;
    const deps = baseDeps({
      resolveAdapterFn: () => fakeAdapter({ linkTo: async () => { linkCalled = true; return { executed: true }; } }),
    });
    const result = await runTicketLinkList(['PROJ-1', 'PROJ-2'], deps);
    assert.equal(result.ok, true);
    assert.deepEqual(result.types, ['blocks', 'duplicate', 'related']);
    assert.equal(linkCalled, false);
    assert.match(deps.stream.lines.join(''), /duplicate/);
  });

  test('warns explicitly that GitHub\'s link action closes the source issue — louder than Jira/Linear\'s pure relationship-add', async () => {
    const deps = baseDeps({
      resolveAdapterFn: () => fakeAdapter({ type: 'github', getLinkTypes: async () => ['duplicate'] }),
    });
    const result = await runTicketLinkList(['PROJ-1', 'PROJ-2'], deps);
    assert.equal(result.ok, true);
    assert.match(deps.stream.lines.join(''), /CLOSE/);
  });

  test('reports zero available link types distinctly from a failure, same as runTicketTransitionList', async () => {
    const deps = baseDeps({ resolveAdapterFn: () => fakeAdapter({ getLinkTypes: async () => [] }) });
    const result = await runTicketLinkList(['PROJ-1', 'PROJ-2'], deps);
    assert.equal(result.ok, true);
    assert.deepEqual(result.types, []);
    assert.match(deps.stream.lines.join(''), /No link types available/);
  });
});

describe('runTicketLinkList — read failure', () => {
  test('a statusless network/timeout error gets read-oriented wording, not write-oriented ("checking", never "writing to")', async () => {
    const deps = baseDeps({
      resolveAdapterFn: () => fakeAdapter({ getLinkTypes: async () => { throw new Error('fetch failed'); } }),
    });
    const result = await runTicketLinkList(['PROJ-1', 'PROJ-2'], deps);
    assert.equal(result.ok, false);
    const out = deps.stream.lines.join('');
    assert.match(out, /network error or timeout checking/i);
    assert.doesNotMatch(out, /writing to/i);
  });
});

// ---------------------------------------------------------------------------
// runTicketLink
// ---------------------------------------------------------------------------
describe('runTicketLink — usage validation', () => {
  test('missing --type shows usage', async () => {
    const deps = baseDeps();
    const result = await runTicketLink(['PROJ-1', 'PROJ-2', '--confirm'], deps);
    assert.equal(result.ok, false);
    assert.match(deps.stream.lines.join(''), /Usage/);
  });

  test('--type without --confirm refuses to execute', async () => {
    let linkCalled = false;
    const deps = baseDeps({
      resolveAdapterFn: () => fakeAdapter({ linkTo: async () => { linkCalled = true; return { executed: true }; } }),
    });
    const result = await runTicketLink(['PROJ-1', 'PROJ-2', '--type=duplicate'], deps);
    assert.equal(result.ok, false);
    assert.equal(linkCalled, false);
    assert.match(deps.stream.lines.join(''), /--confirm/);
  });
});

describe('runTicketLink — cooldown', () => {
  test('active cooldown skips execution, checked against the source:target pair key', async () => {
    let linkCalled = false;
    let checkedKey;
    const deps = baseDeps({
      checkCooldownFn: (key) => { checkedKey = key; return { active: true, remainingMs: 2000 }; },
      resolveAdapterFn: () => fakeAdapter({ linkTo: async () => { linkCalled = true; return { executed: true }; } }),
    });
    const result = await runTicketLink(['PROJ-1', 'PROJ-2', '--type=duplicate', '--confirm'], deps);
    assert.equal(result.ok, false);
    assert.equal(linkCalled, false);
    assert.equal(checkedKey, 'PROJ-1:PROJ-2');
  });
});

describe('runTicketLink — GitHub type restriction', () => {
  test('rejects a non-duplicate type on a GitHub-tracked ticket without ever calling linkTo', async () => {
    let linkCalled = false;
    const deps = baseDeps({
      resolveAdapterFn: () => fakeAdapter({ type: 'github', linkTo: async () => { linkCalled = true; return { executed: true }; } }),
    });
    const result = await runTicketLink(['PROJ-1', 'PROJ-2', '--type=Blocks', '--confirm'], deps);
    assert.equal(result.ok, false);
    assert.equal(linkCalled, false);
    assert.match(deps.stream.lines.join(''), /GitHub only supports/);
  });
});

describe('runTicketLink — unresolved type', () => {
  test('executed:false is reported with valid options, cooldown/log never recorded — mirrors runTicketTransition\'s unresolved-target handling', async () => {
    let recorded = false, logged = false;
    const deps = baseDeps({
      resolveAdapterFn: () => fakeAdapter({
        linkTo: async () => ({ executed: false, reason: 'not-found', options: ['duplicate', 'related'] }),
      }),
      recordActionFn: () => { recorded = true; },
      logActionFn: () => { logged = true; },
    });
    const result = await runTicketLink(['PROJ-1', 'PROJ-2', '--type=Bogus', '--confirm'], deps);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'not-found');
    assert.equal(recorded, false);
    assert.equal(logged, false);
    assert.match(deps.stream.lines.join(''), /duplicate/);
  });
});

describe('runTicketLink — happy path', () => {
  test('links, records cooldown on the pair key, and logs sourceKey with target/type in detail', async () => {
    let recorded, logged;
    const deps = baseDeps({
      recordActionFn: (key, action) => { recorded = { key, action }; },
      logActionFn: (entry) => { logged = entry; },
    });
    const result = await runTicketLink(['PROJ-1', 'PROJ-2', '--type=duplicate', '--confirm'], deps);
    assert.equal(result.ok, true);
    assert.deepEqual(recorded, { key: 'PROJ-1:PROJ-2', action: 'link' });
    assert.deepEqual(logged, { ticketKey: 'PROJ-1', action: 'link', actor: 'ralph', tracker: 'jira', detail: { targetKey: 'PROJ-2', type: 'duplicate' } });
    assert.match(deps.stream.lines.join(''), /linked to PROJ-2/);
  });

  test('reports GitHub\'s close-semantics distinctly in the success message', async () => {
    const deps = baseDeps({
      resolveAdapterFn: () => fakeAdapter({ type: 'github' }),
    });
    const result = await runTicketLink(['PROJ-1', 'PROJ-2', '--type=duplicate', '--confirm'], deps);
    assert.equal(result.ok, true);
    assert.match(deps.stream.lines.join(''), /closed as a duplicate/);
  });

  test('warns that the source will be CLOSED right before executing on GitHub — visible even when --confirm is passed directly, not just in list mode', async () => {
    const deps = baseDeps({
      resolveAdapterFn: () => fakeAdapter({ type: 'github' }),
    });
    await runTicketLink(['PROJ-1', 'PROJ-2', '--type=duplicate', '--confirm'], deps);
    assert.match(deps.stream.lines.join(''), /CLOSE PROJ-1/);
  });
});

describe('runTicketLink — write failure', () => {
  test('a thrown error during execution is classified and reported, cooldown/log never recorded', async () => {
    let recorded = false, logged = false;
    const deps = baseDeps({
      resolveAdapterFn: () => fakeAdapter({ linkTo: async () => { throw new Error('network down'); } }),
      recordActionFn: () => { recorded = true; },
      logActionFn: () => { logged = true; },
    });
    const result = await runTicketLink(['PROJ-1', 'PROJ-2', '--type=duplicate', '--confirm'], deps);
    assert.equal(result.ok, false);
    assert.equal(recorded, false);
    assert.equal(logged, false);
    assert.match(deps.stream.lines.join(''), /Network error or timeout/);
  });
});
