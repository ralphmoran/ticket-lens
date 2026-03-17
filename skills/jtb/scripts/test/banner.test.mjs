import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createSession } from '../lib/banner.mjs';

function fakeStream({ isTTY = true } = {}) {
  const chunks = [];
  return {
    isTTY,
    write(data) { chunks.push(data); return true; },
    output() { return chunks.join(''); },
  };
}

const baseConn = {
  baseUrl: 'https://jira.example.com',
  profileName: 'advent',
  email: 'ralph@example.com',
  source: 'profile',
};

describe('createSession', () => {
  it('spin() renders header box with info lines on TTY', async () => {
    const stream = fakeStream({ isTTY: true });
    const session = createSession(baseConn, { stream });
    session.spin('Connecting…');
    await new Promise(r => setTimeout(r, 100));
    session.connected();
    const out = stream.output();
    assert.ok(out.includes('TicketLens'), 'Should include product name');
    assert.ok(out.includes('v0.'), 'Should include version');
    assert.ok(out.includes('advent'), 'Should include profile name');
    assert.ok(out.includes('jira.example.com'), 'Should include server hostname');
    assert.ok(out.includes('ralph@example.com'), 'Should include user email');
    assert.ok(out.includes('╭'), 'Should include box-drawing top');
    assert.ok(out.includes('╰'), 'Should include box-drawing bottom');
  });

  it('connected() renders green dot status inside box', async () => {
    const stream = fakeStream({ isTTY: true });
    const session = createSession(baseConn, { stream });
    session.spin('Connecting…');
    await new Promise(r => setTimeout(r, 100));
    session.connected();
    const out = stream.output();
    assert.ok(out.includes('Connected to Advent Jira'), 'Should include connected message');
    assert.ok(out.includes('●'), 'Should include dot indicator');
  });

  it('failed() renders red dot status inside box', async () => {
    const stream = fakeStream({ isTTY: true });
    const session = createSession(baseConn, { stream });
    session.spin('Connecting…');
    await new Promise(r => setTimeout(r, 100));
    session.failed();
    const out = stream.output();
    assert.ok(out.includes('Connection to Advent Jira failed'), 'Should include failed message');
    assert.ok(out.includes('●'), 'Should include dot indicator');
  });

  it('footer() renders colored error box on TTY', () => {
    const stream = fakeStream({ isTTY: true });
    const session = createSession(baseConn, { stream });
    session.footer('Error: fetch failed');
    const out = stream.output();
    assert.ok(out.includes('✖'), 'Should include error icon');
    assert.ok(out.includes('fetch failed'), 'Should include error message');
    assert.ok(out.includes('╭'), 'Footer should have box-drawing');
  });

  it('footer() renders plain text on non-TTY', () => {
    const stream = fakeStream({ isTTY: false });
    const session = createSession(baseConn, { stream });
    session.footer('Error: fetch failed');
    const out = stream.output();
    assert.ok(out.includes('Error: fetch failed'), 'Should include message');
    assert.ok(!out.includes('╭'), 'Should NOT include box on non-TTY');
  });

  it('spin() outputs plain single-line on non-TTY', () => {
    const stream = fakeStream({ isTTY: false });
    const session = createSession(baseConn, { stream });
    session.spin('Connecting…');
    session.connected();
    const out = stream.output();
    assert.ok(out.includes('TicketLens'), 'Should include product name');
    assert.ok(out.includes('advent'), 'Should include profile');
    assert.ok(!out.includes('╭'), 'Should NOT include box on non-TTY');
  });

  it('shows "token auth" when only PAT is available', async () => {
    const stream = fakeStream({ isTTY: true });
    const session = createSession({ baseUrl: 'https://jira.example.com', pat: 'secret', profileName: 'work' }, { stream });
    session.spin('Connecting…');
    await new Promise(r => setTimeout(r, 50));
    session.connected();
    const out = stream.output();
    assert.ok(out.includes('token auth'), 'Should show token auth for PAT');
  });

  it('exposes jiraLabel via .label property', () => {
    const stream = fakeStream({ isTTY: false });
    const session = createSession(baseConn, { stream });
    assert.equal(session.label, 'Advent Jira');
  });

  it('hides and restores cursor around spinner', async () => {
    const stream = fakeStream({ isTTY: true });
    const session = createSession(baseConn, { stream });
    session.spin('Loading…');
    await new Promise(r => setTimeout(r, 100));
    session.connected();
    const out = stream.output();
    assert.ok(out.includes('\x1b[?25l'), 'Should hide cursor on spin');
    assert.ok(out.includes('\x1b[?25h'), 'Should restore cursor on stop');
  });

  it('footer() with type "info" uses info icon', () => {
    const stream = fakeStream({ isTTY: true });
    const session = createSession(baseConn, { stream });
    session.footer('All done', 'info');
    const out = stream.output();
    assert.ok(out.includes('ℹ'), 'Should include info icon');
    assert.ok(out.includes('All done'), 'Should include message');
  });
});
