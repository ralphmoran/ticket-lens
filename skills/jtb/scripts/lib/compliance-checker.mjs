import { isLicensed, showUpgradePrompt } from './license.mjs';
import { checkUsage, incrementUsage, FREE_LIMIT } from './usage-tracker.mjs';
import { extractRequirements } from './requirement-extractor.mjs';
import { findLinkedCommits } from './commit-linker.mjs';
import { analyzeDiff } from './diff-analyzer.mjs';
import { DEFAULT_CONFIG_DIR } from './config.mjs';

const STATUS_ICON = { FOUND: '✔', PARTIAL: '~', NOT_FOUND: '✖' };

function formatReport({ ticketKey, requirements, analysis, usage, isPro }) {
  const { results, coveragePercent } = analysis;
  const lines = [
    '',
    `  Compliance Check — ${ticketKey}`,
    `  ${'─'.repeat(50)}`,
    '',
  ];

  if (requirements.length === 0) {
    lines.push('  No acceptance criteria found in ticket description.');
    lines.push('  Add a "Acceptance Criteria" section or Given/When/Then statements.');
    lines.push('');
    return lines.join('\n');
  }

  for (const { requirement, status, evidence } of results) {
    const icon = STATUS_ICON[status] ?? '?';
    lines.push(`  ${icon} ${requirement}`);
    if (evidence) lines.push(`      └─ ${evidence}`);
  }

  lines.push('');
  lines.push(`  Coverage: ${coveragePercent}%  (${results.filter(r => r.status === 'FOUND').length}/${results.length} requirements found)`);
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
  ticketKey,
  configDir = DEFAULT_CONFIG_DIR,
  stream = process.stderr,
  isLicensedFn       = isLicensed,
  showUpgradeFn      = showUpgradePrompt,
  checkUsageFn       = checkUsage,
  incrementUsageFn   = incrementUsage,
  extractRequirementsFn = extractRequirements,
  findLinkedCommitsFn   = findLinkedCommits,
  analyzeDiffFn         = analyzeDiff,
}) {
  const isPro = isLicensedFn('pro', configDir);
  const usage = checkUsageFn(configDir);

  if (!isPro && !usage.canUse) {
    showUpgradeFn('pro', '--compliance', { stream });
    return null;
  }

  incrementUsageFn(configDir);

  const requirements = extractRequirementsFn(brief);
  const { diff } = findLinkedCommitsFn(ticketKey, { cwd: process.cwd() });
  const analysis = analyzeDiffFn(requirements, diff);

  const report = formatReport({ ticketKey, requirements, analysis, usage, isPro });
  return { report, coveragePercent: analysis.coveragePercent };
}
