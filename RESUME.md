# Session Resume Guide

> This file is the authoritative resume point for any new Claude Code session continuing TicketLens development.

## Quick Context

- **CLI repo:** `~/Desktop/Projects/ticket-lens/`
- **Backend repo:** `~/Desktop/Projects/ticketlens-api/`
- **Active branch:** `feature/phase2-sprint` in worktree `.worktrees/phase2-sprint`
- **Worktree HEAD:** `b47516c` (docs: fix threat model - HMAC empty-key degradation and regex anchor note)
- **CLI main HEAD:** `e9fc31c` (docs: add memory file references to RESUME.md)
- **Backend main HEAD:** `5c29f15` (fix: replace ticketlens.io with ticketlens.dev)
- **CLI tests:** 534 passing, 0 failures
- **Backend tests:** 39 passing, 0 failures

---

## Sprint State (as of 2026-03-31)

### Phase 1 — Memory Foundation ✅ Complete

### Phase 2 — Sprint Tasks

| # | Task | Status | Commit |
|---|------|--------|--------|
| 1 | Node engines fix (`>=18` → `>=20`) | ✅ Done | `3537061` |
| 2 | Backend CI pipeline (PHP 8.3/8.4, SQLite) | ✅ Done | `a0761a4` (backend `main`) |
| 3 | Atlassian MCP competitive positioning | ✅ Done | `eda37f2` |
| — | Domain rename `.io` → `.dev` | ✅ Done | `42b253f` (CLI main), `8f38cd9` (worktree), `5c29f15` (backend) |
| 4 | Code audit report | ✅ Done | `6017a56` |
| 5 | Mintlify docs alignment audit | ✅ Done | `e6f58d9` → `b47516c` (fixes) |
| 6 | Compliance check security threat model | ✅ Done | `50e671e` → `b47516c` (fixes) |

### Phase 3 — Compliance Check ❌ Not started

All 8 tasks pending. Blocked by Task 6 (security threat model informs the design).

---

## How to Resume

### Step 1 — Orient in the worktree

```bash
cd ~/Desktop/Projects/ticket-lens/.worktrees/phase2-sprint
git log --oneline -3
node --test skills/jtb/scripts/test/*.test.mjs 2>&1 | tail -5
```

Expected top commit: `8f38cd9 fix: replace api.ticketlens.io with api.ticketlens.dev`
Expected tests: 534 passing, 0 failures.

If the worktree directory is missing, recreate it:

```bash
cd ~/Desktop/Projects/ticket-lens
git worktree add .worktrees/phase2-sprint feature/phase2-sprint
```

### Step 2 — Start Phase 3

Phase 2 is complete. Say: **"Start Phase 3 from the plan at `docs/superpowers/plans/2026-03-30-phase3-compliance-check.md`"**

### Step 3 — Phase 3 (after approval)

Plan file: `docs/superpowers/plans/2026-03-30-phase3-compliance-check.md`

8 tasks:
1. `lib/requirement-extractor.mjs` (TDD, 10+ tests)
2. `lib/usage-tracker.mjs` (TDD, 7+ tests, FREE_LIMIT=3)
3. `lib/commit-linker.mjs` (TDD, 7+ tests)
4. `lib/diff-analyzer.mjs` (TDD, 8+ tests)
5. `lib/compliance-checker.mjs` orchestrator (TDD, 8+ tests)
6. CLI `--compliance` flag (fetch-ticket.mjs + help.mjs)
7. Backend `POST /v1/compliance` endpoint
8. Final verification (≥564 CLI tests, ≥44 backend tests) + SKILL.md update

---

## Key Audit Findings to Be Aware Of (from `docs/audits/2026-03-30-code-audit.md`)

**P1 — DRY violation:** `jiraEnv()` duplicated in `fetch-ticket.mjs` and `fetch-my-tickets.mjs` — both functions exist in `lib/config.mjs` but local copies override them. Phase 3 implementer should use the `lib/config.mjs` version.

**P1 — Docs drift:** `--no-cache` and `--schedule`/`--digest` are missing from `help.mjs` USAGE section. Note for Task 5 (Mintlify audit) and when updating help in Phase 3.

**P2 — Cache staleness bug:** `saveCloudConsent()` in `fetch-ticket.mjs` writes `profiles.json` directly via `fs.writeFile`, bypassing `saveProfile()` and leaving `_profilesCache` stale. Fix in a future cleanup sprint (not Phase 3 scope).

---

## Session Memory Files

Detailed project state is persisted in Claude's memory system and auto-loaded at session start:

- `~/.claude/projects/-Users-admin-Desktop-personal-solopreneur/memory/project_state.md` — verified feature map, sprint progress table, all pending items
- `~/.claude/projects/-Users-admin-Desktop-personal-solopreneur/memory/project_competitive.md` — Atlassian MCP analysis, positioning statement
- `~/.claude/projects/-Users-admin-Desktop-personal-solopreneur/memory/MEMORY.md` — index of all memory files (auto-loaded)

---

## Implementation Plan Files

| Plan | File | Status |
|------|------|--------|
| Phase 1 | `docs/superpowers/plans/2026-03-30-phase1-memory-foundation.md` | ✅ Complete |
| Phase 2 | `docs/superpowers/plans/2026-03-30-phase2-sprint.md` | Tasks 5-6 pending |
| Phase 3 | `docs/superpowers/plans/2026-03-30-phase3-compliance-check.md` | All pending |

---

## Domain

All code uses `ticketlens.dev`. Do not introduce `ticketlens.io` anywhere. Env files (`.env`, `.env.example`) are intentionally left untouched.
