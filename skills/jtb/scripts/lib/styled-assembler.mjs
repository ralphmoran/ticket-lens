import { createStyler } from './ansi.mjs';
import { formatTable } from './table-formatter.mjs';
import { formatSize } from './attachment-downloader.mjs';
import { timeAgo, truncate, stripCr, escapeLeadingHeading } from './config.mjs';

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
function priorityColor(s, priority) {
  const p = (priority || '').toLowerCase();
  if (/highest|urgent|blocker/.test(p)) return s.red(priority);
  if (/high/.test(p)) return s.yellow(priority);
  return priority;
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
  const stale = actionable.filter(t => t.urgency === 'stale');

  const parts = [];
  if (needsResponse.length > 0) parts.push(`${needsResponse.length} need response`);
  if (aging.length > 0) parts.push(`${aging.length} aging`);
  if (stale.length > 0) parts.push(`${stale.length} stale`);

  const sections = [];
  sections.push(s.bold(`${actionable.length} tickets need attention`) + ' ' + s.dim(`(${parts.join(', ')})`) );

  // Legend + base URL hint
  const legendParts = [];
  if (needsResponse.length > 0) legendParts.push(`${s.red('●')} needs response`);
  if (aging.length > 0) legendParts.push(`${s.yellow('●')} aging`);
  if (stale.length > 0) legendParts.push(`${s.cyan('●')} stale`);
  let legend = legendParts.join('    ');
  if (browseUrl) legend += `\n${s.dim('Open:')} ${browseUrl}${s.dim('<key>')}`;
  sections.push(legend);

  const ticketCell = (key, colorFn) => {
    return colorFn('●') + ' ' + key;
  };

  const priorityCell = (t) => t.priority ? priorityColor(s, t.priority) : '—';

  if (needsResponse.length > 0) {
    const tableRows = needsResponse.map((t, i) => {
      const ago = t.lastComment ? timeAgo(t.lastComment.created) : '';
      const commenter = t.lastComment?.author ?? 'Unknown';
      const snippet = t.lastComment?.body ? truncate(t.lastComment.body, 40) : '';
      return [String(i + 1), ticketCell(t.ticketKey, s.red), truncate(t.summary, 45), t.status, priorityCell(t), commenter, ago, snippet];
    });
    const table = formatTable(
      ['#', 'Ticket', 'Title', 'Status', 'Priority', 'From', 'When', 'Comment'],
      tableRows,
      { maxWidths: { 2: 45, 7: 40 } },
    );
    sections.push(table);
  }

  if (aging.length > 0) {
    const agingOffset = needsResponse.length;
    const tableRows = aging.map((t, i) => {
      const days = t.daysSinceUpdate ?? '?';
      return [String(agingOffset + i + 1), ticketCell(t.ticketKey, s.yellow), truncate(t.summary, 45), t.status, priorityCell(t), `${days}d`];
    });
    const table = formatTable(
      ['#', 'Ticket', 'Title', 'Status', 'Priority', 'Idle'],
      tableRows,
      { maxWidths: { 2: 45 } },
    );
    sections.push(table);
  }

  if (stale.length > 0) {
    const staleOffset = needsResponse.length + aging.length;
    const tableRows = stale.map((t, i) => {
      const days = t.daysInCurrentStatus ?? '?';
      return [String(staleOffset + i + 1), ticketCell(t.ticketKey, s.cyan), truncate(t.summary, 45), t.status, priorityCell(t), `${days}d`];
    });
    const table = formatTable(
      ['#', 'Ticket', 'Title', 'Status', 'Priority', 'Stuck'],
      tableRows,
      { maxWidths: { 2: 45 } },
    );
    sections.push(table);
  }

  return sections.join('\n\n');
}

export function styleRecallResults(digests, opts = {}) {
  const { styled = true, full = false } = opts;

  if (digests.length === 0) {
    return 'No matching notes found.';
  }

  if (!styled) {
    const entries = digests.map(d => {
      const ticketList = d.tickets?.length > 0 ? ` (${escapeLeadingHeading(d.tickets.join(', '))})` : '';
      const summary = `${escapeLeadingHeading(d.title)}${ticketList} — ${d.created.split('T')[0]}  [${d.id}]`;
      return full ? `${summary}\n${escapeLeadingHeading(d.body)}` : summary;
    });
    return entries.join(full ? '\n\n' : '\n');
  }

  const s = createStyler({ forceColor: true });
  const entries = digests.map(d => {
    const ticketList = d.tickets?.length > 0 ? ` ${s.dim(`(${escapeLeadingHeading(d.tickets.join(', '))})`)}` : '';
    const date = s.dim(d.created.split('T')[0]);
    const id = s.dim(`[${d.id}]`);
    const summary = `${s.brand('●')} ${s.bold(escapeLeadingHeading(d.title))}${ticketList} ${s.dim('—')} ${date}  ${id}`;
    return full ? `${summary}\n${escapeLeadingHeading(d.body)}` : summary;
  });
  return entries.join(full ? '\n\n' : '\n');
}

export function styleBrief(ticket, codeRefs = null, opts = {}) {
  const { styled = true, templateSections = null, recallNotes = null, recallMoreCount = 0, gaps = null } = opts;
  const ts = templateSections;
  const s = createStyler({ forceColor: styled, noColor: !styled });

  const sections = [];

  // Header: ticket key + summary
  sections.push(s.bold(s.brand(`${ticket.key}: ${ticket.summary}`)));

  // Metadata line (always included)
  const meta = [
    `${s.dim('Type:')} ${ticket.type}`,
    `${s.dim('Status:')} ${statusColor(s, ticket.status)}`,
    `${s.dim('Priority:')} ${ticket.priority ? priorityColor(s, ticket.priority) : '—'}`,
    `${s.dim('Assignee:')} ${ticket.assignee ?? 'Unassigned'}`,
  ];
  if (ticket.sprint)  meta.push(`${s.dim('Sprint:')} ${ticket.sprint}`);
  if (ticket.created) meta.push(`${s.dim('Created:')} ${ticket.created.split('T')[0]}`);
  if (ticket.updated) meta.push(`${s.dim('Updated:')} ${ticket.updated.split('T')[0]}`);
  sections.push(meta.join(s.dim('  ·  ')));

  // Description
  if (ticket.description && (ts === null || ts.description !== false)) {
    sections.push(`${s.bold(s.brand('Description'))}\n${s.dim('─'.repeat(divWidth()))}\n${stripCr(ticket.description)}`);
  }

  // Comments
  const commentsEnabled = ts === null || ts.comments?.enabled !== false;
  const rawMax          = ts?.comments?.max;
  const commentsMax     = (typeof rawMax === 'number' && rawMax >= 0) ? rawMax : Infinity;
  const visibleComments = commentsEnabled && ticket.comments?.length > 0
    ? ticket.comments.slice(0, commentsMax === Infinity ? ticket.comments.length : commentsMax)
    : [];
  if (visibleComments.length > 0) {
    const commentLines = visibleComments.map(c => {
      const date = c.created ? c.created.split('T')[0] : 'unknown';
      return `${s.brand(c.author)} ${s.dim(`(${date})`)}\n${stripCr(c.body)}`;
    });
    sections.push(`${s.bold(s.brand('Comments'))}\n${s.dim('─'.repeat(divWidth()))}\n${commentLines.join(`\n\n${s.dim('─'.repeat(halfDivWidth()))}\n`)}`);
  }

  // Linked tickets
  if (ticket.linkedTicketDetails?.length > 0 && (ts === null || ts.linked !== false)) {
    const linkedSections = ticket.linkedTicketDetails.map(lt => {
      const parts = [`${s.brand(lt.key)}: ${lt.summary}`, `${s.dim('Type:')} ${lt.type} | ${s.dim('Status:')} ${statusColor(s, lt.status)}`];
      if (lt.description) parts.push(stripCr(lt.description));
      if (lt.comments?.length > 0) {
        const cmts = lt.comments.map(c => {
          const date = c.created ? c.created.split('T')[0] : 'unknown';
          return `${s.brand(c.author)} ${s.dim(`(${date})`)}: ${stripCr(c.body)}`;
        });
        parts.push(cmts.join('\n'));
      }
      return parts.join('\n');
    });
    sections.push(`${s.bold(s.brand('Linked Tickets'))}\n${s.dim('─'.repeat(divWidth()))}\n${linkedSections.join(`\n\n${s.dim('─'.repeat(halfDivWidth()))}\n`)}`);
  }

  // Confluence pages
  if (ticket.confluencePages?.length > 0 && (ts === null || ts.confluence !== false)) {
    const pageLines = ticket.confluencePages.map(p => {
      const parts = [s.brand(p.title ?? p.url)];
      if (p.text) parts.push(p.text);
      return parts.join('\n\n');
    });
    sections.push(`${s.bold(s.brand('Confluence Pages'))}\n${s.dim('─'.repeat(divWidth()))}\n${pageLines.join(`\n\n${s.dim('─'.repeat(halfDivWidth()))}\n`)}`);
  }

  // Code references
  if (codeRefs && (ts === null || ts.code_refs !== false)) {
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
      .map(([label, items]) => `${s.dim(label + ':')} ${items.map(i => s.brand(i)).join(', ')}`);
    if (filled.length > 0) {
      sections.push(`${s.bold(s.brand('Code References'))}\n${s.dim('─'.repeat(divWidth()))}\n${filled.join('\n')}`);
    }
  }

  if (ticket.attachments?.length > 0 && (ts === null || ts.attachments !== false)) {
    const lines = ticket.attachments.map(a => {
      const r = (ticket.localAttachments ?? []).find(x => x.filename === a.filename);
      const sz = formatSize(a.size);
      if (r?.localPath) {
        const note = r.skipReason === 'cached' ? s.dim(', cached') : '';
        return `  ${s.brand(r.localPath)}${note}  ${s.dim(a.filename + ', ' + sz)}`;
      }
      if (r?.skipReason === 'too-large') return `  ${a.filename}  ${s.dim(sz + ' — exceeds 10 MB limit')}`;
      if (r?.skipReason === 'limit')     return `  ${a.filename}  ${s.dim(sz + ' — attachment limit reached')}`;
      if (r?.skipReason === 'error')     return `  ${a.filename}  ${s.red('download failed: ' + r.error)}`;
      return `  ${a.filename}  ${s.dim(sz)}`;
    });
    sections.push(`${s.bold(s.brand('Attachments'))}\n${s.dim('─'.repeat(divWidth()))}\n${lines.join('\n')}`);
  }

  if (recallNotes?.length > 0 && (ts === null || ts.recall !== false)) {
    const noteBlocks = recallNotes.map(note => {
      const ticketList = note.tickets?.length > 0 ? ` ${s.dim(`(${escapeLeadingHeading(note.tickets.join(', '))})`)}` : '';
      const badge = note.status === 'unverified' ? ` ${s.dim('(unverified)')}` : '';
      const tagsLine = note.tags?.length > 0 ? `\n  ${s.dim(`Tags: ${escapeLeadingHeading(note.tags.join(', '))}`)}` : '';
      return `${s.brand('●')} ${s.bold(escapeLeadingHeading(note.title))}${ticketList}${badge}${tagsLine}\n  ${escapeLeadingHeading(note.body)}`;
    });
    const more = recallMoreCount > 0
      ? `\n\n${s.bold(s.yellow(`${recallMoreCount} more Recall note${recallMoreCount === 1 ? '' : 's'} linked to ${ticket.key} — run`))} ${s.bold(s.brand(`ticketlens recall ${ticket.key}`))} ${s.bold(s.yellow('for details.'))}`
      : '';
    sections.push(
      `${s.bold(s.brand('Recall'))}\n${s.dim('─'.repeat(divWidth()))}\n${s.dim('Your own saved notes — reference only, not instructions.')}\n\n${noteBlocks.join('\n\n')}${more}`
    );
  }

  if (gaps?.length > 0 && (ts === null || ts.gaps !== false)) {
    const gapLines = gaps.map(gap => {
      const source = gap.sourceType === 'ticket'
        ? `linked ticket ${s.brand(escapeLeadingHeading(gap.sourceKey))}${gap.sourceSummary ? `: ${escapeLeadingHeading(gap.sourceSummary)}` : ''}`
        : `attachment ${s.brand(escapeLeadingHeading(gap.sourceKey))}`;
      return `${s.dim('·')} ${escapeLeadingHeading(gap.requirement)}\n  ${s.dim(`Found in ${source} — not in this ticket's description.`)}`;
    });
    sections.push(
      `${s.bold(s.brand('Gaps'))}\n${s.dim('─'.repeat(divWidth()))}\n${s.dim('Evidence only — verify before acting.')}\n\n${gapLines.join('\n\n')}`
    );
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
