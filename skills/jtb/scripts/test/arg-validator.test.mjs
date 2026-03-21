import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { handleUnknownFlags } from '../lib/arg-validator.mjs';

function makeStream() {
  let output = '';
  return {
    get output() { return output; },
    write(s) { output += s; },
    isTTY: false,
  };
}

// '=' suffix = value-taking flag  |  no suffix = boolean flag
const KNOWN = ['--help', '-h', '--static', '--plain', '--profile=', '--stale=', '--status='];

describe('handleUnknownFlags', () => {
  it('returns args unchanged when all flags are known', async () => {
    const stream = makeStream();
    const args = ['--stale=3', '--plain'];
    const result = await handleUnknownFlags(args, KNOWN, { stream });
    assert.deepEqual(result, args);
    assert.equal(stream.output, '');
  });

  it('returns null and warns about an unknown flag', async () => {
    const stream = makeStream();
    const result = await handleUnknownFlags(['--state=5'], KNOWN, { stream });
    assert.equal(result, null, 'should return null to signal exit');
    assert.ok(stream.output.includes('--state'), `expected --state in output: ${stream.output}`);
  });

  it('suggests the closest VALUE flag for a --flag=value input', async () => {
    const stream = makeStream();
    await handleUnknownFlags(['--state=5'], KNOWN, { stream });
    assert.ok(stream.output.includes('--stale'), `expected --stale suggestion: ${stream.output}`);
  });

  it('preserves the value in the tip (--state=5 → --stale=5)', async () => {
    const stream = makeStream();
    await handleUnknownFlags(['--state=5'], KNOWN, { stream });
    assert.ok(stream.output.includes('--stale=5'), `expected --stale=5 in tip: ${stream.output}`);
  });

  it('never suggests a boolean flag for a --flag=value input', async () => {
    // --dept=5 is a typo of the FETCH flag --depth, which does not exist in triage.
    // The triage boolean flags (--help, --static, --plain) must never be suggested.
    const stream = makeStream();
    await handleUnknownFlags(['--dept=5'], KNOWN, { stream });
    assert.ok(!stream.output.includes('--help'),   `must not suggest --help for --dept=5: ${stream.output}`);
    assert.ok(!stream.output.includes('--plain'),  `must not suggest --plain for --dept=5: ${stream.output}`);
    assert.ok(!stream.output.includes('--static'), `must not suggest --static for --dept=5: ${stream.output}`);
  });

  it('does not suggest when no value flag is close enough (no hints)', async () => {
    // --dept=5: closest value flag is --stale (dist 5) — well above threshold for a 4-char name
    const stream = makeStream();
    await handleUnknownFlags(['--dept=5'], KNOWN, { stream });
    assert.ok(!stream.output.includes('did you mean'), `no suggestion expected for --dept=5: ${stream.output}`);
  });

  it('suggests from hints when nothing in knownFlags is close enough', async () => {
    // --dept=5 is a 1-edit typo of --depth, but --depth is a fetch-only flag (in hints)
    const stream = makeStream();
    await handleUnknownFlags(['--dept=5'], KNOWN, { stream, hints: ['--depth='] });
    assert.ok(stream.output.includes('--depth'), `expected --depth suggestion from hints: ${stream.output}`);
  });

  it('does not offer y/N for hint suggestions (cross-command, not applicable here)', async () => {
    const stream = makeStream();
    await handleUnknownFlags(['--dept=5'], KNOWN, { stream, hints: ['--depth='] });
    assert.ok(!stream.output.includes('Apply'), `must not offer to apply a hint-only suggestion: ${stream.output}`);
  });

  it('suggests a boolean flag for a boolean-style input (no =)', async () => {
    // --stati is a 1-char typo of --static
    const stream = makeStream();
    await handleUnknownFlags(['--stati'], KNOWN, { stream });
    assert.ok(stream.output.includes('--static'), `expected --static suggestion: ${stream.output}`);
  });

  it('does not suggest when nothing is close enough', async () => {
    const stream = makeStream();
    await handleUnknownFlags(['--xyzabc'], KNOWN, { stream });
    assert.ok(!stream.output.includes('did you mean'), `no suggestion expected: ${stream.output}`);
  });

  it('skips positional args (non-flag tokens)', async () => {
    const stream = makeStream();
    const args = ['PROJ-123', '--plain'];
    const result = await handleUnknownFlags(args, KNOWN, { stream });
    assert.deepEqual(result, args);
    assert.equal(stream.output, '');
  });

  it('handles multiple unknown flags and returns null', async () => {
    const stream = makeStream();
    const result = await handleUnknownFlags(['--state=5', '--profle=acme'], KNOWN, { stream });
    assert.equal(result, null);
    assert.ok(stream.output.includes('--state'), `expected --state: ${stream.output}`);
    assert.ok(stream.output.includes('--profle'), `expected --profle: ${stream.output}`);
  });
});
