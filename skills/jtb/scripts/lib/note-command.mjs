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
import { checkNoteStructure, checkWordCount, WORD_LIMITS } from './note-structural-check.mjs';
import { writeNote, patchNoteBody, deleteNote, deleteNoteAnyPrefix, rebuildIndex } from './recall-vault.mjs';
import { readCliToken } from './cli-auth.mjs';
import { resolveProfile, loadProfileRecallTeamId, resolveEffectiveRecallStrictness } from './profile-resolver.mjs';
import { pushNote } from './recall-sync.mjs';
import { enqueueNote, isRetryableFailure, maybeAutoFlush } from './recall-queue.mjs';
import { incrementDraftKept, incrementDraftDeleted } from './activity-counter.mjs';
import { extractText } from './attachment-text.mjs';
import { readAttachments, MAX_ATTACHMENTS } from './attachment-uploader.mjs';
import { TICKET_KEY_PATTERN } from './cli.mjs';
import { createStyler } from './ansi.mjs';
import { confirmDestructive } from './confirm.mjs';

const ATTACHMENT_ERROR_MESSAGES = {
  'not-found': 'file not found',
  'not-a-file': 'not a file',
  'empty': 'file is empty',
  'too-large': 'exceeds 10 MB limit',
  'total-size-exceeded': 'exceeds the 50 MB total limit for this note',
};

function parseAttachPaths(cmdArgs) {
  const raw = parseFlag(cmdArgs, 'attach');
  return raw ? raw.split(',').map(p => p.trim()).filter(Boolean) : [];
}

/**
 * Splits a readAttachments() batch into what's usable for writeNote (plain
 * {filename, buffer} pairs — the vault doesn't care about size/mimeType)
 * and human-readable warning lines for anything that failed, same
 * best-effort philosophy as ticket_create/comment's --attach: one bad path
 * never blocks the note from being saved.
 */
function summarizeAttachments({ files, droppedCount }) {
  const saved = [];
  const warnings = [];
  for (const f of files) {
    if (f.ok) saved.push({ filename: f.filename, buffer: f.buffer });
    else warnings.push(`  Skipped attachment ${f.path}: ${ATTACHMENT_ERROR_MESSAGES[f.error] ?? f.error}\n`);
  }
  if (droppedCount > 0) warnings.push(`  ${droppedCount} attachment(s) dropped — exceeds the ${MAX_ATTACHMENTS}-file limit per call.\n`);
  return { saved, warnings };
}

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
  checkNoteStructureFn = checkNoteStructure,
  checkWordCountFn = checkWordCount,
  scanForSecretsFn = scanForSecrets,
  writeNoteFn = writeNote,
  readCliTokenFn = readCliToken,
  resolveProfileFn = resolveProfile,
  resolveEffectiveRecallStrictnessFn = resolveEffectiveRecallStrictness,
  loadProfileRecallTeamIdFn = loadProfileRecallTeamId,
  pushNoteFn = pushNote,
  enqueueNoteFn = enqueueNote,
  isRetryableFailureFn = isRetryableFailure,
  maybeAutoFlushFn = maybeAutoFlush,
  incrementDraftKeptFn = incrementDraftKept,
  incrementDraftDeletedFn = incrementDraftDeleted,
  listAttachmentsFn = defaultListAttachments,
  extractTextFn = extractText,
  readAttachmentsFn = readAttachments,
  author = os.userInfo().username,
} = {}) {
  if (!isLicensedFn('pro', configDir)) {
    showUpgradePrompt('pro', 'ticketlens note', { stream });
    return { written: false };
  }

  const rawTitle = parseFlag(cmdArgs, 'title');
  if (!rawTitle) {
    stream.write('Usage: ticketlens note add --title="..." [--ticket=KEY] [--tags=a,b] [--attach=path1,path2]\n');
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

  const structural = checkNoteStructureFn({ body });
  if (structural.rejected) {
    stream.write(`  Note not saved — ${structural.reason}\n`);
    incrementDraftDeletedFn(configDir);
    return { written: false };
  }

  // Resolved once here (not just inside the push block below) so the
  // word-count warning below can read this profile's effective recallStrictness
  // regardless of whether a CLI token is configured for pushing. cliToken is
  // read here too (not just in the push block) since resolveEffectiveRecallStrictness
  // needs it to validate a team-default cache entry belongs to this account.
  const profile = resolveProfileFn(ticketKey || null, { configDir, cwd: process.cwd() });
  const cliToken = readCliTokenFn(configDir);
  const strictness = resolveEffectiveRecallStrictnessFn({ profile, configDir, cliToken });
  const wordCount = checkWordCountFn({ title, body }, { maxWords: WORD_LIMITS[strictness] });
  for (const warning of wordCount.warnings) {
    stream.write(`  Warning: ${warning}\n`);
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

  const attachPaths = parseAttachPaths(cmdArgs);
  const { saved: attachments, warnings: attachWarnings } = attachPaths.length > 0
    ? summarizeAttachments(readAttachmentsFn(attachPaths))
    : { saved: [], warnings: [] };
  for (const warning of attachWarnings) stream.write(warning);

  const ticketKeys = ticketKey ? [ticketKey] : [];
  // Captured once and threaded into writeNoteFn's now() override so the local
  // vault file's `created` and the pushed payload's captured_at can never skew
  // by the (short but real) gap between the local write and the push below.
  const capturedAt = new Date();
  const { id } = writeNoteFn({ title, ticketKeys, tags, author, body, attachments }, { configDir, now: () => capturedAt });
  incrementDraftKeptFn(configDir);
  const styled = !cmdArgs.includes('--plain') && stream.isTTY;
  const s = createStyler({ forceColor: styled, noColor: !styled });
  const attachSuffix = attachments.length > 0 ? ` + ${attachments.length} attachment(s)` : '';
  const savedLine = `Saved note "${title}" (${id})${attachSuffix}`;
  stream.write(styled ? `\n  ${s.green('✔')} ${savedLine}\n\n` : `  ${savedLine}\n`);

  if (cliToken) {
    const warn = (s) => stream.write(s);
    // Field names match PushRequest's validation rules (external_id, tickets) —
    // the backend wire contract, not the local vault's internal camelCase shape.
    // `profile` was already resolved above (needed there for the word-count check).
    const recallTeamId = profile ? loadProfileRecallTeamIdFn(profile.name, configDir) : null;
    const payload = { external_id: id, title, tickets: ticketKeys, tags, author, sources: [], body, captured_at: capturedAt.toISOString() };
    if (recallTeamId !== null) payload.group_id = recallTeamId;
    // Base64 over the existing JSON push endpoint — additive to the wire
    // contract, no new request format. Backend re-validates size/count caps
    // independently (RecallAttachmentStorage) rather than trusting this
    // client-side pass, same defense-in-depth posture as the secret scanner.
    if (attachments.length > 0) {
      payload.attachments = attachments.map(a => ({ filename: a.filename, content: a.buffer.toString('base64') }));
    }
    const result = await pushNoteFn(payload, { cliToken, configDir, warn });
    if (isRetryableFailureFn(result)) {
      await enqueueNoteFn(payload, { cliToken, configDir, warn });
    }
    await maybeAutoFlushFn({ cliToken, configDir });
  }

  return { written: true };
}

/**
 * Implements `tl note patch` — overwrites an existing note's body with a
 * better draft. Internal plumbing for the jtb skill's quality loop (never
 * meant to be typed by hand): the loop's generator subagent produces a body,
 * SKILL.md's orchestration pipes it through this command, and the new body
 * gets exactly the same structural and secret gates a user-typed body gets —
 * there is no weaker path here for AI-authored content.
 *
 * @param {string[]} cmdArgs
 * @returns {Promise<{ patched: boolean }>}
 */
export async function runNotePatch(cmdArgs, {
  configDir = DEFAULT_CONFIG_DIR,
  stream = process.stderr,
  readStdin = defaultReadStdin,
  isLicensedFn = isLicensed,
  checkNoteStructureFn = checkNoteStructure,
  checkWordCountFn = checkWordCount,
  resolveProfileFn = resolveProfile,
  readCliTokenFn = readCliToken,
  resolveEffectiveRecallStrictnessFn = resolveEffectiveRecallStrictness,
  scanForSecretsFn = scanForSecrets,
  patchNoteBodyFn = patchNoteBody,
} = {}) {
  if (!isLicensedFn('pro', configDir)) {
    showUpgradePrompt('pro', 'ticketlens note', { stream });
    return { patched: false };
  }

  const id = parseFlag(cmdArgs, 'id');
  if (!id) {
    stream.write('Usage: ticketlens note patch --id="..." [--ticket=KEY]\n');
    return { patched: false };
  }

  const ticketKey = parseFlag(cmdArgs, 'ticket');
  if (ticketKey && !TICKET_KEY_PATTERN.test(ticketKey)) {
    stream.write(`  Invalid --ticket value "${ticketKey}" — expected a ticket key like PROJ-123.\n`);
    return { patched: false };
  }

  const body = await readStdin();

  const structural = checkNoteStructureFn({ body });
  if (structural.rejected) {
    stream.write(`  Note not updated — ${structural.reason}\n`);
    return { patched: false };
  }

  const profile = resolveProfileFn(ticketKey || null, { configDir, cwd: process.cwd() });
  const cliToken = readCliTokenFn(configDir);
  const strictness = resolveEffectiveRecallStrictnessFn({ profile, configDir, cliToken });
  const wordCount = checkWordCountFn({ body }, { maxWords: WORD_LIMITS[strictness] });
  for (const warning of wordCount.warnings) {
    stream.write(`  Warning: ${warning}\n`);
  }

  const scan = scanForSecretsFn({ title: '', tags: [], body });
  if (scan.rejected) {
    stream.write(`  Note not updated — ${scan.reasons.join(' ')}\n`);
    return { patched: false };
  }
  for (const warning of scan.warnings) {
    stream.write(`  Warning: ${warning}\n`);
  }

  const ticketKeys = ticketKey ? [ticketKey] : [];
  const expectMtimeArg = parseFlag(cmdArgs, 'expect-mtime');
  const expectedMtimeMs = expectMtimeArg !== undefined ? Number(expectMtimeArg) : undefined;
  const { patched } = patchNoteBodyFn({ id, ticketKeys, body, expectedMtimeMs }, { configDir });
  stream.write(patched ? `  Updated note (${id})\n` : `  Note not updated — (${id}) not found or already changed.\n`);
  return { patched };
}

/**
 * Implements `tl note delete` — removes a note from the local vault only.
 *
 * Local-only, same limitation `note patch` already documents: if this note
 * was already pushed to a team (Team Recall enabled), teammates who already
 * pulled it keep their copy — this does not push a tombstone. Deleting a
 * note everywhere it's synced is a manager action from the Console today
 * (Admin > Recall), which does propagate a tombstone on next pull.
 *
 * @param {string[]} cmdArgs
 * @returns {Promise<{ deleted: boolean }>}
 */
export async function runNoteDelete(cmdArgs, {
  configDir = DEFAULT_CONFIG_DIR,
  stream = process.stderr,
  stdin = process.stdin,
  isLicensedFn = isLicensed,
  deleteNoteFn = deleteNote,
  deleteNoteAnyPrefixFn = deleteNoteAnyPrefix,
  rebuildIndexFn = rebuildIndex,
  confirmFn = confirmDestructive,
} = {}) {
  if (!isLicensedFn('pro', configDir)) {
    showUpgradePrompt('pro', 'ticketlens note', { stream });
    return { deleted: false };
  }

  const id = parseFlag(cmdArgs, 'id');
  if (!id) {
    stream.write('Usage: ticketlens note delete --id="..." [--ticket=KEY] [--yes|-y]\n');
    return { deleted: false };
  }

  const ticketKey = parseFlag(cmdArgs, 'ticket');
  if (ticketKey && !TICKET_KEY_PATTERN.test(ticketKey)) {
    stream.write(`  Invalid --ticket value "${ticketKey}" — expected a ticket key like PROJ-123.\n`);
    return { deleted: false };
  }

  const forceYes = cmdArgs.includes('--yes') || cmdArgs.includes('-y');
  const confirmed = await confirmFn(`Delete note (${id})`, { stdin, stream, forceYes });
  if (!confirmed) {
    stream.write('  Aborted — note was not deleted.\n');
    return { deleted: false };
  }

  const { deleted, prefix } = ticketKey
    ? deleteNoteFn({ external_id: id, tickets: [ticketKey] }, { configDir })
    : deleteNoteAnyPrefixFn(id, { configDir });
  if (deleted) rebuildIndexFn(prefix, { configDir });
  stream.write(deleted
    ? `  Deleted note (${id}) — local vault only; see help for team-synced notes.\n`
    : `  Note not deleted — (${id}) not found.\n`);
  return { deleted };
}
