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
| Adapter connectivity/auth | `testConnections` (`connection-tester.mjs`) as-is, looped over all configured profiles; errors run through `classifyError` (`error-classifier.mjs`) | No |
| Cache health | `getCacheEntries`/`getCacheSize` (`cache-manager.mjs`) — flags unreadable/corrupt entries | Yes → clear cache dir |
| Recall queue health | `readQueue` (`recall-queue.mjs`) — flags notes stuck past normal retry | Yes → force `flushQueue` |

## Output format

- `--format=plain` (default): human-readable, colorized via `ansi.mjs`'s
  `createStyler`, matching every other command's rendering style.
- `--format=json`: `{ ok: boolean, checks: [{ id, label, ok, message, hint,
  fixable }], fixed: [ids] }` — precedent is `run-stats.mjs`'s existing
  `--format=plain|json` flag.
- The MCP `doctor` tool always requests JSON internally regardless of the
  flag, since an AI harness needs structure, not colorized text.

## `--fix` flow

1. Run all checks.
2. For each failing check where `fixable: true`, announce the repair
   (`Clearing stale cache...`) then apply it: clear cache dir, force license
   revalidation (`revalidateLicense`), or force-flush the Recall queue
   (`flushQueue`).
3. Re-run just that check to confirm it's now green.
4. No interactive confirmation gate — all three actions are non-destructive
   to user data (cache and queue are always rebuildable; revalidation only
   re-checks a key that's already stored).

## Error handling

Every check function catches its own failures internally and returns
`{ ok: false, message, hint }` rather than throwing. `runDoctor` never wraps a
check call in try/catch — a check's own failure to complete *is* itself a
diagnostic result, not an exception to propagate. This mirrors what
`classifyError` already does: turn a raw failure into an actionable message.

## Testing

- `doctor-checks.test.mjs` — one block per check, each tested in isolation
  with mocked DI'd dependencies (e.g. a profile missing a required field →
  not ok; `testConnectionsFn` throwing → classified message present).
- `doctor-command.test.mjs` — arg parsing (`--format`, `--fix`, `--profile`),
  plain vs JSON rendering, and the fix-then-reverify loop, with all check
  functions mocked via DI.
- `bin.test.mjs` — one routing-smoke test confirming the `doctor` subcommand
  reaches `runDoctor`.
- Beyoncé Rule: every row in the check table ships with at least one
  red→green test before merge.

## Tier gating

Free tier, fully unrestricted — including `--fix` and the live connectivity
check. Consistent with the existing "free tier tells you the truth when you
ask" philosophy (Phase B.7) and with `stats`/`triage`'s existing free-tier
transparency pattern. A broken install is exactly the moment a user has zero
patience for an upsell.
