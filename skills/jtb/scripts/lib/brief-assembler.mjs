/**
 * Assembles a normalized ticket into a structured markdown TicketBrief.
 */

import { formatTable } from './table-formatter.mjs';
import { formatSize } from './attachment-downloader.mjs';

export function assembleBrief(ticket, codeRefs = null) {
  const sections = [];
  sections.push(`# ${ticket.key}: ${ticket.summary}`);

  const meta = [`**Type:** ${ticket.type}`, `**Status:** ${ticket.status}`, `**Priority:** ${ticket.priority}`, `**Assignee:** ${ticket.assignee ?? 'Unassigned'}`, `**Reporter:** ${ticket.reporter ?? 'Unknown'}`];
  if (ticket.created) meta.push(`**Created:** ${ticket.created.split('T')[0]}`);
  if (ticket.updated) meta.push(`**Updated:** ${ticket.updated.split('T')[0]}`);
  sections.push(meta.join(' | '));

  if (ticket.description) {
    sections.push(`## Description\n\n${ticket.description}`);
  }

  if (ticket.comments?.length > 0) {
    const commentLines = ticket.comments.map(c => {
      const date = c.created ? c.created.split('T')[0] : 'unknown';
      return `### **${c.author}** (${date})\n\n${c.body.replace(/\r/g, '')}`;
    });
    sections.push(`## Comments\n\n${commentLines.join('\n\n---\n\n')}`);
  }

  if (ticket.linkedTicketDetails?.length > 0) {
    const linkedSections = ticket.linkedTicketDetails.map(lt => {
      const parts = [`### ${lt.key}: ${lt.summary}`, `**Type:** ${lt.type} | **Status:** ${lt.status}`];
      if (lt.description) parts.push(lt.description);
      if (lt.comments?.length > 0) {
        const cmts = lt.comments.map(c => {
          const date = c.created ? c.created.split('T')[0] : 'unknown';
          return `**${c.author}** (${date}): ${c.body.replace(/\r/g, '')}`;
        });
        parts.push(cmts.join('\n\n'));
      }
      return parts.join('\n\n');
    });
    sections.push(`## Linked Tickets\n\n${linkedSections.join('\n\n---\n\n')}`);
  }

  if (codeRefs) {
    const categories = [
      ['File Paths', codeRefs.filePaths],
      ['Methods', codeRefs.methods],
      ['Classes', codeRefs.classes],
      ['Git SHAs', codeRefs.shas],
      ['SVN Revisions', codeRefs.svnRevisions],
      ['Branches', codeRefs.branches],
      ['Namespaces', codeRefs.namespaces],
    ];
    const filled = categories
      .filter(([, items]) => items?.length > 0)
      .map(([label, items]) => `**${label}:** ${items.map(i => '`' + i + '`').join(', ')}`);
    if (filled.length > 0) {
      sections.push(`## Code References\n\n${filled.join('\n')}`);
    }
  }

  if (ticket.attachments?.length > 0) {
    const lines = ticket.attachments.map(a => {
      const r = (ticket.localAttachments ?? []).find(x => x.filename === a.filename);
      const sz = formatSize(a.size);
      if (r?.localPath) {
        const note = r.skipReason === 'cached' ? ', cached' : '';
        return `- \`${r.localPath}\` _(${a.filename}, ${sz}${note})_`;
      }
      if (r?.skipReason === 'too-large') return `- ${a.filename} _(${sz} — exceeds 10 MB limit)_`;
      if (r?.skipReason === 'limit')     return `- ${a.filename} _(${sz} — attachment limit reached)_`;
      if (r?.skipReason === 'error')     return `- ${a.filename} _(${sz} — download failed: ${r.error})_`;
      return `- ${a.filename} _(${sz})_`;
    });
    sections.push(`## Attachments\n\n${lines.join('\n')}`);
  }

  return sections.join('\n\n');
}

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function assembleTriageSummary(scoredTickets, opts = {}) {
  const { staleDays = 5, baseUrl } = opts;
  const browseUrl = baseUrl ? baseUrl.replace(/\/$/, '') + '/browse/' : null;
  const actionable = scoredTickets.filter(t => t.urgency !== 'clear');

  if (actionable.length === 0) {
    return 'All clear — no tickets need your attention right now.';
  }

  const sections = [];
  sections.push(`Tickets Needing Your Attention (${actionable.length} found)`);

  const needsResponse = actionable.filter(t => t.urgency === 'needs-response');
  const aging = actionable.filter(t => t.urgency === 'aging');
  const allKeys = [];

  if (needsResponse.length > 0) {
    const tableRows = needsResponse.map((t, i) => {
      allKeys.push(t.ticketKey);
      const ago = t.lastComment ? timeAgo(t.lastComment.created) : '';
      const commenter = t.lastComment?.author ?? 'Unknown';
      const snippet = t.lastComment?.body ? truncate(t.lastComment.body, 60) : '';
      return [String(i + 1), t.ticketKey, truncate(t.summary, 50), t.status, commenter, ago, snippet];
    });
    const table = formatTable(
      ['#', 'Ticket', 'Summary', 'Status', 'From', 'When', 'Comment'],
      tableRows,
      { maxWidths: { 2: 50, 6: 60 } },
    );
    sections.push(`Needs Response (${needsResponse.length})\n\n${table}`);
  }

  if (aging.length > 0) {
    const agingOffset = needsResponse.length;
    const tableRows = aging.map((t, i) => {
      allKeys.push(t.ticketKey);
      const days = t.daysSinceUpdate ?? '?';
      return [String(agingOffset + i + 1), t.ticketKey, truncate(t.summary, 50), t.status, `${days}d`];
    });
    const table = formatTable(
      ['#', 'Ticket', 'Summary', 'Status', 'Stale'],
      tableRows,
      { maxWidths: { 2: 50 } },
    );
    sections.push(`Aging — no activity > ${staleDays} days (${aging.length})\n\n${table}`);
  }

  if (browseUrl && allKeys.length > 0) {
    const links = allKeys.map((k, i) => `[${i + 1}] ${k}: ${browseUrl}${k}`);
    sections.push(`Quick Links\n\n${links.join('\n')}`);
  }

  return sections.join('\n\n');
}

function truncate(str, max) {
  if (!str) return '';
  const oneLine = str.replace(/[\r\n]+/g, ' ').trim();
  if (oneLine.length <= max) return oneLine;
  return oneLine.slice(0, max - 3) + '...';
}
