import { isLicensed, showUpgradePrompt } from './license.mjs';
import { extractRequirements } from './requirement-extractor.mjs';
import { findLinkedCommits } from './commit-linker.mjs';
import { loadCredentials } from './profile-resolver.mjs';
import { summarize } from './summarizer.mjs';
import { DEFAULT_CONFIG_DIR } from './config.mjs';
import { createStyler } from './ansi.mjs';
import { STATUS_ICON, statusColor, coverageColor } from './compliance-checker.mjs';
import { scanForSecrets } from './secret-scanner.mjs';

const PROVIDER_ORDER = ['anthropic', 'openai', 'groq'];
const PROVIDER_KEY_FIELD = { anthropic: 'anthropicApiKey', openai: 'openaiApiKey', groq: 'groqApiKey' };
// Lower = stricter (less coverage claimed). Drives tie-break in reconcileRequirement.
const STRICTNESS = { NOT_FOUND: 0, PARTIAL: 1, FOUND: 2 };
const MAX_TOKENS = 512;
// Each "requirement text | STATUS" response line runs ~20-40 tokens — scale the
// floor up for tickets with many acceptance criteria so the model's per-requirement
// list doesn't get cut off mid-response (a truncated response silently reads as
// NOT_FOUND for every unparsed requirement via parseVerdicts, not as an error).
const TOKENS_PER_REQUIREMENT = 40;

export function getConfiguredProviders(credentials) {
  if (!credentials) return [];
  return PROVIDER_ORDER.filter(p => !!credentials[PROVIDER_KEY_FIELD[p]]);
}

/** Ports ComplianceController::parseAnalysis's line-matching convention to JS. */
export function parseVerdicts(requirements, rawAnalysis) {
  const lines = (rawAnalysis ?? '').split('\n');
  return requirements.map(req => {
    const needle = req.slice(0, 20).toLowerCase();
    let status = 'NOT_FOUND';
    for (const line of lines) {
      if (!line.toLowerCase().includes(needle)) continue;
      const upper = line.toUpperCase();
      if (upper.includes('PARTIAL')) status = 'PARTIAL';
      else if (upper.includes('FOUND') && !upper.includes('NOT_FOUND')) status = 'FOUND';
      break;
    }
    return status;
  });
}

/** Majority vote across agents' final verdicts for one requirement; ties go to the stricter verdict. */
export function reconcileRequirement(verdicts) {
  const counts = new Map();
  for (const v of verdicts) counts.set(v, (counts.get(v) ?? 0) + 1);
  const maxCount = Math.max(...counts.values());
  const topStatuses = [...counts.entries()].filter(([, c]) => c === maxCount).map(([status]) => status);
  if (topStatuses.length === 1) return topStatuses[0];
  return topStatuses.reduce((strictest, s) => (STRICTNESS[s] < STRICTNESS[strictest] ? s : strictest));
}

function buildRound1Prompt(diff, requirements) {
  return 'You are a compliance checker. Given this code diff, evaluate whether each requirement listed is addressed.\n\n'
    + `Diff:\n${diff || '(no diff available)'}\n\n`
    + 'Requirements to check:\n'
    + requirements.map(r => `- ${r}`).join('\n')
    + "\n\nFor each requirement, respond with: FOUND, PARTIAL, or NOT_FOUND. One per line, format: '<requirement> | <status>'.";
}

function buildRound2Prompt(diff, disagreedItems, selfProvider, successful1) {
  const peers = successful1.filter(r => r.provider !== selfProvider);
  const lines = [
    'You previously reviewed a code diff against a set of requirements. Other independent',
    'reviewers disagreed with you on some items below. Reconsider only these, in light of',
    "their assessments, and respond again in the same format.",
    '',
    `Diff:\n${diff || '(no diff available)'}`,
    '',
  ];
  for (const { requirement, index } of disagreedItems) {
    lines.push(`Requirement: ${requirement}`);
    peers.forEach((peer, i) => lines.push(`  Reviewer ${i + 1} said: ${peer.verdicts[index]}`));
    lines.push('');
  }
  lines.push("For each requirement above, respond with: FOUND, PARTIAL, or NOT_FOUND. One per line, format: '<requirement> | <status>'.");
  return lines.join('\n');
}

/** Interactive y/N cost-confirmation gate — same non-interactive fallback shape as confirmDestructive. */
async function confirmCost(providerCount, { stream = process.stderr, stdin = process.stdin } = {}) {
  if (!stdin.isTTY || !stdin.setRawMode) {
    stream.write('  Non-interactive mode: pass --yes/-y to run --consensus without a prompt.\n');
    return false;
  }
  stream.write(`  --consensus will make ${providerCount} AI API call(s) using your configured keys. Continue?  y/N  `);
  return new Promise(resolve => {
    stdin.setRawMode(true);
    stdin.resume();
    stdin.once('data', buf => {
      stdin.setRawMode(false);
      stdin.pause();
      const confirmed = buf.toString().toLowerCase() === 'y';
      stream.write(confirmed ? 'y\n' : 'N\n');
      resolve(confirmed);
    });
  });
}

function formatNoCriteriaReport(ticketKey, s) {
  return [
    '',
    `  Consensus Compliance Check — ${s.brand(s.bold(ticketKey))}`,
    `  ${s.dim('─'.repeat(50))}`,
    '',
    '  No acceptance criteria found in ticket description.',
    '  Add a "Acceptance Criteria" section or Given/When/Then statements.',
    '',
  ].join('\n');
}

function formatConsensusReport({ ticketKey, results, coveragePercent, finalVerdictsByAgent, disagreedCount, s }) {
  const lines = [
    '',
    `  Consensus Compliance Check — ${s.brand(s.bold(ticketKey))}`,
    `  ${s.dim('─'.repeat(50))}`,
    `  ${s.dim(`${finalVerdictsByAgent.length} agents: ${finalVerdictsByAgent.map(a => a.provider).join(', ')}`)}`,
    '',
  ];

  for (const { requirement, status } of results) {
    const icon = statusColor(status, s)(STATUS_ICON[status] ?? '?');
    lines.push(`  ${icon} ${requirement}`);
  }

  lines.push('');
  const found = results.filter(r => r.status === 'FOUND').length;
  lines.push(`  Coverage: ${coverageColor(coveragePercent, s)(`${coveragePercent}%`)}  (${found}/${results.length} requirements found)`);
  if (disagreedCount > 0) {
    lines.push(`  ${s.dim(`${disagreedCount} requirement(s) needed a refinement round (agents initially disagreed).`)}`);
  }
  lines.push('');
  lines.push(`  ${s.bold('Per-agent breakdown:')}`);
  for (const { provider, verdicts, round1Verdicts } of finalVerdictsByAgent) {
    const parts = verdicts.map((v, i) => (round1Verdicts[i] !== v ? `${round1Verdicts[i]}→${v}` : v));
    lines.push(`  ${s.dim(provider)}: ${parts.join(', ')}`);
  }
  lines.push('');

  return lines.join('\n');
}

export async function runConsensusCheck({
  brief,
  description = null,
  ticketKey,
  configDir = DEFAULT_CONFIG_DIR,
  stream = process.stderr,
  outStream = process.stdout,
  forceYes = false,
  stdin = process.stdin,
  isLicensedFn = isLicensed,
  showUpgradeFn = showUpgradePrompt,
  extractRequirementsFn = extractRequirements,
  findLinkedCommitsFn = findLinkedCommits,
  loadCredentialsFn = loadCredentials,
  summarizeFn = summarize,
  confirmCostFn = confirmCost,
  scanForSecretsFn = scanForSecrets,
}) {
  if (!isLicensedFn('pro', configDir)) {
    showUpgradeFn('pro', '--consensus', { stream });
    return null;
  }

  const requirements = extractRequirementsFn(description ?? brief);
  const s = createStyler({ isTTY: outStream.isTTY });

  if (requirements.length === 0) {
    return { report: formatNoCriteriaReport(ticketKey, s), results: [], coveragePercent: 0, noCriteria: true };
  }

  const { diff } = findLinkedCommitsFn(ticketKey, { cwd: process.cwd() });

  // --consensus is the only compliance path that sends the diff off-machine (to each
  // configured AI vendor directly) — scan it before anything else touches the network,
  // the same gate note-command.mjs applies to Recall note bodies before they leave the vault.
  const scan = scanForSecretsFn({ body: diff ?? '' });
  if (scan.rejected) {
    stream.write(`  ✖ --consensus blocked — the diff looks like it contains a secret: ${scan.reasons.join(' ')}\n`);
    return null;
  }
  for (const warning of scan.warnings) {
    stream.write(`  Warning: ${warning}\n`);
  }

  const credentials = loadCredentialsFn(configDir);
  const providers = getConfiguredProviders(credentials);
  if (providers.length < 2) {
    stream.write(
      '  ✖ --consensus needs at least 2 configured AI providers. Configure with: ' +
      'ticketlens cloud-keys add <provider> <key>, or add anthropicApiKey/openaiApiKey/groqApiKey ' +
      'to ~/.ticketlens/credentials.json.\n'
    );
    return null;
  }

  if (!forceYes) {
    const proceed = await confirmCostFn(providers.length, { stream, stdin });
    if (!proceed) {
      stream.write('  Aborted — no API calls made.\n');
      return null;
    }
  }

  const round1Prompt = buildRound1Prompt(diff, requirements);
  const round1MaxTokens = Math.max(MAX_TOKENS, requirements.length * TOKENS_PER_REQUIREMENT);

  const round1 = await Promise.all(providers.map(async provider => {
    try {
      const raw = await summarizeFn({ mode: 'byok', credentials, provider, prompt: round1Prompt, brief: '', maxTokens: round1MaxTokens });
      return { provider, verdicts: parseVerdicts(requirements, raw), error: null };
    } catch (err) {
      return { provider, verdicts: null, error: err.message };
    }
  }));

  const successful1 = round1.filter(r => !r.error);
  if (successful1.length < 2) {
    stream.write(`  ✖ Only ${successful1.length} provider(s) responded successfully — need at least 2 for consensus.\n`);
    for (const r of round1) if (r.error) stream.write(`    ${r.provider}: ${r.error}\n`);
    return null;
  }

  const disagreedIndexes = requirements
    .map((_, i) => i)
    .filter(i => new Set(successful1.map(r => r.verdicts[i])).size > 1);

  let round2 = [];
  if (disagreedIndexes.length > 0) {
    const disagreedItems = disagreedIndexes.map(i => ({ requirement: requirements[i], index: i }));
    const round2MaxTokens = Math.max(MAX_TOKENS, disagreedItems.length * TOKENS_PER_REQUIREMENT);
    round2 = await Promise.all(successful1.map(async ({ provider }) => {
      const prompt = buildRound2Prompt(diff, disagreedItems, provider, successful1);
      try {
        const raw = await summarizeFn({ mode: 'byok', credentials, provider, prompt, brief: '', maxTokens: round2MaxTokens });
        const refined = parseVerdicts(disagreedItems.map(d => d.requirement), raw);
        return { provider, refined: Object.fromEntries(disagreedItems.map((d, idx) => [d.index, refined[idx]])) };
      } catch (err) {
        stream.write(`  ⚠ ${provider}: refinement round failed (${err.message}) — keeping its round-1 verdict.\n`);
        return { provider, refined: {} }; // degrade — keep the round-1 verdict for this agent
      }
    }));
  }

  const finalVerdictsByAgent = successful1.map(r1 => {
    const r2 = round2.find(r => r.provider === r1.provider);
    return {
      provider: r1.provider,
      round1Verdicts: r1.verdicts,
      verdicts: requirements.map((_, i) => r2?.refined[i] ?? r1.verdicts[i]),
    };
  });

  const results = requirements.map((requirement, i) => ({
    requirement,
    status: reconcileRequirement(finalVerdictsByAgent.map(a => a.verdicts[i])),
    evidence: null,
  }));

  const found = results.filter(r => r.status === 'FOUND').length;
  const partial = results.filter(r => r.status === 'PARTIAL').length;
  const coveragePercent = Math.round(((found + partial * 0.5) / results.length) * 100);

  const report = formatConsensusReport({
    ticketKey, results, coveragePercent, finalVerdictsByAgent, disagreedCount: disagreedIndexes.length, s,
  });

  return { report, results, coveragePercent, noCriteria: false };
}
