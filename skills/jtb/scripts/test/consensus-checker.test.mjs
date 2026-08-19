import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  runConsensusCheck,
  getConfiguredProviders,
  parseVerdicts,
  reconcileRequirement,
} from '../lib/consensus-checker.mjs';

const BRIEF = `
## Description
Payment form must validate email format.
Acceptance Criteria:
- Must validate email
- Must handle empty fields
`;

const CREDENTIALS_ALL = { anthropicApiKey: 'sk-ant-1', openaiApiKey: 'sk-1', groqApiKey: 'gsk-1' };

function fakeStream() {
  const lines = [];
  return { write: (s) => lines.push(s), lines, isTTY: false };
}

// Round-1 responder that always agrees: both requirements FOUND, all providers.
function agreeingSummarizeFn() {
  return async ({ prompt }) => {
    if (prompt.includes('Reviewer')) throw new Error('round 2 should not be called when agents agree');
    return "Must validate email | FOUND\nMust handle empty fields | FOUND";
  };
}

function makeOpts(overrides = {}) {
  return {
    brief: BRIEF,
    ticketKey: 'PROJ-123',
    configDir: '/tmp/test-config',
    stream: fakeStream(),
    outStream: { write: () => {}, isTTY: false },
    forceYes: true,
    isLicensedFn: () => true,
    showUpgradeFn: () => {},
    extractRequirementsFn: () => ['Must validate email', 'Must handle empty fields'],
    findLinkedCommitsFn: () => ({ commits: [], branches: [], diff: '+validate(email)\n+handleEmpty()' }),
    loadCredentialsFn: () => CREDENTIALS_ALL,
    summarizeFn: agreeingSummarizeFn(),
    scanForSecretsFn: () => ({ rejected: false, reasons: [], warnings: [] }),
    ...overrides,
  };
}

describe('getConfiguredProviders', () => {
  it('returns all three when all keys present', () => {
    assert.deepEqual(getConfiguredProviders(CREDENTIALS_ALL), ['anthropic', 'openai', 'groq']);
  });

  it('returns only providers with a key present', () => {
    assert.deepEqual(getConfiguredProviders({ anthropicApiKey: 'x' }), ['anthropic']);
  });

  it('returns empty array for no credentials', () => {
    assert.deepEqual(getConfiguredProviders({}), []);
    assert.deepEqual(getConfiguredProviders(null), []);
  });

  it('ignores empty-string keys', () => {
    assert.deepEqual(getConfiguredProviders({ anthropicApiKey: '', openaiApiKey: 'x' }), ['openai']);
  });
});

describe('parseVerdicts', () => {
  it('parses FOUND, PARTIAL, NOT_FOUND per requirement', () => {
    const raw = 'Must validate email | FOUND\nMust handle empty fields | NOT_FOUND';
    assert.deepEqual(
      parseVerdicts(['Must validate email', 'Must handle empty fields'], raw),
      ['FOUND', 'NOT_FOUND']
    );
  });

  it('defaults to NOT_FOUND when a requirement is not mentioned', () => {
    assert.deepEqual(parseVerdicts(['Must validate email'], 'unrelated text'), ['NOT_FOUND']);
  });

  it('is case-insensitive', () => {
    assert.deepEqual(parseVerdicts(['Must validate email'], 'must validate email | found'), ['FOUND']);
  });

  it('does not read NOT_FOUND as FOUND', () => {
    assert.deepEqual(parseVerdicts(['Must validate email'], 'Must validate email | NOT_FOUND'), ['NOT_FOUND']);
  });

  it('recognizes PARTIAL', () => {
    assert.deepEqual(parseVerdicts(['Must validate email'], 'Must validate email | PARTIAL'), ['PARTIAL']);
  });
});

describe('reconcileRequirement', () => {
  it('picks the majority verdict', () => {
    assert.equal(reconcileRequirement(['FOUND', 'FOUND', 'NOT_FOUND']), 'FOUND');
  });

  it('breaks a 2-way tie toward the stricter verdict', () => {
    assert.equal(reconcileRequirement(['FOUND', 'NOT_FOUND']), 'NOT_FOUND');
    assert.equal(reconcileRequirement(['FOUND', 'PARTIAL']), 'PARTIAL');
    assert.equal(reconcileRequirement(['PARTIAL', 'NOT_FOUND']), 'NOT_FOUND');
  });

  it('breaks a 3-way tie toward the strictest verdict', () => {
    assert.equal(reconcileRequirement(['FOUND', 'PARTIAL', 'NOT_FOUND']), 'NOT_FOUND');
  });

  it('returns the sole verdict when all agents agree', () => {
    assert.equal(reconcileRequirement(['FOUND', 'FOUND', 'FOUND']), 'FOUND');
  });
});

describe('runConsensusCheck — license gate', () => {
  it('returns null and shows the Pro upsell when not licensed', async () => {
    const showUpgradeFn = mock.fn();
    const result = await runConsensusCheck(makeOpts({ isLicensedFn: () => false, showUpgradeFn }));
    assert.equal(result, null);
    assert.equal(showUpgradeFn.mock.calls.length, 1);
    assert.equal(showUpgradeFn.mock.calls[0].arguments[0], 'pro');
  });
});

describe('runConsensusCheck — no acceptance criteria', () => {
  it('returns a no-criteria report without making any AI calls', async () => {
    const summarizeFn = mock.fn(async () => 'unused');
    const result = await runConsensusCheck(makeOpts({ extractRequirementsFn: () => [], summarizeFn }));
    assert.equal(result.noCriteria, true);
    assert.equal(summarizeFn.mock.calls.length, 0);
  });
});

describe('runConsensusCheck — secret scan on the diff before it leaves the machine', () => {
  it('blocks and makes no API calls when the diff scan is rejected', async () => {
    const stream = fakeStream();
    const summarizeFn = mock.fn(async () => 'unused');
    const confirmCostFn = mock.fn(async () => true);
    const scanForSecretsFn = () => ({ rejected: true, reasons: ['Looks like an AWS secret key.'], warnings: [] });
    const result = await runConsensusCheck(makeOpts({ stream, summarizeFn, confirmCostFn, scanForSecretsFn, forceYes: false }));
    assert.equal(result, null);
    assert.equal(summarizeFn.mock.calls.length, 0);
    assert.equal(confirmCostFn.mock.calls.length, 0, 'must fail fast before even asking about cost');
    assert.ok(stream.lines.some(l => l.includes('AWS secret key')));
  });

  it('surfaces warnings but proceeds when the scan only warns', async () => {
    const stream = fakeStream();
    const summarizeFn = mock.fn(agreeingSummarizeFn());
    const scanForSecretsFn = () => ({ rejected: false, reasons: [], warnings: ['Contains an email address.'] });
    const result = await runConsensusCheck(makeOpts({ stream, summarizeFn, scanForSecretsFn }));
    assert.notEqual(result, null);
    assert.equal(summarizeFn.mock.calls.length, 3);
    assert.ok(stream.lines.some(l => l.includes('email address')));
  });

  it('scans the diff content, not the requirements text', async () => {
    let receivedBody;
    const scanForSecretsFn = ({ body }) => {
      receivedBody = body;
      return { rejected: false, reasons: [], warnings: [] };
    };
    await runConsensusCheck(makeOpts({
      findLinkedCommitsFn: () => ({ diff: '+const AWS_KEY = "leaked"' }),
      scanForSecretsFn,
    }));
    assert.equal(receivedBody, '+const AWS_KEY = "leaked"');
  });
});

describe('runConsensusCheck — provider prerequisites', () => {
  it('returns null when fewer than 2 providers are configured', async () => {
    const stream = fakeStream();
    const result = await runConsensusCheck(makeOpts({ loadCredentialsFn: () => ({ anthropicApiKey: 'x' }), stream }));
    assert.equal(result, null);
    assert.ok(stream.lines.some(l => l.includes('at least 2')));
  });
});

describe('runConsensusCheck — cost confirmation', () => {
  it('declines automatically in non-interactive mode without --yes', async () => {
    const summarizeFn = mock.fn(async () => 'unused');
    const stdin = { isTTY: false };
    const result = await runConsensusCheck(makeOpts({ forceYes: false, stdin, summarizeFn }));
    assert.equal(result, null);
    assert.equal(summarizeFn.mock.calls.length, 0);
  });

  it('skips the prompt entirely when forceYes is true', async () => {
    const summarizeFn = mock.fn(agreeingSummarizeFn());
    const result = await runConsensusCheck(makeOpts({ forceYes: true, summarizeFn }));
    assert.notEqual(result, null);
  });
});

describe('runConsensusCheck — agreement (no refinement needed)', () => {
  it('makes exactly one call per provider and skips round 2 when all agents agree', async () => {
    const summarizeFn = mock.fn(agreeingSummarizeFn());
    const result = await runConsensusCheck(makeOpts({ summarizeFn }));
    assert.equal(summarizeFn.mock.calls.length, 3); // one per provider, no round 2
    assert.equal(result.coveragePercent, 100);
    assert.equal(result.results[0].status, 'FOUND');
  });
});

describe('runConsensusCheck — disagreement triggers refinement', () => {
  it('runs a second round only for disagreed requirements, only against successful agents', async () => {
    let round = 0;
    const seenRound2Prompts = [];
    const summarizeFn = async ({ provider, prompt }) => {
      if (prompt.includes('Reviewer')) {
        seenRound2Prompts.push(prompt);
        // Every agent flips to FOUND on refinement
        return 'Must validate email | FOUND';
      }
      round++;
      // Round 1: anthropic says FOUND, openai says NOT_FOUND, groq says FOUND — disagreement
      if (provider === 'openai') return 'Must validate email | NOT_FOUND\nMust handle empty fields | FOUND';
      return 'Must validate email | FOUND\nMust handle empty fields | FOUND';
    };
    const result = await runConsensusCheck(makeOpts({ summarizeFn }));
    assert.equal(seenRound2Prompts.length, 3, 'all 3 successful round-1 agents should get a refinement call');
    assert.ok(seenRound2Prompts[0].includes('Must validate email'));
    assert.ok(!seenRound2Prompts[0].includes('Must handle empty fields'), 'round 2 must only re-ask disagreed requirements');
    assert.equal(result.results.find(r => r.requirement === 'Must validate email').status, 'FOUND');
  });

  it('shows the round-1 → round-2 verdict change per agent in the report (approved-design transparency requirement)', async () => {
    const summarizeFn = async ({ provider, prompt }) => {
      if (prompt.includes('Reviewer')) return 'Must validate email | FOUND'; // everyone converges to FOUND
      if (provider === 'openai') return 'Must validate email | NOT_FOUND\nMust handle empty fields | FOUND';
      return 'Must validate email | FOUND\nMust handle empty fields | FOUND';
    };
    const result = await runConsensusCheck(makeOpts({ summarizeFn }));
    assert.match(result.report, /openai:.*NOT_FOUND→FOUND/, 'openai flipped its verdict on refinement — must be visible, not hidden behind the final-only verdict');
    assert.doesNotMatch(
      result.report.split('anthropic:')[1]?.split('\n')[0] ?? '',
      /→/,
      'anthropic never changed its verdict — must not show a spurious arrow'
    );
  });
});

describe('runConsensusCheck — graceful degradation on partial provider failure', () => {
  it('still succeeds when one of three providers errors in round 1', async () => {
    const summarizeFn = async ({ provider }) => {
      if (provider === 'groq') throw new Error('groq: HTTP 401');
      return 'Must validate email | FOUND\nMust handle empty fields | FOUND';
    };
    const result = await runConsensusCheck(makeOpts({ summarizeFn }));
    assert.notEqual(result, null);
    assert.equal(result.coveragePercent, 100);
  });

  it('returns null when fewer than 2 providers succeed in round 1', async () => {
    const stream = fakeStream();
    const summarizeFn = async ({ provider }) => {
      if (provider !== 'anthropic') throw new Error(`${provider}: HTTP 500`);
      return 'Must validate email | FOUND\nMust handle empty fields | FOUND';
    };
    const result = await runConsensusCheck(makeOpts({ summarizeFn, stream }));
    assert.equal(result, null);
    assert.ok(stream.lines.some(l => l.includes('at least 2')));
  });

  it('falls back to the round-1 verdict for an agent whose round-2 refinement call fails, and tells the user why', async () => {
    const stream = fakeStream();
    const summarizeFn = async ({ provider, prompt }) => {
      if (prompt.includes('Reviewer')) {
        if (provider === 'groq') throw new Error('groq round 2 timeout');
        return 'Must validate email | FOUND';
      }
      if (provider === 'openai') return 'Must validate email | NOT_FOUND\nMust handle empty fields | FOUND';
      return 'Must validate email | FOUND\nMust handle empty fields | FOUND';
    };
    const result = await runConsensusCheck(makeOpts({ summarizeFn, stream }));
    assert.notEqual(result, null); // must not throw or crash despite the round-2 failure
    assert.ok(
      stream.lines.some(l => l.includes('groq') && l.includes('refinement')),
      'a round-2 failure must be surfaced to the user the same way round-1 failures are, not swallowed silently'
    );
  });
});

describe('runConsensusCheck — response token budget scales with requirement count', () => {
  it('requests more than the 512-token floor when there are many requirements, to avoid truncating the per-requirement verdict list', async () => {
    const manyRequirements = Array.from({ length: 30 }, (_, i) => `Must handle case ${i}`);
    const seenMaxTokens = [];
    const summarizeFn = async ({ prompt, maxTokens }) => {
      seenMaxTokens.push(maxTokens);
      return manyRequirements.map(r => `${r} | FOUND`).join('\n');
    };
    await runConsensusCheck(makeOpts({ extractRequirementsFn: () => manyRequirements, summarizeFn }));
    assert.ok(seenMaxTokens.every(m => m > 512), `expected maxTokens scaled above the 512 floor for 30 requirements, got ${seenMaxTokens}`);
  });

  it('uses the 512 floor for a small requirement list', async () => {
    const seenMaxTokens = [];
    const summarizeFn = async ({ maxTokens }) => {
      seenMaxTokens.push(maxTokens);
      return 'Must validate email | FOUND\nMust handle empty fields | FOUND';
    };
    await runConsensusCheck(makeOpts({ summarizeFn }));
    assert.ok(seenMaxTokens.every(m => m === 512), `expected the 512 floor for 2 requirements, got ${seenMaxTokens}`);
  });
});

describe('runConsensusCheck — report content', () => {
  it('includes a per-agent breakdown section', async () => {
    const summarizeFn = mock.fn(agreeingSummarizeFn());
    const result = await runConsensusCheck(makeOpts({ summarizeFn }));
    assert.match(result.report, /Per-agent breakdown/i);
    assert.match(result.report, /anthropic/);
    assert.match(result.report, /openai/);
    assert.match(result.report, /groq/);
  });

  it('report is plain (no ANSI) when outStream is not a TTY', async () => {
    const summarizeFn = mock.fn(agreeingSummarizeFn());
    const result = await runConsensusCheck(makeOpts({ summarizeFn }));
    assert.doesNotMatch(result.report, /\x1b\[/);
  });
});
