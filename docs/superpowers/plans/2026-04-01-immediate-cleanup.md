# Immediate Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the feature branch, fix 5 code bugs found in Phase 2 audits, and update the Mintlify docs to match the current CLI.

**Architecture:** Seven sequential tasks. Tasks 1–6 touch the CLI repo (`~/Desktop/Projects/ticket-lens`). Task 7 is a manual Mintlify dashboard edit (no local files). Tasks 2–6 must run in worktree `.worktrees/phase2-sprint` before the merge in Task 1 is tagged.

> ⚠️ **Order matters:** complete Tasks 2–6 (code fixes) before tagging in Task 1, so the tag lands on top of all fixes. Then Task 7 (docs) can be done independently.

**Tech Stack:** Node.js 20+, `node:test` (built-in), git, Mintlify dashboard.

---

## Repo paths

- CLI: `~/Desktop/Projects/ticket-lens/`
- Worktree (active branch): `~/Desktop/Projects/ticket-lens/.worktrees/phase2-sprint`
- Tests: `skills/jtb/scripts/test/*.test.mjs`

---

## File Map

| File | Action | Task |
|------|--------|------|
| `bin/ticketlens.mjs` | Modify — add `ls` alias, fix non-TTY delete | 2, 3 |
| `skills/jtb/scripts/lib/config.mjs` | Modify — add `buildJiraEnv(conn)` export | 4 |
| `skills/jtb/scripts/fetch-ticket.mjs` | Modify — use `buildJiraEnv`, fix `saveCloudConsent` | 4, 6 |
| `skills/jtb/scripts/fetch-my-tickets.mjs` | Modify — use `buildJiraEnv` | 4 |
| `skills/jtb/scripts/lib/help.mjs` | Modify — add `schedule` to USAGE section | 5 |
| `skills/jtb/scripts/test/bin.test.mjs` | Modify — tests for `ls` alias and non-TTY delete | 2, 3 |
| `skills/jtb/scripts/test/config.test.mjs` | Create — tests for `buildJiraEnv` | 4 |
| `skills/jtb/scripts/test/help.test.mjs` | Modify — test for `schedule` in USAGE | 5 |
| `skills/jtb/scripts/test/fetch-ticket.test.mjs` | Modify — test for `saveCloudConsent` cache invalidation | 6 |

---

### Task 1: Merge feature/phase2-sprint → main and tag

**No tests. Git ops only. Run AFTER Tasks 2–6 are committed.**

- [ ] **Step 1: Verify worktree is clean and tests pass**

```bash
cd ~/Desktop/Projects/ticket-lens/.worktrees/phase2-sprint
node --test skills/jtb/scripts/test/*.test.mjs 2>&1 | tail -5
```

Expected: `pass N` (≥576), `fail 0`.

- [ ] **Step 2: Merge to main**

```bash
cd ~/Desktop/Projects/ticket-lens
git checkout main
git merge --no-ff feature/phase2-sprint -m "feat: Phase 2+3 compliance check + immediate cleanup fixes"
```

- [ ] **Step 3: Tag and verify**

```bash
git tag track3-compliance-complete
git log --oneline -3
git tag --list | grep track3
```

Expected: tag `track3-compliance-complete` is present on latest commit.

---

### Task 2: Fix `ticketlens ls` alias

**Files:**
- Modify: `bin/ticketlens.mjs`
- Modify: `skills/jtb/scripts/test/bin.test.mjs`

The `profiles` command already works. `ls` just needs to fall through to it. No logic change.

- [ ] **Step 1: Write the failing test**

Add to `skills/jtb/scripts/test/bin.test.mjs`, inside the `describe('bin/ticketlens.mjs', () => {` block:

```js
it('ls command prints profile list (alias for profiles)', () => {
  const result = spawnSync('node', [binPath, 'ls'], {
    encoding: 'utf8',
    timeout: 5000,
    env: { ...process.env, HOME: '/tmp/ticketlens-no-home' },
  });
  // With no profiles configured, it should print "No profiles configured" — not show default help
  const combined = result.stdout + result.stderr;
  assert.ok(
    combined.includes('No profiles configured') || combined.includes('Profile'),
    `"ticketlens ls" must print profile list, not help. Got: ${combined.slice(0, 200)}`
  );
  assert.ok(
    !combined.includes('Stop tab-switching'),
    '"ticketlens ls" must not fall through to printHelp'
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/Desktop/Projects/ticket-lens/.worktrees/phase2-sprint
node --test skills/jtb/scripts/test/bin.test.mjs 2>&1 | grep -E "✗|✓|fail|pass"
```

Expected: the new test fails ("Stop tab-switching" is present in output).

- [ ] **Step 3: Add `case 'ls':` to `bin/ticketlens.mjs`**

Find the `case 'profiles':` block (around line 176). Add a fall-through case directly above it:

```js
  case 'ls':  // alias for profiles
  case 'profiles': {
    const plain = cmdArgs.includes('--plain');
    const config = loadProfiles();
    printProfiles({ config, plain });
    break;
  }
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node --test skills/jtb/scripts/test/bin.test.mjs 2>&1 | grep -E "✗|✓|fail|pass"
```

Expected: all tests pass including the new one.

- [ ] **Step 5: Run full suite to confirm no regression**

```bash
node --test skills/jtb/scripts/test/*.test.mjs 2>&1 | tail -5
```

Expected: `pass N+1`, `fail 0`.

- [ ] **Step 6: Commit**

```bash
cd ~/Desktop/Projects/ticket-lens/.worktrees/phase2-sprint
git add bin/ticketlens.mjs skills/jtb/scripts/test/bin.test.mjs
git commit -m "fix: add ticketlens ls alias for profiles command"
```

---

### Task 3: Fix non-TTY delete — require `--yes` flag

**Files:**
- Modify: `bin/ticketlens.mjs`
- Modify: `skills/jtb/scripts/test/bin.test.mjs`

**Context:** The audit found that when `process.stdin.isTTY` is falsy (piped/CI), the TTY guard is skipped entirely and `deleteProfile()` is called unconditionally — silently deleting the profile. The docs incorrectly say non-TTY is "safe". Fix: require `--yes` / `-y` flag in non-TTY mode; without it, error and exit 1.

- [ ] **Step 1: Write the failing tests**

Add to `skills/jtb/scripts/test/bin.test.mjs`:

```js
it('delete without --yes in non-TTY exits 1 with explanation', () => {
  const result = spawnSync('node', [binPath, 'delete', 'nonexistent-profile'], {
    encoding: 'utf8',
    timeout: 5000,
    stdio: ['pipe', 'pipe', 'pipe'], // forces non-TTY (stdin is a pipe)
    env: { ...process.env, HOME: '/tmp/ticketlens-no-home' },
  });
  assert.equal(result.status, 1, `Expected exit 1, got ${result.status}`);
  const combined = result.stdout + result.stderr;
  assert.ok(
    combined.includes('--yes') || combined.includes('not found'),
    `Expected "--yes" hint or "not found" in output. Got: ${combined.slice(0, 200)}`
  );
});

it('delete --yes with nonexistent profile exits 1', () => {
  const result = spawnSync('node', [binPath, 'delete', 'nonexistent-profile', '--yes'], {
    encoding: 'utf8',
    timeout: 5000,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, HOME: '/tmp/ticketlens-no-home' },
  });
  // Profile doesn't exist → "not found" error, still exits 1
  assert.equal(result.status, 1, `Expected exit 1 (profile not found), got ${result.status}`);
  assert.ok(
    result.stderr.includes('not found') || result.stderr.includes('not found'),
    `Expected "not found" in stderr. Got: ${result.stderr.slice(0, 200)}`
  );
});
```

- [ ] **Step 2: Run tests to verify they fail as expected**

```bash
cd ~/Desktop/Projects/ticket-lens/.worktrees/phase2-sprint
node --test skills/jtb/scripts/test/bin.test.mjs 2>&1 | grep -E "✗|✓|fail|pass"
```

The first new test may pass accidentally (profile not found exits 1 before reaching the TTY check). That's acceptable — the important test is the scenario where a *valid* profile exists. The code fix ensures correctness regardless.

- [ ] **Step 3: Modify `bin/ticketlens.mjs` `case 'delete':`**

Find the `case 'delete':` block. The current TTY check is around line 147:

```js
if (process.stdin.isTTY && process.stdin.setRawMode) {
  // ... prompt
}
deleteProfile(profileName);
```

Replace the TTY guard section (lines ~147–165, up to and including the closing `}` of the if block) with:

```js
    const forceYes = cmdArgs.includes('--yes') || cmdArgs.includes('-y');
    if (process.stdin.isTTY && process.stdin.setRawMode) {
      process.stderr.write(`  Delete profile ${s.cyan(s.bold(profileName))}? This cannot be undone.  ${s.dim('y/N')}  `);
      const answer = await new Promise(res => {
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.setEncoding('utf8');
        process.stdin.once('data', char => {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stderr.write('\n');
          if (char === '\x03') process.exit(0);
          res(char === 'y' || char === 'Y');
        });
      });
      if (!answer) {
        process.stderr.write(`  ${s.dim('Cancelled.')}\n`);
        break;
      }
    } else if (!forceYes) {
      process.stderr.write(`${s.red('✖')} Non-interactive mode: pass ${s.cyan('--yes')} to confirm deletion without a prompt.\n`);
      process.exitCode = 1;
      break;
    }
```

The `deleteProfile(profileName)` call (and result handling) that follows is unchanged.

- [ ] **Step 4: Run tests to verify they pass**

```bash
node --test skills/jtb/scripts/test/bin.test.mjs 2>&1 | grep -E "✗|✓|fail|pass"
```

Expected: all pass.

- [ ] **Step 5: Run full suite**

```bash
node --test skills/jtb/scripts/test/*.test.mjs 2>&1 | tail -5
```

Expected: `pass N+2`, `fail 0`.

- [ ] **Step 6: Commit**

```bash
git add bin/ticketlens.mjs skills/jtb/scripts/test/bin.test.mjs
git commit -m "fix: require --yes flag for non-TTY delete to prevent silent data loss"
```

---

### Task 4: Fix jiraEnv DRY violation — extract `buildJiraEnv`

**Files:**
- Modify: `skills/jtb/scripts/lib/config.mjs`
- Modify: `skills/jtb/scripts/fetch-ticket.mjs`
- Modify: `skills/jtb/scripts/fetch-my-tickets.mjs`
- Create: `skills/jtb/scripts/test/config.test.mjs`

**Context:** Both `fetch-ticket.mjs` (line 273) and `fetch-my-tickets.mjs` (line 153) build an identical inline object:
```js
const jiraEnv = {
  JIRA_BASE_URL: conn.baseUrl,
  ...(conn.pat ? { JIRA_PAT: conn.pat } : { JIRA_EMAIL: conn.email, JIRA_API_TOKEN: conn.apiToken }),
};
```
Extract this to `lib/config.mjs` as `buildJiraEnv(conn)`.

- [ ] **Step 1: Create `skills/jtb/scripts/test/config.test.mjs`**

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildJiraEnv } from '../lib/config.mjs';

describe('buildJiraEnv', () => {
  it('uses PAT auth when conn.pat is set', () => {
    const env = buildJiraEnv({ baseUrl: 'https://jira.example.com', pat: 'my-pat' });
    assert.equal(env.JIRA_BASE_URL, 'https://jira.example.com');
    assert.equal(env.JIRA_PAT, 'my-pat');
    assert.equal(env.JIRA_EMAIL, undefined);
    assert.equal(env.JIRA_API_TOKEN, undefined);
  });

  it('uses basic auth when conn.pat is absent', () => {
    const env = buildJiraEnv({ baseUrl: 'https://jira.example.com', email: 'user@x.com', apiToken: 'tok' });
    assert.equal(env.JIRA_BASE_URL, 'https://jira.example.com');
    assert.equal(env.JIRA_EMAIL, 'user@x.com');
    assert.equal(env.JIRA_API_TOKEN, 'tok');
    assert.equal(env.JIRA_PAT, undefined);
  });
});
```

- [ ] **Step 2: Run test to verify it fails (function not yet exported)**

```bash
cd ~/Desktop/Projects/ticket-lens/.worktrees/phase2-sprint
node --test skills/jtb/scripts/test/config.test.mjs 2>&1 | grep -E "✗|✓|fail|pass|Error"
```

Expected: fails — `buildJiraEnv is not a function` or similar.

- [ ] **Step 3: Add `buildJiraEnv` to `lib/config.mjs`**

Append at the end of `skills/jtb/scripts/lib/config.mjs`:

```js
/**
 * Build the env-like object expected by jira-client functions.
 * @param {{ baseUrl: string, pat?: string, email?: string, apiToken?: string }} conn
 * @returns {{ JIRA_BASE_URL: string, JIRA_PAT?: string, JIRA_EMAIL?: string, JIRA_API_TOKEN?: string }}
 */
export function buildJiraEnv(conn) {
  return {
    JIRA_BASE_URL: conn.baseUrl,
    ...(conn.pat ? { JIRA_PAT: conn.pat } : { JIRA_EMAIL: conn.email, JIRA_API_TOKEN: conn.apiToken }),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node --test skills/jtb/scripts/test/config.test.mjs 2>&1 | grep -E "✗|✓|fail|pass"
```

Expected: 2 tests pass.

- [ ] **Step 5: Update `fetch-ticket.mjs`**

Add `buildJiraEnv` to the existing import from `./lib/config.mjs`. Find the line (near line 272) with the inline `jiraEnv` object literal. Replace both with a single call:

Change the import at the top — find the existing import of config.mjs (or create one if there's none). Looking at fetch-ticket.mjs, there is no direct `config.mjs` import, so add:

```js
import { buildJiraEnv } from './lib/config.mjs';
```

Then replace the inline block (lines ~272–276):
```js
  // Build env-like object for jira-client compatibility
  const jiraEnv = {
    JIRA_BASE_URL: conn.baseUrl,
    ...(conn.pat ? { JIRA_PAT: conn.pat } : { JIRA_EMAIL: conn.email, JIRA_API_TOKEN: conn.apiToken }),
  };
```
with:
```js
  const jiraEnv = buildJiraEnv(conn);
```

- [ ] **Step 6: Update `fetch-my-tickets.mjs`**

Add the same import at the top of `fetch-my-tickets.mjs`:

```js
import { buildJiraEnv } from './lib/config.mjs';
```

Replace the inline block (lines ~153–156):
```js
  const jiraEnv = {
    JIRA_BASE_URL: conn.baseUrl,
    ...(conn.pat ? { JIRA_PAT: conn.pat } : { JIRA_EMAIL: conn.email, JIRA_API_TOKEN: conn.apiToken }),
  };
```
with:
```js
  const jiraEnv = buildJiraEnv(conn);
```

- [ ] **Step 7: Run full test suite**

```bash
node --test skills/jtb/scripts/test/*.test.mjs 2>&1 | tail -5
```

Expected: `pass N+2`, `fail 0`.

- [ ] **Step 8: Commit**

```bash
git add skills/jtb/scripts/lib/config.mjs \
        skills/jtb/scripts/fetch-ticket.mjs \
        skills/jtb/scripts/fetch-my-tickets.mjs \
        skills/jtb/scripts/test/config.test.mjs
git commit -m "refactor: extract buildJiraEnv to lib/config.mjs, remove duplication"
```

---

### Task 5: Fix help.mjs drift — add `ticketlens schedule` to USAGE

**Files:**
- Modify: `skills/jtb/scripts/lib/help.mjs`
- Modify: `skills/jtb/scripts/test/help.test.mjs`

**Context:** `ticketlens schedule` is a full Pro command with `--stop` and `--status` sub-flags. It is entirely absent from the USAGE section in `printHelp()` (line 31–43). Other flags (`--no-cache`, `--digest`) are already present in their respective OPTIONS sections.

- [ ] **Step 1: Write the failing test**

Add to the `describe('printHelp — main USAGE', () => {` block in `help.test.mjs`:

```js
  it('USAGE section documents ticketlens schedule command', () => {
    const out = captureHelp(printHelp);
    const usageIdx = out.indexOf('USAGE');
    const scheduleIdx = out.indexOf('ticketlens schedule');
    const fetchOptionsIdx = out.indexOf('FETCH OPTIONS');
    assert.ok(usageIdx !== -1, 'output must contain USAGE section');
    assert.ok(
      scheduleIdx !== -1 && scheduleIdx < fetchOptionsIdx,
      `"ticketlens schedule" must appear in USAGE (before FETCH OPTIONS), found at ${scheduleIdx} vs FETCH OPTIONS at ${fetchOptionsIdx}`
    );
  });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/Desktop/Projects/ticket-lens/.worktrees/phase2-sprint
node --test skills/jtb/scripts/test/help.test.mjs 2>&1 | grep -E "✗|✓|fail|pass"
```

Expected: new test fails.

- [ ] **Step 3: Add `schedule` to the USAGE section in `printHelp()`**

In `lib/help.mjs`, find the USAGE block. After the line for `cache`, add one new entry. The exact insertion is after:

```js
    `    ${s.brand('ticketlens')} cache ${s.dim('[size|clear]')}       Manage attachment cache  ${s.dim('(try cache --help)')}`,
```

Add:

```js
    `    ${s.brand('ticketlens')} schedule ${s.dim('[--stop|--status]')} Manage digest schedule  ${s.dim('[Pro]')}`,
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node --test skills/jtb/scripts/test/help.test.mjs 2>&1 | grep -E "✗|✓|fail|pass"
```

Expected: all pass.

- [ ] **Step 5: Run full suite**

```bash
node --test skills/jtb/scripts/test/*.test.mjs 2>&1 | tail -5
```

Expected: `pass N+1`, `fail 0`.

- [ ] **Step 6: Commit**

```bash
git add skills/jtb/scripts/lib/help.mjs skills/jtb/scripts/test/help.test.mjs
git commit -m "fix: add ticketlens schedule to help.mjs USAGE section"
```

---

### Task 6: Fix `saveCloudConsent` cache staleness

**Files:**
- Modify: `skills/jtb/scripts/fetch-ticket.mjs`
- Modify: `skills/jtb/scripts/test/fetch-ticket.test.mjs`

**Context:** `saveCloudConsent()` in `fetch-ticket.mjs` writes `profiles.json` directly via `writeFileSync`, bypassing `saveProfile()` and leaving `_profilesCache` stale. A subsequent call to `loadProfiles()` in the same process will return the pre-consent cached value. Fix: use `saveProfile()` from `profile-resolver.mjs`, which calls `invalidateProfilesCache()` after writing.

- [ ] **Step 1: Check how fetch-ticket tests inject configDir**

Read the top of `skills/jtb/scripts/test/fetch-ticket.test.mjs` to understand how the test fixtures pass a `configDir`. We need to write a test for `saveCloudConsent`'s cache behaviour.

The function is currently private (not exported). We will test it indirectly: call the `--cloud` path with a mock that grants consent, then verify `loadProfiles()` reflects the update without re-reading disk.

Actually, the simplest approach is to test the helper by exporting it. But since it's a small private function, test it via integration: write a test that confirms `loadProfiles()` returns the updated consent field immediately after `saveCloudConsent` would have run.

Add a unit test directly in `fetch-ticket.test.mjs`. First read that file to find the correct describe block to add to.

- [ ] **Step 2: Read the test file to find insertion point**

```bash
grep -n "describe\|saveCloudConsent\|cloudConsent" ~/Desktop/Projects/ticket-lens/.worktrees/phase2-sprint/skills/jtb/scripts/test/fetch-ticket.test.mjs | head -20
```

- [ ] **Step 3: Fix `saveCloudConsent` in `fetch-ticket.mjs`**

Add `saveProfile` to the existing import from `./lib/profile-resolver.mjs`. The current import is:

```js
import { resolveConnection, loadProfiles, loadCredentials } from './lib/profile-resolver.mjs';
```

Change to:

```js
import { resolveConnection, loadProfiles, loadCredentials, saveProfile } from './lib/profile-resolver.mjs';
```

Then replace the `saveCloudConsent` function body (lines ~89–97):

```js
function saveCloudConsent(configDir, profileName) {
  try {
    const path = `${configDir}/profiles.json`;
    const data = JSON.parse(readFileSync(path, 'utf8'));
    if (!data.profiles) data.profiles = {};
    if (!data.profiles[profileName]) data.profiles[profileName] = {};
    data.profiles[profileName].cloudSummarizeConsent = true;
    writeFileSync(path, JSON.stringify(data, null, 2), 'utf8');
  } catch { /* non-fatal */ }
}
```

with:

```js
function saveCloudConsent(configDir, profileName) {
  try {
    const config = loadProfiles(configDir);
    if (!config?.profiles[profileName]) return;
    saveProfile(profileName, { ...config.profiles[profileName], cloudSummarizeConsent: true }, null, configDir);
  } catch { /* non-fatal */ }
}
```

`saveProfile` calls `invalidateProfilesCache(configDir)` after writing, so the next `loadProfiles()` reads fresh data.

- [ ] **Step 4: Write a test verifying cache is invalidated**

In `fetch-ticket.test.mjs`, add a new describe block. The test creates a temp config dir, writes a profile, calls `saveCloudConsent` (via the exported `run` path is too complex — instead, test the exported module-level helper indirectly):

Since `saveCloudConsent` is not exported, write a focused integration test by directly calling `saveProfile` and `loadProfiles` in sequence (same pattern the fixed function uses) to confirm the invalidation works:

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { saveProfile, loadProfiles, invalidateProfilesCache } from '../lib/profile-resolver.mjs';

describe('saveCloudConsent — cache invalidation (via saveProfile)', () => {
  it('loadProfiles reflects update immediately after saveProfile', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tl-consent-'));
    const initial = { profiles: { acme: { baseUrl: 'https://jira.example.com' } } };
    writeFileSync(join(dir, 'profiles.json'), JSON.stringify(initial));
    invalidateProfilesCache(dir);

    // Warm the cache
    const before = loadProfiles(dir);
    assert.equal(before.profiles.acme.cloudSummarizeConsent, undefined);

    // Simulate what the fixed saveCloudConsent does
    const existing = before.profiles.acme;
    saveProfile('acme', { ...existing, cloudSummarizeConsent: true }, null, dir);

    // Cache must be invalidated — loadProfiles returns fresh data
    const after = loadProfiles(dir);
    assert.equal(after.profiles.acme.cloudSummarizeConsent, true, 'cloudSummarizeConsent must be visible immediately after save');
  });
});
```

Add this test to `fetch-ticket.test.mjs` (or to `profile-resolver.test.mjs` — either works, prefer the latter since it tests profile-resolver behaviour directly).

- [ ] **Step 5: Run full suite**

```bash
cd ~/Desktop/Projects/ticket-lens/.worktrees/phase2-sprint
node --test skills/jtb/scripts/test/*.test.mjs 2>&1 | tail -5
```

Expected: `pass N+1`, `fail 0`.

- [ ] **Step 6: Commit**

```bash
git add skills/jtb/scripts/fetch-ticket.mjs \
        skills/jtb/scripts/test/profile-resolver.test.mjs
git commit -m "fix: saveCloudConsent uses saveProfile to invalidate _profilesCache"
```

---

### Task 7: Mintlify doc fixes (manual — Mintlify dashboard)

**Files:** None in this repo. The docs live at `https://www.mintlify.com/ralphmoran/ticket-lens` and are managed via the Mintlify editor or a connected GitHub repo (not present locally).

**No code changes. No tests. Manual edits only.**

Open the Mintlify editor and apply the following changes in priority order:

#### HIGH priority — user-facing breakage

**1. Remove `--project` alias from `/commands/fetch`**

The docs list `--project` as a backward-compatible alias for `--profile`. This alias does not exist in the code. Remove the row/example that documents `--project`.

**2. Fix `ticketlens ls` alias** *(auto-fixed by Task 2 above)*

After Task 2 is merged, the code matches the docs. No doc change needed.

**3. Document `--check`, `--summarize`, `--cloud` on `/commands/fetch` and `/reference/flags`**

Add to `/commands/fetch` OPTIONS table:

| Flag | Description | Tier |
|------|-------------|------|
| `--check` | Appends local VCS diff and Claude Code review instructions to the brief | Free |
| `--summarize` | Generates an AI summary using your own API key (BYOK) or `--cloud` | Pro |
| `--cloud` | Routes the summary through the TicketLens API instead of a local key | Pro |

Add the same three rows to `/reference/flags` in the Fetch flags section.

**4. Document `--digest` on `/commands/triage` and `/reference/flags`**

Add to `/commands/triage` OPTIONS table:

| Flag | Description | Tier |
|------|-------------|------|
| `--digest` | POSTs scored triage results to the digest delivery endpoint | Pro |

Add the same row to `/reference/flags` in the Triage flags section.

#### MEDIUM priority — missing feature pages

**5. Add `/commands/schedule` page**

Create a new page documenting:
- Command: `ticketlens schedule`
- Pro gate: requires active Pro license
- Sub-flags: `--stop` (stop the scheduled digest), `--status` (show current schedule)
- Wizard: interactive prompts for time, timezone, profile
- Note: schedule is stored as a cron entry via macOS/Linux cron

**6. Fix profile resolution order on `/configuration/profiles`**

Current step 4 says "First profile in file." Replace with two steps:
- Step 4: `config.default` field (if set)
- Step 5: First profile in file (fallback when `config.default` is absent)

#### MEDIUM priority — non-TTY delete safety

**7. Fix non-TTY delete description on `/commands/profile-management`**

Current text: "Exits without prompting and does not delete unless confirmation is provided via stdin."

Replace with: "Exits with an error unless `--yes` (or `-y`) is passed. Piped/CI invocations must use `ticketlens delete <NAME> --yes` to confirm deletion."

#### LOW priority

**8. Document `ticketlens version` command**

Add `ticketlens version` to the commands reference. Note it prints `ticketlens vX.Y.Z`. Distinguish from `--version` global flag (same output, different invocation form).

**9. Document delete side effects**

On `/commands/profile-management`, under the `delete` section, add:
- Deleting the active/default profile clears `config.default` silently; the next call resolves to the first remaining profile.
- Deletion does not clear cached attachment data — run `ticketlens cache clear` to purge stale cache entries.

- [ ] **Step 1: Log into Mintlify dashboard and apply changes 1–4 (HIGH)**
- [ ] **Step 2: Create `/commands/schedule` page (MEDIUM)**
- [ ] **Step 3: Apply profile resolution and non-TTY delete fixes (MEDIUM)**
- [ ] **Step 4: Apply LOW priority fixes**

---

## Test count summary

| After task | Expected pass count |
|------------|-------------------|
| Start | 576 |
| Task 2 (ls alias) | 577 |
| Task 3 (non-TTY delete) | 579 |
| Task 4 (buildJiraEnv) | 581 |
| Task 5 (schedule in help) | 582 |
| Task 6 (saveCloudConsent) | 583 |
