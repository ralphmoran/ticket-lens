import { writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, platform as osPlatform } from 'node:os';
import { spawnSync } from 'node:child_process';

const SCHEDULE_URL = 'https://api.ticketlens.io/v1/schedule';

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
  licenseKey,
  configDir,
  platform = osPlatform(),
  writeLocalJob = defaultWriteLocalJob,
  timeoutMs = 10_000,
}) {
  const { time, email, timezone } = answers;
  const [hourStr, minuteStr] = time.split(':');
  const hour = parseInt(hourStr, 10);
  const minute = parseInt(minuteStr, 10);

  const res = await fetcher(SCHEDULE_URL, {
    method: 'POST',
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${licenseKey}`,
    },
    body: JSON.stringify({ email, timezone, deliverAt: time }),
  });

  if (!res.ok) {
    const err = new Error(`Schedule API error ${res.status}`);
    err.status = res.status;
    throw err;
  }

  const data = await res.json();

  const ticketlensBin = resolveTicketlensBin();
  const content = platform === 'darwin'
    ? buildPlist({ hour, minute, ticketlensBin })
    : buildCronLine({ hour, minute, ticketlensBin });

  writeLocalJob(content, platform);

  return data;
}

export async function runScheduleStop({ fetcher = globalThis.fetch, licenseKey, platform = osPlatform() }) {
  const res = await fetcher(SCHEDULE_URL, {
    method: 'DELETE',
    signal: AbortSignal.timeout(10_000),
    headers: { 'Authorization': `Bearer ${licenseKey}` },
  });
  if (!res.ok) throw new Error(`Schedule API error ${res.status}`);

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

  process.stdout.write('✔ Digest schedule removed.\n');
}

export async function runScheduleStatus({ fetcher = globalThis.fetch, licenseKey }) {
  const res = await fetcher(SCHEDULE_URL, {
    method: 'GET',
    signal: AbortSignal.timeout(10_000),
    headers: { 'Authorization': `Bearer ${licenseKey}` },
  });
  if (!res.ok) {
    process.stdout.write('No active digest schedule found.\n');
    return;
  }
  const data = await res.json();
  process.stdout.write(`Digest schedule: ${data.deliverAt} ${data.timezone}\n`);
  process.stdout.write(`Last delivered:  ${data.lastDeliveredAt ?? 'never'}\n`);
  process.stdout.write(`Next delivery:   ${data.nextDelivery}\n`);
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
