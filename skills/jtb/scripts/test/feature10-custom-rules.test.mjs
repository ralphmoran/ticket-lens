/**
 * Feature 10 — Custom attention rules in profile config
 * RED phase: all tests must fail until implementation is added.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { scoreAttention, matchesRuleConditions } from '../lib/attention-scorer.mjs';

const NOW = new Date('2026-03-06T12:00:00Z');
const USER = { accountId: 'u1', name: 'dev', displayName: 'Dev' };

function makeTicket(overrides = {}) {
  return {
    key: 'PROJ-1',
    summary: 'Test ticket',
    status: 'In Progress',
    priority: 'Medium',
    labels: [],
    comments: [],
    updated: new Date('2026-03-05T12:00:00Z').toISOString(),
    ...overrides,
  };
}

describe('scoreAttention — force-urgent custom rule', () => {
  it('overrides urgency to needs-response when priority matches force-urgent rule', () => {
    const ticket = makeTicket({ priority: 'Highest', updated: new Date('2026-03-05T00:00:00Z').toISOString() });
    const customRules = [{ match: { priority: 'Highest' }, action: 'force-urgent', reason: 'P1 always urgent' }];
    const result = scoreAttention(ticket, USER, { now: NOW, customRules });
    assert.equal(result.urgency, 'needs-response');
    assert.ok(result.reason.includes('P1 always urgent'), `Expected custom reason, got: ${result.reason}`);
  });

  it('overrides urgency to needs-response when label matches force-urgent rule', () => {
    const ticket = makeTicket({ labels: ['critical'], updated: new Date('2026-03-05T00:00:00Z').toISOString() });
    const customRules = [{ match: { label: 'critical' }, action: 'force-urgent', reason: 'critical label' }];
    const result = scoreAttention(ticket, USER, { now: NOW, customRules });
    assert.equal(result.urgency, 'needs-response');
  });

  it('overrides urgency to needs-response when status matches force-urgent rule', () => {
    const ticket = makeTicket({ status: 'Blocked' });
    const customRules = [{ match: { status: 'Blocked' }, action: 'force-urgent', reason: 'blocked' }];
    const result = scoreAttention(ticket, USER, { now: NOW, customRules });
    assert.equal(result.urgency, 'needs-response');
  });

  it('does not apply rule when priority does not match', () => {
    const ticket = makeTicket({ priority: 'Low' });
    const customRules = [{ match: { priority: 'Highest' }, action: 'force-urgent', reason: 'P1' }];
    const result = scoreAttention(ticket, USER, { now: NOW, customRules });
    assert.equal(result.urgency, 'clear');
  });
});

describe('scoreAttention — ignore custom rule', () => {
  it('returns urgency ignore when label matches ignore rule', () => {
    const ticket = makeTicket({ labels: ['backlog'] });
    const customRules = [{ match: { label: 'backlog' }, action: 'ignore', reason: 'skip backlog' }];
    const result = scoreAttention(ticket, USER, { now: NOW, customRules });
    assert.equal(result.urgency, 'ignore');
  });

  it('returns urgency ignore when status matches ignore rule', () => {
    const ticket = makeTicket({ status: 'Parked' });
    const customRules = [{ match: { status: 'Parked' }, action: 'ignore', reason: 'parked' }];
    const result = scoreAttention(ticket, USER, { now: NOW, customRules });
    assert.equal(result.urgency, 'ignore');
  });

  it('does not apply ignore rule when label does not match', () => {
    const ticket = makeTicket({ labels: ['feature'] });
    const customRules = [{ match: { label: 'backlog' }, action: 'ignore', reason: 'skip backlog' }];
    const result = scoreAttention(ticket, USER, { now: NOW, customRules });
    assert.notEqual(result.urgency, 'ignore');
  });
});

describe('scoreAttention — multiple rules, first match wins', () => {
  it('applies first matching rule when multiple rules are defined', () => {
    const ticket = makeTicket({ priority: 'Highest', labels: ['backlog'] });
    const customRules = [
      { match: { priority: 'Highest' }, action: 'force-urgent', reason: 'P1 wins' },
      { match: { label: 'backlog' }, action: 'ignore', reason: 'would ignore' },
    ];
    const result = scoreAttention(ticket, USER, { now: NOW, customRules });
    assert.equal(result.urgency, 'needs-response');
    assert.ok(result.reason.includes('P1 wins'));
  });
});

describe('scoreAttention — malformed rules are skipped gracefully', () => {
  it('skips rule with no match field without throwing', () => {
    const ticket = makeTicket();
    const customRules = [{ action: 'force-urgent', reason: 'bad rule' }];
    assert.doesNotThrow(() => scoreAttention(ticket, USER, { now: NOW, customRules }));
  });

  it('skips rule with unknown action without throwing', () => {
    const ticket = makeTicket();
    const customRules = [{ match: { priority: 'Highest' }, action: 'explode' }];
    assert.doesNotThrow(() => scoreAttention(ticket, USER, { now: NOW, customRules }));
  });
});

describe('matchesRuleConditions — fixture parity with PHP CustomRuleMatcher', () => {
  const fixturePath = fileURLToPath(new URL('./fixtures/custom-rule-match-cases.json', import.meta.url));
  const cases = JSON.parse(readFileSync(fixturePath, 'utf8'));

  for (const { description, ticket, match, expected } of cases) {
    it(description, () => {
      assert.equal(matchesRuleConditions(ticket, match), expected);
    });
  }
});

// ── Integration test: attentionRules propagated from profile config through resolveConnection ──
import { mkdtempSync, rmSync, writeFileSync as wfSync } from 'node:fs';
import { join as pathJoin } from 'node:path';
import { tmpdir as osTmpdir } from 'node:os';
import { run } from '../fetch-my-tickets.mjs';

describe('attentionRules integration — profile config → scoreAttention', () => {
  let tmpDir;
  before(() => {
    tmpDir = mkdtempSync(pathJoin(osTmpdir(), 'rules-integration-'));
    const profiles = {
      default: 'work',
      profiles: { work: { baseUrl: 'https://jira.example.com', auth: 'cloud', email: 'dev@a.com', attentionRules: [{ match: { priority: 'Highest' }, action: 'force-urgent', reason: 'P1 rule fires' }] } },
    };
    wfSync(pathJoin(tmpDir, 'profiles.json'), JSON.stringify(profiles), 'utf8');
    wfSync(pathJoin(tmpDir, 'credentials.json'), JSON.stringify({ work: { apiToken: 'tok' } }), 'utf8');
  });
  after(() => rmSync(tmpDir, { recursive: true }));

  it('custom rule from profile config fires on matching ticket — force-urgent produces needs-response in output', async () => {
    const staleDate = new Date(Date.now() - 1000).toISOString(); // just now — would be 'clear' without rule
    const ticket = { key: 'RULE-1', fields: { summary: 'P1 issue', status: { name: 'In Progress' }, priority: { name: 'Highest' }, labels: [], updated: staleDate, comment: { comments: [] } } };
    const output = [];
    await run(['triage', '--plain'], {
      env: {},
      fetcher: async (url) => {
        if (url.includes('myself') || url.includes('rest/auth')) return { ok: true, json: async () => ({ accountId: 'u1', displayName: 'Dev', name: 'dev' }) };
        return { ok: true, json: async () => ({ issues: [ticket], total: 1 }) };
      },
      configDir: tmpDir,
      isLicensed: () => true,
      showUpgradePrompt: () => {},
      print: (s) => output.push(s),
    });
    const combined = output.join('');
    assert.ok(combined.includes('RULE-1'), `Expected RULE-1 in output (rule should force-urgent it), got:\n${combined}`);
  });
});
