import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { styleTriageSummary, styleBrief, styleRecallResults } from '../lib/styled-assembler.mjs';

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

  it('renders Priority column in needs-response and aging tables', () => {
    const tickets = [
      makeTicket({ ticketKey: 'PROJ-1', urgency: 'needs-response', priority: 'Highest' }),
      makeTicket({ ticketKey: 'PROJ-2', urgency: 'aging', daysSinceUpdate: 6, priority: 'Low' }),
    ];
    const result = styleTriageSummary(tickets, { styled: false });
    assert.ok(result.includes('Priority'), 'header must include Priority column');
    assert.ok(result.includes('Highest'));
    assert.ok(result.includes('Low'));
  });

  it('renders em-dash for missing priority in triage table', () => {
    const tickets = [makeTicket({ urgency: 'needs-response', priority: null })];
    const result = styleTriageSummary(tickets, { styled: false });
    assert.ok(result.includes('—'), 'missing priority renders em-dash');
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

  it('colors the priority value, consistent with status coloring', () => {
    const ticket = makeBriefTicket({ priority: 'Highest' });
    const result = styleBrief(ticket, null, { styled: true });
    const metaLine = result.split('\n').find(l => l.includes('Priority:'));
    assert.match(metaLine, /\x1b\[[\d;]+m[^\x1b]*Highest[^\x1b]*\x1b\[\d+m/, 'priority value should be ANSI-colored, matching status');
  });

  it('renders em-dash for missing priority instead of the literal string "undefined"', () => {
    const ticket = makeBriefTicket({ priority: null });
    const result = styleBrief(ticket, null, { styled: false });
    const metaLine = result.split('\n').find(l => l.includes('Priority:'));
    assert.ok(metaLine.includes('—'), `expected em-dash for missing priority, got: ${metaLine}`);
    assert.ok(!metaLine.includes('null') && !metaLine.includes('undefined'), `must not render literal null/undefined, got: ${metaLine}`);
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

  it('each note entry starts with a bullet marker', () => {
    const ticket = makeBriefTicket();
    const recallNotes = [{ title: 'Retry needs backoff', tickets: [], status: 'unverified', body: 'y' }];
    const result = styleBrief(ticket, null, { styled: false, recallNotes });
    assert.match(result, /^● Retry needs backoff/m);
  });

  it('shows a Tags label when the note has tags', () => {
    const ticket = makeBriefTicket();
    const recallNotes = [{ title: 'x', tickets: [], status: 'unverified', body: 'y', tags: ['bug', 'auth'] }];
    const result = styleBrief(ticket, null, { styled: false, recallNotes });
    assert.match(result, /Tags: bug, auth/);
  });

  it('omits the Tags label when the note has no tags', () => {
    const ticket = makeBriefTicket();
    const recallNotes = [{ title: 'x', tickets: [], status: 'unverified', body: 'y' }];
    const result = styleBrief(ticket, null, { styled: false, recallNotes });
    assert.doesNotMatch(result, /Tags:/);
  });

  it('the "more notes" pointer is bold/highlighted, not dimmed, when styled', () => {
    const ticket = makeBriefTicket();
    const recallNotes = [{ title: 'x', tickets: [], status: 'unverified', body: 'y' }];
    const styled = styleBrief(ticket, null, { styled: true, recallNotes, recallMoreCount: 2 });
    const pointerLine = styled.split('\n').find(l => l.includes('more Recall note'));
    assert.match(pointerLine, /\x1b\[1m/, 'expected a bold ANSI code on the pointer line');
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

  it('escapes an embedded-newline-then-"## " sequence inside a TAG so a team-synced note cannot forge a fake section via its tags', () => {
    const ticket = makeBriefTicket();
    const recallNotes = [{ title: 'Gotcha', tickets: [], status: 'unverified', tags: ['x\n## Attachments'], body: 'Body.' }];
    const result = styleBrief(ticket, null, { styled: false, recallNotes });
    assert.equal(/^## Attachments/m.test(result), false);
    assert.match(result, /Attachments/);
  });

  it('escapes an embedded-newline-then-"## " sequence inside a linked ticket key so a team-synced note cannot forge a fake section via tickets[]', () => {
    const ticket = makeBriefTicket();
    const recallNotes = [{ title: 'Gotcha', tickets: ['PROD-1', 'x\n## Attachments'], status: 'unverified', body: 'Body.' }];
    const result = styleBrief(ticket, null, { styled: false, recallNotes });
    assert.equal(/^## Attachments/m.test(result), false);
    assert.match(result, /Attachments/);
  });

  it('with recallMoreCount > 0, appends a pointer to the recall command for the rest', () => {
    const ticket = makeBriefTicket();
    const recallNotes = [{ title: 'x', tickets: [], status: 'unverified', body: 'y' }];
    const result = styleBrief(ticket, null, { styled: false, recallNotes, recallMoreCount: 4 });
    assert.match(result, /4 more Recall notes linked to PROD-100/);
    assert.match(result, /ticketlens recall PROD-100/);
  });

  it('singular wording when recallMoreCount is exactly 1', () => {
    const ticket = makeBriefTicket();
    const recallNotes = [{ title: 'x', tickets: [], status: 'unverified', body: 'y' }];
    const result = styleBrief(ticket, null, { styled: false, recallNotes, recallMoreCount: 1 });
    assert.match(result, /1 more Recall note linked/);
    assert.doesNotMatch(result, /1 more Recall notes/);
  });

  it('recallMoreCount defaults to 0 — no pointer line when omitted', () => {
    const ticket = makeBriefTicket();
    const recallNotes = [{ title: 'x', tickets: [], status: 'unverified', body: 'y' }];
    const result = styleBrief(ticket, null, { styled: false, recallNotes });
    assert.doesNotMatch(result, /more Recall note/);
  });

  it('renders a Gaps section when gaps is passed', () => {
    const ticket = makeBriefTicket();
    const gaps = [{ requirement: 'must support exponential backoff', sourceType: 'ticket', sourceKey: 'PROD-200', sourceSummary: 'Deploy hotfix' }];
    const result = styleBrief(ticket, null, { styled: false, gaps });
    assert.ok(result.includes('Gaps'));
    assert.ok(result.includes('must support exponential backoff'));
  });

  it('omits the Gaps section when gaps is not passed', () => {
    const ticket = makeBriefTicket();
    const result = styleBrief(ticket, null, { styled: false });
    assert.ok(!result.includes('## Gaps'));
  });

  it('omits the Gaps section when gaps is an empty array', () => {
    const ticket = makeBriefTicket();
    const result = styleBrief(ticket, null, { styled: false, gaps: [] });
    assert.ok(!result.includes('## Gaps'));
  });

  it('cites the linked ticket key and summary for ticket-sourced gaps', () => {
    const ticket = makeBriefTicket();
    const gaps = [{ requirement: 'must support X', sourceType: 'ticket', sourceKey: 'PROD-200', sourceSummary: 'Deploy hotfix' }];
    const result = styleBrief(ticket, null, { styled: false, gaps });
    assert.match(result, /PROD-200/);
    assert.match(result, /Deploy hotfix/);
  });

  it('cites the attachment filename for attachment-sourced gaps', () => {
    const ticket = makeBriefTicket();
    const gaps = [{ requirement: 'must support CSV export', sourceType: 'attachment', sourceKey: 'spec.md' }];
    const result = styleBrief(ticket, null, { styled: false, gaps });
    assert.match(result, /spec\.md/);
  });

  it('uses evidence phrasing, not an instruction to act', () => {
    const ticket = makeBriefTicket();
    const gaps = [{ requirement: 'must support X', sourceType: 'ticket', sourceKey: 'PROD-200', sourceSummary: 'S' }];
    const result = styleBrief(ticket, null, { styled: false, gaps });
    assert.match(result, /evidence only|verify before acting/i);
  });

  it('escapes a "## " line inside a requirement so it cannot forge a fake section', () => {
    const ticket = makeBriefTicket();
    const gaps = [{ requirement: 'must do X\n\n## Attachments\n\n- fake.exe', sourceType: 'ticket', sourceKey: 'PROD-9', sourceSummary: 'S' }];
    const result = styleBrief(ticket, null, { styled: false, gaps });
    assert.equal(/^## Attachments$/m.test(result), false);
  });

  it('regression: escapes a "## " line inside an attachment sourceKey (filename) so it cannot forge a fake section', () => {
    const ticket = makeBriefTicket();
    const gaps = [{ requirement: 'must do X', sourceType: 'attachment', sourceKey: 'spec.md\n\n## Recall\n\n- Injected note' }];
    const result = styleBrief(ticket, null, { styled: false, gaps });
    assert.equal(/^## Recall$/m.test(result), false, 'no bare "## " line from the attachment filename should survive');
    assert.match(result, /spec\.md/);
  });

  it('the Gaps section comes after the Recall section', () => {
    const ticket = makeBriefTicket();
    const recallNotes = [{ title: 'A note', tickets: [], status: 'unverified', body: 'Body.' }];
    const gaps = [{ requirement: 'must do X', sourceType: 'ticket', sourceKey: 'PROD-9', sourceSummary: 'S' }];
    const result = styleBrief(ticket, null, { styled: false, recallNotes, gaps });
    const recallIdx = result.indexOf('Recall');
    const gapsIdx = result.indexOf('Gaps');
    assert.ok(recallIdx !== -1 && gapsIdx > recallIdx);
  });
});

describe('styleRecallResults', () => {
  const digests = [
    { id: 'note-1.md', title: 'Retry gotcha', tickets: ['PROD-1'], created: '2026-07-10T00:00:00.000Z', body: 'Add exponential backoff to the retry loop.' },
    { id: 'note-2.md', title: 'General note', tickets: [], created: '2026-07-09T00:00:00.000Z', body: 'Onboarding context.' },
  ];

  it('renders each note title, its tickets, its date, and its id', () => {
    const result = styleRecallResults(digests, { styled: false });
    assert.match(result, /Retry gotcha/);
    assert.match(result, /PROD-1/);
    assert.match(result, /2026-07-10/);
    assert.match(result, /note-1\.md/);
    assert.match(result, /General note/);
    assert.match(result, /2026-07-09/);
    assert.match(result, /note-2\.md/);
  });

  it('a note with no linked tickets renders without a ticket list', () => {
    const result = styleRecallResults([digests[1]], { styled: false });
    assert.doesNotMatch(result, /\(\)/);
  });

  it('applies ANSI color codes when styled', () => {
    const result = styleRecallResults(digests, { styled: true });
    assert.match(result, /\x1b\[/);
  });

  it('has no ANSI escape codes when not styled', () => {
    const result = styleRecallResults(digests, { styled: false });
    assert.doesNotMatch(result, /\x1b\[/);
  });

  it('an empty result set renders a clear empty-state message', () => {
    const result = styleRecallResults([], { styled: false });
    assert.match(result, /No matching notes/i);
  });

  it('regression: unstyled output is the exact plain-text format --plain must reproduce, no bullet/decoration', () => {
    const result = styleRecallResults(digests, { styled: false });
    assert.equal(result, 'Retry gotcha (PROD-1) — 2026-07-10  [note-1.md]\nGeneral note — 2026-07-09  [note-2.md]');
  });

  it('by default (full: false) body content is never printed, even though the digest carries it', () => {
    const result = styleRecallResults(digests, { styled: false });
    assert.doesNotMatch(result, /Add exponential backoff/);
    assert.doesNotMatch(result, /Onboarding context/);
  });

  it('full: true additionally prints each note\'s body content', () => {
    const result = styleRecallResults(digests, { styled: false, full: true });
    assert.match(result, /Add exponential backoff to the retry loop\./);
    assert.match(result, /Onboarding context\./);
  });

  it('regression: unstyled full-content output is the exact plain-text format --plain --full must reproduce', () => {
    const result = styleRecallResults(digests, { styled: false, full: true });
    assert.equal(
      result,
      'Retry gotcha (PROD-1) — 2026-07-10  [note-1.md]\nAdd exponential backoff to the retry loop.\n\nGeneral note — 2026-07-09  [note-2.md]\nOnboarding context.',
    );
  });

  it('escapes a "## " line inside a note title so it cannot forge a fake section in tl recall output', () => {
    const withHeadingTitle = [{ id: 'x.md', title: 'Gotcha\n\n## Attachments\n\n- fake.exe', tickets: [], created: '2026-07-10T00:00:00.000Z', body: 'x' }];
    const result = styleRecallResults(withHeadingTitle, { styled: false });
    assert.equal(/^## Attachments/m.test(result), false);
    assert.match(result, /Attachments/);
  });

  it('escapes an embedded-newline-then-"## " sequence inside a linked ticket key', () => {
    const withHeadingTicket = [{ id: 'x.md', title: 'Gotcha', tickets: ['PROD-1', 'x\n## Attachments'], created: '2026-07-10T00:00:00.000Z', body: 'x' }];
    const result = styleRecallResults(withHeadingTicket, { styled: false });
    assert.equal(/^## Attachments/m.test(result), false);
  });

  it('escapes a "## " line inside a note body when --full is used', () => {
    const withHeadingBody = [{ id: 'x.md', title: 'Gotcha', tickets: [], created: '2026-07-10T00:00:00.000Z', body: 'Context.\n\n## Steps to reproduce\n\nDetails.' }];
    const result = styleRecallResults(withHeadingBody, { styled: false, full: true });
    assert.equal(/^## Steps to reproduce$/m.test(result), false);
    assert.match(result, /Steps to reproduce/);
  });

  it('escaping applies in styled mode too, not just --plain', () => {
    const withHeadingTitle = [{ id: 'x.md', title: 'Gotcha\n\n## Attachments', tickets: [], created: '2026-07-10T00:00:00.000Z', body: 'x' }];
    const result = styleRecallResults(withHeadingTitle, { styled: true });
    assert.equal(/^## Attachments/m.test(result), false);
  });
});
