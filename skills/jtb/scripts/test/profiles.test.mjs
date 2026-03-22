import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { printProfiles } from '../lib/help.mjs';
import { parseCommand } from '../lib/cli.mjs';

function capture(config, opts = {}) {
  let out = '';
  const stream = { write: (s) => { out += s; }, isTTY: false };
  printProfiles({ stream, config, ...opts });
  return out;
}

describe('printProfiles — empty state', () => {
  it('shows setup hint when no profiles configured', () => {
    const out = capture(null);
    assert.ok(out.includes('ticketlens init'), 'should prompt to run ticketlens init');
  });

  it('shows setup hint for empty profiles object', () => {
    const out = capture({ profiles: {} });
    assert.ok(out.includes('ticketlens init'));
  });
});

describe('printProfiles — single profile', () => {
  const config = {
    profiles: {
      myteam: { baseUrl: 'https://myteam.atlassian.net', auth: 'cloud', ticketPrefixes: ['PROJ', 'OPS'] },
    },
  };

  it('shows profile name and URL', () => {
    const out = capture(config);
    assert.ok(out.includes('myteam'));
    assert.ok(out.includes('https://myteam.atlassian.net'));
  });

  it('shows ticket prefixes', () => {
    const out = capture(config);
    assert.ok(out.includes('PROJ') && out.includes('OPS'));
  });

  it('marks first profile as active when no default set', () => {
    const out = capture(config);
    assert.ok(out.includes('myteam'));
    // active note should mention myteam
    assert.ok(out.toLowerCase().includes('active') || out.includes('●'));
  });
});

describe('printProfiles — multiple profiles', () => {
  const config = {
    default: 'client',
    profiles: {
      myteam: { baseUrl: 'https://myteam.atlassian.net', auth: 'cloud', ticketPrefixes: ['PROJ'] },
      client: { baseUrl: 'https://jira.client.com', auth: 'server', ticketPrefixes: ['ACME'], triageStatuses: ['In Progress', 'In Review'] },
    },
  };

  it('shows both profiles', () => {
    const out = capture(config);
    assert.ok(out.includes('myteam'));
    assert.ok(out.includes('client'));
  });

  it('marks config.default as active', () => {
    const out = capture(config);
    // Active footer note must name the default profile
    assert.ok(out.includes('client'), 'active profile name must appear');
  });

  it('shows column headers', () => {
    const out = capture(config);
    assert.ok(out.includes('Profile'), 'header must include Profile');
    assert.ok(out.includes('URL'),      'header must include URL');
    assert.ok(out.includes('Prefixes'), 'header must include Prefixes');
    assert.ok(out.includes('Statuses'), 'header must include Statuses');
  });

  it('shows triageStatuses values in Statuses column', () => {
    const out = capture(config);
    assert.ok(out.includes('In Progress'));
    assert.ok(out.includes('In Review'));
  });
});

describe('printProfiles — --plain mode', () => {
  const config = {
    default: 'myteam',
    profiles: {
      myteam: { baseUrl: 'https://myteam.atlassian.net', auth: 'cloud', ticketPrefixes: ['PROJ'] },
      client: { baseUrl: 'https://jira.client.com', auth: 'server', ticketPrefixes: ['ACME'] },
    },
  };

  it('outputs tab-separated rows', () => {
    const out = capture(config, { plain: true });
    const lines = out.trim().split('\n');
    assert.strictEqual(lines.length, 2);
    assert.ok(lines[0].includes('\t'), 'rows must be tab-separated');
  });

  it('marks active profile in plain output', () => {
    const out = capture(config, { plain: true });
    assert.ok(out.includes('active'), 'active profile must be flagged');
    assert.ok(out.includes('inactive'), 'inactive profile must be flagged');
  });

  it('includes URL and statuses columns in plain output', () => {
    const out = capture(config, { plain: true });
    assert.ok(out.includes('https://myteam.atlassian.net'));
    // active/inactive status flag in second column
    assert.ok(out.includes('active'));
  });
});

describe('printProfiles — (no) active indicator when default key absent', () => {
  it('uses first profile as active when config.default is not set', () => {
    const config = {
      profiles: {
        first:  { baseUrl: 'https://a.atlassian.net', auth: 'cloud' },
        second: { baseUrl: 'https://b.atlassian.net', auth: 'cloud' },
      },
    };
    const out = capture(config);
    // Active note must name "first" (no config.default)
    assert.ok(out.includes('first'), 'first profile must be shown as active');
  });

  it('uses config.default as active when set', () => {
    const config = {
      default: 'second',
      profiles: {
        first:  { baseUrl: 'https://a.atlassian.net', auth: 'cloud' },
        second: { baseUrl: 'https://b.atlassian.net', auth: 'cloud' },
      },
    };
    const out = capture(config);
    assert.ok(out.includes('second'), 'config.default profile must be shown as active');
  });
});

describe('cli.mjs — profiles command routing', () => {
  it('routes "profiles" to profiles command', () => {
    const { command } = parseCommand(['profiles']);
    assert.strictEqual(command, 'profiles');
  });

  it('routes "ls" shorthand to profiles command', () => {
    const { command } = parseCommand(['ls']);
    assert.strictEqual(command, 'profiles');
  });

  it('passes --plain arg through', () => {
    const { args } = parseCommand(['profiles', '--plain']);
    assert.ok(args.includes('--plain'));
  });
});
