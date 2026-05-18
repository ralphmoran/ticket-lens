/**
 * PR Review Context Assembler
 * Given a git diff + pre-fetched tickets, produces a markdown brief
 * suitable for AI-assisted code review.
 */

import { analyzeDiff } from './diff-analyzer.mjs';
import { extractRequirements } from './requirement-extractor.mjs';

const TICKET_KEY_RE = /\b([A-Z][A-Z0-9]+-\d+)\b/g;

/**
 * Extract all unique ticket keys from a string (branch name, commit messages, etc.).
 * Returns a sorted, deduplicated array.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function extractTicketKeys(text) {
  if (!text || typeof text !== 'string') return [];
  const found = new Set(text.match(TICKET_KEY_RE) ?? []);
  return [...found].sort();
}

/**
 * Build the "### Changed files" section from a unified diff string.
 * Parses "+++ b/<path>" headers.
 *
 * @param {string|null} diff
 * @returns {string} markdown section or empty string
 */
function buildChangedFilesSection(diff) {
  if (!diff) return '';
  const files = [];
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ b/')) {
      const path = line.slice(6).trim();
      if (path && path !== '/dev/null') files.push(path);
    }
  }
  if (files.length === 0) return '';
  const lines = ['', `### Changed files (${files.length})`];
  for (const f of files) lines.push(`- ${f}`);
  return lines.join('\n');
}

/**
 * Build the coverage + review-focus sections for all tickets (Pro-gated).
 * Returns empty string when no requirements exist across all tickets.
 *
 * @param {object[]} tickets
 * @param {string} diff
 * @param {Function} extractRequirementsFn
 * @param {Function} analyzeDiffFn
 * @returns {string}
 */
function buildCoverageSections(tickets, diff, extractRequirementsFn, analyzeDiffFn) {
  const coverageEntries = [];
  const focusEntries = [];

  for (const ticket of tickets) {
    const reqs = extractRequirementsFn(ticket.description ?? '');
    if (reqs.length === 0) continue;

    const { results, coveragePercent } = analyzeDiffFn(reqs, diff);
    coverageEntries.push({ ticket, results, coveragePercent });

    const uncovered = results
      .filter(r => r.status === 'NOT_FOUND')
      .map(r => r.requirement);
    if (uncovered.length > 0) focusEntries.push({ ticket, uncovered });
  }

  if (coverageEntries.length === 0) return '';

  const lines = ['', '### Requirements coverage'];
  for (const { ticket, results, coveragePercent } of coverageEntries) {
    lines.push('', `#### ${ticket.key} (${coveragePercent}%)`);
    for (const r of results) {
      if (r.status === 'NOT_FOUND') {
        lines.push(`- ✖ ${r.requirement}`);
      } else {
        const loc = r.evidence ? ` — ${r.evidence}` : '';
        const mark = r.status === 'FOUND' ? '✔' : '~';
        lines.push(`- ${mark} ${r.requirement}${loc}`);
      }
    }
  }

  if (focusEntries.length > 0) {
    lines.push('', '### Review focus');
    for (const { ticket, uncovered } of focusEntries) {
      lines.push('', `#### ${ticket.key} — uncovered requirements`);
      for (const req of uncovered) lines.push(`- ${req}`);
    }
  }

  return lines.join('\n');
}

/**
 * Assemble a markdown PR code-review context brief.
 *
 * @param {object} opts
 * @param {string|null}  [opts.diff]               - git diff string
 * @param {object[]}     [opts.tickets]             - pre-fetched ticket objects
 * @param {string}       [opts.baseBranch]          - e.g. 'main'
 * @param {string|null}  [opts.headBranch]          - current branch name
 * @param {Function}     [opts.isLicensedFn]        - fn(tier) → bool
 * @param {Function}     [opts.analyzeDiffFn]       - injectable (tests)
 * @param {Function}     [opts.extractRequirementsFn] - injectable (tests)
 * @returns {Promise<string>}
 */
export async function assemblePrReview({
  diff = null,
  tickets = [],
  baseBranch = 'main',
  headBranch = null,
  isLicensedFn = () => false,
  analyzeDiffFn = analyzeDiff,
  extractRequirementsFn = extractRequirements,
} = {}) {
  const lines = ['## PR Review Context'];

  // Branch
  lines.push('', '### Branch');
  if (headBranch) {
    lines.push(`\`${headBranch}\` → \`${baseBranch}\``);
  } else {
    lines.push(`→ \`${baseBranch}\``);
  }

  // Changed files (from diff)
  const filesSection = buildChangedFilesSection(diff);
  if (filesSection) lines.push(filesSection);

  if (tickets.length === 0) {
    lines.push('', '_No linked tickets found in branch name or commits._');
  } else {
    // Ticket context
    lines.push('', '### Ticket context');
    for (const ticket of tickets) {
      const reqs = extractRequirementsFn(ticket.description ?? '');
      lines.push('', `#### ${ticket.key}: ${ticket.summary ?? ''}`);
      if (reqs.length === 0) {
        lines.push('_No requirements found._');
      } else {
        for (const req of reqs) lines.push(`- ${req}`);
      }
    }

    // Requirements coverage (Pro-gated, requires diff)
    if (isLicensedFn('pro') && diff) {
      const coverageOut = buildCoverageSections(tickets, diff, extractRequirementsFn, analyzeDiffFn);
      if (coverageOut) lines.push(coverageOut);
    } else if (!isLicensedFn('pro')) {
      lines.push('', '_Requirements coverage analysis requires a Pro license — `ticketlens activate <KEY>`_');
    }
  }

  lines.push('', '---', `_Generated by TicketLens · \`ticketlens review --base=${baseBranch}\`_`);

  return lines.join('\n');
}
