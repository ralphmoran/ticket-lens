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

  it('returns version for --version flag', () => {
    const result = parseCommand(['--version']);
    assert.equal(result.command, 'version');
  });
});
