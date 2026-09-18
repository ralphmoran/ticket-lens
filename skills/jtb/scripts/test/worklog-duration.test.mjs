import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDuration, formatDuration, parseStarted, toJiraDateTime, MAX_WORKLOG_SECONDS } from '../lib/worklog-duration.mjs';

const NOW = Date.parse('2026-09-18T20:00:00Z');
const now = () => NOW;

describe('parseDuration — accepted shapes', () => {
  for (const [input, seconds] of [
    ['1h30m', 5400],
    ['1h 30m', 5400],
    ['90m', 5400],
    ['2h', 7200],
    ['45M', 2700],
    ['  1H  ', 3600],
    ['24h', MAX_WORKLOG_SECONDS],
  ]) {
    test(`"${input}" → ${seconds}s`, () => {
      assert.deepEqual(parseDuration(input), { ok: true, seconds });
    });
  }
});

describe('parseDuration — rejected shapes', () => {
  for (const [input, pattern] of [
    [undefined, /required/i],
    ['', /required/i],
    [90, /required/i],
    [null, /required/i],
    ['0m', /greater than zero/i],
    ['0h0m', /greater than zero/i],
    ['1d', /hours/i],
    ['2w', /hours/i],
    ['1d4h', /hours/i],
    ['1.5h', /Invalid duration/],
    ['-1h', /Invalid duration/],
    ['1h30', /Invalid duration/],
    ['30m1h', /Invalid duration/],
    ['abc', /Invalid duration/],
    ['1h1h', /Invalid duration/],
    ['99999h', /Invalid duration/],
    ['25h', /24h/],
    ['1441m', /24h/],
  ]) {
    test(`${JSON.stringify(input)} is rejected`, () => {
      const result = parseDuration(input);
      assert.equal(result.ok, false);
      assert.match(result.error, pattern);
    });
  }
});

describe('formatDuration', () => {
  test('renders hours and minutes', () => assert.equal(formatDuration(5400), '1h 30m'));
  test('omits zero minutes', () => assert.equal(formatDuration(7200), '2h'));
  test('omits zero hours', () => assert.equal(formatDuration(2700), '45m'));
});

describe('toJiraDateTime', () => {
  test('uses the +0000 offset form Jira requires, never Z or +00:00', () => {
    assert.equal(toJiraDateTime(new Date('2026-09-18T10:00:00Z')), '2026-09-18T10:00:00.000+0000');
  });
});

describe('parseStarted', () => {
  test('defaults to now when omitted', () => {
    assert.deepEqual(parseStarted(undefined, { now }), { ok: true, started: '2026-09-18T20:00:00.000+0000' });
  });

  test('converts an explicit offset to UTC', () => {
    assert.deepEqual(parseStarted('2026-09-18T10:00:00-07:00', { now }), { ok: true, started: '2026-09-18T17:00:00.000+0000' });
  });

  test('accepts a Z-suffixed timestamp', () => {
    assert.deepEqual(parseStarted('2026-09-18T10:00:00Z', { now }), { ok: true, started: '2026-09-18T10:00:00.000+0000' });
  });

  test('accepts a timestamp exactly one year back — late but plausible backfill', () => {
    assert.equal(parseStarted('2025-09-18T20:00:00Z', { now }).ok, true);
  });

  test('accepts a timestamp up to 5 minutes ahead (clock skew)', () => {
    assert.equal(parseStarted('2026-09-18T20:04:00Z', { now }).ok, true);
  });

  for (const [input, pattern] of [
    ['2026-09-18', /time/i],
    ['garbage', /Invalid/i],
    [12345, /Invalid/i],
    ['2026-13-01T10:00:00Z', /Invalid/i],
    ['2026-09-18T25:00:00Z', /Invalid/i],
    ['2026-02-30T10:00:00Z', /Invalid/i],
    ['2026-09-18T20:06:00Z', /future/i],
    ['2999-01-01T00:00:00Z', /future/i],
    ['2016-09-18T10:00:00Z', /older than/i],
    ['2025-09-17T19:00:00Z', /older than/i],
  ]) {
    test(`${JSON.stringify(input)} is rejected`, () => {
      const result = parseStarted(input, { now });
      assert.equal(result.ok, false);
      assert.match(result.error, pattern);
    });
  }
});
