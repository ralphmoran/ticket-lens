export const HANDOFF_PROMPT = `Build a structured handoff brief from this Jira ticket's comment thread.
The developer receiving this ticket has never seen it before — they need to get up to speed immediately.

Respond in exactly this format (use the exact headings):

### What was attempted
[2–5 bullet points of concrete work already done, based on the comments. Be specific — mention code paths, methods, or files if the comments reference them.]

### Current blockers
[Bullet points of unresolved issues, errors, or dependencies blocking progress. Write "None identified" if the comments suggest the path is clear.]

### Open questions
[Bullet points of unanswered questions or decisions not yet made. Write "None identified" if everything is resolved.]

### Recommendation
[1–2 sentences on the best starting point for the incoming developer.]

Rules:
- Be specific and factual. Reference actual details from the comments.
- Do not invent anything not present in the comments.
- Keep each bullet under 20 words.
- If there are no comments, state that clearly in each section.

`;

/**
 * Build the text input sent to the AI for handoff analysis.
 * Contains the ticket header and full comment thread.
 *
 * @param {object} ticket - Normalized ticket object from jira-client.normalizeTicket
 * @returns {string}
 */
export function buildHandoffInput(ticket) {
  const lines = [];

  const summary = ticket.summary ?? '(no summary)';
  lines.push(`Ticket: ${ticket.key} — ${summary}`);
  lines.push(`Status: ${ticket.status ?? 'Unknown'}`);
  lines.push(`Assignee: ${ticket.assignee ?? 'Unassigned'}`);
  if (ticket.reporter) lines.push(`Reporter: ${ticket.reporter}`);
  lines.push('');

  const comments = ticket.comments ?? [];
  lines.push(`--- Comments (${comments.length} total) ---`);

  if (comments.length === 0) {
    lines.push('(no comments)');
  } else {
    for (let i = 0; i < comments.length; i++) {
      const c = comments[i];
      const dateStr = c.created ? c.created.slice(0, 10) : 'unknown date';
      lines.push('');
      lines.push(`[${i + 1}] ${c.author ?? 'Unknown'} — ${dateStr}`);
      lines.push(c.body ?? '');
    }
  }

  return lines.join('\n');
}
