/**
 * Registers `ticketlens mcp` into the current project's `.mcp.json` so the
 * user doesn't have to hand-write the JSON. Project-scoped only — Claude
 * Code's MCP config has no global/user-level equivalent (confirmed by
 * inspecting a real ~/.claude.json: no top-level `mcpServers` key, it's
 * nested per-project). Never touches ~/.claude.json directly.
 *
 * Mirrors hooks-setup.mjs's already-proven safe-merge pattern: malformed
 * JSON is left untouched (never overwritten), the write is atomic (temp
 * file + rename — real guarantee on POSIX, still the best available
 * cross-platform approach on Windows), and every other key in the file is
 * preserved exactly. Registration itself is never license-gated — same as
 * `ticketlens mcp`/`note add`/`recall`, which all exist for everyone and
 * gate only at actual invocation.
 */

import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_CONFIG_DIR } from './config.mjs';
import { isLicensed } from './license.mjs';
import { createStyler } from './ansi.mjs';

const ENTRY_NAME = 'ticketlens';

function readConfig(configPath) {
  if (!existsSync(configPath)) return { ok: true, config: {} };
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch {
    return { ok: false, reason: `${configPath} is not valid JSON — left untouched. Fix or remove it, then retry.` };
  }
  // Valid JSON whose top level isn't a plain object (array/null/number/string/
  // boolean) is still valid to parse — `typeof null === 'object'` and arrays
  // are objects too, so both need an explicit check, not just "did it parse."
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: `${configPath}'s top level is not a JSON object — left untouched. Fix or remove it, then retry.` };
  }
  if (parsed.mcpServers !== undefined && (typeof parsed.mcpServers !== 'object' || parsed.mcpServers === null || Array.isArray(parsed.mcpServers))) {
    return { ok: false, reason: `${configPath}'s "mcpServers" key is not an object — left untouched. Fix or remove it, then retry.` };
  }
  return { ok: true, config: parsed };
}

/**
 * @returns {{ written: boolean, dryRun: boolean, path: string, alreadyCorrect?: boolean, reason?: string }}
 */
export function mcpInstall({
  cwd = process.cwd(),
  isLicensedFn = isLicensed,
  configDir = DEFAULT_CONFIG_DIR,
  stream = process.stdout,
  dryRun = false,
} = {}) {
  const configPath = join(cwd, '.mcp.json');
  const s = createStyler({ isTTY: stream.isTTY });

  const read = readConfig(configPath);
  if (!read.ok) {
    stream.write(`  ${s.dim('✗')} ${read.reason}\n`);
    return { written: false, dryRun, path: configPath, reason: read.reason };
  }

  const config = read.config;
  config.mcpServers ??= {};
  const desired = { command: ENTRY_NAME, args: ['mcp'] };
  const existing = config.mcpServers[ENTRY_NAME];
  const alreadyCorrect = existing !== undefined && JSON.stringify(existing) === JSON.stringify(desired);
  config.mcpServers[ENTRY_NAME] = desired;

  const serialized = JSON.stringify(config, null, 2) + '\n';

  if (dryRun) {
    stream.write(`  Would write ${configPath}:\n\n${serialized}\n`);
    return { written: false, dryRun: true, path: configPath, alreadyCorrect };
  }

  if (alreadyCorrect) {
    stream.write(`  ${s.dim('✔')} Already registered in ${configPath}\n`);
  } else {
    const tmpPath = `${configPath}.${process.pid}.tmp`;
    writeFileSync(tmpPath, serialized, 'utf8');
    renameSync(tmpPath, configPath); // atomic on POSIX; best available cross-platform approach on Windows
    stream.write(`  ${s.brand('✔')} Registered "ticketlens" in ${configPath}\n`);
  }

  if (!isLicensedFn('pro', configDir)) {
    stream.write(`  ${s.dim('Note: recall_add/recall_search require a Pro license — see')} ${s.cyan('ticketlens license')}${s.dim('.')}\n`);
  }

  return { written: !alreadyCorrect, dryRun: false, path: configPath, alreadyCorrect };
}
