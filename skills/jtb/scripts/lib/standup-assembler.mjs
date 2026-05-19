import { extractTicketKeys } from './pr-review-assembler.mjs';

export const VALID_STANDUP_FLAG = /^(--since=.+|--format=(standup|pr)|--profile=.+|--plain)$/;

export function groupCommitsByTicket(logLines) {
  const groups = new Map();
  for (const line of logLines) {
    if (!line.trim()) continue;
    const keys = extractTicketKeys(line);
    if (keys.length === 0) {
      const bucket = groups.get('__no_key__') ?? [];
      bucket.push(line);
      groups.set('__no_key__', bucket);
    } else {
      for (const key of keys) {
        const bucket = groups.get(key) ?? [];
        if (!bucket.includes(line)) bucket.push(line);
        groups.set(key, bucket);
      }
    }
  }
  return groups;
}

function assemblePrBody(groups, ticketMap) {
  const lines = ['## What changed', ''];
  const keyedGroups = [...groups.entries()].filter(([k]) => k !== '__no_key__');
  for (const [key] of keyedGroups) {
    const ticket = ticketMap.get(key);
    const summary = ticket?.fields?.summary ?? ticket?.summary ?? null;
    lines.push(summary ? `- ${key}: ${summary}` : `- ${key}`);
  }
  lines.push('', '## Commits', '');
  const seen = new Set();
  for (const commits of groups.values()) {
    for (const c of commits) {
      if (!seen.has(c)) { seen.add(c); lines.push(`- ${c.trim()}`); }
    }
  }
  return lines.join('\n');
}

export function assembleStandup(groups, tickets, opts = {}) {
  const { since = '24', format = 'standup' } = opts;
  const ticketMap = new Map((tickets ?? []).map(t => [t.key, t]));

  if (format !== 'standup' && format !== 'pr') throw new Error(`Unknown standup format: "${format}"`);
  if (format === 'pr') return assemblePrBody(groups, ticketMap);

  const dateStr = new Date().toLocaleDateString('en-US', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  });
  const lines = [`## Standup — ${dateStr}`, ''];

  const keyedGroups = [...groups.entries()].filter(([k]) => k !== '__no_key__');
  const noKeyCommits = groups.get('__no_key__') ?? [];

  if (keyedGroups.length === 0 && noKeyCommits.length === 0) {
    const hourLabel = /^\d+$/.test(since)
      ? `${since} hour${since === '1' ? '' : 's'}`
      : since;
    lines.push(`_No commits in the last ${hourLabel}._`);
    return lines.join('\n');
  }

  if (keyedGroups.length > 0) {
    lines.push('### Commits by ticket', '');
    for (const [key, commits] of keyedGroups) {
      const ticket = ticketMap.get(key);
      const summary = ticket?.fields?.summary ?? ticket?.summary ?? null;
      const count = commits.length;
      const countStr = `${count} commit${count > 1 ? 's' : ''}`;
      const header = summary
        ? `**${key}** — ${summary} (${countStr})`
        : `**${key}** (${countStr})`;
      lines.push(header);
      for (const c of commits) lines.push(`  ${c.trim()}`);
      lines.push('');
    }
  }

  if (noKeyCommits.length > 0) {
    const count = noKeyCommits.length;
    lines.push(`[No ticket key] (${count} commit${count > 1 ? 's' : ''})`);
    for (const c of noKeyCommits) lines.push(`  ${c.trim()}`);
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

export function styleStandupMd(md, s) {
  if (!s.enabled) return md;
  return md
    .split('\n')
    .map(line => {
      if (line.startsWith('## Standup')) {
        return `\n  ${s.brand(s.bold('◆  ' + line.slice(3)))}`;
      }
      if (line.startsWith('### ')) {
        return `\n  ${s.bold(line.slice(4))}`;
      }
      const tkM = line.match(/^\*\*([A-Z][A-Z0-9]+-\d+)\*\*(.*)$/);
      if (tkM) {
        return `  ${s.cyan(s.bold(tkM[1]))}${tkM[2]}`;
      }
      if (line.startsWith('[No ticket key]')) {
        return `  ${s.dim(line)}`;
      }
      if (line.startsWith('  ')) {
        const shaM = line.trimStart().match(/^([0-9a-f]{6,})\s(.+)$/);
        if (shaM) return `  ${s.dim(shaM[1])} ${shaM[2]}`;
      }
      return line;
    })
    .join('\n');
}
