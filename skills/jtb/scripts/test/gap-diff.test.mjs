import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { computeGaps } from '../lib/gap-diff.mjs';

describe('computeGaps', () => {
  test('a ticket with no linked tickets and no attachments returns no gaps', () => {
    const ticket = { key: 'PROD-1', description: 'Fix the checkout button color.' };
    assert.deepEqual(computeGaps(ticket), []);
  });

  test('a requirement in a linked ticket, absent from the current description, is a gap with ticket provenance', () => {
    const ticket = {
      key: 'PROD-1',
      description: 'Fix the checkout button color.',
      linkedTicketDetails: [
        { key: 'PROD-2', summary: 'Payment retries', description: '- must support exponential backoff retries' },
      ],
    };
    const gaps = computeGaps(ticket);
    assert.equal(gaps.length, 1);
    assert.equal(gaps[0].sourceType, 'ticket');
    assert.equal(gaps[0].sourceKey, 'PROD-2');
    assert.equal(gaps[0].sourceSummary, 'Payment retries');
    assert.match(gaps[0].requirement, /exponential backoff/);
  });

  test('a requirement already covered by the current description is not a gap', () => {
    const ticket = {
      key: 'PROD-1',
      description: 'This ticket must support exponential backoff retries for checkout.',
      linkedTicketDetails: [
        { key: 'PROD-2', summary: 'Payment retries', description: '- must support exponential backoff retries' },
      ],
    };
    assert.deepEqual(computeGaps(ticket), []);
  });

  test('linkedTicketDetails nested at depth 2 are flattened and diffed too', () => {
    const ticket = {
      key: 'PROD-1',
      description: 'Fix the checkout button color.',
      linkedTicketDetails: [
        {
          key: 'PROD-2',
          summary: 'Parent linked ticket',
          description: 'No requirements here.',
          linkedTicketDetails: [
            { key: 'PROD-3', summary: 'Nested linked ticket', description: '- must support retry queue draining' },
          ],
        },
      ],
    };
    const gaps = computeGaps(ticket);
    assert.equal(gaps.length, 1);
    assert.equal(gaps[0].sourceKey, 'PROD-3');
  });

  test('an identical requirement repeated across two linked tickets is deduped to one gap', () => {
    const ticket = {
      key: 'PROD-1',
      description: 'Fix the checkout button color.',
      linkedTicketDetails: [
        { key: 'PROD-2', summary: 'A', description: '- must support retry queue draining' },
        { key: 'PROD-3', summary: 'B', description: '- must support retry queue draining' },
      ],
    };
    const gaps = computeGaps(ticket);
    assert.equal(gaps.length, 1);
    assert.equal(gaps[0].sourceKey, 'PROD-2', 'keeps the first source it was found in');
  });

  test('a requirement found only in a downloaded attachment is a gap with attachment provenance', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ticketlens-gapdiff-'));
    const filePath = join(dir, 'spec.md');
    writeFileSync(filePath, '- must support CSV export');
    const ticket = {
      key: 'PROD-1',
      description: 'Fix the checkout button color.',
      localAttachments: [{ filename: 'spec.md', localPath: filePath }],
    };
    try {
      const gaps = computeGaps(ticket);
      assert.equal(gaps.length, 1);
      assert.equal(gaps[0].sourceType, 'attachment');
      assert.equal(gaps[0].sourceKey, 'spec.md');
      assert.equal(gaps[0].sourceSummary, undefined);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a cyclic linkedTicketDetails graph terminates and still finds the real gap exactly once', () => {
    const a = { key: 'PROD-A', description: 'desc a' };
    const b = { key: 'PROD-B', summary: 'B', description: '- must support cyclic safety' };
    a.linkedTicketDetails = [b];
    b.linkedTicketDetails = [a];
    const gaps = computeGaps(a);
    assert.equal(gaps.length, 1);
    assert.equal(gaps[0].sourceKey, 'PROD-B');
  });

  test('a cyclic linkedTicketDetails graph never cites the root ticket as its own gap source', () => {
    // "must go" has only one keyword ("go") short enough to be filtered by
    // diff-analyzer's stop-word/length rules, so a requirement extracted from
    // the root's own description would NOT_FOUND against that same
    // description if the root were ever (wrongly) included in its own
    // flattened linked-ticket list — this is what exposes self-citation.
    const root = { key: 'PROD-A', description: '- must go' };
    const linked = { key: 'PROD-B', summary: 'B', description: '- must support retries' };
    root.linkedTicketDetails = [linked];
    linked.linkedTicketDetails = [root];
    const gaps = computeGaps(root);
    assert.ok(!gaps.some(g => g.sourceKey === 'PROD-A'), 'root ticket must never appear as a gap source citing itself');
  });

  test('handles a ticket with no description without crashing', () => {
    const ticket = {
      key: 'PROD-1',
      linkedTicketDetails: [{ key: 'PROD-2', description: '- must do something' }],
    };
    assert.doesNotThrow(() => computeGaps(ticket));
  });

  test('gracefully handles a linked ticket with no localAttachments field', () => {
    const ticket = { key: 'PROD-1', description: 'x' };
    assert.doesNotThrow(() => computeGaps(ticket));
  });

  test('is a pure function over its linked-ticket input — same input gives the same output', () => {
    const ticket = {
      key: 'PROD-1',
      description: 'Fix the checkout button color.',
      linkedTicketDetails: [
        { key: 'PROD-2', summary: 'A', description: '- must support retry queue draining' },
      ],
    };
    const first = computeGaps(ticket);
    const second = computeGaps(ticket);
    assert.deepEqual(first, second);
  });
});
