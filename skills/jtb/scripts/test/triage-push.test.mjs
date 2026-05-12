import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pushTriageSnapshot } from '../lib/triage-push.mjs';

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
// No license key
// ---------------------------------------------------------------------------

describe('pushTriageSnapshot — no license key', () => {
  it('shows no-key message and does not call fetcher', async () => {
    let fetchCalled = false;
    const lines = [];
    const result = await pushTriageSnapshot({
      sorted: [makeScored('PROJ-1')],
      rawTicketMap: new Map(),
      profile: 'default',
      licenseKey: null,
      fetcher: () => { fetchCalled = true; },
      print: (s) => lines.push(s),
    });
    assert.ok(!fetchCalled, 'fetcher must not be called without license key');
    assert.ok(lines.some(l => l.includes('--push requires an active Team license')));
    assert.equal(result.ok, false);
  });

  it('shows no-key message when licenseKey is empty string', async () => {
    const lines = [];
    await pushTriageSnapshot({
      sorted: [],
      licenseKey: '',
      print: (s) => lines.push(s),
    });
    assert.ok(lines.some(l => l.includes('--push requires an active Team license')));
  });

  it('shows ticketlens activate hint in no-key message', async () => {
    const lines = [];
    await pushTriageSnapshot({ sorted: [], licenseKey: null, print: (s) => lines.push(s) });
    assert.ok(lines.some(l => l.includes('ticketlens activate')));
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
      licenseKey: 'test-key-123',
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
      licenseKey: 'key',
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
      licenseKey: 'key',
      fetcher: makeFetcher(403),
      print: (s) => lines.push(s),
    });
    assert.ok(!result.ok);
    assert.equal(result.status, 403);
    assert.ok(lines.some(l => l.includes('--push requires a Team license')));
  });

  it('shows warning on 401', async () => {
    const lines = [];
    const result = await pushTriageSnapshot({
      sorted: [],
      licenseKey: 'key',
      fetcher: makeFetcher(401),
      print: (s) => lines.push(s),
    });
    assert.ok(!result.ok);
    assert.equal(result.status, 401);
    assert.ok(lines.some(l => l.includes('Push failed') || l.includes('push failed')));
  });

  it('shows warning on 500', async () => {
    const lines = [];
    const result = await pushTriageSnapshot({
      sorted: [],
      licenseKey: 'key',
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
      licenseKey: 'key',
      fetcher: async () => { throw new Error('ECONNREFUSED'); },
      print: (s) => lines.push(s),
    });
    assert.ok(!result.ok);
    assert.ok(lines.some(l => l.includes('Push failed') || l.includes('push failed')));
  });

  it('never rejects — push errors must not surface', async () => {
    await pushTriageSnapshot({
      sorted: [],
      licenseKey: 'key',
      fetcher: async () => { throw new TypeError('network broken'); },
      print: () => {},
    });
  });
});

// ---------------------------------------------------------------------------
// Payload shape
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
      licenseKey: 'k',
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
      licenseKey: 'my-secret-key',
      fetcher: async (_url, opts) => {
        capturedHeaders = opts.headers;
        return { ok: true, status: 201 };
      },
      print: () => {},
    });
    assert.equal(capturedHeaders.Authorization, 'Bearer my-secret-key');
    assert.equal(capturedHeaders['Content-Type'], 'application/json');
  });

  it('truncates profile name to 100 characters', async () => {
    let capturedBody;
    await pushTriageSnapshot({
      sorted: [],
      profile: 'x'.repeat(200),
      licenseKey: 'k',
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
      licenseKey: 'k',
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
      licenseKey: 'k',
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
      licenseKey: 'k',
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
      licenseKey: 'k',
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
      licenseKey: 'k',
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
      licenseKey: 'k',
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
      licenseKey: 'k',
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
      licenseKey: 'k',
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
      licenseKey: 'k',
      fetcher: async (_url, opts) => {
        capturedBody = JSON.parse(opts.body);
        return { ok: true, status: 201 };
      },
      print: () => {},
    });
    assert.equal(capturedBody.tickets[0].compliance_status, 'unknown');
  });
});
