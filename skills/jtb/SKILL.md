<!-- jtb-skill-version: 0.9.18 -->
---
name: jtb
description: Fetch a Jira ticket's full context (description, comments, linked issues, code references) and assemble a structured TicketBrief for implementation planning. Use when user types /jtb, mentions a Jira ticket key, or wants to plan work from a Jira ticket.
---

# Jira TicketBrief

Fetches a Jira ticket and produces a structured brief with code references, then enters plan mode.

## Quick Start

```
/jtb PROD-1234                          # fetch a ticket brief
/jtb PROD-1234 --depth=0               # target ticket only (fast)
/jtb PROD-1234 --depth=2               # include linked-of-linked tickets
/jtb PROD-1234 --profile=acme          # force a specific connection profile
/jtb PROD-1234 --no-cache              # re-fetch from Jira (bypass local cache)
/jtb PROD-1234 --no-attachments        # skip attachment download
/jtb PROD-1234 --plain                 # plain text output (no ANSI colours)
/jtb PROD-1234 --check                 # coverage review: ACs vs local diff
/jtb PROD-1234 --compliance            # formal compliance check (tier-gated)
/jtb PROD-1234 --summarize             # AI summary of the brief (Pro)
/jtb PROD-1234 --summarize --cloud     # summary via TicketLens cloud (Pro)
/jtb PROD-1234 --handoff               # structured handoff brief from comments (Pro)
/jtb PROD-1234 --template=quick        # apply quick template (meta + 2 comments only)
/jtb PROD-1234 --template=code-review  # apply code-review template (meta + desc + linked + code refs)
/jtb PROD-1234 --template=full         # apply full template (all sections, default)
/jtb triage                            # scan your assigned tickets for attention
/jtb triage --stale=3                  # custom aging threshold (days)
/jtb triage --status=CR,QA             # only check specific statuses
/jtb triage --profile=acme             # explicit profile override
/jtb triage --all                      # triage all configured profiles at once, merged (Pro)
/jtb triage --save=~/triage.txt        # save ANSI-stripped output to file (Pro)
/jtb triage --project=MYPROJ           # scope to a Jira project key (Team)
/jtb triage --label=Bug,P1             # filter by label(s) (Team)
/jtb triage --priority=High            # filter by priority level (Team)
/jtb triage --push                     # push snapshot + git branches to Console (Team)
/jtb triage --share                    # generate 24h share URL (Team)
/jtb history PROD-1234                 # show urgency timeline for a ticket (Pro)
/jtb stats                             # personal response-time metrics from local history
/jtb stats --days=14                   # extend lookback window (Pro, max 30)
/jtb stats --format=json               # JSON output for scripting
/jtb collisions                        # show branch collisions with teammates (Team)
/jtb collisions --json                 # machine-readable output
/jtb cloud-keys list                   # list configured AI provider keys (Pro)
/jtb cloud-keys add groq gsk_xxxx      # add Groq key (free tier — console.groq.com)
/jtb cloud-keys add anthropic sk-ant-x # add Anthropic key
/jtb cloud-keys add openai sk-xxxx     # add OpenAI key
/jtb cloud-keys test groq              # verify a provider key works
/jtb cloud-keys remove groq            # remove a provider
/jtb cloud-keys priority groq 1        # set provider priority (lower = tried first)
/jtb cloud-keys timeout anthropic 15   # set per-request timeout in seconds
```

## Prerequisites

TicketLens supports two connection methods — check in this order:

**1. Profile config (recommended):** If `~/.ticketlens/profiles.json` exists, no env vars
are needed. Profile resolution is automatic (by ticket prefix, project path, or `--profile`).
Setup via `ticketlens init`.

**2. Env var fallback:** If no profile config exists, these must be set:
- `JIRA_BASE_URL` — e.g. `https://yourteam.atlassian.net`
- **Cloud:** `JIRA_EMAIL` + `JIRA_API_TOKEN`
- **Server/DC:** `JIRA_PAT`

If neither profiles nor env vars are configured, tell the user:
"No Jira connection found. Run `ticketlens init` to set up your connection,
or set JIRA_BASE_URL + auth credentials as environment variables."

## Workflow

### Triage subcommand

If the first argument is `triage`:

Run:
```bash
node ~/.agents/skills/jtb/scripts/fetch-my-tickets.mjs $EXTRA_ARGS
```

Where `$EXTRA_ARGS` are any flags passed (e.g. `--stale=3 --status=QA --profile=acme`).

**Urgency levels** (highest → lowest priority):
- 🔴 `needs-response` — someone commented and you haven't replied
- 🟡 `aging` — no activity for ≥ `staleDays` (default 5d)
- 🔵 `stale` — ticket stuck in the same Jira status for ≥ N days (Pro — requires a stale rule configured in the Console)
- 🟢 `clear` — up to date, no action needed

**IMPORTANT:** Copy the script's stdout and display it directly as your response text (not inside a tool result). This ensures the markdown table renders visibly and URLs are clickable in the terminal. No VCS enrichment, no plan mode. Stop here.

---

### Collisions subcommand

If the first argument is `collisions`:

Run:
```bash
node ~/.agents/skills/jtb/scripts/lib/run-collisions.mjs $EXTRA_ARGS
```

Where `$EXTRA_ARGS` are any flags passed (e.g. `--json`, `--plain`).

Requires a Team license and at least one teammate in the same group. Compares your current branch's changed files against teammates' recent branches. Outputs a collision report or an empty-state message.

Display the script's stdout directly. No plan mode. Stop here.

---

### Fetch ticket workflow (default)

### Step 1: Validate environment

Follow the Prerequisites section above:
- If `~/.ticketlens/profiles.json` exists → proceed to Step 2. No env vars needed.
- If no profile exists → check `JIRA_BASE_URL` and auth vars. If missing, list them and stop.
- If neither is configured → tell the user: "No Jira connection found. Run `ticketlens init` to set up your connection, or set `JIRA_BASE_URL` + auth credentials as environment variables."

### Step 2: Fetch the ticket

Run:
```bash
node ~/.agents/skills/jtb/scripts/fetch-ticket.mjs "$TICKET_KEY" $EXTRA_ARGS
```

Where `$TICKET_KEY` is the first argument (e.g. `PROD-1234`) and `$EXTRA_ARGS` are any flags passed (e.g. `--depth=0`).

The script outputs a structured markdown TicketBrief to stdout. If it fails (exit code 1), show the stderr message to the user.

### Step 2b: Read attached files

Check if the TicketBrief contains an `## Attachments` section. If it does, for each line containing a backtick-quoted absolute path, call the Read tool on that path based on file type:

- **Images** (`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.svg`): Read it — Claude receives it as multimodal visual context.
- **PDFs** (`.pdf`): Read it — Claude receives the extracted text content.
- **Text files** (`.txt`, `.csv`, `.md`, `.log`): Read it — Claude receives the raw text.
- **Other files** (`.zip`, `.docx`, `.xlsx`, etc.): Note they exist at the listed path but do not attempt to read them.

Read all eligible files before proceeding. Do not describe images unprompted — hold them in context for Step 5.

If there is no `## Attachments` section, skip this step.

---

### Step 3: Detect VCS and enrich

Detect the VCS in the current working directory and run enrichment commands:

**Git:**
```bash
git log --all --grep="$TICKET_KEY" --oneline --max-count=20
git branch -a | grep "$TICKET_KEY"
```

**SVN:**
```bash
svn log --limit 50 | grep -A5 "$TICKET_KEY"
svn ls ^/branches | grep "$TICKET_KEY"
```

**Hg:**
```bash
hg log -k "$TICKET_KEY" --limit 20
hg branches | grep "$TICKET_KEY"
```

If no VCS is detected, skip this step.

### Step 4: Resolve code references

From the TicketBrief output, look at the **Code References** section:

- For each **file path**: use Glob to check if it exists in the current repo
- For each **class name**: use Grep to find its definition (`class ClassName`)
- For each **branch**: note if it was found in step 3
- For each **SHA/revision**: note if it appeared in the VCS log

### Step 5: Plan the implementation

Enter plan mode with all gathered context:
- The TicketBrief markdown
- VCS commits and branches related to the ticket
- Which referenced files/classes exist locally
- Linked ticket summaries and their comments

Present a clear implementation plan for the user to approve.

---

## --check: Acceptance Criteria Coverage Review

When `--check` is appended to any ticket fetch (`/jtb PROJ-123 --check`):

### With VCS (git/svn/hg detected)
1. The brief includes a `--- DIFF ---` section with the current local diff
2. After reading the brief, evaluate coverage:
   - Identify acceptance criteria from the ticket description and comments
   - For each AC, check whether the diff addresses it
   - Report: ✔ FOUND (with file:line reference) or ✗ NOT FOUND
   - Show: `Coverage: N/M (X%) — N items outstanding`

### Without VCS (no git/svn/hg in cwd)
Use this evaluation order:
1. **Session context** — review files you Read/Edited this session; compare against ACs
2. **claude-mem** — if available, call `get_observations` searching for `{ticketKey}` to find prior session work
3. **context7** — if available, validate that changed files use correct library/framework APIs
4. **fs.stat() fallback** — read files modified in the last 4 hours in cwd; compare against ACs
5. **Manual checklist** — if none of the above apply, list the ACs for the developer to review manually

### Privacy
`--check` never sends data anywhere. The diff stays local. Claude Code provides the intelligence using its existing session context.

---

## --compliance: Formal Compliance Check

When `--compliance` is appended to any ticket fetch (`/jtb PROJ-123 --compliance`):

**Tier gate:** Free tier allows 3 compliance checks per month. Pro tier is unlimited.
If the user is on Free and has exhausted their quota, show the upgrade prompt returned by the script and stop.

### With VCS (git/svn/hg detected)
1. The brief includes a `--- DIFF ---` section with the current local diff
2. After reading the brief, evaluate each requirement formally:
   - Extract every stated requirement, acceptance criterion, and definition-of-done item from the ticket description and all comments
   - For each requirement, assess whether the diff satisfies it:
     - `✔ COMPLIANT` — fully addressed, cite file:line
     - `✖ NON-COMPLIANT` — not addressed at all
     - `~ PARTIAL` — partially addressed, describe the gap
   - Show a compliance summary: `Compliance: N/M (X%) — N items non-compliant, N partial`
   - List all non-compliant and partial items with actionable notes

### Without VCS (no git/svn/hg in cwd)
Use this evaluation order:
1. **Session context** — review files you Read/Edited this session; compare against requirements
2. **claude-mem** — if available, call `get_observations` searching for `{ticketKey}`
3. **Manual checklist** — list each requirement for the developer to verify manually

### Privacy
`--compliance` never sends data anywhere. The diff stays local. All analysis is performed by Claude Code within your session context.

---

## Advanced Options

These flags are available on any ticket fetch and can be combined.

### --summarize (Pro)

Generates an AI-powered summary of the full brief, collapsing verbose descriptions into a concise implementation overview. Useful for large tickets with many comments.

```
/jtb PROD-1234 --summarize             # BYOK — uses your own API key
/jtb PROD-1234 --summarize --cloud     # uses TicketLens cloud summariser
/jtb PROD-1234 --summarize --provider=openai   # use a specific AI provider
/jtb PROD-1234 --summarize --budget=2000       # limit output to ~2000 tokens
```

- **BYOK (default):** reads your AI API key from `~/.ticketlens/credentials.json`. First use will prompt for consent.
- **`--cloud`:** routes through TicketLens cloud API (no local key needed, requires Pro).
- **`--provider=NAME`:** override the AI provider. Supported values depend on your credentials (e.g. `claude`, `openai`).
- **`--budget=N`:** prune the brief to approximately N tokens before summarising. Forces plain-text output.

### --handoff (Pro)

Generates a structured handoff brief synthesised from the ticket's full comment thread. Designed for developer-to-developer handoffs — includes open questions, current state, and next steps.

```
/jtb PROD-1234 --handoff
/jtb PROD-1234 --handoff --cloud
```

Output is a concise markdown document, not a full TicketBrief. No plan mode — output is displayed and the workflow stops.

### triage --push compliance enrichment (Pro)

When `--push` is run by a Pro-licensed user, the local compliance ledger (written by `--compliance` runs) is read and merged into the snapshot before sending. Each ticket's `compliance_status` (`pass`/`gap`) and `compliance_coverage` (%) are included in the push payload. This feeds the **Compliance Analytics** dashboard in the Console (`/console/admin/compliance-analytics`), which shows gap-rate trends by project, ticket status, and week.

Non-Pro users push with `compliance_status: unknown` — no data is lost, and the analytics page simply shows no compliance data for those snapshots.

### --plain / --styled

Control output formatting:

- **`--plain`** — strip all ANSI colour codes. Useful when piping to a file or another tool.
- **`--styled`** — force ANSI-styled output even in non-TTY contexts (e.g. when piped).

Default: styled when stdout is a TTY, plain otherwise.

### --no-cache

Forces a fresh fetch from Jira, bypassing the local brief cache (4-hour TTL by default). Use when the ticket was recently updated and the cached brief is stale.

### --no-attachments

Skip downloading and reading ticket attachments. Speeds up the fetch for tickets with large or irrelevant file attachments.
