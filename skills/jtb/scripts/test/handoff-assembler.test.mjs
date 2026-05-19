import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildHandoffInput, readTextAttachments, HANDOFF_PROMPT } from '../lib/handoff-assembler.mjs';

function makeTmpDir() {
  return mkdtempSync(join(tmpdir(), 'tl-handoff-'));
}

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

describe('buildHandoffInput — description section', () => {
  it('includes description when present', () => {
    const ticket = { ...BASE_TICKET, description: 'Validate cart items before checkout.' };
    const input = buildHandoffInput(ticket);
    assert.ok(input.includes('--- Description ---'));
    assert.ok(input.includes('Validate cart items before checkout.'));
  });

  it('omits description section when description is null', () => {
    const ticket = { ...BASE_TICKET, description: null };
    const input = buildHandoffInput(ticket);
    assert.ok(!input.includes('--- Description ---'));
  });

  it('description appears before comments', () => {
    const ticket = { ...BASE_TICKET, description: 'The spec is here.' };
    const input = buildHandoffInput(ticket);
    assert.ok(input.indexOf('--- Description ---') < input.indexOf('--- Comments'));
  });
});

describe('buildHandoffInput — Confluence pages', () => {
  it('includes Confluence page title and text', () => {
    const ticket = {
      ...BASE_TICKET,
      confluencePages: [{ title: 'Design Spec', text: 'The cart should validate stock levels.' }],
    };
    const input = buildHandoffInput(ticket);
    assert.ok(input.includes('--- Confluence Pages (1) ---'));
    assert.ok(input.includes('Design Spec'));
    assert.ok(input.includes('cart should validate stock levels'));
  });

  it('uses URL as title when title is absent', () => {
    const ticket = {
      ...BASE_TICKET,
      confluencePages: [{ url: 'https://wiki.example.com/page/123', text: 'Some content.' }],
    };
    const input = buildHandoffInput(ticket);
    assert.ok(input.includes('wiki.example.com/page/123'));
  });

  it('omits Confluence section when no pages', () => {
    const ticket = { ...BASE_TICKET, confluencePages: [] };
    const input = buildHandoffInput(ticket);
    assert.ok(!input.includes('Confluence Pages'));
  });
});

describe('buildHandoffInput — text attachments', () => {
  it('includes text file content', () => {
    const d = makeTmpDir();
    const p = join(d, 'spec.txt');
    writeFileSync(p, 'Auth flow: check token expiry before redirect.');
    const ticket = {
      ...BASE_TICKET,
      localAttachments: [{ filename: 'spec.txt', localPath: p, skipReason: null }],
    };
    const input = buildHandoffInput(ticket);
    rmSync(d, { recursive: true });
    assert.ok(input.includes('--- Attached Documents (1 text-readable) ---'));
    assert.ok(input.includes('spec.txt'));
    assert.ok(input.includes('check token expiry before redirect'));
  });

  it('skips binary attachments (images, PDFs)', () => {
    const ticket = {
      ...BASE_TICKET,
      localAttachments: [{ filename: 'screenshot.png', localPath: '/some/path.png', skipReason: null }],
    };
    const input = buildHandoffInput(ticket);
    assert.ok(!input.includes('Attached Documents'));
  });

  it('skips attachments with error skipReason', () => {
    const ticket = {
      ...BASE_TICKET,
      localAttachments: [{ filename: 'notes.txt', localPath: '/nonexistent.txt', skipReason: 'error' }],
    };
    const input = buildHandoffInput(ticket);
    assert.ok(!input.includes('Attached Documents'));
  });

  it('gracefully handles missing localAttachments', () => {
    const input = buildHandoffInput({ ...BASE_TICKET });
    assert.ok(!input.includes('Attached Documents'));
  });
});

describe('readTextAttachments', () => {
  it('reads .md and .txt files', () => {
    const d = makeTmpDir();
    const p1 = join(d, 'notes.md');
    const p2 = join(d, 'log.txt');
    writeFileSync(p1, '# Notes\nDo the thing.');
    writeFileSync(p2, 'Error: null pointer at line 42');
    const result = readTextAttachments([
      { filename: 'notes.md', localPath: p1, skipReason: null },
      { filename: 'log.txt', localPath: p2, skipReason: null },
    ]);
    rmSync(d, { recursive: true });
    assert.equal(result.length, 2);
    assert.ok(result[0].content.includes('Do the thing'));
    assert.ok(result[1].content.includes('null pointer'));
  });

  it('skips non-text extensions', () => {
    const result = readTextAttachments([
      { filename: 'image.png', localPath: '/fake/path.png', skipReason: null },
      { filename: 'doc.pdf', localPath: '/fake/doc.pdf', skipReason: null },
    ]);
    assert.equal(result.length, 0);
  });

  it('returns empty array for empty input', () => {
    assert.deepEqual(readTextAttachments([]), []);
    assert.deepEqual(readTextAttachments(undefined), []);
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
