/**
 * Field renderers shared by every surface that prints a ticket: the plain
 * brief (what MCP `fetch` returns), the styled brief, the `pr` description and
 * the `ticket_link` read-back. One place, so all of them word a link or a
 * label list the same way.
 *
 * Everything here is external text (Jira labels, admin-named link phrases) and
 * ends up inside markdown that budget-pruner splits on lines starting "## ",
 * and inside terminals. Each value is therefore forced onto one line, stripped
 * of control characters and length-capped before it is returned: with no line
 * break left, it can neither start a heading nor be completed into one by a
 * neighbouring fragment.
 */

import { escapeLeadingHeading } from './config.mjs';
import { sanitizeUntrustedText } from './ansi.mjs';

export const MAX_LABELS = 50;
export const MAX_LABEL_LENGTH = 100;
export const MAX_PHRASE_LENGTH = 100;

const ELLIPSIS = '…';

/**
 * Untrusted text as one clean line: every whitespace run (newlines, \r,
 * U+2028/2029, tabs, NBSP) becomes one space, then control characters are
 * removed, then it is trimmed and capped at `maxLength` characters.
 * @param {unknown} value
 * @param {number} [maxLength]
 * @returns {string}
 */
export function singleLine(value, maxLength = Infinity) {
  const text = sanitizeUntrustedText(String(value ?? '').replace(/\s+/g, ' ')).trim();
  // UTF-16 length is never below the character count, so a short string needs no code-point split.
  if (text.length <= maxLength) return text;
  const chars = Array.from(text);
  return chars.length > maxLength ? `${chars.slice(0, maxLength - 1).join('')}${ELLIPSIS}` : text;
}

/**
 * "backend, patch" for a ticket's labels, or '' when it has none.
 * @param {{ labels?: unknown } | null | undefined} ticket
 * @returns {string}
 */
export function labelsText(ticket) {
  const labels = Array.isArray(ticket?.labels) ? ticket.labels : [];
  const names = labels
    .filter(label => typeof label === 'string')
    .map(label => singleLine(label, MAX_LABEL_LENGTH))
    .filter(Boolean);
  const shown = names.slice(0, MAX_LABELS);
  if (names.length > MAX_LABELS) shown.push(`+${names.length - MAX_LABELS} more`);
  return escapeLeadingHeading(shown.join(', '));
}

/**
 * One link as Jira stores it: "PARENT <phrase> CHILD", e.g. "PROJ-1 is blocked
 * by PROJ-2". The phrase is the one Jira keeps for the side the parent is on
 * (`linkPhrase`, set by normalizeTicket), so the direction is never guessed.
 * '' when Jira gave no phrase, so callers can fall back to their old output.
 *
 * @param {string} parentKey - the ticket the link was read from
 * @param {{ key: string, linkPhrase?: string } | null | undefined} link
 * @param {(cleanKey: string) => string} [renderKey] - styles the linked key
 * @returns {string}
 */
export function linkSentence(parentKey, link, renderKey = key => key) {
  const phrase = singleLine(link?.linkPhrase, MAX_PHRASE_LENGTH);
  if (!phrase) return '';
  const sentence = `${singleLine(parentKey)} ${phrase} ${renderKey(singleLine(link.key))}`;
  return escapeLeadingHeading(sentence);
}

/**
 * Every stored relation between a parent ticket and one linked ticket, read
 * from the parent's `linkedIssues`. Jira allows several link types between the
 * same pair, so the sentences are joined with "; ". '' when there is none —
 * GitHub and Linear return no `linkedIssues`, so they render as before.
 *
 * @param {{ key: string, linkedIssues?: object[] } | null | undefined} parent
 * @param {{ key: string } | null | undefined} child
 * @returns {string}
 */
export function relationText(parent, child) {
  const links = Array.isArray(parent?.linkedIssues) ? parent.linkedIssues : [];
  const sentences = links
    .filter(link => link.key === child?.key)
    .map(link => linkSentence(parent.key, link))
    .filter(Boolean);
  return [...new Set(sentences)].join('; ');
}
