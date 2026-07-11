/**
 * Quick-start panel — shown after a successful ticketlens init, and reused
 * by the onboarding hub's exit summary when setup is ready. Extracted out of
 * init-wizard.mjs so both callers share one implementation.
 */

import { visLen } from './prompt-helpers.mjs';

export function printQuickStart({ stream, s }) {
  const bc = s.cyan;

  const cmds = [
    ['ticketlens triage',       'Scan your assigned tickets'],
    ['ticketlens <TICKET-KEY>', 'Fetch a specific ticket'],
    ['ticketlens switch',       'Switch active profile'],
    ['ticketlens --help',       'Full command reference'],
  ];
  const cmdWidth = cmds.reduce((max, [c]) => Math.max(max, c.length), 0);
  const cmdRows = cmds.map(([cmd, desc]) =>
    `  ${s.bold(s.cyan(cmd.padEnd(cmdWidth)))}   ${s.dim(desc)}`
  );
  const QTITLE = ' Quick start ';
  const contentWidth = cmdRows.reduce((max, r) => Math.max(max, visLen(r)), 0);
  const qWidth = Math.max(contentWidth + 2, QTITLE.length + 4);
  const qPad = (r) => ' ' + r + ' '.repeat(Math.max(0, qWidth - visLen(r) - 1));
  const qTitleFill = qWidth - 1 - QTITLE.length;
  stream.write(bc('╭') + bc('─') + s.bold(s.cyan(QTITLE)) + bc('─'.repeat(Math.max(0, qTitleFill))) + bc('╮') + '\n');
  stream.write(bc('│') + qPad('') + bc('│') + '\n');
  for (const r of cmdRows) stream.write(bc('│') + qPad(r) + bc('│') + '\n');
  stream.write(bc('│') + qPad('') + bc('│') + '\n');
  stream.write(bc('╰') + bc('─'.repeat(qWidth)) + bc('╯') + '\n\n');
}
