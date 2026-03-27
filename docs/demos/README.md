# Demo recordings

This directory contains [VHS](https://github.com/charmbracelet/vhs) tape files for generating the README demo GIFs.

## Setup

```bash
brew install vhs
npm install -g ticketlens
ticketlens init   # configure your Jira connection
```

## Generate GIFs

```bash
# Ticket fetch demo
# Edit fetch.tape — replace CNV1-2 with a real ticket key from your Jira
vhs docs/demos/fetch.tape      # outputs docs/demos/fetch.gif

# Triage scan demo
vhs docs/demos/triage.tape     # outputs docs/demos/triage.gif
```

## After recording

Replace the placeholder lines in the README `## Demos` section:

```markdown
<!-- fetch demo -->
![Ticket fetch demo](docs/demos/fetch.gif)

<!-- triage demo -->
![Triage scan demo](docs/demos/triage.gif)
```

## Notes

- Terminal width is set to 110 chars — your Jira data must fit cleanly at this width
- `--plain` output is deliberately NOT used so the ANSI colors show in the GIF
- If your banner or brief output is very long, increase `Set Height` in the tape file
- GIFs are gitignored — upload to GitHub via issue drag-and-drop for a CDN URL, then use that URL in the README instead of the local path
