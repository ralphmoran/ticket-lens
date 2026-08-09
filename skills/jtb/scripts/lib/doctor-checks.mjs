/**
 * Pure diagnostic check functions for `ticketlens doctor`. Each function
 * takes DI'd dependencies (matching the xFn = defaultX pattern used
 * throughout this codebase) and returns a normalized result:
 *   { id, label, ok, message, hint, fixable }
 * No stdout/stdin, no arg parsing — independently unit-testable in
 * isolation from CLI/MCP concerns.
 *
 * checkCacheHealth returns a 7th, internal-only field beyond the six
 * above — `corruptEntries` — consumed only by doctor-command.mjs's
 * `--fix` step to know which local files to delete. It is stripped
 * before any public (CLI plain/JSON or MCP) output.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_CONFIG_DIR } from './config.mjs';
import { resolveProfile, loadCredentials, loadProfiles } from './profile-resolver.mjs';
import { checkLicense, GRACE_DAYS } from './license.mjs';
import { resolveAdapter } from './resolve-adapter.mjs';
import { classifyError } from './error-classifier.mjs';
import { testConnections } from './connection-tester.mjs';
import { formatSize } from './attachment-downloader.mjs';
import { getCacheEntries, filterEntriesByProfile } from './cache-manager.mjs';
import { readQueue } from './recall-queue.mjs';
import { readMcpConfig, ENTRY_NAME, DESIRED_MCP_ENTRY } from './mcp-install.mjs';
import { testMcpHandshake, DEFAULT_HANDSHAKE_TIMEOUT_MS } from './mcp-handshake-checker.mjs';

const NOOP_STREAM = { write: () => true };

export function checkProfileConfig({
  configDir = DEFAULT_CONFIG_DIR,
  profileName = null,
  cwd = process.cwd(),
  resolveProfileFn = resolveProfile,
  loadCredentialsFn = loadCredentials,
} = {}) {
  const profile = resolveProfileFn(null, { profileName, configDir, cwd });

  if (!profile) {
    return {
      id: 'profile-config', label: 'Profile configuration', ok: false,
      message: profileName ? `Profile "${profileName}" not found.` : 'No profile configured.',
      hint: profileName ? 'Run `ticketlens profiles` to see available profiles.' : 'Run `ticketlens init` to set up a profile.',
      fixable: false,
    };
  }

  if (!profile.baseUrl) {
    return {
      id: 'profile-config', label: 'Profile configuration', ok: false,
      message: `Profile "${profile.name}" has no baseUrl configured.`,
      hint: `Run \`ticketlens config --profile=${profile.name}\` to fix it.`,
      fixable: false,
    };
  }

  const creds = loadCredentialsFn(configDir)[profile.name] || {};
  if (!creds.apiToken && !creds.pat) {
    return {
      id: 'profile-config', label: 'Profile configuration', ok: false,
      message: `Profile "${profile.name}" has no credentials stored.`,
      hint: `Run \`ticketlens config --profile=${profile.name}\` to add an API token or PAT.`,
      fixable: false,
    };
  }

  return {
    id: 'profile-config', label: 'Profile configuration', ok: true,
    message: `Profile "${profile.name}" resolves with a baseUrl and stored credentials.`,
    hint: null, fixable: false,
  };
}

export function checkLicenseFreshness({
  configDir = DEFAULT_CONFIG_DIR,
  checkLicenseFn = checkLicense,
} = {}) {
  const status = checkLicenseFn(configDir);

  if (!status.key) {
    return {
      id: 'license-freshness', label: 'License freshness', ok: true,
      message: 'Free tier — no license to validate.', hint: null, fixable: false,
    };
  }

  if (status.expired) {
    return {
      id: 'license-freshness', label: 'License freshness', ok: false,
      message: 'License expired.',
      hint: 'Run `ticketlens activate <KEY>` to renew.', fixable: true,
    };
  }

  const daysSinceVal = status.validatedAt
    ? (Date.now() - new Date(status.validatedAt).getTime()) / 86400000
    : Infinity;

  if (daysSinceVal > GRACE_DAYS) {
    return {
      id: 'license-freshness', label: 'License freshness', ok: false,
      message: `Not revalidated in over ${GRACE_DAYS} days.`,
      hint: 'Run `ticketlens doctor --fix` to revalidate now.', fixable: true,
    };
  }

  return {
    id: 'license-freshness', label: 'License freshness', ok: true,
    message: `${status.tier} license active, last validated ${Math.floor(daysSinceVal)} day(s) ago.`,
    hint: null, fixable: false,
  };
}

export async function checkConnectivity({
  configDir = DEFAULT_CONFIG_DIR,
  profileName = null,
  cwd = process.cwd(),
  resolveProfileFn = resolveProfile,
  loadCredentialsFn = loadCredentials,
  resolveAdapterFn = resolveAdapter,
  classifyErrorFn = classifyError,
  testConnectionsFn = testConnections,
} = {}) {
  if (profileName) {
    const profile = resolveProfileFn(null, { profileName, configDir, cwd });
    if (!profile) {
      return {
        id: 'connectivity', label: 'Tracker connectivity', ok: false,
        message: `Profile "${profileName}" not found.`, hint: null, fixable: false,
      };
    }
    const creds = loadCredentialsFn(configDir)[profile.name] || {};
    if (!creds.apiToken && !creds.pat) {
      return {
        id: 'connectivity', label: 'Tracker connectivity', ok: false,
        message: `Profile "${profile.name}" has no credentials stored.`,
        hint: `Run \`ticketlens config --profile=${profile.name}\` to add an API token or PAT.`,
        fixable: false,
      };
    }
    const conn = {
      baseUrl: profile.baseUrl, auth: profile.auth, email: profile.email,
      apiToken: creds.apiToken, pat: creds.pat, allowPrivateIp: profile.allowPrivateIp,
    };
    try {
      await resolveAdapterFn(conn).fetchCurrentUser();
      return {
        id: 'connectivity', label: 'Tracker connectivity', ok: true,
        message: `Profile "${profile.name}" connected successfully.`, hint: null, fixable: false,
      };
    } catch (err) {
      const classified = classifyErrorFn(err, { baseUrl: conn.baseUrl, profileName: profile.name });
      return {
        id: 'connectivity', label: 'Tracker connectivity', ok: false,
        message: classified.message, hint: classified.hint, fixable: false,
      };
    }
  }

  const { results, failedCount } = await testConnectionsFn({ configDir, stream: NOOP_STREAM, resolveAdapterFn });
  if (results.length === 0) {
    return {
      id: 'connectivity', label: 'Tracker connectivity', ok: true,
      message: 'No profiles configured — nothing to test.', hint: null, fixable: false,
    };
  }
  const summary = results
    .map(r => r.ok ? `${r.name}: ok` : `${r.name}: ${r.error}${r.hint ? ` → ${r.hint}` : ''}`)
    .join('\n');
  return {
    id: 'connectivity', label: 'Tracker connectivity',
    ok: failedCount === 0,
    message: failedCount === 0
      ? `All ${results.length} profile(s) connected successfully.`
      : `${failedCount}/${results.length} profile(s) failed to connect.`,
    hint: failedCount === 0 ? null : summary,
    fixable: false,
  };
}

export function checkCacheHealth({
  configDir = DEFAULT_CONFIG_DIR,
  profileName = null,
  getCacheEntriesFn = getCacheEntries,
  loadProfilesFn = loadProfiles,
  filterEntriesByProfileFn = filterEntriesByProfile,
} = {}) {
  let entries = getCacheEntriesFn(configDir);
  if (profileName) {
    entries = filterEntriesByProfileFn(entries, profileName, loadProfilesFn(configDir));
  }

  const corrupt = entries.filter(e => e.size === 0);
  if (corrupt.length === 0) {
    const totalSize = entries.reduce((sum, e) => sum + e.size, 0);
    return {
      id: 'cache-health', label: 'Attachment cache', ok: true,
      message: entries.length === 0
        ? 'No cached files.'
        : `${entries.length} cached file(s), ${formatSize(totalSize)}, none corrupt.`,
      hint: null, fixable: false, corruptEntries: [],
    };
  }

  return {
    id: 'cache-health', label: 'Attachment cache', ok: false,
    message: `${corrupt.length} corrupt (0-byte) cached file(s) found.`,
    hint: 'Run `ticketlens doctor --fix` to remove them.',
    fixable: true, corruptEntries: corrupt,
  };
}

export function checkRecallQueue({
  configDir = DEFAULT_CONFIG_DIR,
  readQueueFn = readQueue,
} = {}) {
  const entries = readQueueFn(configDir);
  if (entries.length === 0) {
    return {
      id: 'recall-queue', label: 'Recall sync queue', ok: true,
      message: 'No notes pending sync.', hint: null, fixable: false,
    };
  }
  return {
    id: 'recall-queue', label: 'Recall sync queue', ok: false,
    message: `${entries.length} note(s) pending sync.`,
    hint: 'Run `ticketlens doctor --fix` to retry now, or `ticketlens recall sync`.',
    fixable: true,
  };
}

export function checkMcpRegistration({
  cwd = process.cwd(),
  existsSyncFn = existsSync,
  readMcpConfigFn = readMcpConfig,
} = {}) {
  const configPath = join(cwd, '.mcp.json');
  const read = readMcpConfigFn(configPath);

  if (!read.ok) {
    return {
      id: 'mcp-registration', label: 'MCP registration', ok: false,
      message: read.reason, hint: null, fixable: false,
    };
  }

  const existing = read.config.mcpServers?.[ENTRY_NAME];
  const registered = existing !== undefined && JSON.stringify(existing) === JSON.stringify(DESIRED_MCP_ENTRY);

  if (registered) {
    return {
      id: 'mcp-registration', label: 'MCP registration', ok: true,
      message: '"ticketlens" is registered in .mcp.json with the correct command and args.',
      hint: null, fixable: false,
    };
  }

  if (!existsSyncFn(configPath)) {
    return {
      id: 'mcp-registration', label: 'MCP registration', ok: false,
      message: 'No .mcp.json file found in the current directory.',
      hint: 'Run `ticketlens mcp install` to create it and register "ticketlens".',
      fixable: true,
    };
  }

  return {
    id: 'mcp-registration', label: 'MCP registration', ok: false,
    message: '"ticketlens" is not registered in .mcp.json.',
    hint: 'Run `ticketlens mcp install` to register it.',
    fixable: true,
  };
}

// 'timeout' is handled separately below (its message embeds the actual
// timeoutMs), so it has no entry here.
const MCP_HANDSHAKE_MESSAGES = {
  'spawn-error': 'Could not start "ticketlens mcp" — command not found or failed to launch.',
  'invalid-response': '"ticketlens mcp" responded, but not with a valid initialize result.',
};

const MCP_HANDSHAKE_HINTS = {
  'spawn-error': 'Confirm `ticketlens` is installed and on PATH, then run `ticketlens doctor --mcp` again.',
  'timeout': 'Run `ticketlens doctor --mcp` again — if it keeps timing out, check for a hung `ticketlens mcp` process.',
  'invalid-response': 'Run `ticketlens --version` to check the installed build; reinstall if the response looks corrupted.',
};

export async function checkMcpHandshake({
  timeoutMs = DEFAULT_HANDSHAKE_TIMEOUT_MS,
  testMcpHandshakeFn = testMcpHandshake,
} = {}) {
  const result = await testMcpHandshakeFn({ timeoutMs });

  if (result.ok) {
    return {
      id: 'mcp-handshake', label: 'MCP server handshake', ok: true,
      message: `MCP server handshake succeeded, protocol version ${result.protocolVersion}.`,
      hint: null, fixable: false,
    };
  }

  const message = result.reason === 'timeout'
    ? `No response from "ticketlens mcp" within ${timeoutMs}ms.`
    : MCP_HANDSHAKE_MESSAGES[result.reason] ?? 'MCP server handshake failed.';

  return {
    id: 'mcp-handshake', label: 'MCP server handshake', ok: false,
    message, hint: MCP_HANDSHAKE_HINTS[result.reason] ?? null, fixable: false,
  };
}
