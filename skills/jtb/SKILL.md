---
name: jtb
description: Fetch a Jira ticket's full context (description, comments, linked issues, code references) and assemble a structured TicketBrief for implementation planning. Use when user types /jtb, mentions a Jira ticket key, or wants to plan work from a Jira ticket.
---

# Jira TicketBrief

Fetches a Jira ticket and produces a structured brief with code references, then enters plan mode.

## Quick Start

```
/jtb PROD-1234
/jtb PROD-1234 --depth=0    # target ticket only (fast)
/jtb PROD-1234 --depth=2    # include linked-of-linked tickets
```

## Prerequisites

The following env vars must be set:

- `JIRA_BASE_URL` — e.g. `https://yourteam.atlassian.net`
- **Cloud:** `JIRA_EMAIL` + `JIRA_API_TOKEN`
- **Server/DC:** `JIRA_PAT`

If any are missing, stop and tell the user which vars to set.

## Workflow

### Step 1: Validate environment

Check that `JIRA_BASE_URL` and auth vars are set. If not, list the missing vars and stop.

### Step 2: Fetch the ticket

Run:
```bash
node ~/.agents/skills/jtb/scripts/fetch-ticket.mjs "$TICKET_KEY" $EXTRA_ARGS
```

Where `$TICKET_KEY` is the first argument (e.g. `PROD-1234`) and `$EXTRA_ARGS` are any flags passed (e.g. `--depth=0`).

The script outputs a structured markdown TicketBrief to stdout. If it fails (exit code 1), show the stderr message to the user.

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
