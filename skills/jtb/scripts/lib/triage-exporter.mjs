import { writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DEFAULT_CONFIG_DIR } from './config.mjs';

/**
 * Export triage results to CSV or JSON.
 * @param {object} opts
 * @param {Array} opts.tickets - Scored ticket objects from attention-scorer
 * @param {'csv'|'json'} opts.format
 * @param {string} [opts.profile]
 * @param {string} [opts.configDir]
 * @returns {string} Absolute path to written file
 */
export function exportTriage({ tickets, format, profile = 'default', configDir = DEFAULT_CONFIG_DIR }) {
  // Check for path traversal attempts in profile name
  if (profile.includes('/') || profile.includes('\\') || profile.includes('..')) {
    throw new Error(`Invalid profile name: contains path traversal characters`);
  }

  const exportsDir = join(configDir, 'exports');
  assertSafePath(exportsDir, configDir);
  mkdirSync(exportsDir, { recursive: true });

  const dateStr = formatDate(new Date());
  const safeProfile = profile.replace(/[^a-z0-9_-]/gi, '_').slice(0, 40);
  const filename = `${dateStr}-${safeProfile}.${format}`;
  const outputPath = join(exportsDir, filename);
  const tmpPath = `${outputPath}.tmp`;

  const content = format === 'csv' ? buildCsv(tickets) : buildJson(tickets, profile);

  writeFileSync(tmpPath, content, 'utf8');
  renameSync(tmpPath, outputPath);

  return outputPath;
}

function buildCsv(tickets) {
  const header = '#,Ticket,Summary,Status,Urgency,LastCommentFrom,LastCommentDate,DaysSinceUpdate,URL';
  const rows = tickets.map((t, i) => [
    i + 1,
    t.ticketKey ?? '',
    escapeCsv(t.summary),
    t.status ?? '',
    t.urgency ?? '',
    escapeCsv(t.lastComment?.author ?? ''),
    t.lastComment?.created ?? '',
    t.daysSinceUpdate ?? '',
    t.url ?? '',
  ].join(','));
  return [header, ...rows].join('\n') + '\n';
}

function buildJson(tickets, profile) {
  const needsResponse = tickets.filter(t => t.urgency === 'needs-response').length;
  const aging = tickets.filter(t => t.urgency === 'aging').length;
  return JSON.stringify({
    exportedAt: new Date().toISOString(),
    profile,
    summary: { total: tickets.length, needsResponse, aging },
    tickets: tickets.map(t => ({
      ticketKey: t.ticketKey ?? null,
      summary: t.summary ?? null,
      status: t.status ?? null,
      urgency: t.urgency ?? null,
      lastComment: t.lastComment ?? null,
      daysSinceUpdate: t.daysSinceUpdate ?? null,
      url: t.url ?? null,
    })),
  }, null, 2);
}

function escapeCsv(str) {
  if (str == null) return '';
  const s = String(str).replace(/[\r\n]+/g, ' ');
  if (s.includes(',') || s.includes('"')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function formatDate(d) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}-${pad(d.getMinutes())}`;
}

function assertSafePath(targetPath, basePath) {
  const resolved = resolve(targetPath);
  const base = resolve(basePath);
  if (!resolved.startsWith(base + '/') && resolved !== base) {
    throw new Error(`Invalid path: ${targetPath} is outside ${basePath}`);
  }
}
