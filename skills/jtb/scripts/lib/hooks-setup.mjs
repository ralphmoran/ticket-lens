/**
 * Installs the Recall nudge Stop hook (recall-nudge-stop.mjs) into any
 * detected Claude Code settings.json — run from postinstall.mjs on every
 * install/update so a user never has to wire this by hand. Idempotent: safe
 * to run on every `npm install`. Also cleans up the retired PostToolUse
 * nudge (recall-nudge-post-tool.mjs) from any settings.json that still has
 * it from a prior install — it only ever matched Bash tool calls, so it
 * went silently inert once ticket work moved to MCP tools, and was removed
 * rather than left as dead config.
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
const STOP_SCRIPT = join(HOOKS_DIR, 'recall-nudge-stop.mjs');

// Distinctive substrings used to find our own entries on re-install/cleanup —
// never matches anything a user could plausibly have written by hand.
const RETIRED_POST_TOOL_MARKER = 'recall-nudge-post-tool.mjs';
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

// Both functions below locate our own hook by a marker substring inside a
// list entry's `hooks` array, but must never drop an unrelated hook a user
// happens to have colocated in that same array entry (e.g. sharing our
// matcher) — only our own matching inner hook is ever added/replaced/removed.

function upsertHookEntry(list, marker, entry) {
  const idx = list.findIndex(h =>
    (h.hooks || []).some(inner => typeof inner.command === 'string' && inner.command.includes(marker)),
  );
  if (idx === -1) {
    list.push(entry);
    return 'added';
  }
  const ownInner = entry.hooks[0]; // makeHookEntry always builds a single-command entry
  const otherHooks = list[idx].hooks.filter(inner => !(typeof inner.command === 'string' && inner.command.includes(marker)));
  // Our hook was the only thing in this entry — safe to fully replace
  // (also picks up a matcher change, if any). Otherwise preserve the
  // entry's existing matcher and other hooks, just swap our own inner hook.
  const merged = otherHooks.length === 0 ? entry : { ...list[idx], hooks: [...otherHooks, ownInner] };
  if (JSON.stringify(list[idx]) === JSON.stringify(merged)) return 'unchanged';
  list[idx] = merged;
  return 'updated';
}

function removeHookEntry(list, marker) {
  const idx = list.findIndex(h =>
    (h.hooks || []).some(inner => typeof inner.command === 'string' && inner.command.includes(marker)),
  );
  if (idx === -1) return 'absent';
  const remaining = list[idx].hooks.filter(inner => !(typeof inner.command === 'string' && inner.command.includes(marker)));
  if (remaining.length === 0) {
    list.splice(idx, 1);
  } else {
    list[idx] = { ...list[idx], hooks: remaining };
  }
  return 'removed';
}

export function installInto(settingsPath) {
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

  const postCleanupResult = removeHookEntry(settings.hooks.PostToolUse, RETIRED_POST_TOOL_MARKER);
  const stopResult = upsertHookEntry(
    settings.hooks.Stop,
    STOP_MARKER,
    makeHookEntry(STOP_SCRIPT, '*'),
  );

  if (postCleanupResult === 'absent' && stopResult === 'unchanged') {
    return { status: 'unchanged' };
  }

  const tmpPath = `${settingsPath}.${process.pid}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
  // Atomic on POSIX — avoids ever leaving settings.json half-written.
  renameSync(tmpPath, settingsPath);

  return { status: 'installed', postCleanupResult, stopResult };
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
