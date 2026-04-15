import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { estimateTokens, pruneBrief } from '../lib/budget-pruner.mjs';

// ── Fixture helpers ───────────────────────────────────────────────────────────

/** Build a minimal TicketBrief-style markdown string from parts. */
function makeBrief({ key = 'PROJ-123', summary = 'Fix the bug', description = null, comments = [], attachments = [], linkedTickets = [] } = {}) {
  const parts = [`# ${key}: ${summary}`, `**Type:** Bug | **Status:** In Progress`];

  if (description) {
    parts.push(`## Description\n\n${description}`);
  }

  if (comments.length > 0) {
    const cmtLines = comments.map(c => `### **${c.author}** (${c.date})\n\n${c.body}`);
    parts.push(`## Comments\n\n${cmtLines.join('\n\n---\n\n')}`);
  }

  if (linkedTickets.length > 0) {
    const ltSections = linkedTickets.map(lt => {
      const lines = [`### ${lt.key}: ${lt.summary}`, `**Type:** Task | **Status:** Open`];
      if (lt.description) lines.push(lt.description);
      if (lt.comments?.length > 0) {
        lines.push(lt.comments.map(c => `**${c.author}** (${c.date}): ${c.body}`).join('\n\n'));
      }
      return lines.join('\n\n');
    });
    parts.push(`## Linked Tickets\n\n${ltSections.join('\n\n---\n\n')}`);
  }

  if (attachments.length > 0) {
    const lines = attachments.map(a => `- ${a.filename} _(${a.size})_`);
    parts.push(`## Attachments\n\n${lines.join('\n')}`);
  }

  return parts.join('\n\n');
}

/** Create a stream collector (array-based WritableStream-like object). */
function makeStream() {
  const chunks = [];
  return {
    write(chunk) { chunks.push(String(chunk)); },
    get output() { return chunks.join(''); },
  };
}

// ── Fixed "now" for deterministic date tests ──────────────────────────────────
// Use 2026-04-14 as "now". Comments older than 30 days: before 2026-03-15.
const NOW = new Date('2026-04-14T12:00:00.000Z');
const OLD_DATE = '2026-02-01';   // 72 days ago — should be pruned
const FRESH_DATE = '2026-04-10'; // 4 days ago — keep

// ── estimateTokens ────────────────────────────────────────────────────────────

describe('estimateTokens', () => {
  it("returns 0 for empty string", () => {
    assert.equal(estimateTokens(''), 0);
  });

  it('returns Math.ceil(text.length / 4)', () => {
    assert.equal(estimateTokens('abcd'), 1);
    assert.equal(estimateTokens('abcde'), 2);
    assert.equal(estimateTokens('Hello, world!'), Math.ceil('Hello, world!'.length / 4));
    const text = 'a'.repeat(401);
    assert.equal(estimateTokens(text), Math.ceil(401 / 4));
  });
});

// ── pruneBrief — no pruning needed ───────────────────────────────────────────

describe('pruneBrief — within budget', () => {
  it('returns brief unchanged when tokens <= budget', () => {
    const brief = makeBrief({ description: 'Short description.' });
    const budget = 100_000; // way more than needed
    const stream = makeStream();
    const result = pruneBrief(brief, { budget, stream, now: NOW });
    assert.equal(result.pruned, brief);
    assert.equal(result.dropped.length, 0);
  });
});

// ── pruneBrief — priority 1: old comments ────────────────────────────────────

describe('pruneBrief — priority 1: old comments', () => {
  it('removes comments older than 30 days first', () => {
    const brief = makeBrief({
      description: 'Short desc.',
      comments: [
        { author: 'Alice', date: OLD_DATE,   body: 'Old comment body here.' },
        { author: 'Bob',   date: FRESH_DATE, body: 'Fresh comment body here.' },
      ],
    });
    const tokens = estimateTokens(brief);
    // Budget just below full — force pruning
    const budget = tokens - 5;
    const stream = makeStream();
    const result = pruneBrief(brief, { budget, stream, now: NOW });

    assert.ok(!result.pruned.includes('Old comment body here.'), 'old comment body should be removed');
    assert.ok(result.pruned.includes('Fresh comment body here.'), 'fresh comment should be kept');
    assert.ok(result.dropped.length > 0, 'dropped should list removed items');
  });
});

// ── pruneBrief — priority 2: attachments ─────────────────────────────────────

describe('pruneBrief — priority 2: attachments', () => {
  it('removes attachment metadata when still over budget after comment pruning', () => {
    const longDesc = 'x'.repeat(800);
    const brief = makeBrief({
      description: longDesc,
      comments: [
        { author: 'Alice', date: FRESH_DATE, body: 'Fresh comment — keep.' },
      ],
      attachments: [
        { filename: 'report.pdf', size: '1.2 MB' },
        { filename: 'screenshot.png', size: '345 KB' },
      ],
    });
    const tokens = estimateTokens(brief);
    // Set budget tight enough that even after removing (no old comments), attachments must go
    const budget = Math.ceil(tokens * 0.7); // 70% of full — force attachment removal
    const stream = makeStream();
    const result = pruneBrief(brief, { budget, stream, now: NOW });

    assert.ok(!result.pruned.includes('## Attachments'), 'Attachments section should be removed');
    assert.ok(!result.pruned.includes('report.pdf'), 'attachment filename should be gone');
  });
});

// ── pruneBrief — priority 3: description truncation ──────────────────────────

describe('pruneBrief — priority 3: description truncation', () => {
  it('truncates long descriptions when still over budget', () => {
    const longDesc = 'D'.repeat(2000);
    const brief = makeBrief({ description: longDesc });
    const tokens = estimateTokens(brief);
    const budget = Math.ceil(tokens * 0.5); // force description trim
    const stream = makeStream();
    const result = pruneBrief(brief, { budget, stream, now: NOW });

    assert.ok(result.pruned.includes('## Description'), 'Description heading kept');
    assert.ok(result.pruned.includes('[truncated]'), 'truncation marker present');
  });

  it('keeps first 500 chars of description + ellipsis truncation marker', () => {
    const longDesc = 'A'.repeat(2000);
    const brief = makeBrief({ description: longDesc });
    const tokens = estimateTokens(brief);
    const budget = Math.ceil(tokens * 0.3); // very tight to force truncation
    const stream = makeStream();
    const result = pruneBrief(brief, { budget, stream, now: NOW });

    // After "## Description\n\n", the content should start with 500 As then truncation marker
    const descStart = result.pruned.indexOf('## Description\n\n') + '## Description\n\n'.length;
    const descContent = result.pruned.slice(descStart, descStart + 510);
    assert.ok(descContent.startsWith('A'.repeat(500)), 'first 500 chars preserved');
    assert.ok(result.pruned.includes('\n…[truncated]'), 'ellipsis truncation marker present');
  });
});

// ── pruneBrief — priority 4: linked ticket comments ──────────────────────────

describe('pruneBrief — priority 4: linked ticket comments', () => {
  it('removes linked ticket comment bodies, keeps key+summary lines', () => {
    // Make the brief large enough that 20% budget stays above the bare minimum
    // but forces pruning through all priorities including linked ticket comments.
    const longDesc = 'D'.repeat(600);
    const longCommentBody = 'Linked ticket comment body to remove. '.repeat(20);
    const brief = makeBrief({
      description: longDesc,
      linkedTickets: [
        {
          key: 'PROJ-200',
          summary: 'Parent epic',
          description: 'Some linked description.',
          comments: [
            { author: 'Carol', date: FRESH_DATE, body: longCommentBody },
          ],
        },
      ],
    });
    const tokens = estimateTokens(brief);
    // Budget tight enough to reach priority 4, but above the bare minimum
    // bare minimum ~= ceil("# PROJ-123: Fix the bug\n**Type:** Bug...".length / 4) ≈ 18
    const budget = Math.ceil(tokens * 0.3); // 30% — well above bare minimum, forces deep pruning
    const stream = makeStream();
    const result = pruneBrief(brief, { budget, stream, now: NOW });

    assert.ok(result.pruned.includes('PROJ-200'), 'linked ticket key kept');
    assert.ok(result.pruned.includes('Parent epic'), 'linked ticket summary kept');
    assert.ok(!result.pruned.includes('Linked ticket comment body to remove.'), 'linked comment body removed');
  });
});

// ── pruneBrief — drop report ──────────────────────────────────────────────────

describe('pruneBrief — drop report', () => {
  it('emits drop report to stream param', () => {
    const brief = makeBrief({
      description: 'Short desc.',
      comments: [
        { author: 'Alice', date: OLD_DATE, body: 'Old comment body that will be dropped.' },
      ],
    });
    const tokens = estimateTokens(brief);
    const budget = tokens - 5;
    const stream = makeStream();
    pruneBrief(brief, { budget, stream, now: NOW });

    assert.ok(stream.output.length > 0, 'stream should receive output');
  });

  it('drop report format starts with "  ○ Budget:"', () => {
    const brief = makeBrief({
      description: 'Short desc.',
      comments: [
        { author: 'Alice', date: OLD_DATE, body: 'Old comment that gets pruned.' },
      ],
    });
    const tokens = estimateTokens(brief);
    const budget = tokens - 5;
    const stream = makeStream();
    pruneBrief(brief, { budget, stream, now: NOW });

    assert.ok(stream.output.includes('○ Budget:'), 'drop report starts with ○ Budget:');
  });
});

// ── pruneBrief — bare minimum guard ──────────────────────────────────────────

describe('pruneBrief — bare minimum guard', () => {
  it('returns unpruned brief + warning when budget < bare minimum', () => {
    const brief = makeBrief({ description: 'Some description text.' });
    const stream = makeStream();
    const result = pruneBrief(brief, { budget: 1, stream, now: NOW }); // impossibly small budget

    // Should return the full brief (not pruned)
    assert.equal(result.pruned, brief, 'returns full brief when below bare minimum');
    assert.ok(stream.output.includes('⚠'), 'warning symbol emitted');
    assert.ok(stream.output.includes('too small'), 'warning says too small');
  });

  it('bare minimum = ticket key + summary (never prune below that)', () => {
    const brief = makeBrief({ key: 'PROJ-999', summary: 'Important ticket' });
    const stream = makeStream();
    // Budget large enough for key+summary but we verify the brief is never stripped below that
    const result = pruneBrief(brief, { budget: 1, stream, now: NOW });

    // The key and summary should survive even under budget pressure
    assert.ok(result.pruned.includes('PROJ-999'), 'ticket key preserved');
    assert.ok(result.pruned.includes('Important ticket'), 'summary preserved');
  });
});
