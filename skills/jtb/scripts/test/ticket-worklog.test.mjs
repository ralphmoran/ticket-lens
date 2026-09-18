import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { runTicketWorklog, runTicketWorklogEntries, MAX_WORKLOG_ENTRIES } from '../lib/ticket-worklog.mjs';
import { createJiraAdapter } from '../lib/adapters/jira-adapter.mjs';

const NOW = Date.parse('2026-09-18T20:00:00Z');
const NOW_JIRA = '2026-09-18T20:00:00.000+0000';

function makeStream() {
  const lines = [];
  return { write: (s) => lines.push(s), lines, text: () => lines.join('') };
}

function fakeAdapter(overrides = {}) {
  const calls = [];
  return {
    type: 'jira',
    calls,
    logWork: async (key, entry) => { calls.push({ key, entry }); return { id: `w-${key}`, timeSpent: '1h 30m', url: `https://jira.example.com/browse/${key}?focusedWorklogId=w-${key}` }; },
    ...overrides,
  };
}

function baseDeps(overrides = {}) {
  const adapter = overrides.adapter ?? fakeAdapter();
  const { adapter: _ignored, ...rest } = overrides;
  return {
    configDir: '/fake/config',
    stream: makeStream(),
    confirm: true,
    isLicensedFn: () => true,
    resolveConnectionFn: () => ({ baseUrl: 'https://jira.example.com' }),
    resolveAdapterFn: () => adapter,
    checkCooldownFn: () => ({ active: false, remainingMs: 0 }),
    claimActionFn: () => ({ claimed: true, remainingMs: 0 }),
    releaseActionFn: () => {},
    recordActionFn: () => {},
    logActionFn: () => {},
    actor: 'ralph',
    now: () => NOW,
    ...rest,
    _adapter: adapter,
  };
}

const ENTRY = { ticket: 'PROJ-1', time: '1h30m' };

describe('runTicketWorklogEntries — license gate', () => {
  test('unlicensed: never resolves a connection, never logs', async () => {
    let resolveCalls = 0;
    const deps = baseDeps({ isLicensedFn: () => false, resolveConnectionFn: () => { resolveCalls++; return { baseUrl: 'x' }; } });
    const result = await runTicketWorklogEntries([ENTRY], deps);
    assert.equal(result.ok, false);
    assert.equal(resolveCalls, 0);
    assert.equal(deps._adapter.calls.length, 0);
  });
});

describe('runTicketWorklogEntries — input validation (nothing is written when anything is invalid)', () => {
  for (const [label, entries, pattern] of [
    ['undefined entries', undefined, /at least one entry/i],
    ['a string instead of an array', 'PROJ-1=1h', /at least one entry/i],
    ['an empty array', [], /at least one entry/i],
    ['more than the per-call maximum', Array.from({ length: MAX_WORKLOG_ENTRIES + 1 }, (_, i) => ({ ticket: `PROJ-${i + 1}`, time: '1h' })), /at most 20/i],
    ['a null entry', [null], /Entry 1.*object/i],
    ['a string entry', ['PROJ-1'], /Entry 1.*object/i],
    ['a numeric ticket', [{ ticket: 123, time: '1h' }], /Entry 1.*ticket.*string/i],
    ['a malformed ticket key', [{ ticket: 'not-a-key', time: '1h' }], /Entry 1.*not a valid ticket key/i],
    ['a ticket key with a path-traversal payload', [{ ticket: 'PROJ-1/../../x', time: '1h' }], /not a valid ticket key/i],
    ['a ticket key with an embedded newline', [{ ticket: 'PROJ-1\nPROJ-2', time: '1h' }], /not a valid ticket key/i],
    ['a missing time', [{ ticket: 'PROJ-1' }], /Entry 1.*Duration is required/i],
    ['a day-based time', [{ ticket: 'PROJ-1', time: '1d' }], /Entry 1.*hours/i],
    ['a zero time', [{ ticket: 'PROJ-1', time: '0m' }], /Entry 1.*greater than zero/i],
    ['a time over 24h', [{ ticket: 'PROJ-1', time: '30h' }], /Entry 1.*24h/i],
    ['a date-only started', [{ ...ENTRY, started: '2026-09-18' }], /Entry 1.*time/i],
    ['a future started', [{ ...ENTRY, started: '2999-01-01T00:00:00Z' }], /Entry 1.*future/i],
    ['a rolled-over calendar date', [{ ...ENTRY, started: '2026-02-30T10:00:00Z' }], /Entry 1.*Invalid started/i],
    ['a non-string comment', [{ ...ENTRY, comment: { text: 'x' } }], /Entry 1.*comment.*string/i],
    ['a comment over 2000 characters', [{ ...ENTRY, comment: 'x'.repeat(2001) }], /Entry 1.*at most 2000/i],
    ['a ticket number with a leading zero', [{ ticket: 'PROJ-01', time: '1h' }], /Entry 1.*leading zero/i],
    ['a ticket number of several leading zeros', [{ ticket: 'proj-001', time: '1h' }], /Entry 1.*leading zero/i],
    ['a total over 24h across entries', [{ ticket: 'PROJ-1', time: '20h' }, { ticket: 'PROJ-2', time: '5h' }], /Total.*24h.*per call/i],
  ]) {
    test(`${label} is refused and nothing is logged`, async () => {
      const deps = baseDeps();
      const result = await runTicketWorklogEntries(entries, deps);
      assert.equal(result.ok, false);
      assert.match(deps.stream.text(), pattern);
      assert.equal(deps._adapter.calls.length, 0);
    });
  }

  test('a comment of exactly 2000 characters, and a total of exactly 24h, are accepted', async () => {
    const deps = baseDeps();
    const result = await runTicketWorklogEntries([{ ticket: 'PROJ-1', time: '12h', comment: 'x'.repeat(2000) }, { ticket: 'PROJ-2', time: '12h' }], deps);
    assert.equal(result.ok, true);
  });

  test('PROJ-0 is not mistaken for a leading zero', async () => {
    const deps = baseDeps();
    const result = await runTicketWorklogEntries([{ ticket: 'PROJ-0', time: '1h' }], deps);
    assert.equal(result.ok, true);
  });

  test('one bad entry blocks the valid entries around it — all-or-nothing validation', async () => {
    const deps = baseDeps();
    const result = await runTicketWorklogEntries([ENTRY, { ticket: 'PROJ-2', time: 'nope' }, { ticket: 'PROJ-3', time: '1h' }], deps);
    assert.equal(result.ok, false);
    assert.equal(deps._adapter.calls.length, 0);
    assert.match(deps.stream.text(), /Entry 2/);
  });

  test('every invalid entry is reported in one pass, not just the first', async () => {
    const deps = baseDeps();
    await runTicketWorklogEntries([{ ticket: 'bad', time: '1h' }, { ticket: 'PROJ-2', time: 'nope' }], deps);
    assert.match(deps.stream.text(), /Entry 1/);
    assert.match(deps.stream.text(), /Entry 2/);
  });

  test('the same ticket twice (even differing in case) is refused — one worklog per ticket per call', async () => {
    const deps = baseDeps();
    const result = await runTicketWorklogEntries([{ ticket: 'proj-1', time: '1h' }, { ticket: 'PROJ-1', time: '2h' }], deps);
    assert.equal(result.ok, false);
    assert.match(deps.stream.text(), /PROJ-1.*more than once/i);
    assert.equal(deps._adapter.calls.length, 0);
  });
});

describe('runTicketWorklogEntries — tracker resolution (refused before any write)', () => {
  test('no configured connection refuses the whole batch', async () => {
    const deps = baseDeps({ resolveConnectionFn: () => ({ baseUrl: null }) });
    const result = await runTicketWorklogEntries([ENTRY], deps);
    assert.equal(result.ok, false);
    assert.equal(deps._adapter.calls.length, 0);
  });

  test('a GitHub/Linear ticket (no worklog API) refuses the whole batch and says Jira-only', async () => {
    const jira = fakeAdapter();
    const github = { type: 'github' };
    const deps = baseDeps({
      resolveAdapterFn: (conn) => (conn.baseUrl.includes('github') ? github : jira),
      resolveConnectionFn: (key) => ({ baseUrl: key === 'PROJ-2' ? 'https://github.example.com' : 'https://jira.example.com' }),
    });
    const result = await runTicketWorklogEntries([ENTRY, { ticket: 'PROJ-2', time: '1h' }], deps);
    assert.equal(result.ok, false);
    assert.match(deps.stream.text(), /PROJ-2.*only.*Jira.*github/i);
    assert.equal(jira.calls.length, 0, 'the valid Jira entry must not be written when a sibling is unsupported');
  });

  test('each ticket resolves its own connection by its own key', async () => {
    const seen = [];
    const deps = baseDeps({ resolveConnectionFn: (key) => { seen.push(key); return { baseUrl: 'https://jira.example.com' }; } });
    await runTicketWorklogEntries([ENTRY, { ticket: 'OTHER-2', time: '1h' }], deps);
    assert.deepEqual(seen, ['PROJ-1', 'OTHER-2']);
  });

  test('a profile warning from connection resolution is shown once, not once per entry', async () => {
    const deps = baseDeps({
      resolveConnectionFn: (key, opts) => { opts.onWarning('Prefix "PROJ" matches multiple profiles: a, b. Using a.'); return { baseUrl: 'https://jira.example.com' }; },
    });
    await runTicketWorklogEntries([ENTRY, { ticket: 'PROJ-2', time: '1h' }, { ticket: 'PROJ-3', time: '1h' }], deps);
    const occurrences = deps.stream.text().split('Prefix "PROJ" matches multiple profiles').length - 1;
    assert.equal(occurrences, 1);
  });

  test('--profile is threaded to the connection resolver', async () => {
    let profileName;
    const deps = baseDeps({ profile: 'advent', resolveConnectionFn: (key, opts) => { profileName = opts.profileName; return { baseUrl: 'https://jira.example.com' }; } });
    await runTicketWorklogEntries([ENTRY], deps);
    assert.equal(profileName, 'advent');
  });
});

describe('runTicketWorklogEntries — confirm gate', () => {
  test('without confirm: shows a preview, writes nothing, records nothing', async () => {
    let recorded = false, logged = false;
    const deps = baseDeps({ confirm: false, recordActionFn: () => { recorded = true; }, logActionFn: () => { logged = true; } });
    const result = await runTicketWorklogEntries([{ ...ENTRY, comment: 'Fixed login' }], deps);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'confirm-required');
    assert.equal(deps._adapter.calls.length, 0);
    assert.equal(recorded, false);
    assert.equal(logged, false);
    const out = deps.stream.text();
    assert.match(out, /PROJ-1/);
    assert.match(out, /1h 30m/);
    assert.match(out, new RegExp(NOW_JIRA.replace(/[+.]/g, '\\$&')));
  });

  test('the preview strips terminal control characters from a comment', async () => {
    const deps = baseDeps({ confirm: false });
    await runTicketWorklogEntries([{ ...ENTRY, comment: 'hi \x1b]52;c;ZXZpbA==\x07 there \x1b[2J' }], deps);
    assert.doesNotMatch(deps.stream.text(), /[\x00-\x08\x0b-\x1f\x7f-\x9f]/);
    assert.match(deps.stream.text(), /hi/);
  });

  test('CLI hint names --confirm; MCP hint names confirm: true', async () => {
    const cli = baseDeps({ confirm: false, cliHints: true });
    await runTicketWorklogEntries([ENTRY], cli);
    assert.match(cli.stream.text(), /--confirm/);
    const mcp = baseDeps({ confirm: false, cliHints: false });
    await runTicketWorklogEntries([ENTRY], mcp);
    assert.match(mcp.stream.text(), /confirm: true/);
    assert.doesNotMatch(mcp.stream.text(), /--confirm/);
  });

  test('confirm must be exactly true — a truthy string is not confirmation', async () => {
    const deps = baseDeps({ confirm: 'yes' });
    const result = await runTicketWorklogEntries([ENTRY], deps);
    assert.equal(result.reason, 'confirm-required');
    assert.equal(deps._adapter.calls.length, 0);
  });

  test('validation errors are reported instead of a preview, even without confirm', async () => {
    const deps = baseDeps({ confirm: false });
    const result = await runTicketWorklogEntries([{ ticket: 'PROJ-1', time: 'nope' }], deps);
    assert.notEqual(result.reason, 'confirm-required');
    assert.match(deps.stream.text(), /Invalid duration/);
  });
});

describe('runTicketWorklogEntries — happy path', () => {
  test('logs seconds + started + comment, records the cooldown, and audits without the comment text', async () => {
    let recorded, logged;
    const deps = baseDeps({
      recordActionFn: (key, action) => { recorded = { key, action }; },
      logActionFn: (entry) => { logged = entry; },
    });
    const result = await runTicketWorklogEntries([{ ...ENTRY, comment: 'Fixed login, secret-ish detail' }], deps);
    assert.equal(result.ok, true);
    assert.deepEqual(deps._adapter.calls[0], { key: 'PROJ-1', entry: { timeSpentSeconds: 5400, started: NOW_JIRA, comment: 'Fixed login, secret-ish detail' } });
    assert.deepEqual(recorded, { key: 'PROJ-1', action: 'worklog' });
    assert.deepEqual(logged, { ticketKey: 'PROJ-1', action: 'worklog', actor: 'ralph', tracker: 'jira', detail: { id: 'w-PROJ-1', seconds: 5400, started: NOW_JIRA, hasComment: true, source: 'cli' } });
    assert.doesNotMatch(JSON.stringify(logged), /secret-ish/);
    assert.match(deps.stream.text(), /PROJ-1 logged 1h 30m/);
    assert.deepEqual(result.results.map(r => r.status), ['logged']);
  });

  test('omits the comment key entirely when none (or an empty one) is given', async () => {
    const deps = baseDeps();
    await runTicketWorklogEntries([ENTRY, { ticket: 'PROJ-2', time: '1h', comment: '' }], deps);
    for (const call of deps._adapter.calls) assert.equal('comment' in call.entry, false);
  });

  test('uses an explicit started, converted to UTC +0000', async () => {
    const deps = baseDeps();
    await runTicketWorklogEntries([{ ...ENTRY, started: '2026-09-18T10:00:00-07:00' }], deps);
    assert.equal(deps._adapter.calls[0].entry.started, '2026-09-18T17:00:00.000+0000');
  });

  test('normalizes a lowercase key', async () => {
    const deps = baseDeps();
    await runTicketWorklogEntries([{ ticket: 'proj-1', time: '1h' }], deps);
    assert.equal(deps._adapter.calls[0].key, 'PROJ-1');
  });

  test('logs several tickets sequentially, in the order given', async () => {
    const order = [];
    const adapter = fakeAdapter({ logWork: async (key) => { order.push(`start:${key}`); await new Promise(r => setImmediate(r)); order.push(`end:${key}`); return { id: key }; } });
    const deps = baseDeps({ adapter });
    const result = await runTicketWorklogEntries([ENTRY, { ticket: 'PROJ-2', time: '45m' }, { ticket: 'PROJ-3', time: '2h' }], deps);
    assert.deepEqual(order, ['start:PROJ-1', 'end:PROJ-1', 'start:PROJ-2', 'end:PROJ-2', 'start:PROJ-3', 'end:PROJ-3']);
    assert.equal(result.ok, true);
    assert.match(deps.stream.text(), /Logged 3 of 3/);
  });

  test('output is plain (no ANSI codes) when the stream is not a TTY', async () => {
    const deps = baseDeps();
    await runTicketWorklogEntries([ENTRY], deps);
    assert.doesNotMatch(deps.stream.text(), /\x1b\[/);
  });
});

describe('runTicketWorklogEntries — partial failure (time entries must never be silently lost or doubled)', () => {
  test('a failing entry is reported, the rest still run, and ok is false', async () => {
    const adapter = fakeAdapter({
      logWork: async (key) => {
        if (key === 'PROJ-2') throw Object.assign(new Error('boom'), { status: 403 });
        return { id: `w-${key}` };
      },
    });
    const recordedKeys = [];
    const deps = baseDeps({ adapter, recordActionFn: (key) => recordedKeys.push(key) });
    const result = await runTicketWorklogEntries([ENTRY, { ticket: 'PROJ-2', time: '1h' }, { ticket: 'PROJ-3', time: '1h' }], deps);
    assert.equal(result.ok, false);
    assert.deepEqual(result.results.map(r => [r.ticket, r.status]), [['PROJ-1', 'logged'], ['PROJ-2', 'failed'], ['PROJ-3', 'logged']]);
    assert.deepEqual(recordedKeys, ['PROJ-1', 'PROJ-3'], 'a failed write must not start a cooldown or an audit line');
    assert.match(deps.stream.text(), /Logged 2 of 3/);
    assert.match(deps.stream.text(), /PROJ-2/);
  });

  test('a rate-limit stops the batch: remaining entries are skipped, never attempted', async () => {
    const attempted = [];
    const adapter = fakeAdapter({
      logWork: async (key) => {
        attempted.push(key);
        if (key === 'PROJ-2') throw Object.assign(new Error('429'), { status: 429, rateLimit: { retryAfterSeconds: 30 } });
        return { id: key };
      },
    });
    const deps = baseDeps({ adapter });
    const result = await runTicketWorklogEntries([ENTRY, { ticket: 'PROJ-2', time: '1h' }, { ticket: 'PROJ-3', time: '1h' }], deps);
    assert.deepEqual(attempted, ['PROJ-1', 'PROJ-2']);
    assert.deepEqual(result.results.map(r => r.status), ['logged', 'failed', 'skipped']);
    assert.match(deps.stream.text(), /PROJ-3.*not attempted/i);
  });

  test('a bare HTTP 429 (no rateLimit metadata) also halts the batch — Jira\'s client never attached it', async () => {
    const attempted = [];
    const adapter = fakeAdapter({
      logWork: async (key) => {
        attempted.push(key);
        if (key === 'PROJ-1') throw Object.assign(new Error('Jira API error 429'), { status: 429 });
        return { id: key };
      },
    });
    const deps = baseDeps({ adapter });
    const result = await runTicketWorklogEntries([ENTRY, { ticket: 'PROJ-2', time: '1h' }], deps);
    assert.deepEqual(attempted, ['PROJ-1']);
    assert.deepEqual(result.results.map(r => r.status), ['failed', 'skipped']);
  });

  test('a 401 halts the batch too — every remaining entry would fail identically', async () => {
    const attempted = [];
    const adapter = fakeAdapter({
      logWork: async (key) => { attempted.push(key); throw Object.assign(new Error('Jira API error 401'), { status: 401 }); },
    });
    const deps = baseDeps({ adapter });
    const result = await runTicketWorklogEntries([ENTRY, { ticket: 'PROJ-2', time: '1h' }, { ticket: 'PROJ-3', time: '1h' }], deps);
    assert.deepEqual(attempted, ['PROJ-1']);
    assert.deepEqual(result.results.map(r => r.status), ['failed', 'skipped', 'skipped']);
    assert.match(deps.stream.text(), /PROJ-2.*not attempted/i);
  });

  test('a 403 does NOT halt — permissions differ per project, the next ticket may be fine', async () => {
    const attempted = [];
    const adapter = fakeAdapter({
      logWork: async (key) => {
        attempted.push(key);
        if (key === 'PROJ-1') throw Object.assign(new Error('Jira API error 403'), { status: 403 });
        return { id: key };
      },
    });
    const result = await runTicketWorklogEntries([ENTRY, { ticket: 'PROJ-2', time: '1h' }], baseDeps({ adapter }));
    assert.deepEqual(attempted, ['PROJ-1', 'PROJ-2']);
    assert.deepEqual(result.results.map(r => r.status), ['failed', 'logged']);
  });

  test('a partial batch names what already landed and what to retry — so a caller never re-sends the logged ones', async () => {
    const adapter = fakeAdapter({
      logWork: async (key) => {
        if (key === 'PROJ-2') throw Object.assign(new Error('boom'), { status: 403 });
        return { id: key };
      },
    });
    const deps = baseDeps({ adapter });
    await runTicketWorklogEntries([ENTRY, { ticket: 'PROJ-2', time: '1h' }, { ticket: 'PROJ-3', time: '1h' }], deps);
    const out = deps.stream.text();
    assert.match(out, /Already logged \(do not repeat\): PROJ-1, PROJ-3/);
    assert.match(out, /Retry only: PROJ-2/);
  });

  test('a blind retry: a ticket skipped as already logged is NEVER listed under "Retry only" (found by live break test 4)', async () => {
    const adapter = fakeAdapter({ logWork: async () => { throw Object.assign(new Error('nope'), { status: 404 }); } });
    const deps = baseDeps({ adapter, checkCooldownFn: (key, action) => ({ active: key === 'PROJ-1' && action === 'worklog', remainingMs: 9000 }) });
    await runTicketWorklogEntries([ENTRY, { ticket: 'PROJ-2', time: '1h' }], deps);
    const out = deps.stream.text();
    assert.match(out, /Already logged \(do not repeat\): PROJ-1/);
    assert.match(out, /Retry only: PROJ-2\./);
    assert.doesNotMatch(out, /Retry only:[^\n]*PROJ-1/);
  });

  test('an ambiguous failure (timeout / 5xx) is listed under "check Jira first", never under "Retry only"', async () => {
    const adapter = fakeAdapter({
      logWork: async (key) => {
        if (key === 'PROJ-2') throw new Error('The operation was aborted due to timeout');
        if (key === 'PROJ-3') throw Object.assign(new Error('no'), { status: 403 });
        return { id: key };
      },
    });
    const deps = baseDeps({ adapter });
    await runTicketWorklogEntries([ENTRY, { ticket: 'PROJ-2', time: '1h' }, { ticket: 'PROJ-3', time: '1h' }], deps);
    const out = deps.stream.text();
    assert.match(out, /Already logged \(do not repeat\): PROJ-1\./);
    assert.match(out, /Check in Jira before logging again \(may have landed\): PROJ-2\./);
    assert.match(out, /Retry only: PROJ-3\./);
    assert.doesNotMatch(out, /Retry only:[^\n]*PROJ-2/);
  });

  test('a ticket skipped by the unconfirmed hold is listed under "check Jira first"', async () => {
    const deps = baseDeps({ checkCooldownFn: (key, action) => ({ active: key === 'PROJ-1' && action === 'worklog-unconfirmed', remainingMs: 120_000 }) });
    await runTicketWorklogEntries([ENTRY, { ticket: 'PROJ-2', time: '1h' }], deps);
    const out = deps.stream.text();
    assert.match(out, /Check in Jira before logging again \(may have landed\): PROJ-1\./);
    assert.doesNotMatch(out, /Retry only:[^\n]*PROJ-1/);
  });

  test('entries never attempted because the batch halted ARE listed under "Retry only"', async () => {
    const adapter = fakeAdapter({ logWork: async () => { throw Object.assign(new Error('401'), { status: 401 }); } });
    const deps = baseDeps({ adapter });
    await runTicketWorklogEntries([ENTRY, { ticket: 'PROJ-2', time: '1h' }, { ticket: 'PROJ-3', time: '1h' }], deps);
    assert.match(deps.stream.text(), /Retry only: PROJ-1, PROJ-2, PROJ-3\./);
  });

  test('a fully successful batch prints no retry guidance', async () => {
    const deps = baseDeps();
    await runTicketWorklogEntries([ENTRY, { ticket: 'PROJ-2', time: '1h' }], deps);
    assert.doesNotMatch(deps.stream.text(), /Retry only|do not repeat/);
  });

  test('a fully failed batch prints retry guidance but no "already logged" line', async () => {
    const adapter = fakeAdapter({ logWork: async () => { throw Object.assign(new Error('boom'), { status: 403 }); } });
    const deps = baseDeps({ adapter });
    await runTicketWorklogEntries([ENTRY, { ticket: 'PROJ-2', time: '1h' }], deps);
    assert.doesNotMatch(deps.stream.text(), /Already logged/);
    assert.match(deps.stream.text(), /Retry only: PROJ-1, PROJ-2/);
  });

  test('end to end through the real Jira adapter: a 429 with Retry-After halts the batch and reports the wait (no hand-built rateLimit)', async () => {
    let posts = 0;
    const fetcher = async () => { posts++; return { ok: false, status: 429, headers: { get: () => '30' }, json: async () => ({}) }; };
    const adapter = createJiraAdapter({ baseUrl: 'https://jira.example.com', auth: 'pat', pat: 'tok' }, { fetcher });
    const deps = baseDeps({ resolveAdapterFn: () => adapter });
    const result = await runTicketWorklogEntries([ENTRY, { ticket: 'PROJ-2', time: '1h' }], deps);
    assert.equal(posts, 1, 'the second ticket must never be POSTed after a 429');
    assert.deepEqual(result.results.map(r => r.status), ['failed', 'skipped']);
    assert.match(deps.stream.text(), /Rate limited by the tracker — retry PROJ-1 after ~30s/);
  });

  test('the audit line is still written when the cooldown record fails (and the reverse)', async () => {
    let audited = 0, recorded = 0;
    const cooldownBroken = baseDeps({ recordActionFn: () => { throw new Error('disk full'); }, logActionFn: () => { audited++; } });
    await runTicketWorklogEntries([ENTRY], cooldownBroken);
    assert.equal(audited, 1, 'a landed billable write must always reach the audit log');
    assert.match(cooldownBroken.stream.text(), /local cooldown record failed/i);

    const auditBroken = baseDeps({ recordActionFn: () => { recorded++; }, logActionFn: () => { throw new Error('disk full'); } });
    await runTicketWorklogEntries([ENTRY], auditBroken);
    assert.equal(recorded, 1, 'the cooldown must still start when only the audit write fails');
    assert.match(auditBroken.stream.text(), /local audit record failed/i);
  });

  test('failure text from the tracker is stripped of terminal control characters', async () => {
    const adapter = fakeAdapter({ logWork: async () => { throw Object.assign(new Error('bad \x1b]52;c;ZXZpbA==\x07 end'), { status: 403 }); } });
    const deps = baseDeps({ adapter });
    await runTicketWorklogEntries([ENTRY], deps);
    assert.doesNotMatch(deps.stream.text(), /[\x00-\x08\x0b-\x1f\x7f-\x9f]/);
  });

  for (const [label, error] of [
    ['a timeout', new Error('The operation was aborted due to timeout')],
    ['a 502', Object.assign(new Error('bad gateway'), { status: 502 })],
    ['a 500', Object.assign(new Error('boom'), { status: 500 })],
  ]) {
    test(`${label} leaves an "unconfirmed" cooldown and audit line — the write may have landed, an immediate retry would double-bill`, async () => {
      const recorded = [], audited = [];
      const adapter = fakeAdapter({ logWork: async () => { throw error; } });
      const deps = baseDeps({
        adapter,
        recordActionFn: (key, action) => recorded.push([key, action]),
        logActionFn: (entry) => audited.push(entry),
      });
      const result = await runTicketWorklogEntries([ENTRY], deps);
      assert.deepEqual(recorded, [['PROJ-1', 'worklog-unconfirmed']]);
      assert.equal(audited.length, 1);
      assert.equal(audited[0].action, 'worklog-unconfirmed');
      assert.equal(audited[0].detail.seconds, 5400);
      assert.equal(result.results[0].status, 'failed');
    });
  }

  test('a definite rejection (403) leaves no cooldown or audit line — nothing landed', async () => {
    const recorded = [], audited = [];
    const adapter = fakeAdapter({ logWork: async () => { throw Object.assign(new Error('no'), { status: 403 }); } });
    await runTicketWorklogEntries([ENTRY], baseDeps({ adapter, recordActionFn: (k, a) => recorded.push(a), logActionFn: (e) => audited.push(e) }));
    assert.deepEqual(recorded, []);
    assert.deepEqual(audited, []);
  });

  test('an active unconfirmed cooldown skips the ticket without a write, using a long window, and says the write may have landed', async () => {
    const seenWindows = [];
    let attempts = 0;
    const adapter = fakeAdapter({ logWork: async () => { attempts++; return { id: '1' }; } });
    const deps = baseDeps({
      adapter,
      checkCooldownFn: (key, action, opts) => { seenWindows.push([action, opts.cooldownMs]); return { active: action === 'worklog-unconfirmed', remainingMs: 120_000 }; },
    });
    const result = await runTicketWorklogEntries([ENTRY], deps);
    assert.equal(attempts, 0);
    assert.equal(result.results[0].status, 'skipped');
    assert.match(deps.stream.text(), /PROJ-1.*may have already landed.*check the ticket/is);
    const unconfirmed = seenWindows.find(([action]) => action === 'worklog-unconfirmed');
    assert.ok(unconfirmed[1] >= 10 * 60 * 1000, 'the ambiguous-outcome window must be minutes, not the 10s double-fire debounce');
  });

  test('skip messages report the remaining hold, never remaining time as if it were elapsed time (found by live break test 5)', async () => {
    const unconfirmed = baseDeps({ checkCooldownFn: (key, action) => ({ active: action === 'worklog-unconfirmed', remainingMs: 120_000 }) });
    await runTicketWorklogEntries([ENTRY], unconfirmed);
    assert.match(unconfirmed.stream.text(), /blocked 2m more/);
    assert.doesNotMatch(unconfirmed.stream.text(), /\bago\b/);
    const recent = baseDeps({ checkCooldownFn: (key, action) => ({ active: action === 'worklog', remainingMs: 4000 }) });
    await runTicketWorklogEntries([ENTRY], recent);
    assert.match(recent.stream.text(), /blocked 4s more/);
    assert.doesNotMatch(recent.stream.text(), /\bago\b/);
  });

  test('the cooldown is claimed atomically BEFORE the POST, so a parallel process cannot also write (live break test 5 race)', async () => {
    const order = [];
    const adapter = fakeAdapter({ logWork: async () => { order.push('post'); return { id: '1' }; } });
    const deps = baseDeps({ adapter, claimActionFn: (key, action) => { order.push(`claim:${key}:${action}`); return { claimed: true, remainingMs: 0 }; } });
    await runTicketWorklogEntries([ENTRY], deps);
    assert.deepEqual(order, ['claim:PROJ-1:worklog', 'post']);
  });

  test('losing the claim race means no POST and a skip that names it already logged', async () => {
    let attempts = 0;
    const adapter = fakeAdapter({ logWork: async () => { attempts++; return { id: '1' }; } });
    const deps = baseDeps({ adapter, claimActionFn: () => ({ claimed: false, remainingMs: 8000 }) });
    const result = await runTicketWorklogEntries([ENTRY, { ticket: 'PROJ-2', time: '1h' }], deps);
    assert.equal(attempts, 0);
    assert.deepEqual(result.results.map(r => [r.status, r.reason]), [['skipped', 'recent'], ['skipped', 'recent']]);
    assert.match(deps.stream.text(), /PROJ-1.*already logged.*8s more/i);
    assert.doesNotMatch(deps.stream.text(), /Retry only/, 'a ticket skipped as already logged must never be offered for retry');
  });

  test('a definite failure (403) releases the claim so a corrected retry is not blocked', async () => {
    const released = [];
    const adapter = fakeAdapter({ logWork: async () => { throw Object.assign(new Error('no'), { status: 403 }); } });
    await runTicketWorklogEntries([ENTRY], baseDeps({ adapter, releaseActionFn: (key, action) => released.push([key, action]) }));
    assert.deepEqual(released, [['PROJ-1', 'worklog']]);
  });

  test('an ambiguous failure (timeout) KEEPS the claim — the write may have landed', async () => {
    const released = [];
    const adapter = fakeAdapter({ logWork: async () => { throw new Error('The operation was aborted due to timeout'); } });
    await runTicketWorklogEntries([ENTRY], baseDeps({ adapter, releaseActionFn: (key) => released.push(key) }));
    assert.deepEqual(released, []);
  });

  test('a successful write keeps the claim (that IS the 10s double-fire debounce)', async () => {
    const released = [];
    await runTicketWorklogEntries([ENTRY], baseDeps({ releaseActionFn: (key) => released.push(key) }));
    assert.deepEqual(released, []);
  });

  test('if the claim lock cannot be taken, nothing is written and the entry is safe to retry', async () => {
    let attempts = 0;
    const adapter = fakeAdapter({ logWork: async () => { attempts++; return { id: '1' }; } });
    const deps = baseDeps({ adapter, claimActionFn: () => { throw new Error('cooldown lock busy'); } });
    const result = await runTicketWorklogEntries([ENTRY, { ticket: 'PROJ-2', time: '1h' }], deps);
    assert.equal(attempts, 0, 'fail closed — never write billable time without the atomic claim');
    assert.deepEqual(result.results.map(r => r.status), ['skipped', 'skipped']);
    assert.match(deps.stream.text(), /PROJ-1.*not written.*lock/i);
    assert.match(deps.stream.text(), /Retry only: PROJ-1, PROJ-2/);
  });

  test('the audit line records where the call came from (cli vs mcp)', async () => {
    const cli = [], mcp = [];
    await runTicketWorklogEntries([ENTRY], baseDeps({ cliHints: true, logActionFn: (e) => cli.push(e) }));
    await runTicketWorklogEntries([ENTRY], baseDeps({ cliHints: false, logActionFn: (e) => mcp.push(e) }));
    assert.equal(cli[0].detail.source, 'cli');
    assert.equal(mcp[0].detail.source, 'mcp');
  });

  test('an active cooldown skips only that ticket', async () => {
    const deps = baseDeps({ checkCooldownFn: (key, action) => ({ active: key === 'PROJ-2' && action === 'worklog', remainingMs: 4000 }) });
    const result = await runTicketWorklogEntries([ENTRY, { ticket: 'PROJ-2', time: '1h' }, { ticket: 'PROJ-3', time: '1h' }], deps);
    assert.deepEqual(result.results.map(r => r.status), ['logged', 'skipped', 'logged']);
    assert.deepEqual(deps._adapter.calls.map(c => c.key), ['PROJ-1', 'PROJ-3']);
    assert.match(deps.stream.text(), /PROJ-2.*already logged.*4s/i);
    assert.doesNotMatch(deps.stream.text(), /Wait a moment/i, 'a skip must never invite a blind retry of billable time');
    assert.match(deps.stream.text(), /check the ticket/i);
  });

  test('a timed-out write is reported as possibly landed — never auto-retried', async () => {
    let attempts = 0;
    const adapter = fakeAdapter({ logWork: async () => { attempts++; throw new Error('The operation was aborted due to timeout'); } });
    const deps = baseDeps({ adapter });
    await runTicketWorklogEntries([ENTRY], deps);
    assert.equal(attempts, 1, 'exactly one attempt — a timed-out write is never retried');
    assert.match(deps.stream.text(), /may have already landed/i);
  });

  test('local bookkeeping failing AFTER a successful write still reports logged — a retry would double the time', async () => {
    const deps = baseDeps({ recordActionFn: () => { throw new Error('disk full'); }, logActionFn: () => { throw new Error('disk full'); } });
    const result = await runTicketWorklogEntries([ENTRY], deps);
    assert.equal(result.ok, true);
    assert.equal(result.results[0].status, 'logged');
    assert.equal(deps._adapter.calls.length, 1);
    assert.match(deps.stream.text(), /logged.*local (audit|cooldown).*failed/is);
  });
});

describe('runTicketWorklog — CLI argument parsing', () => {
  test('KEY=DURATION with --confirm logs it', async () => {
    const deps = baseDeps({ confirm: undefined });
    const result = await runTicketWorklog(['PROJ-1=1h30m', '--confirm'], deps);
    assert.equal(result.ok, true);
    assert.equal(deps._adapter.calls[0].entry.timeSpentSeconds, 5400);
  });

  test('several pairs share --comment and --started', async () => {
    const deps = baseDeps({ confirm: undefined });
    await runTicketWorklog(['PROJ-1=1h', 'PROJ-2=45m', '--comment=Sprint work', '--started=2026-09-18T10:00:00Z', '--confirm'], deps);
    assert.deepEqual(deps._adapter.calls.map(c => [c.key, c.entry.timeSpentSeconds, c.entry.comment, c.entry.started]), [
      ['PROJ-1', 3600, 'Sprint work', '2026-09-18T10:00:00.000+0000'],
      ['PROJ-2', 2700, 'Sprint work', '2026-09-18T10:00:00.000+0000'],
    ]);
  });

  test('without --confirm: preview only, nothing logged', async () => {
    const deps = baseDeps({ confirm: undefined });
    const result = await runTicketWorklog(['PROJ-1=1h'], deps);
    assert.equal(result.reason, 'confirm-required');
    assert.equal(deps._adapter.calls.length, 0);
  });

  test('a --comment value containing "--confirm" text is inert — only a whole-element --confirm confirms', async () => {
    const deps = baseDeps({ confirm: undefined });
    const result = await runTicketWorklog(['PROJ-1=1h', '--comment=--confirm'], deps);
    assert.equal(result.reason, 'confirm-required');
    assert.equal(deps._adapter.calls.length, 0);
  });

  for (const [label, args] of [
    ['no arguments', []],
    ['only flags', ['--confirm']],
    ['a key without =DURATION', ['PROJ-1', '--confirm']],
    ['a leading = (empty key)', ['=1h', '--confirm']],
    ['a duration split by the shell ("1h 30m" unquoted)', ['PROJ-1=1h', '30m', '--confirm']],
  ]) {
    test(`${label} shows usage and logs nothing`, async () => {
      const deps = baseDeps({ confirm: undefined });
      const result = await runTicketWorklog(args, deps);
      assert.equal(result.ok, false);
      assert.match(deps.stream.text(), /Usage: ticketlens worklog/);
      assert.equal(deps._adapter.calls.length, 0);
    });
  }

  for (const [label, args, pattern] of [
    ['a misspelled --coment flag', ['PROJ-1=1h', '--coment=oops', '--confirm'], /Unknown option.*--coment/],
    ['a misspelled --startd flag (would silently bill "now")', ['PROJ-1=1h', '--startd=2026-09-01T10:00:00Z', '--confirm'], /Unknown option.*--startd/],
    ['a misspelled --confirmm flag', ['PROJ-1=1h', '--confirmm'], /Unknown option.*--confirmm/],
    ['an empty --started= (would silently bill "now")', ['PROJ-1=1h', '--started=', '--confirm'], /--started.*needs a value/],
    ['an empty --comment=', ['PROJ-1=1h', '--comment=', '--confirm'], /--comment.*needs a value/],
    ['an empty --profile=', ['PROJ-1=1h', '--profile=', '--confirm'], /--profile.*needs a value/],
    ['a value-less --started with no equals sign', ['PROJ-1=1h', '--started', '--confirm'], /Unknown option.*--started/],
  ]) {
    test(`${label} is refused and nothing is logged`, async () => {
      const deps = baseDeps({ confirm: undefined });
      const result = await runTicketWorklog(args, deps);
      assert.equal(result.ok, false);
      assert.match(deps.stream.text(), pattern);
      assert.equal(deps._adapter.calls.length, 0);
    });
  }

  test('--profile is parsed from the flags and threaded through', async () => {
    let profileName;
    const deps = baseDeps({ confirm: undefined, resolveConnectionFn: (k, opts) => { profileName = opts.profileName; return { baseUrl: 'https://jira.example.com' }; } });
    await runTicketWorklog(['PROJ-1=1h', '--profile=advent', '--confirm'], deps);
    assert.equal(profileName, 'advent');
  });
});
