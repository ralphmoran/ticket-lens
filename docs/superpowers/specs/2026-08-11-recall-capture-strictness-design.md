# Configurable Recall Capture Strictness — Design Spec
**Date:** 2026-08-11
**Status:** Approved
**Repo:** `ticket-lens` (CLI only — no backend/Console changes)
**Backlog:** #5, ROADMAP 49d

---

## 1. Overview

Right now the jtb skill's Recall-capture judgment is fixed at one calibration. Two things drive it:

1. **In-session judgment** — Claude decides whether an insight is "worth saving," guided by the fixed three-part rule in `skills/jtb/SKILL.md`'s "When to capture a note" section (not already written down, generalizes beyond this diff, cost real effort to discover).
2. **End-of-session enforcement** — the Stop hook (`skills/jtb/hooks/recall-nudge-stop.mjs`) blocks (exit 2) at most once per session when ticket work happened and nothing was captured.

Neither has a dial. This spec adds one: a per-profile `recallStrictness` setting (`loose | balanced | strict`, default `balanced`) that reweights both.

**Not in scope:** `note add`'s existing structural/secret-scan checks (`note-add.mjs`/`recall-vault.mjs`) — those are correctness gates, unrelated to this relevance dial. No Console/backend surface — this is a local, per-profile CLI setting only (see §3 for why).

---

## 2. Shared enum — single source of truth

New exports (exact file TBD at plan time — likely `profile-resolver.mjs`, alongside the setter in §3):

```js
export const RECALL_STRICTNESS_LEVELS = ['loose', 'balanced', 'strict'];
export const DEFAULT_RECALL_STRICTNESS = 'balanced';
export function normalizeRecallStrictness(value) {
  return RECALL_STRICTNESS_LEVELS.includes(value) ? value : DEFAULT_RECALL_STRICTNESS;
}
```

Reused by the CLI setter (§3), `resolveConnection()` (§4), and the Stop hook (§5) — one place validates/defaults, no duplicated logic. Mirrors the existing shared-constant pattern in `recall-settings-sync.mjs` (`DEFAULT_RECALL_SETTINGS`/`RECALL_SETTINGS_BOUNDS`).

---

## 3. Storage — per-profile, local only

`~/.ticketlens/profiles.json` → `profiles.<name>.recallStrictness`. Absent key = `'balanced'`, i.e. **byte-for-byte today's behavior** for every existing profile with zero migration.

**Why local instead of Console-managed (like Recall queue settings):** the Stop hook fires on every single session end and must stay fast and network-free — unlike `recall-settings-sync.mjs`'s fetch, which only runs on rare paths (queue non-empty, a push just failed, explicit `recall settings`). A live-fetch-with-cache-fallback layer on that hot path is a real cost, plus this would need a full new backend model + endpoint + Console UI. Team-wide enforcement is a legitimate future ask but not in this spec — YAGNI until there's a concrete need for a manager-enforced floor.

New setter in `profile-resolver.mjs`, mirroring the existing `saveProfileRecallTeamId` merge pattern (never clobbers the rest of the profile):

```js
export function saveProfileRecallStrictness(name, level, configDir = DEFAULT_CONFIG_DIR) {
  const config = loadProfiles(configDir) || { profiles: {} };
  if (!config.profiles[name]) throw new Error(`Unknown profile "${name}"`);
  config.profiles[name] = { ...config.profiles[name], recallStrictness: normalizeRecallStrictness(level) };
  writeFileSync(join(configDir, 'profiles.json'), JSON.stringify(config, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  invalidateProfilesCache(configDir);
}
```

**CLI command:** `ticketlens config set recallStrictness <loose|balanced|strict> [--profile=NAME]` — new special case in `bin/ticketlens.mjs`'s `config` handler, parallel to the existing `config set aiProvider` case (which is global/credentials.json-backed; this one is per-profile/profiles.json-backed, so it needs `--profile=`). No `--profile=` → falls back to `config.default`; errors with a clear message if neither resolves. Invalid level → error listing the three valid values, same UX as the existing `aiProvider` validator.

**Explicitly cut:** a symmetric `config get recallStrictness` — user's call, keeping this minimal. `cat ~/.ticketlens/profiles.json` already answers "what's it set to" for anyone who needs to check.

---

## 4. Lever 1 — capture judgment (SKILL.md + brief injection)

`resolveConnection()` (`profile-resolver.mjs:281`) gains one field in its returned object, same pattern as its existing `staleRule`/`sortBy` passthroughs:

```js
recallStrictness: normalizeRecallStrictness(profile.recallStrictness),
```

Both rendering paths in `fetch-ticket.mjs` — `assembleBrief()` (plain) and `styleBrief()` (styled, `styled-assembler.mjs`) — gain a `recallStrictness` param. When it is **not** `'balanced'`, one line is injected near the ticket meta line:

```
**Recall capture:** strict
```

When it **is** `'balanced'` (the default, and today's only value), nothing is added — zero diff to existing brief output for the overwhelming majority of users who never touch this setting. This protects the existing golden-output regression baseline.

`SKILL.md`'s "When to capture a note" section gains a short preface plus three named calibration blocks:

- **Absent the `**Recall capture:**` line, or `balanced`:** today's exact three-part rule, verbatim, unchanged.
- **`loose`:** raise the bar — capture only when the effort/non-obviousness criterion (today's point 3) is clearly and strongly met, not borderline.
- **`strict`:** lower the bar — capture more liberally; when in doubt on the effort/generalizes criteria, capture rather than skip. Point 1 (not already written down) and the secret/credential exclusion stay absolute at every level — they're correctness checks, not judgment calls.

---

## 5. Lever 2 — Stop hook trigger (recall-nudge-stop.mjs)

Reads `resolveProfile(null, { cwd }).recallStrictness` (normalized, default `'balanced'`) — local, synchronous, no network, same cost profile as every other read this hook already does.

**Correction from the brainstorm discussion:** today's hook has exactly **one** trigger condition, not two — `sawTicketKey && !sawNoteAdd`. `sawRecallFlag` only selects which of the two messages prints; it does not gate whether the hook blocks at all. The design below reflects that.

- **`loose`:** narrow the trigger to `sawRecallFlag && !sawNoteAdd` only (broken promise). The weaker "ticket work happened, nothing was ever flagged" case is silently allowed to pass.
- **`balanced`:** unchanged — today's exact trigger, `sawTicketKey && !sawNoteAdd`.
- **`strict`:** same trigger as `balanced`. Deliberately not widened further — see below.

**Why strict doesn't add a hook-level trigger:** the two candidate ways to make the hook more aggressive than `balanced` each break a documented invariant. Bypassing `hasRecentCapture()`'s 2-hour rollover bridge would re-nag after a genuine capture that landed just before a compaction/session_id rollover — the exact bug that check exists to prevent. Nagging more than once per session_id violates the hook's own stated contract ("never traps the user in a loop... must never be the reason a session can't end"). Neither is a legitimate strictness knob — they're correctness bugs waiting to happen. Strict's real effect is in Lever 1: a lower in-session capture bar means the "nothing was ever captured" trigger condition is reached less often to begin with.

**Untouched invariants at every strictness level** (regression lock-test candidates for the plan):
- At most one block (exit 2) per `session_id`.
- `hasRecentCapture()`'s 2-hour cross-session-rollover bridge always applies before the trigger check.
- No ticket work at all (`!sawTicketKey`) always exits clean, regardless of level.

---

## 6. Data flow summary

```
profiles.json (profiles.<name>.recallStrictness)
        │
        ├─► resolveProfile()/resolveConnection() ──► assembleBrief()/styleBrief()
        │         (fetch-ticket.mjs)                    │
        │                                                ▼
        │                                    "**Recall capture:** <level>"
        │                                    line in the TicketBrief Claude reads
        │                                                │
        │                                                ▼
        │                                  SKILL.md's three named calibration
        │                                  blocks — governs in-session judgment
        │
        └─► resolveProfile() ──► recall-nudge-stop.mjs
                  (Stop hook, independent read, no brief involved)
                       │
                       ▼
              trigger condition per level (§5)
```

The two levers read the same stored value independently — the hook never sees the brief Claude read earlier in the session, and doesn't need to.

**Known limitation for multi-profile users:** Lever 1 (`resolveConnection(ticketKey, ...)`) resolves by ticket-key prefix when a ticket key is available. Lever 2 (`resolveProfile(null, { cwd })`, in the Stop hook) never receives a ticket key, so it falls through to cwd/`projectPaths` then the default profile. A multi-profile user can therefore have the two levers resolve to genuinely different profiles in the same session, so the setting doesn't reliably reweight both together outside the single-profile case (the common case, where this is moot). The thorough fix — threading `scanTranscript()`'s matched ticket key into the Stop hook's profile resolution so both levers agree — is a follow-up, not part of this spec; tracked in the backlog.

---

## 7. Testing considerations (for the plan, not exhaustive here)

- Shared enum: valid values pass through, invalid/missing values normalize to `balanced`.
- `saveProfileRecallStrictness`: merges without clobbering other profile fields; errors on unknown profile.
- CLI `config set recallStrictness`: valid level + explicit `--profile=`; valid level + default-profile fallback; no profile resolvable → error; invalid level → error listing valid values.
- `resolveConnection()`: returns `normalizeRecallStrictness(...)` for a profile with the field set, unset, and set to garbage.
- `assembleBrief()`/`styleBrief()`: line present for `loose`/`strict`, absent for `balanced`/unset — byte-identical output to today when unset (regression lock test).
- `recall-nudge-stop.mjs`: trigger matrix — 3 levels × {flag-no-note, ticket-work-no-flag-no-note, note-added, no-ticket-work} — plus explicit lock tests for the once-per-session cap and the `hasRecentCapture()` bridge at every level, not just `balanced`.

---

## 8. Open items for the plan (not this spec)

- Exact file for the shared enum (§2) — `profile-resolver.mjs` vs. a new small module; decide when reading current file sizes/cohesion in Step 1c of the build.
- Exact wording of the three SKILL.md calibration blocks (§4) — drafted during implementation, reviewed same as any other prompt-text change.
