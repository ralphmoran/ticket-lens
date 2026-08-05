import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installInto } from '../lib/hooks-setup.mjs';

describe('hooks-setup — installInto', () => {
  let dir, settingsPath;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ticketlens-hooks-setup-'));
    settingsPath = join(dir, 'settings.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates settings.json with the Stop hook when none exists', () => {
    const result = installInto(settingsPath);
    assert.equal(result.status, 'installed');
    const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
    assert.equal(settings.hooks.Stop.length, 1);
    assert.match(settings.hooks.Stop[0].hooks[0].command, /recall-nudge-stop\.mjs/);
  });

  it('never installs the retired PostToolUse nudge on a fresh settings.json', () => {
    installInto(settingsPath);
    const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
    assert.deepEqual(settings.hooks.PostToolUse, []);
  });

  it('removes a stale PostToolUse entry left by a prior install', () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(settingsPath, JSON.stringify({
      hooks: {
        PostToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node "/some/path/recall-nudge-post-tool.mjs"', timeout: 5 }] }],
        Stop: [],
      },
    }));
    const result = installInto(settingsPath);
    assert.equal(result.postCleanupResult, 'removed');
    const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
    assert.deepEqual(settings.hooks.PostToolUse, []);
  });

  it('removes only our own inner hook when it is colocated in the same list entry as a hook the user added themselves', () => {
    writeFileSync(settingsPath, JSON.stringify({
      hooks: {
        PostToolUse: [{
          matcher: 'Bash',
          hooks: [
            { type: 'command', command: 'node "/some/path/recall-nudge-post-tool.mjs"', timeout: 5 },
            { type: 'command', command: 'node "/my/own/custom-bash-logger.mjs"', timeout: 5 },
          ],
        }],
        Stop: [],
      },
    }));
    installInto(settingsPath);
    const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
    assert.equal(settings.hooks.PostToolUse.length, 1, 'the entry itself must survive, just without our hook');
    assert.equal(settings.hooks.PostToolUse[0].hooks.length, 1);
    assert.match(settings.hooks.PostToolUse[0].hooks[0].command, /custom-bash-logger\.mjs/);
  });

  it('leaves an unrelated PostToolUse entry the user configured themselves untouched', () => {
    writeFileSync(settingsPath, JSON.stringify({
      hooks: {
        PostToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'node "/my/own/formatter.mjs"', timeout: 5 }] }],
        Stop: [],
      },
    }));
    installInto(settingsPath);
    const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
    assert.equal(settings.hooks.PostToolUse.length, 1);
    assert.match(settings.hooks.PostToolUse[0].hooks[0].command, /formatter\.mjs/);
  });

  it('updating the Stop hook preserves a user hook colocated in the same list entry', () => {
    writeFileSync(settingsPath, JSON.stringify({
      hooks: {
        PostToolUse: [],
        Stop: [{
          matcher: '*',
          hooks: [
            { type: 'command', command: 'node "/old/stale/path/recall-nudge-stop.mjs"', timeout: 5 },
            { type: 'command', command: 'node "/my/own/custom-stop-logger.mjs"', timeout: 5 },
          ],
        }],
      },
    }));
    const result = installInto(settingsPath);
    assert.equal(result.stopResult, 'updated');
    const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
    assert.equal(settings.hooks.Stop.length, 1);
    const commands = settings.hooks.Stop[0].hooks.map(h => h.command);
    assert.ok(commands.some(c => c.includes('custom-stop-logger.mjs')), 'user hook must survive');
    assert.ok(commands.some(c => c.match(/recall-nudge-stop\.mjs"$/) && !c.includes('/old/stale/path/')), 'our path must be refreshed to the current one');
  });

  it('is idempotent — a second run with nothing left to clean up and the Stop hook already current reports unchanged', () => {
    installInto(settingsPath);
    const result = installInto(settingsPath);
    assert.equal(result.status, 'unchanged');
  });

  it('a malformed settings.json is left untouched, never overwritten', () => {
    writeFileSync(settingsPath, '{ not valid json');
    const result = installInto(settingsPath);
    assert.equal(result.status, 'skipped');
    assert.equal(readFileSync(settingsPath, 'utf8'), '{ not valid json');
  });

  it('never touches unrelated settings.json content', () => {
    writeFileSync(settingsPath, JSON.stringify({ theme: 'dark', hooks: { PostToolUse: [], Stop: [] } }));
    installInto(settingsPath);
    const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
    assert.equal(settings.theme, 'dark');
  });
});
