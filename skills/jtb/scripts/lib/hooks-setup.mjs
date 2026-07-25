/**
 * Installs the Recall nudge hooks (recall-nudge-post-tool.mjs,
 * recall-nudge-stop.mjs) into any detected Claude Code settings.json —
 * run from postinstall.mjs on every install/update so a user never has to
 * wire this by hand. Idempotent: safe to run on every `npm install`.
 *
 * Never touches an existing settings.json's other content, and never
 * throws — a malformed or unreadable settings.json is skipped, not
 * overwritten, so a broken install can never corrupt the user's config.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOOKS_DIR = join(__dirname, '..', '..', 'hooks');
const POST_TOOL_SCRIPT = join(HOOKS_DIR, 'recall-nudge-post-tool.mjs');
const STOP_SCRIPT       = join(HOOKS_DIR, 'recall-nudge-stop.mjs');

// Distinctive substring used to find/replace our own entries on re-install —
// never matches anything a user could plausibly have written by hand.
const MARKER = 'recall-nudge-post-tool.mjs';
const STOP_MARKER = 'recall-nudge-stop.mjs';

const CLAUDE_DIRS = [
  join(homedir(), '.claude'),
  join(homedir(), '.claude-work'),
];

function makeHookEntry(scriptPath, matcher) {
  return {
    matcher,
    hooks: [
      {
        type: 'command',
        command: `node "${scriptPath}"`,
        timeout: 5,
      },
    ],
  };
}

function upsertHookEntry(list, marker, entry) {
  const idx = list.findIndex(h =>
    (h.hooks || []).some(inner => typeof inner.command === 'string' && inner.command.includes(marker)),
  );
  if (idx === -1) {
    list.push(entry);
    return 'added';
  }
  if (JSON.stringify(list[idx]) === JSON.stringify(entry)) return 'unchanged';
  list[idx] = entry;
  return 'updated';
}

function installInto(settingsPath) {
  let settings = {};
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
    } catch {
      return { status: 'skipped', reason: 'malformed settings.json — left untouched' };
    }
  }

  settings.hooks ??= {};
  settings.hooks.PostToolUse ??= [];
  settings.hooks.Stop ??= [];

  const postResult = upsertHookEntry(
    settings.hooks.PostToolUse,
    MARKER,
    makeHookEntry(POST_TOOL_SCRIPT, 'Bash'),
  );
  const stopResult = upsertHookEntry(
    settings.hooks.Stop,
    STOP_MARKER,
    makeHookEntry(STOP_SCRIPT, '*'),
  );

  if (postResult === 'unchanged' && stopResult === 'unchanged') {
    return { status: 'unchanged' };
  }

  const tmpPath = `${settingsPath}.${process.pid}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
  // Atomic on POSIX — avoids ever leaving settings.json half-written.
  renameSync(tmpPath, settingsPath);

  return { status: 'installed', postResult, stopResult };
}

/**
 * @returns {{ label: string, status: string }[]} one entry per Claude
 *   directory found on this machine, for the caller to log.
 */
export function setupRecallHooks() {
  const results = [];

  for (const dir of CLAUDE_DIRS) {
    if (!existsSync(dir)) continue;
    const settingsPath = join(dir, 'settings.json');
    try {
      mkdirSync(dir, { recursive: true });
      const result = installInto(settingsPath);
      results.push({ label: dir, ...result });
    } catch (err) {
      results.push({ label: dir, status: 'error', reason: err.message });
    }
  }

  return results;
}
