#!/usr/bin/env node
/**
 * Autonomous background Recall capture (backlog #24, 6th report — combined
 * with the sawMutatingAction narrowing in recall-nudge-lib.mjs's shouldNag).
 *
 * Spawned detached+unref'd by recall-nudge-stop.mjs on every Stop check —
 * independent of, and unable to see the outcome of, that hook's own
 * blocking-nag decision. TL judges and captures here, not Claude: reads the
 * session's own transcript, asks the backend's fixed capture-judgment
 * prompt (same 3-part SKILL.md rule Claude is asked to apply in-session),
 * and on a `capture` decision saves the note itself via the existing
 * `runNoteAdd()` pipeline — same Pro-gate, secret-scan, structural-check,
 * vault-write, team-push as a human- or Claude-typed `note add`.
 *
 * Pro+ / logged-in only, cloud mode only (uses the existing CLI login
 * token, never a personally-configured API key — the whole point of this
 * path is zero new user configuration). Free tier / logged-out silently
 * no-ops; the CLI/MCP surface a user actually sees is entirely unaffected.
 *
 * Best-effort throughout, matching every other file in this hook pair:
 * nothing here is allowed to throw past runAutoCapture(), write to real
 * stdout/stderr (nothing is watching a detached background process), or
 * take any action visible to the user beyond the note itself landing in
 * their vault. Every outcome (skip/capture/error) is appended to a local,
 * user-private debug log so a silent miss stays diagnosable.
 */

import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { isLicensed } from '../scripts/lib/license.mjs';
import { readCliToken } from '../scripts/lib/cli-auth.mjs';
import { buildCaptureExcerpt, privateTmpDir, writeLastCaptureAt } from './recall-nudge-lib.mjs';
import { autoCapture } from '../scripts/lib/summarizer.mjs';
import { runNoteAdd } from '../scripts/lib/note-command.mjs';
import { DEFAULT_CONFIG_DIR } from '../scripts/lib/config.mjs';
import { apiBase } from '../scripts/lib/api-utils.mjs';

/** Buffers stream.write() calls instead of touching a real stream — same shape mcp-server.mjs's own capturingStream() uses, this process has no real stdout/stderr worth writing to. */
function capturingStream() {
  const parts = [];
  return { write(s) { parts.push(s); return true; }, get text() { return parts.join(''); } };
}

// backlog #33: every outcome logs its resolved backend URL — "Unauthorized"/
// "not logged in" reports had no way to attribute which backend was hit
// (ngrok tunnel rotation and local-dev fallback both silently swap it).
function logLine(message) {
  try {
    const line = `${new Date().toISOString()} ${message} [api=${apiBase()}]\n`;
    appendFileSync(join(privateTmpDir(), 'auto-capture.log'), line);
  } catch { /* best-effort — losing a debug log line is not worth failing over */ }
}

/**
 * @param {object} opts
 * @param {string} opts.transcriptPath
 * @param {string} [opts.ticketKey]
 * @param {string} [opts.configDir]
 * @param {string} [opts.cwd] - directory whose shared capture marker gets updated on a real capture (backlog #44: makes a successful background capture visible to a later sync Stop check, which otherwise has no way to know this ran)
 * @returns {Promise<{outcome: 'skipped'|'captured'|'not-written'|'error', reason?: string, title?: string, error?: string}>}
 */
export async function runAutoCapture({
  transcriptPath,
  ticketKey,
  configDir = DEFAULT_CONFIG_DIR,
  cwd = process.cwd(),
  isLicensedFn = isLicensed,
  readCliTokenFn = readCliToken,
  buildCaptureExcerptFn = buildCaptureExcerpt,
  autoCaptureFn = autoCapture,
  runNoteAddFn = runNoteAdd,
  writeLastCaptureAtFn = writeLastCaptureAt,
} = {}) {
  if (!isLicensedFn('pro', configDir)) {
    logLine('skipped: not licensed');
    return { outcome: 'skipped', reason: 'not licensed' };
  }

  const cliToken = readCliTokenFn(configDir);
  if (!cliToken) {
    logLine('skipped: not logged in');
    return { outcome: 'skipped', reason: 'not logged in' };
  }

  const excerpt = buildCaptureExcerptFn(transcriptPath);
  if (!excerpt) {
    logLine('skipped: empty excerpt');
    return { outcome: 'skipped', reason: 'empty excerpt' };
  }

  let result;
  try {
    result = await autoCaptureFn({ excerpt, ticketKey, cliToken });
  } catch (err) {
    logLine(`error: ${err.message}${err.status ? ` (status=${err.status})` : ''}`);
    return { outcome: 'error', error: err.message };
  }

  if (result.decision !== 'capture') {
    logLine('skipped: decision=skip');
    return { outcome: 'skipped', reason: 'decision=skip' };
  }

  const cmdArgs = [`--title=${result.title}`];
  if (ticketKey) cmdArgs.push(`--ticket=${ticketKey}`);
  // Strip any comma an AI-produced tag might contain — runNoteAdd re-splits
  // --tags on ',', so an un-sanitized tag would silently fork into two.
  const cleanTags = (result.tags ?? []).map(t => String(t).replace(/,/g, '')).filter(Boolean);
  if (cleanTags.length > 0) cmdArgs.push(`--tags=${cleanTags.join(',')}`);

  const { written } = await runNoteAddFn(cmdArgs, {
    configDir,
    stream: capturingStream(),
    readStdin: () => Promise.resolve(result.body ?? ''),
  });

  logLine(written ? `captured: ${result.title}` : `not-written: ${result.title}`);
  if (written) writeLastCaptureAtFn(cwd, Date.now());
  return written ? { outcome: 'captured', title: result.title } : { outcome: 'not-written', title: result.title };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // cwdArg (backlog #44 code review): passed explicitly by the spawning Stop
  // hook rather than relying on this child's own process.cwd() — Node
  // resolves process.cwd() through symlinks, so a cwd with a symlinked
  // component would otherwise hash to a different marker file than the one
  // a later Stop's hasRecentCapture(cwd) reads, silently breaking the bridge.
  const [, , transcriptPath, ticketKeyArg, cwdArg] = process.argv;
  runAutoCapture({ transcriptPath, ticketKey: ticketKeyArg || undefined, cwd: cwdArg || undefined }).catch(() => { /* never escape — nothing is watching this process */ });
}
