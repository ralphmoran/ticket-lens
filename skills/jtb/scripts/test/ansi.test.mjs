import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { bold, dim, red, green, cyan, yellow, isStyled, createStyler, sanitizeUntrustedText } from '../lib/ansi.mjs';

describe('sanitizeUntrustedText', () => {
  it('strips ESC so an SGR sequence becomes inert literal text', () => {
    const malicious = 'Evil\x1b[2J\x1b[31mTeam';
    const result = sanitizeUntrustedText(malicious);
    assert.ok(!result.includes('\x1b'));
    assert.equal(result, 'Evil[2J[31mTeam');
  });

  it('strips OSC sequences (e.g. terminal title / hyperlink injection)', () => {
    const malicious = 'Team\x1b]0;pwned\x07Name';
    const result = sanitizeUntrustedText(malicious);
    assert.ok(!result.includes('\x1b'));
    assert.ok(!result.includes('\x07'));
  });

  it('strips raw C0 control characters (CR, LF, BEL, NUL)', () => {
    const malicious = 'Line1\r\nLine2\x00\x07';
    const result = sanitizeUntrustedText(malicious);
    assert.equal(result, 'Line1Line2');
  });

  it('strips C1 control characters and DEL', () => {
    const malicious = 'A\x7FB\x9FC';
    const result = sanitizeUntrustedText(malicious);
    assert.equal(result, 'ABC');
  });

  it('leaves ordinary printable text, including punctuation and unicode, untouched', () => {
    assert.equal(sanitizeUntrustedText("Team Manager's Team"), "Team Manager's Team");
    assert.equal(sanitizeUntrustedText('Café Team 🚀'), 'Café Team 🚀');
  });

  it('returns an empty string for non-string input rather than throwing', () => {
    assert.equal(sanitizeUntrustedText(null), '');
    assert.equal(sanitizeUntrustedText(undefined), '');
    assert.equal(sanitizeUntrustedText(42), '');
  });
});

describe('ansi styling', () => {
  it('wraps text in ANSI codes when styling is enabled', () => {
    const s = createStyler({ forceColor: true });
    const result = s.bold('hello');
    assert.notEqual(result, 'hello', 'Should contain ANSI codes');
    assert.ok(result.includes('hello'), 'Should still contain the text');
    assert.ok(result.startsWith('\x1b['), 'Should start with escape sequence');
  });

  it('returns plain text when styling is disabled', () => {
    const s = createStyler({ noColor: true });
    assert.equal(s.bold('hello'), 'hello');
    assert.equal(s.red('error'), 'error');
    assert.equal(s.cyan('info'), 'info');
    assert.equal(s.dim('muted'), 'muted');
    assert.equal(s.enabled, false);
  });

  it('NO_COLOR disables styling', () => {
    const s = createStyler({ noColor: true, isTTY: true });
    assert.equal(s.enabled, false);
    assert.equal(s.bold('x'), 'x');
  });

  it('FORCE_COLOR enables styling even without TTY', () => {
    const s = createStyler({ forceColor: true, isTTY: false });
    assert.equal(s.enabled, true);
    assert.notEqual(s.bold('x'), 'x');
  });

  it('TERM=dumb disables styling', () => {
    const s = createStyler({ term: 'dumb', isTTY: true });
    assert.equal(s.enabled, false);
    assert.equal(s.red('x'), 'x');
  });

  it('all style functions produce different codes', () => {
    const s = createStyler({ forceColor: true });
    const results = [s.bold('x'), s.dim('x'), s.red('x'), s.green('x'), s.yellow('x'), s.cyan('x')];
    const unique = new Set(results);
    assert.equal(unique.size, 6, 'Each style function should produce a unique result');
  });

  it('link() wraps text in OSC 8 hyperlink when enabled', () => {
    const s = createStyler({ forceColor: true });
    const result = s.link('https://example.com', 'click me');
    assert.ok(result.includes('\x1b]8;;https://example.com\x07'), 'Should contain OSC 8 open');
    assert.ok(result.includes('click me'), 'Should contain visible text');
    assert.ok(result.includes('\x1b]8;;\x07'), 'Should contain OSC 8 close');
  });

  it('link() returns plain text when disabled', () => {
    const s = createStyler({ noColor: true });
    const result = s.link('https://example.com', 'click me');
    assert.equal(result, 'click me', 'Should return plain text when disabled');
  });
});
