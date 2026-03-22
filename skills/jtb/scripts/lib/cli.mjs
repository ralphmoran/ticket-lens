/**
 * CLI command parser for ticketlens.
 * Routes arguments to the appropriate subcommand.
 */

export const TICKET_KEY_PATTERN = /^[A-Z][A-Z0-9]+-\d+$/;

export function parseCommand(args) {
  const first = args[0];

  if (args.length === 0 || first === '--help' || first === '-h') {
    return { command: 'help', args: [] };
  }

  if (args.includes('--version') || args.includes('-v')) {
    return { command: 'version', args: [] };
  }

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

  if (first === 'delete') {
    return { command: 'delete', args: args.slice(1) };
  }

  if (first === 'profiles' || first === 'ls') {
    return { command: 'profiles', args: args.slice(1) };
  }

  // "get PROJ-123" — alias for the fetch command
  if (first === 'get') {
    return { command: 'fetch', args: args.slice(1) };
  }

  // "clear" — shorthand for "cache clear"
  if (first === 'clear') {
    return { command: 'cache', args: ['clear', ...args.slice(1)] };
  }

  // Anything that looks like a ticket key or any non-flag arg → fetch
  return { command: 'fetch', args };
}
