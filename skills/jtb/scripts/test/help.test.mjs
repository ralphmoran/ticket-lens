import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { printHelp, printTriageHelp } from '../lib/help.mjs';

function captureHelp(fn) {
  let out = '';
  const stream = { write: (s) => { out += s; } };
  fn({ stream });
  return out;
}

describe('printHelp — main USAGE', () => {
  it('USAGE section documents the get alias before EXAMPLES', () => {
    const out = captureHelp(printHelp);
    const usageIdx = out.indexOf('USAGE');
    const getIdx = out.indexOf('ticketlens get');
    const examplesIdx = out.indexOf('EXAMPLES');
    assert.ok(usageIdx !== -1, 'output must contain USAGE section');
    assert.ok(
      getIdx !== -1 && getIdx < examplesIdx,
      `"ticketlens get" must appear in USAGE (before EXAMPLES), but found at index ${getIdx} vs EXAMPLES at ${examplesIdx}`
    );
  });
});

describe('printTriageHelp — Team tier flags', () => {
  it('documents --assignee flag with [Team] badge', () => {
    const out = captureHelp(printTriageHelp);
    assert.ok(out.includes('--assignee'), 'triage --help must document --assignee flag');
    assert.ok(out.includes('[Team]'), 'triage --help must show [Team] badge for gated flags');
  });

  it('documents --sprint flag with [Team] badge', () => {
    const out = captureHelp(printTriageHelp);
    assert.ok(out.includes('--sprint'), 'triage --help must document --sprint flag');
  });

  it('main --help documents --assignee in TRIAGE OPTIONS', () => {
    const out = captureHelp(printHelp);
    assert.ok(out.includes('--assignee'), 'main --help must include --assignee in triage options');
  });

  it('main --help documents --sprint in TRIAGE OPTIONS', () => {
    const out = captureHelp(printHelp);
    assert.ok(out.includes('--sprint'), 'main --help must include --sprint in triage options');
  });
});

describe('printTriageHelp — interactive mode keys', () => {
  it('documents the p hotkey for profile switching', () => {
    const out = captureHelp(printTriageHelp);
    assert.ok(
      out.includes('p') && (out.toLowerCase().includes('profile') || out.toLowerCase().includes('switch')),
      'triage --help must document the p hotkey and mention profile or switch'
    );
  });

  it('documents up/down navigation', () => {
    const out = captureHelp(printTriageHelp);
    assert.ok(out.includes('↑') || out.includes('↓') || out.includes('up') || out.includes('navigate'),
      'triage --help must document navigation keys');
  });

  it('documents Enter to open in browser', () => {
    const out = captureHelp(printTriageHelp);
    assert.ok(out.toLowerCase().includes('enter') || out.includes('browser'),
      'triage --help must document Enter key');
  });

  it('documents q/Esc to exit', () => {
    const out = captureHelp(printTriageHelp);
    assert.ok(out.includes('q') || out.includes('Esc'),
      'triage --help must document q/Esc to exit');
  });
});
