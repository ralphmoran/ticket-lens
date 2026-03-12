import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { styleTriageSummary, styleBrief } from '../lib/styled-assembler.mjs';

function makeTicket(overrides = {}) {
  return {
    ticketKey: 'PROJ-1',
    summary: 'Fix the widget',
    status: 'In Progress',
    urgency: 'needs-response',
    reason: 'Someone commented',
    lastComment: {
      author: 'Alice',
      body: 'Please check this',
      created: '2026-03-10T10:00:00Z',
    },
    ...overrides,
  };
}

describe('styleTriageSummary', () => {
  it('shows summary line with correct counts', () => {
    const tickets = [
      makeTicket({ ticketKey: 'PROJ-1', urgency: 'needs-response' }),
      makeTicket({ ticketKey: 'PROJ-2', urgency: 'needs-response' }),
      makeTicket({ ticketKey: 'PROJ-3', urgency: 'aging', daysSinceUpdate: 8 }),
    ];
    const result = styleTriageSummary(tickets, { styled: false });
    assert.ok(result.includes('3 tickets need attention'), 'Should show total count');
    assert.ok(result.includes('2 need response'), 'Should show needs-response count');
    assert.ok(result.includes('1 aging'), 'Should show aging count');
  });

  it('shows [NEEDS RESPONSE] flag for needs-response tickets', () => {
    const tickets = [makeTicket({ urgency: 'needs-response' })];
    const result = styleTriageSummary(tickets, { styled: false });
    assert.ok(result.includes('[NEEDS RESPONSE]'), 'Should contain flag');
    assert.ok(result.includes('PROJ-1'), 'Should contain ticket key');
  });

  it('shows [AGING] flag for aging tickets', () => {
    const tickets = [makeTicket({ urgency: 'aging', daysSinceUpdate: 10 })];
    const result = styleTriageSummary(tickets, { styled: false });
    assert.ok(result.includes('[AGING]'), 'Should contain aging flag');
    assert.ok(result.includes('10d'), 'Should show stale days');
  });

  it('shows all-clear message when no actionable tickets', () => {
    const tickets = [makeTicket({ urgency: 'clear' })];
    const result = styleTriageSummary(tickets, { styled: false });
    assert.ok(result.includes('All clear'), 'Should show all-clear message');
  });

  it('includes Quick Links when baseUrl provided', () => {
    const tickets = [
      makeTicket({ ticketKey: 'PROJ-1', urgency: 'needs-response' }),
      makeTicket({ ticketKey: 'PROJ-2', urgency: 'aging', daysSinceUpdate: 7 }),
    ];
    const result = styleTriageSummary(tickets, { styled: false, baseUrl: 'https://jira.example.com' });
    assert.ok(result.includes('Quick Links'), 'Should have Quick Links section');
    assert.ok(result.includes('https://jira.example.com/browse/PROJ-1'), 'Should have URL for first ticket');
    assert.ok(result.includes('https://jira.example.com/browse/PROJ-2'), 'Should have URL for second ticket');
  });

  it('handles only needs-response tickets (no aging section)', () => {
    const tickets = [makeTicket({ urgency: 'needs-response' })];
    const result = styleTriageSummary(tickets, { styled: false });
    assert.ok(result.includes('[NEEDS RESPONSE]'));
    assert.ok(!result.includes('[AGING]'), 'Should not have aging section');
    assert.ok(result.includes('1 need response'));
    assert.ok(!result.includes('aging'), 'Summary should not mention aging');
  });

  it('handles only aging tickets (no needs-response section)', () => {
    const tickets = [makeTicket({ urgency: 'aging', daysSinceUpdate: 6 })];
    const result = styleTriageSummary(tickets, { styled: false });
    assert.ok(result.includes('[AGING]'));
    assert.ok(!result.includes('[NEEDS RESPONSE]'), 'Should not have needs-response section');
    assert.ok(result.includes('1 aging'));
  });
});

function makeBriefTicket(overrides = {}) {
  return {
    key: 'PROD-100',
    summary: 'Fix payment validation',
    type: 'Bug',
    status: 'In Progress',
    priority: 'High',
    assignee: 'John Dev',
    reporter: 'Sarah QA',
    description: 'The payment validation is failing on checkout.',
    comments: [
      { author: 'Sarah QA', body: 'Can reproduce consistently.', created: '2026-03-05T10:00:00Z' },
    ],
    ...overrides,
  };
}

describe('styleBrief', () => {
  it('includes styled section headers for ticket brief', () => {
    const ticket = makeBriefTicket();
    const result = styleBrief(ticket, null, { styled: false });
    assert.ok(result.includes('PROD-100'), 'Should include ticket key');
    assert.ok(result.includes('Fix payment validation'), 'Should include summary');
    assert.ok(result.includes('Description'), 'Should have Description section');
    assert.ok(result.includes('Comments'), 'Should have Comments section');
  });

  it('includes metadata fields', () => {
    const ticket = makeBriefTicket();
    const result = styleBrief(ticket, null, { styled: false });
    assert.ok(result.includes('Bug'), 'Should show type');
    assert.ok(result.includes('In Progress'), 'Should show status');
    assert.ok(result.includes('High'), 'Should show priority');
    assert.ok(result.includes('John Dev'), 'Should show assignee');
  });

  it('shows code references when provided', () => {
    const ticket = makeBriefTicket();
    const codeRefs = {
      filePaths: ['/app/Payment.php'],
      methods: ['validate'],
      classes: [],
      shas: [],
      svnRevisions: [],
      branches: ['feature/PROD-100'],
      namespaces: [],
    };
    const result = styleBrief(ticket, codeRefs, { styled: false });
    assert.ok(result.includes('Code References'), 'Should have Code References section');
    assert.ok(result.includes('/app/Payment.php'), 'Should show file path');
    assert.ok(result.includes('feature/PROD-100'), 'Should show branch');
  });

  it('omits empty sections', () => {
    const ticket = makeBriefTicket({ description: null, comments: [] });
    const result = styleBrief(ticket, null, { styled: false });
    assert.ok(!result.includes('Description'), 'Should omit empty Description');
    assert.ok(!result.includes('Comments'), 'Should omit empty Comments');
  });

  it('shows linked tickets when present', () => {
    const ticket = makeBriefTicket({
      linkedTicketDetails: [
        { key: 'PROD-200', summary: 'Deploy hotfix', type: 'Task', status: 'Blocked', description: 'Deploy it.' },
      ],
    });
    const result = styleBrief(ticket, null, { styled: false });
    assert.ok(result.includes('Linked Tickets'), 'Should have Linked Tickets section');
    assert.ok(result.includes('PROD-200'), 'Should include linked ticket key');
  });
});
