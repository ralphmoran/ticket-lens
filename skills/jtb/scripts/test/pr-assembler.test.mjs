import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assemblePr } from '../lib/pr-assembler.mjs';

const TICKET_KEY = 'PROJ-123';

const MOCK_TICKET = {
  key: 'PROJ-123',
  summary: 'Fix login',
  description: 'AC: must validate\n',
  status: 'In Progress',
  comments: [],
  linkedIssues: [],
};

const MOCK_TICKET_WITH_LINKED = {
  key: 'PROJ-123',
  summary: 'Fix login',
  description: 'AC: must validate\n',
  status: 'In Progress',
  comments: [],
  linkedIssues: [
    { key: 'PROJ-100', summary: 'Parent epic — Auth overhaul', linkType: 'Epic Link', direction: 'outward', status: 'In Progress', type: 'Epic' },
  ],
};

const MOCK_COMMITS = [{ sha: 'abc1234', message: 'feat: PROJ-123 login' }];
const MOCK_REQUIREMENTS = ['Must validate email'];
const MOCK_COMPLIANCE = {
  coveragePercent: 75,
  report: [{ req: 'Must validate email', covered: true, location: 'src/Auth.php:10' }],
  missing: [],
};

function makeOpts(overrides = {}) {
  return {
    configDir: '/tmp/test-config',
    fetchTicketFn:           async () => MOCK_TICKET,
    extractRequirementsFn:   (desc) => MOCK_REQUIREMENTS,
    findLinkedCommitsFn:     async () => MOCK_COMMITS,
    runComplianceCheckFn:    async ({ brief, ticketKey, configDir }) => MOCK_COMPLIANCE,
    execFn:                  () => ({ stdout: '', status: 1 }),
    ...overrides,
  };
}

describe('assemblePr', () => {
  it('returns a string', async () => {
    const result = await assemblePr(TICKET_KEY, makeOpts());
    assert.equal(typeof result, 'string');
  });

  it('output starts with "## PROJ-123:"', async () => {
    const result = await assemblePr(TICKET_KEY, makeOpts());
    assert.ok(result.startsWith('## PROJ-123:'), `Expected to start with "## PROJ-123:" but got: ${result.slice(0, 60)}`);
  });

  it('includes "### What changed" section', async () => {
    const result = await assemblePr(TICKET_KEY, makeOpts());
    assert.ok(result.includes('### What changed'), 'Missing "### What changed" section');
  });

  it('includes "### Requirements coverage" section with percentage', async () => {
    const result = await assemblePr(TICKET_KEY, makeOpts());
    assert.ok(result.includes('### Requirements coverage'), 'Missing "### Requirements coverage" section');
    assert.ok(result.includes('75%'), 'Missing coverage percentage');
  });

  it('includes "### Acceptance criteria" section', async () => {
    const result = await assemblePr(TICKET_KEY, makeOpts());
    assert.ok(result.includes('### Acceptance criteria'), 'Missing "### Acceptance criteria" section');
  });

  it('includes "### Linked tickets" section when linkedTicketDetails present', async () => {
    const result = await assemblePr(TICKET_KEY, makeOpts({
      fetchTicketFn: async () => MOCK_TICKET_WITH_LINKED,
    }));
    assert.ok(result.includes('### Linked tickets'), 'Missing "### Linked tickets" section');
    assert.ok(result.includes('PROJ-100'), 'Missing linked ticket key PROJ-100');
  });

  it('adds "Closes PROJ-123" footer for github.com remote', async () => {
    const result = await assemblePr(TICKET_KEY, makeOpts({
      execFn: () => ({ stdout: 'https://github.com/org/repo.git', status: 0 }),
    }));
    assert.ok(result.includes('Closes PROJ-123'), 'Missing "Closes PROJ-123" for GitHub remote');
  });

  it('adds "Closes PROJ-123" footer for gitlab.com remote', async () => {
    const result = await assemblePr(TICKET_KEY, makeOpts({
      execFn: () => ({ stdout: 'https://gitlab.com/org/repo.git', status: 0 }),
    }));
    assert.ok(result.includes('Closes PROJ-123'), 'Missing "Closes PROJ-123" for GitLab remote');
  });

  it('omits close footer for non-GitHub/GitLab remotes', async () => {
    const result = await assemblePr(TICKET_KEY, makeOpts({
      execFn: () => ({ stdout: 'https://bitbucket.org/org/repo.git', status: 0 }),
    }));
    assert.ok(!result.includes('Closes PROJ-123'), 'Should omit "Closes" for non-GitHub/GitLab remote');
  });

  it('omits close footer when no remote detected', async () => {
    const result = await assemblePr(TICKET_KEY, makeOpts({
      execFn: () => ({ stdout: '', status: 1 }),
    }));
    assert.ok(!result.includes('Closes PROJ-123'), 'Should omit "Closes" when no remote detected');
  });

  it('marks covered requirements with ✔ and missing with ✖', async () => {
    const result = await assemblePr(TICKET_KEY, makeOpts({
      extractRequirementsFn: () => ['Must validate email', 'Must handle empty fields'],
      runComplianceCheckFn: async () => ({
        coveragePercent: 50,
        report: [
          { req: 'Must validate email', covered: true, location: 'src/Auth.php:10' },
          { req: 'Must handle empty fields', covered: false, location: null },
        ],
        missing: ['Must handle empty fields'],
      }),
    }));
    assert.ok(result.includes('✔'), 'Missing ✔ for covered requirement');
    assert.ok(result.includes('✖'), 'Missing ✖ for missing requirement');
  });

  it('handles ticket with no requirements gracefully', async () => {
    const result = await assemblePr(TICKET_KEY, makeOpts({
      extractRequirementsFn: () => [],
      runComplianceCheckFn: async () => ({
        coveragePercent: 0,
        report: [],
        missing: [],
      }),
    }));
    assert.equal(typeof result, 'string');
    assert.ok(result.includes('### Requirements coverage'), 'Should still include section header');
  });

  it('handles ticket with no linked commits gracefully', async () => {
    const result = await assemblePr(TICKET_KEY, makeOpts({
      findLinkedCommitsFn: async () => [],
    }));
    assert.equal(typeof result, 'string');
    assert.ok(result.includes('### What changed'), 'Should still include section header');
  });
});
