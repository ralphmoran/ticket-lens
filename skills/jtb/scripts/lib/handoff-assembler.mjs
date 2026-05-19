import { readFileSync } from 'node:fs';
import { extname } from 'node:path';

export const HANDOFF_PROMPT = `Build a structured handoff brief from this Jira ticket.
The developer receiving this ticket has never seen it before — they need to get up to speed immediately.
Use the description, comments, attached documents, and linked Confluence pages as context.

Respond in exactly this format (use the exact headings):

### What was attempted
[2–5 bullet points of concrete work already done. Be specific — mention code paths, methods, or files if referenced.]

### Current blockers
[Bullet points of unresolved issues, errors, or dependencies blocking progress. Write "None identified" if the path is clear.]

### Open questions
[Bullet points of unanswered questions or decisions not yet made. Write "None identified" if everything is resolved.]

### Recommendation
[1–2 sentences on the best starting point for the incoming developer.]

Rules:
- Be specific and factual. Reference actual details from the ticket content.
- Do not invent anything not present in the provided context.
- Keep each bullet under 20 words.
- If there are no comments, base your analysis on the description and attached documents.

`;

const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.markdown', '.log', '.csv', '.json', '.xml', '.html', '.htm', '.rst', '.yaml', '.yml']);
const MAX_CHARS_PER_FILE = 4000;
const MAX_TOTAL_CHARS = 12000;

/**
 * Read text content from downloaded local attachments.
 * Skips binary files (images, PDFs, Office docs). Caps content per file and in total.
 * @param {Array} localAttachments - from ticket.localAttachments
 * @returns {Array<{filename: string, content: string}>}
 */
export function readTextAttachments(localAttachments = []) {
  let totalChars = 0;
  const result = [];
  for (const att of localAttachments) {
    if (!att.localPath || att.skipReason === 'error') continue;
    if (!TEXT_EXTENSIONS.has(extname(att.filename).toLowerCase())) continue;
    try {
      const raw = readFileSync(att.localPath, 'utf8');
      const trimmed = raw.trim();
      if (!trimmed) continue;
      const remaining = MAX_TOTAL_CHARS - totalChars;
      if (remaining <= 0) break;
      const content = trimmed.slice(0, Math.min(MAX_CHARS_PER_FILE, remaining));
      totalChars += content.length;
      result.push({ filename: att.filename, content });
    } catch { /* unreadable — skip */ }
  }
  return result;
}

/**
 * Build the text input sent to the AI for handoff analysis.
 * Includes description, Confluence pages, text-readable attachments, and comment thread.
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

  if (ticket.description) {
    lines.push('--- Description ---');
    lines.push(ticket.description.replace(/\r/g, ''));
    lines.push('');
  }

  if (ticket.confluencePages?.length > 0) {
    lines.push(`--- Confluence Pages (${ticket.confluencePages.length}) ---`);
    for (const p of ticket.confluencePages) {
      lines.push('');
      lines.push(`### ${p.title ?? p.url}`);
      if (p.text) lines.push(p.text);
    }
    lines.push('');
  }

  const textAttachments = readTextAttachments(ticket.localAttachments);
  if (textAttachments.length > 0) {
    lines.push(`--- Attached Documents (${textAttachments.length} text-readable) ---`);
    for (const { filename, content } of textAttachments) {
      lines.push('');
      lines.push(`=== ${filename} ===`);
      lines.push(content);
    }
    lines.push('');
  }

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
