import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assembleBrief } from '../lib/brief-assembler.mjs';

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
