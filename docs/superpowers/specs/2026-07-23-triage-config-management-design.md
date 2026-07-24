# Triage Config Management — Design Spec
**Date:** 2026-07-23
**Status:** Approved
**Repos:** `ticket-lens` (CLI) + `ticketlens-api` (backend + Console)

---

## 1. Overview

Three small, related gaps surfaced during Local Live Test of the `actionable-only-push-gap` fix (v0.20.2):

1. Triage has no way to sort by ticket **priority** — only the fixed `needs-response → aging → stale → clear` urgency order. Each user wants their own preference, not a team policy.
2. The custom-rule `notify` action's Slack cooldown is hardcoded (`COOLDOWN_HOURS = 4` in `EvaluateCustomNotifyRulesJob.php`) — a team manager cannot adjust it.
3. Two existing, already-shipped manager controls (stale-days on `/console/admin/rules`, triage-status filter on `/console/admin/jira`) are hard to discover — they live on separate pages with no cross-links.

This spec covers all three; they share enough surface (the Rules page, the sync/config patterns already established by the stale rule and team Jira config) that bundling into one plan avoids re-touching the same files three times.

**Explicitly NOT in scope:** changing which statuses count as triage-worthy (already solved, `TeamJiraConfig.triage_statuses`), changing stale-days (already solved, `WorkflowRule` type=`stale`), any built-in alert-type cooldown (already solved, `AlertSetting`), merging the Rules and Jira pages into one.

---

## 2. Sort order — personal preference (CLI + Console, no sync)

Each user sets their own; nothing propagates between the two surfaces or across a team. No new sync mechanism.

### 2.1 CLI (`ticket-lens`)

- New optional field `sortBy: 'urgency' | 'priority'` in a profile's entry in `~/.ticketlens/profiles.json`. Absent → defaults to `'urgency'` (current behavior, zero change for existing users). Same precedent as the existing hand-edited `attentionRules`/`staleRule` fields — no dedicated CLI "config setter" command exists for those either, and none is added here.
- New `--sort=priority|urgency` flag on `triage`, a one-off override for the current run — same override relationship `--stale=N` already has against the profile's `staleDays` default.
- `attention-scorer.mjs::sortByUrgency(scores, { sortBy })`: when `sortBy === 'priority'`, rank by a priority-order map (`Highest` → `High` → `Medium` → `Low` → `Lowest` → unknown/no-priority last) first, current urgency ordering as the tiebreaker within same priority. When unset/`'urgency'`, behavior is byte-for-byte identical to today — this is a pure additive branch, not a rewrite of the existing comparator.
- Priority-order map: fixed, case-insensitive, matches the same `Highest|Urgent|Blocker` / `High` grouping already used by `priorityColor()` in `styled-assembler.mjs` (v0.20.2) — reuse that classification, don't invent a second one.

### 2.2 Console (`ticketlens-api`)

- New column `users.triage_sort_preference` (string, default `'urgency'`) — same lightweight pattern as the existing `tier`/`permissions` columns added directly to `users` (no new preferences table for a single field; add one if a second per-user preference shows up later).
- Exposed via the existing `AccountController` (already self-service, every-tier-accessible — not the manager-gated `RulesController`). New field on `Console/Account.vue`, a two-option select mirroring the CLI's two values.
- Governs sort order of `/console/queue`'s ticket table for the viewing user only. Implementation detail for the plan: confirm whether that page's current sort is server-side (controller) or client-side (Vue) before choosing where to apply the preference — read the current queue page/controller in Step 1c, don't assume.

---

## 3. Notify cooldown — team-wide (manager-configured)

- Extend the `custom`-type `WorkflowRule.config` JSON with a new top-level key `cooldown_hours` (integer, default `4` — matches today's hardcoded constant), sitting alongside the existing `rules` array.
- `RulesController::saveCustom()`: add `'cooldown_hours' => ['sometimes', 'integer', 'min:1', 'max:168']` (1 hour to 1 week) to the existing validator.
- `EvaluateCustomNotifyRulesJob::handle()`: replace `self::COOLDOWN_HOURS` with `$customRule->config['cooldown_hours'] ?? 4`.
- Console: extend the existing "Custom Attention Rules" card on `Rules.vue` — not a new card, this is a property of that same rule set — with one numeric input, e.g. "Don't resend the same alert for **N** hours."
- Scope boundary: only the `notify` action. `schedule` has no cooldown today (weekly digest, recomputed fresh each send) and doesn't need one. `EvaluateAlertsJob`'s four built-in alert-type cooldowns (`AlertSetting`) are untouched — already independently configurable.

---

## 4. Discoverability — cross-links, no page merge

- `/console/admin/rules`: small banner near the top — *"Which statuses count as triage-worthy is managed on your team's Jira connection page →"* linking to `/console/admin/jira`.
- `/console/admin/jira`: mirrored banner — *"Manage staleness, custom alert rules, and notify cooldowns →"* linking to `/console/admin/rules`.
- Confirm `ConsoleLayout.vue`'s sidebar already lists both "Rules" and "Jira" as separate top-level entries (same treatment C0-12 gave "Connections"); add whichever is missing.
- No page restructuring — both pages stay as they are, just cross-linked.

---

## 5. Testing considerations (for the plan, not exhaustive here)

- CLI: `sortByUrgency` — priority-order + urgency-tiebreaker cases, unset `sortBy` produces byte-identical output to pre-change (regression lock), `--sort=` flag overrides profile default, malformed/unknown priority values sort last without throwing.
- Backend: `saveCustom` accepts/validates `cooldown_hours` bounds (1/168 edges, rejects 0 and 169), `EvaluateCustomNotifyRulesJob` honors a non-default cooldown (test with e.g. 1h and 24h, not just the old hardcoded 4h), defaults to 4 when the field is absent (backward compat with existing `WorkflowRule` rows that predate this field).
- Console: `users.triage_sort_preference` migration is nullable-safe / default-safe for existing rows; `AccountController` update path validates the enum (`in:urgency,priority`).
- Regression: existing stale-rule and custom-rule (force-urgent/ignore/notify/schedule) tests must be unaffected — this spec only adds a new key alongside `rules`, never changes their shape.

---

## 6. Out of scope / explicitly deferred

- Any team-wide enforcement of sort order (rejected during scoping — user wants personal, not manager-dictated).
- A CLI `config` command for setting profile fields generally (would solve this more elegantly but is a much larger surface — hand-editing `profiles.json` matches existing precedent for `attentionRules`/`staleRule`).
- Merging Rules and Jira pages.
- Any change to which statuses/stale-days are configurable (already shipped).
