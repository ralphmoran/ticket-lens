import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildHandoffInput, HANDOFF_PROMPT } from '../lib/handoff-assembler.mjs';

const BASE_TICKET = {
  key: 'PROJ-1',
  summary: 'Fix payment validation',
  status: 'In Progress',
  assignee: 'Alice Dev',
  reporter: 'Bob QA',
  comments: [
    { author: 'Bob QA',   body: 'Tried the new validation path, still failing.',  created: '2026-01-10T09:00:00.000Z' },
    { author: 'Alice Dev', body: 'Root cause is null pointer in validateCart().', created: '2026-01-11T14:00:00.000Z' },
  ],
};

describe('buildHandoffInput — ticket header', () => {
  it('includes ticket key and summary', () => {
    const input = buildHandoffInput(BASE_TICKET);
    assert.ok(input.includes('PROJ-1'));
    assert.ok(input.includes('Fix payment validation'));
  });

  it('includes status line', () => {
    const input = buildHandoffInput(BASE_TICKET);
    assert.ok(input.includes('Status: In Progress'));
  });

  it('includes assignee line', () => {
    const input = buildHandoffInput(BASE_TICKET);
    assert.ok(input.includes('Assignee: Alice Dev'));
  });

  it('includes reporter when present', () => {
    const input = buildHandoffInput(BASE_TICKET);
    assert.ok(input.includes('Reporter: Bob QA'));
  });

  it('omits reporter line when reporter is null', () => {
    const ticket = { ...BASE_TICKET, reporter: null };
    const input = buildHandoffInput(ticket);
    assert.ok(!input.includes('Reporter:'));
  });

  it('uses (no summary) when summary is null', () => {
    const input = buildHandoffInput({ ...BASE_TICKET, summary: null });
    assert.ok(input.includes('(no summary)'));
  });

  it('uses Unknown when status is null', () => {
    const input = buildHandoffInput({ ...BASE_TICKET, status: null });
    assert.ok(input.includes('Status: Unknown'));
  });

  it('uses Unassigned when assignee is null', () => {
    const input = buildHandoffInput({ ...BASE_TICKET, assignee: null });
    assert.ok(input.includes('Assignee: Unassigned'));
  });
});

describe('buildHandoffInput — comment section', () => {
  it('shows total comment count', () => {
    const input = buildHandoffInput(BASE_TICKET);
    assert.ok(input.includes('2 total'));
  });

  it('numbers comments from 1', () => {
    const input = buildHandoffInput(BASE_TICKET);
    assert.ok(input.includes('[1]'));
    assert.ok(input.includes('[2]'));
  });

  it('includes comment author and date', () => {
    const input = buildHandoffInput(BASE_TICKET);
    assert.ok(input.includes('[1] Bob QA — 2026-01-10'));
    assert.ok(input.includes('[2] Alice Dev — 2026-01-11'));
  });

  it('includes comment body verbatim', () => {
    const input = buildHandoffInput(BASE_TICKET);
    assert.ok(input.includes('Tried the new validation path, still failing.'));
    assert.ok(input.includes('Root cause is null pointer in validateCart().'));
  });

  it('shows (no comments) when comment list is empty', () => {
    const input = buildHandoffInput({ ...BASE_TICKET, comments: [] });
    assert.ok(input.includes('0 total'));
    assert.ok(input.includes('(no comments)'));
  });

  it('handles undefined comments array gracefully', () => {
    const { comments: _c, ...ticket } = BASE_TICKET;
    const input = buildHandoffInput(ticket);
    assert.ok(input.includes('0 total'));
    assert.ok(input.includes('(no comments)'));
  });

  it('handles comment with null author', () => {
    const ticket = {
      ...BASE_TICKET,
      comments: [{ author: null, body: 'Some comment', created: '2026-01-10T00:00:00Z' }],
    };
    const input = buildHandoffInput(ticket);
    assert.ok(input.includes('Unknown'));
  });

  it('handles comment with null body', () => {
    const ticket = {
      ...BASE_TICKET,
      comments: [{ author: 'Alice', body: null, created: '2026-01-10T00:00:00Z' }],
    };
    const input = buildHandoffInput(ticket);
    assert.doesNotThrow(() => buildHandoffInput(ticket));
  });

  it('handles comment with null created date', () => {
    const ticket = {
      ...BASE_TICKET,
      comments: [{ author: 'Alice', body: 'Hello', created: null }],
    };
    const input = buildHandoffInput(ticket);
    assert.ok(input.includes('unknown date'));
  });

  it('preserves comment order', () => {
    const input = buildHandoffInput(BASE_TICKET);
    const pos1 = input.indexOf('[1]');
    const pos2 = input.indexOf('[2]');
    assert.ok(pos1 < pos2);
  });
});

describe('HANDOFF_PROMPT', () => {
  it('is a non-empty string', () => {
    assert.equal(typeof HANDOFF_PROMPT, 'string');
    assert.ok(HANDOFF_PROMPT.length > 0);
  });

  it('instructs structured output with the expected sections', () => {
    assert.ok(HANDOFF_PROMPT.includes('What was attempted'));
    assert.ok(HANDOFF_PROMPT.includes('blockers') || HANDOFF_PROMPT.includes('Blockers'));
    assert.ok(HANDOFF_PROMPT.includes('questions') || HANDOFF_PROMPT.includes('Questions'));
  });
});
