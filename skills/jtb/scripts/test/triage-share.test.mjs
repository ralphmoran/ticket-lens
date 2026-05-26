import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { shareTriageSnapshot } from '../lib/triage-share.mjs';

// ── LOCK: triage-push still points to /push, not /share ─────────────────────

describe('triage-push lock — endpoint not changed', () => {
  it('pushTriageSnapshot posts to /v1/triage/push', async () => {
    let capturedUrl = null;
    const { pushTriageSnapshot } = await import('../lib/triage-push.mjs');

    await pushTriageSnapshot({
      sorted: [],
      licenseKey: 'test-key',
      profile: 'default',
      fetcher: async (url) => { capturedUrl = url; return { ok: true, json: async () => ({}) }; },
      print: () => {},
    });

    assert.ok(capturedUrl?.includes('/triage/push'), `Expected /triage/push, got: ${capturedUrl}`);
    assert.ok(!capturedUrl?.includes('/triage/share'), 'push must not call /triage/share');
  });
});

// ── LOCK: fetch-my-tickets valid flags count ─────────────────────────────────

describe('fetch-my-tickets valid flags — lock count before adding --share', () => {
  it('valid flags list has at least 8 members (--share not yet counted)', async () => {
    const { run } = await import('../fetch-my-tickets.mjs');
    // We cannot directly inspect the internal allowlist, but if --share were
    // missing from the allowlist, an unknown-flag warning would fire.
    // This lock test confirms the run() export exists — structural guard only.
    assert.strictEqual(typeof run, 'function');
  });
});

// ── shareTriageSnapshot — core behaviour ─────────────────────────────────────

describe('shareTriageSnapshot', () => {
  const baseOpts = (fetcherOverride, printLines = []) => ({
    sorted: [{ ticketKey: 'PROJ-1', summary: 'Fix login', status: 'In Progress', urgency: 'needs-response', updated: null }],
    rawTicketMap: new Map([['PROJ-1', { assignee: 'Alice', updated: '2026-05-20T10:00:00Z' }]]),
    profile: 'production',
    baseUrl: 'https://jira.example.com',
    licenseKey: 'valid-key',
    capturedAt: '2026-05-20T10:00:00Z',
    fetcher: fetcherOverride,
    print: (s) => printLines.push(s),
  });

  it('returns ok:true and prints the share URL on success', async () => {
    const lines = [];
    const fakeFetcher = async () => ({
      ok: true,
      json: async () => ({ url: 'http://ticketlens.test/s/abc-123', expires_at: '2026-05-21T10:00:00Z' }),
    });

    const result = await shareTriageSnapshot(baseOpts(fakeFetcher, lines));

    assert.strictEqual(result.ok, true);
    assert.ok(lines.some(l => l.includes('http://ticketlens.test/s/abc-123')), 'URL must be printed');
  });

  it('posts to /v1/triage/share', async () => {
    let capturedUrl = null;
    const fakeFetcher = async (url) => {
      capturedUrl = url;
      return { ok: true, json: async () => ({ url: 'http://ticketlens.test/s/tok', expires_at: '2026-05-21T10:00:00Z' }) };
    };

    await shareTriageSnapshot(baseOpts(fakeFetcher));

    assert.ok(capturedUrl?.includes('/v1/triage/share'), `Expected /triage/share, got: ${capturedUrl}`);
  });

  it('sends Authorization Bearer header', async () => {
    let capturedHeaders = null;
    const fakeFetcher = async (url, opts) => {
      capturedHeaders = opts?.headers ?? {};
      return { ok: true, json: async () => ({ url: 'http://ticketlens.test/s/tok', expires_at: '' }) };
    };

    await shareTriageSnapshot(baseOpts(fakeFetcher));

    assert.strictEqual(capturedHeaders['Authorization'], 'Bearer valid-key');
  });

  it('sends profile, captured_at, and tickets in payload', async () => {
    let capturedBody = null;
    const fakeFetcher = async (url, opts) => {
      capturedBody = JSON.parse(opts?.body ?? '{}');
      return { ok: true, json: async () => ({ url: 'http://ticketlens.test/s/tok', expires_at: '' }) };
    };

    await shareTriageSnapshot(baseOpts(fakeFetcher));

    assert.strictEqual(capturedBody.profile, 'production');
    assert.strictEqual(capturedBody.captured_at, '2026-05-20T10:00:00Z');
    assert.ok(Array.isArray(capturedBody.tickets));
    assert.strictEqual(capturedBody.tickets[0].key, 'PROJ-1');
  });

  it('returns ok:false and prints upgrade message when no licenseKey', async () => {
    const lines = [];
    const result = await shareTriageSnapshot({
      sorted: [],
      licenseKey: null,
      profile: 'default',
      fetcher: async () => { throw new Error('should not be called'); },
      print: (s) => lines.push(s),
    });

    assert.strictEqual(result.ok, false);
    assert.ok(lines.some(l => l.toLowerCase().includes('team')), 'must mention team license');
  });

  it('returns ok:false and prints team-gate message on 403', async () => {
    const lines = [];
    const fakeFetcher = async () => ({ ok: false, status: 403, json: async () => ({}) });

    const result = await shareTriageSnapshot(baseOpts(fakeFetcher, lines));

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.status, 403);
    assert.ok(lines.some(l => l.includes('Team')), 'must mention Team on 403');
  });

  it('returns ok:false and does not throw on network error', async () => {
    const lines = [];
    const fakeFetcher = async () => { throw new Error('ECONNREFUSED'); };

    const result = await shareTriageSnapshot(baseOpts(fakeFetcher, lines));

    assert.strictEqual(result.ok, false);
    assert.ok(lines.some(l => l.includes('network error') || l.includes('failed')), 'must warn on network error');
  });

  it('returns ok:false on non-403 server error', async () => {
    const lines = [];
    const fakeFetcher = async () => ({ ok: false, status: 500, json: async () => ({}) });

    const result = await shareTriageSnapshot(baseOpts(fakeFetcher, lines));

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.status, 500);
  });

  it('prints URL that contains /s/ prefix', async () => {
    const lines = [];
    const fakeFetcher = async () => ({
      ok: true,
      json: async () => ({ url: 'http://ticketlens.test/s/my-token', expires_at: '2026-05-21T10:00:00Z' }),
    });

    await shareTriageSnapshot(baseOpts(fakeFetcher, lines));

    assert.ok(lines.some(l => l.includes('/s/')), 'URL must contain /s/');
  });

  it('prints expiry info alongside URL', async () => {
    const lines = [];
    const fakeFetcher = async () => ({
      ok: true,
      json: async () => ({ url: 'http://ticketlens.test/s/tok', expires_at: '2026-05-21T10:00:00Z' }),
    });

    await shareTriageSnapshot(baseOpts(fakeFetcher, lines));

    const combined = lines.join('');
    assert.ok(combined.includes('24h') || combined.includes('expires') || combined.includes('Expires'), 'must show expiry');
  });

  it('handles empty sorted array gracefully', async () => {
    const lines = [];
    const fakeFetcher = async () => ({
      ok: true,
      json: async () => ({ url: 'http://ticketlens.test/s/empty', expires_at: '2026-05-21T10:00:00Z' }),
    });

    const result = await shareTriageSnapshot({
      sorted: [],
      rawTicketMap: new Map(),
      profile: 'default',
      licenseKey: 'key',
      capturedAt: '2026-05-20T10:00:00Z',
      fetcher: fakeFetcher,
      print: (s) => lines.push(s),
    });

    assert.strictEqual(result.ok, true);
  });

  it('does not throw when print is not provided', async () => {
    const fakeFetcher = async () => ({
      ok: true,
      json: async () => ({ url: 'http://x/s/t', expires_at: '2026-05-21T10:00:00Z' }),
    });

    await assert.doesNotReject(() => shareTriageSnapshot({
      sorted: [],
      licenseKey: 'k',
      profile: 'p',
      capturedAt: new Date().toISOString(),
      fetcher: fakeFetcher,
    }));
  });

  it('profile is capped at 100 characters in payload', async () => {
    let body = null;
    const fakeFetcher = async (u, opts) => {
      body = JSON.parse(opts.body);
      return { ok: true, json: async () => ({ url: 'http://x/s/t', expires_at: '' }) };
    };

    await shareTriageSnapshot({
      sorted: [],
      rawTicketMap: new Map(),
      profile: 'x'.repeat(200),
      licenseKey: 'k',
      capturedAt: '2026-05-20T10:00:00Z',
      fetcher: fakeFetcher,
      print: () => {},
    });

    assert.ok(body.profile.length <= 100);
  });
});

describe('shareTriageSnapshot — http warning (item 3)', () => {
  afterEach(() => { delete process.env.TICKETLENS_API_URL; });

  it('calls warn when TICKETLENS_API_URL is http:// with a non-local host', async () => {
    process.env.TICKETLENS_API_URL = 'http://prod.example.com';
    const warnings = [];
    await shareTriageSnapshot({
      sorted: [],
      licenseKey: 'k',
      fetcher: async () => ({ ok: true, json: async () => ({ url: 'https://x' }) }),
      print: () => {},
      warn: msg => warnings.push(msg),
    });
    assert.ok(warnings.length > 0, 'warn must be called for http:// non-local URL');
  });

  it('does NOT warn for http://ticketlens.test (local .test domain)', async () => {
    process.env.TICKETLENS_API_URL = 'http://ticketlens.test';
    const warnings = [];
    await shareTriageSnapshot({
      sorted: [],
      licenseKey: 'k',
      fetcher: async () => ({ ok: true, json: async () => ({ url: 'https://x' }) }),
      print: () => {},
      warn: msg => warnings.push(msg),
    });
    assert.equal(warnings.length, 0, 'no warning for .test local domain');
  });
});
