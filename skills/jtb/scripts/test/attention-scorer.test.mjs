import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { scoreAttention, isFromCurrentUser, isBot, isBotCommitByUser, findLastEffectiveComment, sortByUrgency, URGENCY_ORDER, PRIORITY_ORDER } from '../lib/attention-scorer.mjs';

const NOW = new Date('2026-03-06T12:00:00Z');
const currentUser = { accountId: 'user-123', name: 'jdev', displayName: 'John Dev' };

function makeTicket(overrides = {}) {
  return {
    key: 'PROD-100',
    summary: 'Test ticket',
    status: 'In Progress',
    updated: '2026-03-05T10:00:00Z',
    comments: [],
    ...overrides,
  };
}

function makeComment(overrides = {}) {
  return {
    author: 'Sarah QA',
    authorAccountId: 'user-456',
    authorName: 'sqauser',
    body: 'Please review',
    created: '2026-03-05T10:00:00Z',
    ...overrides,
  };
}

describe('isFromCurrentUser', () => {
  it('matches by accountId (Cloud)', () => {
    const comment = makeComment({ authorAccountId: 'user-123' });
    assert.ok(isFromCurrentUser(comment, currentUser));
  });

  it('does not match different accountId', () => {
    const comment = makeComment({ authorAccountId: 'user-456' });
    assert.ok(!isFromCurrentUser(comment, currentUser));
  });

  it('matches by name (Server)', () => {
    const comment = makeComment({ authorAccountId: null, authorName: 'jdev' });
    const serverUser = { name: 'jdev', displayName: 'John Dev' };
    assert.ok(isFromCurrentUser(comment, serverUser));
  });

  it('falls back to displayName match', () => {
    const comment = makeComment({ authorAccountId: null, authorName: null, author: 'John Dev' });
    const simpleUser = { displayName: 'John Dev' };
    assert.ok(isFromCurrentUser(comment, simpleUser));
  });

  it('returns false when nothing matches', () => {
    const comment = makeComment();
    const otherUser = { accountId: 'other', name: 'other', displayName: 'Other' };
    assert.ok(!isFromCurrentUser(comment, otherUser));
  });
});

describe('isBot', () => {
  it('detects "Automatic Bot"', () => assert.ok(isBot('Automatic Bot')));
  it('detects "Jira Automation"', () => assert.ok(isBot('Jira Automation')));
  it('detects "SVN Commit Bot"', () => assert.ok(isBot('SVN Commit Bot')));
  it('detects "Jenkins"', () => assert.ok(isBot('Jenkins')));
  it('does not flag real users', () => assert.ok(!isBot('Sarah QA')));
  it('does not flag null', () => assert.ok(!isBot(null)));
});

describe('scoreAttention', () => {
  describe('needs-response', () => {
    it('flags when last comment is from another user', () => {
      const ticket = makeTicket({
        comments: [makeComment({ authorAccountId: 'user-456', author: 'Sarah QA' })],
      });
      const result = scoreAttention(ticket, currentUser, { now: NOW });
      assert.equal(result.urgency, 'needs-response');
      assert.ok(result.reason.includes('Sarah QA'));
    });

    it('returns clear when last comment is from current user', () => {
      const ticket = makeTicket({
        comments: [
          makeComment({ authorAccountId: 'user-456', author: 'Sarah QA' }),
          makeComment({ authorAccountId: 'user-123', author: 'John Dev', created: '2026-03-05T12:00:00Z' }),
        ],
      });
      const result = scoreAttention(ticket, currentUser, { now: NOW });
      assert.equal(result.urgency, 'clear');
    });
  });

  describe('aging', () => {
    it('flags ticket with no comments updated > 5 days ago', () => {
      const ticket = makeTicket({ updated: '2026-02-28T10:00:00Z', comments: [] });
      const result = scoreAttention(ticket, currentUser, { now: NOW });
      assert.equal(result.urgency, 'aging');
      assert.ok(result.daysSinceUpdate >= 5);
    });

    it('returns clear when updated 2 days ago', () => {
      const ticket = makeTicket({ updated: '2026-03-04T10:00:00Z', comments: [] });
      const result = scoreAttention(ticket, currentUser, { now: NOW });
      assert.equal(result.urgency, 'clear');
    });

    it('respects custom staleDays threshold', () => {
      const ticket = makeTicket({ updated: '2026-03-03T10:00:00Z', comments: [] });
      const result = scoreAttention(ticket, currentUser, { now: NOW, staleDays: 3 });
      assert.equal(result.urgency, 'aging');
    });

    it('aging when current user replied last but ticket is stale', () => {
      const ticket = makeTicket({
        updated: '2026-02-20T10:00:00Z',
        comments: [makeComment({ authorAccountId: 'user-123', author: 'John Dev', created: '2026-02-20T10:00:00Z' })],
      });
      const result = scoreAttention(ticket, currentUser, { now: NOW });
      assert.equal(result.urgency, 'aging');
    });
  });

  describe('stale needs-response downgrade', () => {
    it('downgrades needs-response to aging when comment is older than staleDays', () => {
      const ticket = makeTicket({
        comments: [makeComment({ authorAccountId: 'user-456', author: 'Sarah QA', created: '2026-02-20T10:00:00Z' })],
      });
      const result = scoreAttention(ticket, currentUser, { now: NOW, staleDays: 5 });
      assert.equal(result.urgency, 'aging');
      assert.ok(result.daysSinceUpdate >= 14);
    });

    it('keeps needs-response when comment is within staleDays', () => {
      const ticket = makeTicket({
        comments: [makeComment({ authorAccountId: 'user-456', author: 'Sarah QA', created: '2026-03-04T10:00:00Z' })],
      });
      const result = scoreAttention(ticket, currentUser, { now: NOW, staleDays: 5 });
      assert.equal(result.urgency, 'needs-response');
    });

    it('downgrades with custom staleDays=3 when comment is 4 days old', () => {
      const ticket = makeTicket({
        comments: [makeComment({ authorAccountId: 'user-456', author: 'Sarah QA', created: '2026-03-02T10:00:00Z' })],
      });
      const result = scoreAttention(ticket, currentUser, { now: NOW, staleDays: 3 });
      assert.equal(result.urgency, 'aging');
    });

    it('includes reason with commenter name and days in aging downgrade', () => {
      const ticket = makeTicket({
        comments: [makeComment({ authorAccountId: 'user-456', author: 'Sarah QA', created: '2026-02-20T10:00:00Z' })],
      });
      const result = scoreAttention(ticket, currentUser, { now: NOW, staleDays: 5 });
      assert.ok(result.reason.includes('Sarah QA'));
    });
  });

  describe('bot filtering', () => {
    it('skips non-VCS bot comments when determining last commenter', () => {
      const ticket = makeTicket({
        comments: [
          makeComment({ authorAccountId: 'user-456', author: 'Sarah QA' }),
          makeComment({ authorAccountId: 'bot-1', author: 'Jira Automation', body: 'Transition logged', created: '2026-03-06T01:00:00Z' }),
        ],
      });
      const result = scoreAttention(ticket, currentUser, { now: NOW });
      assert.equal(result.urgency, 'needs-response');
      assert.ok(result.reason.includes('Sarah QA'));
    });

    it('ticket with only non-VCS bot comments checks aging', () => {
      const ticket = makeTicket({
        updated: '2026-02-25T10:00:00Z',
        comments: [makeComment({ author: 'Jenkins', authorAccountId: 'bot-1', body: 'Build passed' })],
      });
      const result = scoreAttention(ticket, currentUser, { now: NOW });
      assert.equal(result.urgency, 'aging');
    });

    it('SVN commit by current user after reviewer comment marks ticket clear', () => {
      const ticket = makeTicket({
        comments: [
          makeComment({ authorAccountId: 'user-456', author: 'Vania QA', body: 'Issues reported.' }),
          makeComment({
            author: 'Automatic Bot', authorAccountId: null, authorName: 'AutoBot',
            body: '{panel:title=SVN Commit} *Author:* jdev \n *Revision #:* 124383\n *Message:* Fix issues',
            created: '2026-03-05T12:00:00Z',
          }),
        ],
      });
      const result = scoreAttention(ticket, currentUser, { now: NOW });
      assert.equal(result.urgency, 'clear');
    });

    it('SVN commit by different user does NOT mark ticket clear', () => {
      const ticket = makeTicket({
        comments: [
          makeComment({ authorAccountId: 'user-456', author: 'Vania QA', body: 'Issues reported.' }),
          makeComment({
            author: 'Automatic Bot', authorAccountId: null, authorName: 'AutoBot',
            body: '{panel:title=SVN Commit} *Author:* otherdev \n *Revision #:* 124383\n *Message:* Unrelated fix',
            created: '2026-03-05T12:00:00Z',
          }),
        ],
      });
      const result = scoreAttention(ticket, currentUser, { now: NOW });
      assert.equal(result.urgency, 'needs-response');
      assert.ok(result.reason.includes('Vania QA'));
    });
  });

});

describe('isBotCommitByUser', () => {
  it('detects SVN commit by current user', () => {
    const comment = makeComment({
      author: 'Automatic Bot',
      body: '{panel:title=SVN Commit} *Author:* jdev \n *Revision #:* 124383',
    });
    assert.ok(isBotCommitByUser(comment, currentUser));
  });

  it('rejects SVN commit by different user', () => {
    const comment = makeComment({
      author: 'Automatic Bot',
      body: '{panel:title=SVN Commit} *Author:* otherdev \n *Revision #:* 124383',
    });
    assert.ok(!isBotCommitByUser(comment, currentUser));
  });

  it('rejects non-VCS bot comment', () => {
    const comment = makeComment({
      author: 'Jira Automation',
      body: 'Ticket transitioned to In Progress',
    });
    assert.ok(!isBotCommitByUser(comment, currentUser));
  });

  it('handles null body', () => {
    const comment = makeComment({ body: null });
    assert.ok(!isBotCommitByUser(comment, currentUser));
  });
});

describe('findLastEffectiveComment', () => {
  it('returns human comment when no bots', () => {
    const comments = [makeComment({ author: 'Sarah QA', authorAccountId: 'user-456' })];
    const { comment, fromCurrentUser } = findLastEffectiveComment(comments, currentUser);
    assert.equal(comment.author, 'Sarah QA');
    assert.ok(!fromCurrentUser);
  });

  it('skips non-VCS bot, returns previous human', () => {
    const comments = [
      makeComment({ author: 'Sarah QA', authorAccountId: 'user-456' }),
      makeComment({ author: 'Jira Automation', body: 'Auto transition' }),
    ];
    const { comment } = findLastEffectiveComment(comments, currentUser);
    assert.equal(comment.author, 'Sarah QA');
  });

  it('treats VCS commit by current user as their response', () => {
    const comments = [
      makeComment({ author: 'Sarah QA', authorAccountId: 'user-456' }),
      makeComment({
        author: 'Automatic Bot',
        body: '{panel:title=SVN Commit} *Author:* jdev \n *Revision #:* 124383',
      }),
    ];
    const { comment, fromCurrentUser } = findLastEffectiveComment(comments, currentUser);
    assert.equal(comment.author, 'Automatic Bot');
    assert.ok(fromCurrentUser);
  });

  it('returns null for empty comments', () => {
    const { comment } = findLastEffectiveComment([], currentUser);
    assert.equal(comment, null);
  });
});

describe('sortByUrgency', () => {
  it('puts needs-response before aging before clear', () => {
    const scores = [
      { urgency: 'clear', lastComment: { created: '2026-03-06T10:00:00Z' } },
      { urgency: 'aging', lastComment: { created: '2026-02-28T10:00:00Z' } },
      { urgency: 'needs-response', lastComment: { created: '2026-03-05T10:00:00Z' } },
    ];
    const sorted = sortByUrgency(scores);
    assert.equal(sorted[0].urgency, 'needs-response');
    assert.equal(sorted[1].urgency, 'aging');
    assert.equal(sorted[2].urgency, 'clear');
  });

  it('within same urgency, sorts by most recent comment first', () => {
    const scores = [
      { urgency: 'needs-response', lastComment: { created: '2026-03-01T10:00:00Z' } },
      { urgency: 'needs-response', lastComment: { created: '2026-03-05T10:00:00Z' } },
    ];
    const sorted = sortByUrgency(scores);
    assert.equal(sorted[0].lastComment.created, '2026-03-05T10:00:00Z');
    assert.equal(sorted[1].lastComment.created, '2026-03-01T10:00:00Z');
  });

  it('LOCK: no opts, empty opts, and sortBy=urgency all produce identical output to today', () => {
    const scores = [
      { urgency: 'clear', priority: 'Highest', lastComment: { created: '2026-03-06T10:00:00Z' } },
      { urgency: 'aging', priority: 'Low', lastComment: { created: '2026-02-28T10:00:00Z' } },
      { urgency: 'needs-response', priority: 'Medium', lastComment: { created: '2026-03-05T10:00:00Z' } },
    ];
    const noOpts = sortByUrgency(scores);
    const emptyOpts = sortByUrgency(scores, {});
    const explicitUrgency = sortByUrgency(scores, { sortBy: 'urgency' });
    assert.deepEqual(noOpts.map(s => s.urgency), ['needs-response', 'aging', 'clear']);
    assert.deepEqual(emptyOpts.map(s => s.urgency), noOpts.map(s => s.urgency));
    assert.deepEqual(explicitUrgency.map(s => s.urgency), noOpts.map(s => s.urgency));
  });

  it('sortBy priority ranks Highest before High before Medium regardless of urgency', () => {
    const scores = [
      { urgency: 'clear', priority: 'Medium', lastComment: null },
      { urgency: 'clear', priority: 'Highest', lastComment: null },
      { urgency: 'clear', priority: 'High', lastComment: null },
    ];
    const sorted = sortByUrgency(scores, { sortBy: 'priority' });
    assert.deepEqual(sorted.map(s => s.priority), ['Highest', 'High', 'Medium']);
  });

  it('sortBy priority uses urgency as tiebreaker within the same priority', () => {
    const scores = [
      { urgency: 'clear', priority: 'High', lastComment: null },
      { urgency: 'needs-response', priority: 'High', lastComment: { created: '2026-03-05T10:00:00Z' } },
    ];
    const sorted = sortByUrgency(scores, { sortBy: 'priority' });
    assert.equal(sorted[0].urgency, 'needs-response');
    assert.equal(sorted[1].urgency, 'clear');
  });

  it('sortBy priority sorts missing/unknown priority last, never throws', () => {
    const scores = [
      { urgency: 'clear', priority: null, lastComment: null },
      { urgency: 'clear', priority: 'Low', lastComment: null },
      { urgency: 'clear', priority: 'Some Custom Priority', lastComment: null },
    ];
    let sorted;
    assert.doesNotThrow(() => { sorted = sortByUrgency(scores, { sortBy: 'priority' }); });
    assert.equal(sorted[0].priority, 'Low');
  });
});

describe('PRIORITY_ORDER', () => {
  it('exports PRIORITY_ORDER as a plain object', () => {
    assert.strictEqual(typeof PRIORITY_ORDER, 'object');
  });

  it('classifies Highest/Urgent/Blocker before High before everything else', () => {
    assert.ok(PRIORITY_ORDER.highest < PRIORITY_ORDER.high);
    assert.ok(PRIORITY_ORDER.high < PRIORITY_ORDER.medium);
  });
});

// ── LOCK TESTS — pin existing output shape before Feature 10 (custom rules) ──

describe('scoreAttention — output shape lock (no customRules)', () => {
  const user = { accountId: 'u1', name: 'dev', displayName: 'Dev' };
  const base = { key: 'LOCK-1', summary: 'Lock test', status: 'In Progress', comments: [], updated: new Date('2026-03-05T12:00:00Z').toISOString() };

  it('returns all required fields when ticket is clear', () => {
    const result = scoreAttention({ ...base, updated: new Date('2026-03-05T12:00:00Z').toISOString() }, user, { now: new Date('2026-03-06T12:00:00Z') });
    assert.ok('ticketKey' in result, 'ticketKey missing');
    assert.ok('summary' in result, 'summary missing');
    assert.ok('status' in result, 'status missing');
    assert.ok('urgency' in result, 'urgency missing');
    assert.ok('reason' in result, 'reason missing');
    assert.ok('lastComment' in result, 'lastComment missing');
  });

  it('urgency is one of needs-response | aging | clear', () => {
    const result = scoreAttention(base, user, { now: new Date('2026-03-06T12:00:00Z') });
    assert.ok(['needs-response', 'aging', 'clear'].includes(result.urgency));
  });

  it('calling with undefined customRules does not throw', () => {
    assert.doesNotThrow(() => scoreAttention(base, user, { now: new Date('2026-03-06T12:00:00Z'), customRules: undefined }));
  });

  it('calling with empty customRules array does not throw', () => {
    assert.doesNotThrow(() => scoreAttention(base, user, { now: new Date('2026-03-06T12:00:00Z'), customRules: [] }));
  });

  it('includes priority field from the ticket when clear', () => {
    const result = scoreAttention({ ...base, priority: 'High' }, user, { now: new Date('2026-03-06T12:00:00Z') });
    assert.equal(result.priority, 'High');
  });

  it('priority is null when ticket has no priority field', () => {
    const result = scoreAttention(base, user, { now: new Date('2026-03-06T12:00:00Z') });
    assert.equal(result.priority, null);
  });

  it('includes priority field in needs-response result', () => {
    const ticket = {
      ...base,
      priority: 'Highest',
      comments: [{ author: 'Reviewer', authorAccountId: 'u-other', body: 'Please fix', created: '2026-03-06T10:00:00Z' }],
    };
    const result = scoreAttention(ticket, user, { now: new Date('2026-03-06T12:00:00Z') });
    assert.equal(result.urgency, 'needs-response');
    assert.equal(result.priority, 'Highest');
  });

  it('includes priority field in aging result', () => {
    const ticket = { ...base, priority: 'Low', updated: '2026-02-01T12:00:00Z' };
    const result = scoreAttention(ticket, user, { now: new Date('2026-03-06T12:00:00Z') });
    assert.equal(result.urgency, 'aging');
    assert.equal(result.priority, 'Low');
  });
});

// ─── URGENCY_ORDER export ─────────────────────────────────────────────────

describe('URGENCY_ORDER', () => {
  it('exports URGENCY_ORDER as a plain object', () => {
    assert.strictEqual(typeof URGENCY_ORDER, 'object');
  });

  it('needs-response < aging < stale < clear', () => {
    assert.ok(URGENCY_ORDER['needs-response'] < URGENCY_ORDER['aging'],    'needs-response must precede aging');
    assert.ok(URGENCY_ORDER['aging']           < URGENCY_ORDER['stale'],   'aging must precede stale');
    assert.ok(URGENCY_ORDER['stale']           < URGENCY_ORDER['clear'],   'stale must precede clear');
  });
});

// ─── scoreAttention — stale rule ─────────────────────────────────────────

describe('scoreAttention — stale rule', () => {
  const NOW = new Date('2026-06-02T12:00:00Z');
  const user = { accountId: 'u1', name: 'dev', displayName: 'Dev' };

  function makeStaleTicket(overrides = {}) {
    return {
      key: 'PROJ-55',
      summary: 'Stuck ticket',
      status: 'In Review',
      updated: '2026-06-01T10:00:00Z',
      statusChangedAt: '2026-04-01T10:00:00Z', // 62 days before NOW
      comments: [],
      ...overrides,
    };
  }

  const activeRule = { enabled: true, stale_days: 14, statuses: ['In Review', 'In Progress'] };

  it('returns stale when ticket is in a watched status for >= stale_days', () => {
    const result = scoreAttention(makeStaleTicket(), user, { now: NOW, staleRule: activeRule });
    assert.strictEqual(result.urgency, 'stale');
    assert.ok(result.reason.includes('In Review'), `reason should mention status, got: ${result.reason}`);
    assert.ok(result.reason.includes('62d') || result.reason.includes('d'), `reason should mention days, got: ${result.reason}`);
  });

  it('includes daysInCurrentStatus in stale result', () => {
    const result = scoreAttention(makeStaleTicket(), user, { now: NOW, staleRule: activeRule });
    assert.strictEqual(result.urgency, 'stale');
    assert.ok(typeof result.daysInCurrentStatus === 'number');
    assert.ok(result.daysInCurrentStatus >= 14);
  });

  it('returns clear when no stale rule is provided', () => {
    const result = scoreAttention(makeStaleTicket(), user, { now: NOW });
    assert.strictEqual(result.urgency, 'clear');
  });

  it('returns clear when stale rule is disabled', () => {
    const disabledRule = { ...activeRule, enabled: false };
    const result = scoreAttention(makeStaleTicket(), user, { now: NOW, staleRule: disabledRule });
    assert.strictEqual(result.urgency, 'clear');
  });

  it('returns clear when ticket status is not in stale rule statuses list', () => {
    const ticket = makeStaleTicket({ status: 'Code Review' });
    const result = scoreAttention(ticket, user, { now: NOW, staleRule: activeRule });
    assert.strictEqual(result.urgency, 'clear');
  });

  it('returns clear when days in status < stale_days', () => {
    const recentTicket = makeStaleTicket({ statusChangedAt: '2026-05-30T10:00:00Z' }); // 3 days ago
    const result = scoreAttention(recentTicket, user, { now: NOW, staleRule: activeRule });
    assert.strictEqual(result.urgency, 'clear');
  });

  it('returns clear when statusChangedAt is absent (changelog not fetched)', () => {
    const ticket = makeStaleTicket({ statusChangedAt: null });
    const result = scoreAttention(ticket, user, { now: NOW, staleRule: activeRule });
    assert.strictEqual(result.urgency, 'clear');
  });

  it('does not override aging — aging takes priority over stale', () => {
    // Ticket has no last comment AND updated was 30 days ago → aging fires first
    const agingTicket = makeStaleTicket({ updated: '2026-05-01T10:00:00Z', comments: [] });
    const result = scoreAttention(agingTicket, user, { now: NOW, staleDays: 5, staleRule: activeRule });
    assert.strictEqual(result.urgency, 'aging');
  });

  it('does not override needs-response — needs-response takes priority over stale', () => {
    const otherUser = { author: 'Reviewer', authorAccountId: 'u-other', authorName: 'reviewer', created: '2026-06-01T10:00:00Z', body: 'Please fix' };
    const ticket = makeStaleTicket({ comments: [otherUser] });
    const result = scoreAttention(ticket, user, { now: NOW, staleRule: activeRule });
    assert.strictEqual(result.urgency, 'needs-response');
  });

  it('includes priority field in stale result', () => {
    const result = scoreAttention(makeStaleTicket({ priority: 'Highest' }), user, { now: NOW, staleRule: activeRule });
    assert.strictEqual(result.urgency, 'stale');
    assert.equal(result.priority, 'Highest');
  });
});

// ─── sortByUrgency — stale slot ───────────────────────────────────────────

describe('sortByUrgency — stale slot', () => {
  const NOW = new Date('2026-06-02T12:00:00Z');

  function makeResult(urgency, key = 'PROJ-1') {
    return { ticketKey: key, urgency, status: 'In Review', summary: 'Test', reason: 'Test', lastComment: null };
  }

  it('sorts stale between aging and clear', () => {
    const input = [
      makeResult('clear',          'PROJ-1'),
      makeResult('stale',          'PROJ-2'),
      makeResult('aging',          'PROJ-3'),
      makeResult('needs-response', 'PROJ-4'),
    ];
    const sorted = sortByUrgency(input);
    const urgencies = sorted.map(r => r.urgency);
    assert.deepEqual(urgencies, ['needs-response', 'aging', 'stale', 'clear']);
  });
});
