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
