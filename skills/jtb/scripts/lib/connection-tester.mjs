/**
 * Tests every configured profile's connection, one at a time with a spinner
 * per profile — the same pattern init-wizard.mjs/config-wizard.mjs already
 * use for a single profile, just looped across all of them.
 */

import { createSession } from './banner.mjs';
import { classifyError } from './error-classifier.mjs';
import { resolveAdapter } from './resolve-adapter.mjs';
import { loadProfiles, loadCredentials } from './profile-resolver.mjs';
import { DEFAULT_CONFIG_DIR } from './config.mjs';

export async function testConnections({
  configDir = DEFAULT_CONFIG_DIR,
  stream = process.stderr,
  resolveAdapterFn = resolveAdapter,
} = {}) {
  const config = loadProfiles(configDir);
  const names = config ? Object.keys(config.profiles) : [];
  const creds = loadCredentials(configDir);
  const results = [];

  for (const name of names) {
    const profile = config.profiles[name];
    const profileCreds = creds[name] || {};
    const conn = {
      baseUrl: profile.baseUrl,
      auth: profile.auth,
      email: profile.email,
      apiToken: profileCreds.apiToken,
      pat: profileCreds.pat,
    };

    const session = createSession(
      { baseUrl: conn.baseUrl, profileName: name, email: conn.email || undefined, pat: conn.auth === 'pat' ? conn.pat : undefined },
      { stream },
    );
    session.spin('Testing connection...');

    try {
      await resolveAdapterFn(conn).fetchCurrentUser();
      session.connected();
      results.push({ name, ok: true });
    } catch (err) {
      session.failed();
      const classified = classifyError(err, { baseUrl: conn.baseUrl, profileName: name });
      session.footer(classified.message, 'error', classified.hint);
      results.push({ name, ok: false, error: classified.message });
    }
  }

  return { results, failedCount: results.filter(r => !r.ok).length };
}
