import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runComplianceCheck } from '../lib/compliance-checker.mjs';

const BRIEF = `
## Description
Payment form must validate email format.
Acceptance Criteria:
- Must validate email
- Must handle empty fields
`;

function makeOpts(overrides = {}) {
  return {
    brief: BRIEF,
    ticketKey: 'PROJ-123',
    configDir: '/tmp/test-config',
    stream: { write: () => {}, isTTY: false },
    isLicensedFn: () => true,
    showUpgradeFn: () => {},
    checkUsageFn: () => ({ count: 0, month: '2026-03', canUse: true }),
    incrementUsageFn: () => {},
    extractRequirementsFn: (_text) => ['Must validate email', 'Must handle empty fields'],
    findLinkedCommitsFn: (_key, _opts) => ({ commits: [], branches: [], diff: '+validate(email)' }),
    analyzeDiffFn: (_reqs, _diff) => ({
      results: [
        { requirement: 'Must validate email', status: 'FOUND', evidence: '+validate(email)' },
        { requirement: 'Must handle empty fields', status: 'NOT_FOUND', evidence: null },
      ],
      coveragePercent: 50,
    }),
    ...overrides,
  };
}

describe('runComplianceCheck', () => {
  it('returns a report string on success', async () => {
    const result = await runComplianceCheck(makeOpts());
    assert.ok(result !== null);
    assert.equal(typeof result.report, 'string');
  });

  it('report includes coverage percentage', async () => {
    const result = await runComplianceCheck(makeOpts());
    assert.ok(result.report.includes('50%') || result.coveragePercent === 50);
  });

  it('report includes FOUND status marker', async () => {
    const result = await runComplianceCheck(makeOpts());
    assert.ok(result.report.includes('✔') || result.report.includes('FOUND'));
  });

  it('report includes NOT FOUND status marker', async () => {
    const result = await runComplianceCheck(makeOpts());
    assert.ok(result.report.includes('✖') || result.report.includes('NOT FOUND'));
  });

  it('returns null and calls showUpgradeFn when not licensed and free limit hit', async () => {
    let upgradeCalled = false;
    const opts = makeOpts({
      isLicensedFn: () => false,
      checkUsageFn: () => ({ count: 3, month: '2026-03', canUse: false }),
      showUpgradeFn: () => { upgradeCalled = true; },
    });
    const result = await runComplianceCheck(opts);
    assert.equal(result, null);
    assert.ok(upgradeCalled);
  });

  it('succeeds for free tier when usage count is under limit', async () => {
    const opts = makeOpts({
      isLicensedFn: () => false,
      checkUsageFn: () => ({ count: 1, month: '2026-03', canUse: true }),
    });
    const result = await runComplianceCheck(opts);
    assert.ok(result !== null);
  });

  it('calls incrementUsageFn when check proceeds', async () => {
    let incremented = false;
    const opts = makeOpts({ incrementUsageFn: () => { incremented = true; } });
    await runComplianceCheck(opts);
    assert.ok(incremented);
  });

  it('shows remaining free checks in report for non-Pro users', async () => {
    const opts = makeOpts({
      isLicensedFn: () => false,
      checkUsageFn: () => ({ count: 1, month: '2026-03', canUse: true }),
    });
    const result = await runComplianceCheck(opts);
    assert.ok(result.report.includes('free') || result.report.includes('remaining'));
  });
});
