import { writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, platform as osPlatform } from 'node:os';
import { spawnSync } from 'node:child_process';
import { red, green, yellow, cyan, bold, dim } from './ansi.mjs';
import { apiBase, warnIfInsecure } from './api-utils.mjs';

const SCHEDULE_PATH = '/v1/schedule';

/**
 * Build a macOS LaunchAgent plist string.
 */
export function buildPlist({ hour, minute, ticketlensBin }) {
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    throw new Error('hour and minute must be integers');
  }
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
  const [hourStr, minuteStr] = time.split(':');
  const hour = parseInt(hourStr, 10);
  const minute = parseInt(minuteStr, 10);

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
    const updated = existing.replace(/.*ticketlens triage --digest.*\n?/g, '');
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

function resolveTicketlensBin() {
  const which = spawnSync('which', ['ticketlens'], { encoding: 'utf8' });
  if (which.status === 0 && which.stdout.trim()) return which.stdout.trim();
  return `${homedir()}/.npm/bin/ticketlens`;
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
    const updated = existing.replace(/.*ticketlens triage --digest.*/g, '').trimEnd() + '\n' + content + '\n';
    const tmp = `/tmp/ticketlens-crontab-${Date.now()}`;
    writeFileSync(tmp, updated, 'utf8');
    spawnSync('crontab', [tmp], { encoding: 'utf8' });
  }
}
