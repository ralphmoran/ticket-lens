/**
 * Saves, lists, and indexes Recall note files on disk at
 * ~/.ticketlens/recall/<PREFIX>/. Does not decide what counts as a secret
 * (secret-scanner.mjs) or what's relevant to a ticket (recall-matcher.mjs) —
 * this file only knows how to read and write notes safely.
 *
 * A note's folder always comes from a ticket key checked against
 * TICKET_KEY_PATTERN — never from the note's title or tags. The file name
 * itself is always a generated timestamp, never derived from user text.
 * This is what keeps a note's title or tags from ever being able to write
 * outside the recall folder.
 */

import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { DEFAULT_CONFIG_DIR } from './config.mjs';
import { TICKET_KEY_PATTERN } from './cli.mjs';
import { parseFrontmatter, serializeFrontmatter } from './frontmatter.mjs';

const GENERAL_BUCKET = '_general';
const DEFAULT_LIMIT = 150;

/**
 * Turns a ticket key into the folder name its note belongs in.
 * Throws on anything that isn't a real ticket key — this is the one place
 * that decides what's allowed to become part of a file path.
 *
 * @param {string} [ticketKey]
 * @returns {string}
 */
export function resolvePrefix(ticketKey) {
  if (!ticketKey) return GENERAL_BUCKET;
  if (!TICKET_KEY_PATTERN.test(ticketKey)) {
    throw new Error(`Invalid ticket key: "${ticketKey}"`);
  }
  return ticketKey.split('-')[0];
}

function vaultDir(configDir) {
  return path.join(configDir, 'recall');
}

function prefixDir(configDir, prefix) {
  return path.join(vaultDir(configDir), prefix);
}

function generateNoteId() {
  return `${Date.now()}-${randomBytes(3).toString('hex')}.md`;
}

function writeFileAtomically(filePath, contents) {
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, contents, 'utf8');
  fs.renameSync(tmpPath, filePath);
}

/**
 * @param {{ title: string, ticketKeys?: string[], tags?: string[], author: string, sources?: string[], body: string }} note
 * @param {{ configDir?: string, now?: () => Date }} [opts]
 * @returns {{ id: string, path: string }}
 */
export function writeDigest({ title, ticketKeys = [], tags = [], author, sources = [], body }, { configDir = DEFAULT_CONFIG_DIR, now = () => new Date() } = {}) {
  const prefix = resolvePrefix(ticketKeys[0]);
  const dir = prefixDir(configDir, prefix);
  fs.mkdirSync(dir, { recursive: true });

  const id = generateNoteId();
  const notePath = path.join(dir, id);

  const data = {
    title,
    aliases: [title],
    tickets: ticketKeys,
    tags,
    author,
    created: now().toISOString(),
    status: 'unverified',
    sources,
  };

  writeFileAtomically(notePath, serializeFrontmatter(data, body));
  return { id, path: notePath };
}

/**
 * Reads one note file. Never trusts the file completely — a note can be
 * hand-edited (README documents them as plain markdown, readable in any
 * editor), so malformed or missing fields fall back to safe defaults instead
 * of producing an object that crashes downstream code expecting a real note.
 *
 * @returns {object|null} null if the file can't be read at all
 */
function readDigest(filePath) {
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
  const { data, body } = parseFrontmatter(text);
  // A title is one line. A hand-edited file can reintroduce a real newline
  // (frontmatter.mjs un-escapes "\n" back to one) — collapse it here, the one
  // place every consumer (search display, index rebuild, brief injection) reads
  // a note through, so nothing downstream has to remember to guard against it.
  const title = (data.title ?? '(untitled note)').replace(/[\r\n]+/g, ' ');
  return {
    id: path.basename(filePath),
    path: filePath,
    title,
    aliases: data.aliases ?? [],
    tickets: data.tickets ?? [],
    tags: data.tags ?? [],
    author: data.author ?? null,
    created: data.created ?? new Date(0).toISOString(),
    status: data.status ?? 'unverified',
    sources: data.sources ?? [],
    body,
  };
}

function matchesTicketKey(digest, ticketKey) {
  return digest.tickets.length === 0 || digest.tickets.includes(ticketKey);
}

function matchesQuery(digest, query) {
  const haystack = `${digest.title}\n${digest.body}`.toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function noteFilesIn(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter(e => e.isFile() && e.name.endsWith('.md') && e.name !== 'index.md')
    .map(e => {
      const filePath = path.join(dir, e.name);
      return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
    });
}

function allPrefixDirs(configDir) {
  let entries;
  try {
    entries = fs.readdirSync(vaultDir(configDir), { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.filter(e => e.isDirectory()).map(e => e.name);
}

/**
 * @param {{ prefix?: string, ticketKey?: string, query?: string, limit?: number }} [filter]
 * @param {{ configDir?: string }} [opts]
 * @returns {object[]}
 */
export function listDigests({ prefix, ticketKey, query, limit = DEFAULT_LIMIT } = {}, { configDir = DEFAULT_CONFIG_DIR } = {}) {
  const targetPrefix = prefix ?? (ticketKey ? resolvePrefix(ticketKey) : null);

  let noteFiles;
  if (targetPrefix) {
    ensureIndexFresh(targetPrefix, { configDir });
    noteFiles = noteFilesIn(prefixDir(configDir, targetPrefix));
  } else {
    // No prefix or ticket key given — search every project folder.
    const prefixes = allPrefixDirs(configDir);
    for (const p of prefixes) ensureIndexFresh(p, { configDir });
    noteFiles = prefixes.flatMap(p => noteFilesIn(prefixDir(configDir, p)));
  }

  noteFiles = noteFiles.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, limit);

  let digests = noteFiles.map(f => readDigest(f.filePath)).filter(Boolean);

  if (ticketKey) digests = digests.filter(d => matchesTicketKey(d, ticketKey));
  if (query) digests = digests.filter(d => matchesQuery(d, query));

  return digests;
}

/**
 * Rebuilds the Obsidian-facing index.md for a prefix folder from what's
 * actually on disk. index.md is a summary for humans/Obsidian — never a
 * source of truth the code trusts.
 *
 * @param {string} prefix
 * @param {{ configDir?: string }} [opts]
 */
export function rebuildIndex(prefix, { configDir = DEFAULT_CONFIG_DIR } = {}) {
  const dir = prefixDir(configDir, prefix);
  const indexPath = path.join(dir, 'index.md');

  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  const digests = entries
    .filter(e => e.isFile() && e.name.endsWith('.md') && e.name !== 'index.md')
    .map(e => readDigest(path.join(dir, e.name)))
    .filter(Boolean)
    .sort((a, b) => new Date(b.created) - new Date(a.created));

  const lines = [`# Recall — ${prefix}`, ''];
  for (const d of digests) {
    const ticketList = d.tickets.length > 0 ? ` — ${d.tickets.join(', ')}` : '';
    lines.push(`- [[${d.title}]]${ticketList} — ${d.created.split('T')[0]}`);
  }

  writeFileAtomically(indexPath, lines.join('\n') + '\n');
}

function newestNoteMtime(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  const noteFiles = entries.filter(e => e.isFile() && e.name.endsWith('.md') && e.name !== 'index.md');
  if (noteFiles.length === 0) return null;
  return Math.max(...noteFiles.map(e => fs.statSync(path.join(dir, e.name)).mtimeMs));
}

function ensureIndexFresh(prefix, { configDir = DEFAULT_CONFIG_DIR } = {}) {
  const dir = prefixDir(configDir, prefix);
  const indexPath = path.join(dir, 'index.md');

  const newestNote = newestNoteMtime(dir);
  if (newestNote === null) return; // nothing to index yet

  let indexStat;
  try {
    indexStat = fs.statSync(indexPath);
  } catch {
    rebuildIndex(prefix, { configDir });
    return;
  }

  if (newestNote > indexStat.mtimeMs) {
    rebuildIndex(prefix, { configDir });
  }
}
