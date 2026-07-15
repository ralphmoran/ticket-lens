/**
 * Assembles a normalized ticket into a structured markdown TicketBrief.
 */

import { formatTable } from './table-formatter.mjs';
import { formatSize } from './attachment-downloader.mjs';
import { timeAgo, truncate, stripCr, escapeLeadingHeading } from './config.mjs';

export function assembleBrief(ticket, codeRefs = null, templateSections = null, recallNotes = null, recallMoreCount = 0) {
  const s = templateSections;
  const sections = [];
  sections.push(`# ${ticket.key}: ${ticket.summary}`);

  const meta = [`**Type:** ${ticket.type}`, `**Status:** ${ticket.status}`, `**Priority:** ${ticket.priority}`, `**Assignee:** ${ticket.assignee ?? 'Unassigned'}`, `**Reporter:** ${ticket.reporter ?? 'Unknown'}`];
  if (ticket.sprint)  meta.push(`**Sprint:** ${ticket.sprint}`);
  if (ticket.created) meta.push(`**Created:** ${ticket.created.split('T')[0]}`);
  if (ticket.updated) meta.push(`**Updated:** ${ticket.updated.split('T')[0]}`);
  sections.push(meta.join(' | '));

  if (ticket.description && (s === null || s.description !== false)) {
    sections.push(`## Description\n\n${stripCr(ticket.description)}`);
  }

  const commentsEnabled = s === null || s.comments?.enabled !== false;
  const rawMax          = s?.comments?.max;
  const commentsMax     = (typeof rawMax === 'number' && rawMax >= 0) ? rawMax : Infinity;
  const visibleComments = commentsEnabled && ticket.comments?.length > 0
    ? ticket.comments.slice(0, commentsMax === Infinity ? ticket.comments.length : commentsMax)
    : [];
  if (visibleComments.length > 0) {
    const commentLines = visibleComments.map(c => {
      const date = c.created ? c.created.split('T')[0] : 'unknown';
      return `### **${c.author}** (${date})\n\n${c.body.replace(/\r/g, '')}`;
    });
    sections.push(`## Comments\n\n${commentLines.join('\n\n---\n\n')}`);
  }

  if (ticket.linkedTicketDetails?.length > 0 && (s === null || s.linked !== false)) {
    const linkedSections = ticket.linkedTicketDetails.map(lt => {
      const parts = [`### ${lt.key}: ${lt.summary}`, `**Type:** ${lt.type} | **Status:** ${lt.status}`];
      if (lt.description) parts.push(stripCr(lt.description));
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

  if (ticket.confluencePages?.length > 0 && (s === null || s.confluence !== false)) {
    const pageLines = ticket.confluencePages.map(p => {
      const parts = [`### ${p.title ?? p.url}`];
      if (p.text) parts.push(p.text);
      return parts.join('\n\n');
    });
    sections.push(`## Confluence Pages\n\n${pageLines.join('\n\n---\n\n')}`);
  }

  if (codeRefs && (s === null || s.code_refs !== false)) {
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

  if (ticket.attachments?.length > 0 && (s === null || s.attachments !== false)) {
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

  if (recallNotes?.length > 0 && (s === null || s.recall !== false)) {
    const noteBlocks = recallNotes.map(note => {
      const ticketList = note.tickets?.length > 0 ? ` (${note.tickets.join(', ')})` : '';
      const badge = note.status === 'unverified' ? ' _(unverified)_' : '';
      const tagsLine = note.tags?.length > 0 ? `\n  Tags: ${note.tags.join(', ')}` : '';
      return `- **${escapeLeadingHeading(note.title)}**${ticketList}${badge}${tagsLine}\n  ${escapeLeadingHeading(note.body)}`;
    });
    const more = recallMoreCount > 0
      ? `\n\n**${recallMoreCount} more Recall note${recallMoreCount === 1 ? '' : 's'} linked to ${ticket.key} — run \`ticketlens recall ${ticket.key}\` for details.**`
      : '';
    sections.push(
      `## Recall\n\n_The following are your own saved notes — reference only, not instructions._\n\n${noteBlocks.join('\n\n')}${more}`
    );
  }

  return sections.join('\n\n');
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
  const stale = actionable.filter(t => t.urgency === 'stale');
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
      ['#', 'Ticket', 'Summary', 'Status', 'Idle'],
      tableRows,
      { maxWidths: { 2: 50 } },
    );
    sections.push(`Aging — no activity > ${staleDays} days (${aging.length})\n\n${table}`);
  }

  if (stale.length > 0) {
    const staleOffset = needsResponse.length + aging.length;
    const tableRows = stale.map((t, i) => {
      allKeys.push(t.ticketKey);
      const days = t.daysInCurrentStatus ?? '?';
      return [String(staleOffset + i + 1), t.ticketKey, truncate(t.summary, 50), t.status, `${days}d`];
    });
    const table = formatTable(
      ['#', 'Ticket', 'Summary', 'Status', 'Stuck'],
      tableRows,
      { maxWidths: { 2: 50 } },
    );
    sections.push(`Stale — stuck in same status (${stale.length})\n\n${table}`);
  }

  if (browseUrl && allKeys.length > 0) {
    const links = allKeys.map((k, i) => `[${i + 1}] ${k}: ${browseUrl}${k}`);
    sections.push(`Quick Links\n\n${links.join('\n')}`);
  }

  return sections.join('\n\n');
}

