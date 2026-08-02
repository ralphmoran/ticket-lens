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
    outStream: { write: () => {}, isTTY: false },
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

  it('styles the report with colored status icons and coverage percentage in a TTY', async () => {
    const result = await runComplianceCheck(makeOpts({ outStream: { write: () => {}, isTTY: true } }));
    assert.match(result.report, /\x1b\[38;5;71m✔\x1b\[39m/, 'expected a green FOUND icon');
    assert.match(result.report, /\x1b\[38;5;178m50%\x1b\[39m/, 'expected the 50% coverage line colored yellow (50-69% tier)');
  });

  it('report is plain (no ANSI codes) when outStream is not a TTY', async () => {
    const result = await runComplianceCheck(makeOpts());
    assert.doesNotMatch(result.report, /\x1b\[/, 'a non-TTY outStream (e.g. `tl compliance X > out.txt`, or the pre-push git hook) must never receive raw ANSI escape codes');
  });

  it('defaults outStream to process.stdout without throwing when omitted entirely', async () => {
    const opts = makeOpts();
    delete opts.outStream;
    const result = await runComplianceCheck(opts);
    assert.equal(typeof result.report, 'string');
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

  it('does not show free-tier footer for Pro users', async () => {
    const opts = makeOpts({
      isLicensedFn: () => true,
    });
    const result = await runComplianceCheck(opts);
    assert.ok(!result.report.includes('Free tier:'));
    assert.ok(!result.report.includes('Upgrade to Pro'));
  });

  it('returns noCriteria: false when requirements are found', async () => {
    const result = await runComplianceCheck(makeOpts());
    assert.equal(result.noCriteria, false);
  });

  it('returns noCriteria: true when no requirements extracted', async () => {
    const opts = makeOpts({
      extractRequirementsFn: () => [],
      analyzeDiffFn: () => ({ results: [], coveragePercent: 0 }),
    });
    const result = await runComplianceCheck(opts);
    assert.ok(result !== null);
    assert.equal(result.noCriteria, true);
  });

  it('passes description to extractRequirementsFn when provided (not full brief)', async () => {
    let textPassedToExtractor = null;
    const description = 'Acceptance Criteria\n- Must validate email';
    const fullBrief = description + '\n\nComments\n────\nAuthor (2026-01-01)\nSome comment text';
    const opts = makeOpts({
      extractRequirementsFn: (text) => {
        textPassedToExtractor = text;
        return ['Must validate email'];
      },
    });
    await runComplianceCheck({ ...opts, brief: fullBrief, description });
    assert.equal(textPassedToExtractor, description, 'extractor must receive description, not full brief');
  });

  it('falls back to brief when description is not provided', async () => {
    let textPassedToExtractor = null;
    const opts = makeOpts({
      extractRequirementsFn: (text) => {
        textPassedToExtractor = text;
        return ['Must validate email'];
      },
    });
    await runComplianceCheck(opts); // no description provided
    assert.equal(textPassedToExtractor, BRIEF);
  });

  it('report has blank line between each requirement item', async () => {
    const result = await runComplianceCheck(makeOpts());
    // Each item line should be followed by a blank line
    const lines = result.report.split('\n');
    const itemIdx = lines.findIndex(l => l.includes('✔') || l.includes('✖'));
    assert.ok(itemIdx >= 0, 'should have at least one item');
    // The line after the item (or after its evidence) should be blank
    const afterItem = lines[itemIdx + 1];
    const isEvidenceLine = afterItem?.includes('└─');
    const lineAfterEvidence = isEvidenceLine ? lines[itemIdx + 2] : afterItem;
    assert.equal(lineAfterEvidence, '', 'blank line must follow each requirement item');
  });
});
