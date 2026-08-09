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

    if (!profileCreds.apiToken && !profileCreds.pat) {
      // No point attempting a network call with no credentials — but still
      // drive the session through spin()/failed()/footer() so callers that
      // render `stream` live (e.g. onboarding.mjs's "Test connections" menu
      // item, which discards this function's return value and relies
      // entirely on stream output for user feedback) don't go silent.
      const session = createSession({ baseUrl: profile.baseUrl, profileName: name, email: profile.email || undefined }, { stream });
      const hint = `Run \`ticketlens config --profile=${name}\` to add an API token or PAT.`;
      session.spin('Testing connection...');
      session.failed();
      session.footer('No credentials stored.', 'error', hint);
      results.push({ name, ok: false, error: 'No credentials stored.', hint });
      continue;
    }

    const conn = {
      baseUrl: profile.baseUrl,
      auth: profile.auth,
      email: profile.email,
      apiToken: profileCreds.apiToken,
      pat: profileCreds.pat,
      allowPrivateIp: profile.allowPrivateIp,
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
      results.push({ name, ok: false, error: classified.message, hint: classified.hint });
    }
  }

  return { results, failedCount: results.filter(r => !r.ok).length };
}
