# `ticketlens doctor` — Design Spec

**Date:** 2026-08-04
**ROADMAP item:** 49c, Iteration 11 — Platform Features
**Status:** Approved, ready for planning

## Problem

When TicketLens or the MCP server errors out, the user (or an AI harness calling
the MCP tools) is left interpreting a raw stack trace or a bare non-zero exit.
There is no single command that answers "why is this broken" across the four
places a TicketLens install actually fails: profile config, license/token
state, tracker connectivity, and local queue/cache state.

## Goals

- One command, `ticketlens doctor`, that runs a fixed set of checks and reports
  each as pass/fail with a human-readable hint.
- Same diagnostic logic exposed as an MCP tool so an AI harness gets a
  structured report instead of an opaque tool-call failure.
- Optional `--fix` to repair the subset of failures that have a safe,
  non-destructive remedy.
- Free tier, fully unrestricted — troubleshooting is not something to paywall.

## Non-goals (v1)

- MCP server startup/handshake health (spawning `ticketlens mcp` as a child
  process and speaking JSON-RPC to it). Deferred — distinct, self-contained
  problem, not what motivated this request (M-12 grace-period confusion,
  profile misroutes). Tracked in memory backlog, not ROADMAP, per explicit
  request during brainstorming.
- MCP registration check (is `ticketlens` wired into the current project's
  `.mcp.json`). Deferred alongside the handshake check during the spec's
  10-round self-review — circular value (only reachable via the CLI path,
  not the MCP path it's diagnosing) and couples doctor to Claude Code's own
  config format rather than a TicketLens-owned schema. Same memory backlog
  file as the handshake check.
- Auto-fix beyond the three actions listed below (no re-running `activate`
  with a key, no editing profile config — those already have dedicated
  commands).
- Any audit-log entry for `--fix` actions — these mutate local troubleshooting
  state (cache, queue, license cache), not a live tracker, so they don't fit
  `ticket-action-log.mjs`'s existing scope.

## Architecture

Two new modules, following the `note-command.mjs` / `recall-command.mjs`
convention:

- **`skills/jtb/scripts/lib/doctor-checks.mjs`** — pure check functions, each
  accepting DI'd dependencies (matching the `xFn = defaultX` pattern used by
  `runNoteAdd` and siblings) and returning a normalized result:
  ```
  { id, label, ok, message, hint, fixable }
  ```
  No stdout/stdin, no arg parsing. Independently unit-testable in isolation
  from CLI concerns (DAMP).

  **`testConnections()` reuse detail:** `connection-tester.mjs`'s
  `testConnections()` is not a pure function — it writes its own
  spinner/session framing directly to `stream` as a side effect (the same
  UX `onboarding.mjs` relies on), before returning `{ results, failedCount
  }`. To keep this module's "no stdout" boundary intact, the connectivity
  check calls `testConnections({ stream: <no-op writable> })` and consumes
  only the returned data, discarding the internal side effect rather than
  modifying `connection-tester.mjs` itself. Zero regression risk to
  onboarding's own use of it.

- **`skills/jtb/scripts/lib/doctor-command.mjs`** — exports
  `runDoctor(args, opts)` with the same `{ configDir, stream = process.stderr,
  ...Fn overrides }` shape as `runStats`/`runNoteAdd`. Parses `--format=`,
  `--fix`, `--profile=`; runs the checks from `doctor-checks.mjs`; applies
  fixes when `--fix` is set; renders plain or JSON output to `stream`.

- **`skills/jtb/scripts/lib/mcp-server.mjs`** — gains a `doctor` tool entry
  that wraps `runDoctor` with a buffered stream, exactly like the existing 9
  tools wrap their `run*` functions. Zero new logic in the MCP layer.

## Checks (v1)

All live by default (no `--local-only` escape hatch in v1 — if this turns out
to be too slow/noisy in practice, add one later rather than pre-building it).

| Check | Reuses | Fixable |
|---|---|---|
| Profile config validity | `loadProfiles`/`loadCredentials` (`profile-resolver.mjs`) — active profile resolves, required fields present | No |
| License/token freshness | `checkLicense` (`license.mjs`) — surfaces the same grace-period logic M-12 fixed | Yes → force revalidation |
| Adapter connectivity/auth | `testConnections` (`connection-tester.mjs`, stream discarded — see above), looped over all configured profiles by default; errors run through `classifyError` (`error-classifier.mjs`) | No |
| Cache health | `getCacheEntries`/`getCacheSize` (`cache-manager.mjs`) — flags unreadable/corrupt entries | Yes → clear only the affected profile's cache entries |
| Recall queue health | `readQueue` (`recall-queue.mjs`) — flags notes stuck past normal retry | Yes → force `flushQueue`, skipped if that profile's connectivity check is also failing |

**`--profile=NAME` semantics:** scopes every check to one profile. For
connectivity specifically, this bypasses `testConnections()`'s all-profiles
sequential loop entirely — instead calling `resolveAdapter` +
`classifyError` directly for just that one profile, a single round-trip.
This exists because `testConnections()` has no single-profile filter and
loops sequentially with a 10s-per-profile timeout (confirmed default in
`jira-client.mjs`); a user with several profiles all timing out would
otherwise wait 50s+ for the default full sweep. The full sweep (no
`--profile` filter) still reuses `testConnections()` unmodified, matching
onboarding's existing UX — `--profile=` is the fast path for the far more
common "diagnose the one connection I'm having trouble with" case, not a
replacement for it.

**Cache-clear scope:** never `rm -rf` the whole cache directory. Uses
`filterEntriesByProfile` (already used by `cache size --profile=`) to
resolve the specific file paths belonging to the profile whose check
failed, and deletes only those. A corrupt entry under one profile must
never cost another profile its warm cache.

## Output format

- `--format=plain` (default): human-readable, colorized via `ansi.mjs`'s
  `createStyler`, matching every other command's rendering style.
- `--format=json`: `{ schemaVersion: 1, ok: boolean, checks: [{ id, label,
  ok, message, hint, fixable }], fixed: [ids], skipped: [{ id, reason }] }`
  — precedent for the flag itself is `run-stats.mjs`'s existing
  `--format=plain|json`. `schemaVersion` is included because this is the
  first TicketLens command built specifically for structured machine
  consumption (MCP/scripts) rather than as a secondary output mode — future
  checks (e.g. the deferred MCP-registration/handshake checks) will change
  `checks[]` contents, and a consumer needs a signal that the shape can
  change rather than discovering it via a silent parse break.
- The MCP `doctor` tool always requests JSON internally regardless of the
  flag, since an AI harness needs structure, not colorized text.

## Exit codes

`ticketlens doctor` sets `process.exitCode = 0` when every check is `ok`
(after `--fix` has run, if given) and `1` otherwise — the standard binary
Unix convention, not a per-failure-category code (rejected as speculative;
no consumer need for finer granularity yet). This is what makes `if !
ticketlens doctor; then ...` work in scripts/CI/cron, consistent with the
"scriptable" brand pillar — the original spec omitted this entirely.

## `--fix` flow

1. Run all checks.
2. For each failing check where `fixable: true`, in this order — license
   revalidation, cache clear, queue flush — announce the repair
   (`Clearing stale cache...`) then apply it: clear only the affected
   profile's cache entries, force license revalidation
   (`revalidateLicense`), or force-flush the Recall queue (`flushQueue`).
   **Queue flush is skipped (not attempted) if that profile's connectivity
   check is also currently failing** — flushing requires a working
   connection to the Console backend, so attempting it first would produce
   a misleading "fix attempted but still red" result instead of the
   accurate "blocked on connectivity" one. Skipped fixes are reported
   separately from failed ones (see `skipped` in the JSON shape above).
3. Re-run each attempted fix's check to confirm it's now green.
4. No interactive confirmation gate — all three actions are non-destructive
   to user data (cache and queue are always rebuildable; revalidation only
   re-checks a key that's already stored). No cooldown on forced
   revalidation either — LemonSqueezy's `/validate` endpoint is confirmed
   separate from `/activate` (doesn't consume an activation seat), and a
   stuck retry loop calling `doctor --fix` repeatedly is a harness-level
   concern, not one `--fix` needs to defend against by adding a wait state.

## Error handling

Every check function catches its own failures internally and returns
`{ ok: false, message, hint }` rather than throwing. `runDoctor` never wraps a
check call in try/catch — a check's own failure to complete *is* itself a
diagnostic result, not an exception to propagate. This mirrors what
`classifyError` already does: turn a raw failure into an actionable message.

## Security note

Audited every check's error path for credential leakage into `message`,
since doctor's JSON output is consumed by an AI harness (MCP) — a
higher-exposure surface than a human-only terminal. `buildAuthHeader()`
(both Jira and GitHub adapters) puts credentials only in the `Authorization`
header, never in the URL; `guardedFetch`'s constructed errors reference only
hostname/status; `classifyError`'s generic fallback
(`{ message: err.message }`) only fires on network-level failures where
`err.message` is Node's own error text, not response/request content.
**Confirmed safe — no redaction layer needed for v1.**

## Testing

- `doctor-checks.test.mjs` — one block per check, each tested in isolation
  with mocked DI'd dependencies (e.g. a profile missing a required field →
  not ok; `testConnectionsFn` throwing → classified message present; the
  `--profile=` single-profile bypass path tested separately from the
  full-sweep path).
- `doctor-command.test.mjs` — arg parsing (`--format`, `--fix`, `--profile`),
  plain vs JSON rendering (including `schemaVersion` presence and the
  `skipped` array), the fix-then-reverify loop, fix ordering
  (license → cache → queue), the queue-flush-skipped-when-connectivity-down
  case, exit code 0/1 in both the checks-only and post-`--fix` paths, and
  cache-clear scoped to only the affected profile's entries — with all
  check and fix functions mocked via DI.
- `bin.test.mjs` — one routing-smoke test confirming the `doctor` subcommand
  reaches `runDoctor`.
- Beyoncé Rule: every row in the check table, plus every behavior above,
  ships with at least one red→green test before merge.

## Tier gating

Free tier, fully unrestricted — including `--fix` and the live connectivity
check. Consistent with the existing "free tier tells you the truth when you
ask" philosophy (Phase B.7) and with `stats`/`triage`'s existing free-tier
transparency pattern. A broken install is exactly the moment a user has zero
patience for an upsell.
