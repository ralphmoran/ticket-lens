import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { apiBase, siteBase, DEFAULT_API_BASE, DEFAULT_SITE_BASE } from '../lib/api-utils.mjs';

describe('siteBase', () => {
  it('defaults to https://ticketlens.app', () => {
    assert.equal(DEFAULT_SITE_BASE, 'https://ticketlens.app');
    const original = process.env.TICKETLENS_SITE_URL;
    delete process.env.TICKETLENS_SITE_URL;
    try {
      assert.equal(siteBase(), 'https://ticketlens.app');
    } finally {
      if (original !== undefined) process.env.TICKETLENS_SITE_URL = original;
    }
  });

  it('LOCK: TICKETLENS_SITE_URL env override still wins over the default', () => {
    const original = process.env.TICKETLENS_SITE_URL;
    process.env.TICKETLENS_SITE_URL = 'http://ticketlens.test';
    try {
      assert.equal(siteBase(), 'http://ticketlens.test');
    } finally {
      if (original === undefined) delete process.env.TICKETLENS_SITE_URL;
      else process.env.TICKETLENS_SITE_URL = original;
    }
  });
});

describe('apiBase', () => {
  it('LOCK: default is unchanged by the site-domain fix', () => {
    assert.equal(DEFAULT_API_BASE, 'http://api.ticketlens.test');
    const original = process.env.TICKETLENS_API_URL;
    delete process.env.TICKETLENS_API_URL;
    try {
      assert.equal(apiBase(), 'http://api.ticketlens.test');
    } finally {
      if (original !== undefined) process.env.TICKETLENS_API_URL = original;
    }
  });
});
