# TicketLens

Developer toolkit that minimizes research time before implementation. Fetches Jira ticket context, linked issues, comments, and code references — then maps them to your local codebase.

## Skills

### /jtb — Jira TicketBrief

Fetches a Jira ticket's full context and assembles a structured brief for implementation planning.

```
/jtb TICKET-KEY              # Fetch ticket + linked tickets
/jtb TICKET-KEY --depth=0    # Target ticket only (fast)
```

See [skills/jtb/README.md](skills/jtb/README.md) for setup and usage.

### /jtb check — Ticket Attention Scanner (Coming Soon)

Scans your assigned tickets and flags ones needing attention (unread comments, CR/QA feedback, aging tickets).

## Architecture

- Zero npm dependencies — Node.js built-ins only
- Supports Jira Cloud and Jira Server/Data Center
- VCS-agnostic: Git, SVN, Mercurial
- All modules TDD with `node:test` + `node:assert`

## Running Tests

```bash
node --test skills/jtb/scripts/test/*.test.mjs
```
