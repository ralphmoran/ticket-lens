import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { runTicketComment, runTicketTransitionList, runTicketTransition, runTicketAssign, runTicketDuplicates, runTicketLinkList, runTicketLink, runTicketUpdate, runTicketCreate, classifyWriteFailure, matchColor } from '../lib/ticket-command.mjs';
import { createStyler } from '../lib/ansi.mjs';

function makeStream() {
  const lines = [];
  return { write: (s) => lines.push(s), lines };
}

function makeTtyStream() {
  const lines = [];
  return { write: (s) => lines.push(s), lines, isTTY: true };
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
    updateFields: async () => ({ applied: { title: true }, errors: {} }),
    createTicket: async () => ({ key: 'PROJ-99', id: '99', url: 'https://example/PROJ-99' }),
    listCreatableProjects: async () => ([{ key: 'PROJ', name: 'Project' }]),
    listIssueTypes: async () => ([{ id: '1', name: 'Task' }]),
    attachFiles: async () => ({ uploaded: [], errors: [], droppedCount: 0 }),
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
    readMetadataCacheFn: () => null,
    writeMetadataCacheFn: () => {},
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

  test('an ambiguous-prefix warning from the resolver is surfaced to the stream, not swallowed', async () => {
    const deps = baseDeps({
      resolveConnectionFn: (ticketKey, opts) => {
        opts.onWarning('Prefix "PROJ" matches multiple profiles: corenexus, advent. Using corenexus. Use --profile=NAME to override.');
        return { baseUrl: 'https://jira.example.com' };
      },
    });
    const result = await runTicketComment(['PROJ-1', '--body=hi'], deps);
    assert.equal(result.ok, true);
    assert.match(deps.stream.lines.join(''), /Prefix "PROJ" matches multiple profiles: corenexus, advent/);
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

  test('styles the success line with a green checkmark and bold brand key in a TTY', async () => {
    const ttyStream = makeTtyStream();
    const deps = baseDeps({ stream: ttyStream });
    await runTicketComment(['PROJ-1', '--body=Looks good'], deps);
    const output = ttyStream.lines.join('');
    assert.match(output, /\x1b\[38;5;71m✔\x1b\[39m/, 'expected a green checkmark');
    assert.match(output, /\x1b\[1mPROJ-1\x1b\[22m/, 'expected the ticket key bolded');
  });

  test('output is plain (no ANSI codes) when the stream is not a TTY', async () => {
    const deps = baseDeps();
    await runTicketComment(['PROJ-1', '--body=Looks good'], deps);
    assert.doesNotMatch(deps.stream.lines.join(''), /\x1b\[/, 'MCP/non-TTY callers must never receive raw ANSI escape codes');
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

describe('runTicketComment — attachments', () => {
  test('uploads --attach paths and folds inline markup into the comment body before posting', async () => {
    let attachArgs, postedBody;
    const deps = baseDeps({
      resolveAdapterFn: () => fakeAdapter({
        attachFiles: async (key, paths) => {
          attachArgs = { key, paths };
          return { uploaded: [{ filename: 'shot.png', size: 10, url: 'https://x/shot.png', inlineMarkup: '!shot.png|thumbnail!' }], errors: [], droppedCount: 0 };
        },
        addComment: async (key, body) => { postedBody = body; return { id: 'c1', url: 'https://example/c1' }; },
      }),
    });
    const result = await runTicketComment(['PROJ-1', '--body=Looks good', '--attach=/tmp/shot.png'], deps);
    assert.equal(result.ok, true);
    assert.deepEqual(attachArgs, { key: 'PROJ-1', paths: ['/tmp/shot.png'] });
    assert.equal(postedBody, 'Looks good\n\n!shot.png|thumbnail!');
  });

  test('posts the original body unchanged when no uploaded file has inline markup (non-image, or a tracker with neither mechanism)', async () => {
    let postedBody;
    const deps = baseDeps({
      resolveAdapterFn: () => fakeAdapter({
        attachFiles: async () => ({ uploaded: [{ filename: 'log.txt', size: 10, url: 'https://x/log.txt', inlineMarkup: null, adfMediaNode: null }], errors: [], droppedCount: 0 }),
        addComment: async (key, body) => { postedBody = body; return { id: 'c1' }; },
      }),
    });
    await runTicketComment(['PROJ-1', '--body=Looks good', '--attach=/tmp/log.txt'], deps);
    assert.equal(postedBody, 'Looks good');
  });

  test('threads Jira Cloud adfMediaNode entries through to addComment as extraAdfNodes', async () => {
    let addCommentOpts;
    const mediaNode = { type: 'mediaSingle', attrs: { layout: 'center' }, content: [{ type: 'media', attrs: { type: 'file', id: 'uuid-1', collection: 'PROJ-1' } }] };
    const deps = baseDeps({
      resolveAdapterFn: () => fakeAdapter({
        attachFiles: async () => ({ uploaded: [{ filename: 'shot.png', size: 10, url: 'https://x/shot.png', inlineMarkup: null, adfMediaNode: mediaNode }], errors: [], droppedCount: 0 }),
        addComment: async (key, body, opts) => { addCommentOpts = opts; return { id: 'c1' }; },
      }),
    });
    await runTicketComment(['PROJ-1', '--body=Looks good', '--attach=/tmp/shot.png'], deps);
    assert.deepEqual(addCommentOpts, { extraAdfNodes: [mediaNode] });
  });

  test('passes an empty opts object to addComment when no file has an adfMediaNode', async () => {
    let addCommentOpts;
    const deps = baseDeps({
      resolveAdapterFn: () => fakeAdapter({
        addComment: async (key, body, opts) => { addCommentOpts = opts; return { id: 'c1' }; },
      }),
    });
    await runTicketComment(['PROJ-1', '--body=hi'], deps);
    assert.deepEqual(addCommentOpts, {});
  });

  test('parses multiple comma-separated --attach paths', async () => {
    let attachPaths;
    const deps = baseDeps({
      resolveAdapterFn: () => fakeAdapter({
        attachFiles: async (key, paths) => { attachPaths = paths; return { uploaded: [], errors: [], droppedCount: 0 }; },
      }),
    });
    await runTicketComment(['PROJ-1', '--body=hi', '--attach=/a.png,/b.txt'], deps);
    assert.deepEqual(attachPaths, ['/a.png', '/b.txt']);
  });

  test('never calls attachFiles on GitHub — warns and posts the comment without attachments', async () => {
    let attachCalled = false;
    const deps = baseDeps({
      resolveAdapterFn: () => fakeAdapter({
        type: 'github',
        attachFiles: async () => { attachCalled = true; return { uploaded: [], errors: [], droppedCount: 0 }; },
      }),
    });
    const result = await runTicketComment(['PROJ-1', '--body=hi', '--attach=/a.png'], deps);
    assert.equal(result.ok, true);
    assert.equal(attachCalled, false);
    assert.match(deps.stream.lines.join(''), /GitHub does not support file attachments/i);
  });

  test('an attach failure does not block posting the comment (best-effort)', async () => {
    const deps = baseDeps({
      resolveAdapterFn: () => fakeAdapter({
        attachFiles: async () => ({ uploaded: [], errors: [{ path: '/missing.png', message: 'not-found' }], droppedCount: 0 }),
      }),
    });
    const result = await runTicketComment(['PROJ-1', '--body=hi', '--attach=/missing.png'], deps);
    assert.equal(result.ok, true);
    assert.match(deps.stream.lines.join(''), /Failed to attach \/missing\.png: not-found/);
  });

  test('records the full attempted attach path plus the filename that actually landed, in the audit log detail', async () => {
    let logged;
    const deps = baseDeps({
      logActionFn: (entry) => { logged = entry; },
      resolveAdapterFn: () => fakeAdapter({
        attachFiles: async () => ({ uploaded: [{ filename: 'shot.png', size: 10, url: 'https://x/shot.png', inlineMarkup: null, adfMediaNode: null }], errors: [], droppedCount: 0 }),
      }),
    });
    await runTicketComment(['PROJ-1', '--body=hi', '--attach=/Users/x/shot.png'], deps);
    assert.deepEqual(logged.detail.attachPaths, ['/Users/x/shot.png']);
    assert.deepEqual(logged.detail.attachedFilenames, ['shot.png']);
  });

  test('records every attempted path even when some failed to upload — a partial success is reconstructable from the audit log alone', async () => {
    let logged;
    const deps = baseDeps({
      logActionFn: (entry) => { logged = entry; },
      resolveAdapterFn: () => fakeAdapter({
        attachFiles: async () => ({ uploaded: [{ filename: 'good.png', size: 10, url: 'https://x/good.png', inlineMarkup: null, adfMediaNode: null }], errors: [{ path: '/etc/passwd', message: 'not-found' }], droppedCount: 0 }),
      }),
    });
    await runTicketComment(['PROJ-1', '--body=hi', '--attach=/good.png,/etc/passwd'], deps);
    assert.deepEqual(logged.detail.attachPaths, ['/good.png', '/etc/passwd']);
    assert.deepEqual(logged.detail.attachedFilenames, ['good.png']);
  });

  test('still reports the attach summary when the comment write itself fails afterward — a caller must not blindly re-upload already-landed files', async () => {
    const deps = baseDeps({
      resolveAdapterFn: () => fakeAdapter({
        attachFiles: async () => ({ uploaded: [{ filename: 'shot.png', size: 10, url: 'https://x/shot.png', inlineMarkup: null, adfMediaNode: null }], errors: [], droppedCount: 0 }),
        addComment: async () => { throw Object.assign(new Error('boom'), { status: 500 }); },
      }),
    });
    const result = await runTicketComment(['PROJ-1', '--body=hi', '--attach=/shot.png'], deps);
    assert.equal(result.ok, false);
    assert.match(deps.stream.lines.join(''), /Attached shot\.png/);
  });

  test('styles the attached-file line with a green checkmark and bold filename in a TTY', async () => {
    const ttyStream = makeTtyStream();
    const deps = baseDeps({
      stream: ttyStream,
      resolveAdapterFn: () => fakeAdapter({
        attachFiles: async () => ({ uploaded: [{ filename: 'shot.png', size: 10, url: 'https://x/shot.png', inlineMarkup: null, adfMediaNode: null }], errors: [], droppedCount: 0 }),
      }),
    });
    await runTicketComment(['PROJ-1', '--body=hi', '--attach=/shot.png'], deps);
    const output = ttyStream.lines.join('');
    assert.match(output, /\x1b\[38;5;71m✔\x1b\[39m/, 'expected a green checkmark on the attached-file line');
    assert.match(output, /\x1b\[1mshot\.png\x1b\[22m/, 'expected the filename bolded');
  });

  test('attachment summary is plain (no ANSI codes) when the stream is not a TTY', async () => {
    const deps = baseDeps({
      resolveAdapterFn: () => fakeAdapter({
        attachFiles: async () => ({ uploaded: [{ filename: 'shot.png', size: 10, url: 'https://x/shot.png', inlineMarkup: null, adfMediaNode: null }], errors: [], droppedCount: 0 }),
      }),
    });
    await runTicketComment(['PROJ-1', '--body=hi', '--attach=/shot.png'], deps);
    assert.doesNotMatch(deps.stream.lines.join(''), /\x1b\[/, 'MCP/non-TTY callers must never receive raw ANSI escape codes');
  });

  test('no --attach flag never calls attachFiles', async () => {
    let called = false;
    const deps = baseDeps({
      resolveAdapterFn: () => fakeAdapter({ attachFiles: async () => { called = true; return { uploaded: [], errors: [], droppedCount: 0 }; } }),
    });
    await runTicketComment(['PROJ-1', '--body=hi'], deps);
    assert.equal(called, false);
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

  test('styles the list header key and bullets in a TTY', async () => {
    const ttyStream = makeTtyStream();
    const deps = baseDeps({ stream: ttyStream });
    await runTicketTransitionList(['PROJ-1'], deps);
    const output = ttyStream.lines.join('');
    assert.match(output, /\x1b\[1mPROJ-1\x1b\[22m/, 'expected the ticket key bolded');
    assert.match(output, /\x1b\[38;5;117m●\x1b\[39m/, 'expected the brand-colored bullet before each option');
  });

  test('output is plain (no ANSI codes) when the stream is not a TTY', async () => {
    const deps = baseDeps();
    await runTicketTransitionList(['PROJ-1'], deps);
    assert.doesNotMatch(deps.stream.lines.join(''), /\x1b\[/, 'MCP/non-TTY callers must never receive raw ANSI escape codes');
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

  test('styles the success line with a green checkmark and bold brand key in a TTY', async () => {
    const ttyStream = makeTtyStream();
    const deps = baseDeps({ stream: ttyStream });
    await runTicketTransition(['PROJ-1', '--target=Done', '--confirm'], deps);
    const output = ttyStream.lines.join('');
    assert.match(output, /\x1b\[38;5;71m✔\x1b\[39m/, 'expected a green checkmark');
    assert.match(output, /\x1b\[1mPROJ-1\x1b\[22m/, 'expected the ticket key bolded');
  });

  test('output is plain (no ANSI codes) when the stream is not a TTY', async () => {
    const deps = baseDeps();
    await runTicketTransition(['PROJ-1', '--target=Done', '--confirm'], deps);
    assert.doesNotMatch(deps.stream.lines.join(''), /\x1b\[/, 'MCP/non-TTY callers must never receive raw ANSI escape codes');
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

  test('styles the success line with a green checkmark and bold brand key in a TTY', async () => {
    const ttyStream = makeTtyStream();
    const deps = baseDeps({ stream: ttyStream });
    await runTicketAssign(['PROJ-1', '--to=me'], deps);
    const output = ttyStream.lines.join('');
    assert.match(output, /\x1b\[38;5;71m✔\x1b\[39m/, 'expected a green checkmark');
    assert.match(output, /\x1b\[1mPROJ-1\x1b\[22m/, 'expected the ticket key bolded');
  });

  test('output is plain (no ANSI codes) when the stream is not a TTY', async () => {
    const deps = baseDeps();
    await runTicketAssign(['PROJ-1', '--to=me'], deps);
    assert.doesNotMatch(deps.stream.lines.join(''), /\x1b\[/, 'MCP/non-TTY callers must never receive raw ANSI escape codes');
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

  test('the empty-result message caveats that absence is not a guarantee (M-11)', async () => {
    const deps = baseDeps({
      resolveAdapterFn: () => fakeAdapter({ findCandidates: async () => ([]) }),
    });
    await runTicketDuplicates(['PROJ-1'], deps);
    const output = deps.stream.lines.join('');
    assert.match(output, /No likely duplicates/);
    assert.match(output, /not a guarantee|heuristic/i);
  });

  test('prints the source ticket key and title as a header', async () => {
    const deps = baseDeps();
    await runTicketDuplicates(['PROJ-1'], deps);
    const output = deps.stream.lines.join('');
    assert.match(output, /PROJ-1/);
    assert.match(output, /Login button broken on mobile/);
  });

  test('prints the source ticket title even when no duplicates are found', async () => {
    const deps = baseDeps({
      resolveAdapterFn: () => fakeAdapter({ findCandidates: async () => ([]) }),
    });
    await runTicketDuplicates(['PROJ-1'], deps);
    const output = deps.stream.lines.join('');
    assert.match(output, /Login button broken on mobile/);
    assert.match(output, /No likely duplicates/);
  });

  test('output is plain (no ANSI codes) when the stream is not a TTY', async () => {
    const deps = baseDeps();
    await runTicketDuplicates(['PROJ-1'], deps);
    const output = deps.stream.lines.join('');
    assert.doesNotMatch(output, /\x1b\[/, 'MCP/non-TTY callers must never receive raw ANSI escape codes');
  });

  test('a real match in the results list is styled with the bold key and brand bullet in a TTY', async () => {
    const ttyStream = makeTtyStream();
    const deps = baseDeps({ stream: ttyStream });
    await runTicketDuplicates(['PROJ-1'], deps);
    const output = ttyStream.lines.join('');
    assert.match(output, /\x1b\[1mPROJ-9\x1b\[22m/, 'expected the result ticket key to be bolded');
    assert.match(output, /\x1b\[38;5;117m●\x1b\[39m/, 'expected the brand-colored bullet before each result');
  });
});

describe('runTicketDuplicates — Jira-linked duplicates', () => {
  test('a Jira "Duplicate"-type linked issue is always surfaced, even with no text-match candidates', async () => {
    const deps = baseDeps({
      resolveAdapterFn: () => fakeAdapter({
        fetchTicket: async () => ({
          key: 'PROJ-1', summary: 'Login button broken on mobile', description: '',
          linkedIssues: [{ key: 'PROJ-50', summary: 'Duplicate report of login bug', linkType: 'Duplicate', linkPhrase: 'is duplicated by', direction: 'inward' }],
        }),
        findCandidates: async () => ([]),
      }),
    });
    const result = await runTicketDuplicates(['PROJ-1'], deps);
    assert.equal(result.ok, true);
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].key, 'PROJ-50');
    const output = deps.stream.lines.join('');
    assert.match(output, /PROJ-50/);
    assert.match(output, /is duplicated by/);
  });

  test('a non-duplicate link type (e.g. Blocks, Relates) is never surfaced as a duplicate', async () => {
    const deps = baseDeps({
      resolveAdapterFn: () => fakeAdapter({
        fetchTicket: async () => ({
          key: 'PROJ-1', summary: 'Login button broken on mobile', description: '',
          linkedIssues: [
            { key: 'PROJ-51', summary: 'Blocking ticket', linkType: 'Blocks', linkPhrase: 'blocks', direction: 'outward' },
            { key: 'PROJ-52', summary: 'Related ticket', linkType: 'Relates', linkPhrase: 'relates to', direction: 'outward' },
          ],
        }),
        findCandidates: async () => ([]),
      }),
    });
    const result = await runTicketDuplicates(['PROJ-1'], deps);
    assert.equal(result.ok, true);
    assert.deepEqual(result.results, []);
    assert.match(deps.stream.lines.join(''), /No likely duplicates/);
  });

  test('a ticket that is both Jira-linked and above the Jaccard threshold appears exactly once, as the linked entry', async () => {
    const deps = baseDeps({
      resolveAdapterFn: () => fakeAdapter({
        fetchTicket: async () => ({
          key: 'PROJ-1', summary: 'Login button broken on mobile', description: 'Tapping login does nothing on iOS Safari',
          linkedIssues: [{ key: 'PROJ-9', summary: 'Login button broken on mobile Safari', linkType: 'Duplicate', linkPhrase: 'duplicates', direction: 'outward' }],
        }),
        // Same key ('PROJ-9') also comes back from the text-match candidate search.
        findCandidates: async () => ([{ key: 'PROJ-9', summary: 'Login button broken on mobile Safari', description: 'unrelated body' }]),
      }),
    });
    const result = await runTicketDuplicates(['PROJ-1'], deps);
    assert.equal(result.ok, true);
    assert.equal(result.results.length, 1, 'PROJ-9 must not be listed twice');
    assert.equal(result.results[0].key, 'PROJ-9');
    assert.equal(result.results[0].linked, true);
    const output = deps.stream.lines.join('');
    assert.match(output, /duplicates/);
    // Should not also render the percentage-match styling for the same key
    assert.doesNotMatch(output, /% match/);
  });

  test('two separately-typed duplicate-ish links to the same target key are collapsed into one entry', async () => {
    // Jira doesn't enforce uniqueness of link-type+target pairs — a ticket could
    // have both a "Duplicate" link and a differently-named "duplicate-ish" link
    // to the same target key.
    const deps = baseDeps({
      resolveAdapterFn: () => fakeAdapter({
        fetchTicket: async () => ({
          key: 'PROJ-1', summary: 'Login button broken on mobile', description: '',
          linkedIssues: [
            { key: 'PROJ-9', summary: 'Dup A', linkType: 'Duplicate', linkPhrase: 'duplicates', direction: 'outward' },
            { key: 'PROJ-9', summary: 'Dup A again', linkType: 'Cloners (Duplicate)', linkPhrase: 'is a duplicate clone of', direction: 'outward' },
          ],
        }),
        findCandidates: async () => ([]),
      }),
    });
    const result = await runTicketDuplicates(['PROJ-1'], deps);
    assert.equal(result.ok, true);
    assert.equal(result.results.length, 1, 'the same target key from two duplicate-ish link types must collapse to one entry');
    assert.equal(result.results[0].key, 'PROJ-9');
  });

  test('GitHub/Linear adapters (linkedIssues always empty) are unaffected — pure text-match behavior preserved', async () => {
    const deps = baseDeps({
      resolveAdapterFn: () => fakeAdapter({
        fetchTicket: async () => ({ key: 'PROJ-1', summary: 'Login button broken on mobile', description: '', linkedIssues: [] }),
      }),
    });
    const result = await runTicketDuplicates(['PROJ-1'], deps);
    assert.equal(result.ok, true);
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].key, 'PROJ-9');
    assert.notEqual(result.results[0].linked, true);
  });
});

describe('matchColor', () => {
  const s = createStyler({ isTTY: true });

  test('colors a 70%+ match green', () => {
    assert.equal(matchColor(70, s), s.green);
    assert.equal(matchColor(96, s), s.green);
  });

  test('colors a 50-69% match yellow', () => {
    assert.equal(matchColor(50, s), s.yellow);
    assert.equal(matchColor(69, s), s.yellow);
  });

  test('colors anything below 50% dim', () => {
    assert.equal(matchColor(49, s), s.dim);
    assert.equal(matchColor(0, s), s.dim);
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

  test('styles the list header keys and bullets in a TTY', async () => {
    const ttyStream = makeTtyStream();
    const deps = baseDeps({ stream: ttyStream });
    await runTicketLinkList(['PROJ-1', 'PROJ-2'], deps);
    const output = ttyStream.lines.join('');
    assert.match(output, /\x1b\[1mPROJ-1\x1b\[22m/, 'expected the source key bolded');
    assert.match(output, /\x1b\[1mPROJ-2\x1b\[22m/, 'expected the target key bolded');
    assert.match(output, /\x1b\[38;5;117m●\x1b\[39m/, 'expected the brand-colored bullet before each link type');
  });

  test('output is plain (no ANSI codes) when the stream is not a TTY', async () => {
    const deps = baseDeps();
    await runTicketLinkList(['PROJ-1', 'PROJ-2'], deps);
    assert.doesNotMatch(deps.stream.lines.join(''), /\x1b\[/, 'MCP/non-TTY callers must never receive raw ANSI escape codes');
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

  test('styles the success line with a green checkmark and bold brand keys in a TTY', async () => {
    const ttyStream = makeTtyStream();
    const deps = baseDeps({ stream: ttyStream });
    await runTicketLink(['PROJ-1', 'PROJ-2', '--type=duplicate', '--confirm'], deps);
    const output = ttyStream.lines.join('');
    assert.match(output, /\x1b\[38;5;71m✔\x1b\[39m/, 'expected a green checkmark');
    assert.match(output, /\x1b\[1mPROJ-1\x1b\[22m/, 'expected the source key bolded');
    assert.match(output, /\x1b\[1mPROJ-2\x1b\[22m/, 'expected the target key bolded');
  });

  test('output is plain (no ANSI codes) when the stream is not a TTY', async () => {
    const deps = baseDeps();
    await runTicketLink(['PROJ-1', 'PROJ-2', '--type=duplicate', '--confirm'], deps);
    assert.doesNotMatch(deps.stream.lines.join(''), /\x1b\[/, 'MCP/non-TTY callers must never receive raw ANSI escape codes');
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

describe('runTicketUpdate — license gate', () => {
  test('unlicensed shows upgrade prompt, never calls updateFields', async () => {
    let called = false;
    const deps = baseDeps({
      isLicensedFn: () => false,
      resolveAdapterFn: () => fakeAdapter({ updateFields: async () => { called = true; return { applied: {}, errors: {} }; } }),
    });
    const result = await runTicketUpdate(['PROJ-1', '--title=New'], deps);
    assert.equal(result.ok, false);
    assert.equal(called, false);
  });
});

describe('runTicketUpdate — usage validation', () => {
  test('missing ticket key shows usage', async () => {
    const deps = baseDeps();
    const result = await runTicketUpdate([], deps);
    assert.equal(result.ok, false);
    assert.match(deps.stream.lines.join(''), /Usage/);
  });

  test('no fields given at all shows usage — never a no-op write', async () => {
    let called = false;
    const deps = baseDeps({
      resolveAdapterFn: () => fakeAdapter({ updateFields: async () => { called = true; return { applied: {}, errors: {} }; } }),
    });
    const result = await runTicketUpdate(['PROJ-1'], deps);
    assert.equal(result.ok, false);
    assert.equal(called, false);
    assert.match(deps.stream.lines.join(''), /Usage/);
  });
});

describe('runTicketUpdate — cooldown', () => {
  test('active cooldown skips execution', async () => {
    let called = false;
    const deps = baseDeps({
      checkCooldownFn: () => ({ active: true, remainingMs: 3000 }),
      resolveAdapterFn: () => fakeAdapter({ updateFields: async () => { called = true; return { applied: {}, errors: {} }; } }),
    });
    const result = await runTicketUpdate(['PROJ-1', '--title=New'], deps);
    assert.equal(result.ok, false);
    assert.equal(called, false);
  });
});

describe('runTicketUpdate — GitHub priority restriction', () => {
  test('refuses --priority on a GitHub-tracked ticket without ever calling updateFields', async () => {
    let called = false;
    const deps = baseDeps({
      resolveAdapterFn: () => fakeAdapter({ type: 'github', updateFields: async () => { called = true; return { applied: {}, errors: {} }; } }),
    });
    const result = await runTicketUpdate(['PROJ-1', '--priority=High'], deps);
    assert.equal(result.ok, false);
    assert.equal(called, false);
    assert.match(deps.stream.lines.join(''), /GitHub.*priority/i);
  });

  test('does not block other fields on GitHub as long as --priority is absent', async () => {
    let called = false;
    const deps = baseDeps({
      resolveAdapterFn: () => fakeAdapter({ type: 'github', updateFields: async () => { called = true; return { applied: { title: true }, errors: {} }; } }),
    });
    const result = await runTicketUpdate(['PROJ-1', '--title=New'], deps);
    assert.equal(result.ok, true);
    assert.equal(called, true);
  });
});

describe('runTicketUpdate — happy path', () => {
  test('parses title/description/priority and comma-split add/remove labels, passing them through to updateFields', async () => {
    let captured;
    const deps = baseDeps({
      resolveAdapterFn: () => fakeAdapter({
        updateFields: async (key, fields) => { captured = { key, fields }; return { applied: { title: true, addLabels: ['urgent', 'backend'], removeLabels: ['stale'] }, errors: {} }; },
      }),
    });
    const result = await runTicketUpdate(['PROJ-1', '--title=New title', '--add-labels=urgent, backend', '--remove-labels=stale'], deps);
    assert.equal(result.ok, true);
    assert.equal(captured.key, 'PROJ-1');
    assert.deepEqual(captured.fields, { title: 'New title', description: undefined, priority: undefined, addLabels: ['urgent', 'backend'], removeLabels: ['stale'] });
  });

  test('records cooldown and logs the audit detail using applied field names/values, never full description text', async () => {
    let recorded, logged;
    const deps = baseDeps({
      recordActionFn: (key, action) => { recorded = { key, action }; },
      logActionFn: (entry) => { logged = entry; },
      resolveAdapterFn: () => fakeAdapter({
        updateFields: async () => ({ applied: { description: true, priority: 'High' }, errors: {} }),
      }),
    });
    const result = await runTicketUpdate(['PROJ-1', '--description=a very long secret-ish body', '--priority=High'], deps);
    assert.equal(result.ok, true);
    assert.deepEqual(recorded, { key: 'PROJ-1', action: 'update' });
    assert.equal(logged.ticketKey, 'PROJ-1');
    assert.equal(logged.action, 'update');
    assert.equal(logged.tracker, 'jira');
    assert.deepEqual(logged.detail, { description: true, priority: 'High', failed: [] });
    assert.ok(!JSON.stringify(logged).includes('secret-ish'), 'full description text must never reach the audit log');
  });

  test('reports success with the applied fields in the message', async () => {
    const deps = baseDeps({
      resolveAdapterFn: () => fakeAdapter({ updateFields: async () => ({ applied: { title: true, addLabels: ['urgent'] }, errors: {} }) }),
    });
    const result = await runTicketUpdate(['PROJ-1', '--title=x', '--add-labels=urgent'], deps);
    assert.equal(result.ok, true);
    assert.match(deps.stream.lines.join(''), /PROJ-1/);
    assert.match(deps.stream.lines.join(''), /title/);
  });

  test('styles a full update with a green checkmark and bold brand key in a TTY', async () => {
    const ttyStream = makeTtyStream();
    const deps = baseDeps({
      stream: ttyStream,
      resolveAdapterFn: () => fakeAdapter({ updateFields: async () => ({ applied: { title: true }, errors: {} }) }),
    });
    await runTicketUpdate(['PROJ-1', '--title=x'], deps);
    const output = ttyStream.lines.join('');
    assert.match(output, /\x1b\[38;5;71m✔\x1b\[39m/, 'expected a green checkmark for a fully-applied update');
    assert.match(output, /\x1b\[1mPROJ-1\x1b\[22m/, 'expected the ticket key bolded');
  });

  test('output is plain (no ANSI codes) when the stream is not a TTY', async () => {
    const deps = baseDeps({
      resolveAdapterFn: () => fakeAdapter({ updateFields: async () => ({ applied: { title: true }, errors: {} }) }),
    });
    await runTicketUpdate(['PROJ-1', '--title=x'], deps);
    assert.doesNotMatch(deps.stream.lines.join(''), /\x1b\[/, 'MCP/non-TTY callers must never receive raw ANSI escape codes');
  });
});

describe('runTicketUpdate — partial failure', () => {
  test('some fields applied, some failed — reports ok:false but still records/logs what landed', async () => {
    let recorded = false, logged;
    const deps = baseDeps({
      recordActionFn: () => { recorded = true; },
      logActionFn: (entry) => { logged = entry; },
      resolveAdapterFn: () => fakeAdapter({
        updateFields: async () => ({ applied: { title: true }, errors: { addLabels: { reason: 'not-found', missing: ['bogus'] } } }),
      }),
    });
    const result = await runTicketUpdate(['PROJ-1', '--title=x', '--add-labels=bogus'], deps);
    assert.equal(result.ok, false);
    assert.equal(recorded, true, 'whatever did apply should still be recorded for cooldown purposes');
    assert.deepEqual(logged.detail.failed, ['addLabels']);
    assert.match(deps.stream.lines.join(''), /bogus/);
  });

  test('styles a partial update with a yellow tilde, distinct from a full success', async () => {
    const ttyStream = makeTtyStream();
    const deps = baseDeps({
      stream: ttyStream,
      resolveAdapterFn: () => fakeAdapter({
        updateFields: async () => ({ applied: { title: true }, errors: { addLabels: { reason: 'not-found', missing: ['bogus'] } } }),
      }),
    });
    await runTicketUpdate(['PROJ-1', '--title=x', '--add-labels=bogus'], deps);
    const output = ttyStream.lines.join('');
    assert.match(output, /\x1b\[38;5;178m~\x1b\[39m/, 'expected a yellow tilde for a partially-applied update');
    assert.doesNotMatch(output, /38;5;71m✔/, 'a partial update must not also render the full-success green checkmark');
  });

  test('nothing applied at all — reports ok:false and never records/logs', async () => {
    let recorded = false, logged = false;
    const deps = baseDeps({
      recordActionFn: () => { recorded = true; },
      logActionFn: () => { logged = true; },
      resolveAdapterFn: () => fakeAdapter({
        updateFields: async () => ({ applied: {}, errors: { priority: { reason: 'not-found', options: ['High', 'Low'] } } }),
      }),
    });
    const result = await runTicketUpdate(['PROJ-1', '--priority=Critical'], deps);
    assert.equal(result.ok, false);
    assert.equal(recorded, false);
    assert.equal(logged, false);
  });

  test('a total failure (nothing applied) stays plain — no icon, no styled key, even in a TTY', async () => {
    const ttyStream = makeTtyStream();
    const deps = baseDeps({
      stream: ttyStream,
      resolveAdapterFn: () => fakeAdapter({
        updateFields: async () => ({ applied: {}, errors: { priority: { reason: 'not-found', options: ['High', 'Low'] } } }),
      }),
    });
    await runTicketUpdate(['PROJ-1', '--priority=Critical'], deps);
    const output = ttyStream.lines.join('');
    assert.doesNotMatch(output, /\x1b\[/, 'a total failure must render exactly like a plain refusal message, no ANSI at all');
  });
});

describe('runTicketUpdate — write failure', () => {
  test('a thrown error (Jira/Linear atomic failure) is classified and reported, cooldown/log never recorded', async () => {
    let recorded = false, logged = false;
    const deps = baseDeps({
      recordActionFn: () => { recorded = true; },
      logActionFn: () => { logged = true; },
      resolveAdapterFn: () => fakeAdapter({ updateFields: async () => { throw new Error('network down'); } }),
    });
    const result = await runTicketUpdate(['PROJ-1', '--title=x'], deps);
    assert.equal(result.ok, false);
    assert.equal(recorded, false);
    assert.equal(logged, false);
    assert.match(deps.stream.lines.join(''), /Network error or timeout/);
  });
});

// ---------------------------------------------------------------------------
// runTicketCreate
// ---------------------------------------------------------------------------
describe('runTicketCreate — license gate', () => {
  test('unlicensed shows upgrade prompt, never calls createTicket', async () => {
    let called = false;
    const deps = baseDeps({
      isLicensedFn: () => false,
      resolveAdapterFn: () => fakeAdapter({ createTicket: async () => { called = true; return { key: 'X-1' }; } }),
    });
    const result = await runTicketCreate(['--project=PROJ', '--type=Task', '--summary=New'], deps);
    assert.equal(result.ok, false);
    assert.equal(called, false);
  });
});

describe('runTicketCreate — usage validation', () => {
  test('missing --summary shows usage', async () => {
    const deps = baseDeps();
    const result = await runTicketCreate(['--project=PROJ', '--type=Task'], deps);
    assert.equal(result.ok, false);
    assert.match(deps.stream.lines.join(''), /Usage/);
  });

  test('missing --project on Jira is refused before calling createTicket', async () => {
    let called = false;
    const deps = baseDeps({
      resolveAdapterFn: () => fakeAdapter({ createTicket: async () => { called = true; return { key: 'X-1' }; } }),
    });
    const result = await runTicketCreate(['--type=Task', '--summary=New'], deps);
    assert.equal(result.ok, false);
    assert.equal(called, false);
    assert.match(deps.stream.lines.join(''), /--project/);
  });

  test('missing --project on Linear is refused before calling createTicket', async () => {
    let called = false;
    const deps = baseDeps({
      resolveAdapterFn: () => fakeAdapter({ type: 'linear', createTicket: async () => { called = true; return { key: 'X-1' }; } }),
    });
    const result = await runTicketCreate(['--summary=New'], deps);
    assert.equal(result.ok, false);
    assert.equal(called, false);
    assert.match(deps.stream.lines.join(''), /--project/);
  });

  test('missing --project on GitHub is fine — repo is fixed by the profile', async () => {
    let called = false;
    const deps = baseDeps({
      resolveAdapterFn: () => fakeAdapter({ type: 'github', createTicket: async () => { called = true; return { key: 'GH-1' }; } }),
    });
    const result = await runTicketCreate(['--summary=New'], deps);
    assert.equal(result.ok, true);
    assert.equal(called, true);
  });

  test('missing --type on Jira is refused before calling createTicket', async () => {
    let called = false;
    const deps = baseDeps({
      resolveAdapterFn: () => fakeAdapter({ createTicket: async () => { called = true; return { key: 'X-1' }; } }),
    });
    const result = await runTicketCreate(['--project=PROJ', '--summary=New'], deps);
    assert.equal(result.ok, false);
    assert.equal(called, false);
    assert.match(deps.stream.lines.join(''), /--type/);
  });

  test('missing --type on Linear/GitHub is fine — no type concept there', async () => {
    let called = false;
    const deps = baseDeps({
      resolveAdapterFn: () => fakeAdapter({ type: 'linear', createTicket: async () => { called = true; return { key: 'X-1' }; } }),
    });
    const result = await runTicketCreate(['--project=ENG', '--summary=New'], deps);
    assert.equal(result.ok, true);
    assert.equal(called, true);
  });

  test('--type given on GitHub is accepted but a non-fatal note explains it was ignored', async () => {
    const deps = baseDeps({
      resolveAdapterFn: () => fakeAdapter({ type: 'github', createTicket: async () => ({ key: 'GH-1' }) }),
    });
    const result = await runTicketCreate(['--type=Bug', '--summary=New'], deps);
    assert.equal(result.ok, true);
    assert.match(deps.stream.lines.join(''), /--type is ignored/i);
  });

  test('--type given on Linear is accepted but a non-fatal note explains it was ignored', async () => {
    const deps = baseDeps({
      resolveAdapterFn: () => fakeAdapter({ type: 'linear', createTicket: async () => ({ key: 'ENG-1' }) }),
    });
    const result = await runTicketCreate(['--project=ENG', '--type=Bug', '--summary=New'], deps);
    assert.equal(result.ok, true);
    assert.match(deps.stream.lines.join(''), /--type is ignored/i);
  });

  test('--type given on Jira prints no "ignored" note — it is actually used', async () => {
    const deps = baseDeps({
      resolveAdapterFn: () => fakeAdapter({ createTicket: async () => ({ key: 'PROJ-1' }) }),
    });
    const result = await runTicketCreate(['--project=PROJ', '--type=Task', '--summary=New'], deps);
    assert.equal(result.ok, true);
    assert.doesNotMatch(deps.stream.lines.join(''), /--type is ignored/i);
  });
});

describe('runTicketCreate — connection resolution', () => {
  test('no configured connection reports a create-specific error (no ticket key to reference) and does not call the adapter', async () => {
    let adapterResolved = false;
    const deps = baseDeps({
      resolveConnectionFn: () => ({ baseUrl: null }),
      resolveAdapterFn: () => { adapterResolved = true; return fakeAdapter(); },
    });
    const result = await runTicketCreate(['--project=PROJ', '--type=Task', '--summary=New'], deps);
    assert.equal(result.ok, false);
    assert.equal(adapterResolved, false);
    assert.match(deps.stream.lines.join(''), /No connection configured\. Run/);
    assert.doesNotMatch(deps.stream.lines.join(''), /for undefined/);
  });
});

describe('runTicketCreate — cooldown', () => {
  test('active cooldown skips execution', async () => {
    let called = false;
    const deps = baseDeps({
      checkCooldownFn: () => ({ active: true, remainingMs: 3000 }),
      resolveAdapterFn: () => fakeAdapter({ createTicket: async () => { called = true; return { key: 'X-1' }; } }),
    });
    const result = await runTicketCreate(['--project=PROJ', '--type=Task', '--summary=New'], deps);
    assert.equal(result.ok, false);
    assert.equal(called, false);
  });

  test('cooldown key is derived from project/type/summary, not a ticket key — guards against a flaky retry double-creating', async () => {
    let cooldownKey;
    const deps = baseDeps({
      checkCooldownFn: (key) => { cooldownKey = key; return { active: false, remainingMs: 0 }; },
    });
    await runTicketCreate(['--project=PROJ', '--type=Task', '--summary=New issue'], deps);
    assert.match(cooldownKey, /PROJ/);
    assert.match(cooldownKey, /Task/);
    assert.match(cooldownKey, /New issue/);
  });

  test('two field tuples that would collide under naive colon-joining produce different cooldown keys', async () => {
    const keys = [];
    const deps = baseDeps({
      checkCooldownFn: (key) => { keys.push(key); return { active: false, remainingMs: 0 }; },
    });
    await runTicketCreate(['--project=A:B', '--type=C', '--summary=D'], deps);
    await runTicketCreate(['--project=A', '--type=B:C', '--summary=D'], deps);
    assert.notEqual(keys[0], keys[1], 'project="A:B",type="C" must not collide with project="A",type="B:C"');
  });
});

describe('runTicketCreate — happy path', () => {
  test('parses project/type/summary/description and passes them through to createTicket', async () => {
    let captured;
    const deps = baseDeps({
      resolveAdapterFn: () => fakeAdapter({
        createTicket: async (fields) => { captured = fields; return { key: 'PROJ-99', id: '99', url: 'https://example/PROJ-99' }; },
      }),
    });
    const result = await runTicketCreate(['--project=PROJ', '--type=Task', '--summary=New title', '--description=Body text'], deps);
    assert.equal(result.ok, true);
    assert.equal(result.key, 'PROJ-99');
    assert.deepEqual(captured, { project: 'PROJ', type: 'Task', summary: 'New title', description: 'Body text' });
  });

  test('records cooldown and logs the audit entry keyed on the newly created ticket, never the full description text', async () => {
    let recorded, logged;
    const deps = baseDeps({
      recordActionFn: (key, action) => { recorded = { key, action }; },
      logActionFn: (entry) => { logged = entry; },
      resolveAdapterFn: () => fakeAdapter({
        createTicket: async () => ({ key: 'PROJ-99', id: '99', url: 'https://example/PROJ-99' }),
      }),
    });
    const result = await runTicketCreate(['--project=PROJ', '--type=Task', '--summary=New title', '--description=a very long secret-ish body'], deps);
    assert.equal(result.ok, true);
    assert.equal(recorded.action, 'create');
    assert.equal(logged.ticketKey, 'PROJ-99');
    assert.equal(logged.action, 'create');
    assert.equal(logged.tracker, 'jira');
    assert.deepEqual(logged.detail, { project: 'PROJ', type: 'Task' });
    assert.ok(!JSON.stringify(logged).includes('secret-ish'), 'full description text must never reach the audit log');
  });

  test('reports success with the new key in the message', async () => {
    const deps = baseDeps({
      resolveAdapterFn: () => fakeAdapter({ createTicket: async () => ({ key: 'PROJ-99', id: '99', url: 'https://example/PROJ-99' }) }),
    });
    const result = await runTicketCreate(['--project=PROJ', '--type=Task', '--summary=New'], deps);
    assert.equal(result.ok, true);
    assert.match(deps.stream.lines.join(''), /PROJ-99/);
    assert.match(deps.stream.lines.join(''), /https:\/\/example\/PROJ-99/);
  });

  test('styles the success line with a green checkmark and bold brand key in a TTY', async () => {
    const ttyStream = makeTtyStream();
    const deps = baseDeps({
      stream: ttyStream,
      resolveAdapterFn: () => fakeAdapter({ createTicket: async () => ({ key: 'PROJ-99', id: '99', url: 'https://example/PROJ-99' }) }),
    });
    await runTicketCreate(['--project=PROJ', '--type=Task', '--summary=New'], deps);
    const output = ttyStream.lines.join('');
    assert.match(output, /\x1b\[38;5;71m✔\x1b\[39m/, 'expected a green checkmark');
    assert.match(output, /\x1b\[1mPROJ-99\x1b\[22m/, 'expected the new ticket key bolded');
  });

  test('output is plain (no ANSI codes) when the stream is not a TTY', async () => {
    const deps = baseDeps({
      resolveAdapterFn: () => fakeAdapter({ createTicket: async () => ({ key: 'PROJ-99', id: '99', url: 'https://example/PROJ-99' }) }),
    });
    await runTicketCreate(['--project=PROJ', '--type=Task', '--summary=New'], deps);
    assert.doesNotMatch(deps.stream.lines.join(''), /\x1b\[/, 'MCP/non-TTY callers must never receive raw ANSI escape codes');
  });
});

describe('runTicketCreate — attachments', () => {
  test('uploads --attach paths AFTER the ticket is created, using the new key', async () => {
    let attachArgs;
    const calls = [];
    const deps = baseDeps({
      resolveAdapterFn: () => fakeAdapter({
        createTicket: async () => { calls.push('create'); return { key: 'PROJ-99', id: '99', url: 'https://example/PROJ-99' }; },
        attachFiles: async (key, paths) => { calls.push('attach'); attachArgs = { key, paths }; return { uploaded: [{ filename: 'shot.png', size: 10, url: 'https://x/1', inlineMarkup: null }], errors: [], droppedCount: 0 }; },
      }),
    });
    const result = await runTicketCreate(['--project=PROJ', '--type=Task', '--summary=New', '--attach=/tmp/shot.png'], deps);
    assert.equal(result.ok, true);
    assert.deepEqual(calls, ['create', 'attach']);
    assert.deepEqual(attachArgs, { key: 'PROJ-99', paths: ['/tmp/shot.png'] });
    assert.match(deps.stream.lines.join(''), /Attached shot\.png/);
  });

  test('never calls attachFiles on GitHub — warns and still reports the created ticket', async () => {
    let attachCalled = false;
    const deps = baseDeps({
      resolveAdapterFn: () => fakeAdapter({
        type: 'github',
        createTicket: async () => ({ key: 'GH-5', id: '5', url: 'https://github.com/x/y/issues/5' }),
        attachFiles: async () => { attachCalled = true; return { uploaded: [], errors: [], droppedCount: 0 }; },
      }),
    });
    const result = await runTicketCreate(['--summary=New', '--attach=/a.png'], deps);
    assert.equal(result.ok, true);
    assert.equal(attachCalled, false);
    assert.match(deps.stream.lines.join(''), /GitHub does not support file attachments/i);
  });

  test('an attach failure never flips a successful create to ok:false — the ticket already exists', async () => {
    const deps = baseDeps({
      resolveAdapterFn: () => fakeAdapter({
        createTicket: async () => ({ key: 'PROJ-99', id: '99', url: 'https://example/PROJ-99' }),
        attachFiles: async () => ({ uploaded: [], errors: [{ path: '/missing.png', message: 'not-found' }], droppedCount: 0 }),
      }),
    });
    const result = await runTicketCreate(['--project=PROJ', '--type=Task', '--summary=New', '--attach=/missing.png'], deps);
    assert.equal(result.ok, true);
    assert.equal(result.key, 'PROJ-99');
    assert.match(deps.stream.lines.join(''), /Failed to attach \/missing\.png: not-found/);
  });

  test('an unexpected exception from attachFiles itself never flips a successful create to ok:false', async () => {
    const deps = baseDeps({
      resolveAdapterFn: () => fakeAdapter({
        createTicket: async () => ({ key: 'PROJ-99', id: '99', url: 'https://example/PROJ-99' }),
        attachFiles: async () => { throw new Error('unexpected'); },
      }),
    });
    const result = await runTicketCreate(['--project=PROJ', '--type=Task', '--summary=New', '--attach=/a.png'], deps);
    assert.equal(result.ok, true);
    assert.equal(result.key, 'PROJ-99');
    assert.match(deps.stream.lines.join(''), /Warning: PROJ-99 was created but attaching files failed: unexpected/);
  });

  test('on Linear, an uploaded image with inlineMarkup is folded into the description via a follow-up updateFields — otherwise the asset is orphaned', async () => {
    let updateFieldsArgs;
    const deps = baseDeps({
      resolveAdapterFn: () => fakeAdapter({
        type: 'linear',
        createTicket: async () => ({ key: 'ENG-1', id: '1', url: 'https://linear.app/x/issue/ENG-1' }),
        attachFiles: async () => ({ uploaded: [{ filename: 'shot.png', size: 10, url: 'https://x/shot.png', inlineMarkup: '![shot.png](https://x/shot.png)', adfMediaNode: null }], errors: [], droppedCount: 0 }),
        updateFields: async (key, fields) => { updateFieldsArgs = { key, fields }; return { applied: { description: true }, errors: {} }; },
      }),
    });
    const result = await runTicketCreate(['--project=ENG', '--summary=New', '--description=Body text', '--attach=/tmp/shot.png'], deps);
    assert.equal(result.ok, true);
    assert.deepEqual(updateFieldsArgs, { key: 'ENG-1', fields: { description: 'Body text\n\n![shot.png](https://x/shot.png)' } });
  });

  test('on Linear, the follow-up description link uses the markup alone when no description was given', async () => {
    let updateFieldsArgs;
    const deps = baseDeps({
      resolveAdapterFn: () => fakeAdapter({
        type: 'linear',
        createTicket: async () => ({ key: 'ENG-1', id: '1', url: '' }),
        attachFiles: async () => ({ uploaded: [{ filename: 'shot.png', size: 10, url: 'https://x/shot.png', inlineMarkup: '![shot.png](https://x/shot.png)', adfMediaNode: null }], errors: [], droppedCount: 0 }),
        updateFields: async (key, fields) => { updateFieldsArgs = { key, fields }; return { applied: {}, errors: {} }; },
      }),
    });
    await runTicketCreate(['--project=ENG', '--summary=New', '--attach=/tmp/shot.png'], deps);
    assert.deepEqual(updateFieldsArgs.fields, { description: '![shot.png](https://x/shot.png)' });
  });

  test('on Linear, a failed description-link is reported as an attach error but never flips create to ok:false — the asset genuinely uploaded, just not linked', async () => {
    const deps = baseDeps({
      resolveAdapterFn: () => fakeAdapter({
        type: 'linear',
        createTicket: async () => ({ key: 'ENG-1', id: '1', url: '' }),
        attachFiles: async () => ({ uploaded: [{ filename: 'shot.png', size: 10, url: 'https://x/shot.png', inlineMarkup: '![shot.png](https://x/shot.png)', adfMediaNode: null }], errors: [], droppedCount: 0 }),
        updateFields: async () => { throw new Error('permission denied'); },
      }),
    });
    const result = await runTicketCreate(['--project=ENG', '--summary=New', '--attach=/tmp/shot.png'], deps);
    assert.equal(result.ok, true);
    assert.match(deps.stream.lines.join(''), /uploaded but failed to link into the ticket description: permission denied/);
  });

  test('on Jira, updateFields is never called for attachments — the classic attachment is real regardless of description text', async () => {
    let updateFieldsCalled = false;
    const deps = baseDeps({
      resolveAdapterFn: () => fakeAdapter({
        createTicket: async () => ({ key: 'PROJ-99', id: '99', url: '' }),
        attachFiles: async () => ({ uploaded: [{ filename: 'shot.png', size: 10, url: 'https://x/1', inlineMarkup: null, adfMediaNode: { type: 'mediaSingle' } }], errors: [], droppedCount: 0 }),
        updateFields: async () => { updateFieldsCalled = true; return { applied: {}, errors: {} }; },
      }),
    });
    await runTicketCreate(['--project=PROJ', '--type=Task', '--summary=New', '--attach=/tmp/shot.png'], deps);
    assert.equal(updateFieldsCalled, false);
  });

  test('records the full attempted attach path plus the filename that actually landed, in the audit log detail', async () => {
    let logged;
    const deps = baseDeps({
      logActionFn: (entry) => { logged = entry; },
      resolveAdapterFn: () => fakeAdapter({
        createTicket: async () => ({ key: 'PROJ-99', id: '99', url: '' }),
        attachFiles: async () => ({ uploaded: [{ filename: 'shot.png', size: 10, url: 'https://x/1', inlineMarkup: null, adfMediaNode: null }], errors: [], droppedCount: 0 }),
      }),
    });
    await runTicketCreate(['--project=PROJ', '--type=Task', '--summary=New', '--attach=/Users/x/shot.png'], deps);
    assert.deepEqual(logged.detail.attachPaths, ['/Users/x/shot.png']);
    assert.deepEqual(logged.detail.attachedFilenames, ['shot.png']);
  });

  test('no --attach flag never calls attachFiles', async () => {
    let called = false;
    const deps = baseDeps({
      resolveAdapterFn: () => fakeAdapter({ attachFiles: async () => { called = true; return { uploaded: [], errors: [], droppedCount: 0 }; } }),
    });
    await runTicketCreate(['--project=PROJ', '--type=Task', '--summary=New'], deps);
    assert.equal(called, false);
  });
});

describe('runTicketCreate — write failure', () => {
  test('a thrown error is classified and reported with a create-specific message, cooldown/log never recorded', async () => {
    let recorded = false, logged = false;
    const deps = baseDeps({
      recordActionFn: () => { recorded = true; },
      logActionFn: () => { logged = true; },
      resolveAdapterFn: () => fakeAdapter({ createTicket: async () => { throw new Error('network down'); } }),
    });
    const result = await runTicketCreate(['--project=PROJ', '--type=Task', '--summary=New'], deps);
    assert.equal(result.ok, false);
    assert.equal(recorded, false);
    assert.equal(logged, false);
    assert.match(deps.stream.lines.join(''), /Network error or timeout/);
    assert.doesNotMatch(deps.stream.lines.join(''), /undefined/);
  });
});

describe('runTicketCreate — post-success bookkeeping failure', () => {
  test('a real, already-created ticket is still reported ok:true with its key when recordActionFn throws — never mistaken for a failed write', async () => {
    let createCalls = 0;
    const deps = baseDeps({
      recordActionFn: () => { throw new Error('disk full'); },
      resolveAdapterFn: () => fakeAdapter({ createTicket: async () => { createCalls++; return { key: 'PROJ-99', id: '99', url: 'https://example/PROJ-99' }; } }),
    });
    const result = await runTicketCreate(['--project=PROJ', '--type=Task', '--summary=New'], deps);
    assert.equal(result.ok, true, 'a real external write must never be reported as failed');
    assert.equal(result.key, 'PROJ-99');
    assert.equal(createCalls, 1, 'must not retry createTicket after a bookkeeping failure');
    assert.match(deps.stream.lines.join(''), /PROJ-99/, 'the real ticket key must still be surfaced to the caller');
    assert.match(deps.stream.lines.join(''), /Warning/i);
    assert.doesNotMatch(deps.stream.lines.join(''), /Network error or timeout/, 'must never be misreported as a network/timeout failure');
  });

  test('a real, already-created ticket is still reported ok:true with its key when logActionFn throws (e.g. TICKET_KEY_PATTERN rejects an odd tracker-returned key)', async () => {
    const deps = baseDeps({
      logActionFn: () => { throw new Error('Refusing to log malformed ticket key: "G-42"'); },
      resolveAdapterFn: () => fakeAdapter({ createTicket: async () => ({ key: 'PROJ-99', id: '99', url: 'https://example/PROJ-99' }) }),
    });
    const result = await runTicketCreate(['--project=PROJ', '--type=Task', '--summary=New'], deps);
    assert.equal(result.ok, true);
    assert.equal(result.key, 'PROJ-99');
    assert.match(deps.stream.lines.join(''), /PROJ-99/);
    assert.match(deps.stream.lines.join(''), /Warning/i);
  });

  test('recordActionFn still runs (and its cooldown effect still applies) even when logActionFn throws afterward', async () => {
    let recordedKey;
    const deps = baseDeps({
      recordActionFn: (key) => { recordedKey = key; },
      logActionFn: () => { throw new Error('boom'); },
      resolveAdapterFn: () => fakeAdapter({ createTicket: async () => ({ key: 'PROJ-99' }) }),
    });
    await runTicketCreate(['--project=PROJ', '--type=Task', '--summary=New'], deps);
    assert.match(recordedKey, /PROJ/);
  });
});

describe('runTicketCreate — cache-refresh enrichment on project/issuetype failure', () => {
  test('a non-project/type failure (e.g. rate-limited) is byte-identical to before this feature — enrichment never engages', async () => {
    let projectsCalled = false;
    const err = Object.assign(new Error('x'), { rateLimit: { kind: 'secondary-rate-limit', retryAfterSeconds: 30 } });
    const deps = baseDeps({
      resolveAdapterFn: () => fakeAdapter({
        createTicket: async () => { throw err; },
        listCreatableProjects: async () => { projectsCalled = true; return []; },
      }),
    });
    const result = await runTicketCreate(['--project=PROJ', '--type=Task', '--summary=New'], deps);
    assert.equal(result.ok, false);
    assert.equal(projectsCalled, false, 'enrichment must never engage for a non-project/type error shape');
    assert.equal(deps.stream.lines.join(''), '  Rate limited by the tracker — retry creating the ticket after ~30s.\n');
  });

  test('a Jira project error (err.details.errors.project) with a cache miss fetches fresh, writes the cache, and appends known projects to the message', async () => {
    let writtenProfile, writtenData;
    const jiraErr = Object.assign(new Error('Jira API error 400 creating an issue in BADPROJ'), {
      status: 400,
      details: { errorMessages: ["The target project doesn't exist or you don't have permission to create issues in it."], errors: { project: "The target project doesn't exist or you don't have permission to create issues in it." } },
    });
    const deps = baseDeps({
      readMetadataCacheFn: () => null,
      writeMetadataCacheFn: (profile, data) => { writtenProfile = profile; writtenData = data; },
      resolveConnectionFn: () => ({ baseUrl: 'https://jira.example.com', profileName: 'work' }),
      resolveAdapterFn: () => fakeAdapter({
        createTicket: async () => { throw jiraErr; },
        listCreatableProjects: async () => ([{ key: 'CNV1', name: 'Corenexus v1.0' }]),
      }),
    });
    const result = await runTicketCreate(['--project=BADPROJ', '--type=Task', '--summary=New'], deps);
    assert.equal(result.ok, false);
    assert.equal(writtenProfile, 'work');
    assert.deepEqual(writtenData.projects, [{ key: 'CNV1', name: 'Corenexus v1.0' }]);
    assert.match(deps.stream.lines.join(''), /Known creatable projects: CNV1/);
  });

  test('a cache that has projects but not this project\'s issue types still fetches issue types (incremental merge, not all-or-nothing) — reproduces a real bug caught via live-instance testing', async () => {
    let listIssueTypesCalled = false;
    let writtenData;
    const jiraErr = Object.assign(new Error('x'), { status: 400, details: { errors: { issuetype: 'Specify a valid issue type' } } });
    const deps = baseDeps({
      readMetadataCacheFn: () => ({ projects: [{ key: 'CNV1', name: 'Corenexus v1.0' }], issueTypesByProject: {} }),
      writeMetadataCacheFn: (profile, data) => { writtenData = data; },
      resolveAdapterFn: () => fakeAdapter({
        createTicket: async () => { throw jiraErr; },
        listIssueTypes: async (key) => { listIssueTypesCalled = true; assert.equal(key, 'CNV1'); return [{ id: '1', name: 'Task' }, { id: '2', name: 'Bug' }]; },
      }),
    });
    const result = await runTicketCreate(['--project=CNV1', '--type=BadType', '--summary=New'], deps);
    assert.equal(result.ok, false);
    assert.equal(listIssueTypesCalled, true, 'a cache lacking this project\'s issue types must still fetch them, even though projects were already cached');
    assert.match(deps.stream.lines.join(''), /Known issue types for CNV1: Task, Bug/);
    assert.deepEqual(writtenData.projects, [{ key: 'CNV1', name: 'Corenexus v1.0' }], 'the pre-existing cached projects must be preserved, not dropped, on this incremental merge');
  });

  test('a Jira project error with a fresh cache hit reuses it — never calls listCreatableProjects again', async () => {
    let listCalled = false;
    const jiraErr = Object.assign(new Error('x'), { status: 400, details: { errors: { project: 'bad' } } });
    const deps = baseDeps({
      readMetadataCacheFn: () => ({ projects: [{ key: 'CNV1', name: 'x' }], issueTypesByProject: {} }),
      resolveAdapterFn: () => fakeAdapter({
        createTicket: async () => { throw jiraErr; },
        listCreatableProjects: async () => { listCalled = true; return []; },
      }),
    });
    await runTicketCreate(['--project=BADPROJ', '--type=Task', '--summary=New'], deps);
    assert.equal(listCalled, false, 'a fresh cache hit must never trigger a network call');
    assert.match(deps.stream.lines.join(''), /Known creatable projects: CNV1/);
  });

  test('a Jira issuetype error also fetches and reports known issue types for the given project', async () => {
    const jiraErr = Object.assign(new Error('x'), { status: 400, details: { errors: { issuetype: 'valid issue type is required' } } });
    const deps = baseDeps({
      resolveAdapterFn: () => fakeAdapter({
        createTicket: async () => { throw jiraErr; },
        listCreatableProjects: async () => ([{ key: 'CNV1', name: 'x' }]),
        listIssueTypes: async () => ([{ id: '1', name: 'Task' }, { id: '2', name: 'Bug' }]),
      }),
    });
    const result = await runTicketCreate(['--project=CNV1', '--type=BadType', '--summary=New'], deps);
    assert.equal(result.ok, false);
    assert.match(deps.stream.lines.join(''), /Known issue types for CNV1: Task, Bug/);
  });

  test('a Linear PROJECT_NOT_FOUND error (err.code, not message-sniffed) triggers enrichment with Linear\'s own listCreatableProjects', async () => {
    const linearErr = Object.assign(new Error('Linear team not found for project "BOGUS".'), { code: 'PROJECT_NOT_FOUND' });
    const deps = baseDeps({
      resolveAdapterFn: () => fakeAdapter({
        type: 'linear',
        createTicket: async () => { throw linearErr; },
        listCreatableProjects: async () => ([{ key: 'ENG', name: 'Engineering' }]),
      }),
    });
    const result = await runTicketCreate(['--project=BOGUS', '--summary=New'], deps);
    assert.equal(result.ok, false);
    assert.match(deps.stream.lines.join(''), /Known creatable projects: ENG/);
  });

  test('never attempts enrichment for a GitHub-tracked failure — GitHub never produces this error shape', async () => {
    let listCalled = false;
    const err = Object.assign(new Error('GitHub API error 422'), { status: 422, details: { errors: { project: 'irrelevant — should never be read for github' } } });
    const deps = baseDeps({
      resolveAdapterFn: () => fakeAdapter({
        type: 'github',
        createTicket: async () => { throw err; },
        listCreatableProjects: async () => { listCalled = true; return []; },
      }),
    });
    await runTicketCreate(['--summary=New'], deps);
    assert.equal(listCalled, false);
  });

  test('a refresh failure during enrichment is swallowed — the original error message still surfaces, no crash', async () => {
    const jiraErr = Object.assign(new Error('x'), { status: 400, details: { errors: { project: 'bad' } } });
    const deps = baseDeps({
      resolveAdapterFn: () => fakeAdapter({
        createTicket: async () => { throw jiraErr; },
        listCreatableProjects: async () => { throw new Error('network down during refresh'); },
      }),
    });
    const result = await runTicketCreate(['--project=BADPROJ', '--type=Task', '--summary=New'], deps);
    assert.equal(result.ok, false);
    assert.match(deps.stream.lines.join(''), /Failed to create the ticket/);
    assert.doesNotMatch(deps.stream.lines.join(''), /Known creatable projects/);
  });

  test('--project="__proto__" is stored as a real own key, not redirected into the object\'s prototype chain', async () => {
    let writtenData;
    const jiraErr = Object.assign(new Error('x'), { status: 400, details: { errors: { issuetype: 'invalid' } } });
    const deps = baseDeps({
      writeMetadataCacheFn: (profile, data) => { writtenData = data; },
      resolveAdapterFn: () => fakeAdapter({
        createTicket: async () => { throw jiraErr; },
        listIssueTypes: async () => ([{ id: '1', name: 'Task' }]),
      }),
    });
    await runTicketCreate(['--project=__proto__', '--type=BadType', '--summary=New'], deps);
    assert.ok(
      Object.prototype.hasOwnProperty.call(writtenData.issueTypesByProject, '__proto__'),
      'expected a real own "__proto__" key on a plain {} target, assigning to obj.__proto__ instead reassigns the internal prototype slot and silently drops the entry',
    );
    assert.deepEqual(Object.getOwnPropertyDescriptor(writtenData.issueTypesByProject, '__proto__').value, [{ id: '1', name: 'Task' }]);
  });

  test('a refresh failure never writes a cache entry', async () => {
    let writeCalled = false;
    const jiraErr = Object.assign(new Error('x'), { status: 400, details: { errors: { project: 'bad' } } });
    const deps = baseDeps({
      writeMetadataCacheFn: () => { writeCalled = true; },
      resolveAdapterFn: () => fakeAdapter({
        createTicket: async () => { throw jiraErr; },
        listCreatableProjects: async () => { throw new Error('network down'); },
      }),
    });
    await runTicketCreate(['--project=BADPROJ', '--type=Task', '--summary=New'], deps);
    assert.equal(writeCalled, false);
  });
});
