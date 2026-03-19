/**
 * Brief data cache — stores full normalized ticket JSON so repeat fetches
 * skip the Jira API call entirely.
 *
 * Path:   ~/.ticketlens/cache/PROFILE/TICKET-KEY/brief.json
 * Format: { fetchedAt, depth, ticket }
 * TTL:    4 hours (bypassed by --no-cache)
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const DEFAULT_CONFIG_DIR = path.join(os.homedir(), '.ticketlens');
export const BRIEF_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours (default)
export const DEFAULT_BRIEF_TTL = '4h'; // human-readable default for display/config

/**
 * Returns the absolute path to the brief cache file for a given ticket + profile.
 */
export function briefCachePath(ticketKey, profileName, configDir = DEFAULT_CONFIG_DIR) {
  return path.join(configDir, 'cache', profileName || '_default', ticketKey, 'brief.json');
}

/**
 * Reads a cached brief. Returns null on:
 * - cache miss
 * - expired TTL
 * - cached depth is less than the requested depth
 *
 * @param {string} ticketKey
 * @param {string|null} profileName
 * @param {number} depth
 * @param {string} [configDir]
 * @param {number} [ttlMs] - override TTL in ms; defaults to BRIEF_TTL_MS (4h)
 * Returns { ticket, fetchedAt, cachedDepth } on hit.
 */
export function readBriefCache(ticketKey, profileName, depth, configDir = DEFAULT_CONFIG_DIR, ttlMs = BRIEF_TTL_MS) {
  const filePath = briefCachePath(ticketKey, profileName, configDir);
  if (!fs.existsSync(filePath)) return null;

  let data;
  try {
    data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }

  const age = Date.now() - new Date(data.fetchedAt).getTime();
  if (age > ttlMs) {
    try { fs.unlinkSync(filePath); } catch { /* non-fatal */ }
    return null;
  }

  // Serve cache only if cached depth covers the requested depth
  if ((data.depth ?? 0) < depth) return null;

  return { ticket: data.ticket, fetchedAt: data.fetchedAt, cachedDepth: data.depth };
}

/**
 * Writes a normalized ticket to the brief cache.
 * Non-fatal — a write failure does not affect the output.
 */
export function writeBriefCache(ticketKey, profileName, depth, ticket, configDir = DEFAULT_CONFIG_DIR) {
  const filePath = briefCachePath(ticketKey, profileName, configDir);
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify({ fetchedAt: new Date().toISOString(), depth, ticket }, null, 2));
  } catch {
    // Non-fatal
  }
}

/**
 * Removes the brief cache file for a specific ticket + profile.
 */
export function clearBriefCache(ticketKey, profileName, configDir = DEFAULT_CONFIG_DIR) {
  const filePath = briefCachePath(ticketKey, profileName, configDir);
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch { /* non-fatal */ }
}

/**
 * Returns all brief cache entries across all profiles.
 * Each entry: { profileName, ticketKey, filePath, size, mtimeMs, fetchedAt, depth }
 */
export function getBriefCacheEntries(configDir = DEFAULT_CONFIG_DIR) {
  const cacheDir = path.join(configDir, 'cache');
  if (!fs.existsSync(cacheDir)) return [];

  const entries = [];
  let profileDirs;
  try {
    profileDirs = fs.readdirSync(cacheDir).filter(d => {
      try { return fs.statSync(path.join(cacheDir, d)).isDirectory(); } catch { return false; }
    });
  } catch { return []; }

  for (const profileName of profileDirs) {
    const profileDir = path.join(cacheDir, profileName);
    let ticketDirs;
    try { ticketDirs = fs.readdirSync(profileDir); } catch { continue; }

    for (const ticketKey of ticketDirs) {
      const briefFile = path.join(profileDir, ticketKey, 'brief.json');
      if (!fs.existsSync(briefFile)) continue;
      try {
        const stat = fs.statSync(briefFile);
        let fetchedAt = null;
        let depth = null;
        try {
          const data = JSON.parse(fs.readFileSync(briefFile, 'utf8'));
          fetchedAt = data.fetchedAt ?? null;
          depth = data.depth ?? null;
        } catch { /* use nulls */ }
        entries.push({ profileName, ticketKey, filePath: briefFile, size: stat.size, mtimeMs: stat.mtimeMs, fetchedAt, depth });
      } catch { /* deleted between readdir and stat */ }
    }
  }

  return entries;
}

/**
 * Human-readable age string from an ISO timestamp.
 */
export function briefCacheAge(fetchedAt) {
  const ms = Date.now() - new Date(fetchedAt).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
