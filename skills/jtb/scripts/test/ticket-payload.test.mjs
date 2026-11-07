import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildTicketPayload, PUSH_MAX_LABELS, PUSH_MAX_LABEL_LENGTH } from '../lib/ticket-payload.mjs';

const scored = { ticketKey: 'PROJ-1', summary: 'S', status: 'Open', urgency: 'aging' };
const payloadFor = (raw) => buildTicketPayload(scored, new Map([['PROJ-1', raw]]), 'https://jira.example.com');

describe('buildTicketPayload — labels', () => {
  it('LOCK: passes ordinary labels through unchanged, in order', () => {
    assert.deepEqual(payloadFor({ labels: ['critical', 'backend', 'good first issue'] }).labels, ['critical', 'backend', 'good first issue']);
  });

  it('LOCK: no raw ticket, or no labels, gives an empty list', () => {
    assert.deepEqual(buildTicketPayload(scored, new Map(), null).labels, []);
    assert.deepEqual(payloadFor({}).labels, []);
    assert.deepEqual(payloadFor({ labels: 'critical' }).labels, []);
  });

  it('sends at most the number of labels the Console API accepts — one more would 422 the whole snapshot', () => {
    const labels = Array.from({ length: PUSH_MAX_LABELS + 10 }, (_, i) => `l${i}`);
    const sent = payloadFor({ labels }).labels;
    assert.equal(sent.length, PUSH_MAX_LABELS);
    assert.equal(sent[0], 'l0');
  });

  it('shortens a label that is longer than the Console API accepts', () => {
    const sent = payloadFor({ labels: ['a'.repeat(PUSH_MAX_LABEL_LENGTH + 40), 'short'] }).labels;
    assert.equal(sent[0].length, PUSH_MAX_LABEL_LENGTH);
    assert.equal(sent[1], 'short');
  });

  it('drops blank and non-string entries the API would reject', () => {
    assert.deepEqual(payloadFor({ labels: ['ok', '', null, 42, { name: 'x' }] }).labels, ['ok']);
  });
});
