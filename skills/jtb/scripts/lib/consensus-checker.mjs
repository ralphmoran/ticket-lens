/**
 * ticketlens compliance TICKET --consensus — thin client over POST /v1/consensus.
 *
 * Superseded local-BYOK version (0.38.48): read ~/.ticketlens/credentials.json,
 * called Anthropic/OpenAI/Groq directly from the CLI. Deprecated same session it
 * shipped — provider keys now live in the group-shared, dynamic AiProviderPool
 * registry (Console > Admin > AI Provider Pool / AI Roles), encrypted server-side
 * and never sent to the CLI, so the actual AI calls must happen on the backend.
 * The diff and requirements still only ever leave the machine to reach
 * TicketLens's own backend now (not straight to each vendor) — see
 * ConsensusController.php for the round-1/round-2/reconcile algorithm, a direct
 * port of what used to run here.
 */
import { isLicensed, showUpgradePrompt } from './license.mjs';
import { extractRequirements } from './requirement-extractor.mjs';
import { findLinkedCommits } from './commit-linker.mjs';
import { readCliToken } from './cli-auth.mjs';
import { apiBase } from './api-utils.mjs';
import { DEFAULT_CONFIG_DIR } from './config.mjs';
import { createStyler } from './ansi.mjs';
import { STATUS_ICON, statusColor, coverageColor } from './compliance-checker.mjs';

const ROLES_PATH = '/v1/ai-provider-roles';
const CONSENSUS_PATH = '/v1/consensus';
const ROLES_TIMEOUT_MS = 10_000;
const CONSENSUS_TIMEOUT_MS = 90_000; // two AI rounds across N providers — real work, not a quick API call

/** Interactive y/N cost-confirmation gate — same non-interactive fallback shape as confirmDestructive. */
async function confirmCost(providerCount, { stream = process.stderr, stdin = process.stdin } = {}) {
  if (!stdin.isTTY || !stdin.setRawMode) {
    stream.write('  Non-interactive mode: pass --yes/-y to run --consensus without a prompt.\n');
    return false;
  }
  stream.write(`  --consensus will run ${providerCount} AI review(s) via your team's provider pool. Continue?  y/N  `);
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

function formatConsensusReport({ ticketKey, results, perAgent, disagreedCount, s }) {
  const lines = [
    '',
    `  Consensus Compliance Check — ${s.brand(s.bold(ticketKey))}`,
    `  ${s.dim('─'.repeat(50))}`,
    `  ${s.dim(`${perAgent.length} agents: ${perAgent.map(a => a.title).join(', ')}`)}`,
    '',
  ];

  for (const { requirement, status } of results) {
    const icon = statusColor(status, s)(STATUS_ICON[status] ?? '?');
    lines.push(`  ${icon} ${requirement}`);
  }

  lines.push('');
  const found = results.filter(r => r.status === 'FOUND').length;
  const coveragePercent = Math.round(((found + results.filter(r => r.status === 'PARTIAL').length * 0.5) / results.length) * 100);
  lines.push(`  Coverage: ${coverageColor(coveragePercent, s)(`${coveragePercent}%`)}  (${found}/${results.length} requirements found)`);
  if (disagreedCount > 0) {
    lines.push(`  ${s.dim(`${disagreedCount} requirement(s) needed a refinement round (agents initially disagreed).`)}`);
  }
  lines.push('');
  lines.push(`  ${s.bold('Per-agent breakdown:')}`);
  for (const { title, verdicts, round1Verdicts } of perAgent) {
    const parts = verdicts.map((v, i) => (round1Verdicts[i] !== v ? `${round1Verdicts[i]}→${v}` : v));
    lines.push(`  ${s.dim(title)}: ${parts.join(', ')}`);
  }
  lines.push('');

  return { report: lines.join('\n'), coveragePercent };
}

async function fetchJson(url, { fetcher, timeoutMs, ...init }) {
  const res = await fetcher(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  let body = null;
  try { body = await res.json(); } catch { /* non-JSON error page — body stays null */ }
  return { ok: res.ok, status: res.status, body };
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
  cliToken,
  isLicensedFn = isLicensed,
  showUpgradeFn = showUpgradePrompt,
  extractRequirementsFn = extractRequirements,
  findLinkedCommitsFn = findLinkedCommits,
  confirmCostFn = confirmCost,
  readCliTokenFn = readCliToken,
  fetcher = globalThis.fetch,
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

  const token = cliToken ?? readCliTokenFn(configDir);
  if (!token) {
    stream.write('  ✖ --consensus requires a login. Run: ticketlens login\n');
    return null;
  }

  // Pre-flight: know the provider count before prompting for cost, and give a
  // specific, actionable error before ever touching /v1/consensus — the
  // backend re-validates all of this too, this is purely a faster/clearer UX path.
  const rolesRes = await fetchJson(`${apiBase()}${ROLES_PATH}`, {
    fetcher, timeoutMs: ROLES_TIMEOUT_MS,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  }).catch(err => ({ ok: false, status: 0, body: null, networkError: err }));

  if (!rolesRes.ok) {
    stream.write('  ✖ Could not reach TicketLens to check your consensus role. Try again, or check your connection.\n');
    return null;
  }

  const consensusRole = (rolesRes.body?.roles ?? []).find(r => r.kind === 'consensus');
  if (!consensusRole) {
    stream.write('  ✖ No consensus role configured. Set one up in Console > Admin > AI Providers.\n');
    return null;
  }
  if (consensusRole.providers.length < 2) {
    stream.write(`  ✖ Your consensus role needs at least 2 providers — currently has ${consensusRole.providers.length}. Add more in Console > Admin > AI Roles.\n`);
    return null;
  }

  if (!forceYes) {
    const proceed = await confirmCostFn(consensusRole.providers.length, { stream, stdin });
    if (!proceed) {
      stream.write('  Aborted — no request made.\n');
      return null;
    }
  }

  const { diff } = findLinkedCommitsFn(ticketKey, { cwd: process.cwd() });

  const runRes = await fetchJson(`${apiBase()}${CONSENSUS_PATH}`, {
    fetcher, timeoutMs: CONSENSUS_TIMEOUT_MS,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, Accept: 'application/json' },
    body: JSON.stringify({ ticketKey, diff, requirements }),
  }).catch(err => ({ ok: false, status: 0, body: null, networkError: err }));

  if (!runRes.ok) {
    const msg = runRes.body?.error
      ?? (runRes.networkError?.name === 'TimeoutError' ? 'Request timed out.' : runRes.networkError?.message)
      ?? `HTTP ${runRes.status}`;
    stream.write(`  ✖ ${msg}\n`);
    return null;
  }

  for (const warning of runRes.body.warnings ?? []) {
    stream.write(`  Warning: ${warning}\n`);
  }

  const { report, coveragePercent } = formatConsensusReport({
    ticketKey, results: runRes.body.results, perAgent: runRes.body.perAgent, disagreedCount: runRes.body.disagreedCount, s,
  });

  return { report, results: runRes.body.results, coveragePercent, noCriteria: false };
}
