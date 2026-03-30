/**
 * Shared interactive prompt helpers for wizard flows.
 * Used by init-wizard.mjs and config-wizard.mjs.
 */

import { createInterface } from 'node:readline';
import { createStyler } from './ansi.mjs';

export const ANSI_RE = /\x1b\[[0-9;]*m/g;
export const visLen = (str) => str.replace(ANSI_RE, '').length;

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
    const value = await new Promise(res => {
      let buf = '';
      const stdin = process.stdin;
      stdin.setRawMode(true);
      stdin.resume();
      stdin.setEncoding('utf8');
      function onData(char) {
        if (char === '\r' || char === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener('data', onData);
          stream.write('\n');
          res(buf);
        } else if (char === '\x7f' || char === '\x08') {
          if (buf.length > 0) { buf = buf.slice(0, -1); stream.write('\b \b'); }
        } else if (char === '\x03') {
          process.exit(0);
        } else {
          buf += char;
          stream.write('*');
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
  const timeArg = args.find(a => a.startsWith('--time='))?.split('=')[1];
  const emailArg = args.find(a => a.startsWith('--email='))?.split('=')[1];
  const tzArg = args.find(a => a.startsWith('--timezone='))?.split('=')[1];

  const time = timeArg ?? await promptText('Delivery time (HH:MM, 24h):', {
    stream,
    validate: (v) => /^\d{1,2}:\d{2}$/.test(v) ? null : 'Enter time as HH:MM (e.g. 07:00)',
  });

  const email = emailArg ?? await promptText('Delivery email:', {
    stream,
    validate: (v) => v.includes('@') ? null : 'Enter a valid email address',
  });

  const timezone = tzArg ?? await promptText('Timezone (e.g. America/New_York):', {
    stream,
    defaultValue: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });

  return { time, email, timezone };
}

export function promptYN(question, { stream = process.stderr } = {}) {
  const s = createStyler({ isTTY: stream.isTTY });
  stream.write(`\n  ${question}  ${s.dim('y/N')}  `);
  return new Promise(res => {
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
  });
}
