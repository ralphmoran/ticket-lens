<div align="center">

# TicketLens

<div align="center">
  <img src="https://img.shields.io/npm/v/ticketlens?style=flat-square&color=6c63ff&label=version" />
  <img src="https://img.shields.io/npm/dm/ticketlens?style=flat-square&color=06b6d4&label=downloads" />
  <img src="https://github.com/ralphmoran/ticket-lens/actions/workflows/test.yml/badge.svg?style=flat-square" />
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" />
  <img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen?style=flat-square" />
</div>

</div>

> Your AI assistant shouldn't need to read your tickets.

> Reads your tickets, tells you which ones need you right now — and now writes back too: post comments and transition status directly from your terminal or AI session.

<div align="center"><img src="docs/demos/fetch.gif" alt="ticketlens CNV1-2 demo" width="700" /></div>

---

## Contents

- [What is TicketLens?](#what-is-ticketlens)
- [Why TicketLens?](#why-ticketlens)
- [Quick Start](#quick-start)
- [Demos](#demos)
- [Commands](#commands)
  - [Setup](#setup)
  - [Fetch a ticket](#fetch-a-ticket)
  - [Brief Templates](#brief-templates)
  - [Triage](#triage)
  - [Collisions](#collisions)
  - [Review](#review)
  - [Compliance](#compliance)
  - [Compliance Ledger](#compliance-ledger)
  - [Git Hook](#git-hook)
  - [PR Description](#pr-description)
  - [Standup](#standup)
  - [Cache](#cache)
  - [Schedule](#schedule)
  - [History](#history)
  - [Recall](#recall)
  - [Comment, Transition, Assign, Duplicates, Link, Update & Create](#comment-transition-assign-duplicates-link-update--create)
  - [Response-Time Stats](#response-time-stats)
  - [Pre-fetch Issue Types](#pre-fetch-issue-types)
  - [Doctor](#doctor)
  - [Custom Attention Rules](#custom-attention-rules)
  - [Login](#login)
  - [License](#license)
  - [Update Skill](#update-skill)
  - [/jtb — Jira TicketBrief for Claude Code](#jtb--jira-ticketbrief-for-claude-code)
- [All Examples](#all-examples)
- [Pro & Teams Features](#pro--teams-features)
  - [Pro — $9/mo](#pro--9mo)
  - [Team — $19/seat/mo](#team--19seatmo)
- [Multi-Profile Setup](#multi-profile-setup)
- [Running Tests](#running-tests)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license-1)

---

## What is TicketLens?

TicketLens is a local-first Jira CLI that preprocesses ticket context on your machine and hands your AI tools a clean, compressed brief — instead of dumping raw Jira API JSON into your session. It supports Jira Cloud, Server, and Data Center, works with any AI tool that accepts text, and runs independently of any AI session.

Zero npm dependencies. Node.js built-ins only.

---

## Why TicketLens?

- **Privacy** — ticket content never leaves your machine; no cloud relay, no data sent to Anthropic or anyone else
- **60–80% token savings** — structured briefs instead of verbose Jira JSON; 4-hour cache by default
- **Scriptable** — standard CLI output: pipe to cron, git hooks, CI/CD, or any LLM tool
- **Multi-profile** — connect multiple Jira instances simultaneously; auto-route by ticket prefix or project path
- **Attachments included** — images, PDFs, and text files downloaded locally; Claude Code reads them as context
- **Confluence pages** — linked Confluence pages fetched and included in the brief automatically (Jira only)

---

## Quick Start

```bash
npm install -g ticketlens
ticketlens init          # Guided setup: Jira, GitHub Issues, or Linear — connection test included
ticketlens CNV1-2        # Fetch a ticket brief
ticketlens triage        # Scan your assigned tickets
```

Or without installing:

```bash
npx ticketlens init
npx ticketlens CNV1-2
```

Tip: `tl` works everywhere `ticketlens` does — running `tl`/`ticketlens config` before anything is configured also launches guided setup, no dead end. Pass `--no-input` to force non-interactive behavior even in a terminal (scripts, CI).

**Prerequisites:** Node.js >=22.6

---

## Demos

<div align="center"><img src="docs/demos/triage.gif" alt="ticketlens triage demo" width="700" /></div>

---

## Commands

### Setup

| Command | Description |
|---------|-------------|
| `ticketlens init` | Guided wizard — Jira, GitHub Issues, or Linear — live connection test; pick ticket prefixes and triage statuses straight from your instance |
| `ticketlens switch` | Arrow-key panel to switch between configured profiles |
| `ticketlens config [--profile=NAME]` | Edit any field on an existing profile — always re-validates the connection |
| `ticketlens profiles` | List all configured profiles (alias: `ticketlens ls`) |
| `ticketlens delete <NAME>` | Remove a profile and its credentials (prompts `y/N` in TTY; use `--yes` in scripts/CI) |

`init` collects: profile name, tracker type (Jira / GitHub Issues / Linear), URL or workspace, credentials (masked), and optional ticket prefixes, project paths, and triage statuses. On connection failure, a retry menu lets you fix credentials, URL, or skip — all inputs pre-populated. If your Jira instance sits behind a VPN and resolves to a private/internal address, you'll be asked to confirm you trust that connection before it's allowed through — a one-time confirmation, remembered per profile and scoped to that exact host (changing the URL asks again). `config` is tracker-aware and always re-validates the connection after edits.

**No more guessing prefixes or status names** — on Jira, once the connection test passes, ticket prefixes and triage statuses are picked from live multi-select lists fetched from your instance (its actual projects and statuses), with sensible defaults pre-checked. Space toggles, `a` toggles all, Enter confirms. When editing with `config`, your current values come pre-selected and unchecking removes them; anything configured that no longer exists on the server is flagged `(not on server)` so you can clean it up — or keep it — deliberately. In non-interactive shells, or if the lists can't be fetched (press Esc to choose this any time), the wizard falls back to classic free-text entry with live validation — free-text `config` entries keep the old add-only merge, and partial matching still resolves `QA` to `QA Testing` if that's the status in your Jira.

---

### Fetch a ticket

```bash
ticketlens CNV1-2                  # Depth 1, styled output (default)
ticketlens get CNV1-2              # Same — explicit alias
ticketlens CNV1-2 --depth=0        # Target ticket only
ticketlens CNV1-2 --depth=1        # + linked ticket descriptions and comments
ticketlens CNV1-2 --depth=2        # + linked-of-linked (full graph)
ticketlens CNV1-2 --plain          # Plain markdown — pipe-safe, LLM-ready
ticketlens CNV1-2 --profile=acme   # Force a specific profile
ticketlens CNV1-2 --no-cache       # Bypass cache, re-fetch from Jira
ticketlens CNV1-2 --no-attachments # Skip attachment download and Confluence page fetching
ticketlens CNV1-2 --check          # Append local VCS diff + Claude Code review instructions
ticketlens CNV1-2 --compliance     # Check ticket requirements against local diff [Pro/Free 3/mo]
ticketlens CNV1-2 --summarize                  # AI summary via your own API key (BYOK) [Pro]
ticketlens CNV1-2 --summarize --provider=groq  # Force a specific AI provider [Pro]
ticketlens CNV1-2 --summarize --cloud          # AI summary routed through TicketLens API [Pro]
ticketlens CNV1-2 --handoff                    # AI handoff brief from comment thread (BYOK) [Pro]
ticketlens CNV1-2 --handoff --cloud            # AI handoff brief via TicketLens API [Pro]
ticketlens CNV1-2 --template=quick             # Apply a brief template (full|quick|code-review, or custom [Team])
```

| `--depth` | Scope |
|-----------|-------|
| `0` | Target ticket: description, comments, attachments, Confluence pages |
| `1` | + linked tickets: descriptions and comments _(default)_ |
| `2` | + linked-of-linked: key and summary only |

Max 15 tickets at any depth. Circular references handled automatically.

After the first fetch, ticket data is cached to `~/.ticketlens/cache/PROFILE/TICKET-KEY/brief.json` (4h TTL, depth-aware). A dim notice appears on stderr on cache hit:

```
  ○ CNV1-2 · from cache (12m ago)  ·  --no-cache to refresh
```

Attachments download to `~/.ticketlens/cache/TICKET-KEY/` (10 MB per-file cap). Claude Code reads images multimodally, extracts PDF text, and reads plain text files as context.

Confluence pages linked to the ticket via Jira Remote Links are fetched automatically and included as plain text in the brief (Jira profiles only, same-origin). Use `--no-attachments` to skip both attachments and Confluence pages.

---

### Brief Templates

Control which sections appear in a brief without changing the default output for everyone else.

```bash
ticketlens CNV1-2 --template=quick              # Meta + 2 comments only
ticketlens CNV1-2 --template=code-review        # Meta + description + linked + code refs
ticketlens CNV1-2 --template=full               # All sections (same as default)
ticketlens CNV1-2 --template=my-team-template   # Custom team template [Team]
```

Three system templates ship out of the box:

| Slug | Sections | Best for |
|------|----------|---------|
| `full` | Everything (default) | LLM context, deep planning |
| `quick` | Meta + 2 comments | Standup, daily triage |
| `code-review` | Meta + description + linked + code refs | PR review |

**Custom templates [Team]** — create your own in the Console under **Admin → Brief Templates**. Pick which sections appear and cap comment count. The slug you set is what you pass to `--template=`.

---

### Triage

```bash
ticketlens triage                               # Scan assigned tickets — interactive
ticketlens triage --profile=acme               # Explicit profile
ticketlens triage --stale=3                    # Aging threshold: 3 days (default: 5)
ticketlens triage --sort=priority              # Sort by priority first, then urgency (default: urgency)
ticketlens triage --status="Code Review,QA"    # Override statuses to scan
ticketlens triage --assignee="Jane Dev"        # Another dev's tickets [Team]
ticketlens triage --sprint="Sprint 12"         # Filter by sprint [Team]
ticketlens triage --project=MYPROJ             # Scope to a Jira project key [Team]
ticketlens triage --label=Bug,P1               # Filter by label(s) [Team]
ticketlens triage --priority=High              # Filter by priority level [Team]
ticketlens triage --export=csv                 # Export results to CSV [Team]
ticketlens triage --export=json                # Export results to JSON [Team]
ticketlens triage --push                       # Push snapshot to Console queue [Team]
ticketlens triage --share                      # Generate 24h share URL (no login for recipient) [Team]
ticketlens triage --all                        # Triage all profiles at once, merged output [Pro]
ticketlens triage --save=~/triage.txt          # Save ANSI-stripped output to file [Pro]
ticketlens triage --digest                     # POST scored results to digest endpoint [Pro]
ticketlens triage --plain                      # Plain markdown — pipe to file or LLM
ticketlens triage --static                     # Static table, no interactive mode
```

| Badge | Category | Condition |
|-------|----------|-----------|
| `●` red | Needs response | Someone else commented within the last N days |
| `●` yellow | Aging | Last comment or update is N+ days old |

`--stale=N` controls both categories. Unanswered comments older than N days downgrade from "needs response" to "aging" automatically.

`--sort=priority|urgency` controls display order for this run only. `priority` groups tickets by Jira priority (Highest → Lowest, unknown last) with urgency as the tiebreaker; `urgency` is today's default ordering. Set a permanent default by adding `"sortBy": "priority"` to a profile in `~/.ticketlens/profiles.json` — the flag overrides it for a single run, same relationship `--stale=N` has to `staleDays`. This is a personal, per-profile preference — it does not sync with the Console's own sort-order setting on the Account page, which only affects the Console queue view.

Interactive mode: `↑/↓` navigate, `Enter` open in browser, `p` switch profile, `q/Esc` exit. Columns adapt to terminal width.

Status mismatch auto-fix: if configured statuses don't match Jira's exact casing, triage shows a diff and offers to update your profile:

```
  ~ In progress  →  In Progress
  ~ QA           →  QA Testing

  Update "myteam" with corrected statuses?  y/N
```

Bot comments (Jira Automation, Jenkins, GitHub Actions) are automatically ignored.

---

### Collisions

```bash
ticketlens collisions                         # Show branches that overlap with teammates [Team]
ticketlens collisions --json                  # Machine-readable output
ticketlens collisions --plain                 # Plain text, no ANSI colour
```

Requires a Team license and at least one teammate in your group. Compares your current git branch's changed files against your teammates' recent branches (within 7 days). Reports each overlap as a collision: your branch, their branch, the shared files, and linked ticket keys.

```
[1] feat/auth-refactor ↔ Jane Dev (feat/login-redesign)
    Your tickets:  PROJ-101
    Their tickets: PROJ-88
    Shared files:  src/auth/LoginController.php, src/auth/guards.php
```

Branches are captured automatically when you run `ticketlens triage --push`. No extra step required.

---

### Review

```bash
ticketlens review                             # Assemble PR review context from current branch
ticketlens review --branch=main              # Compare against main (auto-detected by default)
ticketlens review --branch=develop           # Compare against a specific branch
ticketlens review --base=main                # Alias for --branch
ticketlens review --profile=acme             # Use a specific profile for ticket fetching
ticketlens review --branch=main | pbcopy     # Copy brief to clipboard
ticketlens review --branch=main | llm "What changed and why?"
ticketlens review --help                     # Review subcommand help
```

Extracts linked ticket keys from the branch name and commit messages, fetches each ticket via the configured profile, then assembles a structured brief: branch, changed files, and ticket context. On TTY, output is ANSI-styled with colored section headers, file paths, and coverage percentages.

`--branch=BRANCH` (or `--base=BRANCH`) sets the comparison base. Defaults to auto-detecting `main`, `master`, or `develop`.

Flag validation provides actionable hints:

```
✖ Unknown flag: --branch-main
  Did you mean --branch=main?
```

---

### Compliance

```bash
ticketlens compliance <TICKET-KEY>                # Check ticket requirements against local diff [Pro/Free 3/mo]
ticketlens compliance <TICKET-KEY> --profile=acme # Specify a profile
ticketlens compliance <TICKET-KEY> --plain        # Plain markdown output
```

Runs the same compliance check as `ticketlens CNV1-2 --compliance` but as a dedicated subcommand — useful when you want to check compliance without fetching the full ticket brief. Free accounts get 3 checks per month; Pro is unlimited.

---

### Compliance Ledger

```bash
ticketlens ledger                             # View the local compliance audit ledger, JSON + signature [Pro]
ticketlens ledger --format=csv                # Flat CSV export, no signature [Pro]
```

Displays the append-only local ledger of all compliance checks run on this machine. Useful for SOC 2 / HIPAA audit trails. Requires a Pro license.

---

### Git Hook

```bash
ticketlens install-hooks                      # Install pre-push compliance gate
ticketlens install-hooks --uninstall          # Remove installed hooks
```

Installs a `pre-push` git hook that runs `ticketlens compliance` on every push. Blocks the push if compliance coverage falls below the configured threshold. Free — the hook itself needs no license; the `compliance` check it runs follows its own free (3/month) or Pro (unlimited) limit.

---

### PR Description

```bash
ticketlens pr <TICKET-KEY>                    # Generate PR description from ticket
ticketlens pr <TICKET-KEY> --profile=acme    # Specify a profile
ticketlens pr <TICKET-KEY> --plain           # Plain markdown output
ticketlens pr <TICKET-KEY> | pbcopy          # Copy to clipboard
```

Generates a PR description template pre-filled with the ticket summary, acceptance criteria, and compliance coverage. Free — the compliance coverage section follows the `compliance` command's own free (3/month) or Pro (unlimited) limit.

---

### Standup

```bash
ticketlens standup                            # Standup summary for the last 24 hours
ticketlens standup --since=48                 # Last 48 hours
ticketlens standup --since=yesterday          # Git date string
ticketlens standup --format=pr               # PR body format: "What changed" + commit list
ticketlens standup --profile=myteam          # Enrich with ticket summaries from Jira
ticketlens standup --plain                   # Plain markdown (no ANSI colour)
ticketlens standup --plain | pbcopy          # Copy standup to clipboard
ticketlens standup --help                    # Standup subcommand help
```

Scans `git log` for the configured window, extracts ticket keys from commit messages, and groups commits by ticket. Optionally fetches ticket summaries from your Jira profile to add context. Outputs a dated standup brief or a PR body depending on `--format`.

**`--format=standup` (default)**
```
## Standup — Mon, May 18, 2026

### Commits by ticket

**PROJ-123** — Fix payment validation (2 commits)
  abc1234 feat: PROJ-123 add payment validation check
  def5678 test: PROJ-123 payment validation tests

[No ticket key] (1 commit)
  jkl3456 chore: bump deps
```

**`--format=pr`** — paste directly into a GitHub/GitLab PR description
```
## What changed

- **PROJ-123** — Fix payment validation

## Commits (3)

- `abc1234` feat: PROJ-123 add payment validation check
- `def5678` test: PROJ-123 payment validation tests
- `jkl3456` chore: bump deps
```

When no commits reference a ticket key, `## What changed` shows `_No ticket references found in commits._` instead of a blank section.

---

### Cache

```bash
ticketlens cache size                          # Disk usage by profile and ticket
ticketlens cache size --profile=acme           # Filter to one profile
ticketlens cache clear                         # Interactive picker (TTY)
ticketlens clear                               # Alias for cache clear
ticketlens cache clear CNV1-2                  # Clear one ticket
ticketlens cache clear --older-than=7d         # Files older than 7 days
ticketlens cache clear --profile=acme          # One profile's files only
ticketlens cache clear --older-than=30d --yes  # Skip confirmation (CI/scripts)
```

Age units: `d` = days · `m` = months (30d) · `y` = years (365d)

Cache locations:
- Attachments: `~/.ticketlens/cache/TICKET-KEY/`
- Briefs: `~/.ticketlens/cache/PROFILE/TICKET-KEY/brief.json`

---

### Schedule

```bash
ticketlens schedule               # Interactive wizard — set digest time, timezone, profile [Pro]
ticketlens schedule --stop        # Cancel the scheduled digest
ticketlens schedule --status      # Show current schedule
ticketlens schedule --local --time=07:00 --save=./triage.txt   # Local-only cron/LaunchAgent, no Console auth [Pro]
```

Not logged in? `ticketlens schedule` falls back to local-only mode automatically — same as passing `--local` explicitly.

Stores the schedule as a cron entry. Delivers your triage digest at the configured time without an open terminal. Requires a Pro license.

---

### History

```bash
ticketlens history <TICKET-KEY>   # Show urgency timeline for a ticket [Pro]
```

Reads from your local `~/.ticketlens/triage-history/` snapshots (written automatically on each `ticketlens triage` run) and renders a day-by-day urgency timeline for the requested ticket. Entries where urgency changed direction are flagged as "bounced" — useful for spotting tickets that keep reverting between Code Review and In Progress.

Requires a Pro license. No network call — reads local snapshots only.

---

### Recall

```bash
echo "Refresh tokens expire silently after 30 days" | ticketlens note add --title="Token refresh gotcha" --ticket=PROJ-123 --tags=auth
ticketlens recall PROJ-123                 # Search saved notes by ticket key
ticketlens recall "refresh token"          # Free-text search across all your notes
ticketlens recall PROJ-123 --full          # Print each matching note's full content
```

Save short notes to yourself — gotchas, context, decisions — and they're automatically matched and injected into future `ticketlens PROJ-123` briefs under a `## Recall` section, clearly marked as your own reference material (never treated as instructions). A brief injects at most 3 notes in full; beyond that it points you at `ticketlens recall PROJ-123` instead of flooding the brief (`recall` itself has no such cap — it always shows everything that matches). Notes are stored locally at `~/.ticketlens/recall/` as plain markdown files with frontmatter, so they're readable in any editor or Obsidian vault.

The note body is read from stdin, not a flag — this avoids shell-quoting issues with multi-line text. A note can be tied to one ticket (`--ticket=KEY`), or left general (omit `--ticket`) for onboarding-style knowledge that isn't about a specific ticket. Add `--include-attachments` to seed the note with text from that ticket's already-cached attachments (`.txt`/`.md`/`.csv`/`.json` only).

Every note is scanned before saving — anything shaped like a real secret (API key, private key, token) is rejected outright, never silently redacted. An empty, placeholder (`TODO`, `WIP`, …), or too-short body is rejected the same way. Requires a Pro license.

**Quality loop:** inside a Claude Code session using the jtb skill, a saved note can be silently refined afterward — a generator subagent drafts a more actionable version, a validator subagent checks it against other notes on the same ticket for duplication, up to 3 rounds — and the improved draft overwrites the original via the internal `note patch` command (not typically invoked by hand). This makes zero API calls and costs zero extra tokens beyond your already-running session; it never runs for a bare shell invocation of `note add`, which is skipped silently. Known limitation: a refined draft is not re-synced to your team even if the original was — teammates who already pulled the note keep the earlier draft.

**Team sync:** included by default on Team/Enterprise; available on Pro too, as a separate add-on (owner-managed per-client, in case the default ever needs to flex). With it enabled, notes also sync to your team's shared pool — `note add` pushes in the background, `recall` always pulls the team's notes fresh before searching, so a manager's verify/delete in Console is visible on that very search. (Ticket-brief injection uses a separate, short-timeout 4h-cached pull so it never slows down your everyday `ticketlens PROJ-123` — it doesn't need to be instant the way an explicit search does.) A team manager reviews and verifies incoming notes at `console/admin/recall` before they're marked trusted. Without Team Recall entitlement, everything stays on your machine — no network call.

**Offline resilience:** if a team push fails for a transient reason (network error, timeout, or a 5xx from the backend), the note stays safely in your local vault and is queued for retry — nothing is lost. The queue flushes automatically in the background before every command, not just `recall`/`note add` — a short timeout on that check means it never stalls an unrelated command — or on demand with `ticketlens recall sync`. A session-expired (401) or not-entitled (403) push is never queued — those need you to act (`ticketlens login`, or an owner grant), not a retry. Switching accounts never flushes a note under the wrong login.

**Queue settings:** the retry cooldown (default 15 min), per-request timeout (4s), max queued notes (200), and queued-note expiry (30 days) are set by your team manager at `console/admin/recall` and apply to every member's CLI — solo users get the same platform defaults. `ticketlens recall settings` shows the values currently in effect, fetched live: a manager's change is visible the moment your CLI's next retry decision runs, not on a delay.

**Removing a note:** `ticketlens note delete --id="..." [--ticket=KEY]` removes a note from your local vault. Local only — if it was already pushed to a team, teammates who pulled it keep their copy; deleting it there too is a manager action from the Console (Admin > Recall).

**Any MCP-capable AI harness:** `ticketlens mcp` starts a stdio [MCP](https://modelcontextprotocol.io) server exposing `fetch`, `triage`, `compliance`, `review`, `standup`, `pr`, `stats`, `issue_types`, `history`, `collisions`, `ledger`, `doctor`, `recall_add`, `recall_update`, `recall_delete`, `recall_search`, `ticket_comment`, `ticket_transition`, `ticket_assign`, `ticket_duplicates`, `ticket_link`, `ticket_update`, and `ticket_create` as native tools — every CLI action now has an MCP tool, so any MCP-compatible AI assistant, not just Claude Code, can call them directly instead of constructing a shell command. It's a thin adapter over the exact same code as the CLI commands above — same license gate per tool, same secret scan/local vault/tracker writes, same team sync — nothing is reimplemented. `fetch`, `doctor`, and `standup` are Free; `triage`'s base scan is Free with some options gated Pro/Team, same as the CLI (`ticketlens triage --help`); `compliance` and `pr` are Free, sharing a 3-checks/month cap on their requirements-coverage section, Pro unlimited; `review` is Free for branch/files/ticket context, with its coverage/focus section requiring Pro as a plain license check — it does not draw from that same monthly counter; `stats` is Free with a 7-day lookback cap, Pro extends it to 30 days, same split as the CLI (`ticketlens stats --help`); `issue_types` is Free and Jira-only — pre-fetches and caches a profile's real creatable projects and issue types ahead of a `ticket_create` attempt, sharing its cache with that tool's own reactive enrichment; Linear/GitHub profiles get a clear "not available" instead of an empty result; `history` reads local triage history only (zero network) and requires Pro; `collisions` requires `ticketlens login` (Console access) plus a Team license; `ledger` exports the local, signed compliance audit trail (zero network) and requires Pro; every other tool needs Pro. `recall_update` overwrites an existing Recall note's body — internal plumbing for the note quality loop, not typically called directly. `recall_delete` is destructive and local-vault-only — requires `confirm: true` alongside `id` to actually execute; there is no interactive y/N prompt under MCP (no real terminal to prompt against), so omitting it always fails rather than silently blocking. Point your harness's MCP config at it: `{ "command": "ticketlens", "args": ["mcp"] }` — or run `ticketlens mcp install` in a project to write that entry into its `.mcp.json` for you (creates the file if it doesn't exist, merges in if it does — never touches any other entry already there; `--dry-run` to preview first).

`note add`'s save confirmation and `recall`'s search results are styled by default in a terminal; add `--plain` to either for bare, pipe-safe output. `recall` always shows each note's file ID (e.g. `[1784135399545-fe01c4.md]`) so you can open it directly (`cat ~/.ticketlens/recall/<PREFIX>/<id>`), or pass `--full` to print the full body content inline instead. Each result shows a relative time (`2h ago`, `3d ago`) rather than a bare date — the full-precision timestamp is always in the note file's own frontmatter.

**Tags matter for search relevance.** `--tags=a,b` accepts anything, but a generic tag (the project name, "gotcha", "bug") gives future search almost nothing to match on. Tag with what the note is actually *about* — the specific technology, error type, or root cause (`retry-backoff`, `null-pointer`, `auth-middleware`) — so it surfaces when someone else hits the same problem.

**Gaps** — every `ticketlens PROJ-123` brief also diffs the ticket's own description against its linked tickets (from the depth traversal you already requested) and its own downloaded attachments, looking for requirements mentioned there but missing here. Anything uncovered shows up under a `## Gaps` section, citing exactly where it came from — a linked ticket key or an attachment filename — as evidence, never an instruction to act on. Nothing is saved anywhere; it's recomputed fresh on every fetch. Requires a Pro license, same as Recall. No network call beyond what the brief already made.

---

### Comment, Transition, Assign, Duplicates, Link, Update & Create

```bash
ticketlens comment PROJ-123 --body="Looks good, merging."   # Post a comment to the tracker
ticketlens comment PROJ-123 --body="See screenshot" --attach=./bug.png  # Attach local files
ticketlens transition PROJ-123                              # List valid transitions (read-only)
ticketlens transition PROJ-123 --target="Done" --confirm    # Execute the transition
ticketlens assign PROJ-123 --to=me                           # Assign the ticket to yourself
ticketlens duplicates PROJ-123                                # Find likely duplicates (read-only)
ticketlens link PROJ-123 PROJ-456                             # List valid link types (read-only)
ticketlens link PROJ-123 PROJ-456 --type="Duplicate" --confirm  # Execute the link
ticketlens update PROJ-123 --title="Fix login on mobile"       # Update title/description/labels/priority
ticketlens update PROJ-123 --add-labels=urgent,backend --remove-labels=stale
ticketlens create --project=PROJ --type="Task" --summary="Fix login on mobile"  # Create a new ticket
ticketlens create --project=ENG --summary="New Linear issue" --profile=linear-team
ticketlens create --project=PROJ --type="Bug" --summary="Broken layout" --attach=./screenshot.png
```

Write directly to the ticket in its real tracker — Jira, GitHub, or Linear — from your terminal or an AI session via `ticket_comment`/`ticket_transition`/`ticket_assign`/`ticket_duplicates`/`ticket_link`/`ticket_update`/`ticket_create` MCP tools. Requires a Pro license.

`ticketlens transition` with just a ticket key lists the tracker's current valid options without changing anything (Jira: real workflow transitions for that issue; GitHub: open/closed; Linear: team-scoped workflow states). Add both `--target` and `--confirm` to execute — `--confirm` is a deliberate two-step gate: a behavioral nudge and forensic trail, not a hard security guarantee. Every write, once resolved, is re-validated against the tracker's current state immediately before executing — never a blind write against a stale option.

`ticketlens assign` is self-assign only for now — `--to` must be `me`. Assigning to someone else needs a per-tracker user-lookup step this doesn't do yet, so it's deliberately out of scope until that's built.

`ticketlens duplicates` is read-only — it never links or changes anything, just lists likely matches in the same project. No tracker (Jira/GitHub/Linear) scores similarity server-side, so ranking happens locally from title/description word overlap; treat a match as a nudge to check manually, not a verdict. That local scoring can also miss a real duplicate — an empty result means none were found by this heuristic, not a confirmed absence. `--threshold=N` (0–1, default 0.35) controls how loose a match counts.

`ticketlens link SOURCE-KEY TARGET-KEY` links two tickets — direction matters: SOURCE "types" TARGET (e.g. `link A B --type=Duplicate` means A duplicates B, not the other way around). With just the two keys it lists the tracker's current valid link types without changing anything — always fetched live for Jira, since link type names are per-instance configurable there. GitHub is different from Jira/Linear: it has no generic link relationship, so linking on a GitHub-tracked ticket *closes SOURCE as a duplicate of TARGET* — a state change, not just a relationship add — and prints an explicit warning immediately before that happens, on top of the same `--confirm` gate.

`ticketlens update TICKET-KEY` updates a narrow, named field set — title, description, labels, priority. At least one field is required. Labels are always add/remove (`--add-labels=a,b` / `--remove-labels=c`), never a wholesale replace — an unnamed existing label is left alone, never silently dropped. No `--confirm` needed: unlike transition/link, update has no discovery step and only makes reversible metadata edits, the same risk tier as `assign`. GitHub has no priority field on issues, so `--priority` against a GitHub-tracked ticket is refused up front. Each tracker's label mechanics genuinely differ — Jira and Linear apply everything in one atomic call; GitHub's title/description and each label operation are independent, so a call can partially succeed (e.g. the title updates but one label name doesn't resolve) — the result always reports exactly which fields landed.

`ticketlens create` creates a new ticket with a fixed minimal field set — no arbitrary custom fields. Unlike every other write command, there's no existing ticket to target, so `--profile` (or your default profile) picks the tracker instead of a ticket key. `--project` is the Jira project key or Linear team key — required for both, ignored on GitHub since its target repo is already fixed by the profile. `--type` is Jira's issue type (e.g. `"Task"`, `"Bug"`) — required for Jira, ignored elsewhere. No `--confirm` gate, same risk tier as `update`/`assign` — but this is the highest-blast-radius command in the whole family: a bad `--project`/`--type` fabricates a real, hard-to-walk-back item in a live tracker, so an invalid value surfaces the tracker's own error rather than a silent guess.

`--attach=path1,path2` (comma-separated local file paths) is available on `comment` and `create` only. Images render as an inline thumbnail on Jira and Linear; GitHub has no attachment upload API, so `--attach` is unsupported there.

**A bad `--project`/`--type` gets a better error, automatically.** If create fails because the project or issue type doesn't exist, TicketLens fetches your tracker's real, current project list (and, for Jira, the real issue types for that project) and shows them alongside the failure — e.g. `Known creatable projects: CNV1, CNV2.` — rather than a bare tracker error. This is reactive only: it never runs on a successful create, never auto-retries the write, and is cached locally per profile for 24h so a burst of failed attempts doesn't re-fetch every time. `ticketlens issue-types` (below) is the proactive counterpart — pre-fetches and caches the same data ahead of time, so a `create` right after it is a pure cache hit.

All six write actions (comment/transition/assign/link/update/create) have a short local debounce (10s) against an accidental double-fire (a flaky retry, hitting enter twice), and every successful write is appended to a local, append-only audit log (`~/.ticketlens/ticket-action-log.jsonl`). A write that times out is never retried automatically — unlike Recall notes, ticket writes aren't naturally idempotent, so a timed-out attempt is surfaced to you instead of silently repeated. `duplicates` has neither, since nothing is written.

---

### Response-Time Stats

```bash
ticketlens stats                         # Personal metrics from local triage history
ticketlens stats --profile=acme          # Metrics for a specific profile
ticketlens stats --days=14               # Extend lookback window [Pro, max 30]
ticketlens stats --format=json           # JSON output for scripting
ticketlens stats --format=json | jq '.avgResponseHours'
```

Shows avg/median response time, clear rate (resolved within 24h), triage run count, and week-over-week trend — all computed from local `~/.ticketlens/triage-history/` snapshots. No network call.

- **Free**: last 7 days (fixed)
- **Pro**: `--days=N` up to 30 days

A one-line summary footer is also appended automatically to `ticketlens triage` output once you have 2 or more triage runs:

```
── This week: avg 3.2h response · 80% cleared within 24h (5 runs) ──
```

---

### Pre-fetch Issue Types

```bash
ticketlens issue-types                   # Pre-fetch/cache the active profile's real projects + Jira issue types
ticketlens issue-types --profile=acme    # Target a specific profile
ticketlens issue-types --refresh         # Force a live fetch, bypassing the cache
ticketlens issue-types --format=json     # JSON output for scripting
```

Fetches a profile's real creatable projects and, for Jira, each project's valid issue types — the proactive counterpart to `create`'s reactive failure-message enrichment (above): a ready lookup instead of only learning them from a failed create's error. Jira only — Linear has no per-project issue-type concept and GitHub has neither, so both report a clear "not available" instead of an empty result. Free, no license gate. Shares its cache with `create`'s enrichment (`~/.ticketlens/cache/PROFILE/ticket-metadata.json`, 24h TTL), so a `create` failure right after this command is a pure cache hit, no extra network round-trip.

---

### Doctor

```bash
ticketlens doctor                        # Diagnose profile/license/connectivity/cache/MCP-registration/queue problems
ticketlens doctor --fix                  # Attempt safe automatic fixes (license revalidation, corrupt cache cleanup, MCP registration, queue flush)
ticketlens doctor --profile=acme         # Scope checks to a single profile
ticketlens doctor --format=json          # JSON output for scripting/piping
ticketlens doctor --format=json | jq '.ok'
ticketlens doctor --mcp                  # Also check the MCP server handshake (spawns a subprocess)
```

Runs five checks — profile configuration, license freshness, tracker connectivity, attachment cache health, and the Recall sync queue — and reports pass/fail with an actionable hint per failure, instead of a raw stack trace. Free tier, fully unrestricted; no license required.

---

### Custom Attention Rules

Add an `attentionRules` array to any profile in `~/.ticketlens/profiles.json` to override how `ticketlens triage` scores specific tickets:

```json
{
  "profiles": {
    "work": {
      "baseUrl": "https://jira.example.com",
      "attentionRules": [
        { "match": { "priority": "Highest" }, "action": "force-urgent", "reason": "P1 always urgent" },
        { "match": { "label": "backlog" },    "action": "ignore",       "reason": "skip backlog" },
        { "match": { "status": "Parked" },    "action": "ignore",       "reason": "parked tickets" }
      ]
    }
  }
}
```

Rules are evaluated in order — first match wins. Supported `match` keys: `priority`, `label`, `status`, `keyPrefix`. Supported `action` values: `force-urgent` (bumps to needs-response) and `ignore` (excludes from output). Requires a Pro license.

---

### Login

```bash
ticketlens login           # Open browser → authorize in Console → token saved automatically
ticketlens login --manual  # Paste a token instead (CI/headless environments)
ticketlens logout          # Revoke and remove the stored CLI token
ticketlens sync            # Pull your latest tracker profiles from the Console
```

`ticketlens login` opens the TicketLens Console in your default browser. Click **Authorize**, and the CLI receives your token via a one-shot localhost callback — no copy-pasting. Cancelling in the browser exits the CLI cleanly.

Use `--manual` when there is no GUI (CI runners, SSH sessions, containers).

`ticketlens logout` removes the stored Console auth token and disconnects this machine from your TicketLens account. Local Jira profiles and credentials are kept intact — re-run `ticketlens login` to reconnect.

`ticketlens sync` pulls any tracker profiles you have configured in the Console and writes them locally, keeping your CLI in sync with your team settings without re-running `init`.

> **Console features** — `ticketlens triage --push`, `--share`, `ticketlens collisions`, and `ticketlens schedule` all require an active Console session. Run `ticketlens login` once and the token is stored automatically.

---

### License

```bash
ticketlens license                # Show tier and status
ticketlens activate <KEY>         # Activate a Pro or Team license
```

---

### Update Skill

```bash
ticketlens update-skill                          # Sync /jtb skill to all detected AI assistants
ticketlens update-skill --dry-run                # Preview what would be updated (no writes)
ticketlens update-skill --path=~/.gemini/commands  # Sync to a specific assistant directory
ticketlens update-skill --quiet                  # Suppress output (useful in scripts)
```

Copies the latest `SKILL.md` to every AI assistant command directory where `/jtb` is already installed. Runs automatically on `npm install -g ticketlens` — for most users, upgrading the CLI is enough. Use `--dry-run` to confirm what would change before writing.

Supported assistants detected automatically:
- Claude Code — `~/.claude/commands/jtb.md`
- Claude Code (work) — `~/.claude-work/commands/jtb.md`
- Gemini CLI — `~/.gemini/commands/jtb.md`
- Copilot CLI — `~/.copilot-cli/commands/jtb.md`

---

### /jtb — Jira TicketBrief for Claude Code

`/jtb` is a Claude Code slash command that fetches full ticket context and drops a structured implementation brief directly into your session, then enters plan mode.

> Requires [Claude Code](https://claude.ai/code). For standalone use, the `ticketlens` commands above work independently.

**Install:**

```bash
npm install -g ticketlens && ticketlens init
ticketlens update-skill        # copies /jtb skill into ~/.claude/commands/jtb.md
# Restart Claude Code, then:
# /jtb CNV1-2
```

**Keeping the skill up to date:**

```bash
npm install -g ticketlens@latest   # update the CLI
ticketlens update-skill            # sync the /jtb skill to the new version
```

`update-skill` runs automatically on `npm install -g`, so for most users the second step is handled. If you manage Claude Code across multiple machines or accounts, run it manually after updating.

```bash
ticketlens update-skill --dry-run         # preview what would change
ticketlens update-skill --path=~/.gemini/commands  # sync to a different AI assistant
```

**Usage in Claude Code:**

```
/jtb CNV1-2                         # Fetch ticket + linked issues → plan mode
/jtb CNV1-2 --depth=0               # Target ticket only (fast)
/jtb CNV1-2 --depth=2               # Deep: full linked-issue graph
/jtb CNV1-2 --profile=acme          # Force a specific profile
/jtb CNV1-2 --no-attachments        # Skip attachment download
/jtb CNV1-2 --no-cache              # Re-fetch from Jira
/jtb CNV1-2 --template=quick        # Apply quick template (meta + 2 comments)
/jtb CNV1-2 --template=code-review  # Apply code-review template
/jtb CNV1-2 --template=my-slug      # Apply a custom team template [Team]
/jtb triage                         # Scan your assigned tickets
```

Attachments are listed in the brief as absolute paths. Claude Code reads images (multimodal), PDFs, and text files before planning. Files over 10 MB are skipped.

---

## All Examples

```bash
# ── Setup ────────────────────────────────────────────────────────────────────
ticketlens init                               # Guided wizard (recommended)
ticketlens switch                             # Switch between configured profiles
ticketlens config                             # Edit the active profile
ticketlens config --profile=acme             # Edit a specific profile
ticketlens config set aiProvider groq        # Set default AI provider (groq|openai|anthropic)
ticketlens config set recallStrictness strict # Tune Recall-capture strictness (loose|balanced|strict)
ticketlens profiles                           # List all configured profiles
ticketlens ls                                 # Alias for profiles
ticketlens profiles --plain                   # Tab-separated (scripts / pipes)
ticketlens delete <PROFILE-NAME>              # Remove a profile (prompts y/N in TTY)
ticketlens delete <PROFILE-NAME> --yes        # Remove without prompt (scripts/CI)

# ── Fetch a ticket brief ──────────────────────────────────────────────────────
ticketlens CNV1-2                            # Fetch with defaults (depth 1, styled)
ticketlens get CNV1-2                        # Explicit alias (same result)
ticketlens CNV1-2 --depth=0                  # Target ticket only — no linked issues
ticketlens CNV1-2 --depth=1                  # + linked ticket descriptions and comments
ticketlens CNV1-2 --depth=2                  # + linked-of-linked (full graph)
ticketlens CNV1-2 --profile=acme             # Force a specific Jira profile
ticketlens CNV1-2 --plain                    # Plain markdown — no color codes
ticketlens CNV1-2 --styled                   # Force ANSI color even when piping
ticketlens CNV1-2 --no-attachments           # Skip attachment download entirely
ticketlens CNV1-2 --no-cache                 # Skip brief cache + force re-download
ticketlens CNV1-2 --check                    # Append local VCS diff + Claude Code review instructions
ticketlens CNV1-2 --compliance               # Check ticket requirements against local diff [Pro/Free 3/mo]
ticketlens CNV1-2 --summarize                   # AI summary via your own API key (BYOK) [Pro]
ticketlens CNV1-2 --summarize --provider=groq   # Force Groq (Llama 3.1, free tier) [Pro]
ticketlens CNV1-2 --summarize --cloud           # AI summary via TicketLens API [Pro]
ticketlens CNV1-2 --handoff                     # AI handoff brief from comment thread (BYOK) [Pro]
ticketlens CNV1-2 --handoff --cloud             # AI handoff brief via TicketLens API [Pro]
ticketlens CNV1-2 --template=quick              # Apply quick template (meta + 2 comments only)
ticketlens CNV1-2 --template=code-review        # Apply code-review template (meta + desc + linked + code refs)
ticketlens CNV1-2 --template=full               # Apply full template (all sections, default)
ticketlens CNV1-2 --template=my-team-template   # Apply a custom team template [Team]
ticketlens CNV1-2 --budget=8000                 # Trim brief to fit a token budget [Pro]
ticketlens CNV1-2 --depth=2 --profile=acme --plain   # Combine flags freely

# Pipe plain output to clipboard, LLM, or file
ticketlens CNV1-2 --plain > brief.md
ticketlens CNV1-2 --plain | pbcopy
ticketlens CNV1-2 --plain | llm "Summarize this ticket in 3 bullets"

# ── Triage ────────────────────────────────────────────────────────────────────
ticketlens triage                             # Scan assigned tickets — interactive
ticketlens triage --profile=acme             # Explicit profile
ticketlens triage --stale=3                  # Needs-response window: 3 days (default: 5)
ticketlens triage --stale=10                 # More lenient — only flag very stale tickets
ticketlens triage --sort=priority            # Sort by priority first, then urgency (default: urgency)
ticketlens triage --status="Code Review,QA Testing"  # Scan these statuses only
ticketlens triage --static                   # Static table output (no interactive mode)
ticketlens triage --plain                    # Plain markdown — pipe to LLM or file
ticketlens triage --assignee="Jane Dev"      # View another dev's tickets [Team]
ticketlens triage --sprint="Sprint 12"       # Filter by sprint name [Team]
ticketlens triage --project=MYPROJ           # Scope to a Jira project key [Team]
ticketlens triage --label=Bug,P1             # Filter by label(s) [Team]
ticketlens triage --priority=High            # Filter by priority level [Team]
ticketlens triage --project=MYPROJ --label=Bug --priority=High  # Combined [Team]
ticketlens triage --assignee="Jane Dev" --sprint="Sprint 12"  # Combined [Team]
ticketlens triage --export=csv               # Export to CSV [Team]
ticketlens triage --export=json              # Export to JSON [Team]
ticketlens triage --push                     # Push snapshot to Console queue [Team]
ticketlens triage --share                    # Generate 24h share URL (no login for recipient) [Team]
ticketlens triage --all                      # Triage all profiles at once, merged output [Pro]
ticketlens triage --save=~/triage.txt        # Save ANSI-stripped output to file [Pro]
ticketlens triage --digest                   # POST results to digest endpoint [Pro]
ticketlens triage --profile=acme --stale=3 --static          # Combine flags

# Pipe triage output
ticketlens triage --plain > my-tickets.md
ticketlens triage --plain | llm "Which ticket is most urgent and why?"

# ── Collisions ────────────────────────────────────────────────────────────────
ticketlens collisions                         # Show branch collisions with teammates [Team]
ticketlens collisions --json                  # Machine-readable JSON output
ticketlens collisions --plain                 # Plain text, no ANSI colour

# ── PR Review ─────────────────────────────────────────────────────────────────
ticketlens review                             # Assemble PR review context from current branch
ticketlens review --branch=main              # Compare against main (auto-detected by default)
ticketlens review --branch=develop           # Compare against a specific branch
ticketlens review --base=main                # Alias for --branch
ticketlens review --profile=acme             # Use a specific profile for ticket fetching
ticketlens review --branch=main | pbcopy     # Copy brief to clipboard
ticketlens review --branch=main --profile=myteam  # Branch + profile combined
ticketlens review --help                     # Review subcommand help

# ── Standup ───────────────────────────────────────────────────────────────────
ticketlens standup                            # Standup summary for last 24 hours
ticketlens standup --since=48                 # Last 48 hours
ticketlens standup --since=yesterday          # Git date string
ticketlens standup --format=pr               # PR body: "What changed" + commit list
ticketlens standup --profile=myteam          # Enrich with Jira ticket summaries
ticketlens standup --plain | pbcopy          # Copy to clipboard
ticketlens standup --help                    # Standup subcommand help

# ── Cache management ──────────────────────────────────────────────────────────
ticketlens cache                              # Overview + subcommand hints
ticketlens cache --help                       # Detailed help
ticketlens cache size                         # Disk usage by profile and ticket
ticketlens cache size --profile=acme          # Filter to one profile only
ticketlens cache clear                        # Interactive picker (TTY)
ticketlens clear                              # Alias for cache clear
ticketlens cache clear CNV1-2                # Clear one ticket's cache
ticketlens cache clear --older-than=7d        # Files older than 7 days
ticketlens cache clear --older-than=1m        # Files older than 1 month
ticketlens cache clear --older-than=1y        # Files older than 1 year
ticketlens cache clear --profile=acme         # Only one profile's files
ticketlens cache clear CNV1-2 --older-than=7d            # Ticket + age filter
ticketlens cache clear --profile=acme --older-than=30d   # Profile + age filter
ticketlens cache clear --older-than=30d --yes            # Skip confirmation (CI/scripts)

# ── Schedule ─────────────────────────────────────────────────────────────────
ticketlens schedule                           # Interactive wizard — set time, timezone, profile [Pro]
ticketlens schedule --stop                    # Cancel the scheduled digest [Pro]
ticketlens schedule --status                  # Show current schedule [Pro]
ticketlens schedule --local --time=07:00 --save=./triage.txt  # Local-only cron/LaunchAgent, no Console auth [Pro]

# ── History ───────────────────────────────────────────────────────────────────
ticketlens history <TICKET-KEY>               # Show urgency timeline for a ticket [Pro]

# ── Recall ────────────────────────────────────────────────────────────────────
echo "note body" | ticketlens note add --title="..." --ticket=CNV1-2 --tags=a,b  # Save a note [Pro]
ticketlens note delete --id="..." --ticket=CNV1-2  # Remove a note from your local vault [Pro]
ticketlens recall CNV1-2                      # Search saved notes by ticket key [Pro]
ticketlens recall "retry backoff"             # Free-text search across all notes [Pro]
ticketlens recall sync                        # Retry any notes stuck in the local queue [Team+]
ticketlens recall settings                    # Show effective retry-queue settings, fetched live [Team+]
ticketlens mcp                                # Start the MCP stdio server (recall/ticket write tools) [Pro]
ticketlens mcp install                        # Register it into the current project's .mcp.json
ticketlens mcp install --dry-run              # Preview the registration without writing

# ── Comment, Transition, Assign, Duplicates, Link, Update & Create ──────────────
ticketlens comment CNV1-2 --body="Looks good, merging."     # Post a comment to the tracker [Pro]
ticketlens comment CNV1-2 --body="See screenshot" --attach=./bug.png  # Attach local files [Pro]
ticketlens transition CNV1-2                                # List valid transitions (read-only) [Pro]
ticketlens transition CNV1-2 --target="Done" --confirm      # Execute the transition [Pro]
ticketlens assign CNV1-2 --to=me                            # Assign the ticket to yourself [Pro]
ticketlens duplicates CNV1-2                                # Find likely duplicates (read-only) [Pro]
ticketlens duplicates CNV1-2 --threshold=0.5                # Tighten the match threshold [Pro]
ticketlens link CNV1-2 CNV1-3                               # List valid link types (read-only) [Pro]
ticketlens link CNV1-2 CNV1-3 --type="Duplicate" --confirm  # Execute the link [Pro]
ticketlens update CNV1-2 --title="New title"                # Update title/description/labels/priority [Pro]
ticketlens update CNV1-2 --add-labels=urgent --remove-labels=stale  # Add/remove labels [Pro]
ticketlens create --project=CNV1 --type="Task" --summary="New ticket"  # Create a new ticket [Pro]
ticketlens create --project=ENG --summary="New issue" --profile=linear-team  # Create on a different profile [Pro]
ticketlens create --project=CNV1 --type="Bug" --summary="Broken layout" --attach=./screenshot.png  # Create with an attachment [Pro]

# ── Stats ──────────────────────────────────────────────────────────────────────
ticketlens stats                              # Response-time metrics from local history
ticketlens stats --profile=acme              # Metrics for a specific profile
ticketlens stats --days=14                   # Extend lookback window (Pro, max 30)
ticketlens stats --format=json               # JSON output for scripting

# ── Issue Types ───────────────────────────────────────────────────────────────
ticketlens issue-types                        # Pre-fetch/cache the active profile's projects + Jira issue types
ticketlens issue-types --profile=acme        # Target a specific profile
ticketlens issue-types --refresh             # Force a live fetch, bypassing the cache
ticketlens issue-types --format=json         # JSON output for scripting

# ── Doctor ────────────────────────────────────────────────────────────────────
ticketlens doctor                             # Diagnose profile/license/connectivity/cache/MCP-registration/queue problems
ticketlens doctor --fix                       # Attempt safe automatic fixes
ticketlens doctor --profile=acme             # Scope checks to a single profile
ticketlens doctor --format=json               # JSON output for scripting/piping
ticketlens doctor --mcp                       # Also check the MCP server handshake (spawns a subprocess)

# ── Compliance ────────────────────────────────────────────────────────────────
ticketlens compliance <TICKET-KEY>            # Check ticket requirements against local diff [Pro/Free 3/mo]
ticketlens ledger                             # View local compliance audit ledger [Pro]
ticketlens install-hooks                      # Install pre-push compliance gate
ticketlens install-hooks --uninstall          # Remove installed hooks

# ── PR Description ─────────────────────────────────────────────────────────────
ticketlens pr <TICKET-KEY>                    # Generate PR description from ticket
ticketlens pr <TICKET-KEY> | pbcopy          # Copy to clipboard

# ── AI provider keys (BYOK) ───────────────────────────────────────────────────
ticketlens cloud-keys list                            # List configured AI providers
ticketlens cloud-keys add groq gsk_xxxx               # Add Groq key (free tier)
ticketlens cloud-keys add anthropic sk-ant-xxxx       # Add Anthropic key
ticketlens cloud-keys add openai sk-xxxx              # Add OpenAI key
ticketlens cloud-keys add groq gsk_xxxx --timeout=10  # Add with custom timeout
ticketlens cloud-keys test groq                       # Test a provider key
ticketlens cloud-keys remove groq                     # Remove a provider
ticketlens cloud-keys priority groq 1                 # Set provider priority
ticketlens cloud-keys timeout anthropic 15            # Set per-request timeout
ticketlens cloud-keys --help                          # Subcommand help

# ── Login ─────────────────────────────────────────────────────────────────────
ticketlens login                              # Browser flow — opens Console, token saved automatically
ticketlens login --manual                     # Paste flow — for CI/headless environments
ticketlens logout                             # Revoke and remove stored CLI token
ticketlens sync                               # Pull tracker profiles from the Console

# ── License and account ────────────────────────────────────────────────────────
ticketlens license                            # Show license tier and status
ticketlens activate <LICENSE-KEY>             # Activate a license key

# ── Skill maintenance ─────────────────────────────────────────────────────────
ticketlens update-skill                       # Sync /jtb skill to all detected AI assistants
ticketlens update-skill --dry-run             # Preview what would be updated
ticketlens update-skill --path=~/.gemini/commands  # Sync to a custom assistant directory

# ── Help and version ──────────────────────────────────────────────────────────
ticketlens --help                             # Main help
ticketlens --version                          # Show installed version
ticketlens CNV1-2 --help                     # Fetch subcommand help
ticketlens triage --help                      # Triage subcommand help
ticketlens review --help                      # Review subcommand help
ticketlens cache --help                       # Cache overview help
ticketlens cache size --help                  # Cache size help
ticketlens cache clear --help                 # Cache clear help
```

---

## Pro & Teams Features

Start free, upgrade when you need it — `ticketlens activate <key>`

### Pro — $9/mo

<div align="center">
  <img src="docs/demos/pro-triage.gif" alt="ticketlens --summarize AI summary demo" width="700" />
</div>

```bash
ticketlens CNV1-2 --summarize            # AI summary via your own API key (BYOK)
ticketlens CNV1-2 --summarize --cloud    # AI summary via TicketLens API (no local key needed)
ticketlens CNV1-2 --handoff              # AI handoff brief from the ticket's comment thread (BYOK)
ticketlens CNV1-2 --handoff --cloud      # AI handoff brief via TicketLens API
ticketlens CNV1-2 --compliance           # Check ticket requirements against local diff [Pro/Free 3/mo]
ticketlens triage --digest               # POST scored triage results to digest endpoint
ticketlens schedule                      # Set up a scheduled daily digest
ticketlens note add --title="..."        # Save a Recall note (body from stdin)
ticketlens note delete --id="..."        # Remove a note from your local vault
ticketlens recall <query|TICKET-KEY>     # Search your saved Recall notes
ticketlens recall sync                   # Retry any notes stuck in the local queue
ticketlens recall settings               # Show effective retry-queue settings, fetched live
ticketlens mcp                           # Start the MCP stdio server (recall/ticket write tools)
ticketlens comment CNV1-2 --body="..."   # Post a comment to the tracker
ticketlens comment CNV1-2 --body="..." --attach=./bug.png  # Attach local files (comment/create only)
ticketlens transition CNV1-2 --target="Done" --confirm  # Transition ticket status
ticketlens assign CNV1-2 --to=me         # Assign the ticket to yourself
ticketlens duplicates CNV1-2             # Find likely duplicates (read-only)
ticketlens link CNV1-2 CNV1-3 --type="Duplicate" --confirm  # Link two tickets
ticketlens update CNV1-2 --title="..."   # Update title/description/labels/priority
ticketlens create --project=CNV1 --type="Task" --summary="..."  # Create a new ticket
ticketlens activate YOUR-LICENSE-KEY     # Activate Pro license
```

**`--summarize`** generates a 3-sentence AI summary of the ticket. The AI receives the full ticket context: description, comments, linked Confluence pages, and any text-readable attachments. The summary is cached alongside the brief (same 4h TTL) — repeat runs return instantly from cache. Use `--no-cache` to force a fresh AI call.

**`--handoff`** synthesizes the ticket into a structured one-pager for the developer picking up the work. The AI receives the same full context and returns:

- **What was attempted** — concrete work already done
- **Current blockers** — unresolved issues
- **Open questions** — decisions not yet made
- **Recommendation** — where to start

**What the AI can read:**

| Content | Included |
|---|---|
| Description | ✅ Always |
| Comments | ✅ Always |
| Linked Confluence pages | ✅ Jira only, same-origin |
| Text files (`.txt`, `.md`, `.log`, `.csv`, `.json`, `.yaml`, etc.) | ✅ Up to 4 KB per file, 12 KB total |
| Screenshots (`.png`, `.jpg`, `.gif`, etc.) | ❌ Binary — images require multimodal API |
| PDFs | ❌ Binary — no parser included (zero-dependency) |
| Office documents (`.docx`, `.xlsx`) | ❌ Binary — no parser included |

Add your AI provider keys once via `cloud-keys` — they're stored encrypted on your account and used automatically:

```bash
ticketlens cloud-keys add groq gsk_xxxx          # Groq (Llama 3.x — free tier)
ticketlens cloud-keys add anthropic sk-ant-xxxx  # Anthropic Claude
ticketlens cloud-keys add openai sk-xxxx         # OpenAI GPT-4o mini
ticketlens cloud-keys list                       # See configured providers
ticketlens cloud-keys test groq                  # Verify a key works
ticketlens cloud-keys remove groq                # Remove a provider
```

Or use `--cloud` to route through the TicketLens API without managing keys yourself.

| Provider | Cost | Sign up |
|---|---|---|
| Groq (Llama 3.x) | **Free tier** | [console.groq.com](https://console.groq.com) |
| Anthropic (Claude) | Paid | console.anthropic.com |
| OpenAI (GPT-4o mini) | Paid | platform.openai.com |

**Provider priority:** Providers are tried in the order you configure them. To set a default fallback order:

```bash
ticketlens cloud-keys priority groq 1        # try Groq first
ticketlens cloud-keys priority anthropic 2   # Anthropic second
```

Override per-command with `--provider=`:

```bash
ticketlens CNV1-2 --summarize --provider=groq
ticketlens CNV1-2 --handoff --provider=openai
```

Or manage keys in **Console → Admin → AI Settings**.

<div align="center">
  <img src="docs/demos/pro-triage.gif" alt="ticketlens triage --stale=3 demo" width="700" />
</div>

Pro also unlocks configurable brief cache TTL per profile — set `cacheTtl` to `4h`, `1d`, `7d`, `30d`, or `0` (disable) via `ticketlens config`. Free tier is fixed at 4h.

### Team — $19/seat/mo

<div align="center">
  <img src="docs/demos/teams-digest.gif" alt="ticketlens triage --plain digest pipeline demo" width="700" />
</div>

```bash
ticketlens triage --assignee="Jane Dev"        # View another dev's tickets
ticketlens triage --sprint="Sprint 12"         # Filter by sprint name
ticketlens triage --project=MYPROJ             # Scope to a Jira project key
ticketlens triage --label=Bug,P1               # Filter by label(s)
ticketlens triage --priority=High              # Filter by priority level
ticketlens triage --export=csv                 # Export triage to CSV for standups and reports
ticketlens triage --export=json                # Machine-readable export for dashboards
ticketlens triage --push                       # Push snapshot to the Console queue
ticketlens triage --share                      # Generate a 24h share URL — paste into Slack, no login needed for recipients
```

`--push` syncs the scored snapshot to the TicketLens Console after each triage run. The queue page at `/console/queue` shows the latest snapshot for every team profile — no manual refresh needed. Unlike the terminal view, the pushed snapshot includes every assigned ticket except ones excluded by a local `ignore` custom rule — so a manager's Console-configured priority-based notify/schedule rule can match a ticket you're actively working on, not just stale or awaiting-response ones.

`--share` generates a signed URL valid for 24 hours. Recipients open it in any browser — no account, no install. The asymmetry is the product: you run one command, everyone sees the same snapshot.

Automate a morning digest with cron — no open terminal required:

```bash
0 9 * * 1-5 ticketlens triage --plain > ~/digest-$(date +%F).md
```

Multi-profile team workflows: each teammate runs `ticketlens init` with their own credentials; shared `ticketPrefixes` auto-route tickets to the right Jira instance.

---

## Multi-Profile Setup

Profiles live in `~/.ticketlens/profiles.json`:

```json
{
  "profiles": {
    "myteam": {
      "baseUrl": "https://myteam.atlassian.net",
      "auth": "cloud",
      "email": "you@myteam.com",
      "ticketPrefixes": ["PROJ", "OPS"],
      "projectPaths": ["~/projects/myteam-app"],
      "triageStatuses": ["In Progress", "Code Review", "QA Testing"]
    },
    "client": {
      "baseUrl": "https://jira.client.com",
      "auth": "server",
      "email": "yourname",
      "ticketPrefixes": ["ACME", "SHOP"],
      "projectPaths": ["~/projects/client-app"],
      "triageStatuses": ["In Progress", "In Development", "QA"]
    }
  }
}
```

Credentials in `~/.ticketlens/credentials.json` (chmod 600):

```json
{
  "myteam": { "apiToken": "your-atlassian-api-token" },
  "client":  { "pat": "your-jira-server-pat" }
}
```

**Profile resolution order:**

| Priority | Method | Example |
|----------|--------|---------|
| 1 | `--profile=NAME` flag | `ticketlens CNV1-2 --profile=client` |
| 2 | Ticket prefix match | `ticketlens CNV1-2` → prefix `PROJ` → `myteam` |
| 3 | Project path match | `triage` in `~/projects/myteam-app` → `myteam` |
| 4 | `config.default` field | Explicit default set via `ticketlens switch` |
| 5 | First profile in file | Fallback when `config.default` is absent |
| 6 | Environment variables | `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN` / `JIRA_PAT` |

---

## Running Tests

```bash
npm test
```

---

## Roadmap

See [ROADMAP.md](ROADMAP.md) for the full plan.

Recently shipped:
- **Prefix & status pickers** (`ticketlens init` / `config`, v0.12.0) — ticket prefixes and triage statuses are picked from your Jira instance's live project/status lists via multi-select; editing pre-selects current values, unchecking removes them, and stale entries are flagged `(not on server)`
- **Collision detection** (`ticketlens collisions`) — shows which files your branch shares with teammates' in-flight branches; `--push` auto-sends git branch data to the team snapshot. Team tier
- **Shareable triage snapshot** (`ticketlens triage --share`) — generates a 24h signed URL; recipients open it in any browser, no account needed. Team tier
- **Compliance push** (`ticketlens triage --push`) — enriches the team snapshot with per-ticket compliance status and coverage from the local ledger. Pro tier
- **"TicketLens for PRs"** (`ticketlens review`) — assembles a code-review context brief from your current branch: linked tickets, changed files, and ticket context in one brief
- **Confluence pages** — linked Confluence pages fetched automatically and included in the brief; origin-validated, non-fatal, capped at 10 pages
- **Linear support** — `ticketlens init` → Linear; connects via GraphQL API key, fetches tickets, triage, and statuses
- **GitHub Issues support** — `ticketlens init` → GitHub Issues; PAT-based, same normalized ticket shape

---

## Contributing

Bug reports and feature requests welcome — open an issue on [GitHub](https://github.com/ralphmoran/ticket-lens/issues). For larger changes, open an issue first to discuss.

---

## License

[MIT](LICENSE) © Ralph Moran
