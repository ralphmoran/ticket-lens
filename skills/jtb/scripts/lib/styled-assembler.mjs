import { createStyler } from './ansi.mjs';
import { formatTable } from './table-formatter.mjs';

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

function truncate(str, max) {
  if (!str) return '';
  const oneLine = str.replace(/[\r\n]+/g, ' ').trim();
  if (oneLine.length <= max) return oneLine;
  return oneLine.slice(0, max - 3) + '...';
}

export function styleTriageSummary(scoredTickets, opts = {}) {
  const { staleDays = 5, baseUrl, styled = true } = opts;
  const s = createStyler({ forceColor: styled, noColor: !styled });
  const browseUrl = baseUrl ? baseUrl.replace(/\/$/, '') + '/browse/' : null;
  const actionable = scoredTickets.filter(t => t.urgency !== 'clear');

  if (actionable.length === 0) {
    return s.green('All clear — no tickets need your attention right now.');
  }

  const needsResponse = actionable.filter(t => t.urgency === 'needs-response');
  const aging = actionable.filter(t => t.urgency === 'aging');

  const parts = [];
  if (needsResponse.length > 0) parts.push(`${needsResponse.length} need response`);
  if (aging.length > 0) parts.push(`${aging.length} aging`);

  const sections = [];
  sections.push(s.bold(`${actionable.length} tickets need attention`) + ` (${parts.join(', ')})`);

  const allKeys = [];

  if (needsResponse.length > 0) {
    const tableRows = needsResponse.map((t, i) => {
      allKeys.push(t.ticketKey);
      const ago = t.lastComment ? timeAgo(t.lastComment.created) : '';
      const commenter = t.lastComment?.author ?? 'Unknown';
      const snippet = t.lastComment?.body ? truncate(t.lastComment.body, 60) : '';
      return [String(i + 1), s.red('[NEEDS RESPONSE]'), t.ticketKey, truncate(t.summary, 50), t.status, commenter, ago, snippet];
    });
    const table = formatTable(
      ['#', 'Flag', 'Ticket', 'Summary', 'Status', 'From', 'When', 'Comment'],
      tableRows,
      { maxWidths: { 3: 50, 7: 60 } },
    );
    sections.push(table);
  }

  if (aging.length > 0) {
    const agingOffset = needsResponse.length;
    const tableRows = aging.map((t, i) => {
      allKeys.push(t.ticketKey);
      const days = t.daysSinceUpdate ?? '?';
      return [String(agingOffset + i + 1), s.yellow('[AGING]'), t.ticketKey, truncate(t.summary, 50), t.status, `${days}d`];
    });
    const table = formatTable(
      ['#', 'Flag', 'Ticket', 'Summary', 'Status', 'Stale'],
      tableRows,
      { maxWidths: { 3: 50 } },
    );
    sections.push(table);
  }

  if (browseUrl && allKeys.length > 0) {
    const links = allKeys.map((k, i) => `[${i + 1}] ${k}: ${browseUrl}${k}`);
    sections.push(s.dim('Quick Links') + '\n\n' + links.join('\n'));
  }

  return sections.join('\n\n');
}

export function styleBrief(ticket, codeRefs = null, opts = {}) {
  const { styled = true } = opts;
  const s = createStyler({ forceColor: styled, noColor: !styled });

  const sections = [];

  // Header: ticket key + summary
  sections.push(s.bold(`${ticket.key}: ${ticket.summary}`));

  // Metadata line
  const meta = [
    `${s.dim('Type:')} ${ticket.type}`,
    `${s.dim('Status:')} ${ticket.status}`,
    `${s.dim('Priority:')} ${ticket.priority}`,
    `${s.dim('Assignee:')} ${ticket.assignee ?? 'Unassigned'}`,
  ];
  sections.push(meta.join('  |  '));

  // Description
  if (ticket.description) {
    sections.push(`${s.bold('Description')}\n${'─'.repeat(40)}\n${ticket.description}`);
  }

  // Comments
  if (ticket.comments?.length > 0) {
    const commentLines = ticket.comments.map(c => {
      const date = c.created ? c.created.split('T')[0] : 'unknown';
      return `${s.cyan(c.author)} ${s.dim(`(${date})`)}\n${c.body}`;
    });
    sections.push(`${s.bold('Comments')}\n${'─'.repeat(40)}\n${commentLines.join('\n\n───\n')}`);
  }

  // Linked tickets
  if (ticket.linkedTicketDetails?.length > 0) {
    const linkedSections = ticket.linkedTicketDetails.map(lt => {
      const parts = [`${s.cyan(lt.key)}: ${lt.summary}`, `${s.dim('Type:')} ${lt.type} | ${s.dim('Status:')} ${lt.status}`];
      if (lt.description) parts.push(lt.description);
      if (lt.comments?.length > 0) {
        const cmts = lt.comments.map(c => {
          const date = c.created ? c.created.split('T')[0] : 'unknown';
          return `${s.cyan(c.author)} ${s.dim(`(${date})`)}: ${c.body}`;
        });
        parts.push(cmts.join('\n'));
      }
      return parts.join('\n');
    });
    sections.push(`${s.bold('Linked Tickets')}\n${'─'.repeat(40)}\n${linkedSections.join('\n\n───\n')}`);
  }

  // Code references
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
      .map(([label, items]) => `${s.dim(label + ':')} ${items.map(i => s.cyan(i)).join(', ')}`);
    if (filled.length > 0) {
      sections.push(`${s.bold('Code References')}\n${'─'.repeat(40)}\n${filled.join('\n')}`);
    }
  }

  return sections.join('\n\n');
}
