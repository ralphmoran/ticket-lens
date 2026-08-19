import { spawnSync } from 'node:child_process';
import { isLicensed, showUpgradePrompt } from './license.mjs';
import { checkUsage, incrementUsage, FREE_LIMIT } from './usage-tracker.mjs';
import { extractRequirements } from './requirement-extractor.mjs';
import { findLinkedCommits } from './commit-linker.mjs';
import { analyzeDiff } from './diff-analyzer.mjs';
import { DEFAULT_CONFIG_DIR } from './config.mjs';
import { appendLedger } from './ledger.mjs';
import { createStyler } from './ansi.mjs';

export const STATUS_ICON = { FOUND: '✔', PARTIAL: '~', NOT_FOUND: '✖' };

export function statusColor(status, s) {
  if (status === 'FOUND') return s.green;
  if (status === 'PARTIAL') return s.yellow;
  return s.dim;
}

// Shared with matchColor in ticket-command.mjs (duplicates' match-confidence
// tiers) — same 70/50 thresholds, same green/yellow/dim vocabulary, applied
// here to overall requirement coverage instead of a single match score.
export function coverageColor(pct, s) {
  if (pct >= 70) return s.green;
  if (pct >= 50) return s.yellow;
  return s.dim;
}

function formatReport({ ticketKey, requirements, analysis, usage, isPro, s }) {
  const { results, coveragePercent } = analysis;
  const lines = [
    '',
    `  Compliance Check — ${s.brand(s.bold(ticketKey))}`,
    `  ${s.dim('─'.repeat(50))}`,
    '',
  ];

  if (requirements.length === 0) {
    lines.push('  No acceptance criteria found in ticket description.');
    lines.push('  Add a "Acceptance Criteria" section or Given/When/Then statements.');
    lines.push('');
    return lines.join('\n');
  }

  for (const { requirement, status, evidence } of results) {
    const icon = statusColor(status, s)(STATUS_ICON[status] ?? '?');
    lines.push(`  ${icon} ${requirement}`);
    if (evidence) lines.push(`      └─ ${s.dim(evidence)}`);
    lines.push('');
  }

  lines.push('');
  const found = results.filter(r => r.status === 'FOUND').length;
  lines.push(`  Coverage: ${coverageColor(coveragePercent, s)(`${coveragePercent}%`)}  (${found}/${results.length} requirements found)`);
  lines.push('');

  if (!isPro) {
    const remaining = FREE_LIMIT - (usage.count + 1); // +1 = this check (already incremented)
    lines.push(`  Free tier: ${remaining} compliance check${remaining !== 1 ? 's' : ''} remaining this month.`);
    lines.push('  Upgrade to Pro for unlimited checks.');
    lines.push('');
  }

  return lines.join('\n');
}

export async function runComplianceCheck({
  brief,
  description = null,
  ticketKey,
  configDir = DEFAULT_CONFIG_DIR,
  stream = process.stderr,
  // Separate from `stream` (stderr, only used for the Pro-upgrade nudge
  // above) — the report string itself is printed to stdout by the caller
  // (fetch-ticket.mjs), so styling must gate on stdout's TTY-ness, not
  // stderr's, or ANSI codes would leak into `tl compliance X > out.txt`
  // while stderr stays attached to a real terminal.
  outStream = process.stdout,
  isLicensedFn       = isLicensed,
  showUpgradeFn      = showUpgradePrompt,
  checkUsageFn       = checkUsage,
  incrementUsageFn   = incrementUsage,
  extractRequirementsFn = extractRequirements,
  findLinkedCommitsFn   = findLinkedCommits,
  analyzeDiffFn         = analyzeDiff,
  appendLedgerFn        = appendLedger,
  execFn                = spawnSync,
}) {
  const isPro = isLicensedFn('pro', configDir);
  const usage = checkUsageFn(configDir);

  if (!isPro && !usage.canUse) {
    showUpgradeFn('pro', '--compliance', { stream });
    return null;
  }

  incrementUsageFn(configDir);

  // Extract requirements from the ticket description only — not from comments,
  // linked tickets, or the styled output, which would produce false positives.
  const requirements = extractRequirementsFn(description ?? brief);
  const { diff } = findLinkedCommitsFn(ticketKey, { cwd: process.cwd() });
  const analysis = analyzeDiffFn(requirements, diff);

  const s = createStyler({ isTTY: outStream.isTTY });
  const report = formatReport({ ticketKey, requirements, analysis, usage, isPro, s });
  const coveragePercent = analysis.coveragePercent;
  const missing = analysis.results
    .filter(r => r.status === 'NOT_FOUND')
    .map(r => r.requirement);
  const noCriteria = requirements.length === 0;

  if (isPro) {
    const gitEmail = execFn('git', ['config', 'user.email'], { encoding: 'utf8' }).stdout?.trim() ?? 'unknown';
    const commitSha = execFn('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout?.trim() ?? 'unknown';
    appendLedgerFn(
      { ticketKey, commitSha: commitSha || 'unknown', author: gitEmail || 'unknown', coverage: coveragePercent, missing, noCriteria },
      { configDir, isPro }
    );
  }

  return { report, results: analysis.results, coveragePercent, noCriteria };
}
