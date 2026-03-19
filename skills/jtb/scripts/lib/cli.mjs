/**
 * CLI command parser for ticketlens.
 * Routes arguments to the appropriate subcommand.
 */

const TICKET_KEY_PATTERN = /^[A-Z][A-Z0-9]+-\d+$/;

export function parseCommand(args) {
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    return { command: 'help', args: [] };
  }

  if (args.includes('--version') || args.includes('-v')) {
    return { command: 'version', args: [] };
  }

  const first = args[0];

  if (first === 'triage') {
    return { command: 'triage', args: args.slice(1) };
  }

  if (first === 'init') {
    return { command: 'init', args: args.slice(1) };
  }

  if (first === 'switch') {
    return { command: 'switch', args: args.slice(1) };
  }

  if (first === 'config') {
    return { command: 'config', args: args.slice(1) };
  }

  if (first === 'activate') {
    return { command: 'activate', args: args.slice(1) };
  }

  if (first === 'license') {
    return { command: 'license', args: args.slice(1) };
  }

  if (first === 'cache') {
    return { command: 'cache', args: args.slice(1) };
  }

  // Anything that looks like a ticket key or any non-flag arg → fetch
  return { command: 'fetch', args };
}
