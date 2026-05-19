import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { summarize } from '../lib/summarizer.mjs';

const MOCK_BRIEF = '# PROJ-123: Fix empty cart\n**Status:** Code Review\n\nValidate empty cart on checkout.';

function mockAnthropicFetch(expectedSummary = 'This ticket fixes cart validation.') {
  return async (url, opts) => {
    if (url.includes('anthropic.com')) {
      return {
        ok: true,
        json: async () => ({ content: [{ text: expectedSummary }] }),
      };
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
}

function mockOpenAiFetch(expectedSummary = 'OpenAI summary.') {
  return async (url) => {
    if (url.includes('openai.com')) {
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: expectedSummary } }] }),
      };
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
}

describe('summarize — BYOK mode', () => {
  it('calls Anthropic API when anthropicApiKey is set', async () => {
    const result = await summarize({
      brief: MOCK_BRIEF,
      mode: 'byok',
      credentials: { anthropicApiKey: 'sk-ant-test' },
      fetcher: mockAnthropicFetch('Cart validation summary.'),
    });
    assert.equal(result, 'Cart validation summary.');
  });

  it('calls OpenAI API when openaiApiKey is set and no anthropicApiKey', async () => {
    const result = await summarize({
      brief: MOCK_BRIEF,
      mode: 'byok',
      credentials: { openaiApiKey: 'sk-openai-test' },
      fetcher: mockOpenAiFetch('OpenAI cart summary.'),
    });
    assert.equal(result, 'OpenAI cart summary.');
  });

  it('prefers Anthropic over OpenAI when both keys present', async () => {
    const called = [];
    const fetcher = async (url) => {
      called.push(url.includes('anthropic') ? 'anthropic' : 'openai');
      return { ok: true, json: async () => ({ content: [{ text: 'ok' }] }) };
    };
    await summarize({
      brief: MOCK_BRIEF,
      mode: 'byok',
      credentials: { anthropicApiKey: 'sk-ant', openaiApiKey: 'sk-oai' },
      fetcher,
    });
    assert.equal(called[0], 'anthropic');
  });

  it('throws when no API key provided in byok mode', async () => {
    await assert.rejects(
      () => summarize({ brief: MOCK_BRIEF, mode: 'byok', credentials: {}, fetcher: mockAnthropicFetch() }),
      { message: /no api key/i }
    );
  });

  it('throws when credentials is null', async () => {
    await assert.rejects(
      () => summarize({ brief: MOCK_BRIEF, mode: 'byok', credentials: null, fetcher: mockAnthropicFetch() }),
      { message: /no api key/i }
    );
  });

  it('throws on Anthropic API non-2xx response', async () => {
    const fetcher = async () => ({ ok: false, status: 401, json: async () => ({}) });
    await assert.rejects(
      () => summarize({ brief: MOCK_BRIEF, mode: 'byok', credentials: { anthropicApiKey: 'bad' }, fetcher }),
      { message: /anthropic api error 401/i }
    );
  });
});

describe('summarize — Groq BYOK', () => {
  function mockGroqFetch(expectedSummary = 'Groq summary.') {
    return async (url) => {
      if (url.includes('groq.com')) {
        return { ok: true, json: async () => ({ choices: [{ message: { content: expectedSummary } }] }) };
      }
      throw new Error(`Unexpected URL: ${url}`);
    };
  }

  it('calls Groq API when groqApiKey is set', async () => {
    const result = await summarize({
      brief: MOCK_BRIEF,
      mode: 'byok',
      credentials: { groqApiKey: 'gsk_test' },
      fetcher: mockGroqFetch('Groq handoff summary.'),
    });
    assert.equal(result, 'Groq handoff summary.');
  });

  it('prefers Anthropic over Groq when both keys present', async () => {
    const called = [];
    const fetcher = async (url) => {
      called.push(url.includes('anthropic') ? 'anthropic' : 'groq');
      return { ok: true, json: async () => ({ content: [{ text: 'ok' }] }) };
    };
    await summarize({
      brief: MOCK_BRIEF,
      mode: 'byok',
      credentials: { anthropicApiKey: 'sk-ant', groqApiKey: 'gsk_test' },
      fetcher,
    });
    assert.equal(called[0], 'anthropic');
  });

  it('prefers OpenAI over Groq when both keys present', async () => {
    const called = [];
    const fetcher = async (url) => {
      called.push(url.includes('openai') ? 'openai' : 'groq');
      return { ok: true, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) };
    };
    await summarize({
      brief: MOCK_BRIEF,
      mode: 'byok',
      credentials: { openaiApiKey: 'sk-oai', groqApiKey: 'gsk_test' },
      fetcher,
    });
    assert.equal(called[0], 'openai');
  });

  it('throws on Groq non-2xx response with error detail', async () => {
    const fetcher = async () => ({
      ok: false, status: 429,
      json: async () => ({ error: { message: 'Rate limit exceeded' } }),
    });
    await assert.rejects(
      () => summarize({ brief: MOCK_BRIEF, mode: 'byok', credentials: { groqApiKey: 'gsk_bad' }, fetcher }),
      { message: /groq api error 429.*rate limit/i }
    );
  });

  it('error message mentions GROQ_API_KEY when no key found', async () => {
    await assert.rejects(
      () => summarize({ brief: MOCK_BRIEF, mode: 'byok', credentials: {}, fetcher: mockGroqFetch() }),
      { message: /GROQ_API_KEY/ }
    );
  });
});

describe('summarize — explicit provider selection', () => {
  it('calls Anthropic when provider=anthropic', async () => {
    const called = [];
    const fetcher = async (url) => {
      called.push(url.includes('anthropic') ? 'anthropic' : url.includes('openai') ? 'openai' : 'groq');
      return { ok: true, json: async () => ({ content: [{ text: 'anthropic result' }] }) };
    };
    const result = await summarize({
      brief: MOCK_BRIEF,
      mode: 'byok',
      provider: 'anthropic',
      credentials: { anthropicApiKey: 'sk-ant', openaiApiKey: 'sk-oai', groqApiKey: 'gsk_test' },
      fetcher,
    });
    assert.equal(result, 'anthropic result');
    assert.equal(called[0], 'anthropic');
  });

  it('calls OpenAI when provider=openai', async () => {
    const called = [];
    const fetcher = async (url) => {
      called.push(url.includes('openai') ? 'openai' : 'other');
      return { ok: true, json: async () => ({ choices: [{ message: { content: 'openai result' } }] }) };
    };
    const result = await summarize({
      brief: MOCK_BRIEF,
      mode: 'byok',
      provider: 'openai',
      credentials: { anthropicApiKey: 'sk-ant', openaiApiKey: 'sk-oai' },
      fetcher,
    });
    assert.equal(result, 'openai result');
    assert.equal(called[0], 'openai');
  });

  it('calls Groq when provider=groq', async () => {
    const called = [];
    const fetcher = async (url) => {
      called.push(url.includes('groq') ? 'groq' : 'other');
      return { ok: true, json: async () => ({ choices: [{ message: { content: 'groq result' } }] }) };
    };
    const result = await summarize({
      brief: MOCK_BRIEF,
      mode: 'byok',
      provider: 'groq',
      credentials: { anthropicApiKey: 'sk-ant', groqApiKey: 'gsk_test' },
      fetcher,
    });
    assert.equal(result, 'groq result');
    assert.equal(called[0], 'groq');
  });

  it('throws when provider=anthropic but no anthropicApiKey', async () => {
    await assert.rejects(
      () => summarize({ brief: MOCK_BRIEF, mode: 'byok', provider: 'anthropic', credentials: { groqApiKey: 'gsk_test' }, fetcher: async () => ({}) }),
      { message: /ANTHROPIC_API_KEY/i }
    );
  });

  it('throws when provider=openai but no openaiApiKey', async () => {
    await assert.rejects(
      () => summarize({ brief: MOCK_BRIEF, mode: 'byok', provider: 'openai', credentials: { groqApiKey: 'gsk_test' }, fetcher: async () => ({}) }),
      { message: /OPENAI_API_KEY/i }
    );
  });

  it('throws when provider=groq but no groqApiKey', async () => {
    await assert.rejects(
      () => summarize({ brief: MOCK_BRIEF, mode: 'byok', provider: 'groq', credentials: { anthropicApiKey: 'sk-ant' }, fetcher: async () => ({}) }),
      { message: /GROQ_API_KEY/i }
    );
  });
});

describe('summarize — cloud mode', () => {
  it('calls TicketLens backend with Bearer token', async () => {
    const calls = [];
    const fetcher = async (url, opts) => {
      calls.push({ url, auth: opts.headers['Authorization'] });
      return { ok: true, json: async () => ({ summary: 'Cloud summary.' }) };
    };
    const result = await summarize({
      brief: MOCK_BRIEF,
      mode: 'cloud',
      licenseKey: 'lic-test-123',
      fetcher,
    });
    assert.equal(result, 'Cloud summary.');
    assert.ok(calls[0].url.includes('ticketlens.dev'));
    assert.equal(calls[0].auth, 'Bearer lic-test-123');
  });

  it('throws on cloud endpoint error', async () => {
    const fetcher = async () => ({ ok: false, status: 402, json: async () => ({}) });
    await assert.rejects(
      () => summarize({ brief: MOCK_BRIEF, mode: 'cloud', licenseKey: 'lic', fetcher }),
      { message: /ticketlens api error 402/i }
    );
  });
});
