/**
 * cloud-keys.mjs — manage per-user AI provider keys stored encrypted on the backend.
 *
 * All operations require a CLI token (set via `ticketlens login`).
 */

const SUPPORTED_PROVIDERS = ['groq', 'anthropic', 'openai'];

function apiBase(config) {
  return (config.apiBase || 'https://api.ticketlens.io').replace(/\/$/, '');
}

async function fetchApi(config, path, method = 'GET', body = null) {
  const cliToken = config.cliToken;
  if (!cliToken) {
    throw new Error('Not logged in. Run `ticketlens login` first.');
  }

  const opts = {
    method,
    headers: {
      'Authorization': `Bearer ${cliToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
  };
  if (body !== null) opts.body = JSON.stringify(body);

  const fetcher = config.fetcher ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  let res;
  try {
    res = await fetcher(`${apiBase(config)}${path}`, { ...opts, signal: controller.signal });
  } catch (err) {
    throw new Error(err.name === 'AbortError' ? 'Request timed out.' : err.message);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { msg = (await res.json()).error ?? msg; } catch {}
    throw new Error(msg);
  }

  return res.json();
}

export async function listCloudKeys(config) {
  const data = await fetchApi(config, '/v1/ai-providers');
  return data.providers ?? [];
}

async function findProvider(config, provider) {
  const providers = await listCloudKeys(config);
  const target = providers.find(p => p.provider === provider);
  if (!target) throw new Error(`No "${provider}" provider configured.`);
  return target;
}

export async function addCloudKey(config, provider, apiKey, timeout = 5) {
  if (!SUPPORTED_PROVIDERS.includes(provider)) {
    throw new Error(`Unknown provider "${provider}". Supported: ${SUPPORTED_PROVIDERS.join(', ')}.`);
  }
  if (apiKey.length < 10) {
    throw new Error('API key too short. Check your key and try again.');
  }

  const created = await fetchApi(config, '/v1/ai-providers', 'POST', {
    provider,
    api_key: apiKey,
  });

  if (timeout !== 5) {
    await fetchApi(config, `/v1/ai-providers/${created.id}`, 'PUT', { timeout_seconds: timeout });
  }

  return created;
}

export async function removeCloudKey(config, provider) {
  const target = await findProvider(config, provider);
  await fetchApi(config, `/v1/ai-providers/${target.id}`, 'DELETE');
}

export async function setPriority(config, provider, priority) {
  const target = await findProvider(config, provider);
  await fetchApi(config, `/v1/ai-providers/${target.id}`, 'PUT', { priority: Number(priority) });
}

export async function setTimeout_(config, provider, seconds) {
  const target = await findProvider(config, provider);
  await fetchApi(config, `/v1/ai-providers/${target.id}`, 'PUT', { timeout_seconds: Number(seconds) });
}

export async function testCloudKey(config, provider) {
  const target = await findProvider(config, provider);
  return fetchApi(config, `/v1/ai-providers/${target.id}/test`, 'POST');
}
