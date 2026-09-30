import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  FREE_MAX_ATTACHMENTS,
  PAID_MAX_ATTACHMENTS,
  attachmentCapFor,
  attachmentLimitNotice,
} from '../lib/attachment-caps.mjs';

describe('attachment caps', () => {
  it('gives free accounts 10 files', () => {
    assert.equal(FREE_MAX_ATTACHMENTS, 10);
  });

  it('gives paid accounts 50 files', () => {
    assert.equal(PAID_MAX_ATTACHMENTS, 50);
  });
});

describe('attachmentCapFor', () => {
  it('returns the free cap when the account is not pro-licensed', () => {
    assert.equal(attachmentCapFor('/cfg', () => false), FREE_MAX_ATTACHMENTS);
  });

  it('returns the paid cap when the account is pro-licensed', () => {
    assert.equal(attachmentCapFor('/cfg', () => true), PAID_MAX_ATTACHMENTS);
  });

  it('asks for the pro tier in the given config dir', () => {
    const calls = [];
    attachmentCapFor('/cfg', (tier, dir) => { calls.push([tier, dir]); return true; });
    assert.deepEqual(calls, [['pro', '/cfg']]);
  });
});

describe('attachmentLimitNotice', () => {
  it('names the count and the cap', () => {
    const msg = attachmentLimitNotice(3, PAID_MAX_ATTACHMENTS);
    assert.match(msg, /3 attachment\(s\)/);
    assert.match(msg, /50-file limit/);
  });

  it('hints at the Pro upgrade on the free cap', () => {
    assert.match(attachmentLimitNotice(2, FREE_MAX_ATTACHMENTS), /Pro.*50/);
  });

  it('gives no upgrade hint on the paid cap', () => {
    assert.doesNotMatch(attachmentLimitNotice(2, PAID_MAX_ATTACHMENTS), /Upgrade/);
  });
});
