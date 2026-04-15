/**
 * Ticket-to-PR Assembler
 * Composes a markdown PR description from ticket data, linked commits,
 * requirements, and compliance coverage.
 */

import { spawnSync } from 'node:child_process';
import { fetchTicket } from './jira-client.mjs';
import { extractRequirements } from './requirement-extractor.mjs';
import { findLinkedCommits } from './commit-linker.mjs';
import { runComplianceCheck } from './compliance-checker.mjs';
import { DEFAULT_CONFIG_DIR } from './config.mjs';

/**
 * Detect the git remote URL using execFn.
 * Returns the URL string or null if none detected.
 *
 * @param {Function} execFn - injectable spawnSync-compatible function
 * @returns {string|null}
 */
function detectRemoteUrl(execFn) {
  try {
    const result = execFn('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' });
    if (result.status === 0 && result.stdout) {
      return result.stdout.trim();
    }
  } catch {
    // non-fatal
  }
  return null;
}

/**
 * Build the "### Linked tickets" section from a ticket's linkedIssues.
 *
 * @param {Array} linkedIssues - array of { key, summary, linkType, direction }
 * @returns {string} section markdown or empty string
 */
function buildLinkedTicketsSection(linkedIssues) {
  if (!linkedIssues || linkedIssues.length === 0) return '';

  const lines = ['', '### Linked tickets'];
  for (const issue of linkedIssues) {
    const rel = issue.linkType ?? issue.direction ?? 'Linked';
    lines.push(`- ${issue.key}: ${rel} — ${issue.summary}`);
  }
  return lines.join('\n');
}

/**
 * Build the "### Requirements coverage" section.
 *
 * @param {object|null} complianceResult - result from runComplianceCheckFn or null
 * @param {string[]} requirements - raw requirements list
 * @returns {string} section markdown
 */
function buildCoverageSection(complianceResult, requirements) {
  if (complianceResult === null) {
    const lines = ['', '### Requirements coverage (coverage unavailable — Pro required)'];
    for (const req of requirements) {
      lines.push(`- ${req}`);
    }
    return lines.join('\n');
  }

  const { coveragePercent, report } = complianceResult;
  const lines = [``, `### Requirements coverage (${coveragePercent}%)`];

  for (const entry of report) {
    if (entry.covered) {
      const loc = entry.location ? ` (${entry.location})` : '';
      lines.push(`- ✔ ${entry.req}${loc}`);
    } else {
      lines.push(`- ✖ ${entry.req}`);
    }
  }

  // Include any missing reqs not already in report
  if (complianceResult.missing && complianceResult.missing.length > 0) {
    const reportedReqs = new Set(report.map(r => r.req));
    for (const missed of complianceResult.missing) {
      if (!reportedReqs.has(missed)) {
        lines.push(`- ✖ ${missed}`);
      }
    }
  }

  return lines.join('\n');
}

/**
 * Assemble a markdown PR description for the given ticket key.
 *
 * @param {string} ticketKey - e.g. 'PROJ-123'
 * @param {object} opts - injectable dependencies
 * @param {string} [opts.configDir] - config directory path
 * @param {Function} [opts.fetchTicketFn] - async fn(ticketKey, opts) → ticket
 * @param {Function} [opts.extractRequirementsFn] - fn(text) → string[]
 * @param {Function} [opts.findLinkedCommitsFn] - async fn(ticketKey, opts) → commit[]
 * @param {Function} [opts.runComplianceCheckFn] - async fn({ brief, ticketKey, configDir }) → result|null
 * @param {Function} [opts.execFn] - spawnSync-compatible for git remote detection
 * @param {object} [opts.stream] - stderr for progress output (optional)
 * @returns {Promise<string>} markdown PR description
 */
export async function assemblePr(ticketKey, {
  configDir = DEFAULT_CONFIG_DIR,
  fetchTicketFn = fetchTicket,
  extractRequirementsFn = extractRequirements,
  findLinkedCommitsFn = findLinkedCommits,
  runComplianceCheckFn = runComplianceCheck,
  execFn = spawnSync,
  stream,
} = {}) {
  // Fetch ticket data
  const ticket = await fetchTicketFn(ticketKey, { configDir });

  const summary = ticket.summary ?? ticket.fields?.summary ?? '';
  const description = ticket.description ?? ticket.fields?.description ?? '';
  const linkedIssues = ticket.linkedIssues ?? ticket.fields?.issuelinks ?? [];

  // Extract requirements from description
  const requirements = extractRequirementsFn(description);

  // Find linked commits
  const commits = await findLinkedCommitsFn(ticketKey, { cwd: process.cwd() });

  // Build a minimal plain-text brief for compliance check input
  const brief = `## ${ticketKey}: ${summary}\n\n${description}`;

  // Run compliance check (may return null for non-Pro)
  let complianceResult = null;
  try {
    complianceResult = await runComplianceCheckFn({ brief, ticketKey, configDir });
  } catch {
    // non-fatal — treat as unavailable
  }

  // Detect remote URL for auto-close footer
  const remoteUrl = detectRemoteUrl(execFn);
  const isGitHubOrGitLab = remoteUrl && (
    remoteUrl.includes('github.com') || remoteUrl.includes('gitlab.com')
  );

  // Build output
  const lines = [`## ${ticketKey}: ${summary}`, ''];

  // What changed
  lines.push('### What changed');
  if (commits.length === 0) {
    lines.push('_No linked commits found._');
  } else {
    for (const commit of commits) {
      const sha = commit.sha ?? commit.hash ?? '';
      const msg = commit.message ?? '';
      lines.push(`- ${sha} ${msg}`.trim());
    }
  }

  // Requirements coverage
  lines.push(buildCoverageSection(complianceResult, requirements));

  // Acceptance criteria
  lines.push('');
  lines.push('### Acceptance criteria');
  if (requirements.length === 0) {
    lines.push('_No acceptance criteria found._');
  } else {
    for (const req of requirements) {
      lines.push(`- ${req}`);
    }
  }

  // Linked tickets (optional section)
  const linkedSection = buildLinkedTicketsSection(linkedIssues);
  if (linkedSection) {
    lines.push(linkedSection);
  }

  // Close footer
  if (isGitHubOrGitLab) {
    lines.push('');
    lines.push('---');
    lines.push(`Closes ${ticketKey}`);
  }

  return lines.join('\n');
}
