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
});
