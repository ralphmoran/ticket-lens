import { computeResponseMetrics, DEFAULT_CONFIG_DIR } from './triage-history.mjs';
import { loadProfiles } from './profile-resolver.mjs';
import { isLicensed as defaultIsLicensed } from './license.mjs';
import { createStyler } from './ansi.mjs';
import { handleUnknownFlags } from './arg-validator.mjs';
import { printStatsHelp } from './help.mjs';

const FREE_DAYS_CAP = 7;
const MAX_DAYS = 30;

export async function runStats(args = [], opts = {}) {
  const print     = opts.print            ?? ((s) => process.stdout.write(s));
  const warn      = opts.warn             ?? ((s) => process.stderr.write(s));
  const configDir = opts.configDir        ?? DEFAULT_CONFIG_DIR;
  const isLic     = opts.isLicensed       ?? defaultIsLicensed;
  const calcMetrics = opts.metricsCalculator ?? computeResponseMetrics;

  if (args.includes('--help') || args.includes('-h')) {
    printStatsHelp();
    return;
  }

  const validated = await handleUnknownFlags(
    args,
    ['--help', '-h', '--profile=', '--days=', '--format='],
    { hints: [] },
  );
  if (validated === null) { process.exitCode = 1; return; }

  const profileArg = args.find(a => a.startsWith('--profile='));
  const daysArg    = args.find(a => a.startsWith('--days='));
  const formatArg  = args.find(a => a.startsWith('--format='));

  const format = formatArg ? formatArg.split('=')[1] : 'plain';
  if (format !== 'plain' && format !== 'json') {
    warn(`Error: --format must be plain or json, got: ${format}\n`);
    process.exitCode = 1;
    return;
  }

  const rawDays = daysArg ? daysArg.split('=')[1] : '7';
  const parsedDays = parseInt(rawDays, 10);
  if (isNaN(parsedDays) || parsedDays < 1 || parsedDays > MAX_DAYS) {
    warn(`Error: --days must be between 1 and ${MAX_DAYS}, got: ${rawDays}\n`);
    process.exitCode = 1;
    return;
  }

  // Free tier: silently cap at 7 days
  const isPro = isLic('pro', configDir);
  const days  = (!isPro && parsedDays > FREE_DAYS_CAP) ? FREE_DAYS_CAP : parsedDays;

  // Resolve profile name
  let profile = profileArg ? profileArg.split('=')[1] : null;
  if (!profile) {
    const config = loadProfiles(configDir);
    profile = config?.default ?? 'default';
  }

  let metrics;
  try {
    metrics = calcMetrics(profile, { days, configDir });
  } catch (err) {
    warn(`Error: Could not compute stats for profile "${profile}": ${err.message}\n`);
    process.exitCode = 1;
    return;
  }

  if (format === 'json') {
    print(JSON.stringify({ profile, ...metrics }, null, 2) + '\n');
    return;
  }

  const isTTY = process.stdout.isTTY;
  const s = createStyler({ isTTY });

  if (metrics.triageRunCount === 0) {
    print(`\n  ${s.dim('No triage history found for profile')} ${s.bold(profile)}.\n`);
    print(`  ${s.dim('Run')} ${s.cyan('ticketlens triage')} ${s.dim('at least twice to generate stats.')}\n\n`);
    return;
  }

  const fmtH   = (h) => h != null ? `${h.toFixed(1)}h` : '—';
  const fmtPct = (r) => r != null ? `${Math.round(r * 100)}%` : '—';
  const fmtTrend = (t) => {
    if (t == null) return '';
    const abs = Math.abs(t).toFixed(1);
    return t > 0
      ? s.dim(`  ↑ +${abs}h vs prior week`)
      : s.dim(`  ↓ -${abs}h vs prior week`);
  };

  const W = 52;
  const bar = s.dim('─'.repeat(W));
  const dayLabel = `last ${days} day${days === 1 ? '' : 's'}`;

  print('\n');
  print(`${bar}\n`);
  print(`  ${s.bold('Response Metrics')} ${s.dim(`(${dayLabel})`)}\n`);
  print(`${bar}\n`);
  print(`  Avg response time    ${s.bold(s.cyan(fmtH(metrics.avgResponseHours)))}${fmtTrend(metrics.trendHours)}\n`);
  print(`  Median response time ${s.bold(fmtH(metrics.medianResponseHours))}\n`);
  print(`  Clear rate           ${s.bold(fmtPct(metrics.clearRate))}  ${s.dim('(resolved within 24h)')}\n`);
  print(`  Triage runs          ${s.bold(String(metrics.triageRunCount))} ${s.dim(`of ${days} days`)}\n`);

  if (metrics.currentUrgency) {
    const u = metrics.currentUrgency;
    print(`${bar}\n`);
    print(`  ${s.bold('Right now')}\n`);
    print(`${bar}\n`);
    if (u.needsResponse > 0) print(`  ${s.red('needs-response')}  ${s.bold(String(u.needsResponse))}\n`);
    if (u.aging > 0)         print(`  ${s.yellow('aging')}           ${s.bold(String(u.aging))}\n`);
    print(`  ${s.green('clear')}           ${s.bold(String(u.clear))}\n`);
  }

  if (!isPro) {
    print(`${bar}\n`);
    print(`  ${s.dim('💡 Pro unlocks --days up to 30 days · $9/mo →')} ${s.cyan('ticketlens.dev')}\n`);
  }

  print('\n');
}
