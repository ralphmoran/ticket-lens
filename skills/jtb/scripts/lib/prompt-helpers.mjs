/**
 * Shared interactive prompt helpers for wizard flows.
 * Used by init-wizard.mjs and config-wizard.mjs.
 */

import { createInterface } from 'node:readline';
import { createStyler } from './ansi.mjs';

export const ANSI_RE = /\x1b\[[0-9;]*m/g;
export const visLen = (str) => str.replace(ANSI_RE, '').length;

/**
 * Discards any bytes already sitting in stdin's internal buffer, plus any
 * still in flight at the OS file-descriptor level.
 *
 * A raw-mode prompt (promptYN, promptSecret, runRawSelect) consumes exactly
 * one `data` chunk then calls stdin.pause() — which stops Node from polling
 * the fd at all. If the user's keystrokes arrive as two separate chunks
 * (e.g. "n" then a separate Enter — natural habit, even though Enter isn't
 * required here), the second one almost always arrives *after* pause() has
 * already run (human reaction time dwarfs a JS tick), so it never reaches
 * Node's internal buffer — a plain `.read()` drain finds nothing. It sits
 * unread at the fd until the *next* raw-mode prompt calls resume(), at
 * which point it's delivered as that prompt's first event, auto-confirming
 * whatever's pre-selected before the user ever sees the prompt.
 *
 * Fix: resume() to reactivate fd polling, then yield to setImmediate (which
 * runs in the "check" phase, after the event loop's "poll" phase — so any
 * byte already pending at the fd gets pulled into Node's buffer first),
 * then drain. Call this — and await it — before starting any new raw-mode
 * prompt.
 */
export function flushStdin(stdin = process.stdin) {
  return new Promise((resolve) => {
    if (typeof stdin.read !== 'function' || typeof stdin.resume !== 'function') {
      resolve();
      return;
    }
    const wasPaused = typeof stdin.isPaused === 'function' ? stdin.isPaused() : true;
    stdin.resume();
    setImmediate(() => {
      while (stdin.read() !== null) { /* discard */ }
      if (wasPaused) stdin.pause();
      resolve();
    });
  });
}

export const SERVER_AUTH_TYPES = [
  { label: 'PAT  (personal access token)', sublabel: 'Jira Server/DC 8.14+', value: 'pat' },
  { label: 'Basic  (username + password)', sublabel: 'Jira Server/DC older versions', value: 'basic' },
];

/**
 * Text prompt. If `defaultValue` is provided, empty input keeps it (shown as [current: …]).
 */
export async function promptText(label, { validate, defaultValue = '', stream = process.stderr } = {}) {
  const s = createStyler({ isTTY: stream.isTTY });
  while (true) {
    const raw = await new Promise(res => {
      const rl = createInterface({ input: process.stdin, output: stream });
      rl.question(`  ${label}  `, (a) => { rl.close(); res(a.trim()); });
    });
    const answer = raw || defaultValue;
    if (validate) {
      const err = validate(answer);
      if (err) { stream.write(`  ${s.red('✖')} ${err}\n`); continue; }
    }
    return answer;
  }
}

/**
 * Masked password prompt. If `existingValue` is provided, Enter with no input keeps it.
 */
export async function promptSecret(label, { stream = process.stderr, existingValue = '' } = {}) {
  const s = createStyler({ isTTY: stream.isTTY });
  while (true) {
    stream.write(`  ${label}  `);
    await flushStdin();
    const value = await new Promise(res => {
      let buf   = '';
      let stars = 0; // visual asterisk count — may differ from buf.length after a paste
      const stdin = process.stdin;
      stdin.setRawMode(true);
      stdin.resume();
      stdin.setEncoding('utf8');
      function onData(chunk) {
        if (chunk === '\r' || chunk === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener('data', onData);
          stream.write('\n');
          res(buf);
        } else if (chunk === '\x7f' || chunk === '\x08') {
          if (buf.length > 0) {
            buf = buf.slice(0, -1);
            if (stars > 0) { stars--; stream.write('\b \b'); }
          }
        } else if (chunk === '\x03') {
          process.exit(0);
        } else {
          buf   += chunk;
          stars += chunk.length;
          stream.write('*'.repeat(chunk.length));
        }
      }
      stdin.on('data', onData);
    });
    if (!value) {
      if (existingValue) return existingValue; // Enter = keep existing
      stream.write(`  ${s.red('✖')} Cannot be empty.\n`);
      continue;
    }
    return value;
  }
}

/**
 * Gather schedule wizard answers interactively.
 * Returns { time, email, timezone }.
 */
export async function promptScheduleAnswers(args = [], { stream = process.stderr } = {}) {
  // Allow pre-filling via flags: --time=07:00 --email=dev@example.com --timezone=UTC
  const timeArg  = args.find(a => a.startsWith('--time='))?.split('=')[1];
  const emailArg = args.find(a => a.startsWith('--email='))?.split('=')[1];
  const tzArg    = args.find(a => a.startsWith('--timezone='))?.split('=')[1];

  const s = createStyler({ isTTY: stream.isTTY });

  // ── Header box ─────────────────────────────────────────────────────────────
  const headerLines = [
    `${s.bold(s.cyan('◆ TicketLens'))} — Digest Schedule`,
    s.dim('Configure your daily triage digest delivery.'),
  ];
  const innerWidth = headerLines.reduce((max, l) => Math.max(max, visLen(l)), 0) + 4;
  const bc = s.cyan;
  stream.write('\n');
  stream.write(bc('╭' + '─'.repeat(innerWidth) + '╮') + '\n');
  for (const line of headerLines) {
    const pad = innerWidth - 2 - visLen(line);
    stream.write(bc('│') + ' ' + line + ' '.repeat(Math.max(0, pad)) + bc('│') + '\n');
  }
  stream.write(bc('╰' + '─'.repeat(innerWidth) + '╯') + '\n');
  stream.write('\n');

  const sysTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const time = timeArg ?? await promptText(
    s.dim('Delivery time') + s.dim('  (HH:MM, 24h):'),
    { stream, validate: (v) => /^\d{1,2}:\d{2}$/.test(v) ? null : 'Enter time as HH:MM (e.g. 07:00)' },
  );

  const email = emailArg ?? await promptText(
    s.dim('Delivery email:'),
    { stream, validate: (v) => v.includes('@') ? null : 'Enter a valid email address' },
  );

  const timezone = tzArg ?? await promptText(
    s.dim('Timezone') + s.dim(`  [${sysTimezone}]:`),
    { stream, defaultValue: sysTimezone },
  );

  stream.write('\n');

  return { time, email, timezone };
}

/**
 * Three-way single-keystroke prompt: y / n / anything else counts as skip.
 * Used for the Recall "is this pulling its weight?" pulse check.
 *
 * @returns {Promise<'y'|'n'|'skip'>}
 */
export function promptRecallPulse(question, { stream = process.stderr } = {}) {
  const s = createStyler({ isTTY: stream.isTTY });
  stream.write(`\n  ${question}  ${s.dim('y/n/skip')}  `);
  return flushStdin().then(() => new Promise(res => {
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    function onData(char) {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      stream.write('\n');
      if (char === '\x03') process.exit(0);
      if (char === 'y' || char === 'Y') { res('y'); return; }
      if (char === 'n' || char === 'N') { res('n'); return; }
      res('skip');
    }
    stdin.on('data', onData);
  }));
}

export function promptYN(question, { stream = process.stderr } = {}) {
  const s = createStyler({ isTTY: stream.isTTY });
  stream.write(`\n  ${question}  ${s.dim('y/N')}  `);
  return flushStdin().then(() => new Promise(res => {
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    function onData(char) {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      stream.write('\n');
      if (char === '\x03') process.exit(0);
      res(char === 'y' || char === 'Y');
    }
    stdin.on('data', onData);
  }));
}
