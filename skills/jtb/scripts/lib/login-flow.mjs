/**
 * ticketlens login — connect the CLI to a TicketLens account.
 * Extracted out of bin/ticketlens.mjs so the onboarding hub can reuse it
 * without duplicating the browser/manual flow or token verification.
 */

import { createStyler } from './ansi.mjs';
import { promptSecret } from './prompt-helpers.mjs';
import { browserLogin } from './browser-login.mjs';
import { saveCliToken } from './cli-auth.mjs';
import { getApiBase, getConsoleBase } from './sync.mjs';
import { applyTeamConfigOnLogin } from './team-jira-sync.mjs';

export async function runLogin({
  manual = false,
  stream = process.stderr,
  browserLoginFn = browserLogin,
  fetchFn = globalThis.fetch,
  promptSecretFn = promptSecret,
  saveCliTokenFn = saveCliToken,
  applyTeamConfigOnLoginFn = applyTeamConfigOnLogin,
} = {}) {
  const s = createStyler({ isTTY: stream.isTTY });

  let token;

  if (manual) {
    // ── manual paste flow (CI / headless environments) ──────────────────
    stream.write(`\n  ${s.bold('TicketLens Login')}\n`);
    stream.write(`  ${s.dim('─'.repeat(44))}\n`);
    stream.write(`  ${s.dim(`Generate a CLI token at ${s.cyan(`${getConsoleBase()}/console/account`)}`)}\n`);
    stream.write(`  ${s.dim('then paste it below.')}\n\n`);

    token = await promptSecretFn(`CLI Token ${s.dim('(tl_…)')}:`, { stream });
    if (!token.startsWith('tl_')) {
      stream.write(`  ${s.red('✖')} Token must start with ${s.dim('tl_')}\n`);
      process.exitCode = 1;
      return;
    }
  } else {
    // ── browser flow (default) ────────────────────────────────────────
    stream.write(`\n  ${s.bold('TicketLens Login')}\n`);
    stream.write(`  ${s.dim('─'.repeat(44))}\n`);
    stream.write(`  Opening browser to authorize…\n\n`);
    stream.write(`  ${s.dim('○ Waiting for authorization (120s)…')}\n`);

    try {
      token = await browserLoginFn();
    } catch (err) {
      const cancelled = err.message === 'Authorization cancelled';
      stream.write(`\x1b[A\r\x1b[2K  ${s.red('✖')} ${cancelled ? 'Login cancelled.' : err.message}\n`);
      if (!cancelled) {
        stream.write(`\n  ${s.dim(`Try ${s.cyan('ticketlens login --manual')} to paste a token instead.`)}\n\n`);
      }
      process.exitCode = cancelled ? 0 : 1;
      return;
    }
  }

  // ── verify token against API (both flows) ─────────────────────────
  stream.write(`\n  ${s.dim('○ Verifying token…')}\n`);
  let res;
  try {
    res = await fetchFn(`${getApiBase()}/v1/profiles`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    stream.write(`\x1b[A\r\x1b[2K  ${s.red('✖')} Could not reach ${getApiBase()} — check your connection.\n`);
    process.exitCode = 1;
    return;
  }

  if (res.status === 401) {
    stream.write(`\x1b[A\r\x1b[2K  ${s.red('✖')} Invalid token — check the value and try again.\n`);
    process.exitCode = 1;
    return;
  }
  if (!res.ok) {
    stream.write(`\x1b[A\r\x1b[2K  ${s.red('✖')} Server returned ${res.status}. Try again later.\n`);
    process.exitCode = 1;
    return;
  }

  saveCliTokenFn(token);
  stream.write(`\x1b[A\r\x1b[2K  ${s.green('✔')} Logged in.\n`);

  // Flow 1: pull team Jira config for Pro/Team members (silently skipped for Free)
  const tcLogin = await applyTeamConfigOnLoginFn().catch(() => null);
  if (tcLogin?.ok) {
    stream.write(`  ${s.dim(`○ Team Jira config applied for ${s.cyan(tcLogin.groupName)}.`)}\n`);
  }

  stream.write(`\n  Run ${s.cyan('ticketlens sync')} to pull your connections.\n\n`);
}
