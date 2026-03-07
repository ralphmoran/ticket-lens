/**
 * Pure scoring logic for ticket triage.
 * No I/O — all functions take data and return results.
 */

const BOT_PATTERNS = [
  /^automatic\s*bot$/i,
  /^jira\s*(software|automation)?$/i,
  /^svn\s*commit/i,
  /^bitbucket/i,
  /^github/i,
  /^gitlab/i,
  /^jenkins/i,
  /^bamboo/i,
  /\bbot\b/i,
  /\bautomation\b/i,
];

export function isBot(authorName) {
  if (!authorName) return false;
  return BOT_PATTERNS.some(p => p.test(authorName));
}

const VCS_COMMIT_PATTERN = /\bsvn\s*commit\b|\bcommit\b.*\brevision\b|\bgit\s*commit\b/i;
const VCS_AUTHOR_PATTERN = /\*Author:\*\s*(\S+)/i;

/**
 * Check if a bot comment is a VCS commit by the current user.
 * Jira SVN/Git integrations post commits as bot users (e.g. "Automatic Bot")
 * but the commit body contains the actual author.
 */
export function isBotCommitByUser(comment, currentUser) {
  if (!comment?.body || !currentUser) return false;
  if (!VCS_COMMIT_PATTERN.test(comment.body)) return false;
  const match = comment.body.match(VCS_AUTHOR_PATTERN);
  if (!match) return false;
  const commitAuthor = match[1].toLowerCase();
  return (
    (currentUser.name && commitAuthor === currentUser.name.toLowerCase()) ||
    (currentUser.displayName && commitAuthor === currentUser.displayName.toLowerCase())
  );
}

export function isFromCurrentUser(comment, currentUser) {
  if (!comment || !currentUser) return false;
  // Cloud: match by accountId
  if (currentUser.accountId && comment.authorAccountId) {
    return comment.authorAccountId === currentUser.accountId;
  }
  // Server: match by name/username
  if (currentUser.name && comment.authorName) {
    return comment.authorName === currentUser.name;
  }
  // Fallback: displayName match
  if (currentUser.displayName && comment.author) {
    return comment.author === currentUser.displayName;
  }
  return false;
}

/**
 * Get the effective "last comment" considering bot VCS commits.
 * Walk backwards through all comments (including bots).
 * - If the last comment is a bot VCS commit by the current user, treat as user's response.
 * - If the last comment is any other bot, skip it.
 * - If a human comment, use it directly.
 */
export function findLastEffectiveComment(comments, currentUser) {
  for (let i = comments.length - 1; i >= 0; i--) {
    const c = comments[i];
    if (!isBot(c.author)) return { comment: c, fromCurrentUser: isFromCurrentUser(c, currentUser) };
    if (isBotCommitByUser(c, currentUser)) return { comment: c, fromCurrentUser: true };
    // Other bot comment — skip and keep looking
  }
  return { comment: null, fromCurrentUser: false };
}

export function scoreAttention(ticket, currentUser, opts = {}) {
  const { staleDays = 5, now = new Date() } = opts;

  const { comment: lastComment, fromCurrentUser } = findLastEffectiveComment(
    ticket.comments || [], currentUser
  );

  // Check needs-response: last effective comment is NOT from current user
  if (lastComment && !fromCurrentUser) {
    return {
      ticketKey: ticket.key,
      summary: ticket.summary,
      status: ticket.status,
      urgency: 'needs-response',
      reason: `${lastComment.author} commented`,
      lastComment,
    };
  }

  // Check aging: no activity for >= staleDays
  const updatedDate = ticket.updated ? new Date(ticket.updated) : null;
  if (updatedDate) {
    const daysSinceUpdate = (now - updatedDate) / (1000 * 60 * 60 * 24);
    if (daysSinceUpdate >= staleDays) {
      return {
        ticketKey: ticket.key,
        summary: ticket.summary,
        status: ticket.status,
        urgency: 'aging',
        reason: `No activity for ${Math.floor(daysSinceUpdate)} days`,
        lastComment,
        daysSinceUpdate: Math.floor(daysSinceUpdate),
      };
    }
  }

  return {
    ticketKey: ticket.key,
    summary: ticket.summary,
    status: ticket.status,
    urgency: 'clear',
    reason: 'Up to date',
    lastComment,
  };
}

const URGENCY_ORDER = { 'needs-response': 0, 'aging': 1, 'clear': 2 };

export function sortByUrgency(scores) {
  return [...scores].sort((a, b) => {
    const orderDiff = URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency];
    if (orderDiff !== 0) return orderDiff;
    // Within same urgency, sort by most recent activity (lastComment date or ticket updated)
    const dateA = a.lastComment?.created ? new Date(a.lastComment.created) : new Date(0);
    const dateB = b.lastComment?.created ? new Date(b.lastComment.created) : new Date(0);
    return dateB - dateA; // most recent first
  });
}
