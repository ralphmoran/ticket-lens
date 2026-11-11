import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { runTicketParent, runTicketParentChildren, MAX_PARENT_CHILDREN } from '../lib/ticket-parent.mjs';

const EPIC = 'PROJ-1';

function makeStream() {
  const lines = [];
  return { write: (s) => lines.push(s), lines, text: () => lines.join('') };
}

const failure = (status, message = `Jira API error ${status}`) => Object.assign(new Error(message), { status });

/**
 * A fake tracker adapter. Writes are remembered, so the read-back after a write
 * sees what was written unless a test overrides setParent to lie about it.
 */
function fakeAdapter({ infos = {}, setParent, support = { supported: true }, type = 'jira', omitSetParent = false } = {}) {
  const calls = [];
  const parents = {};
  const adapter = {
    type,
    calls,
    checkParentSupport: async () => support,
    getParentInfo: async (key) => {
      const info = infos[key];
      if (info instanceof Error) throw info;
      return { key, type: 'Story', isSubtask: false, ...info, parentKey: parents[key] ?? info?.parentKey ?? null };
    },
    setParent: async (child, parent) => {
      calls.push({ child, parent });
      const result = setParent ? await setParent(child, parent) : { executed: true };
      if (!setParent) parents[child] = parent;
      return result;
    },
  };
  if (omitSetParent) delete adapter.setParent;
  return adapter;
}

function baseDeps(overrides = {}) {
  const adapter = overrides.adapter ?? fakeAdapter();
  const { adapter: _ignored, ...rest } = overrides;
  const audits = [];
  return {
    configDir: '/fake/config',
    stream: makeStream(),
    confirm: true,
    isLicensedFn: () => true,
    resolveConnectionFn: () => ({ baseUrl: 'https://jira.example.com' }),
    resolveAdapterFn: () => adapter,
    logActionFn: (entry) => { audits.push(entry); },
    actor: 'ralph',
    ...rest,
    _adapter: adapter,
    _audits: audits,
  };
}

const CHILDREN = ['PROJ-2', 'PROJ-3'];

describe('runTicketParentChildren — license gate', () => {
  test('unlicensed: never resolves a connection, never writes', async () => {
    let resolveCalls = 0;
    const deps = baseDeps({ isLicensedFn: () => false, resolveConnectionFn: () => { resolveCalls++; return { baseUrl: 'x' }; } });
    const result = await runTicketParentChildren(EPIC, CHILDREN, deps);
    assert.equal(result.ok, false);
    assert.equal(resolveCalls, 0);
    assert.equal(deps._adapter.calls.length, 0);
  });
});

describe('runTicketParentChildren — input validation (nothing is written when anything is invalid)', () => {
  for (const [label, epic, children, pattern] of [
    ['undefined children', EPIC, undefined, /at least one child/i],
    ['a string instead of an array', EPIC, 'PROJ-2', /at least one child/i],
    ['an empty array', EPIC, [], /at least one child/i],
    ['more children than the per-call maximum', EPIC, Array.from({ length: MAX_PARENT_CHILDREN + 1 }, (_, i) => `PROJ-${i + 2}`), /at most 50/i],
    ['a missing epic', undefined, CHILDREN, /Epic.*not a valid ticket key/i],
    ['a malformed epic key', 'not-a-key', CHILDREN, /Epic.*not a valid ticket key/i],
    ['a malformed child key', EPIC, ['nope'], /Child 1.*not a valid ticket key/i],
    ['a child key with a path-traversal payload', EPIC, ['PROJ-2/../../x'], /Child 1.*not a valid ticket key/i],
    ['a child key with an embedded newline', EPIC, ['PROJ-2\nPROJ-3'], /Child 1.*not a valid ticket key/i],
    ['a numeric child', EPIC, [42], /Child 1.*string/i],
    ['a null child', EPIC, [null], /Child 1.*string/i],
    ['a child with a leading zero', EPIC, ['PROJ-02'], /Child 1.*leading zero/i],
    ['the epic listed as its own child', EPIC, ['PROJ-2', EPIC], /Child 2.*is the epic itself/i],
    ['the epic listed as a child in another case', EPIC, ['proj-1'], /Child 1.*is the epic itself/i],
    ['the same child twice', EPIC, ['PROJ-2', 'PROJ-3', 'PROJ-2'], /Child 3.*more than once/i],
    ['the same child twice in different case', EPIC, ['PROJ-2', 'proj-2'], /Child 2.*more than once/i],
  ]) {
    test(`${label} is refused and nothing is written`, async () => {
      const deps = baseDeps();
      const result = await runTicketParentChildren(epic, children, deps);
      assert.equal(result.ok, false);
      assert.match(deps.stream.text(), pattern);
      assert.equal(deps._adapter.calls.length, 0);
    });
  }

  test('exactly 50 children are accepted', async () => {
    const deps = baseDeps();
    const children = Array.from({ length: MAX_PARENT_CHILDREN }, (_, i) => `PROJ-${i + 2}`);
    const result = await runTicketParentChildren(EPIC, children, deps);
    assert.equal(result.ok, true);
    assert.equal(deps._adapter.calls.length, MAX_PARENT_CHILDREN);
  });

  test('every problem is reported in one pass, not just the first', async () => {
    const deps = baseDeps();
    await runTicketParentChildren(EPIC, ['bad', 'PROJ-2', 'PROJ-2'], deps);
    assert.match(deps.stream.text(), /Child 1/);
    assert.match(deps.stream.text(), /Child 3/);
  });
});

describe('runTicketParentChildren — tracker capability', () => {
  test('a tracker with no setParent (GitHub) is refused, naming the tracker, with no reads or writes', async () => {
    const deps = baseDeps({ adapter: fakeAdapter({ type: 'github', omitSetParent: true }) });
    const result = await runTicketParentChildren(EPIC, CHILDREN, deps);
    assert.equal(result.ok, false);
    assert.match(deps.stream.text(), /not supported on github/i);
  });

  test('a tracker that reports parent unsupported is refused with its reason', async () => {
    const deps = baseDeps({ adapter: fakeAdapter({ support: { supported: false, reason: 'this Jira has no "Epic Link" field' } }) });
    const result = await runTicketParentChildren(EPIC, CHILDREN, deps);
    assert.equal(result.ok, false);
    assert.match(deps.stream.text(), /Epic Link/);
    assert.equal(deps._adapter.calls.length, 0);
  });

  test('a missing connection stops everything', async () => {
    const deps = baseDeps({ resolveConnectionFn: () => ({}) });
    const result = await runTicketParentChildren(EPIC, CHILDREN, deps);
    assert.equal(result.ok, false);
    assert.match(deps.stream.text(), /No connection configured/);
  });
});

describe('runTicketParentChildren — checks before any write', () => {
  test('a sub-task child blocks the whole call and is named', async () => {
    const adapter = fakeAdapter({ infos: { 'PROJ-3': { type: 'Sub-task', isSubtask: true } } });
    const deps = baseDeps({ adapter });
    const result = await runTicketParentChildren(EPIC, CHILDREN, deps);
    assert.equal(result.ok, false);
    assert.match(deps.stream.text(), /PROJ-3.*sub-task/i);
    assert.equal(adapter.calls.length, 0, 'the valid child PROJ-2 must not be written either');
  });

  test('every sub-task is listed, not just the first', async () => {
    const adapter = fakeAdapter({ infos: { 'PROJ-2': { isSubtask: true }, 'PROJ-3': { isSubtask: true } } });
    const deps = baseDeps({ adapter });
    await runTicketParentChildren(EPIC, CHILDREN, deps);
    assert.match(deps.stream.text(), /PROJ-2.*sub-task/i);
    assert.match(deps.stream.text(), /PROJ-3.*sub-task/i);
  });

  test('a child that cannot be read blocks the call and is named with its reason', async () => {
    const adapter = fakeAdapter({ infos: { 'PROJ-3': failure(404, 'Jira API error 404 fetching PROJ-3') } });
    const deps = baseDeps({ adapter });
    const result = await runTicketParentChildren(EPIC, CHILDREN, deps);
    assert.equal(result.ok, false);
    assert.match(deps.stream.text(), /PROJ-3 could not be read.*404/);
    assert.equal(adapter.calls.length, 0);
  });

  test('an epic that cannot be read blocks the call', async () => {
    const adapter = fakeAdapter({ infos: { [EPIC]: failure(404, 'Jira API error 404 fetching PROJ-1') } });
    const deps = baseDeps({ adapter });
    const result = await runTicketParentChildren(EPIC, CHILDREN, deps);
    assert.equal(result.ok, false);
    assert.match(deps.stream.text(), /Epic PROJ-1 could not be read/);
    assert.equal(adapter.calls.length, 0);
  });

  test('terminal control characters in a tracker error never reach the output', async () => {
    const adapter = fakeAdapter({ infos: { 'PROJ-2': failure(500, 'boom \u001b]52;c;ZXZpbA==\u0007 \u001b[2Jend') } });
    const deps = baseDeps({ adapter });
    await runTicketParentChildren(EPIC, CHILDREN, deps);
    assert.doesNotMatch(deps.stream.text(), /\u001b/);
  });
});

describe('runTicketParentChildren — preview (no confirm)', () => {
  const infos = { 'PROJ-2': { type: 'Bug', parentKey: null }, 'PROJ-3': { type: 'Story', parentKey: 'PROJ-9' } };

  test('writes nothing, lists every child with its current parent, and asks for confirmation', async () => {
    const adapter = fakeAdapter({ infos });
    const deps = baseDeps({ adapter, confirm: false });
    const result = await runTicketParentChildren(EPIC, CHILDREN, deps);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'confirm-required');
    assert.equal(adapter.calls.length, 0);
    const text = deps.stream.text();
    assert.match(text, /Would set PROJ-1 as the parent of 2 tickets/);
    assert.match(text, /PROJ-2.*Bug.*no parent/);
    assert.match(text, /PROJ-3.*Story.*currently under PROJ-9/);
  });

  test('CLI callers are told --confirm, MCP callers confirm: true', async () => {
    const cli = baseDeps({ adapter: fakeAdapter({ infos }), confirm: false, cliHints: true });
    await runTicketParentChildren(EPIC, CHILDREN, cli);
    assert.match(cli.stream.text(), /--confirm/);
    const mcp = baseDeps({ adapter: fakeAdapter({ infos }), confirm: false, cliHints: false });
    await runTicketParentChildren(EPIC, CHILDREN, mcp);
    assert.match(mcp.stream.text(), /confirm: true/);
    assert.doesNotMatch(mcp.stream.text(), /--confirm/);
  });

  for (const bad of ['true', 'yes', 1, {}, [], null, undefined]) {
    test(`confirm=${JSON.stringify(bad)} is not confirmation — only the boolean true is`, async () => {
      const adapter = fakeAdapter();
      const deps = baseDeps({ adapter, confirm: bad });
      const result = await runTicketParentChildren(EPIC, CHILDREN, deps);
      assert.equal(result.reason, 'confirm-required');
      assert.equal(adapter.calls.length, 0);
    });
  }

  test('a tracker-supplied type name is stripped of control characters in the preview', async () => {
    const adapter = fakeAdapter({ infos: { 'PROJ-2': { type: 'Bug\u001b[2J\u0007' } } });
    const deps = baseDeps({ adapter, confirm: false });
    await runTicketParentChildren(EPIC, CHILDREN, deps);
    assert.doesNotMatch(deps.stream.text(), /\u001b|\u0007/);
  });

  test('children already under the epic are shown as skipped', async () => {
    const adapter = fakeAdapter({ infos: { 'PROJ-2': { parentKey: EPIC } } });
    const deps = baseDeps({ adapter, confirm: false });
    await runTicketParentChildren(EPIC, CHILDREN, deps);
    assert.match(deps.stream.text(), /PROJ-2.*already under PROJ-1/);
  });

  test('when every child is already under the epic there is nothing to do, even without confirm', async () => {
    const adapter = fakeAdapter({ infos: { 'PROJ-2': { parentKey: EPIC }, 'PROJ-3': { parentKey: EPIC } } });
    const deps = baseDeps({ adapter, confirm: false });
    const result = await runTicketParentChildren(EPIC, CHILDREN, deps);
    assert.equal(result.ok, true);
    assert.match(deps.stream.text(), /Nothing to change/);
    assert.equal(adapter.calls.length, 0);
  });
});

describe('runTicketParentChildren — writing', () => {
  test('sets the epic on every child, in order, and audits each one', async () => {
    const deps = baseDeps();
    const result = await runTicketParentChildren(EPIC, CHILDREN, deps);
    assert.equal(result.ok, true);
    assert.deepEqual(deps._adapter.calls, [{ child: 'PROJ-2', parent: EPIC }, { child: 'PROJ-3', parent: EPIC }]);
    assert.deepEqual(deps._audits.map((a) => [a.ticketKey, a.action, a.tracker, a.actor, a.detail]), [
      ['PROJ-2', 'parent', 'jira', 'ralph', { parentKey: EPIC, previousParentKey: null, source: 'cli' }],
      ['PROJ-3', 'parent', 'jira', 'ralph', { parentKey: EPIC, previousParentKey: null, source: 'cli' }],
    ]);
    assert.match(deps.stream.text(), /Set the parent on 2 of 2/);
  });

  test('keys are normalized: lower-case input is written upper-case', async () => {
    const deps = baseDeps();
    await runTicketParentChildren('proj-1', ['proj-2'], deps);
    assert.deepEqual(deps._adapter.calls, [{ child: 'PROJ-2', parent: 'PROJ-1' }]);
  });

  test('a child already under the epic is not written again', async () => {
    const adapter = fakeAdapter({ infos: { 'PROJ-2': { parentKey: EPIC } } });
    const deps = baseDeps({ adapter });
    const result = await runTicketParentChildren(EPIC, CHILDREN, deps);
    assert.equal(result.ok, true);
    assert.deepEqual(adapter.calls.map((c) => c.child), ['PROJ-3']);
    assert.equal(result.results.find((r) => r.ticket === 'PROJ-2').status, 'already');
  });

  test('a child under a different epic is moved', async () => {
    const adapter = fakeAdapter({ infos: { 'PROJ-2': { parentKey: 'PROJ-9' } } });
    const deps = baseDeps({ adapter });
    await runTicketParentChildren(EPIC, CHILDREN, deps);
    assert.deepEqual(adapter.calls.map((c) => c.child), ['PROJ-2', 'PROJ-3']);
  });

  test('one failing child does not stop the rest; it is reported and listed for retry', async () => {
    let n = 0;
    const adapter = fakeAdapter({ setParent: async (child, parent) => { if (child === 'PROJ-2') throw failure(400, 'bad hierarchy'); n++; return { executed: true }; } });
    const deps = baseDeps({ adapter });
    const result = await runTicketParentChildren(EPIC, ['PROJ-2', 'PROJ-3', 'PROJ-4'], deps);
    assert.equal(result.ok, false);
    assert.equal(n, 2, 'PROJ-3 and PROJ-4 still attempted');
    assert.match(deps.stream.text(), /PROJ-2.*bad hierarchy/);
    assert.match(deps.stream.text(), /Retry only: PROJ-2/);
    assert.equal(deps._audits.length, 2, 'only the written children are audited');
  });

  test('a refusal from the adapter (executed:false) is a failure with its reason', async () => {
    const adapter = fakeAdapter({ setParent: async () => ({ executed: false, reason: 'no-epic-link-field' }) });
    const deps = baseDeps({ adapter });
    const result = await runTicketParentChildren(EPIC, CHILDREN, deps);
    assert.equal(result.ok, false);
    assert.match(deps.stream.text(), /no-epic-link-field/);
    assert.equal(deps._audits.length, 0);
  });

  for (const [label, status, pattern] of [['a rate limit (429)', 429, /rate limit/i], ['an authentication failure (401)', 401, /authentication failure/i]]) {
    test(`${label} stops the batch; untouched children are named, not attempted`, async () => {
      const attempted = [];
      const adapter = fakeAdapter({ setParent: async (child) => { attempted.push(child); throw failure(status); } });
      const deps = baseDeps({ adapter });
      const result = await runTicketParentChildren(EPIC, ['PROJ-2', 'PROJ-3', 'PROJ-4'], deps);
      assert.equal(result.ok, false);
      assert.deepEqual(attempted, ['PROJ-2']);
      assert.match(deps.stream.text(), /PROJ-3 not attempted.*batch stopped/);
      assert.match(deps.stream.text(), pattern);
      assert.match(deps.stream.text(), /Retry only: PROJ-2, PROJ-3, PROJ-4/);
    });
  }

  test('a failing audit write never turns a landed write into a failure', async () => {
    const deps = baseDeps({ logActionFn: () => { throw new Error('disk full'); } });
    const result = await runTicketParentChildren(EPIC, CHILDREN, deps);
    assert.equal(result.ok, true);
    assert.match(deps.stream.text(), /PROJ-2.*audit record failed.*disk full/);
  });

  test('a write that the tracker does not show afterwards is flagged, not reported as success', async () => {
    const adapter = fakeAdapter({ setParent: async () => ({ executed: true }) });
    const deps = baseDeps({ adapter });
    const result = await runTicketParentChildren(EPIC, ['PROJ-2'], deps);
    assert.equal(result.ok, false);
    assert.equal(result.results[0].status, 'unverified');
    assert.match(deps.stream.text(), /PROJ-2.*tracker shows no parent/i);
  });

  test('a failing read-back is reported as unverified, never as a failed write', async () => {
    let reads = 0;
    const adapter = fakeAdapter();
    const original = adapter.getParentInfo;
    adapter.getParentInfo = async (key) => { if (key === 'PROJ-2' && ++reads > 1) throw failure(500); return original(key); };
    const deps = baseDeps({ adapter });
    const result = await runTicketParentChildren(EPIC, ['PROJ-2'], deps);
    assert.equal(result.results[0].status, 'unverified');
    assert.equal(deps._audits.length, 1, 'the write landed, so it is audited');
  });

  test('tracker error text is stripped of control characters', async () => {
    const adapter = fakeAdapter({ setParent: async () => { throw failure(400, 'nope \u001b]52;c;ZXZpbA==\u0007'); } });
    const deps = baseDeps({ adapter });
    await runTicketParentChildren(EPIC, ['PROJ-2'], deps);
    assert.doesNotMatch(deps.stream.text(), /\u001b|\u0007/);
  });
});

describe('runTicketParentChildren — review hardening', () => {
  test('the audit entry records the previous parent and, for MCP callers, the source', async () => {
    const adapter = fakeAdapter({ infos: { 'PROJ-2': { parentKey: 'PROJ-9' } } });
    const deps = baseDeps({ adapter, cliHints: false });
    await runTicketParentChildren(EPIC, ['PROJ-2'], deps);
    assert.deepEqual(deps._audits[0].detail, { parentKey: EPIC, previousParentKey: 'PROJ-9', source: 'mcp' });
  });

  test('a newline in a tracker error cannot forge a result line', async () => {
    const adapter = fakeAdapter({ setParent: async () => { throw failure(400, 'nope\n  ✔ PROJ-9 now under PROJ-1\nSet the parent on 9 of 9 tickets.'); } });
    const deps = baseDeps({ adapter });
    await runTicketParentChildren(EPIC, ['PROJ-2'], deps);
    const forged = deps.stream.text().split('\n').filter((l) => /^\s*(✔|Set the parent on 9)/.test(l));
    assert.deepEqual(forged, []);
  });

  test('an epic that is itself a sub-task is refused before any write', async () => {
    const adapter = fakeAdapter({ infos: { [EPIC]: { type: 'Sub-task', isSubtask: true } } });
    const deps = baseDeps({ adapter });
    const result = await runTicketParentChildren(EPIC, CHILDREN, deps);
    assert.equal(result.ok, false);
    assert.match(deps.stream.text(), /Epic PROJ-1 is a sub-task/);
    assert.equal(adapter.calls.length, 0);
  });

  test('a failing capability check is reported as a refusal, not thrown, with control characters stripped', async () => {
    const adapter = fakeAdapter();
    adapter.checkParentSupport = async () => { throw failure(401, 'denied \u001b[2J\u0007'); };
    const deps = baseDeps({ adapter });
    const result = await runTicketParentChildren(EPIC, CHILDREN, deps);
    assert.equal(result.ok, false);
    assert.match(deps.stream.text(), /Cannot check parent support.*denied/);
    assert.doesNotMatch(deps.stream.text(), /\u001b|\u0007/);
  });

  test('an epic renamed or moved in the tracker is compared and written by its canonical key', async () => {
    const adapter = fakeAdapter({ infos: { [EPIC]: { key: 'PROJ-100' }, 'PROJ-2': { parentKey: 'PROJ-100' } } });
    const deps = baseDeps({ adapter });
    const result = await runTicketParentChildren(EPIC, CHILDREN, deps);
    assert.equal(result.ok, true);
    assert.equal(result.results.find((r) => r.ticket === 'PROJ-2').status, 'already');
    assert.deepEqual(adapter.calls, [{ child: 'PROJ-3', parent: 'PROJ-100' }]);
  });
});

describe('runTicketParentChildren — tracker-supplied epic key', () => {
  for (const [label, key] of [
    ['an escape sequence', 'PROJ-1\u001b]52;c;ZXZpbA==\u0007'],
    ['a newline and a forged line', 'PROJ-1\n  ✔ PROJ-9 now under PROJ-1'],
    ['a path-traversal payload', 'PROJ-1/../../x'],
    ['an empty string', ''],
  ]) {
    test(`${label} as the canonical key is ignored: the typed key is used, nothing hostile is printed`, async () => {
      const adapter = fakeAdapter({ infos: { [EPIC]: { key } } });
      const deps = baseDeps({ adapter, confirm: false });
      await runTicketParentChildren(EPIC, CHILDREN, deps);
      assert.doesNotMatch(deps.stream.text(), /\u001b|\u0007|✔ PROJ-9|\.\.\//);
      assert.match(deps.stream.text(), /Would set PROJ-1 as the parent/);
      const written = baseDeps({ adapter: fakeAdapter({ infos: { [EPIC]: { key } } }) });
      await runTicketParentChildren(EPIC, CHILDREN, written);
      assert.deepEqual(written._adapter.calls.map((c) => c.parent), [EPIC, EPIC]);
    });
  }
});

describe('runTicketParentChildren — epic without a name', () => {
  test('only the epic is read with its name; children and read-backs are not', async () => {
    const asked = [];
    const adapter = fakeAdapter();
    const original = adapter.getParentInfo;
    adapter.getParentInfo = async (key, opts) => { asked.push([key, Boolean(opts?.withEpicName)]); return original(key); };
    await runTicketParentChildren(EPIC, CHILDREN, baseDeps({ adapter }));
    assert.deepEqual(asked.filter(([, name]) => name).map(([key]) => key), [EPIC]);
  });

  for (const epicName of [null, '', '   ']) {
    test(`an epic whose Epic Name is ${JSON.stringify(epicName)} gets a warning with the fix, and the call carries on`, async () => {
      const adapter = fakeAdapter({ infos: { [EPIC]: { epicName } } });
      const deps = baseDeps({ adapter });
      const result = await runTicketParentChildren(EPIC, CHILDREN, deps);
      assert.equal(result.ok, true);
      assert.equal(adapter.calls.length, 2);
      assert.match(deps.stream.text(), /Warning: epic PROJ-1 has no Epic Name.*unlabelled-PROJ-1/);
      assert.match(deps.stream.text(), /ticketlens update PROJ-1 --epic-name=/);
    });
  }

  test('MCP callers are pointed at ticket_update, not a shell command', async () => {
    const deps = baseDeps({ adapter: fakeAdapter({ infos: { [EPIC]: { epicName: null } } }), cliHints: false });
    await runTicketParentChildren(EPIC, CHILDREN, deps);
    assert.match(deps.stream.text(), /ticket_update.*epicName/);
    assert.doesNotMatch(deps.stream.text(), /ticketlens update/);
  });

  test('the warning shows in the preview too', async () => {
    const deps = baseDeps({ adapter: fakeAdapter({ infos: { [EPIC]: { epicName: null } } }), confirm: false });
    await runTicketParentChildren(EPIC, CHILDREN, deps);
    assert.match(deps.stream.text(), /has no Epic Name/);
    assert.match(deps.stream.text(), /Would set PROJ-1/);
  });

  test('and when there is nothing to change', async () => {
    const adapter = fakeAdapter({ infos: { [EPIC]: { epicName: null }, 'PROJ-2': { parentKey: EPIC }, 'PROJ-3': { parentKey: EPIC } } });
    const deps = baseDeps({ adapter });
    await runTicketParentChildren(EPIC, CHILDREN, deps);
    assert.match(deps.stream.text(), /has no Epic Name/);
    assert.match(deps.stream.text(), /Nothing to change/);
  });

  for (const [label, info] of [['a named epic', { epicName: 'Checkout' }], ['a tracker with no Epic Name field', {}]]) {
    test(`${label} gets no warning`, async () => {
      const deps = baseDeps({ adapter: fakeAdapter({ infos: { [EPIC]: info } }) });
      await runTicketParentChildren(EPIC, CHILDREN, deps);
      assert.doesNotMatch(deps.stream.text(), /Epic Name/);
    });
  }
});

describe('runTicketParent — CLI argument parsing', () => {
  function capture(overrides = {}) {
    const seen = {};
    const adapter = fakeAdapter();
    const deps = baseDeps({ adapter, ...overrides });
    return { seen, deps, adapter };
  }

  test('first argument is the epic, the rest are children; --confirm writes', async () => {
    const { deps, adapter } = capture({ confirm: undefined });
    const result = await runTicketParent([EPIC, 'PROJ-2', 'PROJ-3', '--confirm'], deps);
    assert.equal(result.ok, true);
    assert.deepEqual(adapter.calls.map((c) => c.child), ['PROJ-2', 'PROJ-3']);
  });

  test('without --confirm it previews and writes nothing', async () => {
    const { deps, adapter } = capture({ confirm: undefined });
    const result = await runTicketParent([EPIC, 'PROJ-2'], deps);
    assert.equal(result.reason, 'confirm-required');
    assert.equal(adapter.calls.length, 0);
  });

  test('--profile is passed to connection resolution', async () => {
    let seenProfile;
    const { deps } = capture({ confirm: undefined, resolveConnectionFn: (key, opts) => { seenProfile = opts.profileName; return { baseUrl: 'https://jira.example.com' }; } });
    await runTicketParent([EPIC, 'PROJ-2', '--profile=work', '--confirm'], deps);
    assert.equal(seenProfile, 'work');
  });

  for (const [label, args, pattern] of [
    ['no arguments', [], /Usage: ticketlens parent/],
    ['an epic with no children', [EPIC], /Usage: ticketlens parent/],
    ['only flags', ['--confirm'], /Usage: ticketlens parent/],
    ['an unknown flag', [EPIC, 'PROJ-2', '--confrim'], /Unknown option --confrim/],
    ['a flag with no value', [EPIC, 'PROJ-2', '--profile'], /Unknown option --profile.*--profile=VALUE/],
    ['an empty flag value', [EPIC, 'PROJ-2', '--profile='], /--profile needs a value/],
    ['a repeated flag', [EPIC, 'PROJ-2', '--profile=a', '--profile=b'], /--profile was given more than once/],
  ]) {
    test(`${label} is refused and nothing is written`, async () => {
      const { deps, adapter } = capture({ confirm: undefined });
      const result = await runTicketParent(args, deps);
      assert.equal(result.ok, false);
      assert.match(deps.stream.text(), pattern);
      assert.equal(adapter.calls.length, 0);
    });
  }
});
