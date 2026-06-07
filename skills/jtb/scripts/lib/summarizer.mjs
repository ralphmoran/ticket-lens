import { apiBase } from './api-utils.mjs';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_PROMPT = 'Summarize this Jira ticket in 3 sentences. Focus on what matters most for implementation. Be concrete.\n\n';
const DEFAULT_MAX_TOKENS = 256;

/**
 * Summarize a ticket brief using BYOK or cloud mode.
 * @param {object} opts
 * @param {string} opts.brief - Markdown brief text
 * @param {'byok'|'cloud'} opts.mode
 * @param {object} [opts.credentials] - { anthropicApiKey?, openaiApiKey?, groqApiKey? }
 * @param {string} [opts.cliToken] - CLI session token (required for cloud mode)
 * @param {Function} [opts.fetcher] - Injectable for tests (defaults to globalThis.fetch)
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<string>} Summary text
 */
export async function summarize({ brief, mode, credentials = null, cliToken = null, fetcher = globalThis.fetch, timeoutMs = 30_000, prompt, maxTokens, provider }) {
  const effectivePrompt = prompt ?? DEFAULT_PROMPT;
  const effectiveMaxTokens = maxTokens ?? DEFAULT_MAX_TOKENS;
  if (mode === 'byok') {
    return byok({ brief, credentials, fetcher, timeoutMs, prompt: effectivePrompt, maxTokens: effectiveMaxTokens, provider });
  }
  return cloud({ brief, cliToken, fetcher, timeoutMs });
}

async function byok({ brief, credentials, fetcher, timeoutMs, prompt, maxTokens, provider }) {
  const anthropicKey = credentials?.anthropicApiKey;
  const openaiKey = credentials?.openaiApiKey;
  const groqKey = credentials?.groqApiKey;

  if (provider === 'anthropic') {
    if (!anthropicKey) throw new Error('No ANTHROPIC_API_KEY found. Add it to ~/.ticketlens/credentials.json');
    return callAnthropic({ brief, apiKey: anthropicKey, fetcher, timeoutMs, prompt, maxTokens });
  }
  if (provider === 'openai') {
    if (!openaiKey) throw new Error('No OPENAI_API_KEY found. Add it to ~/.ticketlens/credentials.json');
    return callOpenAi({ brief, apiKey: openaiKey, fetcher, timeoutMs, prompt, maxTokens });
  }
  if (provider === 'groq') {
    if (!groqKey) throw new Error('No GROQ_API_KEY found. Add it to ~/.ticketlens/credentials.json');
    return callGroq({ brief, apiKey: groqKey, fetcher, timeoutMs, prompt, maxTokens });
  }

  if (!anthropicKey && !openaiKey && !groqKey) {
    throw new Error('No API key found. Add ANTHROPIC_API_KEY, OPENAI_API_KEY, or GROQ_API_KEY to ~/.ticketlens/credentials.json');
  }
  if (anthropicKey) return callAnthropic({ brief, apiKey: anthropicKey, fetcher, timeoutMs, prompt, maxTokens });
  if (openaiKey) return callOpenAi({ brief, apiKey: openaiKey, fetcher, timeoutMs, prompt, maxTokens });
  return callGroq({ brief, apiKey: groqKey, fetcher, timeoutMs, prompt, maxTokens });
}

async function callAnthropic({ brief, apiKey, fetcher, timeoutMs, prompt, maxTokens }) {
  const res = await fetcher(ANTHROPIC_URL, {
    method: 'POST',
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt + brief }],
    }),
  });

  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).error?.message || ''; } catch {}
    const err = new Error(`Anthropic API error ${res.status}${detail ? ': ' + detail : ''}`);
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  return data.content[0].text;
}

async function callOpenAi({ brief, apiKey, fetcher, timeoutMs, prompt, maxTokens }) {
  const res = await fetcher(OPENAI_URL, {
    method: 'POST',
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt + brief }],
    }),
  });

  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).error?.message || ''; } catch {}
    const err = new Error(`OpenAI API error ${res.status}${detail ? ': ' + detail : ''}`);
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  return data.choices[0].message.content;
}

async function callGroq({ brief, apiKey, fetcher, timeoutMs, prompt, maxTokens }) {
  const res = await fetcher(GROQ_URL, {
    method: 'POST',
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'llama-3.1-8b-instant',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt + brief }],
    }),
  });

  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).error?.message || ''; } catch {}
    const err = new Error(`Groq API error ${res.status}${detail ? ': ' + detail : ''}`);
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  return data.choices[0].message.content;
}

async function cloud({ brief, cliToken, fetcher, timeoutMs }) {
  if (!cliToken) throw new Error('Not logged in. Run `ticketlens login` first.');
  const res = await fetcher(`${apiBase()}/v1/summarize`, {
    method: 'POST',
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${cliToken}`,
    },
    body: JSON.stringify({ brief }),
  });

  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).error ?? ''; } catch {}
    if (!detail && res.status === 503) detail = 'No AI provider configured on the backend. Run: ticketlens cloud-keys add groq <key>';
    if (!detail && res.status === 500) detail = 'Server error (the backend may need `php artisan migrate` after a recent update)';
    const err = new Error(detail || `TicketLens API error ${res.status}`);
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  return data.summary;
}
