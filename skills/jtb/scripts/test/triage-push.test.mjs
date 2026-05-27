import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { pushTriageSnapshot, queueUrl } from '../lib/triage-push.mjs';

describe('queueUrl', () => {
  it('production api → app subdomain', () => {
    assert.equal(queueUrl('https://api.ticketlens.com'), 'https://app.ticketlens.com/console/queue');
  });
  it('local api subdomain → no subdomain change', () => {
    assert.equal(queueUrl('http://api.ticketlens.test'), 'http://ticketlens.test/console/queue');
  });
  it('local no subdomain → unchanged', () => {
    assert.equal(queueUrl('http://ticketlens.test'), 'http://ticketlens.test/console/queue');
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeScored(key, urgency = 'needs-response') {
  return {
    ticketKey: key,
    summary: `Summary of ${key}`,
    status: 'Code Review',
    urgency,
    reason: 'test',
    lastComment: null,
  };
}

function makeRaw(key, overrides = {}) {
  return {
    key,
    summary: `Summary of ${key}`,
    type: 'Task',
    status: 'Code Review',
    assignee: overrides.assignee ?? 'John Dev',
    updated: overrides.updated ?? '2026-05-10T09:00:00Z',
  };
}

function makeFetcher(status) {
  return async () => ({ ok: status >= 200 && status < 300, status, json: async () => ({}) });
}

// ---------------------------------------------------------------------------
// No CLI token
// ---------------------------------------------------------------------------

describe('pushTriageSnapshot — no cliToken', () => {
  it('shows no-token message and does not call fetcher', async () => {
    let fetchCalled = false;
    const lines = [];
    const result = await pushTriageSnapshot({
      sorted: [makeScored('PROJ-1')],
      rawTicketMap: new Map(),
      profile: 'default',
      cliToken: null,
      fetcher: () => { fetchCalled = true; },
      print: (s) => lines.push(s),
    });
    assert.ok(!fetchCalled, 'fetcher must not be called without CLI token');
    assert.ok(lines.some(l => l.includes('--push requires Console access')));
    assert.equal(result.ok, false);
  });

  it('shows no-token message when cliToken is empty string', async () => {
    const lines = [];
    await pushTriageSnapshot({
      sorted: [],
      cliToken: '',
      print: (s) => lines.push(s),
    });
    assert.ok(lines.some(l => l.includes('--push requires Console access')));
  });

  it('shows ticketlens login hint in no-token message', async () => {
    const lines = [];
    await pushTriageSnapshot({ sorted: [], cliToken: null, print: (s) => lines.push(s) });
    assert.ok(lines.some(l => l.includes('ticketlens login')));
  });
});

// ---------------------------------------------------------------------------
// HTTP success
// ---------------------------------------------------------------------------

describe('pushTriageSnapshot — HTTP success', () => {
  it('shows confirmation and returns ok:true on 201', async () => {
    const lines = [];
    const result = await pushTriageSnapshot({
      sorted: [makeScored('PROJ-1')],
      rawTicketMap: new Map([['PROJ-1', makeRaw('PROJ-1')]]),
      profile: 'prod',
      baseUrl: 'https://jira.example.com',
      cliToken: 'tl_test-key-123',
      fetcher: makeFetcher(201),
      print: (s) => lines.push(s),
    });
    assert.ok(result.ok);
    assert.equal(result.status, 201);
    assert.ok(lines.some(l => l.includes('Queue updated')));
    assert.ok(lines.some(l => l.includes('/console/queue')));
  });

  it('shows confirmation on 200', async () => {
    const lines = [];
    const result = await pushTriageSnapshot({
      sorted: [],
      profile: 'dev',
      cliToken: 'tl_key',
      fetcher: makeFetcher(200),
      print: (s) => lines.push(s),
    });
    assert.ok(result.ok);
    assert.equal(result.status, 200);
    assert.ok(lines.some(l => l.includes('Queue updated')));
  });
});

// ---------------------------------------------------------------------------
// HTTP errors — non-fatal
// ---------------------------------------------------------------------------

describe('pushTriageSnapshot — HTTP errors (non-fatal)', () => {
  it('shows Team license message on 403', async () => {
    const lines = [];
    const result = await pushTriageSnapshot({
      sorted: [],
      cliToken: 'tl_key',
      fetcher: makeFetcher(403),
      print: (s) => lines.push(s),
    });
    assert.ok(!result.ok);
    assert.equal(result.status, 403);
    assert.ok(lines.some(l => l.includes('--push requires a Team license')));
  });

  it('shows session-expired message on 401', async () => {
    const lines = [];
    const result = await pushTriageSnapshot({
      sorted: [],
      cliToken: 'tl_key',
      fetcher: makeFetcher(401),
      print: (s) => lines.push(s),
    });
    assert.ok(!result.ok);
    assert.equal(result.status, 401);
    assert.ok(lines.some(l => l.includes('Session expired') && l.includes('ticketlens login')));
  });

  it('shows warning on 500', async () => {
    const lines = [];
    const result = await pushTriageSnapshot({
      sorted: [],
      cliToken: 'tl_key',
      fetcher: makeFetcher(500),
      print: (s) => lines.push(s),
    });
    assert.ok(!result.ok);
    assert.ok(lines.some(l => l.includes('Push failed') || l.includes('push failed')));
  });

  it('shows warning on network error without throwing', async () => {
    const lines = [];
    const result = await pushTriageSnapshot({
      sorted: [],
      cliToken: 'tl_key',
      fetcher: async () => { throw new Error('ECONNREFUSED'); },
      print: (s) => lines.push(s),
    });
    assert.ok(!result.ok);
    assert.ok(lines.some(l => l.includes('Push failed') || l.includes('push failed')));
  });

  it('never rejects — push errors must not surface', async () => {
    await pushTriageSnapshot({
      sorted: [],
      cliToken: 'tl_key',
      fetcher: async () => { throw new TypeError('network broken'); },
      print: () => {},
    });
  });
});

// ---------------------------------------------------------------------------
// Payload shape
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// LOCK: git_branches absent when not provided — characterization test
// ---------------------------------------------------------------------------

describe('pushTriageSnapshot — LOCK: no git_branches by default', () => {
  it('payload does not include git_branches key when param is omitted', async () => {
    let capturedBody;
    await pushTriageSnapshot({
      sorted: [makeScored('PROJ-1')],
      rawTicketMap: new Map(),
      profile: 'default',
      cliToken: 'tl_k',
      fetcher: async (_url, opts) => {
        capturedBody = JSON.parse(opts.body);
        return { ok: true, status: 200 };
      },
      print: () => {},
    });
    assert.ok(!Object.prototype.hasOwnProperty.call(capturedBody, 'git_branches'), 'git_branches must be absent when not provided');
  });

  it('payload does not include git_branches key when param is undefined', async () => {
    let capturedBody;
    await pushTriageSnapshot({
      sorted: [],
      cliToken: 'tl_k',
      gitBranches: undefined,
      fetcher: async (_url, opts) => {
        capturedBody = JSON.parse(opts.body);
        return { ok: true, status: 200 };
      },
      print: () => {},
    });
    assert.ok(!Object.prototype.hasOwnProperty.call(capturedBody, 'git_branches'), 'git_branches must be absent when undefined');
  });
});

// ---------------------------------------------------------------------------

describe('pushTriageSnapshot — payload shape', () => {
  it('sends correct JSON payload structure', async () => {
    let capturedBody;
    const now = '2026-05-11T10:00:00.000Z';
    await pushTriageSnapshot({
      sorted: [makeScored('PROJ-1', 'needs-response'), makeScored('PROJ-2', 'aging')],
      rawTicketMap: new Map([
        ['PROJ-1', makeRaw('PROJ-1', { assignee: 'Alice', updated: '2026-05-10T09:00:00Z' })],
        ['PROJ-2', makeRaw('PROJ-2', { assignee: 'Bob',   updated: '2026-05-09T08:00:00Z' })],
      ]),
      profile: 'production',
      baseUrl: 'https://jira.example.com',
      cliToken: 'tl_k',
      capturedAt: now,
      fetcher: async (_url, opts) => {
        capturedBody = JSON.parse(opts.body);
        return { ok: true, status: 201 };
      },
      print: () => {},
    });
    assert.equal(capturedBody.profile, 'production');
    assert.equal(capturedBody.captured_at, now);
    assert.equal(capturedBody.tickets.length, 2);

    const t1 = capturedBody.tickets.find(t => t.key === 'PROJ-1');
    assert.equal(t1.key, 'PROJ-1');
    assert.equal(t1.summary, 'Summary of PROJ-1');
    assert.equal(t1.status, 'Code Review');
    assert.equal(t1.assignee, 'Alice');
    assert.equal(t1.attention_score, null);
    assert.deepEqual(t1.flags, ['needs-response']);
    assert.equal(t1.compliance_coverage, null);
    assert.equal(t1.compliance_status, 'unknown');
    assert.equal(t1.url, 'https://jira.example.com/browse/PROJ-1');
    assert.equal(t1.last_updated, '2026-05-10T09:00:00Z');

    const t2 = capturedBody.tickets.find(t => t.key === 'PROJ-2');
    assert.deepEqual(t2.flags, ['aging']);
  });

  it('sends Authorization: Bearer header', async () => {
    let capturedHeaders;
    await pushTriageSnapshot({
      sorted: [],
      cliToken: 'tl_my-secret-key',
      fetcher: async (_url, opts) => {
        capturedHeaders = opts.headers;
        return { ok: true, status: 201 };
      },
      print: () => {},
    });
    assert.equal(capturedHeaders.Authorization, 'Bearer tl_my-secret-key');
    assert.equal(capturedHeaders['Content-Type'], 'application/json');
  });

  it('truncates profile name to 100 characters', async () => {
    let capturedBody;
    await pushTriageSnapshot({
      sorted: [],
      profile: 'x'.repeat(200),
      cliToken: 'tl_k',
      fetcher: async (_url, opts) => {
        capturedBody = JSON.parse(opts.body);
        return { ok: true, status: 201 };
      },
      print: () => {},
    });
    assert.equal(capturedBody.profile.length, 100);
  });

  it('uses capturedAt param when provided', async () => {
    let capturedBody;
    const fixedTime = '2026-05-11T10:00:00.000Z';
    await pushTriageSnapshot({
      sorted: [],
      cliToken: 'tl_k',
      capturedAt: fixedTime,
      fetcher: async (_url, opts) => {
        capturedBody = JSON.parse(opts.body);
        return { ok: true, status: 201 };
      },
      print: () => {},
    });
    assert.equal(capturedBody.captured_at, fixedTime);
  });

  it('uses current ISO timestamp when capturedAt not provided', async () => {
    let capturedBody;
    const before = new Date().toISOString();
    await pushTriageSnapshot({
      sorted: [],
      cliToken: 'tl_k',
      fetcher: async (_url, opts) => {
        capturedBody = JSON.parse(opts.body);
        return { ok: true, status: 201 };
      },
      print: () => {},
    });
    const after = new Date().toISOString();
    assert.ok(capturedBody.captured_at >= before, 'timestamp should be >= test start');
    assert.ok(capturedBody.captured_at <= after, 'timestamp should be <= test end');
  });

  it('maps clear urgency to empty flags array', async () => {
    let capturedBody;
    await pushTriageSnapshot({
      sorted: [makeScored('PROJ-1', 'clear')],
      rawTicketMap: new Map(),
      cliToken: 'tl_k',
      fetcher: async (_url, opts) => {
        capturedBody = JSON.parse(opts.body);
        return { ok: true, status: 201 };
      },
      print: () => {},
    });
    assert.deepEqual(capturedBody.tickets[0].flags, []);
  });

  it('handles missing raw ticket — assignee and last_updated are null', async () => {
    let capturedBody;
    await pushTriageSnapshot({
      sorted: [makeScored('PROJ-99')],
      rawTicketMap: new Map(),
      cliToken: 'tl_k',
      baseUrl: 'https://jira.example.com',
      fetcher: async (_url, opts) => {
        capturedBody = JSON.parse(opts.body);
        return { ok: true, status: 201 };
      },
      print: () => {},
    });
    const t = capturedBody.tickets[0];
    assert.equal(t.assignee, null);
    assert.equal(t.last_updated, null);
    assert.equal(t.url, 'https://jira.example.com/browse/PROJ-99');
  });

  it('constructs URL from baseUrl and ticket key', async () => {
    let capturedBody;
    await pushTriageSnapshot({
      sorted: [makeScored('MYPROJ-42')],
      rawTicketMap: new Map(),
      baseUrl: 'https://company.atlassian.net',
      cliToken: 'tl_k',
      fetcher: async (_url, opts) => {
        capturedBody = JSON.parse(opts.body);
        return { ok: true, status: 201 };
      },
      print: () => {},
    });
    assert.equal(capturedBody.tickets[0].url, 'https://company.atlassian.net/browse/MYPROJ-42');
  });

  it('sends to /v1/triage/push endpoint', async () => {
    let capturedUrl;
    await pushTriageSnapshot({
      sorted: [],
      cliToken: 'tl_k',
      fetcher: async (url) => {
        capturedUrl = url;
        return { ok: true, status: 201 };
      },
      print: () => {},
    });
    assert.ok(capturedUrl.endsWith('/v1/triage/push'), `Expected /v1/triage/push, got: ${capturedUrl}`);
  });

  it('attention_score is always null', async () => {
    let capturedBody;
    await pushTriageSnapshot({
      sorted: [makeScored('PROJ-1', 'needs-response')],
      rawTicketMap: new Map(),
      cliToken: 'tl_k',
      fetcher: async (_url, opts) => {
        capturedBody = JSON.parse(opts.body);
        return { ok: true, status: 201 };
      },
      print: () => {},
    });
    assert.equal(capturedBody.tickets[0].attention_score, null);
  });

  it('compliance_coverage is always null', async () => {
    let capturedBody;
    await pushTriageSnapshot({
      sorted: [makeScored('PROJ-1')],
      rawTicketMap: new Map(),
      cliToken: 'tl_k',
      isLicensedFn: () => false,
      fetcher: async (_url, opts) => {
        capturedBody = JSON.parse(opts.body);
        return { ok: true, status: 201 };
      },
      print: () => {},
    });
    assert.equal(capturedBody.tickets[0].compliance_coverage, null);
  });

  it('compliance_status is always unknown', async () => {
    let capturedBody;
    await pushTriageSnapshot({
      sorted: [makeScored('PROJ-1')],
      rawTicketMap: new Map(),
      cliToken: 'tl_k',
      isLicensedFn: () => false,
      fetcher: async (_url, opts) => {
        capturedBody = JSON.parse(opts.body);
        return { ok: true, status: 201 };
      },
      print: () => {},
    });
    assert.equal(capturedBody.tickets[0].compliance_status, 'unknown');
  });
});

// ---------------------------------------------------------------------------
// LOCK: compliance defaults when no ledger data
// ---------------------------------------------------------------------------

describe('pushTriageSnapshot — LOCK: compliance defaults without ledger entry', () => {
  it('compliance_status is unknown when ledger has no entry for the ticket key', async () => {
    let capturedBody;
    await pushTriageSnapshot({
      sorted: [makeScored('PROJ-1')],
      rawTicketMap: new Map(),
      cliToken: 'tl_k',
      isLicensedFn: () => true,
      readLedgerFn: () => [],
      fetcher: async (_url, opts) => {
        capturedBody = JSON.parse(opts.body);
        return { ok: true, status: 201 };
      },
      print: () => {},
    });
    assert.equal(capturedBody.tickets[0].compliance_status, 'unknown');
  });

  it('compliance_coverage is null when ledger has no entry for the ticket key', async () => {
    let capturedBody;
    await pushTriageSnapshot({
      sorted: [makeScored('PROJ-1')],
      rawTicketMap: new Map(),
      cliToken: 'tl_k',
      isLicensedFn: () => true,
      readLedgerFn: () => [],
      fetcher: async (_url, opts) => {
        capturedBody = JSON.parse(opts.body);
        return { ok: true, status: 201 };
      },
      print: () => {},
    });
    assert.equal(capturedBody.tickets[0].compliance_coverage, null);
  });

  it('readLedgerFn is not called when isLicensedFn returns false', async () => {
    let ledgerCalled = false;
    await pushTriageSnapshot({
      sorted: [makeScored('PROJ-1')],
      rawTicketMap: new Map(),
      cliToken: 'tl_k',
      isLicensedFn: () => false,
      readLedgerFn: () => { ledgerCalled = true; return []; },
      fetcher: async () => ({ ok: true, status: 201 }),
      print: () => {},
    });
    assert.ok(!ledgerCalled, 'readLedger must not be called for non-Pro users');
  });
});

// ---------------------------------------------------------------------------
// Compliance ledger enrichment
// ---------------------------------------------------------------------------

describe('pushTriageSnapshot — compliance enrichment from ledger', () => {
  function makeLedgerEntry(ticketKey, coverage, missing = []) {
    return { ts: '2026-05-20T10:00:00.000Z', ticketKey, commitSha: 'abc1234', author: 'dev', coverage, missing };
  }

  it('sets compliance_status to pass when ledger entry has empty missing array', async () => {
    let capturedBody;
    await pushTriageSnapshot({
      sorted: [makeScored('PROJ-1')],
      rawTicketMap: new Map(),
      cliToken: 'tl_k',
      isLicensedFn: () => true,
      readLedgerFn: () => [makeLedgerEntry('PROJ-1', 100, [])],
      fetcher: async (_url, opts) => {
        capturedBody = JSON.parse(opts.body);
        return { ok: true, status: 201 };
      },
      print: () => {},
    });
    assert.equal(capturedBody.tickets[0].compliance_status, 'pass');
  });

  it('sets compliance_status to gap when ledger entry has non-empty missing array', async () => {
    let capturedBody;
    await pushTriageSnapshot({
      sorted: [makeScored('PROJ-1')],
      rawTicketMap: new Map(),
      cliToken: 'tl_k',
      isLicensedFn: () => true,
      readLedgerFn: () => [makeLedgerEntry('PROJ-1', 60, ['req-A', 'req-B'])],
      fetcher: async (_url, opts) => {
        capturedBody = JSON.parse(opts.body);
        return { ok: true, status: 201 };
      },
      print: () => {},
    });
    assert.equal(capturedBody.tickets[0].compliance_status, 'gap');
  });

  it('sets compliance_coverage from ledger entry coverage value', async () => {
    let capturedBody;
    await pushTriageSnapshot({
      sorted: [makeScored('PROJ-1')],
      rawTicketMap: new Map(),
      cliToken: 'tl_k',
      isLicensedFn: () => true,
      readLedgerFn: () => [makeLedgerEntry('PROJ-1', 75, ['req-A'])],
      fetcher: async (_url, opts) => {
        capturedBody = JSON.parse(opts.body);
        return { ok: true, status: 201 };
      },
      print: () => {},
    });
    assert.equal(capturedBody.tickets[0].compliance_coverage, 75);
  });

  it('leaves compliance_status unknown for ticket keys not in ledger', async () => {
    let capturedBody;
    await pushTriageSnapshot({
      sorted: [makeScored('PROJ-1'), makeScored('PROJ-2')],
      rawTicketMap: new Map(),
      cliToken: 'tl_k',
      isLicensedFn: () => true,
      readLedgerFn: () => [makeLedgerEntry('PROJ-1', 100, [])],
      fetcher: async (_url, opts) => {
        capturedBody = JSON.parse(opts.body);
        return { ok: true, status: 201 };
      },
      print: () => {},
    });
    assert.equal(capturedBody.tickets.find(t => t.key === 'PROJ-1').compliance_status, 'pass');
    assert.equal(capturedBody.tickets.find(t => t.key === 'PROJ-2').compliance_status, 'unknown');
  });

  it('uses most recent ledger entry when multiple entries exist for same key', async () => {
    let capturedBody;
    const entries = [
      { ts: '2026-05-18T10:00:00.000Z', ticketKey: 'PROJ-1', commitSha: 'old', author: 'dev', coverage: 50, missing: ['req-A'] },
      { ts: '2026-05-20T10:00:00.000Z', ticketKey: 'PROJ-1', commitSha: 'new', author: 'dev', coverage: 100, missing: [] },
      { ts: '2026-05-19T10:00:00.000Z', ticketKey: 'PROJ-1', commitSha: 'mid', author: 'dev', coverage: 75, missing: ['req-B'] },
    ];
    await pushTriageSnapshot({
      sorted: [makeScored('PROJ-1')],
      rawTicketMap: new Map(),
      cliToken: 'tl_k',
      isLicensedFn: () => true,
      readLedgerFn: () => entries,
      fetcher: async (_url, opts) => {
        capturedBody = JSON.parse(opts.body);
        return { ok: true, status: 201 };
      },
      print: () => {},
    });
    assert.equal(capturedBody.tickets[0].compliance_status, 'pass');
    assert.equal(capturedBody.tickets[0].compliance_coverage, 100);
  });

  it('compliance_coverage is null when ledger entry has no coverage field', async () => {
    let capturedBody;
    const entry = { ts: '2026-05-20T10:00:00.000Z', ticketKey: 'PROJ-1', commitSha: 'abc', author: 'dev', missing: [] };
    await pushTriageSnapshot({
      sorted: [makeScored('PROJ-1')],
      rawTicketMap: new Map(),
      cliToken: 'tl_k',
      isLicensedFn: () => true,
      readLedgerFn: () => [entry],
      fetcher: async (_url, opts) => {
        capturedBody = JSON.parse(opts.body);
        return { ok: true, status: 201 };
      },
      print: () => {},
    });
    assert.equal(capturedBody.tickets[0].compliance_coverage, null);
  });

  it('push succeeds even when readLedgerFn throws', async () => {
    const lines = [];
    const result = await pushTriageSnapshot({
      sorted: [makeScored('PROJ-1')],
      rawTicketMap: new Map(),
      cliToken: 'tl_k',
      isLicensedFn: () => true,
      readLedgerFn: () => { throw new Error('ledger read error'); },
      fetcher: async () => ({ ok: true, status: 201 }),
      print: (s) => lines.push(s),
    });
    assert.ok(result.ok, 'push must succeed even when ledger throws');
  });

  it('push output is not disrupted when ledger throws', async () => {
    const lines = [];
    await pushTriageSnapshot({
      sorted: [],
      cliToken: 'tl_k',
      isLicensedFn: () => true,
      readLedgerFn: () => { throw new Error('ledger error'); },
      fetcher: async () => ({ ok: true, status: 200 }),
      print: (s) => lines.push(s),
    });
    assert.ok(lines.some(l => l.includes('Queue updated')));
  });
});

// ---------------------------------------------------------------------------
// git_branches in payload
// ---------------------------------------------------------------------------

describe('pushTriageSnapshot — git_branches', () => {
  const sampleBranches = [
    { branch: 'feat/PROJ-123-checkout', base: 'origin/main', tickets: ['PROJ-123'], files: ['src/checkout.js'] },
  ];

  it('includes git_branches in payload when provided', async () => {
    let capturedBody;
    await pushTriageSnapshot({
      sorted: [],
      cliToken: 'tl_k',
      gitBranches: sampleBranches,
      fetcher: async (_url, opts) => {
        capturedBody = JSON.parse(opts.body);
        return { ok: true, status: 200 };
      },
      print: () => {},
    });
    assert.deepEqual(capturedBody.git_branches, sampleBranches);
  });

  it('git_branches null value omits key from payload', async () => {
    let capturedBody;
    await pushTriageSnapshot({
      sorted: [],
      cliToken: 'tl_k',
      gitBranches: null,
      fetcher: async (_url, opts) => {
        capturedBody = JSON.parse(opts.body);
        return { ok: true, status: 200 };
      },
      print: () => {},
    });
    assert.ok(!Object.prototype.hasOwnProperty.call(capturedBody, 'git_branches'));
  });

  it('git_branches empty array is included in payload', async () => {
    let capturedBody;
    await pushTriageSnapshot({
      sorted: [],
      cliToken: 'tl_k',
      gitBranches: [],
      fetcher: async (_url, opts) => {
        capturedBody = JSON.parse(opts.body);
        return { ok: true, status: 200 };
      },
      print: () => {},
    });
    assert.ok(Object.prototype.hasOwnProperty.call(capturedBody, 'git_branches'));
    assert.deepEqual(capturedBody.git_branches, []);
  });

  it('git_branches with multiple entries are all sent', async () => {
    const branches = [
      { branch: 'feat/A-1', base: 'origin/main', tickets: ['A-1'], files: ['a.js'] },
      { branch: 'feat/B-2', base: 'origin/main', tickets: ['B-2'], files: ['b.js'] },
    ];
    let capturedBody;
    await pushTriageSnapshot({
      sorted: [],
      cliToken: 'tl_k',
      gitBranches: branches,
      fetcher: async (_url, opts) => {
        capturedBody = JSON.parse(opts.body);
        return { ok: true, status: 200 };
      },
      print: () => {},
    });
    assert.equal(capturedBody.git_branches.length, 2);
  });

  it('success/failure outcome unchanged when git_branches provided', async () => {
    const result = await pushTriageSnapshot({
      sorted: [],
      cliToken: 'tl_k',
      gitBranches: sampleBranches,
      fetcher: async () => ({ ok: true, status: 200 }),
      print: () => {},
    });
    assert.ok(result.ok);
  });

  it('push still succeeds on network error regardless of git_branches', async () => {
    const result = await pushTriageSnapshot({
      sorted: [],
      cliToken: 'tl_k',
      gitBranches: sampleBranches,
      fetcher: async () => { throw new Error('ECONNREFUSED'); },
      print: () => {},
    });
    assert.ok(!result.ok);
  });
});

describe('pushTriageSnapshot — http warning (item 3)', () => {
  afterEach(() => { delete process.env.TICKETLENS_API_URL; });

  it('calls warn when TICKETLENS_API_URL is http:// with a non-local host', async () => {
    process.env.TICKETLENS_API_URL = 'http://prod.example.com';
    const warnings = [];
    await pushTriageSnapshot({
      sorted: [],
      cliToken: 'tl_k',
      fetcher: async () => ({ ok: true, json: async () => ({}) }),
      print: () => {},
      warn: msg => warnings.push(msg),
    });
    assert.ok(warnings.length > 0, 'warn must be called for http:// non-local URL');
    assert.ok(warnings[0].includes('HTTP'), 'warning must mention HTTP');
  });

  it('does NOT warn for http://ticketlens.test (local .test domain)', async () => {
    process.env.TICKETLENS_API_URL = 'http://ticketlens.test';
    const warnings = [];
    await pushTriageSnapshot({
      sorted: [],
      cliToken: 'tl_k',
      fetcher: async () => ({ ok: true, json: async () => ({}) }),
      print: () => {},
      warn: msg => warnings.push(msg),
    });
    assert.equal(warnings.length, 0, 'no warning for .test local domain');
  });
});

// ---------------------------------------------------------------------------
// RED: cliToken guard (new behavior — fails until source is updated)
// ---------------------------------------------------------------------------

describe('pushTriageSnapshot — cliToken guard (new auth)', () => {
  it('no-token message says "requires Console access. Run ticketlens login first"', async () => {
    const lines = [];
    const result = await pushTriageSnapshot({
      sorted: [],
      cliToken: null,
      fetcher: async () => { throw new Error('must not call'); },
      print: s => lines.push(s),
    });
    assert.ok(!result.ok);
    assert.ok(lines.some(l => l.includes('requires Console access')), `got: ${lines.join(' ')}`);
    assert.ok(lines.some(l => l.includes('ticketlens login')), `got: ${lines.join(' ')}`);
  });

  it('401 response says "Session expired. Run ticketlens login to reconnect"', async () => {
    const lines = [];
    await pushTriageSnapshot({
      sorted: [],
      cliToken: 'tl_test',
      fetcher: async () => ({ ok: false, status: 401 }),
      print: s => lines.push(s),
    });
    assert.ok(lines.some(l => l.includes('Session expired')), `got: ${lines.join(' ')}`);
    assert.ok(lines.some(l => l.includes('ticketlens login')), `got: ${lines.join(' ')}`);
  });

  it('sends Authorization: Bearer <cliToken> in header', async () => {
    let headers;
    await pushTriageSnapshot({
      sorted: [],
      cliToken: 'tl_mytoken',
      fetcher: async (_url, opts) => { headers = opts.headers; return { ok: true, status: 200 }; },
      print: () => {},
    });
    assert.equal(headers.Authorization, 'Bearer tl_mytoken');
  });
});
