import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { runConsensusCheck } from '../lib/consensus-checker.mjs';

const BRIEF = `
## Description
Payment form must validate email format.
Acceptance Criteria:
- Must validate email
- Must handle empty fields
`;

const TWO_PROVIDER_ROLE = {
  roles: [{ id: 1, label: 'Consensus', kind: 'consensus', providers: [{ id: 1, title: 'A' }, { id: 2, title: 'B' }] }],
};

const CONSENSUS_RESULT_BODY = {
  results: [
    { requirement: 'Must validate email', status: 'FOUND', evidence: null },
    { requirement: 'Must handle empty fields', status: 'NOT_FOUND', evidence: null },
  ],
  perAgent: [
    { title: 'A', round1Verdicts: ['FOUND', 'NOT_FOUND'], verdicts: ['FOUND', 'NOT_FOUND'] },
    { title: 'B', round1Verdicts: ['NOT_FOUND', 'NOT_FOUND'], verdicts: ['FOUND', 'NOT_FOUND'] },
  ],
  disagreedCount: 1,
  warnings: [],
};

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

/** Routes GET /v1/ai-provider-roles and POST /v1/consensus to injectable responses. */
function fakeFetcher({ rolesResponse = jsonResponse(200, TWO_PROVIDER_ROLE), consensusResponse = jsonResponse(200, CONSENSUS_RESULT_BODY) } = {}) {
  return async (url) => {
    if (url.includes('/v1/ai-provider-roles')) return rolesResponse;
    if (url.includes('/v1/consensus')) return consensusResponse;
    throw new Error(`unexpected fetch: ${url}`);
  };
}

function fakeStream() {
  const lines = [];
  return { write: (s) => lines.push(s), lines, isTTY: false };
}

function makeOpts(overrides = {}) {
  return {
    brief: BRIEF,
    ticketKey: 'PROJ-123',
    configDir: '/tmp/test-config',
    stream: fakeStream(),
    outStream: { write: () => {}, isTTY: false },
    forceYes: true,
    cliToken: 'tl_test_token',
    isLicensedFn: () => true,
    showUpgradeFn: () => {},
    extractRequirementsFn: () => ['Must validate email', 'Must handle empty fields'],
    findLinkedCommitsFn: () => ({ commits: [], branches: [], diff: '+validate(email)' }),
    fetcher: fakeFetcher(),
    ...overrides,
  };
}

describe('runConsensusCheck — license gate', () => {
  it('returns null and shows the Pro upsell when not licensed, without any network call', async () => {
    const showUpgradeFn = mock.fn();
    const fetcher = mock.fn(async () => { throw new Error('must not be called'); });
    const result = await runConsensusCheck(makeOpts({ isLicensedFn: () => false, showUpgradeFn, fetcher }));
    assert.equal(result, null);
    assert.equal(showUpgradeFn.mock.calls.length, 1);
    assert.equal(showUpgradeFn.mock.calls[0].arguments[0], 'pro');
  });
});

describe('runConsensusCheck — no acceptance criteria', () => {
  it('returns a no-criteria report without making any network calls', async () => {
    const fetcher = mock.fn(async () => { throw new Error('must not be called'); });
    const result = await runConsensusCheck(makeOpts({ extractRequirementsFn: () => [], fetcher }));
    assert.equal(result.noCriteria, true);
    assert.equal(fetcher.mock.calls.length, 0);
  });
});

describe('runConsensusCheck — auth', () => {
  it('returns null when no CLI token is available', async () => {
    const stream = fakeStream();
    const result = await runConsensusCheck(makeOpts({ cliToken: undefined, readCliTokenFn: () => null, stream }));
    assert.equal(result, null);
    assert.ok(stream.lines.some(l => l.includes('ticketlens login')));
  });
});

describe('runConsensusCheck — pre-flight role check', () => {
  it('returns null with an actionable message when no consensus role exists', async () => {
    const stream = fakeStream();
    const fetcher = fakeFetcher({ rolesResponse: jsonResponse(200, { roles: [] }) });
    const result = await runConsensusCheck(makeOpts({ fetcher, stream }));
    assert.equal(result, null);
    assert.ok(stream.lines.some(l => l.includes('No consensus role configured')));
  });

  it('returns null when the consensus role has fewer than 2 providers', async () => {
    const stream = fakeStream();
    const fetcher = fakeFetcher({
      rolesResponse: jsonResponse(200, { roles: [{ id: 1, label: 'Consensus', kind: 'consensus', providers: [{ id: 1, title: 'A' }] }] }),
    });
    const result = await runConsensusCheck(makeOpts({ fetcher, stream }));
    assert.equal(result, null);
    assert.ok(stream.lines.some(l => l.includes('needs at least 2 providers')));
  });

  it('returns null when the roles pre-flight request itself fails', async () => {
    const stream = fakeStream();
    const fetcher = fakeFetcher({ rolesResponse: jsonResponse(500, {}) });
    const result = await runConsensusCheck(makeOpts({ fetcher, stream }));
    assert.equal(result, null);
    assert.ok(stream.lines.some(l => l.includes('Could not reach TicketLens')));
  });
});

describe('runConsensusCheck — cost confirmation', () => {
  it('declines automatically in non-interactive mode without --yes, before the consensus call', async () => {
    const consensusResponse = mock.fn();
    const fetcher = async (url) => {
      if (url.includes('/v1/ai-provider-roles')) return jsonResponse(200, TWO_PROVIDER_ROLE);
      consensusResponse();
      throw new Error('must not reach /v1/consensus without confirmation');
    };
    const result = await runConsensusCheck(makeOpts({ forceYes: false, stdin: { isTTY: false }, fetcher }));
    assert.equal(result, null);
    assert.equal(consensusResponse.mock.calls.length, 0);
  });

  it('skips the prompt entirely when forceYes is true', async () => {
    const result = await runConsensusCheck(makeOpts({ forceYes: true }));
    assert.notEqual(result, null);
  });

  it('passes the real provider count from the pre-flight roles response to the confirm prompt', async () => {
    const confirmCostFn = mock.fn(async () => true);
    await runConsensusCheck(makeOpts({ forceYes: false, confirmCostFn }));
    assert.equal(confirmCostFn.mock.calls[0].arguments[0], 2);
  });
});

describe('runConsensusCheck — happy path', () => {
  it('sends ticketKey, diff, and requirements to /v1/consensus', async () => {
    let sentBody;
    const fetcher = async (url, opts) => {
      if (url.includes('/v1/ai-provider-roles')) return jsonResponse(200, TWO_PROVIDER_ROLE);
      sentBody = JSON.parse(opts.body);
      return jsonResponse(200, CONSENSUS_RESULT_BODY);
    };
    await runConsensusCheck(makeOpts({ fetcher }));
    assert.equal(sentBody.ticketKey, 'PROJ-123');
    assert.equal(sentBody.diff, '+validate(email)');
    assert.deepEqual(sentBody.requirements, ['Must validate email', 'Must handle empty fields']);
  });

  it('sends the Authorization bearer header with the CLI token', async () => {
    let sentHeaders;
    const fetcher = async (url, opts) => {
      if (url.includes('/v1/ai-provider-roles')) return jsonResponse(200, TWO_PROVIDER_ROLE);
      sentHeaders = opts.headers;
      return jsonResponse(200, CONSENSUS_RESULT_BODY);
    };
    await runConsensusCheck(makeOpts({ cliToken: 'tl_abc123', fetcher }));
    assert.equal(sentHeaders.Authorization, 'Bearer tl_abc123');
  });

  it('returns the reconciled results and coverage percent from the server response', async () => {
    const result = await runConsensusCheck(makeOpts());
    assert.equal(result.noCriteria, false);
    assert.equal(result.coveragePercent, 50); // 1 FOUND, 1 NOT_FOUND out of 2
    assert.equal(result.results[0].status, 'FOUND');
  });

  it('report includes the per-agent breakdown with round-1 to round-2 change annotation', async () => {
    const result = await runConsensusCheck(makeOpts());
    assert.match(result.report, /Per-agent breakdown/i);
    assert.match(result.report, /B:.*NOT_FOUND→FOUND/);
  });

  it('report is plain (no ANSI) when outStream is not a TTY', async () => {
    const result = await runConsensusCheck(makeOpts());
    assert.doesNotMatch(result.report, /\x1b\[/);
  });

  it('surfaces server-reported warnings to the stream', async () => {
    const stream = fakeStream();
    const fetcher = fakeFetcher({
      consensusResponse: jsonResponse(200, { ...CONSENSUS_RESULT_BODY, warnings: ['B: refinement round failed — keeping its round-1 verdict.'] }),
    });
    await runConsensusCheck(makeOpts({ fetcher, stream }));
    assert.ok(stream.lines.some(l => l.includes('refinement round failed')));
  });
});

describe('runConsensusCheck — server error handling', () => {
  it('surfaces the server error message on a 422 (e.g. secret-scan block)', async () => {
    const stream = fakeStream();
    const fetcher = fakeFetcher({ consensusResponse: jsonResponse(422, { error: 'Blocked — the diff looks like it contains a secret: x.' }) });
    const result = await runConsensusCheck(makeOpts({ fetcher, stream }));
    assert.equal(result, null);
    assert.ok(stream.lines.some(l => l.includes('Blocked')));
  });

  it('surfaces the server error message on a 503 (not enough providers succeeded)', async () => {
    const stream = fakeStream();
    const fetcher = fakeFetcher({ consensusResponse: jsonResponse(503, { error: 'Error: No AI provider is available or an unknown error has occurred.' }) });
    const result = await runConsensusCheck(makeOpts({ fetcher, stream }));
    assert.equal(result, null);
    assert.ok(stream.lines.some(l => l.includes('No AI provider is available')));
  });

  it('handles a network failure gracefully without throwing', async () => {
    const stream = fakeStream();
    const fetcher = async (url) => {
      if (url.includes('/v1/ai-provider-roles')) return jsonResponse(200, TWO_PROVIDER_ROLE);
      throw new Error('fetch failed: ECONNREFUSED');
    };
    const result = await runConsensusCheck(makeOpts({ fetcher, stream }));
    assert.equal(result, null);
    assert.ok(stream.lines.some(l => l.includes('ECONNREFUSED')));
  });
});
