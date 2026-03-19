/**
 * Cache management for downloaded Jira attachments.
 * Supports: size inspection, selective clearing with age filters.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { formatSize } from './attachment-downloader.mjs';
import { createStyler } from './ansi.mjs';

export const DEFAULT_CONFIG_DIR = path.join(os.homedir(), '.ticketlens');

// Age unit → days multiplier
const AGE_UNIT_DAYS = { d: 1, m: 30, y: 365 };

/**
 * Parses an age string like "7d", "2m", "1y" into milliseconds.
 * Returns null on invalid input.
 */
export function parseAge(str) {
  if (!str) return null;
  const match = str.match(/^(\d+)(d|m|y)$/);
  if (!match) return null;
  const [, n, unit] = match;
  return parseInt(n, 10) * AGE_UNIT_DAYS[unit] * 24 * 60 * 60 * 1000;
}

/**
 * Returns all cached file entries, optionally filtered by ticket key.
 * Each entry: { ticketKey, filename, localPath, size, mtimeMs }
 */
export function getCacheEntries(configDir = DEFAULT_CONFIG_DIR, ticketKey = null) {
  const cacheDir = path.join(configDir, 'cache');
  if (!fs.existsSync(cacheDir)) return [];

  const ticketDirs = ticketKey
    ? [ticketKey]
    : fs.readdirSync(cacheDir).filter(d => {
        try { return fs.statSync(path.join(cacheDir, d)).isDirectory(); } catch { return false; }
      });

  const entries = [];
  for (const ticket of ticketDirs) {
    const ticketDir = path.join(cacheDir, ticket);
    if (!fs.existsSync(ticketDir)) continue;

    let files;
    try { files = fs.readdirSync(ticketDir); } catch { continue; }

    for (const file of files) {
      const filePath = path.join(ticketDir, file);
      try {
        const stat = fs.statSync(filePath);
        if (stat.isFile()) {
          entries.push({ ticketKey: ticket, filename: file, localPath: filePath, size: stat.size, mtimeMs: stat.mtimeMs });
        }
      } catch { /* deleted between readdir and stat */ }
    }
  }

  return entries;
}

/**
 * Returns total cache size in bytes.
 */
export function getCacheSize(configDir = DEFAULT_CONFIG_DIR) {
  return getCacheEntries(configDir).reduce((sum, e) => sum + e.size, 0);
}

/**
 * Formats a file modification time as a human-readable age string.
 */
export function formatAge(mtimeMs) {
  const days = Math.floor((Date.now() - mtimeMs) / (24 * 60 * 60 * 1000));
  if (days === 0) return 'today';
  if (days === 1) return '1 day ago';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months === 1) return '1 month ago';
  if (months < 12) return `${months} months ago`;
  const years = Math.floor(days / 365);
  return `${years} year${years > 1 ? 's' : ''} ago`;
}

/**
 * Entry point for `ticketlens cache <subcommand> [args]`
 */
export async function run(args, opts = {}) {
  const {
    configDir = DEFAULT_CONFIG_DIR,
    stdin = process.stdin,
    stdout = process.stdout,
    stderr = process.stderr,
  } = opts;

  const s = createStyler({ isTTY: stdout.isTTY });
  const sub = args[0];

  if (!sub || sub === '--help' || sub === '-h') {
    printCacheHelp(stdout, s);
    return;
  }

  if (sub === 'size') {
    runSize(configDir, stdout, s);
    return;
  }

  if (sub === 'clear') {
    await runClear(args.slice(1), { configDir, stdin, stdout, stderr, s });
    return;
  }

  stderr.write(`Unknown cache subcommand: "${sub}". Try: ticketlens cache clear | ticketlens cache size\n`);
  process.exitCode = 1;
}

// ─── size ────────────────────────────────────────────────────────────────────

function runSize(configDir, stdout, s) {
  const entries = getCacheEntries(configDir);
  if (entries.length === 0) {
    stdout.write('Cache is empty.\n');
    return;
  }

  const totalSize = entries.reduce((sum, e) => sum + e.size, 0);

  // Group by ticket
  const byTicket = {};
  for (const e of entries) {
    if (!byTicket[e.ticketKey]) byTicket[e.ticketKey] = { files: 0, size: 0 };
    byTicket[e.ticketKey].files++;
    byTicket[e.ticketKey].size += e.size;
  }

  const lines = [`\n${s.bold('Cache')} — ${formatSize(totalSize)} across ${entries.length} file(s)\n`];
  for (const [ticket, info] of Object.entries(byTicket).sort()) {
    lines.push(`  ${s.cyan(ticket)}  ${info.files} file(s), ${formatSize(info.size)}`);
  }

  stdout.write(lines.join('\n') + '\n\n');
}

// ─── clear ───────────────────────────────────────────────────────────────────

async function runClear(args, { configDir, stdin, stdout, stderr, s }) {
  const ticketKey = args.find(a => !a.startsWith('--'));
  const olderThanArg = args.find(a => a.startsWith('--older-than='));
  const forceYes = args.includes('--yes') || args.includes('-y');

  let olderThanMs = null;
  if (olderThanArg) {
    olderThanMs = parseAge(olderThanArg.split('=')[1]);
    if (olderThanMs === null) {
      stderr.write(`Invalid --older-than value: "${olderThanArg.split('=')[1]}"\nUse: 7d (days), 2m (months), 1y (years)\n`);
      process.exitCode = 1;
      return;
    }
  }

  let entries = getCacheEntries(configDir, ticketKey ?? null);

  if (olderThanMs !== null) {
    const cutoff = Date.now() - olderThanMs;
    entries = entries.filter(e => e.mtimeMs < cutoff);
  }

  if (entries.length === 0) {
    const scope = ticketKey ? `for ${ticketKey}` : 'in cache';
    const ageNote = olderThanArg ? ` older than ${olderThanArg.split('=')[1]}` : '';
    stdout.write(`No cached files${ageNote} found ${scope}.\n`);
    return;
  }

  // Group by ticket for display
  const byTicket = {};
  for (const e of entries) {
    if (!byTicket[e.ticketKey]) byTicket[e.ticketKey] = [];
    byTicket[e.ticketKey].push(e);
  }

  const totalSize = entries.reduce((sum, e) => sum + e.size, 0);
  stdout.write(`\n${s.bold('Files to delete:')} ${entries.length} file(s), ${formatSize(totalSize)}\n\n`);

  for (const [ticket, files] of Object.entries(byTicket).sort()) {
    stdout.write(`  ${s.cyan(ticket)}\n`);
    for (const f of files) {
      stdout.write(`    ${f.filename}  ${s.dim(formatSize(f.size) + ', ' + formatAge(f.mtimeMs))}\n`);
    }
  }
  stdout.write('\n');

  if (!forceYes) {
    const confirmed = await confirm('Delete these files?', stdin, stdout, s);
    if (!confirmed) {
      stdout.write('Cancelled.\n');
      return;
    }
  }

  let deleted = 0;
  let deletedSize = 0;
  for (const e of entries) {
    try {
      fs.unlinkSync(e.localPath);
      deleted++;
      deletedSize += e.size;
      // Clean up empty ticket dirs
      const dir = path.dirname(e.localPath);
      try {
        if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
      } catch { /* dir not empty or already gone */ }
    } catch { /* already deleted */ }
  }

  stdout.write(`Deleted ${deleted} file(s), freed ${formatSize(deletedSize)}.\n`);
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function confirm(question, stdin, stdout, s) {
  return new Promise(resolve => {
    stdout.write(`${question} ${s.dim('y/N')}  `);

    if (!stdin.isTTY) {
      stdout.write('\n');
      resolve(false);
      return;
    }

    stdin.setRawMode(true);
    stdin.resume();
    stdin.once('data', buf => {
      stdin.setRawMode(false);
      stdin.pause();
      const ch = buf.toString().toLowerCase();
      stdout.write(ch === 'y' ? 'y\n' : 'N\n');
      resolve(ch === 'y');
    });
  });
}

function printCacheHelp(stream, s) {
  stream.write([
    '',
    `  ${s.bold(s.cyan('ticketlens'))} ${s.bold('cache')} ${s.dim('<subcommand>')}`,
    '',
    `  Manage locally cached Jira ticket attachments.`,
    '',
    `  ${s.bold('SUBCOMMANDS')}`,
    '',
    `    ${s.cyan('cache size')}                        Show cache disk usage`,
    `    ${s.cyan('cache clear')}                       Clear all cached files`,
    `    ${s.cyan('cache clear')} ${s.dim('PROJ-123')}             Clear one ticket's cache`,
    `    ${s.cyan('cache clear')} ${s.dim('--older-than=7d')}      Clear files older than 7 days`,
    `    ${s.cyan('cache clear')} ${s.dim('--older-than=1m')}      Clear files older than 1 month`,
    `    ${s.cyan('cache clear')} ${s.dim('--older-than=1y')}      Clear files older than 1 year`,
    `    ${s.cyan('cache clear')} ${s.dim('PROJ-123 --older-than=7d')}  Combine ticket + age filter`,
    '',
    `  ${s.bold('FLAGS')}`,
    '',
    `    ${s.cyan('--older-than')}=${s.dim('Nd|Nm|Ny')}   Age threshold (d=days, m=months, y=years)`,
    `    ${s.cyan('--yes')}, ${s.cyan('-y')}             Skip confirmation prompt`,
    '',
    `  ${s.bold('EXAMPLES')}`,
    '',
    `    ${s.dim('$')} ticketlens cache size`,
    `    ${s.dim('$')} ticketlens cache clear --older-than=30d`,
    `    ${s.dim('$')} ticketlens cache clear PROJ-123`,
    `    ${s.dim('$')} ticketlens cache clear --older-than=1m --yes`,
    '',
  ].join('\n') + '\n');
}
