import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractTicketKeys, assemblePrReview } from '../lib/pr-review-assembler.mjs';

// ─── extractTicketKeys ────────────────────────────────────────────────────────

describe('extractTicketKeys', () => {
  it('returns empty array for empty string', () => {
    assert.deepEqual(extractTicketKeys(''), []);
  });

  it('returns empty array for null/undefined', () => {
    assert.deepEqual(extractTicketKeys(null), []);
    assert.deepEqual(extractTicketKeys(undefined), []);
  });

  it('extracts a single key from a branch name', () => {
    assert.deepEqual(extractTicketKeys('feat/PROJ-123-fix-login'), ['PROJ-123']);
  });

  it('extracts multiple keys from commit messages', () => {
    const text = 'abc1234 feat: PROJ-123 login fix\ndef5678 fix: PROJ-456 session timeout';
    assert.deepEqual(extractTicketKeys(text), ['PROJ-123', 'PROJ-456']);
  });

  it('deduplicates keys', () => {
    const text = 'PROJ-123 and PROJ-123 again';
    assert.deepEqual(extractTicketKeys(text), ['PROJ-123']);
  });

  it('returns keys sorted alphabetically', () => {
    const text = 'WORK-2 PROJ-1 ALPHA-10';
    assert.deepEqual(extractTicketKeys(text), ['ALPHA-10', 'PROJ-1', 'WORK-2']);
  });

  it('ignores lowercase strings (not ticket keys)', () => {
    assert.deepEqual(extractTicketKeys('proj-123 fix something'), []);
  });

  it('handles numeric-only project codes', () => {
    assert.deepEqual(extractTicketKeys('TL2-99 is a valid key'), ['TL2-99']);
  });

  it('does not match keys with no digits after dash', () => {
    assert.deepEqual(extractTicketKeys('PROJ- is not a key'), []);
  });
});

// ─── assemblePrReview ─────────────────────────────────────────────────────────

const TICKET_A = {
  key: 'PROJ-123',
  summary: 'Fix login validation',
  description: 'AC: Must validate email\nAC: Must reject empty password',
  status: 'In Progress',
  comments: [],
  linkedIssues: [],
};

const TICKET_B = {
  key: 'PROJ-456',
  summary: 'Add session timeout',
  description: 'AC: Session must expire after 30 minutes',
  status: 'In Review',
  comments: [],
  linkedIssues: [],
};

const SAMPLE_DIFF = `diff --git a/src/Auth.php b/src/Auth.php
index abc..def 100644
--- a/src/Auth.php
+++ b/src/Auth.php
@@ -1,3 +1,5 @@
+function validateEmail($email) {
+  return filter_var($email, FILTER_VALIDATE_EMAIL);
+}
diff --git a/tests/AuthTest.php b/tests/AuthTest.php
index 111..222 100644
--- a/tests/AuthTest.php
+++ b/tests/AuthTest.php
@@ -1 +1,3 @@
+public function test_validates_email() {}`;

function makeOpts(overrides = {}) {
  return {
    diff: SAMPLE_DIFF,
    tickets: [TICKET_A],
    baseBranch: 'main',
    headBranch: 'feat/PROJ-123-fix-login',
    isLicensedFn: () => false,
    extractRequirementsFn: (desc) => desc
      .split('\n')
      .filter(l => l.startsWith('AC:'))
      .map(l => l.replace(/^AC:\s*/, '')),
    analyzeDiffFn: (reqs, diff) => ({
      results: reqs.map(r => ({ requirement: r, status: 'FOUND', evidence: 'src/Auth.php' })),
      coveragePercent: 100,
    }),
    ...overrides,
  };
}

describe('assemblePrReview', () => {
  it('returns a string', async () => {
    const result = await assemblePrReview(makeOpts());
    assert.equal(typeof result, 'string');
  });

  it('starts with "## PR Review Context"', async () => {
    const result = await assemblePrReview(makeOpts());
    assert.ok(result.startsWith('## PR Review Context'), `Got: ${result.slice(0, 60)}`);
  });

  it('includes branch section with head and base', async () => {
    const result = await assemblePrReview(makeOpts());
    assert.ok(result.includes('### Branch'), 'Missing "### Branch"');
    assert.ok(result.includes('feat/PROJ-123-fix-login'), 'Missing head branch');
    assert.ok(result.includes('main'), 'Missing base branch');
  });

  it('shows only base when headBranch is null', async () => {
    const result = await assemblePrReview(makeOpts({ headBranch: null }));
    assert.ok(result.includes('`main`'), 'Missing base branch in output');
  });

  it('includes "### Changed files" section with file paths from diff', async () => {
    const result = await assemblePrReview(makeOpts());
    assert.ok(result.includes('### Changed files'), 'Missing "### Changed files"');
    assert.ok(result.includes('src/Auth.php'), 'Missing file path src/Auth.php');
    assert.ok(result.includes('tests/AuthTest.php'), 'Missing file path tests/AuthTest.php');
  });

  it('omits "### Changed files" when diff is null', async () => {
    const result = await assemblePrReview(makeOpts({ diff: null }));
    assert.ok(!result.includes('### Changed files'), 'Should omit section when no diff');
  });

  it('shows "no linked tickets" note when tickets array is empty', async () => {
    const result = await assemblePrReview(makeOpts({ tickets: [] }));
    assert.ok(result.includes('No linked tickets'), 'Missing "No linked tickets" note');
    assert.ok(!result.includes('### Ticket context'), 'Should omit ticket context section');
  });

  it('includes "### Ticket context" with ticket key and summary', async () => {
    const result = await assemblePrReview(makeOpts());
    assert.ok(result.includes('### Ticket context'), 'Missing "### Ticket context"');
    assert.ok(result.includes('PROJ-123'), 'Missing ticket key');
    assert.ok(result.includes('Fix login validation'), 'Missing ticket summary');
  });

  it('lists requirements per ticket in ticket context', async () => {
    const result = await assemblePrReview(makeOpts());
    assert.ok(result.includes('Must validate email'), 'Missing requirement');
    assert.ok(result.includes('Must reject empty password'), 'Missing requirement 2');
  });

  it('shows "no requirements found" for ticket with no AC lines', async () => {
    const ticketNoReqs = { ...TICKET_A, description: 'Just a description with no AC lines.' };
    const result = await assemblePrReview(makeOpts({
      tickets: [ticketNoReqs],
      extractRequirementsFn: () => [],
    }));
    assert.ok(result.includes('No requirements found'), 'Missing "No requirements found" note');
  });

  it('hides "### Requirements coverage" when not Pro', async () => {
    const result = await assemblePrReview(makeOpts({ isLicensedFn: () => false }));
    assert.ok(!result.includes('### Requirements coverage'), 'Should hide coverage section for free tier');
    assert.ok(result.includes('Pro license'), 'Should mention Pro upgrade');
  });

  it('shows "### Requirements coverage" with percentages when Pro and diff present', async () => {
    const result = await assemblePrReview(makeOpts({ isLicensedFn: () => true }));
    assert.ok(result.includes('### Requirements coverage'), 'Missing coverage section');
    assert.ok(result.includes('PROJ-123'), 'Missing ticket in coverage');
    assert.ok(result.includes('%'), 'Missing percentage');
  });

  it('marks covered requirements with ✔ in coverage section', async () => {
    const result = await assemblePrReview(makeOpts({ isLicensedFn: () => true }));
    assert.ok(result.includes('✔'), 'Missing ✔ mark for covered requirement');
  });

  it('marks uncovered requirements with ✖ in coverage section', async () => {
    const result = await assemblePrReview(makeOpts({
      isLicensedFn: () => true,
      analyzeDiffFn: (reqs) => ({
        results: reqs.map(r => ({ requirement: r, status: 'NOT_FOUND', evidence: null })),
        coveragePercent: 0,
      }),
    }));
    assert.ok(result.includes('✖'), 'Missing ✖ mark for uncovered requirement');
  });

  it('shows "### Review focus" when Pro and there are uncovered requirements', async () => {
    const result = await assemblePrReview(makeOpts({
      isLicensedFn: () => true,
      analyzeDiffFn: (reqs) => ({
        results: [
          { requirement: reqs[0], status: 'FOUND', evidence: 'src/Auth.php' },
          { requirement: reqs[1], status: 'NOT_FOUND', evidence: null },
        ],
        coveragePercent: 50,
      }),
    }));
    assert.ok(result.includes('### Review focus'), 'Missing "### Review focus" section');
    assert.ok(result.includes('Must reject empty password'), 'Missing uncovered req in focus section');
  });

  it('omits "### Review focus" when all requirements are covered', async () => {
    const result = await assemblePrReview(makeOpts({ isLicensedFn: () => true }));
    assert.ok(!result.includes('### Review focus'), 'Should omit focus section when all covered');
  });

  it('handles multiple tickets in coverage section per-ticket', async () => {
    const result = await assemblePrReview(makeOpts({
      tickets: [TICKET_A, TICKET_B],
      isLicensedFn: () => true,
    }));
    assert.ok(result.includes('PROJ-123'), 'Missing PROJ-123 in coverage');
    assert.ok(result.includes('PROJ-456'), 'Missing PROJ-456 in coverage');
  });

  it('skips coverage section for tickets with no requirements even when Pro', async () => {
    const ticketNoReqs = { ...TICKET_A, description: 'No AC here.' };
    const result = await assemblePrReview(makeOpts({
      tickets: [ticketNoReqs],
      isLicensedFn: () => true,
      extractRequirementsFn: () => [],
    }));
    assert.ok(!result.includes('### Requirements coverage'), 'Should omit coverage when no requirements');
  });

  it('includes footer with ticketlens review command', async () => {
    const result = await assemblePrReview(makeOpts());
    assert.ok(result.includes('ticketlens review --base=main'), 'Missing footer command');
  });

  it('footer reflects custom base branch', async () => {
    const result = await assemblePrReview(makeOpts({ baseBranch: 'develop' }));
    assert.ok(result.includes('ticketlens review --base=develop'), 'Footer should reflect custom base');
  });

  it('does not crash when diff is null and Pro', async () => {
    const result = await assemblePrReview(makeOpts({
      diff: null,
      isLicensedFn: () => true,
    }));
    assert.equal(typeof result, 'string');
    assert.ok(!result.includes('### Requirements coverage'), 'No coverage without diff');
  });
});
