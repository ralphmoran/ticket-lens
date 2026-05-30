import { writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, platform as osPlatform } from 'node:os';
import { spawnSync } from 'node:child_process';
import { red, green, yellow, cyan, bold, dim } from './ansi.mjs';
import { apiBase, warnIfInsecure } from './api-utils.mjs';

const SCHEDULE_PATH = '/v1/schedule';

// Safe path: printable ASCII, no shell metacharacters or XML special chars.
// Allows: letters, digits, /, ., _, -, ~, space (none of which are shell-special in this context).
const SAFE_PATH_RE = /^[A-Za-z0-9/._~-]+$/;

function xmlEscape(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function validateOutputFile(outputFile) {
  if (!outputFile || !SAFE_PATH_RE.test(outputFile)) {
    throw new Error(`Invalid output file path: must contain only letters, digits, /, ., _, -, ~ (no spaces or shell metacharacters)`);
  }
}

function validateTime(hour, minute) {
  if (!Number.isInteger(hour) || !Number.isInteger(minute) ||
      hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error(`Invalid time: hour must be 0–23, minute must be 0–59`);
  }
}

function parseHHMM(time) {
  const [hourStr, minuteStr] = time.split(':');
  return { hour: parseInt(hourStr, 10), minute: parseInt(minuteStr, 10) };
}

/**
 * Build a macOS LaunchAgent plist string.
 */
export function buildPlist({ hour, minute, ticketlensBin }) {
  validateTime(hour, minute);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>io.ticketlens.digest</string>
  <key>ProgramArguments</key>
  <array>
    <string>${ticketlensBin}</string>
    <string>triage</string>
    <string>--digest</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>${hour}</integer>
    <key>Minute</key>
    <integer>${minute}</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>/tmp/ticketlens-digest.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/ticketlens-digest.log</string>
</dict>
</plist>`;
}

/**
 * Build a crontab line for Linux.
 */
export function buildCronLine({ hour, minute, ticketlensBin }) {
  return `${minute} ${hour} * * * ${ticketlensBin} triage --digest >> /tmp/ticketlens-digest.log 2>&1`;
}

/**
 * Register a digest schedule with the backend and create a local cron/LaunchAgent job.
 */
export async function runScheduleWizard({
  answers,
  fetcher = globalThis.fetch,
  cliToken,
  configDir,
  platform = osPlatform(),
  writeLocalJob = defaultWriteLocalJob,
  timeoutMs = 10_000,
  print = s => process.stdout.write(s),
  warn = s => process.stderr.write(s),
}) {
  warnIfInsecure(apiBase(), warn);
  if (!cliToken) {
    print(`  ${red('✗')} schedule requires Console access. Run ${cyan('ticketlens login')} first.\n`);
    return { ok: false };
  }
  const { time, email, timezone } = answers;
  const { hour, minute } = parseHHMM(time);

  try {
    const res = await fetcher(`${apiBase()}${SCHEDULE_PATH}`, {
      method: 'POST',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cliToken}`,
      },
      body: JSON.stringify({ email, timezone, deliverAt: time }),
    });

    if (!res.ok) {
      if (res.status === 401) {
        print(`  ${red('✗')} Session expired. Run ${cyan('ticketlens login')} to reconnect.\n`);
        return { ok: false, status: 401 };
      }
      if (res.status === 403) {
        print(`  ${red('✗')} schedule requires a Pro license\n`);
        return { ok: false, status: 403 };
      }
      print(`  ${yellow('⚠')} Schedule API error (${res.status}) — try again later\n`);
      return { ok: false, status: res.status };
    }

    const data = await res.json();

    const ticketlensBin = resolveTicketlensBin();
    const content = platform === 'darwin'
      ? buildPlist({ hour, minute, ticketlensBin })
      : buildCronLine({ hour, minute, ticketlensBin });

    writeLocalJob(content, platform);

    return { ok: true, ...data };
  } catch {
    print(`  ${yellow('⚠')} Schedule API error (network error) — try again later\n`);
    return { ok: false };
  }
}

export async function runScheduleStop({
  fetcher = globalThis.fetch,
  cliToken,
  platform = osPlatform(),
  print = s => process.stdout.write(s),
  warn = s => process.stderr.write(s),
}) {
  warnIfInsecure(apiBase(), warn);
  if (!cliToken) {
    print(`  ${red('✗')} schedule requires Console access. Run ${cyan('ticketlens login')} first.\n`);
    return;
  }
  let res;
  try {
    res = await fetcher(`${apiBase()}${SCHEDULE_PATH}`, {
      method: 'DELETE',
      signal: AbortSignal.timeout(10_000),
      headers: { 'Authorization': `Bearer ${cliToken}` },
    });
  } catch {
    print(`  ${yellow('⚠')} Schedule API error (network error) — try again later\n`);
    return;
  }
  if (!res.ok) {
    print(`  ${yellow('⚠')} Schedule API error (${res.status}) — try again later\n`);
    return;
  }

  if (platform === 'darwin') {
    const plistPath = join(homedir(), 'Library', 'LaunchAgents', 'io.ticketlens.digest.plist');
    spawnSync('launchctl', ['unload', plistPath], { encoding: 'utf8' });
    try { unlinkSync(plistPath); } catch { /* already removed */ }
  } else {
    const existing = spawnSync('crontab', ['-l'], { encoding: 'utf8' }).stdout ?? '';
    // Remove both cloud-digest and local-save ticketlens cron lines
    const updated = existing.replace(/.*ticketlens triage --(digest|'--save=).*\n?/g, '');
    const tmp = `/tmp/ticketlens-crontab-${Date.now()}`;
    writeFileSync(tmp, updated, 'utf8');
    spawnSync('crontab', [tmp], { encoding: 'utf8' });
  }

  print(`\n  ${green('✔')} ${bold('Digest schedule removed.')}\n\n`);
}

export async function runScheduleStatus({
  fetcher = globalThis.fetch,
  cliToken,
  print = s => process.stdout.write(s),
  warn = s => process.stderr.write(s),
}) {
  warnIfInsecure(apiBase(), warn);
  if (!cliToken) {
    print(`  ${red('✗')} schedule requires Console access. Run ${cyan('ticketlens login')} first.\n`);
    return;
  }
  let res;
  try {
    res = await fetcher(`${apiBase()}${SCHEDULE_PATH}`, {
      method: 'GET',
      signal: AbortSignal.timeout(10_000),
      headers: { 'Authorization': `Bearer ${cliToken}` },
    });
  } catch {
    print(`  ${yellow('⚠')} Schedule API error (network error) — try again later\n`);
    return;
  }
  if (!res.ok) {
    print('  No active digest schedule found.\n');
    return;
  }
  const data = await res.json();
  print(`\n  ${green('✔')} ${bold('Active Digest Schedule')}\n\n`);
  print(`  ${dim('Time:         ')} ${cyan(data.deliverAt)}  ${dim(data.timezone)}\n`);
  print(`  ${dim('Last delivered:')} ${data.lastDeliveredAt ? cyan(data.lastDeliveredAt) : dim('never')}\n`);
  print(`  ${dim('Next delivery:')} ${cyan(data.nextDelivery)}\n`);
  print('\n');
}

/**
 * Build a local-only cron/plist entry that runs triage --save=FILE.
 * No cloud auth required — purely local scheduling.
 */
export function buildLocalPlist({ hour, minute, ticketlensBin, outputFile }) {
  const safeFile = xmlEscape(outputFile);
  const safeBin = xmlEscape(ticketlensBin);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>io.ticketlens.triage-local</string>
  <key>ProgramArguments</key>
  <array>
    <string>${safeBin}</string>
    <string>triage</string>
    <string>--save=${safeFile}</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>${hour}</integer>
    <key>Minute</key>
    <integer>${minute}</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>${safeFile}</string>
  <key>StandardErrorPath</key>
  <string>${safeFile}.err</string>
</dict>
</plist>`;
}

export function buildLocalCronLine({ hour, minute, ticketlensBin, outputFile }) {
  // Single-quote the --save argument to prevent shell word-splitting.
  // SAFE_PATH_RE already guarantees no single-quote chars in outputFile.
  return `${minute} ${hour} * * * ${ticketlensBin} triage '--save=${outputFile}' >> '${outputFile}.err' 2>&1`;
}

/**
 * Set up a local-only scheduled triage (no Console auth, no cloud push).
 * Writes a cron/LaunchAgent entry that runs `ticketlens triage --save=FILE`.
 */
export async function runScheduleLocal({
  answers,
  platform = osPlatform(),
  writeLocalJob = defaultWriteLocalJob,
  print = s => process.stdout.write(s),
  // fetcher is accepted but intentionally ignored — no network calls
}) {
  const { time, outputFile } = answers ?? {};
  if (!time || !outputFile) {
    print(`  ${red('✗')} Local schedule requires a time and output file.\n`);
    return { ok: false };
  }
  const { hour, minute } = parseHHMM(time);
  try {
    validateTime(hour, minute);
    validateOutputFile(outputFile);
  } catch (err) {
    print(`  ${red('✗')} ${err.message}\n`);
    return { ok: false };
  }

  const ticketlensBin = resolveTicketlensBin();
  const content = platform === 'darwin'
    ? buildLocalPlist({ hour, minute, ticketlensBin, outputFile })
    : buildLocalCronLine({ hour, minute, ticketlensBin, outputFile });

  writeLocalJob(content, platform);

  print(`\n  ${green('✔')} ${bold('Local triage scheduled')}\n`);
  print(`  ${dim('Time:   ')} ${cyan(time)} daily\n`);
  print(`  ${dim('Output: ')} ${cyan(outputFile)}\n\n`);

  return { ok: true, time, outputFile };
}

let _ticketlensBin;
function resolveTicketlensBin() {
  if (_ticketlensBin) return _ticketlensBin;
  const which = spawnSync('which', ['ticketlens'], { encoding: 'utf8' });
  _ticketlensBin = (which.status === 0 && which.stdout.trim())
    ? which.stdout.trim()
    : `${homedir()}/.npm/bin/ticketlens`;
  return _ticketlensBin;
}

function defaultWriteLocalJob(content, platform) {
  if (platform === 'darwin') {
    const launchAgentsDir = join(homedir(), 'Library', 'LaunchAgents');
    mkdirSync(launchAgentsDir, { recursive: true });
    const plistPath = join(launchAgentsDir, 'io.ticketlens.digest.plist');
    writeFileSync(plistPath, content, 'utf8');
    spawnSync('launchctl', ['load', plistPath], { encoding: 'utf8' });
  } else {
    const existing = spawnSync('crontab', ['-l'], { encoding: 'utf8' }).stdout ?? '';
    // Remove both cloud-digest and local-save ticketlens cron lines before re-adding
    const updated = existing.replace(/.*ticketlens triage --(digest|'--save=).*\n?/g, '').trimEnd() + '\n' + content + '\n';
    const tmp = `/tmp/ticketlens-crontab-${Date.now()}`;
    writeFileSync(tmp, updated, 'utf8');
    spawnSync('crontab', [tmp], { encoding: 'utf8' });
  }
}
