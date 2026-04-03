# Mintlify Docs Alignment Audit — 2026-03-30

## Methodology

**Live docs URL:** `https://www.mintlify.com/ralphmoran/ticket-lens` (accessible; `ticketlens.mintlify.app` returned 500, `docs.ticketlens.dev` refused connection)

**Pages audited:**
- `/` (root/introduction)
- `/quickstart`
- `/commands/fetch`
- `/commands/triage`
- `/commands/cache`
- `/commands/profile-management`
- `/configuration/profiles`
- `/configuration/auth`
- `/integrations/claude-code`
- `/integrations/ci-cd`
- `/licensing/activate`
- `/licensing/overview`
- `/reference/flags`
- `/llms.txt` (sitemap)

**Code ground truth files:**
- `bin/ticketlens.mjs` — command dispatch (all supported top-level commands)
- `skills/jtb/scripts/lib/help.mjs` — user-facing help text (printHelp, printFetchHelp, printTriageHelp)
- `skills/jtb/scripts/lib/profile-resolver.mjs` — profile resolution logic and deleteProfile implementation

---

## Command Audit

| Command / Flag | Docs Says | Code Does | Verdict |
|---|---|---|---|
| `ticketlens init` | Guided setup wizard | Runs `init-wizard.mjs` | MATCH |
| `ticketlens switch` | Arrow-key menu to select active profile | Runs `profile-switcher.mjs` | MATCH |
| `ticketlens config [--profile=NAME]` | Edit profile settings | Runs `config-wizard.mjs` with optional `--profile` | MATCH |
| `ticketlens profiles` | List all profiles in table format | Calls `printProfiles()` | MATCH |
| `ticketlens ls` (alias) | Alias for profiles | Not dispatched in `bin/ticketlens.mjs` — no `case 'ls'` | MISMATCH — docs claim alias exists; code has no handler |
| `ticketlens profiles --plain` | Tab-separated output | `--plain` flag read in `case 'profiles'` | MATCH |
| `ticketlens delete <NAME>` | Remove a profile | Dispatched in `case 'delete'` | MATCH |
| `ticketlens activate <KEY>` | Activate license key | Dispatched in `case 'activate'` | MATCH |
| `ticketlens license` | Show license status | Dispatched in `case 'license'` | MATCH |
| `ticketlens cache [size\|clear]` | Manage attachment cache | Runs `cache-manager.mjs` | MATCH |
| `ticketlens version` | Print version | Dispatched in `case 'version'` | MATCH |
| `ticketlens schedule` | **Not documented anywhere in docs** | Full `case 'schedule'` with `--stop`, `--status` sub-flags and wizard | MISSING FROM DOCS |
| `ticketlens get <TICKET-KEY>` | Explicit alias for fetch | `parseCommand` maps `get` → `fetch` (handled upstream of switch) | MATCH |
| `ticketlens help` | Not a dedicated page, help shown by default | `case 'help'` falls through to `printHelp()` | MATCH |
| **FETCH FLAGS** | | | |
| `--profile=NAME` | Override profile for fetch | Parsed and passed through | MATCH |
| `--depth=N` | Traversal depth 0/1/2; docs say depth=2 is Pro | Accepted by fetch runner | MATCH |
| `--plain` | Plain markdown output | Supported | MATCH |
| `--styled` | Force ANSI output | Supported | MATCH |
| `--no-attachments` | Skip attachment download | Supported | MATCH |
| `--no-cache` | Bypass cache and re-fetch | Listed in `help.mjs` and `reference/flags`; present in fetch-page docs | MATCH |
| `--check` | Append VCS diff + Claude Code review instructions | Listed in `help.mjs`; **absent from `/commands/fetch` docs page and `/reference/flags`** | MISSING FROM DOCS |
| `--summarize` | Generate AI summary (BYOK or --cloud) [Pro] | Listed in `help.mjs`; **absent from all docs pages** | MISSING FROM DOCS |
| `--cloud` | Route summary through TicketLens API [Pro] | Listed in `help.mjs`; **absent from all docs pages** | MISSING FROM DOCS |
| `--project` alias | Docs list `--project` as backward-compat alias for `--profile` | No `--project` alias found in `bin/ticketlens.mjs` or `help.mjs` | MISMATCH — docs invent an alias the code does not support |
| **TRIAGE FLAGS** | | | |
| `--profile=NAME` | Override profile | Supported | MATCH |
| `--stale=N` | Aging threshold (default 5) | Supported | MATCH |
| `--status=X,Y` | Override statuses | Supported | MATCH |
| `--assignee=NAME` [Team] | Triage another dev's tickets | Listed in `help.mjs` | MATCH |
| `--sprint=NAME` [Team] | Filter by sprint | Listed in `help.mjs` | MATCH |
| `--export=FORMAT` [Team] | Export csv/json | Listed in `help.mjs` | MATCH |
| `--digest` [Pro] | POST scored results to digest endpoint | Listed in `help.mjs`; **absent from `/commands/triage` docs page and `/reference/flags`** | MISSING FROM DOCS |
| `--static` | Static table, skip interactive | Supported | MATCH |
| `--plain` | Plain markdown | Supported | MATCH |
| **SCHEDULE COMMAND FLAGS** | | | |
| `ticketlens schedule --stop` | Not documented | Dispatched in `case 'schedule'` | MISSING FROM DOCS |
| `ticketlens schedule --status` | Not documented | Dispatched in `case 'schedule'` | MISSING FROM DOCS |
| **LICENSE COMMAND** | | | |
| Grace period 30 days | Documented correctly | Implemented: `daysSinceVal > 30` check | MATCH |
| Revalidation every 7 days | Documented correctly | Implemented: `revalidateIfStale()` at startup | MATCH |
| Four license states | Active / pending / expired / free — all documented | All four states in `case 'license'` | MATCH |

---

## Critical Mismatches

Items a user would follow and fail:

### 1. `ticketlens ls` alias — documented but not implemented
The `/configuration/profiles` page and `/commands/profile-management` page both document `ticketlens ls` as an alias for `ticketlens profiles`. There is no `case 'ls'` in `bin/ticketlens.mjs`. A user following the docs will get the default help output instead of their profile list.

### 2. `--project` alias — docs invent it, code does not support it
The `/commands/fetch` page lists `--project` as a "backward-compatible alias for `--profile`". Neither `help.mjs`, `bin/ticketlens.mjs`, nor any other source file implements this alias. Users following this docs example will silently ignore the flag and fall back to automatic profile resolution.

### 3. Profile resolution order — step 4 discrepancy
Docs say step 4 is "First profile in file." Code in `profile-resolver.mjs` (lines 194–196) says step 4 is the explicit `config.default` field, only falling back to first-in-file if `config.default` is absent. The docs collapse these two steps into one, which misrepresents behavior when `config.default` is set but differs from the first profile.

### 4. `ticketlens delete` — non-TTY behavior misdescribed
The `/commands/profile-management` page states: "Non-TTY mode (scripts/CI): Exits without prompting and does not delete unless confirmation is provided via stdin." The actual code (lines 147–165 of `bin/ticketlens.mjs`) only prompts when `process.stdin.isTTY && process.stdin.setRawMode` — if neither condition is true it skips the prompt and **deletes immediately without confirmation**. The docs imply non-TTY is safe/protected; the code is not.

---

## Missing from Docs

Commands and flags present in code but not documented anywhere in the Mintlify site:

| Missing Item | Where in Code | Notes |
|---|---|---|
| `ticketlens schedule` | `bin/ticketlens.mjs` case 'schedule' | Full wizard + Pro gate + `--stop`/`--status` sub-flags |
| `ticketlens schedule --stop` | schedule-wizard.mjs via case 'schedule' | Stops scheduled digest |
| `ticketlens schedule --status` | schedule-wizard.mjs via case 'schedule' | Shows schedule status |
| `--check` (fetch flag) | `help.mjs` line 56, 117 | Appends VCS diff for Claude Code; not on fetch page or flags ref |
| `--summarize` (fetch flag) | `help.mjs` line 57, 118 | AI summary, BYOK or --cloud, Pro tier |
| `--cloud` (fetch flag) | `help.mjs` line 58, 119 | Routes summary via TicketLens API, Pro tier |
| `--digest` (triage flag) | `help.mjs` line 69, 228 | POSTs scored results to digest endpoint, Pro tier |
| `ticketlens version` | `bin/ticketlens.mjs` case 'version' | Prints version; docs only mention `--version` global flag (different invocation) |

---

## ticketlens delete — Docs vs Code

Specific alignment check per task spec:

**Confirmation prompt:**
- Docs: "Prompts with `Delete profile acme? This cannot be undone.  y/N`"
- Code: `process.stderr.write(\`  Delete profile ${s.cyan(s.bold(profileName))}? This cannot be undone.  ${s.dim('y/N')}  \`)`
- Verdict: MATCH on message text.

**Active profile guard:**
- Docs: No mention of an active profile guard — docs do not say deletion is blocked when the target is the active/default profile.
- Code: No such guard either. `deleteProfile()` in `profile-resolver.mjs` (line 82) only removes `config.default` if it equals the deleted name; it does not prevent the deletion.
- Verdict: MATCH (neither docs nor code block deletion of the active profile). However, docs could note that deleting the active profile clears `config.default` and falls back to first-in-file — this behavioral side effect is undocumented.

**Non-TTY behavior (CRITICAL):**
- Docs: "Exits without prompting and does not delete unless confirmation is provided via stdin."
- Code: When `process.stdin.isTTY` is falsy or `process.stdin.setRawMode` is unavailable, the confirmation block is skipped entirely and `deleteProfile()` is called unconditionally.
- Verdict: MISMATCH. Docs describe a safety net that does not exist. Piped scripts or CI invocations will delete without any prompt.

**Error messages:**
- "Profile not found" error: Code writes `Profile "${profileName}" not found.` with a profile list hint — not mentioned in docs. MINOR OMISSION.
- "Missing profile name" error: Code writes `Missing profile name.` with usage hint — not mentioned in docs. MINOR OMISSION.
- Cache note: Docs add a warning that deletion does not clear cached data and suggest `cache clear --profile=NAME`. Code produces no such warning. Docs are more helpful here than the code.

---

## Recommendations

Prioritized by user impact:

1. **[CRITICAL] Fix non-TTY delete behavior or fix the docs** — The code silently deletes in non-TTY mode; the docs say it is safe. Either add a guard in `bin/ticketlens.mjs` (require `--yes` flag for non-TTY) or correct the docs to warn that piped/CI invocations skip confirmation.

2. **[HIGH] Implement `ticketlens ls` alias or remove from docs** — It is documented on two pages. Add `case 'ls'` to `bin/ticketlens.mjs` pointing to the profiles handler, or remove all references from the docs.

3. **[HIGH] Remove `--project` alias from docs** — It is documented on the fetch command page as a supported flag. The code does not implement it. Remove it or implement it.

4. **[HIGH] Document `--check`, `--summarize`, `--cloud`** — These fetch flags exist in `help.mjs` and add meaningful Pro-tier value. Add them to `/commands/fetch` and `/reference/flags`.

5. **[HIGH] Document `--digest` (triage)** — Listed in `help.mjs` as a Pro flag. Missing from `/commands/triage` and `/reference/flags`.

6. **[MEDIUM] Document `ticketlens schedule`** — Full command exists with Pro gate, wizard, `--stop`, and `--status` sub-flags. Licensing overview marks it "Coming soon" but the code ships it. Either add a `/commands/schedule` page or at minimum note it in the licensing/overview Pro features list.

7. **[MEDIUM] Correct profile resolution order** — Step 4 in docs conflates `config.default` with first-in-file. Split into: 4a) explicit `default` field, 4b) first profile in file.

8. **[LOW] Document `ticketlens version`** — Code supports `ticketlens version` (not just `--version`). Add to the commands reference or global flags section.

9. **[LOW] Document delete side effects** — Note that deleting the active/default profile clears `config.default` silently, and add the cache-clear reminder (which the docs already have but the code does not surface).
