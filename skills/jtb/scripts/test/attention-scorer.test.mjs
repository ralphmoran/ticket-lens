import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { scoreAttention, isFromCurrentUser, isBot, isBotCommitByUser, findLastEffectiveComment, sortByUrgency } from '../lib/attention-scorer.mjs';

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
});
