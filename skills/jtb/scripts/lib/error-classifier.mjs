/**
 * Classifies fetch/HTTP errors into user-friendly messages with actionable hints.
 * Extracts cause codes from Node.js fetch errors and HTTP status from Jira API errors.
 */

function getNetworkCode(err) {
  // Node fetch wraps the real error in err.cause
  const cause = err.cause || err;
  return cause.code || cause.errno || null;
}

function getHostname(baseUrl) {
  try { return new URL(baseUrl).hostname; } catch { return baseUrl; }
}

export function classifyError(err, { baseUrl, profileName } = {}) {
  const host = baseUrl ? getHostname(baseUrl) : 'the Jira server';
  const profile = profileName || 'your profile';
  const code = getNetworkCode(err);

  // Network-level errors (fetch threw before getting an HTTP response)
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return {
      message: `DNS lookup failed for ${host}`,
      hint: 'Check your internet connection. If this is a private server, make sure your VPN is connected.',
    };
  }

  if (code === 'ECONNREFUSED') {
    return {
      message: `Connection refused by ${host}`,
      hint: 'The server is not accepting connections. Check if the Jira instance is running and the URL is correct.',
    };
  }

  if (code === 'ECONNRESET' || code === 'ECONNABORTED') {
    return {
      message: `Connection to ${host} was reset`,
      hint: 'This often happens when a VPN drops or a firewall blocks the connection. Check your VPN status.',
    };
  }

  if (code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') {
    return {
      message: `Connection to ${host} timed out`,
      hint: `The server didn't respond. If ${host} requires a VPN, make sure it's connected.`,
    };
  }

  // AbortSignal.timeout() fires a DOMException with name 'TimeoutError' as err.cause
  const causeName = (err.cause || err).name;
  if (causeName === 'TimeoutError') {
    return {
      message: `Connection to ${host} timed out`,
      hint: `The server didn't respond within the allowed time. If ${host} requires a VPN, make sure it's connected.`,
    };
  }

  if (code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' || code === 'CERT_HAS_EXPIRED' ||
      code === 'DEPTH_ZERO_SELF_SIGNED_CERT' || code === 'ERR_TLS_CERT_ALTNAME_INVALID' ||
      code === 'SELF_SIGNED_CERT_IN_CHAIN') {
    return {
      message: `SSL certificate error for ${host}`,
      hint: 'The server has an invalid or self-signed certificate. Contact your Jira admin.',
    };
  }

  // HTTP-level errors (got a response, but it was an error status)
  const status = err.status || err.statusCode;

  if (status === 401) {
    return {
      message: `Authentication failed for ${profile}`,
      hint: 'Your credentials may have expired. Check your API token or PAT in ~/.ticketlens/credentials.json.',
    };
  }

  if (status === 403) {
    return {
      message: `Access denied on ${host}`,
      hint: 'Your account does not have permission. Check your Jira access or ask an admin.',
    };
  }

  if (status === 404) {
    return {
      message: `Not found on ${host}`,
      hint: 'The ticket or endpoint does not exist. Check the ticket key and the Jira base URL in your profile.',
    };
  }

  if (status === 429) {
    return {
      message: `Rate limited by ${host}`,
      hint: 'Too many requests. Wait a moment and try again.',
    };
  }

  if (status && status >= 500) {
    return {
      message: `${host} returned a server error (${status})`,
      hint: 'The Jira instance is having issues. Try again in a few minutes.',
    };
  }

  // Generic fetch failure (e.g. "fetch failed" with no useful cause)
  if (/fetch failed/i.test(err.message) || code === 'UND_ERR_SOCKET') {
    return {
      message: `Could not reach ${host}`,
      hint: 'Check your internet connection. If this is a private server, make sure your VPN is connected.',
    };
  }

  // Fallback: return the original message
  return {
    message: err.message,
    hint: null,
  };
}
