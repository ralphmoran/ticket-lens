---
phase: b7-safety-net
plan: b7
subsystem: cli
tags: [compliance, ledger, drift, git-hooks, pr-assembler, token-budget, triage-history, pro-tier]

requires: []
provides:
  - Compliance Ledger: append-only JSONL audit trail with HMAC-signed export
  - Token Budget Optimizer: --budget=N flag prunes brief to fit token window
  - Git Hook Compliance Gate: ticketlens install-hooks writes pre-push compliance check
  - Ticket-to-PR Assembler: ticketlens pr TICKET-KEY generates markdown PR description
  - Spec Drift Detection: per-branch snapshot comparison warns on acceptance criteria changes
  - Stale Delta Report: triage digest payload enriched with delta of worsened tickets
affects: [console, b7-validation-gate]

tech-stack:
  added: []
  patterns:
    - "Injectable deps pattern: all new modules accept fsModule, configDir, execFn for testability"
    - "Pro gate pattern: isLicensedFn check with showUpgradeFn fallback"
    - "Non-fatal try/catch wrapper for all drift/history I/O operations"

key-files:
  created:
    - skills/jtb/scripts/lib/ledger.mjs
    - skills/jtb/scripts/lib/budget-pruner.mjs
    - skills/jtb/scripts/lib/hook-installer.mjs
    - skills/jtb/scripts/lib/pr-assembler.mjs
    - skills/jtb/scripts/lib/drift-tracker.mjs
    - skills/jtb/scripts/lib/triage-history.mjs
    - skills/jtb/scripts/test/ledger.test.mjs
    - skills/jtb/scripts/test/budget-pruner.test.mjs
    - skills/jtb/scripts/test/hook-installer.test.mjs
    - skills/jtb/scripts/test/pr-assembler.test.mjs
    - skills/jtb/scripts/test/drift-tracker.test.mjs
    - skills/jtb/scripts/test/triage-history.test.mjs
  modified:
    - skills/jtb/scripts/lib/compliance-checker.mjs
    - skills/jtb/scripts/lib/cli.mjs
    - skills/jtb/scripts/fetch-ticket.mjs
    - skills/jtb/scripts/fetch-my-tickets.mjs

key-decisions:
  - "Pruning operates on plain text before styleBrief() to avoid ANSI escape inflation of token estimates"
  - "Hook idempotency via guard string '# ticketlens-compliance-gate' — appended once, never duplicated"
  - "Drift check is non-fatal: I/O errors silently skipped, never blocks brief output"
  - "Triage delta passed as payload key to server — no local email assembly"
  - "Shell injection guard added to hook script: branch name sanitized before embedding in sh"

patterns-established:
  - "Budget pruning: plain-text first, then style — prevents token count inflation"
  - "Snapshot sanitization: reject profile/key strings containing / \\ or .. before path join"

requirements-completed: []

duration: multi-session
completed: 2026-04-15
---

# Phase B.7: Safety Net Summary

**Six Pro-tier CLI safety features — ledger, budget pruner, git hook gate, PR assembler, spec drift detector, and stale delta report — all zero new runtime deps, 84 new tests**

## Performance

- **Duration:** multi-session
- **Completed:** 2026-04-15
- **Tasks:** 6 features × (RED → GREEN → wire) = 18+ atomic commits
- **Files modified:** 16 (6 new lib modules, 6 new test files, 4 existing file modifications)

## Accomplishments

- **B7-5 Compliance Ledger** — `appendLedger()` writes JSONL to `~/.ticketlens/ledger.jsonl` after every Pro compliance check; `ticketlens ledger [--format=csv|json] [--since=DATE]` exports with HMAC-SHA256 signature. 11 tests.
- **B7-4 Token Budget Optimizer** — `ticketlens TICKET-KEY --budget=N` prunes old comments → attachments → description → linked bodies in priority order, reports drops to stderr. Operates on plain text pre-ANSI. Pro gate. 12 tests.
- **B7-2 Git Hook Compliance Gate** — `ticketlens install-hooks` writes idempotent `pre-push` hook extracting ticket key from branch name, blocking push when coverage < threshold. Windows skip, guard string prevents duplication. 11 tests.
- **B7-3 Ticket-to-PR Assembler** — `ticketlens pr TICKET-KEY` outputs requirements coverage, linked commits, acceptance criteria, and `Closes KEY` footer for GitHub/GitLab remotes. 13 tests.
- **B7-1 Spec Drift Detection** — per-branch JSON snapshots in `~/.ticketlens/drift/`; detects status, description hash, and requirements changes; emits ANSI amber warning to stderr before brief. Path-traversal-safe. 17 tests.
- **B7-6 Stale Delta Report** — triage digest payload now includes `delta` key built from day-over-day snapshot diff; detects urgency regression, new comments, staleness threshold crossings. 20 tests.

## Test Suite

| Feature | Tests | Status |
|---------|-------|--------|
| B7-5 Compliance Ledger | 11 | ✓ pass |
| B7-4 Token Budget Optimizer | 12 | ✓ pass |
| B7-2 Git Hook Gate | 11 | ✓ pass |
| B7-3 PR Assembler | 13 | ✓ pass |
| B7-1 Spec Drift | 17 | ✓ pass |
| B7-6 Stale Delta | 20 | ✓ pass |
| **B7 total** | **84** | **✓ pass** |
| **Full suite** | **666** | **✓ pass** |

Baseline was 582. +84 new tests, 0 failures, 0 regressions.

## Task Commits

1. **B7-5 Compliance Ledger** — `1270c70` feat(b7-5)
2. **B7-4 Budget Pruner RED** — `751dfb6` test(b7-4)
3. **B7-4 Budget Pruner GREEN** — `2c54896` feat(b7-4)
4. **B7-4 --budget flag wiring** — `cd46b7b` feat(b7-4)
5. **B7-2 Git Hook Gate** — `e7b41f9` feat(b7-2)
6. **B7-3 PR Assembler** — `aedb39e` feat(b7-3)
7. **B7-1 Spec Drift Detection** — `8f90d8a` feat(b7-1)
8. **B7-6 Stale Delta Report** — `e8633cf` feat(b7-6)
9. **Security fix** — `d4981c6` fix(b7): shell injection guard in hook-installer, injectable cwd in pr-assembler

## Decisions Made

- Pruning operates on plain text before `styleBrief()` — ANSI escapes inflate token estimates by ~10–30%
- Hook idempotency via guard comment string — append-only, safe to call twice
- Drift check non-fatal — wraps all I/O in try/catch, never blocks brief output
- Delta sent as payload key to server — no local email body assembly (server renders it)
- Shell injection guard: branch name extracted by grep, never interpolated raw into sh

## Deviations from Plan

None — all six features implemented exactly as specified. Security hardening (shell injection guard, injectable `cwd` in pr-assembler) was an unplanned auto-fix committed alongside B7-2/B7-3.

## Issues Encountered

- Shell injection risk in generated hook script (branch name interpolated raw) — caught during review, fixed in `d4981c6`

## User Setup Required

None — all features work locally with existing `~/.ticketlens/` config. No new env vars or external services.

## Next Phase Readiness

- All Pro safety net features shipped: spec drift, hook gate, PR assembler, token budget, ledger, stale delta
- Zero new runtime npm deps — constraint maintained
- Full suite green at 666 tests
- Ready for VALIDATION GATE: 50+ paying Pro users? 10+ teams? → determines whether Phase C (Console) proceeds

---
*Phase: b7-safety-net*
*Completed: 2026-04-15*
