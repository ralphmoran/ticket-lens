import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { promptProfileMismatch } from '../lib/profile-picker.mjs';

function captureStream() {
  const lines = [];
  return {
    write: (s) => lines.push(s),
    isTTY: false,
    get output() { return lines.join(''); },
  };
}

const TWO_PROFILES = [
  { name: 'work',       baseUrl: 'https://work.atlassian.net' },
  { name: 'corenexus',  baseUrl: 'https://corenexus.atlassian.net' },
];

describe('promptProfileMismatch', () => {
  it('includes the ticket prefix in the warning', async () => {
    const out = captureStream();
    await promptProfileMismatch('ECNT-3888', 'work', TWO_PROFILES, { stream: out });
    assert.ok(out.output.includes('ECNT'), 'warning should mention the prefix');
  });

  it('mentions the currently resolved profile', async () => {
    const out = captureStream();
    await promptProfileMismatch('ECNT-3888', 'work', TWO_PROFILES, { stream: out });
    assert.ok(out.output.includes('work'), 'should mention the current profile');
  });

  it('lists all available profiles in non-TTY mode', async () => {
    const out = captureStream();
    await promptProfileMismatch('ECNT-3888', 'work', TWO_PROFILES, { stream: out });
    assert.ok(out.output.includes('work'),      'should list work');
    assert.ok(out.output.includes('corenexus'), 'should list corenexus');
  });

  it('shows baseUrl as sublabel in non-TTY mode', async () => {
    const out = captureStream();
    await promptProfileMismatch('ECNT-3888', 'work', TWO_PROFILES, { stream: out });
    assert.ok(out.output.includes('work.atlassian.net'));
    assert.ok(out.output.includes('corenexus.atlassian.net'));
  });

  it('returns null in non-TTY mode (keep current)', async () => {
    const out = captureStream();
    const result = await promptProfileMismatch('ECNT-3888', 'work', TWO_PROFILES, { stream: out });
    assert.equal(result, null);
  });

  it('handles profiles with no baseUrl gracefully', async () => {
    const profiles = [{ name: 'alpha', baseUrl: null }, { name: 'beta', baseUrl: null }];
    const out = captureStream();
    const result = await promptProfileMismatch('FOO-1', 'alpha', profiles, { stream: out });
    assert.equal(result, null);
    assert.ok(out.output.includes('alpha'));
    assert.ok(out.output.includes('beta'));
  });
});
