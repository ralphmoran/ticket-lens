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

  it('shows legend with colored symbols', () => {
    const tickets = [
      makeTicket({ urgency: 'needs-response' }),
      makeTicket({ ticketKey: 'PROJ-2', urgency: 'aging', daysSinceUpdate: 5 }),
    ];
    const result = styleTriageSummary(tickets, { styled: true });
    assert.ok(result.includes('●'), 'Should contain legend dots');
    assert.ok(result.includes('needs response'), 'Should have needs-response label');
    assert.ok(result.includes('aging'), 'Should have aging label');
  });

  it('shows ticket key for needs-response tickets (no Flag column)', () => {
    const tickets = [makeTicket({ urgency: 'needs-response' })];
    const result = styleTriageSummary(tickets, { styled: false });
    assert.ok(result.includes('PROJ-1'), 'Should contain ticket key');
    assert.ok(!result.includes('[NEEDS RESPONSE]'), 'Should NOT contain old flag text');
    assert.ok(!result.includes('Flag'), 'Should NOT have Flag column header');
  });

  it('shows ticket key for aging tickets (no Flag column)', () => {
    const tickets = [makeTicket({ urgency: 'aging', daysSinceUpdate: 10 })];
    const result = styleTriageSummary(tickets, { styled: false });
    assert.ok(result.includes('PROJ-1'), 'Should contain ticket key');
    assert.ok(result.includes('10d'), 'Should show stale days');
    assert.ok(!result.includes('[AGING]'), 'Should NOT contain old flag text');
  });

  it('shows all-clear message when no actionable tickets', () => {
    const tickets = [makeTicket({ urgency: 'clear' })];
    const result = styleTriageSummary(tickets, { styled: false });
    assert.ok(result.includes('All clear'), 'Should show all-clear message');
  });

  it('shows base URL pattern once and ticket keys in table when baseUrl provided', () => {
    const tickets = [
      makeTicket({ ticketKey: 'PROJ-1', urgency: 'needs-response' }),
      makeTicket({ ticketKey: 'PROJ-2', urgency: 'aging', daysSinceUpdate: 7 }),
    ];
    const result = styleTriageSummary(tickets, { styled: false, baseUrl: 'https://jira.example.com' });
    assert.ok(result.includes('https://jira.example.com/browse/'), 'Should show base URL pattern once');
    assert.ok(result.includes('PROJ-1'), 'Should have ticket key PROJ-1 in table');
    assert.ok(result.includes('PROJ-2'), 'Should have ticket key PROJ-2 in table');
    assert.ok(!result.includes('Quick Links'), 'Should NOT have Quick Links section');
  });

  it('does not include Quick Links section', () => {
    const tickets = [makeTicket({ urgency: 'needs-response' })];
    const result = styleTriageSummary(tickets, { styled: false, baseUrl: 'https://jira.example.com' });
    assert.ok(!result.includes('Quick Links'), 'Quick Links section should be removed');
  });

  it('handles only needs-response tickets (no aging section)', () => {
    const tickets = [makeTicket({ urgency: 'needs-response' })];
    const result = styleTriageSummary(tickets, { styled: false });
    assert.ok(result.includes('PROJ-1'));
    assert.ok(result.includes('1 need response'));
    // Legend should only show needs-response
    assert.ok(!result.includes('Stale'), 'Should not have aging table');
  });

  it('handles only aging tickets (no needs-response section)', () => {
    const tickets = [makeTicket({ urgency: 'aging', daysSinceUpdate: 6 })];
    const result = styleTriageSummary(tickets, { styled: false });
    assert.ok(result.includes('PROJ-1'));
    assert.ok(result.includes('1 aging'));
    assert.ok(!result.includes('Comment'), 'Should not have needs-response table columns');
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

  it('strips carriage returns from comment bodies', () => {
    const ticket = makeBriefTicket({
      comments: [{ author: 'Alice', body: 'Good fix\r\nNeeds review', created: '2026-01-01T00:00:00.000Z' }],
    });
    const result = styleBrief(ticket, null, { styled: false });
    assert.ok(!result.includes('\r'), 'styled brief must not contain carriage returns');
    assert.ok(result.includes('Good fix'), 'comment content must be preserved');
  });

  it('renders Confluence Pages section when pages are present', () => {
    const ticket = makeBriefTicket({
      confluencePages: [
        { url: 'https://example.atlassian.net/wiki/spaces/PROJ/pages/1/Setup', title: 'Setup Guide', text: 'Install the tool first.' },
      ],
    });
    const result = styleBrief(ticket, null, { styled: false });
    assert.ok(result.includes('Confluence Pages'), `expected section header: ${result}`);
    assert.ok(result.includes('Setup Guide'), `expected page title: ${result}`);
    assert.ok(result.includes('Install the tool first.'), `expected page text: ${result}`);
  });

  it('omits Confluence Pages section when confluencePages is absent', () => {
    const ticket = makeBriefTicket();
    const result = styleBrief(ticket, null, { styled: false });
    assert.ok(!result.includes('Confluence Pages'), 'should not render section when absent');
  });

  it('renders a Recall section when recallNotes is passed', () => {
    const ticket = makeBriefTicket();
    const recallNotes = [{ title: 'Retry needs backoff', tickets: ['PROD-100'], status: 'unverified', body: 'Add exponential backoff.' }];
    const result = styleBrief(ticket, null, { styled: false, recallNotes });
    assert.ok(result.includes('Recall'));
    assert.ok(result.includes('Retry needs backoff'));
    assert.ok(result.includes('Add exponential backoff'));
  });

  it('omits the Recall section when recallNotes is not passed', () => {
    const ticket = makeBriefTicket();
    const result = styleBrief(ticket, null, { styled: false });
    assert.ok(!result.includes('Recall'));
  });

  it('marks an unverified Recall note with a badge', () => {
    const ticket = makeBriefTicket();
    const recallNotes = [{ title: 'x', tickets: [], status: 'unverified', body: 'y' }];
    const result = styleBrief(ticket, null, { styled: false, recallNotes });
    assert.match(result, /unverified/i);
  });

  it('escapes a "## " line inside a note body so it cannot be mistaken for a real document section', () => {
    const ticket = makeBriefTicket();
    const recallNotes = [{ title: 'Gotcha', tickets: [], status: 'unverified', body: 'Context.\n\n## Steps to reproduce\n\nDetails.' }];
    const result = styleBrief(ticket, null, { styled: false, recallNotes });
    assert.equal(/^## Steps to reproduce$/m.test(result), false);
    assert.match(result, /Steps to reproduce/);
  });

  it('regression: escapes a "## " line inside a note TITLE too — not just the body', () => {
    const ticket = makeBriefTicket();
    const recallNotes = [{ title: 'Gotcha\n\n## Attachments\n\n- fake-injected-line.exe', tickets: [], status: 'unverified', body: 'Real body.' }];
    const result = styleBrief(ticket, null, { styled: false, recallNotes });
    assert.equal(/^## Attachments$/m.test(result), false);
    assert.match(result, /Attachments/);
  });
});
