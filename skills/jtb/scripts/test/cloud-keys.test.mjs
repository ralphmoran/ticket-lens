import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  listCloudKeys,
  addCloudKey,
  removeCloudKey,
  setPriority,
  setTimeout_,
  testCloudKey,
} from '../lib/cloud-keys.mjs';

function mockConfig(fetcher, cliToken = 'test-cli-token') {
  return { cliToken, fetcher, apiBase: 'https://api.ticketlens.test' };
}

function okFetcher(body, status = 200) {
  return async (_url, _opts) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

function errFetcher(status, errorBody = {}) {
  return async () => ({
    ok: false,
    status,
    json: async () => errorBody,
  });
}

const PROVIDER_GROQ = { id: 1, provider: 'groq', masked_key: 'gsk_***xxxx', priority: 1, timeout_seconds: 5, enabled: true };
const PROVIDER_ANTHROPIC = { id: 2, provider: 'anthropic', masked_key: 'sk-ant-***xxxx', priority: 2, timeout_seconds: 5, enabled: true };

describe('listCloudKeys', () => {
  it('returns empty array when no providers configured', async () => {
    const config = mockConfig(okFetcher({ providers: [] }));
    const result = await listCloudKeys(config);
    assert.deepEqual(result, []);
  });

  it('returns providers list from API response', async () => {
    const config = mockConfig(okFetcher({ providers: [PROVIDER_GROQ, PROVIDER_ANTHROPIC] }));
    const result = await listCloudKeys(config);
    assert.equal(result.length, 2);
    assert.equal(result[0].provider, 'groq');
    assert.equal(result[1].provider, 'anthropic');
  });

  it('throws when not logged in (no cliToken)', async () => {
    const config = mockConfig(okFetcher({}), '');
    await assert.rejects(
      () => listCloudKeys(config),
      { message: /Not logged in/ }
    );
  });

  it('throws when API returns error status', async () => {
    const config = mockConfig(errFetcher(401, { error: 'Unauthenticated.' }));
    await assert.rejects(
      () => listCloudKeys(config),
      { message: /Unauthenticated/ }
    );
  });
});

describe('addCloudKey', () => {
  it('rejects unknown provider', async () => {
    const config = mockConfig(okFetcher({}));
    await assert.rejects(
      () => addCloudKey(config, 'badprovider', 'sk-longkeyhere'),
      { message: /Unknown provider/ }
    );
  });

  it('rejects key shorter than 10 chars', async () => {
    const config = mockConfig(okFetcher({}));
    await assert.rejects(
      () => addCloudKey(config, 'groq', 'short'),
      { message: /too short/ }
    );
  });

  it('creates provider with default timeout', async () => {
    let posted;
    const fetcher = async (url, opts) => {
      posted = { url, body: JSON.parse(opts.body) };
      return { ok: true, status: 201, json: async () => PROVIDER_GROQ };
    };
    const config = mockConfig(fetcher);
    const result = await addCloudKey(config, 'groq', 'gsk_abc1234567890');
    assert.equal(result.provider, 'groq');
    assert.equal(posted.body.provider, 'groq');
    assert.equal(posted.body.api_key, 'gsk_abc1234567890');
  });

  it('sends PUT for non-default timeout after store', async () => {
    const calls = [];
    const fetcher = async (url, opts) => {
      calls.push({ url, method: opts.method, body: opts.body ? JSON.parse(opts.body) : null });
      if (opts.method === 'POST') return { ok: true, status: 201, json: async () => ({ ...PROVIDER_GROQ, id: 99 }) };
      return { ok: true, status: 200, json: async () => ({}) };
    };
    const config = mockConfig(fetcher);
    await addCloudKey(config, 'groq', 'gsk_abc1234567890', 10);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].method, 'PUT');
    assert.equal(calls[1].body.timeout_seconds, 10);
    assert.ok(calls[1].url.includes('/99'));
  });

  it('supports all three providers', async () => {
    for (const provider of ['groq', 'anthropic', 'openai']) {
      const fetcher = async () => ({ ok: true, status: 201, json: async () => ({ id: 1, provider }) });
      const config = mockConfig(fetcher);
      const result = await addCloudKey(config, provider, 'sk-longkeyhere123');
      assert.equal(result.provider, provider);
    }
  });
});

describe('removeCloudKey', () => {
  it('throws when provider is not configured', async () => {
    const config = mockConfig(okFetcher({ providers: [] }));
    await assert.rejects(
      () => removeCloudKey(config, 'groq'),
      { message: /No "groq" provider/ }
    );
  });

  it('sends DELETE to correct endpoint', async () => {
    const calls = [];
    const fetcher = async (url, opts) => {
      calls.push({ url, method: opts.method });
      if (url.includes('ai-providers') && !url.match(/\/\d+/)) {
        return { ok: true, status: 200, json: async () => ({ providers: [PROVIDER_GROQ] }) };
      }
      return { ok: true, status: 204, json: async () => ({}) };
    };
    const config = mockConfig(fetcher);
    await removeCloudKey(config, 'groq');
    const del = calls.find(c => c.method === 'DELETE');
    assert.ok(del, 'DELETE request should be sent');
    assert.ok(del.url.includes('/1'), 'DELETE should target provider id=1');
  });
});

describe('setPriority', () => {
  it('throws when provider is not configured', async () => {
    const config = mockConfig(okFetcher({ providers: [] }));
    await assert.rejects(
      () => setPriority(config, 'groq', 2),
      { message: /No "groq" provider/ }
    );
  });

  it('sends PUT with priority field', async () => {
    const calls = [];
    const fetcher = async (url, opts) => {
      calls.push({ url, method: opts.method, body: opts.body ? JSON.parse(opts.body) : null });
      if (opts.method === 'GET') return { ok: true, status: 200, json: async () => ({ providers: [PROVIDER_GROQ] }) };
      return { ok: true, status: 200, json: async () => ({}) };
    };
    const config = mockConfig(fetcher);
    await setPriority(config, 'groq', 3);
    const put = calls.find(c => c.method === 'PUT');
    assert.ok(put);
    assert.equal(put.body.priority, 3);
  });
});

describe('setTimeout_', () => {
  it('throws when provider is not configured', async () => {
    const config = mockConfig(okFetcher({ providers: [] }));
    await assert.rejects(
      () => setTimeout_(config, 'anthropic', 15),
      { message: /No "anthropic" provider/ }
    );
  });

  it('sends PUT with timeout_seconds field', async () => {
    const calls = [];
    const fetcher = async (url, opts) => {
      calls.push({ url, method: opts.method, body: opts.body ? JSON.parse(opts.body) : null });
      if (opts.method === 'GET') return { ok: true, status: 200, json: async () => ({ providers: [PROVIDER_ANTHROPIC] }) };
      return { ok: true, status: 200, json: async () => ({}) };
    };
    const config = mockConfig(fetcher);
    await setTimeout_(config, 'anthropic', 20);
    const put = calls.find(c => c.method === 'PUT');
    assert.ok(put);
    assert.equal(put.body.timeout_seconds, 20);
  });
});

describe('testCloudKey', () => {
  it('throws when provider is not configured', async () => {
    const config = mockConfig(okFetcher({ providers: [] }));
    await assert.rejects(
      () => testCloudKey(config, 'openai'),
      { message: /No "openai" provider/ }
    );
  });

  it('returns test result from API', async () => {
    const testResult = { ok: true, response: 'OK' };
    const fetcher = async (url, opts) => {
      if (opts.method === 'GET') return { ok: true, status: 200, json: async () => ({ providers: [PROVIDER_GROQ] }) };
      return { ok: true, status: 200, json: async () => testResult };
    };
    const config = mockConfig(fetcher);
    const result = await testCloudKey(config, 'groq');
    assert.equal(result.ok, true);
    assert.equal(result.response, 'OK');
  });

  it('sends POST to /v1/ai-providers/{id}/test', async () => {
    const calls = [];
    const fetcher = async (url, opts) => {
      calls.push({ url, method: opts.method });
      if (opts.method === 'GET') return { ok: true, status: 200, json: async () => ({ providers: [PROVIDER_GROQ] }) };
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    };
    const config = mockConfig(fetcher);
    await testCloudKey(config, 'groq');
    const post = calls.find(c => c.method === 'POST');
    assert.ok(post, 'POST request should be sent');
    assert.ok(post.url.includes('/1/test'), 'Should POST to /ai-providers/1/test');
  });
});
