import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assembleBrief, assembleTriageSummary } from '../lib/brief-assembler.mjs';

const baseTicket = {
  key: 'PROD-1234',
  summary: 'Fix payment validation on checkout',
  type: 'Bug',
  status: 'In Progress',
  priority: 'High',
  assignee: 'John Dev',
  reporter: 'Sarah QA',
  description: 'The payment validation is failing for empty carts.',
  labels: ['backend', 'payments'],
  components: ['Checkout'],
  comments: [
    { author: 'Sarah QA', body: 'I can reproduce this consistently.', created: '2026-02-26T09:15:00.000+0000' },
    { author: 'Mike Lead', body: 'Confirmed. Root cause is in validateCart().', created: '2026-02-27T11:30:00.000+0000' },
  ],
  linkedIssues: [
    { direction: 'outward', linkType: 'Blocks', key: 'PROD-1235', summary: 'Deploy hotfix', status: 'Blocked', type: 'Task' },
  ],
  attachments: [
    { filename: 'error-screenshot.png', size: 245000 },
  ],
};

describe('assembleBrief', () => {
  it('renders header with ticket key and summary', () => {
    const result = assembleBrief(baseTicket);
    assert.ok(result.startsWith('# PROD-1234: Fix payment validation on checkout'));
  });

  it('renders metadata line with type, status, priority, assignee', () => {
    const result = assembleBrief(baseTicket);
    assert.ok(result.includes('**Type:** Bug'));
    assert.ok(result.includes('**Status:** In Progress'));
    assert.ok(result.includes('**Priority:** High'));
    assert.ok(result.includes('**Assignee:** John Dev'));
  });

  it('renders description section', () => {
    const result = assembleBrief(baseTicket);
    assert.ok(result.includes('## Description'));
    assert.ok(result.includes('payment validation is failing'));
  });

  it('renders comments with authors and dates', () => {
    const result = assembleBrief(baseTicket);
    assert.ok(result.includes('## Comments'));
    assert.ok(result.includes('**Sarah QA**'));
    assert.ok(result.includes('reproduce this consistently'));
    assert.ok(result.includes('2026-02-26'));
  });

  it('omits empty sections', () => {
    const minimal = { ...baseTicket, comments: [], description: null, attachments: [], linkedIssues: [] };
    const result = assembleBrief(minimal);
    assert.ok(!result.includes('## Comments'));
    assert.ok(!result.includes('## Description'));
    assert.ok(!result.includes('## Linked Issues'));
    assert.ok(!result.includes('## Attachments'));
  });

  it('renders code references by category', () => {
    const codeRefs = {
      filePaths: ['/app/modules/Payment/Validator.php'],
      methods: ['validateCart'],
      classes: ['Payment_Validator'],
      shas: ['abc1234'],
      svnRevisions: [],
      branches: ['feature/PROD-1234-fix-payment'],
      namespaces: ['Payment\\Validator'],
    };
    const result = assembleBrief(baseTicket, codeRefs);
    assert.ok(result.includes('## Code References'));
    assert.ok(result.includes('`/app/modules/Payment/Validator.php`'));
    assert.ok(result.includes('`validateCart`'));
    assert.ok(result.includes('`Payment_Validator`'));
    assert.ok(result.includes('`abc1234`'));
    assert.ok(result.includes('`feature/PROD-1234-fix-payment`'));
    assert.ok(!result.includes('SVN Revisions')); // empty, should be omitted
  });

  it('renders linked ticket details with description and comments', () => {
    const ticketWithLinked = {
      ...baseTicket,
      linkedTicketDetails: [
        {
          key: 'PROD-1235',
          summary: 'Deploy hotfix',
          type: 'Task',
          status: 'Blocked',
          description: 'Deploy the payment fix to production.',
          comments: [
            { author: 'PM', body: 'Please expedite this.', created: '2026-03-01T10:00:00.000+0000' },
          ],
          linkedIssues: [],
          attachments: [],
        },
      ],
    };
    const result = assembleBrief(ticketWithLinked);
    assert.ok(result.includes('## Linked Tickets'));
    assert.ok(result.includes('### PROD-1235: Deploy hotfix'));
    assert.ok(result.includes('Deploy the payment fix'));
    assert.ok(result.includes('**PM**'));
    assert.ok(result.includes('Please expedite'));
  });

  it('full assembly produces valid ordered markdown', () => {
    const codeRefs = { filePaths: ['/app/test.php'], methods: [], classes: [], shas: [], svnRevisions: [], branches: [], namespaces: [] };
    const result = assembleBrief(baseTicket, codeRefs);
    const headerIdx = result.indexOf('# PROD-1234');
    const metaIdx = result.indexOf('**Type:**');
    const descIdx = result.indexOf('## Description');
    const commentsIdx = result.indexOf('## Comments');
    const codeIdx = result.indexOf('## Code References');
    assert.ok(headerIdx < metaIdx);
    assert.ok(metaIdx < descIdx);
    assert.ok(descIdx < commentsIdx);
    assert.ok(commentsIdx < codeIdx);
  });
});

describe('assembleTriageSummary', () => {
  it('renders mixed urgencies with correct sections', () => {
    const scored = [
      {
        ticketKey: 'PROD-100',
        summary: 'Fix payment bug',
        status: 'Code Review',
        urgency: 'needs-response',
        reason: 'Sarah QA commented',
        lastComment: { author: 'Sarah QA', body: 'Found edge case with empty cart', created: '2026-03-05T10:00:00Z' },
      },
      {
        ticketKey: 'PROD-200',
        summary: 'Update API docs',
        status: 'In Progress',
        urgency: 'aging',
        reason: 'No activity for 8 days',
        daysSinceUpdate: 8,
        lastComment: null,
      },
    ];
    const result = assembleTriageSummary(scored);
    assert.ok(result.includes('Tickets Needing Your Attention (2 found)'));
    assert.ok(result.includes('Needs Response'));
    assert.ok(result.includes('PROD-100'));
    assert.ok(result.includes('Sarah QA'));
    assert.ok(result.includes('Found edge case'));
    assert.ok(result.includes('Code Review'));
    assert.ok(result.includes('Aging'));
    assert.ok(result.includes('PROD-200'));
    assert.ok(result.includes('8d'));
  });

  it('returns all-clear message when no actionable tickets', () => {
    const scored = [
      { ticketKey: 'PROD-300', urgency: 'clear', reason: 'Up to date', lastComment: null },
    ];
    const result = assembleTriageSummary(scored);
    assert.ok(result.includes('All clear'));
  });

  it('returns all-clear for empty list', () => {
    const result = assembleTriageSummary([]);
    assert.ok(result.includes('All clear'));
  });

  it('aging table numbering continues from needs-response count', () => {
    const scored = [
      { ticketKey: 'PROD-100', summary: 'First', status: 'CR', urgency: 'needs-response', lastComment: { author: 'X', body: 'hi', created: '2026-03-05T10:00:00Z' } },
      { ticketKey: 'PROD-101', summary: 'Second', status: 'CR', urgency: 'needs-response', lastComment: { author: 'Y', body: 'yo', created: '2026-03-05T11:00:00Z' } },
      { ticketKey: 'PROD-200', summary: 'Stale one', status: 'Dev', urgency: 'aging', daysSinceUpdate: 7 },
      { ticketKey: 'PROD-201', summary: 'Stale two', status: 'QA', urgency: 'aging', daysSinceUpdate: 10 },
    ];
    const result = assembleTriageSummary(scored);
    // Aging rows should be numbered 3 and 4, not 1 and 2
    const lines = result.split('\n');
    const agingLines = lines.filter(l => l.includes('PROD-20'));
    assert.ok(agingLines[0].includes('3'), 'First aging ticket should be #3');
    assert.ok(agingLines[1].includes('4'), 'Second aging ticket should be #4');
  });

  it('quick links render as bare URLs for terminal clickability', () => {
    const scored = [
      { ticketKey: 'PROD-100', summary: 'Bug', status: 'CR', urgency: 'needs-response', lastComment: { author: 'X', body: 'hi', created: '2026-03-05T10:00:00Z' } },
      { ticketKey: 'PROD-200', summary: 'Stale', status: 'Dev', urgency: 'aging', daysSinceUpdate: 7 },
    ];
    const result = assembleTriageSummary(scored, { baseUrl: 'https://jira.example.com' });
    // URLs should be bare (not inside markdown list syntax) so terminals auto-detect them
    assert.ok(result.includes('https://jira.example.com/browse/PROD-100'), 'Should include full URL for first ticket');
    assert.ok(result.includes('https://jira.example.com/browse/PROD-200'), 'Should include full URL for second ticket');
    // Each link should have ticket key label and bare URL on same line
    const lines = result.split('\n').filter(l => l.includes('browse/PROD-'));
    assert.equal(lines.length, 2, 'Should have 2 link lines');
    // Should include matching row numbers from the tables
    assert.ok(lines[0].includes('[1]'), 'First link should have number [1]');
    assert.ok(lines[1].includes('[2]'), 'Second link should have number [2]');
  });

  it('quick links not rendered when baseUrl is missing', () => {
    const scored = [
      { ticketKey: 'PROD-100', summary: 'Bug', status: 'CR', urgency: 'needs-response', lastComment: { author: 'X', body: 'hi', created: '2026-03-05T10:00:00Z' } },
    ];
    const result = assembleTriageSummary(scored);
    assert.ok(!result.includes('Quick Links'), 'No quick links without baseUrl');
  });

  it('uses plain-text table format (not markdown pipes)', () => {
    const scored = [
      { ticketKey: 'PROD-100', summary: 'Bug fix', status: 'CR', urgency: 'aging', daysSinceUpdate: 7 },
    ];
    const result = assembleTriageSummary(scored);
    // Should NOT have markdown table pipes
    assert.ok(!result.includes('|---|'), 'Should not use markdown table separators');
    // Should have box-drawing separator
    assert.ok(result.includes('─'), 'Should use box-drawing characters for separator');
  });
});
