# TicketLens

Developer toolkit that minimizes research time before implementation. Fetches Jira ticket context, linked issues, comments, and code references — then maps them to your local codebase.

## Quick Start

```bash
npx ticketlens PROJ-123                # Fetch ticket brief
npx ticketlens PROJ-123 --depth=0      # Target ticket only (fast)
npx ticketlens triage                   # Scan your assigned tickets
npx ticketlens triage --profile=myteam  # Explicit profile
```

Or install globally:

```bash
npm install -g ticketlens
ticketlens PROJ-123
ticketlens triage --stale=3
```

## Skills

### /jtb — Jira TicketBrief

Fetches a Jira ticket's full context and assembles a structured brief for implementation planning.

```
/jtb TICKET-KEY              # Fetch ticket + linked tickets
/jtb TICKET-KEY --depth=0    # Target ticket only (fast)
```

### /jtb triage — Ticket Attention Scanner

Scans your assigned tickets and surfaces what needs attention — unread comments, CR/QA feedback, aging tickets.

```
/jtb triage                          # Auto-detect profile from project path
/jtb triage --stale=3                # Custom aging threshold (days, default: 5)
/jtb triage --status=CR,QA           # Only check specific statuses
/jtb triage --profile=acme         # Explicit profile override
```

See [skills/jtb/README.md](skills/jtb/README.md) for setup and usage.

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

See [ROADMAP.md](ROADMAP.md) for the full iteration plan (45 features across 10 iterations).

**Next up (Iteration 3):**
- ~~Jira Cloud v3 API migration~~ (done)
- ~~npm package (`ticketlens`) for easy global install~~ (done)
- Polished README with demo GIFs

**Coming soon:**
- GitHub Issues and Linear as ticket sources
- Confluence/wiki page fetching
- **Compliance Check** — compare ticket requirements against shipped code
- **TicketLens Cloud** — E2EE cloud sync across machines
- **Team Dashboard** — ticket health, bottlenecks, workload visibility
- **Slack/Teams Alerts** — actionable notifications
- **IDE Plugins** — VS Code, JetBrains, Neovim

## Known Issues

None at this time. Previous issues resolved:
- ~~Jira Cloud v2 API deprecation (410 Gone)~~ — Fixed in v3 API migration. Cloud profiles now auto-select `/rest/api/3/search/jql`.
