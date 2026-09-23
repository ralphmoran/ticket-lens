/**
 * Opt-in CLI error/diagnostic reporting (49e). Wraps every command's
 * top-level .catch() in bin/ticketlens.mjs via handleCommandError() there.
 *
 * Consent is asked at most once, ever, and only when a real error just
 * happened and the process's stdin+stderr are both a real terminal, outside
 * CI — never under MCP stdio (that path has no wiring to this function at
 * all) or CI. isInteractive is a TTY check, not an output-format check: a
 * human can be genuinely present and able to answer a stderr prompt
 * regardless of what flags the command itself was given.
 *
 * The prompt is still bounded (PROMPT_TIMEOUT_MS, via promptYN's timeoutMs —
 * see prompt-helpers.mjs) so an unanswered question can never hang the
 * process indefinitely (security review finding, 2026-09-23: the first
 * version had no timeout here — an orphaned raw-mode stdin listener keeps
 * Node's event loop alive regardless of what a caller does with the
 * returned promise, so the timeout has to live inside promptYN itself, not
 * be raced against externally). A timeout resolves to `null`, distinct from
 * a real `false` answer — it is never persisted, so an AFK/non-responsive
 * user is asked again on the next real error, not permanently opted out.
 *
 * Once a real (non-null) answer is given, it's never asked again
 * (loadErrorReportingConsent/saveErrorReportingConsent, profile-resolver.mjs).
 *
 * Sending is entirely best-effort: a broken network, a rejected promptFn, or
 * a scan false-positive must never surface past this function, since it
 * runs inside an error path that already has its own real error to report
 * to the user via stderr.
 */

import { DEFAULT_CONFIG_DIR } from './config.mjs';
import { getVersion } from './config.mjs';
import { apiBase } from './api-utils.mjs';
import { promptYN } from './prompt-helpers.mjs';
import { loadErrorReportingConsent, saveErrorReportingConsent } from './profile-resolver.mjs';
import { readLicense } from './license.mjs';
import { scanForSecrets, containsKnownSecretPattern } from './secret-scanner.mjs';

const CONSENT_QUESTION = 'Would you like TicketLens to send reports about issues, bugs, and errors to improve your experience?';
// Human reaction time, not a network call — generous, but still a hard
// upper bound on how long an unanswered prompt can keep the process open.
const PROMPT_TIMEOUT_MS = 15_000;

function defaultIsInteractive() {
  return Boolean(process.stdin.isTTY && process.stderr.isTTY && !process.env.CI);
}

export async function maybeReportError(err, command, {
  configDir = DEFAULT_CONFIG_DIR,
  isInteractive = defaultIsInteractive(),
  promptFn = promptYN,
  fetcher = globalThis.fetch,
  stream = process.stderr,
  promptTimeoutMs = PROMPT_TIMEOUT_MS,
} = {}) {
  try {
    let consent = loadErrorReportingConsent(configDir);

    if (consent === undefined) {
      // Never ask outside a real terminal — undecided stays undecided until
      // a real interactive session hits an error and can actually answer.
      if (!isInteractive) return;
      consent = await promptFn(CONSENT_QUESTION, { stream, timeoutMs: promptTimeoutMs });
      // null = timed out with no answer — stays undecided, ask again next
      // time, never persisted as a real (permanent) decision.
      if (consent === null) return;
      saveErrorReportingConsent(consent, configDir);
    }

    if (!consent) return;

    const message = err?.message ?? String(err);
    const stackTrace = err?.stack;

    // Client-side pre-check only — the backend re-scans independently
    // (RecallSecretScanner, defense in depth), so this just avoids a
    // pointless network call when the server would reject it anyway.
    //
    // message uses the full entropy-aware scan (real free text — a user- or
    // library-authored string, same as a Recall note body). stack_trace
    // uses the narrower known-pattern-only check: a V8 stack trace's own
    // "at fn (path:line:col)" frames are machine-generated and false-positive
    // almost every line on the entropy heuristic (found 2026-09-23) — a real
    // secret embedded in one still has a literal known prefix and is still
    // caught by containsKnownSecretPattern.
    const messageScan = scanForSecrets({ title: command ?? '', body: message });
    if (messageScan.rejected) return;
    if (stackTrace && containsKnownSecretPattern(stackTrace)) return;

    const license = readLicense(configDir);
    const payload = {
      cli_version: getVersion(),
      os: process.platform,
      command: command || undefined,
      message,
      stack_trace: stackTrace || undefined,
      profile_tier: license?.tier || undefined,
    };

    await fetcher(`${apiBase()}/v1/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Best-effort — never let a broken reporting path affect the real error
    // the caller is already handling.
  }
}
