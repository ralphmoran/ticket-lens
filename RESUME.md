# Session Resume Guide

> This file is the authoritative resume point for any new Claude Code session continuing TicketLens development.

## Quick Context

- **CLI repo:** `~/Desktop/Projects/ticket-lens/`
- **Backend repo:** `~/Desktop/Projects/ticketlens-api/`
- **Active branch:** `feature/phase2-sprint` in worktree `.worktrees/phase2-sprint`
- **Worktree HEAD:** `36fb265` (fix: clarify remaining-count intent, add Pro footer coverage test)
- **CLI main HEAD:** `225a71e` (docs: mark Phase 2 complete in RESUME.md)
- **Backend main HEAD:** `5c29f15` (fix: replace ticketlens.io with ticketlens.dev)
- **CLI tests:** 576 passing, 0 failures
- **Backend tests:** 39 passing, 0 failures

---

## Sprint State (as of 2026-04-01)

### Phase 1 — Memory Foundation ✅ Complete

### Phase 2 — Sprint Tasks ✅ Complete

| # | Task | Status | Commit |
|---|------|--------|--------|
| 1 | Node engines fix (`>=18` → `>=20`) | ✅ Done | `3537061` |
| 2 | Backend CI pipeline (PHP 8.3/8.4, SQLite) | ✅ Done | `a0761a4` (backend `main`) |
| 3 | Atlassian MCP competitive positioning | ✅ Done | `eda37f2` |
| — | Domain rename `.io` → `.dev` | ✅ Done | `42b253f` (CLI main), `8f38cd9` (worktree), `5c29f15` (backend) |
| 4 | Code audit report | ✅ Done | `6017a56` |
| 5 | Mintlify docs alignment audit | ✅ Done | `e6f58d9` → `b47516c` (fixes) |
| 6 | Compliance check security threat model | ✅ Done | `50e671e` → `b47516c` (fixes) |

### Phase 3 — Compliance Check 🔄 In Progress

All work is on branch `feature/phase2-sprint` in worktree `.worktrees/phase2-sprint`.

| # | Task | Status | Commit | Tests added |
|---|------|--------|--------|-------------|
| 1 | `lib/requirement-extractor.mjs` | ✅ Done | `b495a0f` | +10 → 544 |
| 2 | `lib/usage-tracker.mjs` | ✅ Done | `719be29` → `73f3d99` | +8 → 552 |
| 3 | `lib/commit-linker.mjs` | ✅ Done | `6c17add` | +7 → 559 |
| 4 | `lib/diff-analyzer.mjs` | ✅ Done | `3c706ec` | +8 → 567 |
| 5 | `lib/compliance-checker.mjs` orchestrator | ✅ Done | `68a812d` → `36fb265` | +9 → 576 |
| 6 | CLI `--compliance` flag | ❌ **NEXT TASK** | — | — |
| 7 | Backend `POST /v1/compliance` endpoint | ❌ Pending | — | — |
| 8 | Final verification + SKILL.md | ❌ Pending | — | — |

---

## How to Resume

### Step 1 — Orient in the worktree

```bash
cd ~/Desktop/Projects/ticket-lens/.worktrees/phase2-sprint
git log --oneline -3
node --test skills/jtb/scripts/test/*.test.mjs 2>&1 | tail -5
```

Expected top commit: `36fb265 fix: clarify remaining-count intent, add Pro footer coverage test`
Expected tests: 576 passing, 0 failures.

If the worktree directory is missing, recreate it:

```bash
cd ~/Desktop/Projects/ticket-lens
git worktree add .worktrees/phase2-sprint feature/phase2-sprint
```

### Step 2 — Continue Phase 3

Say: **"Continue Phase 3 starting at Task 6 from the plan at `docs/superpowers/plans/2026-03-30-phase3-compliance-check.md`"**

The skill will:
1. Dispatch subagent for Task 6 (`--compliance` flag in `fetch-ticket.mjs` + `help.mjs`)
2. Run two-stage review (spec compliance → code quality)
3. Dispatch Task 7 (backend `POST /v1/compliance`)
4. Run two-stage review
5. Dispatch Task 8 (final verification + SKILL.md)

### Phase 3 remaining tasks (6–8)

**Task 6: CLI `--compliance` flag**
- Modify: `skills/jtb/scripts/fetch-ticket.mjs` — add import + `--compliance` block after `--summarize`
- Modify: `skills/jtb/scripts/lib/help.mjs` — add `--compliance` line after `--check` in `printHelp()` and `printFetchHelp()`
- Commit: `"feat: --compliance flag — check ticket requirements against local git diff"`
- Full suite must still pass (≥576), fail 0

**Task 7: Backend `POST /v1/compliance`**
- Repo: `~/Desktop/Projects/ticketlens-api/`
- Create: `app/Http/Controllers/Api/ComplianceController.php`
- Create: `app/Http/Requests/ComplianceRequest.php`
- Modify: `routes/api.php` — register route with `auth.license` + `throttle:summarize` middleware
- Create: `tests/Feature/ComplianceControllerTest.php` (5+ tests)
- Read existing `tests/Feature/SummarizeControllerTest.php` for auth pattern
- Commit: `"feat: POST /v1/compliance endpoint — server-side compliance check"`
- Backend suite must pass (≥44), fail 0

**Task 8: Final verification + SKILL.md**
- CLI: `npm test` → ≥564 pass (actual: expect ~576), fail 0
- Backend: `php artisan test` → ≥44 pass, fail 0
- Smoke test: `node bin/ticketlens.mjs --help | grep compliance`
- Update `skills/jtb/SKILL.md` — add `--compliance` flag docs
- Commit: `"docs: document --compliance flag in SKILL.md"`

---

## Key Audit Findings to Be Aware Of (from `docs/audits/2026-03-30-code-audit.md`)

**P1 — DRY violation:** `jiraEnv()` duplicated in `fetch-ticket.mjs` and `fetch-my-tickets.mjs` — both functions exist in `lib/config.mjs` but local copies override them. Phase 3 implementer should use the `lib/config.mjs` version.

**P1 — Docs drift:** `--no-cache` and `--schedule`/`--digest` are missing from `help.mjs` USAGE section. Note when updating help in Phase 3.

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
| Phase 2 | `docs/superpowers/plans/2026-03-30-phase2-sprint.md` | ✅ Complete |
| Phase 3 | `docs/superpowers/plans/2026-03-30-phase3-compliance-check.md` | Tasks 6–8 pending |

---

## Domain

All code uses `ticketlens.dev`. Do not introduce `ticketlens.io` anywhere. Env files (`.env`, `.env.example`) are intentionally left untouched.
