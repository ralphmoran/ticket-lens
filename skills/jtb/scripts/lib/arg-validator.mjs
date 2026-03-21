/**
 * CLI argument validation — unknown flag detection with "did you mean?" and
 * an interactive y/N prompt to apply the corrected flag before re-running.
 *
 * Known-flags format
 * ──────────────────
 *   '--stale='   trailing '=' → flag takes a value  (--stale=5)
 *   '--plain'    no trailing '=' → boolean flag      (--plain)
 *
 * hints (optional)
 * ────────────────
 *   Same format, but these flags are from *other* commands.
 *   They widen the suggestion pool so a cross-command typo like
 *   --dept in triage can still surface "--depth (fetch flag)" as a hint.
 *   Hint suggestions are shown as informational only — no y/N prompt,
 *   since applying them wouldn't work for the current command.
 */

import { createStyler } from './ansi.mjs';

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => i ? (j ? 0 : i) : j)
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[m][n];
}

// Strip leading dashes before distance comparison so '--dept' vs '--depth' = 1 edit,
// not 3 (the shared '--' prefix would inflate every distance by 0 but skew alignment).
function bare(flag) {
  return flag.startsWith('--') ? flag.slice(2) : flag.startsWith('-') ? flag.slice(1) : flag;
}

// Threshold scales with bare flag length so short names require tight matches:
//   4-char bare ('dept')   → 2  —  'dept' vs 'help' = 3 > 2, no false positive
//   5-char bare ('state')  → 2  —  'state' vs 'stale' = 1 ≤ 2, correct match
//   7-char bare ('profile') → 3  —  'profle' vs 'profile' = 1 ≤ 3, correct
function threshold(bareFlag) {
  return Math.max(1, Math.ceil(bareFlag.length / 3));
}

/**
 * Find the best-matching flag name (without trailing '=') from `candidates`, or null.
 *
 * @param {string}   inputFlag  e.g. '--state'
 * @param {string[]} candidates from knownFlags and/or hints
 * @param {boolean}  hasValue   true when the user typed --flag=VALUE
 */
function findSuggestion(inputFlag, candidates, hasValue) {
  const input = bare(inputFlag);
  const limit = threshold(input);

  // Value-type filtering: --flag=value inputs should only match value-taking flags.
  // This prevents --help (boolean) from ever being suggested for --dept=5.
  const pool = hasValue ? candidates.filter(f => f.endsWith('=')) : candidates;

  const ranked = pool
    .map(f => {
      const name = f.replace(/=$/, '');
      return { name, dist: levenshtein(input, bare(name)) };
    })
    .sort((a, b) => a.dist - b.dist);

  return ranked[0]?.dist <= limit ? ranked[0].name : null;
}

function correctedArg(arg, suggestion) {
  const eqIdx = arg.indexOf('=');
  return eqIdx === -1 ? suggestion : `${suggestion}=${arg.slice(eqIdx + 1)}`;
}

/**
 * Detect unrecognized flags and either interactively fix them or signal exit.
 *
 * TTY + fixable suggestion:  prints styled error + "Apply <fix>? (y/N)"
 *   y → returns corrected args (caller re-runs with the fixed flag)
 *   N → returns null (caller sets exitCode=1)
 *
 * TTY + hint-only suggestion: prints error + informational "closest match" line, exits.
 *
 * Non-TTY: prints error + "Try: <fix>" or no tip, returns null.
 *
 * No unknowns → returns original args unchanged.
 *
 * @param {string[]}  args       CLI args (already normalised, e.g. --project→--profile)
 * @param {string[]}  knownFlags Flags this command accepts; append '=' for value-taking
 * @param {{ stream?: NodeJS.WritableStream, hints?: string[] }} opts
 *   hints: cross-command flags used only for suggestions, never auto-applied
 * @returns {Promise<string[]|null>}
 */
export async function handleUnknownFlags(args, knownFlags, { stream = process.stderr, hints = [] } = {}) {
  const s = createStyler({ isTTY: stream.isTTY });

  // Lookup set — strips trailing '=' so '--stale=3' matches the known entry '--stale='
  const knownNames = new Set(knownFlags.map(f => f.replace(/=$/, '')));

  // Suggestion pool = command flags + cross-command hints
  const allCandidates = [...knownFlags, ...hints];

  const unknowns = [];
  for (const arg of args) {
    if (!arg.startsWith('-')) continue;
    const flagName = arg.split('=')[0];
    if (knownNames.has(flagName)) continue;
    const hasValue = arg.includes('=');
    const suggestion = findSuggestion(flagName, allCandidates, hasValue);
    // isApplicable: suggestion is in this command's known flags (can be auto-applied)
    const isApplicable = suggestion !== null && knownNames.has(suggestion.replace(/=$/, ''));
    unknowns.push({ arg, flagName, hasValue, suggestion, isApplicable });
  }

  if (unknowns.length === 0) return args;

  // ── One diagnostic line per unknown flag ──────────────────────────────────
  stream.write('\n');
  for (const { flagName, suggestion, isApplicable } of unknowns) {
    if (suggestion && isApplicable) {
      stream.write(
        `  ${s.red('✗')} ${s.cyan(flagName)} is not a recognized flag — did you mean ${s.cyan(suggestion)}?\n`
      );
    } else if (suggestion) {
      // Cross-command hint: helpful but can't be auto-applied
      stream.write(
        `  ${s.red('✗')} ${s.cyan(flagName)} is not a recognized flag — closest match: ${s.cyan(suggestion)} ${s.dim('(not available in this command)')}\n`
      );
    } else {
      stream.write(`  ${s.red('✗')} ${s.cyan(flagName)} is not a recognized flag.\n`);
    }
  }

  const fixable = unknowns.filter(u => u.suggestion && u.isApplicable);

  // ── TTY: offer an interactive fix for applicable suggestions ──────────────
  if (stream.isTTY && process.stdin.setRawMode && fixable.length > 0) {
    const preview = fixable.map(u => s.cyan(correctedArg(u.arg, u.suggestion))).join(', ');
    stream.write(`\n  Apply ${preview}?  ${s.dim('y/N')}  `);

    const answer = await new Promise(res => {
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.setEncoding('utf8');
      process.stdin.once('data', char => {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        stream.write('\n\n');
        if (char === '\x03') process.exit(0);
        res(char === 'y' || char === 'Y');
      });
    });

    if (answer) {
      let corrected = args;
      for (const { arg, suggestion } of fixable) {
        const fixed = correctedArg(arg, suggestion);
        corrected = corrected.map(a => a === arg ? fixed : a);
      }
      return corrected;
    }

    return null;
  }

  // ── Non-TTY: print tip and signal exit ────────────────────────────────────
  if (fixable.length > 0) {
    const tips = fixable.map(u => s.cyan(correctedArg(u.arg, u.suggestion))).join(', ');
    stream.write(`  ${s.dim('Try:')} ${tips}\n`);
  }
  stream.write('\n');
  return null;
}
