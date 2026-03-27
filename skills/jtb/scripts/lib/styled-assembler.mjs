import { createStyler } from './ansi.mjs';
import { formatTable } from './table-formatter.mjs';
import { formatSize } from './attachment-downloader.mjs';
import { timeAgo, truncate, stripCr } from './config.mjs';

function divWidth() {
  return 30;
}
function halfDivWidth() {
  return 15;
}
function statusColor(s, status) {
  const st = (status || '').toLowerCase();
  if (/done|closed|resolved|complete/.test(st)) return s.green(status);
  if (/progress|review|testing|qa/.test(st)) return s.yellow(status);
  return status;
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
  sections.push(s.bold(`${actionable.length} tickets need attention`) + ' ' + s.dim(`(${parts.join(', ')})`) );

  // Legend + base URL hint
  const legendParts = [];
  if (needsResponse.length > 0) legendParts.push(`${s.red('●')} needs response`);
  if (aging.length > 0) legendParts.push(`${s.yellow('●')} aging`);
  let legend = legendParts.join('    ');
  if (browseUrl) legend += `\n${s.dim('Open:')} ${browseUrl}${s.dim('<key>')}`;
  sections.push(legend);

  const ticketCell = (key, colorFn) => {
    return colorFn('●') + ' ' + key;
  };

  if (needsResponse.length > 0) {
    const tableRows = needsResponse.map((t, i) => {
      const ago = t.lastComment ? timeAgo(t.lastComment.created) : '';
      const commenter = t.lastComment?.author ?? 'Unknown';
      const snippet = t.lastComment?.body ? truncate(t.lastComment.body, 40) : '';
      return [String(i + 1), ticketCell(t.ticketKey, s.red), truncate(t.summary, 45), t.status, commenter, ago, snippet];
    });
    const table = formatTable(
      ['#', 'Ticket', 'Title', 'Status', 'From', 'When', 'Comment'],
      tableRows,
      { maxWidths: { 2: 45, 6: 40 } },
    );
    sections.push(table);
  }

  if (aging.length > 0) {
    const agingOffset = needsResponse.length;
    const tableRows = aging.map((t, i) => {
      const days = t.daysSinceUpdate ?? '?';
      return [String(agingOffset + i + 1), ticketCell(t.ticketKey, s.yellow), truncate(t.summary, 45), t.status, `${days}d`];
    });
    const table = formatTable(
      ['#', 'Ticket', 'Title', 'Status', 'Stale'],
      tableRows,
      { maxWidths: { 2: 45 } },
    );
    sections.push(table);
  }

  return sections.join('\n\n');
}

export function styleBrief(ticket, codeRefs = null, opts = {}) {
  const { styled = true } = opts;
  const s = createStyler({ forceColor: styled, noColor: !styled });

  const sections = [];

  // Header: ticket key + summary
  sections.push(s.bold(s.cyan(`${ticket.key}: ${ticket.summary}`)));

  // Metadata line
  const meta = [
    `${s.dim('Type:')} ${ticket.type}`,
    `${s.dim('Status:')} ${statusColor(s, ticket.status)}`,
    `${s.dim('Priority:')} ${ticket.priority}`,
    `${s.dim('Assignee:')} ${ticket.assignee ?? 'Unassigned'}`,
  ];
  if (ticket.created) meta.push(`${s.dim('Created:')} ${ticket.created.split('T')[0]}`);
  if (ticket.updated) meta.push(`${s.dim('Updated:')} ${ticket.updated.split('T')[0]}`);
  sections.push(meta.join(s.dim('  ·  ')));

  // Description
  if (ticket.description) {
    sections.push(`${s.bold(s.cyan('Description'))}\n${s.dim('─'.repeat(divWidth()))}\n${stripCr(ticket.description)}`);
  }

  // Comments
  if (ticket.comments?.length > 0) {
    const commentLines = ticket.comments.map(c => {
      const date = c.created ? c.created.split('T')[0] : 'unknown';
      return `${s.cyan(c.author)} ${s.dim(`(${date})`)}\n${stripCr(c.body)}`;
    });
    sections.push(`${s.bold(s.cyan('Comments'))}\n${s.dim('─'.repeat(divWidth()))}\n${commentLines.join(`\n\n${s.dim('─'.repeat(halfDivWidth()))}\n`)}`);
  }

  // Linked tickets
  if (ticket.linkedTicketDetails?.length > 0) {
    const linkedSections = ticket.linkedTicketDetails.map(lt => {
      const parts = [`${s.cyan(lt.key)}: ${lt.summary}`, `${s.dim('Type:')} ${lt.type} | ${s.dim('Status:')} ${statusColor(s, lt.status)}`];
      if (lt.description) parts.push(stripCr(lt.description));
      if (lt.comments?.length > 0) {
        const cmts = lt.comments.map(c => {
          const date = c.created ? c.created.split('T')[0] : 'unknown';
          return `${s.cyan(c.author)} ${s.dim(`(${date})`)}: ${stripCr(c.body)}`;
        });
        parts.push(cmts.join('\n'));
      }
      return parts.join('\n');
    });
    sections.push(`${s.bold(s.cyan('Linked Tickets'))}\n${s.dim('─'.repeat(divWidth()))}\n${linkedSections.join(`\n\n${s.dim('─'.repeat(halfDivWidth()))}\n`)}`);
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
      sections.push(`${s.bold(s.cyan('Code References'))}\n${s.dim('─'.repeat(divWidth()))}\n${filled.join('\n')}`);
    }
  }

  if (ticket.attachments?.length > 0) {
    const lines = ticket.attachments.map(a => {
      const r = (ticket.localAttachments ?? []).find(x => x.filename === a.filename);
      const sz = formatSize(a.size);
      if (r?.localPath) {
        const note = r.skipReason === 'cached' ? s.dim(', cached') : '';
        return `  ${s.cyan(r.localPath)}${note}  ${s.dim(a.filename + ', ' + sz)}`;
      }
      if (r?.skipReason === 'too-large') return `  ${a.filename}  ${s.dim(sz + ' — exceeds 10 MB limit')}`;
      if (r?.skipReason === 'limit')     return `  ${a.filename}  ${s.dim(sz + ' — attachment limit reached')}`;
      if (r?.skipReason === 'error')     return `  ${a.filename}  ${s.red('download failed: ' + r.error)}`;
      return `  ${a.filename}  ${s.dim(sz)}`;
    });
    sections.push(`${s.bold(s.cyan('Attachments'))}\n${s.dim('─'.repeat(divWidth()))}\n${lines.join('\n')}`);
  }

  const out = sections.join('\n\n');

  if (!styled) return out;

  const ANSI_RE = /\x1b\[[0-9;]*m/g;
  const plainTextLength = out.replace(ANSI_RE, '').length;
  const briefTokens = Math.ceil(plainTextLength / 4);
  const ticketCount = 1 + (ticket.linkedTicketDetails?.length ?? 1);
  const rawTokenEstimate = Math.max(12000, ticketCount * 8000);
  const savings = Math.round((1 - briefTokens / rawTokenEstimate) * 100);
  const savingsStr = savings > 0 ? ` · ~${savings}% vs raw API` : '';
  const footer = s.dim(`  ○ ~${briefTokens} tokens loaded${savingsStr}  ·  --plain for pipe-safe output`);

  return out + '\n\n' + footer;
}
