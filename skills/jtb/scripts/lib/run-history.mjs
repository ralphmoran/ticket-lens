import { queryTicketHistory, DEFAULT_CONFIG_DIR } from './triage-history.mjs';
import { isLicensed as defaultIsLicensed, showUpgradePrompt } from './license.mjs';
import { createStyler } from './ansi.mjs';
import { printHistoryHelp } from './help.mjs';

/**
 * Prints a ticket's local triage-history timeline. Extracted from
 * bin/ticketlens.mjs's inline 'history' case so the MCP `history` tool has
 * a CLI-layer function to wrap, same as every other MCP tool (see
 * mcp-server.mjs's file header). Read-only, entirely local — no network call.
 */
export async function runHistory(args = [], opts = {}) {
  const print   = opts.print         ?? ((s) => process.stdout.write(s));
  const warn    = opts.warn          ?? ((s) => process.stderr.write(s));
  const configDir = opts.configDir   ?? DEFAULT_CONFIG_DIR;
  const isLic   = opts.isLicensed    ?? defaultIsLicensed;
  const queryFn = opts.queryTicketHistoryFn ?? queryTicketHistory;

  if (args.includes('--help') || args.includes('-h')) {
    printHistoryHelp({ stream: { write: print, isTTY: process.stdout.isTTY } });
    return;
  }

  if (!isLic('pro', configDir)) {
    showUpgradePrompt('pro', 'ticketlens history', { stream: { write: warn, isTTY: process.stderr.isTTY } });
    return;
  }

  const ticketKey = args[0];
  if (!ticketKey || ticketKey.startsWith('-')) {
    warn('Usage: ticketlens history TICKET-KEY\n');
    process.exitCode = 1;
    return;
  }

  const entries = queryFn(ticketKey, { configDir });
  if (entries.length === 0) {
    print(`No triage history found for ${ticketKey}.\n`);
    return;
  }

  const hs = createStyler({ isTTY: process.stdout.isTTY });
  print(`\nHistory for ${hs.bold(ticketKey)} (${entries.length} entries)\n\n`);
  for (const e of entries) {
    const bounce = e.bounced ? hs.yellow(' ⟳ bounced') : '';
    const urg = e.urgency === 'needs-response' ? hs.red(e.urgency) : e.urgency === 'aging' ? hs.yellow(e.urgency) : hs.green(e.urgency);
    print(`  ${hs.dim(e.date)}  [${e.profile}]  ${urg}${bounce}  ${hs.dim(e.reason)}\n`);
  }
  print('\n');
}
