# TicketLens

Developer toolkit that minimizes research time before implementation. Fetches Jira ticket context, linked issues, comments, and code references — then maps them to your local codebase.

## Quick Start

```bash
npm install -g ticketlens
ticketlens init          # Configure your Jira connection (guided wizard)
ticketlens PROJ-123      # Fetch a ticket brief
ticketlens triage        # Scan your assigned tickets
```

Or without installing:

```bash
npx ticketlens init
npx ticketlens PROJ-123
```

## Skills

### ticketlens init — Setup wizard

Interactive wizard that configures your Jira connection. Run this first.

```bash
ticketlens init
```

The wizard walks you through each step:

1. **Profile name** — short identifier: `work`, `acme`, `client`
2. **Jira URL** — suggestions based on your profile name are offered (e.g. `https://acme.atlassian.net` or `https://jira.acme.com`). Pick one or type your own. Bare hostnames (`jira.company.com`) are accepted — `https://` is probed first, then `http://`.
3. **Auth type** — auto-detected from your URL:
   - `*.atlassian.net` → Jira Cloud (email + API token, no prompt needed)
   - Any other URL → choose between PAT (Server/DC 8.14+) or Basic (username + password)
4. **Credentials** — email/username and token/password (masked input). Pre-populated on retry so you only fix what's wrong.
5. **Connection test** — live test with spinner; shows `● Connected` on success or a classified error with hints on failure. On failure, an arrow-key menu offers: **Retry** (VPN just connected), **Edit credentials** (token typo), **Edit from URL** (wrong URL), **Skip**.
6. **Optional settings** — skip any with Enter:
   - **Ticket prefixes** — e.g. `PROJ,OPS` — auto-routes `PROJ-123` to this profile
   - **Project paths** — e.g. `~/projects/myapp` — auto-activates this profile when working in that directory. Missing directories are offered for creation.
   - **Triage statuses** — Jira statuses to scan (default: `In Progress, Code Review, QA`). Validated live against your Jira instance — case mismatches are auto-corrected.
7. **Add another?** — repeat for each Jira instance
8. **Select active profile** — arrow-key panel if you configured more than one
9. **Quick start panel** — command reference shown on completion

Config is written to `~/.ticketlens/profiles.json` and `credentials.json` (chmod 600). Profiles are only saved on a successful connection test.

### ticketlens switch — Switch active profile

Switch between configured Jira connections without re-running init.

```bash
ticketlens switch
```

### ticketlens config — Edit profile settings

Edit any setting on an existing profile — connection details or optional fields — without re-running the full wizard.

```bash
ticketlens config                    # Edit the default profile
ticketlens config --profile=acme     # Edit a named profile
```

Every field is pre-populated with its current value. Press `Enter` to keep it unchanged.

**Connection section** (URL, auth type, email, token):
- URL accepts bare hostnames — `jira.company.com` is auto-prefixed with `https://`
- Auth type shows a selector pre-positioned on the current value
- Token shows `[keep existing]` — Enter keeps the stored credential
- Any change triggers a live connection test with the same retry options as `ticketlens init` (Retry / Edit credentials / Edit from URL / Skip)

**Optional section** (ticket prefixes, project paths, triage statuses):
- Triage statuses use **merge semantics** — typing new statuses *adds* them to the current list rather than replacing it. Partial matching applies: `QA` → `QA Testing`. Existing valid statuses are never removed by this prompt.

### /jtb — Jira TicketBrief

Fetches a Jira ticket's full context and assembles a structured brief for implementation planning.

```
/jtb TICKET-KEY              # Fetch ticket + linked tickets
/jtb TICKET-KEY --depth=0    # Target ticket only (fast)
```

### ticketlens triage — Ticket attention scanner

Scans your assigned tickets and surfaces what needs attention.

```bash
ticketlens triage                        # Auto-detect profile from project path
ticketlens triage --stale=3              # Custom aging threshold (days, default: 5)
ticketlens triage --status=CR,QA         # Only check specific statuses
ticketlens triage --profile=acme         # Explicit profile override
```

Categorizes tickets as:
- **Needs response** — someone commented after you (reviewer, QA, PM waiting for reply)
- **Aging** — no activity for N+ days

In interactive mode (default on TTY):
- `↑/↓` navigate · `Enter` open in browser · `p` switch profile · `q/Esc` exit

**Status mismatch auto-fix:** If your configured statuses don't match Jira's (e.g. case difference: `"In progress"` vs `"In Progress"`), triage shows the diff and offers to update your profile automatically:

```
  ~ In progress  →  In Progress
  ~ QA           →  QA Testing

  Update "myprofile" with corrected statuses?  y/N
```

Confirming rewrites `triageStatuses` in your profile and reruns triage immediately.

See [skills/jtb/README.md](skills/jtb/README.md) for full setup and usage docs.

## Architecture

- Zero npm dependencies — Node.js built-ins only
- Supports Jira Cloud and Jira Server/Data Center
- VCS-agnostic: Git, SVN, Mercurial
- All modules TDD with `node:test` + `node:assert`

## Running Tests

```bash
node --test skills/jtb/scripts/test/*.test.mjs
```

## Roadmap

See [ROADMAP.md](ROADMAP.md) for the full iteration plan.

**Iteration 3 — Complete:**
- ✅ Jira Cloud v3 API migration
- ✅ npm package (`ticketlens`)
- ✅ CLI UX polish — session banner, spinner, error classifier, interactive triage navigator, profile picker
- ✅ `ticketlens init` — guided setup wizard with URL suggestions, auth auto-detection, optional fields, live status validation, connection retry menu (Retry / Edit credentials / Edit from URL / Skip), pre-populated fields on retry
- ✅ Auto HTTP/HTTPS detection — bare hostnames auto-probed (`https://` first, then `http://`)
- ✅ `ticketlens switch` — titled panel profile switcher
- ✅ Triage status mismatch auto-fix — case-insensitive + partial matching + interactive profile update
- ✅ `p` hotkey during triage to switch profiles mid-session
- ✅ `ticketlens config` — full profile editor: URL, auth type, email, token (with connection test + retry), ticket prefixes, project paths, triage statuses (merge semantics + partial matching)

**Iteration 3.5 — Next:**
- README GIF demos (ticket fetch, triage scan)
- CI badge
- `--assignee` and `--sprint` flags (Team tier preview)
- Public launch: HN, Reddit, Dev.to

**Coming soon:**
- Compliance Check — compare ticket requirements against shipped code (primary Pro conversion lever)
- Multi-project triage, custom attention rules, scheduled triage (Pro tier)
- TicketLens Cloud — E2EE sync, web dashboard, Slack/Teams alerts (Phase C)
- GitHub Issues and Linear as ticket sources (Phase D)

## Known Issues

None at this time. Previous issues resolved:
- ~~Jira Cloud v2 API deprecation (410 Gone)~~ — Fixed in v3 API migration. Cloud profiles now auto-select `/rest/api/3/search/jql`.
