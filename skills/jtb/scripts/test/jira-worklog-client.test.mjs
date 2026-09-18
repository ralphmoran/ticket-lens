import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { postWorklog } from '../lib/jira-worklog-client.mjs';

describe('postWorklog', () => {
  const ENV = { JIRA_BASE_URL: 'https://example.atlassian.net', JIRA_EMAIL: 'user@example.com', JIRA_API_TOKEN: 'tok' };
  const STARTED = '2026-09-18T10:00:00.000+0000';
  const created = { id: '501', timeSpent: '1h 30m' };

  function capturingFetcher(response = { ok: true, json: async () => created }) {
    const calls = [];
    const fetcher = async (url, opts) => { calls.push({ url, opts, body: opts.body ? JSON.parse(opts.body) : undefined }); return response; };
    return { fetcher, calls };
  }

  it('POSTs timeSpentSeconds and started to /issue/{key}/worklog — never the timeSpent string', async () => {
    const { fetcher, calls } = capturingFetcher();
    await postWorklog('PROJ-1', { timeSpentSeconds: 5400, started: STARTED }, { env: ENV, apiVersion: 2, fetcher });
    assert.equal(calls[0].opts.method, 'POST');
    assert.match(calls[0].url, /\/rest\/api\/2\/issue\/PROJ-1\/worklog$/);
    assert.deepEqual(calls[0].body, { timeSpentSeconds: 5400, started: STARTED });
  });

  it('sends a plain-string comment on v2 (Server/DC)', async () => {
    const { fetcher, calls } = capturingFetcher();
    await postWorklog('PROJ-1', { timeSpentSeconds: 60, started: STARTED, comment: 'Fixed login' }, { env: ENV, apiVersion: 2, fetcher });
    assert.equal(calls[0].body.comment, 'Fixed login');
  });

  it('wraps the comment in ADF on v3 (Cloud) — a plain string is rejected by the real API', async () => {
    const { fetcher, calls } = capturingFetcher();
    await postWorklog('PROJ-1', { timeSpentSeconds: 60, started: STARTED, comment: 'Fixed login' }, { env: ENV, apiVersion: 3, fetcher });
    assert.equal(calls[0].body.comment.type, 'doc');
    assert.equal(calls[0].body.comment.content[0].content[0].text, 'Fixed login');
  });

  it('omits the comment key entirely when no comment is given', async () => {
    const { fetcher, calls } = capturingFetcher();
    await postWorklog('PROJ-1', { timeSpentSeconds: 60, started: STARTED }, { env: ENV, apiVersion: 3, fetcher });
    assert.equal('comment' in calls[0].body, false);
  });

  it('authenticates with the same header builder as every other write', async () => {
    const { fetcher, calls } = capturingFetcher();
    await postWorklog('PROJ-1', { timeSpentSeconds: 60, started: STARTED }, { env: { ...ENV, JIRA_PAT: 'pat-1' }, fetcher });
    assert.equal(calls[0].opts.headers.Authorization, 'Bearer pat-1');
  });

  for (const bad of ['PROJ-1/../../x', '..', 'proj-1', 'PROJ-1?x=1', 'PROJ-1\n', '', undefined]) {
    it(`refuses the ticket key ${JSON.stringify(bad)} before any network call — the client guards itself, not just its callers`, async () => {
      const { fetcher, calls } = capturingFetcher();
      await assert.rejects(() => postWorklog(bad, { timeSpentSeconds: 60, started: STARTED }, { env: ENV, fetcher }), /ticket key/);
      assert.equal(calls.length, 0);
    });
  }

  it('drops a worklog id that is not purely numeric — Jira-supplied text never reaches a terminal or the audit log', async () => {
    const { fetcher } = capturingFetcher({ ok: true, json: async () => ({ id: '5\x1b]52;c;evil\x07', timeSpent: '1h' }) });
    const result = await postWorklog('PROJ-1', { timeSpentSeconds: 3600, started: STARTED }, { env: ENV, fetcher });
    assert.equal(result.id, undefined);
    assert.doesNotMatch(result.url, /focusedWorklogId/);
    assert.doesNotMatch(JSON.stringify(result), /\x1b|\\u001b/);
  });

  it('strips terminal control characters from Jira\'s error text — an OSC/escape sequence must not reach the caller\'s terminal', async () => {
    const { fetcher } = capturingFetcher({ ok: false, status: 400, json: async () => ({ errorMessages: ['bad \x1b]52;c;ZXZpbA==\x07 input'], errors: { started: '\x1b[2Jboom' } }) });
    await assert.rejects(
      () => postWorklog('PROJ-1', { timeSpentSeconds: 60, started: STARTED }, { env: ENV, fetcher }),
      (err) => !/[\x00-\x08\x0b-\x1f\x7f-\x9f]/.test(err.message) && /bad/.test(err.message) && /boom/.test(err.message),
    );
  });

  it('returns the worklog id, Jira-normalized timeSpent, and a browsable focusedWorklogId url', async () => {
    const { fetcher } = capturingFetcher();
    const result = await postWorklog('PROJ-1', { timeSpentSeconds: 5400, started: STARTED }, { env: ENV, fetcher });
    assert.deepEqual(result, { id: '501', timeSpent: '1h 30m', url: 'https://example.atlassian.net/browse/PROJ-1?focusedWorklogId=501' });
  });

  it('throws with status and Jira\'s own error text on a 400 — time tracking disabled is not a generic failure', async () => {
    const { fetcher } = capturingFetcher({ ok: false, status: 400, json: async () => ({ errorMessages: ['Time tracking is disabled.'], errors: {} }) });
    await assert.rejects(
      () => postWorklog('PROJ-1', { timeSpentSeconds: 60, started: STARTED }, { env: ENV, fetcher }),
      (err) => err.status === 400 && /Time tracking is disabled/.test(err.message) && err.details?.errorMessages?.length === 1,
    );
  });

  it('surfaces field-level errors from Jira\'s `errors` map', async () => {
    const { fetcher } = capturingFetcher({ ok: false, status: 400, json: async () => ({ errorMessages: [], errors: { started: 'Invalid date' } }) });
    await assert.rejects(
      () => postWorklog('PROJ-1', { timeSpentSeconds: 60, started: STARTED }, { env: ENV, fetcher }),
      (err) => /started: Invalid date/.test(err.message),
    );
  });

  it('a 429 carries rateLimit with Retry-After seconds — Jira\'s client never set this before, so callers could not tell it from a terminal 4xx', async () => {
    const { fetcher } = capturingFetcher({ ok: false, status: 429, headers: { get: (n) => (n.toLowerCase() === 'retry-after' ? '30' : null) }, json: async () => ({}) });
    await assert.rejects(
      () => postWorklog('PROJ-1', { timeSpentSeconds: 60, started: STARTED }, { env: ENV, fetcher }),
      (err) => err.status === 429 && err.rateLimit?.retryAfterSeconds === 30,
    );
  });

  it('a 429 with no (or a non-numeric) Retry-After still marks rateLimit, with a null wait', async () => {
    for (const headers of [undefined, { get: () => null }, { get: () => 'Wed, 21 Oct 2026 07:28:00 GMT' }]) {
      const { fetcher } = capturingFetcher({ ok: false, status: 429, headers, json: async () => ({}) });
      await assert.rejects(
        () => postWorklog('PROJ-1', { timeSpentSeconds: 60, started: STARTED }, { env: ENV, fetcher }),
        (err) => err.status === 429 && err.rateLimit !== undefined && err.rateLimit.retryAfterSeconds === null,
      );
    }
  });

  it('a non-429 error does not set rateLimit', async () => {
    const { fetcher } = capturingFetcher({ ok: false, status: 403, json: async () => ({}) });
    await assert.rejects(
      () => postWorklog('PROJ-1', { timeSpentSeconds: 60, started: STARTED }, { env: ENV, fetcher }),
      (err) => err.rateLimit === undefined,
    );
  });

  it('a non-JSON error body still throws with the status, no crash', async () => {
    const { fetcher } = capturingFetcher({ ok: false, status: 502, json: async () => { throw new SyntaxError('not json'); } });
    await assert.rejects(
      () => postWorklog('PROJ-1', { timeSpentSeconds: 60, started: STARTED }, { env: ENV, fetcher }),
      (err) => err.status === 502 && err.details === undefined,
    );
  });

  for (const bad of [0, -60, 1.5, NaN, '3600', null, undefined]) {
    it(`refuses timeSpentSeconds=${String(bad)} before any network call — a raw-client misuse guard`, async () => {
      const { fetcher, calls } = capturingFetcher();
      await assert.rejects(() => postWorklog('PROJ-1', { timeSpentSeconds: bad, started: STARTED }, { env: ENV, fetcher }), /timeSpentSeconds/);
      assert.equal(calls.length, 0);
    });
  }

  it('refuses a missing started before any network call — Jira requires it on create', async () => {
    const { fetcher, calls } = capturingFetcher();
    await assert.rejects(() => postWorklog('PROJ-1', { timeSpentSeconds: 60 }, { env: ENV, fetcher }), /started/);
    assert.equal(calls.length, 0);
  });

  it('still blocks a private-IP-resolving host by default (SSRF guard inherited from guardedFetch)', async () => {
    const { fetcher } = capturingFetcher();
    const lookup = async () => [{ address: '10.0.0.5', family: 4 }];
    await assert.rejects(() => postWorklog('PROJ-1', { timeSpentSeconds: 60, started: STARTED }, { env: ENV, fetcher, lookup }), /blocked address/);
  });
});
