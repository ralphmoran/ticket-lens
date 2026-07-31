import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand } from '../lib/cli.mjs';

describe('parseCommand', () => {
  it('routes ticket key to fetch command', () => {
    const result = parseCommand(['PROJ-123']);
    assert.equal(result.command, 'fetch');
    assert.deepEqual(result.args, ['PROJ-123']);
  });

  it('routes ticket key with flags to fetch command', () => {
    const result = parseCommand(['PROJ-123', '--depth=2', '--profile=myteam']);
    assert.equal(result.command, 'fetch');
    assert.deepEqual(result.args, ['PROJ-123', '--depth=2', '--profile=myteam']);
  });

  it('routes "triage" to triage command', () => {
    const result = parseCommand(['triage']);
    assert.equal(result.command, 'triage');
    assert.deepEqual(result.args, []);
  });

  it('routes "triage" with flags to triage command', () => {
    const result = parseCommand(['triage', '--stale=3', '--profile=acme']);
    assert.equal(result.command, 'triage');
    assert.deepEqual(result.args, ['--stale=3', '--profile=acme']);
  });

  it('returns help for no arguments', () => {
    const result = parseCommand([]);
    assert.equal(result.command, 'help');
  });

  it('returns help for --help flag', () => {
    const result = parseCommand(['--help']);
    assert.equal(result.command, 'help');
  });

  it('returns help for --no-input flag (not a fetch attempt on the literal flag text)', () => {
    const result = parseCommand(['--no-input']);
    assert.equal(result.command, 'help');
  });

  it('returns version for --version flag', () => {
    const result = parseCommand(['--version']);
    assert.equal(result.command, 'version');
  });

  it('routes "init" to init command', () => {
    const result = parseCommand(['init']);
    assert.equal(result.command, 'init');
    assert.deepEqual(result.args, []);
  });

  it('routes "switch" to switch command', () => {
    const result = parseCommand(['switch']);
    assert.equal(result.command, 'switch');
    assert.deepEqual(result.args, []);
  });

  it('routes "activate" to activate command', () => {
    const result = parseCommand(['activate', 'LICENSE-KEY-123']);
    assert.equal(result.command, 'activate');
    assert.deepEqual(result.args, ['LICENSE-KEY-123']);
  });

  it('routes "license" to license command', () => {
    const result = parseCommand(['license']);
    assert.equal(result.command, 'license');
    assert.deepEqual(result.args, []);
  });

  it('routes "cache" to cache command', () => {
    const result = parseCommand(['cache', 'size']);
    assert.equal(result.command, 'cache');
    assert.deepEqual(result.args, ['size']);
  });

  it('routes "cache clear" with flags to cache command', () => {
    const result = parseCommand(['cache', 'clear', 'PROJ-123', '--older-than=7d']);
    assert.equal(result.command, 'cache');
    assert.deepEqual(result.args, ['clear', 'PROJ-123', '--older-than=7d']);
  });

  it('routes "get PROJ-123" to fetch command, stripping "get" keyword', () => {
    const result = parseCommand(['get', 'PROJ-123']);
    assert.equal(result.command, 'fetch');
    assert.deepEqual(result.args, ['PROJ-123']);
  });

  it('routes "get PROJ-123 --depth=0" to fetch command with flags', () => {
    const result = parseCommand(['get', 'PROJ-123', '--depth=0']);
    assert.equal(result.command, 'fetch');
    assert.deepEqual(result.args, ['PROJ-123', '--depth=0']);
  });

  it('routes "clear" to cache clear command', () => {
    const result = parseCommand(['clear']);
    assert.equal(result.command, 'cache');
    assert.deepEqual(result.args, ['clear']);
  });

  it('routes "clear PROJ-123" to cache clear with ticket arg', () => {
    const result = parseCommand(['clear', 'PROJ-123']);
    assert.equal(result.command, 'cache');
    assert.deepEqual(result.args, ['clear', 'PROJ-123']);
  });

  it('routes "clear -h" to cache clear help', () => {
    const result = parseCommand(['clear', '-h']);
    assert.equal(result.command, 'cache');
    assert.deepEqual(result.args, ['clear', '-h']);
  });

  it('routes "cache --help" to cache (not main help)', () => {
    const result = parseCommand(['cache', '--help']);
    assert.equal(result.command, 'cache');
    assert.deepEqual(result.args, ['--help']);
  });

  it('routes "triage --help" to triage (not main help)', () => {
    const result = parseCommand(['triage', '--help']);
    assert.equal(result.command, 'triage');
    assert.deepEqual(result.args, ['--help']);
  });

  it('routes "PROJ-123 --help" to fetch (not main help)', () => {
    const result = parseCommand(['PROJ-123', '--help']);
    assert.equal(result.command, 'fetch');
    assert.deepEqual(result.args, ['PROJ-123', '--help']);
  });

  it('routes "login" to login', () => {
    assert.equal(parseCommand(['login']).command, 'login');
  });

  it('routes "logout" to logout', () => {
    assert.equal(parseCommand(['logout']).command, 'logout');
  });

  it('routes "sync" to sync', () => {
    assert.equal(parseCommand(['sync']).command, 'sync');
  });

  it('routes "review" to review command', () => {
    const result = parseCommand(['review']);
    assert.equal(result.command, 'review');
    assert.deepEqual(result.args, []);
  });

  it('routes "review -h" to review command (not main help)', () => {
    const result = parseCommand(['review', '-h']);
    assert.equal(result.command, 'review');
    assert.deepEqual(result.args, ['-h']);
  });

  it('routes "standup" to standup command', () => {
    const result = parseCommand(['standup']);
    assert.equal(result.command, 'standup');
    assert.deepEqual(result.args, []);
  });

  it('routes "standup -h" to standup command (not main help)', () => {
    const result = parseCommand(['standup', '-h']);
    assert.equal(result.command, 'standup');
    assert.deepEqual(result.args, ['-h']);
  });

  it('routes "standup --since=48" with flags preserved', () => {
    const result = parseCommand(['standup', '--since=48', '--format=pr']);
    assert.equal(result.command, 'standup');
    assert.deepEqual(result.args, ['--since=48', '--format=pr']);
  });

  it('routes "collisions" to collisions command', () => {
    const result = parseCommand(['collisions']);
    assert.equal(result.command, 'collisions');
    assert.deepEqual(result.args, []);
  });

  it('routes "collisions --json" with flags preserved', () => {
    const result = parseCommand(['collisions', '--json']);
    assert.equal(result.command, 'collisions');
    assert.deepEqual(result.args, ['--json']);
  });

  it('routes "cloud-keys" to the cloud-keys command, not the default fetch fallthrough', () => {
    const result = parseCommand(['cloud-keys']);
    assert.equal(result.command, 'cloud-keys');
    assert.deepEqual(result.args, []);
  });

  it('routes "cloud-keys remove groq" with subcommand args preserved', () => {
    const result = parseCommand(['cloud-keys', 'remove', 'groq', '--yes']);
    assert.equal(result.command, 'cloud-keys');
    assert.deepEqual(result.args, ['remove', 'groq', '--yes']);
  });

  it('lock — adding "cloud-keys" does not change the ticket-key fallback for anything else', () => {
    const stillFetch = parseCommand(['PROJ-999']);
    assert.equal(stillFetch.command, 'fetch');
  });

  it('routes "note" to note command', () => {
    const result = parseCommand(['note', 'add', '--title=x']);
    assert.equal(result.command, 'note');
    assert.deepEqual(result.args, ['add', '--title=x']);
  });

  it('routes "recall" to recall command', () => {
    const result = parseCommand(['recall', 'backoff']);
    assert.equal(result.command, 'recall');
    assert.deepEqual(result.args, ['backoff']);
  });

  it('routes "mcp" to the mcp command', () => {
    const result = parseCommand(['mcp']);
    assert.equal(result.command, 'mcp');
    assert.deepEqual(result.args, []);
  });

  it('lock — adding "note"/"recall"/"mcp" does not change the ticket-key fallback for anything else', () => {
    const stillFetch = parseCommand(['PROJ-999']);
    assert.equal(stillFetch.command, 'fetch');
    const stillFetch2 = parseCommand(['notATicketButNotACommandEither']);
    assert.equal(stillFetch2.command, 'fetch');
  });

  it('routes "comment" to comment command', () => {
    const result = parseCommand(['comment', 'PROJ-1', '--body=Looks good']);
    assert.equal(result.command, 'comment');
    assert.deepEqual(result.args, ['PROJ-1', '--body=Looks good']);
  });

  it('routes "transition" to transition command', () => {
    const result = parseCommand(['transition', 'PROJ-1', '--target=Done', '--confirm']);
    assert.equal(result.command, 'transition');
    assert.deepEqual(result.args, ['PROJ-1', '--target=Done', '--confirm']);
  });

  it('routes "transition" with no flags (list mode) to transition command', () => {
    const result = parseCommand(['transition', 'PROJ-1']);
    assert.equal(result.command, 'transition');
    assert.deepEqual(result.args, ['PROJ-1']);
  });

  it('lock — adding "comment"/"transition" does not change the ticket-key fallback for anything else (regression: this exact class of bug shipped once for mcp install)', () => {
    const stillFetch = parseCommand(['PROJ-999']);
    assert.equal(stillFetch.command, 'fetch');
  });

  it('routes "assign" to assign command', () => {
    const result = parseCommand(['assign', 'PROJ-1', '--to=me']);
    assert.equal(result.command, 'assign');
    assert.deepEqual(result.args, ['PROJ-1', '--to=me']);
  });

  it('lock — adding "assign" does not change the ticket-key fallback for anything else', () => {
    const stillFetch = parseCommand(['PROJ-999']);
    assert.equal(stillFetch.command, 'fetch');
  });

  it('routes "duplicates" to duplicates command', () => {
    const result = parseCommand(['duplicates', 'PROJ-1', '--threshold=0.5']);
    assert.equal(result.command, 'duplicates');
    assert.deepEqual(result.args, ['PROJ-1', '--threshold=0.5']);
  });

  it('lock — adding "duplicates" does not change the ticket-key fallback for anything else', () => {
    const stillFetch = parseCommand(['PROJ-999']);
    assert.equal(stillFetch.command, 'fetch');
  });

  it('routes "link" to link command', () => {
    const result = parseCommand(['link', 'PROJ-1', 'PROJ-2', '--type=duplicate', '--confirm']);
    assert.equal(result.command, 'link');
    assert.deepEqual(result.args, ['PROJ-1', 'PROJ-2', '--type=duplicate', '--confirm']);
  });

  it('lock — adding "link" does not change the ticket-key fallback for anything else', () => {
    const stillFetch = parseCommand(['PROJ-999']);
    assert.equal(stillFetch.command, 'fetch');
  });

  it('routes "update" to update command', () => {
    const result = parseCommand(['update', 'PROJ-1', '--title=New title']);
    assert.equal(result.command, 'update');
    assert.deepEqual(result.args, ['PROJ-1', '--title=New title']);
  });

  it('lock — adding "update" does not change the ticket-key fallback for anything else', () => {
    const stillFetch = parseCommand(['PROJ-999']);
    assert.equal(stillFetch.command, 'fetch');
  });

  it('routes "create" to create command', () => {
    const result = parseCommand(['create', '--project=PROJ', '--type=Task', '--summary=New']);
    assert.equal(result.command, 'create');
    assert.deepEqual(result.args, ['--project=PROJ', '--type=Task', '--summary=New']);
  });

  it('lock — adding "create" does not change the ticket-key fallback for anything else', () => {
    const stillFetch = parseCommand(['PROJ-999']);
    assert.equal(stillFetch.command, 'fetch');
  });
});
