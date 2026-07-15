/**
 * Implements `tl note add`. Order matters: the license check runs before
 * stdin is read or anything is written, so an unlicensed user never has
 * their input touched at all.
 */

import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_CONFIG_DIR } from './config.mjs';
import { isLicensed, showUpgradePrompt } from './license.mjs';
import { scanForSecrets } from './secret-scanner.mjs';
import { writeDigest } from './recall-vault.mjs';
import { incrementDraftKept, incrementDraftDeleted } from './activity-counter.mjs';
import { extractText } from './attachment-text.mjs';
import { TICKET_KEY_PATTERN } from './cli.mjs';
import { createStyler } from './ansi.mjs';

function defaultListAttachments(configDir, ticketKey) {
  const cacheDir = path.join(configDir, 'cache', ticketKey);
  try {
    return fs.readdirSync(cacheDir).map(name => path.join(cacheDir, name));
  } catch {
    return [];
  }
}

/**
 * Pulls plain text out of already-cached ticket attachments, for
 * `note add --include-attachments`. Silently skips any file extractText
 * can't read (images, PDFs, unsupported formats) — this is an optional
 * assist, never a requirement.
 */
function gatherAttachmentExcerpts(configDir, ticketKey, listAttachmentsFn, extractTextFn) {
  const files = listAttachmentsFn(configDir, ticketKey);
  const excerpts = files
    .map(filePath => ({ name: path.basename(filePath), text: extractTextFn(filePath) }))
    .filter(f => f.text);
  if (excerpts.length === 0) return '';
  const blocks = excerpts.map(f => `=== ${f.name} ===\n${f.text}`);
  return `\n\n--- Attachment excerpts ---\n\n${blocks.join('\n\n')}`;
}

function defaultReadStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { data += chunk; });
    process.stdin.on('end', () => resolve(data.trim()));
    process.stdin.on('error', reject);
  });
}

function parseFlag(cmdArgs, name) {
  return cmdArgs.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
}

/**
 * @param {string[]} cmdArgs
 * @returns {Promise<{ written: boolean }>}
 */
export async function runNoteAdd(cmdArgs, {
  configDir = DEFAULT_CONFIG_DIR,
  stream = process.stderr,
  readStdin = defaultReadStdin,
  isLicensedFn = isLicensed,
  scanForSecretsFn = scanForSecrets,
  writeDigestFn = writeDigest,
  incrementDraftKeptFn = incrementDraftKept,
  incrementDraftDeletedFn = incrementDraftDeleted,
  listAttachmentsFn = defaultListAttachments,
  extractTextFn = extractText,
  author = os.userInfo().username,
} = {}) {
  if (!isLicensedFn('pro', configDir)) {
    showUpgradePrompt('pro', 'ticketlens note', { stream });
    return { written: false };
  }

  const rawTitle = parseFlag(cmdArgs, 'title');
  if (!rawTitle) {
    stream.write('Usage: ticketlens note add --title="..." [--ticket=KEY] [--tags=a,b]\n');
    return { written: false };
  }
  // A title is one line: collapse any embedded newline so it can never be used
  // to forge a fake "## heading" line when the note is later injected into a brief.
  const title = rawTitle.replace(/[\r\n]+/g, ' ');

  const ticketKey = parseFlag(cmdArgs, 'ticket');
  if (ticketKey && !TICKET_KEY_PATTERN.test(ticketKey)) {
    stream.write(`  Invalid --ticket value "${ticketKey}" — expected a ticket key like PROJ-123.\n`);
    return { written: false };
  }
  const tagsArg = parseFlag(cmdArgs, 'tags');
  const tags = tagsArg ? tagsArg.split(',').map(t => t.trim()).filter(Boolean) : [];

  let body = await readStdin();
  if (cmdArgs.includes('--include-attachments') && ticketKey) {
    body += gatherAttachmentExcerpts(configDir, ticketKey, listAttachmentsFn, extractTextFn);
  }

  const scan = scanForSecretsFn({ title, tags, body });
  if (scan.rejected) {
    stream.write(`  Note not saved — ${scan.reasons.join(' ')}\n`);
    incrementDraftDeletedFn(configDir);
    return { written: false };
  }
  for (const warning of scan.warnings) {
    stream.write(`  Warning: ${warning}\n`);
  }

  const { id } = writeDigestFn(
    { title, ticketKeys: ticketKey ? [ticketKey] : [], tags, author, body },
    { configDir },
  );
  incrementDraftKeptFn(configDir);
  const styled = !cmdArgs.includes('--plain') && stream.isTTY;
  const s = createStyler({ forceColor: styled, noColor: !styled });
  stream.write(styled ? `\n  ${s.green('✔')} Saved note "${title}" (${id})\n\n` : `  Saved note "${title}" (${id})\n`);
  return { written: true };
}
