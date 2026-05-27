/**
 * Shared API URL utilities for triage push, share, and collisions.
 * Centralised here to avoid triplicating the regex and warning logic.
 */

export const DEFAULT_API_BASE = 'https://api.ticketlens.dev';

// Matches localhost, 127.0.0.1, and any hostname ending in .test or .local,
// with an optional port — all treated as local-only addresses.
const LOCAL_HOST_RE = /^https?:\/\/(localhost|127\.0\.0\.1|[^/:]+\.(test|local))(:\d+)?(\/|$)/i;

export function apiBase() {
  return process.env?.TICKETLENS_API_URL ?? DEFAULT_API_BASE;
}

export function warnIfInsecure(url, warn) {
  if (url.startsWith('http://') && !LOCAL_HOST_RE.test(url)) {
    warn('⚠ Warning: TICKETLENS_API_URL uses an unencrypted HTTP connection. Use https:// for production.\n');
  }
}
