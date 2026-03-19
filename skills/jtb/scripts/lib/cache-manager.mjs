/**
 * Cache management for downloaded Jira attachments.
 * Supports: size inspection, selective clearing with age/profile filters.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { formatSize } from './attachment-downloader.mjs';
import { createStyler } from './ansi.mjs';
import { loadProfiles } from './profile-resolver.mjs';
import { promptSelect } from './select-prompt.mjs';
import { getBriefCacheEntries, clearBriefCache, briefCacheAge } from './brief-cache.mjs';

export const DEFAULT_CONFIG_DIR = path.join(os.homedir(), '.ticketlens');

// Age unit → days multiplier
const AGE_UNIT_DAYS = { d: 1, m: 30, y: 365 };

// Sentinel returned by showProfilePicker when the user presses Esc
const CANCELLED = Symbol('CANCELLED');

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
 * Groups cache entries by profile (inferred from ticket-key prefix → ticketPrefixes map).
 * Returns sorted array: configured profiles alphabetically, unconfigured last.
 * Each element: { name: string|null, entries, size, prefixes: string[] }
 */
function groupEntriesByProfile(entries, config) {
  const prefixToProfile = {};
  for (const [name, p] of Object.entries(config?.profiles ?? {})) {
    for (const prefix of (p.ticketPrefixes ?? [])) {
      prefixToProfile[prefix] = name;
    }
  }

  const groupMap = {};
  for (const e of entries) {
    const prefix = e.ticketKey.split('-')[0];
    const name = prefixToProfile[prefix] ?? null;
    const key = name ?? '\x00'; // sort unconfigured last
    if (!groupMap[key]) groupMap[key] = { name, entries: [], size: 0, prefixes: [] };
    groupMap[key].entries.push(e);
    groupMap[key].size += e.size;
    if (!groupMap[key].prefixes.includes(prefix)) groupMap[key].prefixes.push(prefix);
  }

  return Object.values(groupMap).sort((a, b) => {
    if (a.name === null) return 1;
    if (b.name === null) return -1;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Filters entries to only those belonging to the given profile (by ticketPrefixes).
 * Returns all entries if the profile has no ticketPrefixes configured.
 */
function filterEntriesByProfile(entries, profileName, config) {
  const prefixes = config?.profiles?.[profileName]?.ticketPrefixes ?? [];
  if (prefixes.length === 0) return entries;
  return entries.filter(e => prefixes.includes(e.ticketKey.split('-')[0]));
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
    const sizeArgs = args.slice(1);
    if (sizeArgs.includes('--help') || sizeArgs.includes('-h')) {
      printCacheSizeHelp(stdout, s);
      return;
    }
    const sizeProfileArg = sizeArgs.find(a => a.startsWith('--profile='));
    const sizeProfileName = sizeProfileArg ? sizeProfileArg.split('=')[1] : null;
    runSize(configDir, stdout, s, sizeProfileName);
    return;
  }

  if (sub === 'clear') {
    const clearArgs = args.slice(1);
    if (clearArgs.includes('--help') || clearArgs.includes('-h')) {
      printCacheClearHelp(stdout, s);
      return;
    }
    await runClear(clearArgs, { configDir, stdin, stdout, stderr, s });
    return;
  }

  stderr.write(`Unknown cache subcommand: "${sub}". Try: ticketlens cache clear | ticketlens cache size\n`);
  process.exitCode = 1;
}

// ─── size ────────────────────────────────────────────────────────────────────

function runSize(configDir, stdout, s, profileName = null) {
  let entries = getCacheEntries(configDir);
  const config = loadProfiles(configDir);

  if (profileName) {
    entries = filterEntriesByProfile(entries, profileName, config);
  }

  let briefEntries = getBriefCacheEntries(configDir);
  if (profileName) briefEntries = briefEntries.filter(e => e.profileName === profileName);

  if (entries.length === 0 && briefEntries.length === 0) {
    const hint = profileName ? `profile "${profileName}"` : 'any profile';
    stdout.write(`No cached files found for ${hint}.\n${s.dim('Run ticketlens TICKET-KEY to fetch a ticket.')}\n`);
    return;
  }

  const lines = [];

  if (entries.length > 0) {
    const totalSize = entries.reduce((sum, e) => sum + e.size, 0);
    const groups = groupEntriesByProfile(entries, config);
    const ticketCount = new Set(entries.map(e => e.ticketKey)).size;

    const profileScope = profileName ? `  ${s.dim(`(profile: ${profileName})`)}` : '';
    lines.push(`\n${s.bold('Attachment Cache')}${profileScope} — ${formatSize(totalSize)}, ${plural(entries.length, 'file')} across ${plural(ticketCount, 'ticket')}\n`);

    for (const group of groups) {
      const profileLabel = group.name ? s.bold(s.cyan(group.name)) : s.dim('(unconfigured)');
      const prefixList = group.prefixes.sort().join(s.dim(' · '));
      const summary = `${formatSize(group.size)}, ${plural(group.entries.length, 'file')}`;
      lines.push(`\n  ${profileLabel}  ${s.dim(prefixList)}  —  ${summary}`);

      const byTicket = {};
      for (const e of group.entries) {
        if (!byTicket[e.ticketKey]) byTicket[e.ticketKey] = { files: 0, size: 0 };
        byTicket[e.ticketKey].files++;
        byTicket[e.ticketKey].size += e.size;
      }
      for (const [ticket, info] of Object.entries(byTicket).sort()) {
        lines.push(`    ${s.cyan(ticket)}  ${plural(info.files, 'file')}, ${formatSize(info.size)}`);
      }
    }
  }

  if (briefEntries.length > 0) {
    const briefSize = briefEntries.reduce((sum, e) => sum + e.size, 0);
    lines.push(`\n${s.bold('Brief Cache')} — ${formatSize(briefSize)}, ${plural(briefEntries.length, 'brief')} cached\n`);
    const byProfile = {};
    for (const e of briefEntries) {
      if (!byProfile[e.profileName]) byProfile[e.profileName] = [];
      byProfile[e.profileName].push(e);
    }
    for (const [pName, pEntries] of Object.entries(byProfile).sort()) {
      lines.push(`  ${s.bold(s.cyan(pName))}`);
      for (const e of pEntries.sort((a, b) => a.ticketKey.localeCompare(b.ticketKey))) {
        const age = e.fetchedAt ? briefCacheAge(e.fetchedAt) : 'unknown';
        const depthLabel = e.depth != null ? `depth ${e.depth}` : '';
        lines.push(`    ${s.cyan(e.ticketKey)}  ${s.dim(age)}${depthLabel ? s.dim(`  ·  ${depthLabel}`) : ''}`);
      }
    }
  }

  lines.push(`\n${s.dim(`Cache location: ${path.join(configDir, 'cache')}`)}`);
  stdout.write(lines.join('\n') + '\n\n');
}

// ─── clear ───────────────────────────────────────────────────────────────────

async function runClear(args, { configDir, stdin, stdout, stderr, s }) {
  const ticketKey = args.find(a => !a.startsWith('--'));
  const olderThanArg = args.find(a => a.startsWith('--older-than='));
  const profileArg = args.find(a => a.startsWith('--profile='));
  const forceYes = args.includes('--yes') || args.includes('-y');

  let olderThanMs = null;
  if (olderThanArg) {
    const ageStr = olderThanArg.split('=')[1];
    olderThanMs = parseAge(ageStr);
    if (olderThanMs === null) {
      stderr.write(`Invalid --older-than value: "${ageStr}" — expected a number followed by d (days), m (months), or y (years).\nExamples: --older-than=7d  --older-than=2m  --older-than=1y\n`);
      process.exitCode = 1;
      return;
    }
  }

  let entries = getCacheEntries(configDir, ticketKey ?? null);
  const config = loadProfiles(configDir);

  // Determine profile filter:
  // 1. --profile=NAME flag → filter by that profile (no picker)
  // 2. No ticket / no profile flag / not --yes / TTY → show interactive picker
  // 3. Otherwise → clear all (existing behaviour)
  let filterProfileName = profileArg ? profileArg.split('=')[1] : null;
  let pickerFiltered = false;

  if (!ticketKey && !filterProfileName && !forceYes && stdout.isTTY && process.stdin.setRawMode) {
    const groups = groupEntriesByProfile(entries, config);
    if (groups.length > 1) {
      const picked = await showProfilePicker(entries, groups, stdout, s);
      if (picked === CANCELLED) {
        stdout.write(`\n${s.dim('✖')} ${s.dim('Aborted — no files were deleted.')}\n\n`);
        return;
      }
      // Use the picker's pre-grouped entries directly — avoids filterEntriesByProfile
      // falling back to "all entries" when a profile has no ticketPrefixes configured.
      if (picked.entries !== null) {
        entries = picked.entries;
        pickerFiltered = true;
      }
      filterProfileName = picked.profileName;
    }
  }

  if (filterProfileName && !pickerFiltered) {
    entries = filterEntriesByProfile(entries, filterProfileName, config);
  }

  if (olderThanMs !== null) {
    const cutoff = Date.now() - olderThanMs;
    entries = entries.filter(e => e.mtimeMs < cutoff);
  }

  if (entries.length === 0) {
    const scopeParts = [];
    if (filterProfileName) scopeParts.push(`for profile ${s.cyan(filterProfileName)}`);
    else if (ticketKey) scopeParts.push(`for ${s.cyan(ticketKey)}`);
    else scopeParts.push('in the attachment cache');
    const ageNote = olderThanArg ? ` older than ${expandAge(olderThanArg.split('=')[1])}` : '';
    stdout.write(`No cached files${ageNote} found ${scopeParts.join(' ')}.\n`);
    return;
  }

  // Group by ticket for display
  const byTicket = {};
  for (const e of entries) {
    if (!byTicket[e.ticketKey]) byTicket[e.ticketKey] = [];
    byTicket[e.ticketKey].push(e);
  }

  const totalSize = entries.reduce((sum, e) => sum + e.size, 0);
  const scopeLabel = filterProfileName ? s.dim(` (${filterProfileName})`) : '';
  stdout.write(`\n${s.bold('Files to delete')}${scopeLabel}${s.bold(':')} ${plural(entries.length, 'file')} across ${plural(Object.keys(byTicket).length, 'ticket')}, ${formatSize(totalSize)} total\n\n`);

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
      stdout.write('Aborted — no files were deleted.\n');
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

  // Also remove brief cache for any affected tickets
  const affectedTickets = [...new Set(entries.map(e => e.ticketKey))];
  for (const key of affectedTickets) {
    // Clear brief cache for all profiles that own this ticket key
    const prefix = key.split('-')[0];
    for (const [pName, p] of Object.entries(config?.profiles ?? {})) {
      if (!p.ticketPrefixes || p.ticketPrefixes.includes(prefix)) {
        clearBriefCache(key, pName, configDir);
      }
    }
    // Also clear the _default profile slot
    clearBriefCache(key, '_default', configDir);
  }

  stdout.write(`${s.bold('✓')} Deleted ${plural(deleted, 'file')}, freed ${formatSize(deletedSize)}.\n`);
}

// ─── profile picker ───────────────────────────────────────────────────────────

/**
 * Interactive profile picker for `cache clear`.
 * Shows "All profiles" plus each profile that has cached files.
 * Returns: null (All), profileName string, or CANCELLED symbol.
 */
async function showProfilePicker(entries, groups, stdout, s) {
  const totalSize = entries.reduce((sum, e) => sum + e.size, 0);

  stdout.write(`\n  ${s.dim('Which profile cache should be cleared?')}\n\n`);

  const items = [
    {
      label: 'All profiles',
      sublabel: `${formatSize(totalSize)}, ${plural(entries.length, 'file')} — clear everything`,
    },
    ...groups.map(g => ({
      label: g.name ?? '(unconfigured)',
      sublabel: `${formatSize(g.size)}, ${plural(g.entries.length, 'file')}  ${g.prefixes.sort().join(' · ')}`,
    })),
  ];

  const selectedIndex = await promptSelect(items, { stream: stdout });
  if (selectedIndex === null) return CANCELLED;
  if (selectedIndex === 0) return { entries: null, profileName: null }; // All profiles
  const group = groups[selectedIndex - 1];
  return { entries: group.entries, profileName: group.name };
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function expandAge(str) {
  const match = str?.match(/^(\d+)(d|m|y)$/);
  if (!match) return str;
  const [, n, unit] = match;
  const num = parseInt(n, 10);
  const labels = { d: 'day', m: 'month', y: 'year' };
  return `${num} ${labels[unit]}${num === 1 ? '' : 's'}`;
}

function confirm(question, stdin, stdout, s) {
  return new Promise(resolve => {
    stdout.write(`${question} ${s.dim('y/N')}  `);

    if (!stdin.isTTY) {
      stdout.write(s.dim('(non-interactive — skipping)\n'));
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

function printCacheSizeHelp(stream, s) {
  stream.write([
    '',
    `  ${s.bold(s.cyan('ticketlens'))} ${s.bold('cache size')} ${s.dim('[--profile=NAME]')}`,
    '',
    `  Show disk usage of locally cached Jira attachments, grouped by profile.`,
    '',
    `  ${s.bold('OPTIONS')}`,
    '',
    `    ${s.cyan('--profile')}=${s.dim('NAME')}   Filter output to a single profile`,
    '',
    `  ${s.bold('EXAMPLES')}`,
    '',
    `    ${s.dim('$')} ticketlens cache size`,
    `    ${s.dim('$')} ticketlens cache size --profile=work`,
    '',
  ].join('\n') + '\n');
}

function printCacheClearHelp(stream, s) {
  stream.write([
    '',
    `  ${s.bold(s.cyan('ticketlens'))} ${s.bold('cache clear')} ${s.dim('[TICKET] [options]')}`,
    '',
    `  Remove locally cached Jira attachment files.`,
    `  In TTY mode, shows an interactive profile picker when no filters are given.`,
    '',
    `  ${s.bold('OPTIONS')}`,
    '',
    `    ${s.cyan('--profile')}=${s.dim('NAME')}        Filter to one profile's tickets`,
    `    ${s.cyan('--older-than')}=${s.dim('Nd|Nm|Ny')}  Delete files older than N days / months / years`,
    `    ${s.cyan('--yes')}, ${s.cyan('-y')}             Skip confirmation prompt`,
    `    ${s.cyan('-h')}, ${s.cyan('--help')}            Show this help`,
    '',
    `  ${s.bold('EXAMPLES')}`,
    '',
    `    ${s.dim('$')} ticketlens cache clear`,
    `    ${s.dim('$')} ticketlens cache clear --profile=work`,
    `    ${s.dim('$')} ticketlens cache clear PROJ-123`,
    `    ${s.dim('$')} ticketlens cache clear --older-than=7d`,
    `    ${s.dim('$')} ticketlens cache clear --older-than=1m --yes`,
    '',
  ].join('\n') + '\n');
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
    `    ${s.cyan('cache size')}   Show disk usage, grouped by profile`,
    `    ${s.cyan('cache clear')}  Remove cached files (interactive picker in TTY)`,
    '',
    `  Run ${s.cyan('ticketlens cache size --help')} or ${s.cyan('ticketlens cache clear --help')} for details.`,
    '',
  ].join('\n') + '\n');
}
