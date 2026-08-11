# Configurable Recall Capture Strictness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-profile `recallStrictness` (`loose | balanced | strict`, default `balanced`) that reweights both the in-session Recall-capture judgment (SKILL.md prompt calibration, delivered via a one-line brief injection) and the Stop hook's nag trigger (narrowed for `loose` only).

**Architecture:** One shared enum/normalizer in `profile-resolver.mjs` is the single source of truth, read independently by two levers: (1) `resolveConnection()` → `assembleBrief()`/`styleBrief()` inject a `**Recall capture:** <level>` line into the TicketBrief Claude reads, matched against three new named blocks in SKILL.md; (2) `recall-nudge-stop.mjs` reads the same profile field directly and calls a new pure `shouldNag()` function in `recall-nudge-lib.mjs` to decide whether to block. The two levers never share code — the hook doesn't see the brief, and doesn't need to.

**Tech Stack:** Node.js (ESM, zero runtime deps), `node --test` (built-in test runner), `node:child_process.spawnSync` for hook-level subprocess tests (established pattern, see `bin.test.mjs`).

**Design spec:** `docs/superpowers/specs/2026-08-11-recall-capture-strictness-design.md` (approved, commit `8000ba6`).

## Global Constraints

- Default (`balanced`) behavior must be byte-for-byte identical to today's behavior at every layer — no profile ever regresses without explicitly opting in.
- `strict` must never widen `recall-nudge-stop.mjs`'s trigger beyond `balanced` — doing so would either bypass `hasRecentCapture()`'s rollover bridge or exceed the once-per-session cap, both documented correctness invariants, not calibration knobs (spec §5).
- No Console/backend changes — this is `ticket-lens` (CLI) only, local/per-profile, no network calls added to any hot path.
- `note add`'s existing structural/secret-scan checks (`note-add.mjs`/`recall-vault.mjs`) are out of scope — untouched by every task in this plan.
- No `config get recallStrictness` command — explicitly cut by the user, keep minimal. `cat ~/.ticketlens/profiles.json` is the inspection path.
- Commit after every task. Never batch multiple tasks into one commit.

---

## File Structure

| File | Responsibility |
|---|---|
| `skills/jtb/scripts/lib/profile-resolver.mjs` | Shared enum/normalizer, `saveProfileRecallStrictness()` setter, `resolveRecallStrictnessTarget()` CLI-resolution helper, `resolveConnection()`'s new field |
| `bin/ticketlens.mjs` | Thin `config set recallStrictness` CLI wrapper around `resolveRecallStrictnessTarget()`/`saveProfileRecallStrictness()` |
| `skills/jtb/scripts/lib/brief-assembler.mjs` | `assembleBrief()` — plain-text brief, gains `recallStrictness` param + conditional injection |
| `skills/jtb/scripts/lib/styled-assembler.mjs` | `styleBrief()` — styled/terminal brief, same treatment, separate rendering path |
| `skills/jtb/scripts/fetch-ticket.mjs` | Threads `conn.recallStrictness` into the two real brief-rendering call sites (cached + live paths). The `compliance` subcommand's `assembleBrief` call (line 653) is deliberately **not** touched — confirmed by reading its context: that brief feeds a requirements-matching algorithm, never shown to Claude as capture-judgment context. |
| `skills/jtb/hooks/recall-nudge-lib.mjs` | New pure `shouldNag()` — the Stop hook's trigger decision, extracted for direct unit testing |
| `skills/jtb/hooks/recall-nudge-stop.mjs` | Wires `resolveProfile()` + `normalizeRecallStrictness()` + `shouldNag()` in; the message-selection/exit-code logic is otherwise untouched |
| `skills/jtb/SKILL.md` | "When to capture a note" section — preface + three named calibration blocks |

New test files: `skills/jtb/scripts/test/recall-nudge-stop.test.mjs` (does not exist today — the hook has never had direct trigger-logic tests; this plan closes that gap since it's the exact logic being modified).

---

## Task 1: Shared strictness enum + normalizer

**Files:**
- Modify: `skills/jtb/scripts/lib/profile-resolver.mjs` (insert after `saveProfile`, i.e. after line 101, before the `saveProfileRecallTeamId` comment block at line 103)
- Test: `skills/jtb/scripts/test/profile-resolver.test.mjs`

**Interfaces:**
- Produces: `RECALL_STRICTNESS_LEVELS: string[]`, `DEFAULT_RECALL_STRICTNESS: 'balanced'`, `normalizeRecallStrictness(value: unknown): 'loose'|'balanced'|'strict'`

- [ ] **Step 1: Write the failing tests**

Add to `skills/jtb/scripts/test/profile-resolver.test.mjs`, add `normalizeRecallStrictness, RECALL_STRICTNESS_LEVELS, DEFAULT_RECALL_STRICTNESS` to the existing import on line 7, and add a new top-level `describe` block (place it after the `saveProfileRecallTeamId / loadProfileRecallTeamId` describe block, i.e. after line ~508):

```js
describe('normalizeRecallStrictness', () => {
  it('passes through each valid level unchanged', () => {
    for (const level of RECALL_STRICTNESS_LEVELS) {
      assert.equal(normalizeRecallStrictness(level), level);
    }
  });

  it('defaults to balanced for undefined', () => {
    assert.equal(normalizeRecallStrictness(undefined), DEFAULT_RECALL_STRICTNESS);
  });

  it('defaults to balanced for an unrecognized string', () => {
    assert.equal(normalizeRecallStrictness('aggressive'), DEFAULT_RECALL_STRICTNESS);
  });

  it('defaults to balanced for non-string garbage', () => {
    assert.equal(normalizeRecallStrictness(42), DEFAULT_RECALL_STRICTNESS);
    assert.equal(normalizeRecallStrictness(null), DEFAULT_RECALL_STRICTNESS);
  });

  it('RECALL_STRICTNESS_LEVELS is exactly the three named levels', () => {
    assert.deepEqual(RECALL_STRICTNESS_LEVELS, ['loose', 'balanced', 'strict']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-name-pattern="normalizeRecallStrictness" skills/jtb/scripts/test/profile-resolver.test.mjs`
Expected: FAIL — `normalizeRecallStrictness is not a function` (not exported yet).

- [ ] **Step 3: Write minimal implementation**

Insert into `skills/jtb/scripts/lib/profile-resolver.mjs` right after line 101 (the closing `}` of `saveProfile`):

```js
export const RECALL_STRICTNESS_LEVELS = ['loose', 'balanced', 'strict'];
export const DEFAULT_RECALL_STRICTNESS = 'balanced';

export function normalizeRecallStrictness(value) {
  return RECALL_STRICTNESS_LEVELS.includes(value) ? value : DEFAULT_RECALL_STRICTNESS;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --test-name-pattern="normalizeRecallStrictness" skills/jtb/scripts/test/profile-resolver.test.mjs`
Expected: PASS, 5/5.

- [ ] **Step 5: Commit**

```bash
git add skills/jtb/scripts/lib/profile-resolver.mjs skills/jtb/scripts/test/profile-resolver.test.mjs
git commit -m "feat: add shared recallStrictness enum and normalizer"
```

---

## Task 2: `saveProfileRecallStrictness()` setter

**Files:**
- Modify: `skills/jtb/scripts/lib/profile-resolver.mjs` (insert immediately after Task 1's new code)
- Test: `skills/jtb/scripts/test/profile-resolver.test.mjs`

**Interfaces:**
- Consumes: `RECALL_STRICTNESS_LEVELS`, `normalizeRecallStrictness` (Task 1), `loadProfiles`, `DEFAULT_CONFIG_DIR`, `invalidateProfilesCache` (all already in this file)
- Produces: `saveProfileRecallStrictness(name: string, level: string, configDir?: string): void` — throws `Error` if `name` isn't an existing profile.

- [ ] **Step 1: Write the failing tests**

Add to `skills/jtb/scripts/test/profile-resolver.test.mjs`, add `saveProfileRecallStrictness` to the import on line 7, new describe block after Task 1's:

```js
describe('saveProfileRecallStrictness', () => {
  let configDir;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), 'ticketlens-'));
    writeFileSync(join(configDir, 'profiles.json'), JSON.stringify(sampleProfiles, null, 2));
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
  });

  it('writes recallStrictness onto an existing profile', () => {
    saveProfileRecallStrictness('corenexus', 'strict', configDir);
    const saved = JSON.parse(readFileSync(join(configDir, 'profiles.json'), 'utf8'));
    assert.equal(saved.profiles.corenexus.recallStrictness, 'strict');
  });

  it('never clobbers other fields on the same profile', () => {
    saveProfileRecallStrictness('corenexus', 'loose', configDir);
    const saved = JSON.parse(readFileSync(join(configDir, 'profiles.json'), 'utf8'));
    assert.equal(saved.profiles.corenexus.baseUrl, sampleProfiles.profiles.corenexus.baseUrl);
    assert.deepEqual(saved.profiles.corenexus.ticketPrefixes, sampleProfiles.profiles.corenexus.ticketPrefixes);
  });

  it('does not affect other profiles', () => {
    saveProfileRecallStrictness('corenexus', 'strict', configDir);
    const saved = JSON.parse(readFileSync(join(configDir, 'profiles.json'), 'utf8'));
    assert.equal(saved.profiles.acme.recallStrictness, undefined);
  });

  it('throws for an unknown profile', () => {
    assert.throws(() => saveProfileRecallStrictness('nonexistent', 'strict', configDir), /Unknown profile/);
  });

  it('invalidates the profiles cache so a subsequent loadProfiles sees the new value', () => {
    saveProfileRecallStrictness('corenexus', 'strict', configDir);
    const reloaded = loadProfiles(configDir);
    assert.equal(reloaded.profiles.corenexus.recallStrictness, 'strict');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-name-pattern="saveProfileRecallStrictness" skills/jtb/scripts/test/profile-resolver.test.mjs`
Expected: FAIL — `saveProfileRecallStrictness is not a function`.

- [ ] **Step 3: Write minimal implementation**

Insert into `skills/jtb/scripts/lib/profile-resolver.mjs` right after Task 1's three exports:

```js
export function saveProfileRecallStrictness(name, level, configDir = DEFAULT_CONFIG_DIR) {
  const config = loadProfiles(configDir) || { profiles: {} };
  if (!config.profiles[name]) throw new Error(`Unknown profile "${name}"`);
  config.profiles[name] = { ...config.profiles[name], recallStrictness: normalizeRecallStrictness(level) };
  writeFileSync(join(configDir, 'profiles.json'), JSON.stringify(config, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  invalidateProfilesCache(configDir);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --test-name-pattern="saveProfileRecallStrictness" skills/jtb/scripts/test/profile-resolver.test.mjs`
Expected: PASS, 5/5.

- [ ] **Step 5: Commit**

```bash
git add skills/jtb/scripts/lib/profile-resolver.mjs skills/jtb/scripts/test/profile-resolver.test.mjs
git commit -m "feat: add saveProfileRecallStrictness setter"
```

---

## Task 3: `resolveConnection()` gains `recallStrictness`

**Files:**
- Modify: `skills/jtb/scripts/lib/profile-resolver.mjs:300` (insert one line after `allowPrivateIp`)
- Test: `skills/jtb/scripts/test/profile-resolver.test.mjs`

**Interfaces:**
- Consumes: `normalizeRecallStrictness` (Task 1)
- Produces: `resolveConnection(...)`'s returned object gains `recallStrictness: string` when `source === 'profile'`; left `undefined` for `'profile-not-found'`/`'env'` sources (mirrors the existing `allowPrivateIp` precedent exactly — see the "does not set allowPrivateIp when falling back to env vars" test at line 178 for the pattern being mirrored).

This is purely additive — no existing `resolveConnection` test should need changes. Run the full existing `resolveConnection` describe block after Step 3 as part of Step 4 to confirm zero regressions (Global Constraint: default behavior byte-for-byte unchanged).

- [ ] **Step 1: Write the failing tests**

Add to the `resolveConnection` describe block in `skills/jtb/scripts/test/profile-resolver.test.mjs`, immediately after the existing `'does not set allowPrivateIp when falling back to env vars...'` test (after line 182):

```js
    it('carries recallStrictness from a profile that set it', () => {
      const withStrictness = {
        profiles: {
          ...sampleProfiles.profiles,
          corenexus: { ...sampleProfiles.profiles.corenexus, recallStrictness: 'strict' },
        },
        default: sampleProfiles.default,
      };
      writeConfig(withStrictness);
      const result = resolveConnection('CNV1-3', { configDir });
      assert.equal(result.recallStrictness, 'strict');
    });

    it('defaults recallStrictness to balanced when the profile never set it', () => {
      writeConfig();
      const result = resolveConnection('CNV1-3', { configDir });
      assert.equal(result.recallStrictness, 'balanced');
    });

    it('normalizes an invalid stored recallStrictness value to balanced', () => {
      const corrupted = {
        profiles: {
          ...sampleProfiles.profiles,
          corenexus: { ...sampleProfiles.profiles.corenexus, recallStrictness: 'yolo' },
        },
        default: sampleProfiles.default,
      };
      writeConfig(corrupted);
      const result = resolveConnection('CNV1-3', { configDir });
      assert.equal(result.recallStrictness, 'balanced');
    });

    it('does not set recallStrictness when falling back to env vars', () => {
      const env = { JIRA_BASE_URL: 'https://fallback.atlassian.net', JIRA_PAT: 'tok' };
      const result = resolveConnection('ANY-123', { env, configDir: '/tmp/nonexistent-ticketlens' });
      assert.equal(result.recallStrictness, undefined);
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-name-pattern="recallStrictness" skills/jtb/scripts/test/profile-resolver.test.mjs`
Expected: FAIL — `result.recallStrictness` is `undefined` in the first two cases (`assert.equal(undefined, 'strict')` / `assert.equal(undefined, 'balanced')` fail).

- [ ] **Step 3: Write minimal implementation**

In `skills/jtb/scripts/lib/profile-resolver.mjs`, modify the `resolveConnection` profile-branch return object (line 289-303):

```js
    return {
      baseUrl: profile.baseUrl,
      auth: profile.auth || null,
      email: profile.email || null,
      apiToken: profileCreds.apiToken || null,
      pat: profileCreds.pat || null,
      triageStatuses: profile.triageStatuses || null,
      ticketPrefixes: profile.ticketPrefixes || null,
      attentionRules: profile.attentionRules ?? null,
      staleRule: profile.staleRule ?? null,
      sortBy: profile.sortBy ?? null,
      allowPrivateIp: profile.allowPrivateIp || false,
      recallStrictness: normalizeRecallStrictness(profile.recallStrictness),
      source: 'profile',
      profileName: profile.name,
    };
```

(Only the new `recallStrictness:` line is added; every other line is unchanged.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test skills/jtb/scripts/test/profile-resolver.test.mjs`
Expected: PASS, full file (confirms both the 4 new tests and zero regressions on the pre-existing `resolveConnection` suite).

- [ ] **Step 5: Commit**

```bash
git add skills/jtb/scripts/lib/profile-resolver.mjs skills/jtb/scripts/test/profile-resolver.test.mjs
git commit -m "feat: thread recallStrictness through resolveConnection"
```

---

## Task 4: CLI `config set recallStrictness`

**Files:**
- Modify: `skills/jtb/scripts/lib/profile-resolver.mjs` (add `resolveRecallStrictnessTarget`, after Task 2's setter)
- Modify: `bin/ticketlens.mjs:19` (import), `bin/ticketlens.mjs` after line 227 (new `case` branch)
- Test: `skills/jtb/scripts/test/profile-resolver.test.mjs`

**Interfaces:**
- Consumes: `RECALL_STRICTNESS_LEVELS` (Task 1), `loadProfiles` (existing), `saveProfileRecallStrictness` (Task 2)
- Produces: `resolveRecallStrictnessTarget({ value, explicitProfileName, configDir? }): { ok: true, profileName: string, value: string } | { ok: false, reason: 'missing-value'|'invalid-level'|'no-profile', value?: string }`

The CLI dispatcher stays a thin wrapper — no dedicated subprocess test for the `bin/ticketlens.mjs` branch itself, matching the existing precedent (`config set aiProvider` also has no dedicated CLI-level test; only its underlying logic is what carries real branching risk, and that's what `resolveRecallStrictnessTarget` isolates for direct testing).

- [ ] **Step 1: Write the failing tests**

Add to `skills/jtb/scripts/test/profile-resolver.test.mjs`, add `resolveRecallStrictnessTarget` to the import on line 7, new describe block after Task 2's:

```js
describe('resolveRecallStrictnessTarget', () => {
  let configDir;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), 'ticketlens-'));
    writeFileSync(join(configDir, 'profiles.json'), JSON.stringify(sampleProfiles, null, 2));
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
  });

  it('resolves to the explicit --profile when given and valid', () => {
    const result = resolveRecallStrictnessTarget({ value: 'strict', explicitProfileName: 'acme', configDir });
    assert.deepEqual(result, { ok: true, profileName: 'acme', value: 'strict' });
  });

  it('falls back to the default profile when no explicit profile is given', () => {
    const result = resolveRecallStrictnessTarget({ value: 'loose', configDir });
    assert.deepEqual(result, { ok: true, profileName: 'corenexus', value: 'loose' });
  });

  it('fails with missing-value when no level is given', () => {
    const result = resolveRecallStrictnessTarget({ value: undefined, configDir });
    assert.deepEqual(result, { ok: false, reason: 'missing-value' });
  });

  it('fails with invalid-level for an unrecognized level', () => {
    const result = resolveRecallStrictnessTarget({ value: 'aggressive', configDir });
    assert.deepEqual(result, { ok: false, reason: 'invalid-level', value: 'aggressive' });
  });

  it('fails with no-profile when the explicit profile does not exist', () => {
    const result = resolveRecallStrictnessTarget({ value: 'strict', explicitProfileName: 'ghost', configDir });
    assert.deepEqual(result, { ok: false, reason: 'no-profile' });
  });

  it('fails with no-profile when no profile and no default resolve', () => {
    const noDefault = { profiles: sampleProfiles.profiles };
    writeFileSync(join(configDir, 'profiles.json'), JSON.stringify(noDefault, null, 2));
    const result = resolveRecallStrictnessTarget({ value: 'strict', configDir });
    assert.deepEqual(result, { ok: false, reason: 'no-profile' });
  });

  it('fails with no-profile when no profiles.json exists at all', () => {
    const result = resolveRecallStrictnessTarget({ value: 'strict', configDir: join(configDir, 'nonexistent') });
    assert.deepEqual(result, { ok: false, reason: 'no-profile' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-name-pattern="resolveRecallStrictnessTarget" skills/jtb/scripts/test/profile-resolver.test.mjs`
Expected: FAIL — `resolveRecallStrictnessTarget is not a function`.

- [ ] **Step 3: Write minimal implementation**

Insert into `skills/jtb/scripts/lib/profile-resolver.mjs` right after Task 2's `saveProfileRecallStrictness`:

```js
export function resolveRecallStrictnessTarget({ value, explicitProfileName, configDir = DEFAULT_CONFIG_DIR } = {}) {
  if (!value) return { ok: false, reason: 'missing-value' };
  if (!RECALL_STRICTNESS_LEVELS.includes(value)) return { ok: false, reason: 'invalid-level', value };

  const profilesConfig = loadProfiles(configDir);
  const targetProfile = explicitProfileName ?? profilesConfig?.default;
  if (!targetProfile || !profilesConfig?.profiles?.[targetProfile]) {
    return { ok: false, reason: 'no-profile' };
  }
  return { ok: true, profileName: targetProfile, value };
}
```

Then update the import in `bin/ticketlens.mjs:19` from:

```js
import { deleteProfile, loadProfiles, saveCredentialKey } from '../skills/jtb/scripts/lib/profile-resolver.mjs';
```

to:

```js
import { deleteProfile, loadProfiles, saveCredentialKey, resolveRecallStrictnessTarget, saveProfileRecallStrictness, RECALL_STRICTNESS_LEVELS } from '../skills/jtb/scripts/lib/profile-resolver.mjs';
```

Then insert a new branch into `bin/ticketlens.mjs`'s `case 'config':` block, immediately after the existing `aiProvider` branch's closing `break;\n    }` (after line 227, before line 229's `const profileArg = ...`):

```js
    if (cmdArgs[0] === 'set' && cmdArgs[1] === 'recallStrictness') {
      const s = createStyler({ isTTY: process.stdout.isTTY });
      const value = cmdArgs[2];
      const profileArgRS = cmdArgs.find(a => a.startsWith('--profile='));
      const explicitProfileName = profileArgRS ? profileArgRS.split('=')[1] : undefined;
      const result = resolveRecallStrictnessTarget({ value, explicitProfileName, configDir: DEFAULT_CONFIG_DIR });

      if (!result.ok) {
        if (result.reason === 'missing-value') {
          process.stderr.write(`${s.red('✖')} Missing value.\n  Usage: ticketlens config set recallStrictness <loose|balanced|strict> [--profile=NAME]\n`);
        } else if (result.reason === 'invalid-level') {
          process.stderr.write(`${s.red('✖')} Unknown level "${result.value}". Valid: ${RECALL_STRICTNESS_LEVELS.join(', ')}\n`);
        } else {
          process.stderr.write(`${s.red('✖')} No profile resolved. Pass --profile=NAME or set a default profile first.\n`);
        }
        process.exitCode = 1;
        break;
      }

      saveProfileRecallStrictness(result.profileName, result.value, DEFAULT_CONFIG_DIR);
      process.stdout.write(`  ${s.green('✔')} Recall capture strictness set to ${s.bold(s.cyan(result.value))} for profile "${result.profileName}"\n`);
      break;
    }

```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test skills/jtb/scripts/test/profile-resolver.test.mjs`
Expected: PASS, full file.

Manual smoke check (bin/ticketlens.mjs has no dedicated test harness for this branch, per the file-structure note above):

```bash
HOME=/tmp/ticketlens-strictness-smoke node bin/ticketlens.mjs init --no-input 2>&1 | head -5 || true
mkdir -p /tmp/ticketlens-strictness-smoke/.ticketlens
echo '{"profiles":{"test":{"baseUrl":"https://x.atlassian.net"}},"default":"test"}' > /tmp/ticketlens-strictness-smoke/.ticketlens/profiles.json
HOME=/tmp/ticketlens-strictness-smoke node bin/ticketlens.mjs config set recallStrictness strict
cat /tmp/ticketlens-strictness-smoke/.ticketlens/profiles.json
rm -rf /tmp/ticketlens-strictness-smoke
```
Expected: prints `✔ Recall capture strictness set to strict for profile "test"`, and the JSON file shows `"recallStrictness":"strict"` on the `test` profile.

- [ ] **Step 5: Commit**

```bash
git add skills/jtb/scripts/lib/profile-resolver.mjs skills/jtb/scripts/test/profile-resolver.test.mjs bin/ticketlens.mjs
git commit -m "feat: add ticketlens config set recallStrictness command"
```

---

## Task 5: `assembleBrief()` gains `recallStrictness` injection

**Files:**
- Modify: `skills/jtb/scripts/lib/brief-assembler.mjs:9,18` (signature + injection point)
- Test: `skills/jtb/scripts/test/brief-assembler.test.mjs`

**Interfaces:**
- Consumes: nothing new (takes an already-normalized string)
- Produces: `assembleBrief(ticket, codeRefs?, templateSections?, recallNotes?, recallMoreCount?, gaps?, recallStrictness = 'balanced')` — 7th positional param, default preserves today's output exactly.

- [ ] **Step 1: Write the failing tests**

Add to `skills/jtb/scripts/test/brief-assembler.test.mjs`, inside the existing `describe('assembleBrief', ...)` block (after the `'renders metadata line...'` test, around line 40):

```js
  it('injects a Recall capture line when recallStrictness is strict', () => {
    const result = assembleBrief(baseTicket, null, null, null, 0, null, 'strict');
    assert.ok(result.includes('**Recall capture:** strict'));
  });

  it('injects a Recall capture line when recallStrictness is loose', () => {
    const result = assembleBrief(baseTicket, null, null, null, 0, null, 'loose');
    assert.ok(result.includes('**Recall capture:** loose'));
  });

  it('omits the Recall capture line when recallStrictness is balanced', () => {
    const result = assembleBrief(baseTicket, null, null, null, 0, null, 'balanced');
    assert.ok(!result.includes('**Recall capture:**'));
  });

  it('omits the Recall capture line when recallStrictness is not passed at all (regression)', () => {
    const withoutParam = assembleBrief(baseTicket);
    const withBalanced = assembleBrief(baseTicket, null, null, null, 0, null, 'balanced');
    assert.equal(withoutParam, withBalanced);
    assert.ok(!withoutParam.includes('**Recall capture:**'));
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-name-pattern="Recall capture" skills/jtb/scripts/test/brief-assembler.test.mjs`
Expected: FAIL — the `strict`/`loose` cases find no injected line (function ignores the 7th arg today).

- [ ] **Step 3: Write minimal implementation**

In `skills/jtb/scripts/lib/brief-assembler.mjs`, change line 9's signature:

```js
export function assembleBrief(ticket, codeRefs = null, templateSections = null, recallNotes = null, recallMoreCount = 0, gaps = null, recallStrictness = 'balanced') {
```

And immediately after line 18 (`sections.push(meta.join(' | '));`), insert:

```js
  if (recallStrictness !== 'balanced') {
    sections.push(`**Recall capture:** ${recallStrictness}`);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test skills/jtb/scripts/test/brief-assembler.test.mjs`
Expected: PASS, full file — 4 new tests plus zero regressions on every pre-existing `assembleBrief` test (none of them pass a 7th arg, so all hit the new default).

- [ ] **Step 5: Commit**

```bash
git add skills/jtb/scripts/lib/brief-assembler.mjs skills/jtb/scripts/test/brief-assembler.test.mjs
git commit -m "feat: inject Recall capture strictness line into assembleBrief"
```

---

## Task 6: `styleBrief()` gains the same treatment

**Files:**
- Modify: `skills/jtb/scripts/lib/styled-assembler.mjs:136,155` (opts destructure + injection point)
- Test: `skills/jtb/scripts/test/styled-assembler.test.mjs`

**Interfaces:**
- Consumes: nothing new
- Produces: `styleBrief(ticket, codeRefs?, opts)` — `opts.recallStrictness` (default `'balanced'`), same injection contract as Task 5.

- [ ] **Step 1: Write the failing tests**

Add to the `describe('styleBrief', ...)` block in `skills/jtb/scripts/test/styled-assembler.test.mjs` (after the `'includes metadata fields'` test, around line 156), using the file's existing `makeBriefTicket()` fixture (defined at line 121) and `{ styled: false }` no-color convention (matches the existing tests in this same block):

```js
  it('injects a Recall capture line when recallStrictness is strict', () => {
    const ticket = makeBriefTicket();
    const result = styleBrief(ticket, null, { styled: false, recallStrictness: 'strict' });
    assert.ok(result.includes('Recall capture:') && result.includes('strict'));
  });

  it('injects a Recall capture line when recallStrictness is loose', () => {
    const ticket = makeBriefTicket();
    const result = styleBrief(ticket, null, { styled: false, recallStrictness: 'loose' });
    assert.ok(result.includes('Recall capture:') && result.includes('loose'));
  });

  it('omits the Recall capture line when recallStrictness is balanced', () => {
    const ticket = makeBriefTicket();
    const result = styleBrief(ticket, null, { styled: false, recallStrictness: 'balanced' });
    assert.ok(!result.includes('Recall capture:'));
  });

  it('omits the Recall capture line when recallStrictness is not passed at all (regression)', () => {
    const ticket = makeBriefTicket();
    const withoutOpt = styleBrief(ticket, null, { styled: false });
    const withBalanced = styleBrief(ticket, null, { styled: false, recallStrictness: 'balanced' });
    assert.equal(withoutOpt, withBalanced);
    assert.ok(!withoutOpt.includes('Recall capture:'));
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-name-pattern="Recall capture" skills/jtb/scripts/test/styled-assembler.test.mjs`
Expected: FAIL — the `strict`/`loose` cases find no injected line.

- [ ] **Step 3: Write minimal implementation**

In `skills/jtb/scripts/lib/styled-assembler.mjs`, change line 136's destructure:

```js
  const { styled = true, templateSections = null, recallNotes = null, recallMoreCount = 0, gaps = null, recallStrictness = 'balanced' } = opts;
```

And immediately after line 155 (`sections.push(meta.join(s.dim('  ·  ')));`), insert:

```js
  if (recallStrictness !== 'balanced') {
    sections.push(`${s.dim('Recall capture:')} ${recallStrictness}`);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test skills/jtb/scripts/test/styled-assembler.test.mjs`
Expected: PASS, full file.

- [ ] **Step 5: Commit**

```bash
git add skills/jtb/scripts/lib/styled-assembler.mjs skills/jtb/scripts/test/styled-assembler.test.mjs
git commit -m "feat: inject Recall capture strictness line into styleBrief"
```

---

## Task 7: Thread `conn.recallStrictness` through `fetch-ticket.mjs`

**Files:**
- Modify: `skills/jtb/scripts/fetch-ticket.mjs:1127,1141,1320,1334`
- Test: `skills/jtb/scripts/test/fetch-ticket.test.mjs`

**Interfaces:**
- Consumes: `assembleBrief`'s 7th param (Task 5), `styleBrief`'s `opts.recallStrictness` (Task 6), `resolveConnection`'s `recallStrictness` field (Task 3)
- Produces: end-to-end — a profile with `recallStrictness: 'strict'` produces a fetched brief containing the injected line.

- [ ] **Step 1: Write the failing test**

Add to the `describe('fetch-ticket integration', ...)` block in `skills/jtb/scripts/test/fetch-ticket.test.mjs` (after the `'uses profile when config exists and prefix matches'` test, around line 283), mirroring that exact test's `configDir`/`mockFetch`/`captureOutput` setup — this file already fixtures a `PROD-1234` Jira response via `cloudFixture` (line 12), so the profile's `ticketPrefixes` must include `PROD` to auto-resolve:

```js
  it('injects the Recall capture strictness line when the resolved profile sets one', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'ticketlens-'));
    writeFileSync(join(configDir, 'profiles.json'), JSON.stringify({
      profiles: {
        testprofile: { baseUrl: 'https://profiled.atlassian.net', auth: 'cloud', email: 'p@test.com', ticketPrefixes: ['PROD'], recallStrictness: 'strict' },
      },
      default: 'testprofile',
    }));
    writeFileSync(join(configDir, 'credentials.json'), JSON.stringify({
      testprofile: { apiToken: 'profile-token' },
    }));

    const mockFetch = async () => ({ ok: true, json: async () => cloudFixture });
    const out = captureOutput();
    try {
      await run(['PROD-1234', '--depth=0'], {}, mockFetch, configDir);
      assert.ok(out.stdout.includes('**Recall capture:** strict'));
    } finally {
      out.restore();
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it('omits the Recall capture strictness line when the resolved profile never set one (regression)', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'ticketlens-'));
    writeFileSync(join(configDir, 'profiles.json'), JSON.stringify({
      profiles: {
        testprofile: { baseUrl: 'https://profiled.atlassian.net', auth: 'cloud', email: 'p@test.com', ticketPrefixes: ['PROD'] },
      },
      default: 'testprofile',
    }));
    writeFileSync(join(configDir, 'credentials.json'), JSON.stringify({
      testprofile: { apiToken: 'profile-token' },
    }));

    const mockFetch = async () => ({ ok: true, json: async () => cloudFixture });
    const out = captureOutput();
    try {
      await run(['PROD-1234', '--depth=0'], {}, mockFetch, configDir);
      assert.ok(!out.stdout.includes('**Recall capture:**'));
    } finally {
      out.restore();
      rmSync(configDir, { recursive: true, force: true });
    }
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-name-pattern="Recall capture" skills/jtb/scripts/test/fetch-ticket.test.mjs`
Expected: FAIL — printed brief has no injected line (call sites don't pass it yet).

- [ ] **Step 3: Write minimal implementation**

In `skills/jtb/scripts/fetch-ticket.mjs`, four one-line changes:

Line 1127, from:
```js
      let plainBrief = assembleBrief(cached.ticket, codeRefs, templateSections, recallNotes, recallMoreCount, gaps);
```
to:
```js
      let plainBrief = assembleBrief(cached.ticket, codeRefs, templateSections, recallNotes, recallMoreCount, gaps, conn.recallStrictness);
```

Line 1141, from:
```js
        : (useStyled ? styleBrief(cached.ticket, codeRefs, { styled: true, templateSections, recallNotes, recallMoreCount, gaps }) : plainBrief);
```
to:
```js
        : (useStyled ? styleBrief(cached.ticket, codeRefs, { styled: true, templateSections, recallNotes, recallMoreCount, gaps, recallStrictness: conn.recallStrictness }) : plainBrief);
```

Line 1320, from:
```js
  let plainOutput = assembleBrief(ticket, codeRefs, templateSections, recallNotes, recallMoreCount, gaps);
```
to:
```js
  let plainOutput = assembleBrief(ticket, codeRefs, templateSections, recallNotes, recallMoreCount, gaps, conn.recallStrictness);
```

Line 1334, from:
```js
    : (useStyled ? styleBrief(ticket, codeRefs, { styled: true, templateSections, recallNotes, recallMoreCount, gaps }) : plainOutput);
```
to:
```js
    : (useStyled ? styleBrief(ticket, codeRefs, { styled: true, templateSections, recallNotes, recallMoreCount, gaps, recallStrictness: conn.recallStrictness }) : plainOutput);
```

Note: the `compliance` subcommand's call at line 653 (`assembleBrief(ticketC, codeRefsC)`) is deliberately left untouched — see File Structure table above.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test skills/jtb/scripts/test/fetch-ticket.test.mjs`
Expected: PASS, full file — new test plus zero regressions (every other test's profile fixture has no `recallStrictness`, so `conn.recallStrictness` normalizes to `'balanced'`, and the assemblers omit the line exactly as before).

- [ ] **Step 5: Commit**

```bash
git add skills/jtb/scripts/fetch-ticket.mjs skills/jtb/scripts/test/fetch-ticket.test.mjs
git commit -m "feat: thread recallStrictness from profile into fetched briefs"
```

---

## Task 8: `shouldNag()` — Stop hook trigger decision, extracted and unit-tested

**Files:**
- Modify: `skills/jtb/hooks/recall-nudge-lib.mjs` (append new function at end of file, after `scanTranscript`)
- Test: `skills/jtb/scripts/test/recall-nudge-lib.test.mjs`

**Interfaces:**
- Consumes: nothing new (pure function)
- Produces: `shouldNag({ sawTicketKey, sawRecallFlag, sawNoteAdd, recallStrictness = 'balanced' }): boolean`

This task's first tests are LOCK tests: they characterize `recall-nudge-stop.mjs`'s current trigger condition (`!sawTicketKey || sawNoteAdd → don't nag; otherwise nag`, unconditionally, regardless of `sawRecallFlag`) as it exists **today**, before any strictness logic is wired in. The `loose` tests that follow are the new RED/GREEN behavior.

- [ ] **Step 1: Write the failing tests**

Add to `skills/jtb/scripts/test/recall-nudge-lib.test.mjs`, add `shouldNag` to the import on line 6, new describe block at the end of the file:

```js
describe('shouldNag (Stop hook trigger decision)', () => {
  describe('balanced (today\'s exact trigger — LOCK)', () => {
    it('does not nag when no ticket work happened', () => {
      assert.equal(shouldNag({ sawTicketKey: false, sawRecallFlag: false, sawNoteAdd: false, recallStrictness: 'balanced' }), false);
    });

    it('does not nag when a note was already added', () => {
      assert.equal(shouldNag({ sawTicketKey: true, sawRecallFlag: false, sawNoteAdd: true, recallStrictness: 'balanced' }), false);
    });

    it('does not nag when a note was added even if a flag was also raised', () => {
      assert.equal(shouldNag({ sawTicketKey: true, sawRecallFlag: true, sawNoteAdd: true, recallStrictness: 'balanced' }), false);
    });

    it('nags when ticket work happened with no note and no flag', () => {
      assert.equal(shouldNag({ sawTicketKey: true, sawRecallFlag: false, sawNoteAdd: false, recallStrictness: 'balanced' }), true);
    });

    it('nags when a flag was raised but never followed by a note', () => {
      assert.equal(shouldNag({ sawTicketKey: true, sawRecallFlag: true, sawNoteAdd: false, recallStrictness: 'balanced' }), true);
    });
  });

  describe('strict (deliberately identical to balanced — not widened, spec §5)', () => {
    it('matches every balanced case exactly', () => {
      const cases = [
        { sawTicketKey: false, sawRecallFlag: false, sawNoteAdd: false },
        { sawTicketKey: true, sawRecallFlag: false, sawNoteAdd: true },
        { sawTicketKey: true, sawRecallFlag: true, sawNoteAdd: true },
        { sawTicketKey: true, sawRecallFlag: false, sawNoteAdd: false },
        { sawTicketKey: true, sawRecallFlag: true, sawNoteAdd: false },
      ];
      for (const c of cases) {
        assert.equal(
          shouldNag({ ...c, recallStrictness: 'strict' }),
          shouldNag({ ...c, recallStrictness: 'balanced' }),
        );
      }
    });
  });

  describe('loose (narrowed to the broken-promise case only)', () => {
    it('does not nag when ticket work happened but nothing was ever flagged', () => {
      assert.equal(shouldNag({ sawTicketKey: true, sawRecallFlag: false, sawNoteAdd: false, recallStrictness: 'loose' }), false);
    });

    it('still nags when a flag was raised but never followed by a note', () => {
      assert.equal(shouldNag({ sawTicketKey: true, sawRecallFlag: true, sawNoteAdd: false, recallStrictness: 'loose' }), true);
    });

    it('does not nag when no ticket work happened', () => {
      assert.equal(shouldNag({ sawTicketKey: false, sawRecallFlag: true, sawNoteAdd: false, recallStrictness: 'loose' }), false);
    });

    it('does not nag when a note was already added, even with a flag', () => {
      assert.equal(shouldNag({ sawTicketKey: true, sawRecallFlag: true, sawNoteAdd: true, recallStrictness: 'loose' }), false);
    });
  });

  it('defaults to balanced behavior when recallStrictness is omitted', () => {
    assert.equal(
      shouldNag({ sawTicketKey: true, sawRecallFlag: false, sawNoteAdd: false }),
      true,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-name-pattern="shouldNag" skills/jtb/scripts/test/recall-nudge-lib.test.mjs`
Expected: FAIL — `shouldNag is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `skills/jtb/hooks/recall-nudge-lib.mjs`, after `scanTranscript` (end of file):

```js
/**
 * Decides whether the Stop hook should block, calibrated by the active
 * profile's recallStrictness. `strict` deliberately uses the exact same
 * trigger as `balanced` — it does not additionally bypass
 * hasRecentCapture()'s rollover bridge or recall-nudge-stop.mjs's
 * once-per-session cap, both correctness invariants rather than
 * calibration knobs. Bypassing either would reintroduce a real bug
 * (re-nagging after a genuine capture that lands just before a
 * compaction/session_id rollover, or nagging more than once per session).
 * Strict's actual effect on capture volume comes from SKILL.md's lowered
 * in-session capture bar, not from this function.
 */
export function shouldNag({ sawTicketKey, sawRecallFlag, sawNoteAdd, recallStrictness = 'balanced' }) {
  if (!sawTicketKey || sawNoteAdd) return false;
  if (recallStrictness === 'loose') return sawRecallFlag; // only the broken-promise case
  return true; // balanced and strict: ticket work with no note is enough
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test skills/jtb/scripts/test/recall-nudge-lib.test.mjs`
Expected: PASS, full file — 15 new tests, zero regressions on the existing `lastCapture`/`scanTranscript` suites.

- [ ] **Step 5: Commit**

```bash
git add skills/jtb/hooks/recall-nudge-lib.mjs skills/jtb/scripts/test/recall-nudge-lib.test.mjs
git commit -m "feat: extract shouldNag trigger decision, add loose calibration"
```

---

## Task 9: Wire `recall-nudge-stop.mjs` to read profile strictness

**Files:**
- Modify: `skills/jtb/hooks/recall-nudge-stop.mjs` (full file — see below)
- Test: `skills/jtb/scripts/test/recall-nudge-stop.test.mjs` (**new file** — this hook has never had direct trigger-logic tests; see the LOCK note below on why a subprocess harness is required)

**Interfaces:**
- Consumes: `shouldNag` (Task 8), `resolveProfile`/`normalizeRecallStrictness` (`../scripts/lib/profile-resolver.mjs` — this is a **new dependency edge**: `hooks/` importing from `scripts/lib/` for the first time; flag this explicitly to the code-reviewer)

**Why a subprocess test harness (LOCK):** `recall-nudge-stop.mjs` runs its logic at module-load time (reads stdin synchronously via `readStdinJson()`) — it cannot be `import`ed directly in a test without triggering that read. `bin.test.mjs` already established the pattern for exactly this situation: `spawnSync(process.execPath, [path], { input, env: { ...process.env, HOME: freshTempDir } })`, using the `HOME` env override so `DEFAULT_CONFIG_DIR` (`join(homedir(), '.ticketlens')`) resolves inside an isolated temp directory instead of the real developer machine's `~/.ticketlens`. This plan reuses that exact established pattern — no new env var invented.

The LOCK tests here are: the once-per-session block cap, and (implicitly, since it's untouched code) the `hasRecentCapture` rollover bridge — both must survive the wiring change unchanged, at every strictness level.

- [ ] **Step 1: Write the failing tests**

Create `skills/jtb/scripts/test/recall-nudge-stop.test.mjs`:

```js
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { statePath } from '../../hooks/recall-nudge-lib.mjs';

const HOOK_PATH = fileURLToPath(new URL('../../hooks/recall-nudge-stop.mjs', import.meta.url));

function transcriptWith(entries) {
  return entries.map(e => JSON.stringify(e)).join('\n') + '\n';
}

function assistantText(t) {
  return { type: 'assistant', message: { content: [{ type: 'text', text: t }] } };
}

function assistantToolUse(name, input = {}) {
  return { type: 'assistant', message: { content: [{ type: 'tool_use', name, input }] } };
}

function runHook({ sessionId, transcriptPath, cwd, home }) {
  return spawnSync(process.execPath, [HOOK_PATH], {
    input: JSON.stringify({ session_id: sessionId, transcript_path: transcriptPath, cwd }),
    encoding: 'utf8',
    env: { ...process.env, HOME: home },
  });
}

function writeProfile(home, recallStrictness) {
  const configDir = join(home, '.ticketlens');
  mkdirSync(configDir, { recursive: true });
  const profile = recallStrictness ? { baseUrl: 'https://x.atlassian.net', recallStrictness } : { baseUrl: 'https://x.atlassian.net' };
  writeFileSync(join(configDir, 'profiles.json'), JSON.stringify({ profiles: { test: profile }, default: 'test' }));
}

describe('recall-nudge-stop hook (subprocess)', () => {
  let dir, home, transcriptPath, sessionId;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ticketlens-hook-'));
    home = join(dir, 'home');
    mkdirSync(home, { recursive: true });
    transcriptPath = join(dir, 'transcript.jsonl');
    sessionId = `test-${Math.random().toString(36).slice(2)}`;
  });

  afterEach(() => {
    try { rmSync(statePath(sessionId)); } catch { /* not written this test — fine */ }
    rmSync(dir, { recursive: true, force: true });
  });

  it('exits 0 with no profile configured (default balanced) when a note was added', () => {
    writeFileSync(transcriptPath, transcriptWith([
      assistantText('Looking at PROD-1234 now.'),
      assistantToolUse('Bash', { command: 'ticketlens note add --title=x' }),
    ]));
    const result = runHook({ sessionId, transcriptPath, cwd: dir, home });
    assert.equal(result.status, 0);
  });

  it('exits 2 with no profile configured (default balanced) when ticket work happened with no note and no flag', () => {
    writeFileSync(transcriptPath, transcriptWith([assistantText('Looking at PROD-1234 now.')]));
    const result = runHook({ sessionId, transcriptPath, cwd: dir, home });
    assert.equal(result.status, 2);
  });

  it('loose profile: exits 0 when ticket work happened but nothing was ever flagged', () => {
    writeProfile(home, 'loose');
    writeFileSync(transcriptPath, transcriptWith([assistantText('Looking at PROD-1234 now.')]));
    const result = runHook({ sessionId, transcriptPath, cwd: dir, home });
    assert.equal(result.status, 0);
  });

  it('loose profile: still exits 2 when a flag was raised but never followed by a note', () => {
    writeProfile(home, 'loose');
    writeFileSync(transcriptPath, transcriptWith([assistantText('🔖 Recall-flag: found a gotcha')]));
    const result = runHook({ sessionId, transcriptPath, cwd: dir, home });
    assert.equal(result.status, 2);
  });

  it('strict profile: behaves identically to no profile (balanced) — exits 2 on ticket work with no note', () => {
    writeProfile(home, 'strict');
    writeFileSync(transcriptPath, transcriptWith([assistantText('Looking at PROD-1234 now.')]));
    const result = runHook({ sessionId, transcriptPath, cwd: dir, home });
    assert.equal(result.status, 2);
  });

  it('LOCK: never blocks a second time for the same session_id, at every strictness level', () => {
    for (const level of ['loose', 'balanced', 'strict']) {
      writeProfile(home, level);
      const sid = `${sessionId}-${level}`;
      writeFileSync(transcriptPath, transcriptWith([assistantText('Looking at PROD-1234 now.')]));
      const first = runHook({ sessionId: sid, transcriptPath, cwd: dir, home });
      const second = runHook({ sessionId: sid, transcriptPath, cwd: dir, home });
      try {
        if (level === 'loose') {
          // loose never blocks this signal at all — both calls exit 0, cap is moot but must not regress
          assert.equal(first.status, 0, `loose first (should be 0, no flag raised)`);
        } else {
          assert.equal(first.status, 2, `${level} first`);
        }
        assert.equal(second.status, 0, `${level} second (cap must hold)`);
      } finally {
        try { rmSync(statePath(sid)); } catch { /* fine */ }
      }
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test skills/jtb/scripts/test/recall-nudge-stop.test.mjs`
Expected: FAIL — `loose` and `strict` cases behave identically to today's unconditional trigger (no strictness read yet), so the `loose` "exits 0 when nothing was flagged" case fails (gets 2 instead).

- [ ] **Step 3: Write minimal implementation**

Replace the full contents of `skills/jtb/hooks/recall-nudge-stop.mjs`:

```js
#!/usr/bin/env node
/**
 * Stop hook — end-of-session Recall check.
 *
 * Blocks (exit 2) at most ONCE per session — never traps the user in a
 * loop regardless of how Claude responds. Two cases force a check:
 *   1. Claude flagged something (🔖 Recall-flag:) but never called note add
 *      — a broken promise, the strongest signal something was missed.
 *   2. Ticket work happened all session with zero flags and zero notes
 *      — the weaker "did anything ever get considered?" catch.
 * Anything else (no ticket work at all, or a note was already added) exits
 * clean — this must never be the reason a session can't end.
 *
 * The per-session_id "asked once" state (readState/writeState) cannot
 * survive a compaction/resume event — that hands this hook a brand-new
 * session_id, a blank dedup state, AND a blank transcript file, so a real
 * earlier capture becomes invisible. The cross-session lastCapture marker
 * (keyed by cwd, not session_id) is what actually bridges that boundary.
 *
 * Which of the two cases above actually blocks is governed by the active
 * profile's recallStrictness — see recall-nudge-lib.mjs's shouldNag() doc
 * comment for the calibration and why strict doesn't widen this further.
 */

import { readStdinJson, readState, writeState, scanTranscript, hasRecentCapture, writeLastCaptureAt, shouldNag } from './recall-nudge-lib.mjs';
import { resolveProfile, normalizeRecallStrictness } from '../scripts/lib/profile-resolver.mjs';

const input = readStdinJson();
const sessionId = input?.session_id;
const transcriptPath = input?.transcript_path;
const cwd = input?.cwd ?? process.cwd();

if (!sessionId || !transcriptPath) process.exit(0);

const { sawTicketKey, sawRecallFlag, sawNoteAdd } = scanTranscript(transcriptPath);

// Refreshed on every check, independent of the once-per-session gate below —
// a capture that happens AFTER this session already nagged once must still
// update the marker, or a later session_id rollover would find it stale.
if (sawNoteAdd) writeLastCaptureAt(cwd, Date.now());

const state = readState(sessionId);
if (state.stopChecked) process.exit(0); // already asked once this session — respect the answer

const profile = resolveProfile(null, { cwd });
const recallStrictness = normalizeRecallStrictness(profile?.recallStrictness);

if (!shouldNag({ sawTicketKey, sawRecallFlag, sawNoteAdd, recallStrictness })) {
  process.exit(0); // nothing this strictness level requires a capture for
}

if (hasRecentCapture(cwd)) {
  process.exit(0); // a real capture landed recently in this same directory, just under a different session_id
}

state.stopChecked = true;
writeState(sessionId, state);

if (sawRecallFlag) {
  process.stderr.write(
    'You flagged something as Recall-worthy (🔖 Recall-flag:) earlier this session but ' +
    'never called `ticketlens note add`. Do that now, or say explicitly why it turned ' +
    'out not to qualify — then you can finish.\n',
  );
} else {
  process.stderr.write(
    'This session touched ticket work but nothing was ever captured to Recall. If a ' +
    'non-obvious insight, gotcha, or decision came up, capture it now via ' +
    '`ticketlens note add`. If genuinely nothing qualified, just say so — then finish.\n',
  );
}
process.exit(2);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test skills/jtb/scripts/test/recall-nudge-stop.test.mjs`
Expected: PASS, 7/7.

Then run the full CLI suite to confirm zero regressions elsewhere:

Run: `node --test skills/jtb/scripts/test/*.test.mjs 2>&1 | tail -15`
Expected: all tests pass, count only went up.

- [ ] **Step 5: Commit**

```bash
git add skills/jtb/hooks/recall-nudge-stop.mjs skills/jtb/scripts/test/recall-nudge-stop.test.mjs
git commit -m "feat: calibrate Stop hook nag trigger by recallStrictness"
```

---

## Task 10: SKILL.md calibration blocks

**Files:**
- Modify: `skills/jtb/SKILL.md:214-222` ("When to capture a note" section)

No automated test — this is prompt prose reviewed by human/code-reviewer read-through, not executable code. Manual self-review step included below in place of a test run.

- [ ] **Step 1: Make the edit**

In `skills/jtb/SKILL.md`, replace lines 214-222:

```markdown
### When to capture a note

Capture only when **all three** hold:

1. **Not already written down** — not in the ticket description or comments, not already in an existing `## Recall` note shown in this brief.
2. **Generalizes beyond this one diff** — useful to a future session on this ticket, this project, or a similar bug class. A fact only relevant to the exact change you just made doesn't qualify.
3. **Cost real effort to discover** — required debugging, reading multiple files, trial and error, or a decision with a non-obvious rationale. Something obvious from reading the code once doesn't qualify.

Example that qualifies: an undocumented schema quirk found only by reading raw DDL (e.g. a table has no `name` column, it's on a related table instead). Example that doesn't: a one-off typo fix with no broader lesson.
```

with:

```markdown
### When to capture a note

If the TicketBrief includes a `**Recall capture:**` line, calibrate against the matching level below. No such line (or `balanced`) uses the **Balanced** rule as-is — this is the default and requires no adjustment.

Capture only when **all three** hold:

1. **Not already written down** — not in the ticket description or comments, not already in an existing `## Recall` note shown in this brief.
2. **Generalizes beyond this one diff** — useful to a future session on this ticket, this project, or a similar bug class. A fact only relevant to the exact change you just made doesn't qualify.
3. **Cost real effort to discover** — required debugging, reading multiple files, trial and error, or a decision with a non-obvious rationale. Something obvious from reading the code once doesn't qualify.

Point 1 and the secret/credential exclusion below are correctness checks, not judgment calls — they hold at every strictness level, no exceptions.

**Balanced (default):** the three-part rule above, applied as written.

**Loose (`**Recall capture:** loose`):** raise the bar on points 2 and 3 — only capture when the effort was clearly substantial (real debugging or multiple files, not "read one file twice") and the generalization is concrete, not speculative ("useful to a similar bug class" needs a plausible next occurrence, not just theoretical reuse). When genuinely borderline, skip it.

**Strict (`**Recall capture:** strict`):** lower the bar on points 2 and 3 — capture when in doubt. A decision with a rationale that took even a moment of back-and-forth to land on, or a fact that plausibly helps a future session even if the connection isn't certain, qualifies. Still never capture something that fails point 1, or that's shaped like a credential/API key — the tool rejects those at save time regardless.

Example that qualifies: an undocumented schema quirk found only by reading raw DDL (e.g. a table has no `name` column, it's on a related table instead). Example that doesn't: a one-off typo fix with no broader lesson.
```

- [ ] **Step 2: Self-review**

Read the edited section back and confirm: the Balanced block is verbatim identical to today's three-part rule (byte-for-byte, per Global Constraints), the Loose/Strict blocks only adjust points 2/3 language (never point 1 or the secret exclusion), and the preface correctly references the exact literal string (`**Recall capture:**`) that Task 5/6 inject — a mismatch here would silently break the whole feature since Claude reads this as free text, not code.

- [ ] **Step 3: Commit**

```bash
git add skills/jtb/SKILL.md
git commit -m "docs: add Recall capture strictness calibration to SKILL.md"
```

---

## Final Verification (after all 10 tasks)

- [ ] Run the full CLI suite: `node --test skills/jtb/scripts/test/*.test.mjs 2>&1 | tail -10` — expect 0 failures, count higher than the pre-plan baseline.
- [ ] Confirm no file exceeds the project's size guideline was newly introduced by this plan (`profile-resolver.mjs` was 320 lines pre-plan; check it stayed well under 800 after Tasks 1/2/3/4).
- [ ] Run code-reviewer on the full diff across both repos-worth of files (single repo here): flag the new `hooks/` → `scripts/lib/` import edge (Task 9) explicitly for review — it's a new dependency direction in this codebase.
- [ ] Confirm ROADMAP.md's 49d entry gets marked shipped once this lands (out of scope for this plan's tasks — a manual follow-up per this project's ship-log convention).
