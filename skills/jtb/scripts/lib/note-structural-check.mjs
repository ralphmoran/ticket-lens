/**
 * Deterministic, dependency-free structural gate for a Recall note's body —
 * catches empty, placeholder, or too-thin content before it's ever written
 * to the vault. Separate concern from secret-scanner.mjs: this never judges
 * sensitivity, only whether there's real content here at all.
 */

const MIN_BODY_LENGTH = 10;

const PLACEHOLDER_BODIES = new Set([
  'todo', 'test', 'n/a', 'na', 'tbd', 'wip', 'placeholder',
  'xxx', 'asdf', 'fixme', 'fix me', '.', '-',
]);

/**
 * @param {{ body?: string }} note
 * @returns {{ rejected: boolean, reason: string|null }}
 */
export function checkNoteStructure({ body = '' } = {}) {
  const trimmed = body.trim();

  if (trimmed.length === 0) {
    return { rejected: true, reason: 'Note body is empty.' };
  }
  if (PLACEHOLDER_BODIES.has(trimmed.toLowerCase())) {
    return { rejected: true, reason: `Note body "${trimmed}" looks like a placeholder, not real content.` };
  }
  if (trimmed.length < MIN_BODY_LENGTH) {
    return { rejected: true, reason: `Note body is too short to be useful (minimum ${MIN_BODY_LENGTH} characters).` };
  }

  return { rejected: false, reason: null };
}

// Backlog #18 — mandatory brevity cap, one entry per recallStrictness level.
// Warning-only: a rambling note still saves, it just gets flagged so the
// caller can tighten it, same non-blocking pattern scanForSecrets uses for
// its `warnings` array.
export const WORD_LIMITS = { strict: 20, balanced: 30, loose: 50 };

function countWords(text) {
  const trimmed = text.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
}

/**
 * Warning-only companion to checkNoteStructure: flags a title/body that runs
 * long instead of rejecting it. `maxWords` is a plain number so this stays
 * dependency-free — the caller maps recallStrictness to a number.
 *
 * @param {{ title?: string, body?: string }} note
 * @param {{ maxWords?: number }} opts
 * @returns {{ warnings: string[] }}
 */
export function checkWordCount({ title = '', body = '' } = {}, { maxWords = WORD_LIMITS.balanced } = {}) {
  const warnings = [];

  const titleWords = countWords(title);
  if (titleWords > maxWords) {
    warnings.push(`Note title is ${titleWords} words (recommended max: ${maxWords}).`);
  }

  const bodyWords = countWords(body);
  if (bodyWords > maxWords) {
    warnings.push(`Note body is ${bodyWords} words (recommended max: ${maxWords}).`);
  }

  return { warnings };
}
