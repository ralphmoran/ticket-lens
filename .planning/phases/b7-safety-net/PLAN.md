# Phase B.7 — Safety Net: Implementation Plan

**Date:** 2026-04-14
**Baseline:** 582 tests passing, zero runtime npm deps
**Phase dir:** `.planning/phases/b7-safety-net/`

---

## Overview

Six Pro-tier safety/intelligence features built in dependency order. Each feature is independently
completable and verifiable. All new modules follow the established pattern: named exports, no
default exports, injectable deps (execFn, fsModule, configDir). Tests use `node:test` +
`node:assert/strict` with tmp-dir isolation (no real `~/.ticketlens` writes).

Build order: B7-5 → B7-4 → B7-2 → B7-3 → B7-1 → B7-6

Note: All features are independently deliverable. The order is recommended (B7-5 first as
warm-up, B7-6 last as most cross-cutting) but features compile and test correctly in isolation.

---

## B7-5: Compliance Ledger

### Goal

Auto-append an immutable JSONL audit record to `~/.ticketlens/ledger.jsonl` after every
successful compliance check (Pro tier only). Expose a `ticketlens ledger` subcommand for
signed export.

### Files to create/modify

| Action | Path |
|--------|------|
| CREATE | `skills/jtb/scripts/lib/ledger.mjs` |
| MODIFY | `skills/jtb/scripts/lib/compliance-checker.mjs` |
| MODIFY | `skills/jtb/scripts/lib/cli.mjs` |
| CREATE | `skills/jtb/scripts/test/ledger.test.mjs` |

### Implementation steps

#### Step 1 — Write test skeleton (RED)

Create `test/ledger.test.mjs` with the following test cases (all failing until implementation):

```
- appendLedger() writes a valid JSON line to ledger.jsonl
- appendLedger() appends (does not overwrite) on second call
- appendLedger() creates configDir if missing
- readLedger() returns [] when file absent
- readLedger() parses all records and returns array
- readLedger({ since }) filters records by ts >= date
- exportLedger('json') returns { records, exportedAt, signature }
- exportLedger('csv') returns string with header row
- HMAC signature in JSON export verifies correctly with stored key
- exportLedger() generates ledger-key on first call (file missing)
- appendLedger() is a no-op when isPro is false
```

Use `mkdtempSync` / `rmSync` from `node:fs` for tmp configDir — never write to real `~/.ticketlens`.

#### Step 2 — Implement `lib/ledger.mjs`

```javascript
// Named exports only. All fs operations take fsModule param (default: node:fs).
// Injectable configDir param (default: DEFAULT_CONFIG_DIR).

export function appendLedger(record, { configDir, fsModule, isPro } = {})
// record: { ticketKey, commitSha, author, coverage, missing[] }
// Adds { ts: new Date().toISOString(), ...record } as one JSON line
// No-op when isPro is false (Pro gate enforced by caller AND here as safety)
// Uses fsModule.appendFileSync — atomic enough for single-machine use

export function readLedger({ configDir, fsModule, since } = {})
// Returns array of parsed records. since = ISO date string (optional filter).

export function exportLedger(format, { configDir, fsModule } = {})
// format: 'json' | 'csv'
// JSON: { records, exportedAt, signature } — HMAC-SHA256 of JSON.stringify(records+exportedAt)
// CSV: header + one row per record
// Key stored at configDir/ledger-key (generate with crypto.randomBytes(32).toString('hex') on first use)
// Uses node:crypto createHmac('sha256', key)
```

Record schema written to ledger.jsonl:
```json
{"ts":"ISO","ticketKey":"PROJ-123","commitSha":"abc123","author":"user@example.com","coverage":75,"missing":["unit test"]}
```

#### Step 3 — Modify `lib/compliance-checker.mjs`

After the `return { report, coveragePercent }` line, call `appendLedger` when `isPro` is true.
Add `appendLedgerFn = appendLedger` to the injectable deps object (default import from ledger.mjs).
Pass `{ ticketKey, commitSha: 'HEAD', author: gitEmail, coverage: coveragePercent, missing }`.

`gitEmail` from `spawnSync('git', ['config', 'user.email'])` — fall back to `'unknown'` if git
not available or not in a repo. Add `execFn = spawnSync` to injectable deps.

**Wiring step (required):** Add `import { spawnSync } from 'node:child_process';` to the top of
`compliance-checker.mjs`. This import does not currently exist in that file.

#### Step 4 — Modify `lib/cli.mjs`

Add routing for the `ledger` subcommand:

```javascript
if (first === 'ledger') {
  return { command: 'ledger', args: args.slice(1) };
}
```

Add this block before the catch-all `return { command: 'fetch', args }` line.

The `ledger` subcommand handler (in the main CLI dispatcher, not cli.mjs) accepts:
- `--format=csv|json` (default: json)
- `--since=YYYY-MM-DD` (optional)

Output goes to stdout. Signature verification notice goes to stderr.

### Acceptance criteria

- `node:test` runs `test/ledger.test.mjs` with 0 failures
- Running `ticketlens compliance PROJ-123` (Pro licensed) appends one line to `~/.ticketlens/ledger.jsonl`
- Running again appends a second line (file not overwritten)
- `ticketlens ledger` prints JSON with `signature` field
- `ticketlens ledger --format=csv` prints CSV with header `ts,ticketKey,commitSha,author,coverage,missing`
- `ticketlens ledger --since=2026-01-01` filters output
- Non-Pro license: no ledger write, no `ledger` subcommand output (upgrade prompt instead)

---

## B7-4: Token Budget Optimizer

### Goal

Add `--budget N` flag to `fetch-ticket.mjs`. After brief assembly, if the estimated token count
exceeds N, prune content in priority order and report what was dropped to stderr.

### Files to create/modify

| Action | Path |
|--------|------|
| CREATE | `skills/jtb/scripts/lib/budget-pruner.mjs` |
| MODIFY | `skills/jtb/scripts/fetch-ticket.mjs` |
| CREATE | `skills/jtb/scripts/test/budget-pruner.test.mjs` |

### Implementation steps

#### Step 1 — Write test skeleton (RED)

Create `test/budget-pruner.test.mjs` with the following test cases:

```
- estimateTokens('') returns 0
- estimateTokens(text) returns Math.ceil(text.length / 4)
- pruneBrief() returns brief unchanged when tokens <= budget
- pruneBrief() removes comments older than 30 days first (priority 1)
- pruneBrief() removes attachment metadata when still over budget (priority 2)
- pruneBrief() truncates long descriptions when still over budget (priority 3)
- pruneBrief() keeps first 500 chars of description + '…[truncated]'
- pruneBrief() removes linked ticket comments, keeps key+summary (priority 4)
- pruneBrief() emits drop report to stream param
- drop report format: '  ○ Budget: N tokens. Pruned: ...'
- pruneBrief() returns unpruned + warning when budget < bare minimum
- bare minimum = ticket key + summary line only (never prune that)
```

Use injectable `stream` param (default `process.stderr`) and fixed `now` date param for
deterministic "older than 30 days" test without real Date.now().

#### Step 2 — Implement `lib/budget-pruner.mjs`

```javascript
export function estimateTokens(text)
// Returns Math.ceil(text.length / 4)

export function pruneBrief(brief, { budget, stream, now } = {})
// brief: assembled brief string
// budget: integer token limit
// stream: writable (default process.stderr)
// now: Date object for age calculations (default new Date())
// Returns { pruned: string, dropped: string[], finalTokens: number }
```

Pruning is applied to the markdown brief string (output of `assembleBrief`). Parse sections by
`## ` heading markers. Strip/truncate section content without destroying heading structure.

Priority order:
1. Comments section: remove individual comment blocks with `created` date > 30 days ago
2. Attachments section: remove entire `## Attachments` section
3. Description section: keep first 500 chars + `\n…[truncated]`
4. Linked ticket comments: in `## Linked Tickets`, keep `**KEY:** summary` lines, remove bodies

Drop report format (written to stream):
```
  ○ Budget: 4000 tokens. Pruned: 3 old comments (−340t), 2 attachments (−80t)
  ○ Final estimate: 3580 tokens
```

Warning when budget < bare minimum (first two lines of brief):
```
  ⚠  Budget N too small — returning full brief. Minimum is ~M tokens.
```

#### Step 3 — Modify `fetch-ticket.mjs`

Parse `--budget N` from args. After `assembleBrief()` call and **before** `styleBrief()`:
if `--budget` is set, call `pruneBrief(plainBrief, { budget: N, stream: process.stderr })` and
use `result.pruned` as the plain brief string. Then pass the pruned plain string to `styleBrief()`
as normal (styled output is applied after pruning, not before).

This ensures token estimation operates on clean text (no ANSI escape codes). Estimating tokens
on an ANSI-styled string inflates counts by ~10–30% due to escape sequences.

`--budget` is a Pro feature. Gate with `isLicensed('pro', configDir)` — show upgrade prompt and
skip pruning if not Pro.

Add `--budget` to the list of known flags in `handleUnknownFlags` call to avoid "unknown flag"
warning.

### Acceptance criteria

- `node:test` runs `test/budget-pruner.test.mjs` with 0 failures
- `ticketlens PROJ-123 --budget 1000` (Pro) prunes and emits drop report to stderr
- Brief output is shorter than or equal to estimated budget tokens
- Non-Pro: `--budget` flag shows upgrade prompt, outputs full brief
- `ticketlens PROJ-123` (no flag) behaves identically to before this change

---

## B7-2: Git Hook Compliance Gate

### Goal

`ticketlens install-hooks` writes a pre-push hook to `.git/hooks/pre-push` that extracts the
ticket key from the current branch name and blocks the push if compliance coverage is below
the configured threshold.

### Files to create/modify

| Action | Path |
|--------|------|
| CREATE | `skills/jtb/scripts/lib/hook-installer.mjs` |
| MODIFY | `skills/jtb/scripts/lib/cli.mjs` |
| CREATE | `skills/jtb/scripts/test/hook-installer.test.mjs` |

### Implementation steps

#### Step 1 — Write test skeleton (RED)

Create `test/hook-installer.test.mjs` with:

```
- generateHookScript() returns a string starting with '#!/bin/sh'
- generateHookScript() contains 'git symbolic-ref HEAD'
- generateHookScript() contains 'ticketlens compliance'
- generateHookScript() contains the configured threshold value
- installHook() creates .git/hooks/pre-push file
- installHook() sets file mode 0o755 (executable)
- installHook() creates .ticketlens-hooks.json in cwd with { complianceThreshold: 80 }
- installHook() appends to existing hook file rather than overwriting
- installHook() is idempotent: calling twice does not duplicate the block
- installHook() throws when .git/hooks/ dir does not exist
- installHook() on Windows (platform === 'win32') skips and returns { skipped: true, reason }
```

Use tmp dirs for `.git/hooks/` simulation. Injectable `fsModule`, `platform` string param.

#### Step 2 — Implement `lib/hook-installer.mjs`

```javascript
export function generateHookScript({ threshold = 80 } = {})
// Returns sh script string. The script:
// 1. Gets branch: BRANCH=$(git symbolic-ref HEAD 2>/dev/null | sed 's|refs/heads/||')
// 2. Extracts ticket key: KEY=$(echo "$BRANCH" | grep -oE '[A-Z]+-[0-9]+' | head -1)
// 3. If KEY is empty, exits 0 (no ticket, allow push)
// 4. Runs: ticketlens compliance "$KEY" -- exit code non-zero blocks push
// 5. Prints clear message on block: "Push blocked: compliance < THRESHOLD% for $KEY"

export function installHook({ cwd, threshold, fsModule, platform } = {})
// cwd: repo root (default process.cwd())
// threshold: integer 0-100 (default 80)
// fsModule: injectable (default node:fs)
// platform: injectable (default process.platform)
// Returns { installed: true, path } or { skipped: true, reason }
//
// Logic:
// - Return skipped on Windows
// - Verify .git/hooks/ exists, throw if not
// - Read existing hook content (empty string if file absent)
// - Guard string: '# ticketlens-compliance-gate' — skip append if already present
// - Append the hook script block (guard + script)
// - chmodSync(hookPath, 0o755)
// - Write .ticketlens-hooks.json: { complianceThreshold: threshold }
```

Hook file path: `{cwd}/.git/hooks/pre-push`
Config file path: `{cwd}/.ticketlens-hooks.json`

#### Step 3 — Modify `lib/cli.mjs` and `fetch-ticket.mjs`

**In `lib/cli.mjs`**, add routing before the catch-all fetch line:

```javascript
if (first === 'install-hooks') {
  return { command: 'install-hooks', args: args.slice(1) };
}
```

**In `fetch-ticket.mjs`**, add early dispatch at the top of `run()`, immediately after the
`--help` check and **before** the ticket key validation (line ~171):

```javascript
// Dispatch non-ticket subcommands before ticket key check
if (args[0] === 'install-hooks') {
  const { installHook } = await import('./lib/hook-installer.mjs');
  try {
    const result = await installHook({ cwd: process.cwd() });
    if (result.skipped) {
      process.stderr.write(`  Hook install skipped: ${result.reason}\n`);
    } else {
      process.stdout.write(`  Hook installed: ${result.path} (threshold: 80%)\n`);
    }
  } catch (err) {
    process.stderr.write(`  Error installing hook: ${err.message}\n`);
    process.exitCode = 1;
  }
  return;
}
```

Similarly add early dispatch blocks for `pr` (calls `assemblePr`) and `ledger` (calls
`exportLedger`) using the same pattern.

### Acceptance criteria

- `node:test` runs `test/hook-installer.test.mjs` with 0 failures
- `ticketlens install-hooks` in a git repo creates `.git/hooks/pre-push` with mode 0o755
- Running again does not duplicate the ticketlens block in the hook file
- `.ticketlens-hooks.json` written to cwd with `complianceThreshold: 80`
- On non-git dir (no `.git/hooks/`): prints actionable error, exits 1
- On Windows: prints "Not supported on Windows" and exits 0

---

## B7-3: Ticket-to-PR Assembler

### Goal

`ticketlens pr TICKET-KEY` generates a markdown PR description to stdout by composing
existing modules: ticket data, extracted requirements, linked commits, compliance coverage, and
linked ticket summaries.

### Files to create/modify

| Action | Path |
|--------|------|
| CREATE | `skills/jtb/scripts/lib/pr-assembler.mjs` |
| MODIFY | `skills/jtb/scripts/lib/cli.mjs` |
| CREATE | `skills/jtb/scripts/test/pr-assembler.test.mjs` |

### Implementation steps

#### Step 1 — Write test skeleton (RED)

Create `test/pr-assembler.test.mjs` with:

```
- assemblePr() returns a string
- assemblePr() output starts with '## PROJ-123:'
- assemblePr() includes '### What changed' section
- assemblePr() includes '### Requirements coverage' section with percentage
- assemblePr() includes '### Acceptance criteria' section
- assemblePr() includes '### Linked tickets' section when linkedTicketDetails present
- assemblePr() adds 'Closes PROJ-123' footer for github.com remote
- assemblePr() adds 'Closes PROJ-123' footer for gitlab.com remote
- assemblePr() omits close footer for non-GitHub/GitLab remotes
- assemblePr() omits close footer when no remote detected
- assemblePr() marks covered requirements with ✔ and missing with ✖
- assemblePr() handles ticket with no requirements gracefully
- assemblePr() handles ticket with no linked commits gracefully
```

All deps injectable: `fetchTicketFn`, `extractRequirementsFn`, `findLinkedCommitsFn`,
`runComplianceCheckFn`, `execFn`. Use mock ticket object matching the shape returned by
`fetchTicket()`.

In every test, mock ALL injectable deps — no real process spawning:
- `findLinkedCommitsFn` → `async () => [{ sha: 'abc1234', message: 'feat: PROJ-123 change' }]`
- `execFn` → `() => ({ stdout: 'https://github.com/org/repo.git', status: 0 })` (for git remote)
- `runComplianceCheckFn` → `async () => ({ coveragePercent: 75, report: [...], missing: [] })`

#### Step 2 — Implement `lib/pr-assembler.mjs`

```javascript
export async function assemblePr(ticketKey, {
  configDir,
  fetchTicketFn,
  extractRequirementsFn,
  findLinkedCommitsFn,
  runComplianceCheckFn,
  execFn,         // for git remote get-url origin
  stream,         // stderr for progress (optional)
} = {})
// Returns markdown string
```

Output format (exact section order):

```markdown
## PROJ-123: <summary>

### What changed
- abc1234 feat: PROJ-123 implement payment validation
- def5678 fix: PROJ-123 handle empty cart

### Requirements coverage (75%)
- ✔ Must validate email (src/CartService.php:42)
- ✖ Must handle empty fields

### Acceptance criteria
- Validate email format on submit
- Show error for empty required fields

### Linked tickets
- PROJ-100: Parent epic — Authentication overhaul
- PROJ-200: Depends on — Email validator library

---
Closes PROJ-123
```

Remote detection logic (injectable execFn):
1. `git remote get-url origin` — get remote URL
2. If URL contains `github.com` or `gitlab.com`: append `\nCloses TICKET-KEY`
3. Otherwise: omit close line

Compliance coverage: call `runComplianceCheckFn({ brief, ticketKey, configDir })` — the real
`runComplianceCheck` signature requires all three fields. If result is null (non-Pro or usage
exhausted), show `(coverage unavailable — Pro required)` in the section header and list raw
requirements with no ✔/✖ markers.

#### Step 3 — Modify `lib/cli.mjs`

Add routing:

```javascript
if (first === 'pr') {
  return { command: 'pr', args: args.slice(1) };
}
```

The handler passes the ticket key as `args[0]` and validates it against `TICKET_KEY_PATTERN`.

### Acceptance criteria

- `node:test` runs `test/pr-assembler.test.mjs` with 0 failures
- `ticketlens pr PROJ-123` prints markdown PR body to stdout
- All four sections present in output
- `Closes PROJ-123` footer present when origin is a GitHub/GitLab URL
- No external HTTP calls during tests (all deps mocked)
- Non-existent ticket key: prints error to stderr, exits 1

---

## B7-1: Spec Drift Detection

### Goal

On each `ticketlens TICKET-KEY` fetch, compare key ticket fields against the previous snapshot
for the same ticket + git branch. If drift is detected, emit a warning to stderr before the
brief is printed.

### Files to create/modify

| Action | Path |
|--------|------|
| CREATE | `skills/jtb/scripts/lib/drift-tracker.mjs` |
| MODIFY | `skills/jtb/scripts/fetch-ticket.mjs` |
| CREATE | `skills/jtb/scripts/test/drift-tracker.test.mjs` |

### Implementation steps

#### Step 1 — Write test skeleton (RED)

Create `test/drift-tracker.test.mjs` with:

```
- readSnapshot() returns null when file absent
- readSnapshot() returns parsed object when file exists
- writeSnapshot() creates directory and file
- writeSnapshot() sanitizes profile name (path traversal)
- writeSnapshot() sanitizes ticket key (path traversal)
- detectDrift() returns { drifted: false } when no prior snapshot
- detectDrift() returns { drifted: false } when fields identical
- detectDrift() returns { drifted: true, changes } when status changed
- detectDrift() returns { drifted: true, changes } when descriptionHash changed
- detectDrift() returns { drifted: true, changes } when requirements array changed
- detectDrift() ignores fetchedAt and branch in comparison
- formatDriftWarning() returns non-empty string with ticket key
- formatDriftWarning() includes old and new status values
- getCurrentBranch() returns 'DETACHED' on detached HEAD
- getCurrentBranch() returns branch name on normal HEAD
```

Injectable: `fsModule`, `configDir`, `execFn` (for `git rev-parse`).

#### Step 2 — Implement `lib/drift-tracker.mjs`

Snapshot file path:
```
~/.ticketlens/drift/<profile>/<TICKET-KEY>.json
```

Sanitize both `profile` and `ticketKey` before joining into path: reject strings containing
`/`, `\`, or `..` (throw `Error('Invalid profile name')` / `Error('Invalid ticket key')`).

```javascript
export function getCurrentBranch({ execFn, cwd } = {})
// spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'])
// Returns 'DETACHED' on detached HEAD (output === 'HEAD')
// Returns '' when not in a git repo (non-zero exit)

export function readSnapshot(ticketKey, { profile, configDir, fsModule } = {})
// Returns parsed JSON or null

export function writeSnapshot(ticketKey, ticket, { profile, configDir, fsModule, branch } = {})
// ticket: raw Jira ticket object from fetchTicket()
// Writes: { fetchedAt, branch, status, descriptionHash, requirements }
// descriptionHash: createHash('sha256').update(ticket.description ?? '').digest('hex')
// requirements: extractRequirements(ticket.description ?? '') — import from requirement-extractor.mjs

export function detectDrift(current, prior)
// current: { status, descriptionHash, requirements }
// prior: snapshot object (with those fields)
// Returns { drifted: boolean, changes: string[] }
// changes entries: 'status: "In Progress" → "Done"', 'description changed', 'requirements: 2 → 3'

export function formatDriftWarning(ticketKey, changes)
// Returns a stderr-ready string with ANSI amber/yellow
// Example: '  ⚠  PROJ-123 spec drift detected:\n  • status: "In Progress" → "Done"\n'
```

#### Step 3 — Modify `fetch-ticket.mjs`

After `fetchTicket()` succeeds and before `assembleBrief()`:

1. Call `getCurrentBranch()` — if not in a git repo, skip drift check silently
2. Call `readSnapshot(ticketKey, { profile, configDir })`
3. If snapshot exists: call `detectDrift(currentFields, snapshot)` — if drifted, write warning
   to `process.stderr`
4. Call `writeSnapshot(ticketKey, rawTicket, { profile, configDir, branch })`

Add injectable deps to the main function signature for testability: `driftTrackerModule`.
In tests, pass `{ getCurrentBranch: () => 'feat/test', readSnapshot: () => null, writeSnapshot: () => {}, detectDrift: () => ({ drifted: false }), formatDriftWarning: () => '' }`.

Drift check is silently skipped (no error) when:
- Not in a git repo
- configDir is not writable
- Any snapshot I/O error (wrap in try/catch, non-fatal)

### Acceptance criteria

- `node:test` runs `test/drift-tracker.test.mjs` with 0 failures
- First `ticketlens PROJ-123` fetch: no drift warning, snapshot written to
  `~/.ticketlens/drift/<profile>/PROJ-123.json`
- Second fetch with same ticket fields: no drift warning
- Second fetch after ticket status changed: stderr shows drift warning before brief
- Detached HEAD state: drift check skipped silently
- Non-git directory: drift check skipped silently
- Path traversal in profile name: error thrown (not silently ignored)

---

## B7-6: Stale Delta Report

### Goal

Upgrade the scheduled triage digest to include a delta section prepended to the email body
showing which tickets worsened since yesterday.

### Files to create/modify

| Action | Path |
|--------|------|
| CREATE | `skills/jtb/scripts/lib/triage-history.mjs` |
| MODIFY | `skills/jtb/scripts/fetch-my-tickets.mjs` |
| CREATE | `skills/jtb/scripts/test/triage-history.test.mjs` |

**Architecture note:** The digest email is assembled server-side at `ticketlens-api`. Locally,
`fetch-my-tickets.mjs` only POSTs a JSON payload to `https://api.ticketlens.dev/v1/digest/deliver`.
The delta section is added as a `delta` key in that payload — the server renders it into the email.
Do NOT attempt to prepend to a local email body string — none exists.

### Implementation steps

#### Step 1 — Write test skeleton (RED)

Create `test/triage-history.test.mjs` with:

```
- saveTriageSnapshot() writes file to ~/.ticketlens/triage-history/YYYY-MM-DD/<profile>.json
- saveTriageSnapshot() creates directory if absent
- saveTriageSnapshot() sanitizes profile name
- loadYesterdaySnapshot() returns null when no file for previous date
- loadYesterdaySnapshot() returns parsed array when file exists
- diffSnapshots() returns [] when both arrays identical
- diffSnapshots() detects urgency worsening: 'clear' → 'aging' or 'aging' → 'needs-response'
- diffSnapshots() detects urgency worsening: 'clear' → 'needs-response'
- diffSnapshots() detects new comments: lastComment.created newer than yesterday's snapshot
- diffSnapshots() detects staleness threshold crossed: daysSinceUpdate was <7, now >=7
- diffSnapshots() ignores tickets that improved (urgency order went up toward 'clear')
- diffSnapshots() ignores tickets present in today but absent yesterday (new tickets)
- buildDeltaSection() returns '' when deltas is empty
- buildDeltaSection() returns formatted string starting with delta header
- buildDeltaSection() includes ▼ prefix for each worsening ticket
- buildDeltaSection() shows urgency change: 'aging → needs-response'
- buildDeltaSection() shows new comments: '1 new comment'
- buildDeltaSection() shows staleness crossing: 'stale threshold crossed (N days idle)'
```

Injectable: `fsModule`, `configDir`, `now` (Date for deterministic date calculation in tests).

**Field mapping reference** — `scoreAttention()` returns:
`{ ticketKey, summary, status, urgency, reason, lastComment, daysSinceUpdate }`

`URGENCY_ORDER = { 'needs-response': 0, 'aging': 1, 'clear': 2 }` — lower number = more urgent.
"Worsened" = today's urgency order < yesterday's (moved toward needs-response).
"New comment" = today's `lastComment.created` is different from yesterday's `lastComment?.created`.
"Stale" = `daysSinceUpdate >= 7` today AND `daysSinceUpdate < 7` yesterday.

#### Step 2 — Implement `lib/triage-history.mjs`

Storage path:
```
~/.ticketlens/triage-history/YYYY-MM-DD/<profile>.json
```

```javascript
export function saveTriageSnapshot(tickets, { profile, configDir, fsModule, now } = {})
// tickets: array of scored ticket objects from attention-scorer (scoreAttention() return values)
// Each ticket: { ticketKey, summary, status, urgency, reason, lastComment, daysSinceUpdate }
// Writes JSON array. Sanitizes profile name (reject / \ ..)
// Date from now param (default new Date()) formatted as YYYY-MM-DD

export function loadYesterdaySnapshot({ profile, configDir, fsModule, now } = {})
// Returns parsed JSON array or null
// Yesterday = one day before now param

export function diffSnapshots(today, yesterday)
// today, yesterday: arrays of { ticketKey, urgency, lastComment, daysSinceUpdate, ... }
// Match by ticketKey. Only emit entries for tickets present in BOTH arrays.
// URGENCY_ORDER = { 'needs-response': 0, 'aging': 1, 'clear': 2 }
// "Worsened" = URGENCY_ORDER[today.urgency] < URGENCY_ORDER[yesterday.urgency]
// "New comment" = today.lastComment?.created !== yesterday.lastComment?.created (and today has one)
// "Stale" = today.daysSinceUpdate >= 7 AND yesterday.daysSinceUpdate < 7
// Returns array of delta objects:
// { ticketKey, summary, changes: string[] }
// changes entries: 'aging → needs-response', '1 new comment', 'stale threshold crossed (7 days idle)'

export function buildDeltaSection(deltas)
// Returns markdown/plain-text string or '' when deltas empty
// Format:
// '── What got worse since yesterday ──\n'
// '▼ PROJ-123  aging → needs-response  (1 new comment)\n'
// '▼ PROJ-456  stale threshold crossed (7 days idle)\n'
```

#### Step 3 — Modify `fetch-my-tickets.mjs` digest dispatch

In `fetch-my-tickets.mjs`, inside the `if (digestFlag)` block (around line 293), before calling
`deliverer(payload)`:

1. Import `saveTriageSnapshot`, `loadYesterdaySnapshot`, `diffSnapshots`, `buildDeltaSection`
   from `./lib/triage-history.mjs` (dynamic `await import` to match existing ESM pattern)
2. After scoring: `saveTriageSnapshot(sorted, { profile: profileName ?? 'default', configDir })`
3. Load yesterday: `const yesterday = await loadYesterdaySnapshot({ profile: profileName ?? 'default', configDir })`
4. If yesterday exists: `const deltas = diffSnapshots(sorted, yesterday)`
5. Add `delta` to the payload object:

```javascript
await deliverer({
  profile: profileName ?? 'default',
  staleDays,
  summary: { ... },
  tickets: sorted,
  delta: yesterday ? buildDeltaSection(deltas) : null,  // ← ADD THIS
});
```

Wrap steps 2-4 in try/catch — triage history is non-fatal, never block digest delivery.
The `delta` field is passed to the server, which renders it into the email.

### Acceptance criteria

- `node:test` runs `test/triage-history.test.mjs` with 0 failures
- After first triage run: snapshot written to
  `~/.ticketlens/triage-history/YYYY-MM-DD/<profile>.json`
- After second triage run (mocked to simulate next day): POST payload includes `delta` key with worsened tickets
- When no previous snapshot: POST payload has `delta: null`
- Tickets that improved (urgency toward `clear`) are not listed in delta
- I/O failure in history module: digest POST still fires (try/catch guard)

---

## Shared implementation notes

### Injectable deps pattern (reference)

All new modules follow this exact pattern from `compliance-checker.mjs`:

```javascript
export async function doThing({
  configDir = DEFAULT_CONFIG_DIR,
  fsModule  = fs,          // node:fs default
  execFn    = spawnSync,   // node:child_process default
  stream    = process.stderr,
} = {}) { ... }
```

### Test isolation pattern (reference)

From `triage-exporter.test.mjs` — use this for all new tests that write files:

```javascript
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let tmpDir;
before(() => { tmpDir = mkdtempSync(join(tmpdir(), 'ledger-test-')); });
after(() => { rmSync(tmpDir, { recursive: true }); });
```

### Pro gate pattern (reference)

From `compliance-checker.mjs`:

```javascript
const isPro = isLicensedFn('pro', configDir);
if (!isPro) {
  showUpgradeFn('pro', '--feature-name', { stream });
  return null;
}
```

### Running tests

```bash
# Run all tests
node --test skills/jtb/scripts/test/*.test.mjs

# Run a single feature's tests
node --test skills/jtb/scripts/test/ledger.test.mjs

# Run with coverage (Node.js >= 20)
node --test --experimental-test-coverage skills/jtb/scripts/test/ledger.test.mjs
```

Baseline: 582 tests passing. After each feature, run the full suite to confirm no regressions.

---

## Completion checklist

After all six features are implemented:

- [ ] `node --test skills/jtb/scripts/test/*.test.mjs` passes (582 + new tests, 0 failures)
- [ ] `ticketlens ledger` prints signed JSON export
- [ ] `ticketlens PROJ-123 --budget 500` prunes and reports to stderr
- [ ] `ticketlens install-hooks` installs idempotent pre-push hook
- [ ] `ticketlens pr PROJ-123` prints markdown PR body
- [ ] Second fetch of same ticket with changed status shows drift warning
- [ ] Second triage run shows delta section in digest
- [ ] Zero new runtime npm dependencies (`node_modules` unchanged)
- [ ] All new modules: named exports only, no default exports
