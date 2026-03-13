# Contributing to TicketLens

Thanks for your interest in contributing to TicketLens! This guide covers everything you need to get started.

## Quick Setup

```bash
git clone https://github.com/ralphmoran/ticket-lens.git
cd ticket-lens
npm test  # 168 tests, no install needed
```

That's it. No `npm install`, no build step. TicketLens has **zero npm dependencies** — it uses only Node.js built-ins.

**Requirements:** Node.js >= 18.0.0

## Project Structure

```
ticket-lens/
├── bin/ticketlens.mjs              # CLI entry point
├── skills/jtb/scripts/
│   ├── fetch-ticket.mjs            # Single ticket fetch
│   ├── fetch-my-tickets.mjs        # Triage scan
│   ├── lib/                        # Core modules
│   │   ├── jira-client.mjs         # Jira API client
│   │   ├── brief-assembler.mjs     # Plain markdown output
│   │   ├── styled-assembler.mjs    # ANSI-styled output
│   │   ├── attention-scorer.mjs    # Urgency scoring
│   │   ├── profile-resolver.mjs    # Multi-account profiles
│   │   ├── code-ref-parser.mjs     # Code reference extraction
│   │   ├── adf-converter.mjs       # Atlassian Document Format
│   │   ├── table-formatter.mjs     # Plain-text table layout
│   │   ├── ansi.mjs                # Zero-dep ANSI styling
│   │   ├── vcs-detector.mjs        # Git/SVN/Hg detection
│   │   └── cli.mjs                 # CLI argument parsing
│   └── test/                       # One test file per module
└── fixtures/jira-fixtures/         # Test data
```

## Running Tests

```bash
npm test
```

This runs all test files via Node.js built-in test runner (`node:test`). No test framework to install.

To run a single test file:

```bash
node --test skills/jtb/scripts/test/ansi.test.mjs
```

## Development Workflow

We use **test-driven development (TDD)**. For any change:

1. **Write a failing test** in `skills/jtb/scripts/test/<module>.test.mjs`
2. **Make it pass** with the minimal implementation
3. **Refactor** if needed, keeping tests green
4. Run `npm test` to confirm nothing else broke

## Core Principles

### Zero Dependencies

This is non-negotiable. TicketLens ships with zero npm dependencies. This gives us:

- Sub-second install (`npm i -g ticketlens`)
- Zero supply chain attack surface
- Every line of code is auditable
- No upstream breaking changes

If you need functionality that a library provides, implement the minimal subset yourself. See `ansi.mjs` (30 lines replacing chalk) as an example.

### One Module, One Job

Each file in `lib/` does one thing. New functionality goes in a new module with its own test file. Don't grow existing modules with unrelated features.

### TTY-Aware Output

All CLI output must respect terminal detection:

- **TTY** (interactive terminal): ANSI-styled output via `styled-assembler.mjs`
- **Piped/redirected**: Plain markdown via `brief-assembler.mjs`
- **`NO_COLOR` / `FORCE_COLOR` / `TERM=dumb`**: Respected by `ansi.mjs`

### Jira Compatibility

TicketLens supports both Jira Cloud (v3 API) and Jira Server/DC (v2 API). Any Jira-facing change must work with both. Test with the `apiVersion` option.

## Making Changes

### Bug Fixes

1. Open an issue describing the bug (or reference an existing one)
2. Write a test that reproduces the bug
3. Fix it, confirm the test passes
4. Submit a PR referencing the issue

### New Features

1. Open an issue to discuss the feature first
2. Keep scope small — one PR per feature
3. Include tests (aim for the patterns in existing test files)
4. Update the relevant CLI help text if adding flags

### Code Style

- ESM modules (`import`/`export`, `.mjs` extension)
- `node:assert/strict` for test assertions
- No TypeScript, no transpilation
- Descriptive variable names over comments
- Functions over classes unless state management requires it

## What We Won't Accept

- PRs that add npm dependencies
- Changes without tests
- Scope creep (keep PRs focused on one thing)
- IDE plugins or integrations (these should live in separate repos)

## Submitting a Pull Request

1. Fork the repo and create a branch from `main`
2. Make your changes following the guidelines above
3. Run `npm test` — all 168+ tests must pass
4. Push and open a PR with a clear description of what and why
5. Link any related issues

## Questions?

Open a [GitHub Discussion](https://github.com/ralphmoran/ticket-lens/discussions) for questions, ideas, or feedback.
