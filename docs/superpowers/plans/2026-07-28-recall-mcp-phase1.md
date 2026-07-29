# Recall MCP Adapter — Phase 1

**Status:** Built, reviewed, 2 HIGH findings fixed at Step 6. 2197/2197 tests passing. Ready for Step 7 (simplify) → Step 8 (ship).

**Step 6 code review + security review findings (both fixed, both regression-tested):**
- **HIGH (code-reviewer):** missing `title` on `recall_add` silently became the literal string `"undefined"` as a saved note title (`--title=${title}` template-stringifies `undefined` to a truthy 4-char string that slipped past `runNoteAdd`'s `!rawTitle` guard). Fixed: explicit truthiness check on `args.title` in `callRecallAdd`, before it ever reaches `buildNoteAddArgs`/`runNoteAddFn`. Regression test: `mcp-server.test.mjs` — "missing title returns a JSON-RPC tool error...".
- **HIGH (security-reviewer):** a syntactically-valid-but-non-object JSON-RPC line (e.g. the single line `null`) crashed the entire long-lived server — reproduced live with a real stack trace. `JSON.parse('null')` succeeds, then destructuring `{ id, method, params }` off `null` throws outside any try/catch, becomes an unhandled promise rejection in the serialized dispatch queue, and kills the process — every subsequent queued message lost. Fixed: explicit non-null-object guard after parse (`-32600 Invalid Request`), plus `stdin`/`stdout` `'error'` handlers and a `.catch()` on the queue chain (a related MEDIUM the code-reviewer separately flagged — same root cause, same fix) so one bad write can't poison every later message or hang shutdown. Regression test: `mcp-server.test.mjs` — "a syntactically-valid-but-non-object JSON line...".
- **LOW (code-reviewer, non-blocking, addressed anyway):** all prior tests injected fake `runNoteAddFn`/`runRecallFn`, so the license-gate parity claim was only verified by inspection. Added 2 end-to-end tests against the real, unmocked `runNoteAdd`/`runRecall`.
**Workflow:** `/ticketlens-work` (project command at `~/Desktop/personal/solopreneur/.claude/commands/ticketlens-work.md`)
**Slug:** `recall-mcp-phase1`
**Classification:** Complex
**Baseline at plan time:** 2177 tests passing, 0 fail (`npm test` in `ticket-lens` repo, 2026-07-28). Re-check this number is still current before trusting it as a regression floor — if it's moved, something else shipped in between.
**Package version at plan time:** `ticketlens@0.21.12` (already published — unrelated fix, same session). Bump from whatever `package.json` says *at resume time*, not from this number.

---

## How to resume this in a new session

1. Read this file top to bottom first — it has the full plan, the research that justified it, and every gotcha found while planning. Don't re-derive any of it from scratch.
2. Check `/tmp/tl-work-checkpoint-recall-mcp-phase1.json`. If present and not stale (>24h) / not `resumes >= 5`, it holds the live step position — resume from there per `/ticketlens-work`'s own Resume Check. If absent, this plan hasn't been approved/started yet — pick up at **Step 3 (Plan Approval Gate)** using the plan block below verbatim, get user approval, then proceed to Step 3.5.
3. Run `/ticketlens-work` and let it read its own companion files (`tl-work/plan.md`, `tl-work/build.md`, etc.) at each step boundary — this doc doesn't replace those, it's the task-specific memory the generic workflow doesn't carry between sessions.
4. Before touching any file this plan names, re-read it — files may have changed since this doc was written. The plan's line numbers are a starting point, not gospel.
5. If `npm test` doesn't show ~2177+ passing at the start of a resumed session, something changed underneath this plan — stop and diff before continuing, don't assume the plan's file/line references still hold.

---

## Origin — why this exists

Prior turn established the *direction* (MCP as the portable, cross-harness replacement for "AI shells out to `ticketlens note add` via Bash", which only works inside jtb/SKILL.md-aware sessions in Claude Code specifically). That direction came out of a separate 10-iteration design loop, landing at "MCP server, thin adapter, stdio, zero deps, layered on top of existing hooks — not a replacement." This doc is the follow-up: turning that direction into an actually-scoped, evidence-checked Phase 1 plan, per the user's explicit instruction to re-run the loop with **real web-verified data**, not further hypothesis.

Full prior-turn context lives in this conversation; the load-bearing conclusion is: ship the MCP server as a thin transport adapter reusing existing `lib/` logic, stdio only, inside the existing `ticketlens` npm package (no new package name, no new dependency).

---

## Research log — 10 iterations, real data, scored 0-10

Each iteration cites what was actually checked and where. Re-verify anything older than a few months before relying on it again — protocol specs and adoption numbers move.

1. **3/10** — Naive: use `@modelcontextprotocol/sdk` directly. **Checked:** npm search confirmed the SDK requires `zod` + `content-type` + `raw-body` as dependencies, 1.7MB install size. `ticket-lens/package.json`'s own published npm description is literally `"...Zero dependencies, all local."` — a public commitment. SDK approach breaks it. Rejected.
2. **5/10** — Hand-roll the protocol, zero deps. **Checked:** [MCP transports spec](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports) — stdio is newline-delimited JSON-RPC 2.0 over stdin/stdout, `node:readline` (Node core module, zero deps) handles the line framing. Search surfaced a real May-2026 precedent, "Building an MCP Server from Scratch: No SDK, Just a JSON-RPC Loop" (Medium/Write-A-Catalyst) — confirms this ships in the wild, not just theoretically possible.
3. **6/10** — Where does it live? **Checked:** 2026 MCP CVE landscape (40+ disclosed CVEs against MCP implementations in 2026; OX Security systemic-flaw disclosure in May 2026 hit an estimated ~200,000 vulnerable instances) raised a supply-chain angle: a brand-new package name (e.g. `ticketlens-mcp`) is squattable by an attacker publishing a lookalike. Decision: ship as a new subcommand (`ticketlens mcp`) inside the already-published, already-trusted `ticketlens` package. No new name, no new npm trust decision for users.
4. **6.7/10** — Don't reimplement note/recall logic. **Checked directly in code, this session:** `runNoteAdd` (`skills/jtb/scripts/lib/note-command.mjs:66`) and `runRecall` (`skills/jtb/scripts/lib/recall-command.mjs:27`) are already pure, dependency-injected functions — `configDir`, `stream`, `readStdin` are all overridable params, no hardcoded `process.exit`/stdin coupling. Confirms a thin adapter is structurally free — the DI seams already exist for exactly this reuse.
5. **7.3/10** — Protocol-safety finding, from the spec text itself: *"The server MUST NOT write anything to its stdout that is not a valid MCP message."* `note-command.mjs` defaults `stream = process.stderr`; `recall-command.mjs` defaults `process.stdout` (for human CLI output) — inconsistent between the two files. The MCP adapter must **never** let the injected `stream` reach real `process.stdout`; every `stream.write(...)` call inside the wrapped functions has to be captured into a buffer and returned as the JSON-RPC tool result, not leaked onto the same channel carrying the protocol traffic. This is now a named Pre-Code Audit item, not an assumption.
6. **7.8/10** — Performance, measured not estimated. **Checked, this machine, this session:** `node bin/ticketlens.mjs --version` cold start = 70–90ms across 3 real runs (`/usr/bin/time -p`). Every bash-spawned `note add` today pays this; a persistent MCP stdio server (spawned once by the harness) pays it once per session, not once per capture.
7. **8.3/10** — Portability, real adoption numbers. **Checked via web search:** VS Code has native MCP support since v1.99 (early 2026); Cursor and Windsurf support local stdio MCP servers today; the MCP TypeScript SDK hit 97M monthly downloads in March 2026 across 20,000+ servers on public registries. Strongest single piece of evidence for the whole thesis — "any AI harness" is close to already-true for coding harnesses, not aspirational.
8. **8.7/10** — Security, surfaced honestly instead of glossed over. **Checked via web search:** real, serious 2026 CVE/tool-poisoning landscape exists (MCPTox benchmark, documented attack class embedding malicious instructions in tool *descriptions*). Our exposure assessed against it: (a) we consume no other MCP server, so no client-side poisoning risk; (b) our own tool descriptions are two fixed, developer-authored strings, never built from ticket/user data, so we can't self-poison; (c) residual risk is supply-chain impersonation, already closed by iteration 3's decision.
9. **9.2/10** — stdio-only reconfirmed by spec text: Streamable HTTP requires Origin-header validation, localhost-only binding, and auth specifically *because* it's more exposed than stdio — a risk class stdio sidesteps by construction, not by omission. Two-tier design (MCP where the harness supports it, existing CLI + SKILL.md path elsewhere) holds, now backed by iteration 7's real numbers instead of a guess.
10. **9.4/10 — stopped at the 10-iteration cap, not forced to a perfect score.** The AI still has to *decide* to call the tool — MCP removes the friction and the cross-harness fragility, not the judgment call itself. That's an honest, irreducible ceiling, documented rather than hidden.

**Sources actually fetched/searched this session** (re-check currency before citing again in a future session — this is a fast-moving spec):
- https://modelcontextprotocol.io/specification/2025-11-25/basic/transports (fetched directly — stdio framing, stdout-purity MUST, stderr-is-safe-for-logs)
- Search: `@modelcontextprotocol/sdk` npm dependencies/bundle size (zod + content-type + raw-body, 1.7MB)
- Search: MCP client support across Claude Code/Cursor/Windsurf/VS Code, 2026 (adoption numbers above)
- Search: MCP server security vulnerabilities / tool poisoning 2026 (CVE count, MCPTox, OX Security disclosure)
- Search: minimal/no-SDK MCP server implementations (real precedent article)
- Local: `/usr/bin/time -p node bin/ticketlens.mjs --version` × 3 (this machine, this session)

---

## Prior-work check (Step 1b, all six, done this session)

- graphify: not applicable/no graph built for this query.
- mempalace search "MCP server recall ticketlens": 0 results.
- claude-mem search "MCP server recall": only unrelated recall-queue/help-text observations, nothing about a server.
- Memory grep (`~/.claude/projects/-Users-admin-Desktop-personal-solopreneur/memory/`): only `project_mcp_server_backlog_2026_07_27.md` (the raw unscoped idea this plan resolves) and `project_competitive.md` (Atlassian's MCP plugin — landing-page positioning reference, not our own server).
- `git log` (ticket-lens, all branches, grep "mcp"): only landing-page diagram/positioning commits (`1745cdc`, `eda37f2`) — no prior server code.
- `git log` (ticketlens-api, all branches, grep "mcp"): no results.

**Conclusion: genuinely new work, nothing to duplicate.**

---

## The plan (Step 3 block, as presented and pending approval)

> Reproduced verbatim from the planning turn. If this gets approved in a future session, proceed straight to Step 3.5 (Pre-Code Audit + repo lock) using `tl-work/plan.md`'s own instructions — don't re-plan.

### Classification
Complex
Tools: research done via 10-iteration web-verified loop (see above) in place of subagent Team Consensus.

### Team Consensus Outcomes
- **Dev Lead:** thin adapter over already-DI'd `runNoteAdd` (`note-command.mjs:66`) and `runRecall` (`recall-command.mjs:27`) — zero logic duplication, same license/secret-scan/retry-queue gates for CLI and MCP paths. New JSON-RPC loop hand-rolled on `node:readline` — zero new dependencies. stdio transport only.
- **Marketing:** reinforces the zero-dependency moat instead of diluting it. No new pricing surface — same Pro gate as `note add`/`recall` today.
- **CR/QA:** must test the stdout-purity invariant (the one genuinely new correctness risk vs. the CLI path). Must test license-gate parity. Must test malformed JSON-RPC input doesn't kill the long-lived process.
- Conflicts resolved: none — all three lenses converged without trade-offs.

### Scope
- CLI only. No backend/Console changes — Phase 1 is entirely local, reuses existing `isLicensed('pro', configDir)`.
- Tier impact: Pro+ only, identical gate to `note add`/`recall` today.

### Files to change
- **NEW** `skills/jtb/scripts/lib/mcp-server.mjs` — `runMcpServer({ configDir, stdin, stdout, stderr })`: `node:readline` line loop over `stdin`, JSON-RPC dispatch for:
  - `initialize` → returns `protocolVersion`, `capabilities: { tools: {} }`, `serverInfo`.
  - `tools/list` → returns the two tool schemas below.
  - `tools/call` → routes `recall_add`→`runNoteAdd`, `recall_search`→`runRecall`, each invoked with a stubbed `readStdin` resolving the tool call's `body`/`query` arg and a capturing `stream` — buffered text becomes the JSON-RPC result's `content`, **never** written to real `stdout`.
  - Malformed input → JSON-RPC error response, loop continues (server must survive one bad message, it's long-lived).
  - **Serialize dispatch.** `readline`'s `line` event fires synchronously and does not await an async listener — found at Step 3.5 (performance audit): a client sending rapid messages would otherwise spawn unbounded concurrent `tools/call` dispatches (each doing fetch/fs), a risk that only exists because this process is long-lived (the one-shot CLI never faced it). Process one message fully (`await` the handler) before reading the next — either an explicit async work queue, or `rl.pause()` before dispatch / `rl.resume()` after.
  - Tool `recall_add`: params `{ title: string, ticket?: string, tags?: string[], body: string }` → `runNoteAdd(['--title=...', '--ticket=...', '--tags=...'], { configDir, stream: capture, readStdin: async () => body })`. **Binding security amendment (Step 3.5):** each `--flag=value` MUST stay a single, discrete array element — confirmed safe because `parseFlag` matches per-element via `startsWith('--title=')` and flag checks use exact-element `includes()`. This is ONLY safe as long as the adapter never `.join(' ')`s the array and re-splits/re-tokenizes it — that would reopen a real injection path (a `title` containing `--ticket=EVIL-999` could forge a second flag). Never tokenize a joined string.
  - Tool `recall_search`: params `{ query: string }` → `runRecall([query], { configDir, stream: capture })`. **`{ ok: false }` (e.g. unlicensed account) must map to a JSON-RPC error result, not a success-shaped empty response** — same rule applies to `recall_add`'s `{ written: false }`. Found at Step 3.5 (seniority audit): the plan initially only named this for `recall_add`; `runRecall`'s `errorStream`-routed upgrade prompt + `ok:false` needs the identical explicit translation or an unlicensed `recall_search` silently looks like "no results" instead of "not entitled."
- `bin/ticketlens.mjs` — new `case 'mcp':` block, inserted after the `case 'recall':` block (currently ends line 723), before `case 'help':` (currently line 725). Same lazy-import pattern as lines 659/696. Calls `runMcpServer({ configDir })` with real `process.stdin`/`process.stdout`/`process.stderr`. No `.then()`-exit-code pattern — long-lived process, exits on stdin close per the spec's stdio lifecycle.
- **NEW** `skills/jtb/scripts/test/mcp-server.test.mjs` — specifies: `initialize` shape; `tools/list` returns exactly 2 tools with valid JSON Schema params; `tools/call recall_add` happy path writes a note (assert via `listNotes`) and returns a result without touching real stdout; `tools/call recall_add` on unlicensed config returns a JSON-RPC error result, not a thrown exception or a success-shaped response; `tools/call recall_search` on unlicensed config likewise returns a JSON-RPC error (not an empty-looking success — see `runRecall`'s `ok:false` mapping above); malformed JSON-RPC line → error response, loop keeps running (assert a second, valid message after it still gets served); a fake session's captured stdout contains only newline-delimited valid JSON — zero stray bytes; **rapid-fire N messages in one flush resolve in order with no unbounded concurrent dispatch** (performance audit finding); **`defaultReadStdin` (note-command.mjs:48) is never reached** — assert the adapter always supplies its own `readStdin` stub, since falling through would attach real `process.stdin` listeners that contend with `readline` and never get removed (performance audit finding); **flag-shaped text in `title`/`body` cannot forge a second flag** — assert a title/body containing `--ticket=EVIL-999` or `--include-attachments` is stored/searched as literal text, never mis-parsed as an extra flag (security audit finding — confirms the discrete-array-element invariant above actually holds in the real implementation, not just in the spec).
- **No `package.json` changes** — `bin/` and `skills/jtb/scripts/lib/` are already in the `files` allowlist (lines 11, 15 as of this writing). No new bin entry, no new dependency.
- **Deviation found at Step 4 (Minor, cleared):** `skills/jtb/scripts/lib/cli.mjs`'s `parseCommand` is a hand-written first-arg allowlist — anything unregistered silently falls through to `fetch` (treated as a ticket key). The plan didn't name this file; without a matching `if (first === 'mcp') return { command: 'mcp', ... }` arm, `bin/ticketlens.mjs`'s new `case 'mcp':` is unreachable. One-line addition, same pattern as every existing command already there — no new file/boundary/dependency/input path. Lock test added: `cli.test.mjs::"routes mcp to the mcp command"` + fallback-still-works regression test extended.

### Approach
New file is a pure protocol adapter: parse JSON-RPC off stdin, translate `tools/call` arguments into the exact `cmdArgs`/injected-dependency shape `runNoteAdd`/`runRecall` already accept, capture their `stream` output into the JSON-RPC response instead of a real stream. No new validation, licensing, or vault logic — 100% reuse. `ticketlens mcp` becomes a new subcommand alongside `note`/`recall`, following the existing dispatch pattern exactly. CLI, hooks, and SKILL.md guidance are untouched in this phase — pure-additive, no flag day.

### Regression surface
- **Invariants preserved:** `ticketlens note add` / `ticketlens recall` CLI behavior unchanged — same functions, same defaults. No existing command's dispatch order in `bin/ticketlens.mjs` changes; new case is purely additive.
- **Lock tests:** `bin.test.mjs` — `"ticketlens note add" with no Pro license writes nothing under ~/.ticketlens/recall/"` (line 218) and `"ticketlens recall" with no Pro license shows an upgrade prompt"` (line 234), both re-run unmodified. Full suite (2177 tests at plan time) re-run as the baseline gate.
- **Impact map hops:** 1-hop — only `bin/ticketlens.mjs`'s dispatch and one new file touch anything; `note-command.mjs`/`recall-command.mjs` are read, not modified.
- **Golden outputs captured:** none needed — no existing output shape changes.

### Open questions
None.

---

## Explicitly out of scope for Phase 1 (don't scope-creep into these without a new plan)

- `fetch_ticket` as an MCP tool — the original backlog note mentioned it, this phase doesn't. Recall-only per the acceptance criteria this plan was scoped against.
- `note_delete` / `note_patch` as MCP tools — not core to "capture in the background," defer.
- Any change to `skills/jtb/SKILL.md`, the hooks (`recall-nudge-*.mjs`), or `advent-ticket.md` — those already work and this phase is additive, not a replacement. A later phase should update SKILL.md to *prefer* the MCP tool when available, CLI fallback otherwise — not this one.
- Streamable HTTP transport — rejected in iteration 9, stdio only.
- Publishing to npm — Phase 1 plan doesn't include an `8-publish` step; confirm with the user whether this ships as a beta before publishing, same as every other change this session.

## Tips for whoever (re)implements this

- Read `note-command.mjs` and `recall-command.mjs` fresh before writing the adapter, even if this doc quotes line numbers — they may have moved.
- The stdout-purity invariant is the single easiest thing to get wrong and the hardest to notice locally (it'll work fine manually, then silently corrupt a real client's parser). Write that test first, not last.
- `node:readline`'s `line` event already strips the trailing newline — don't re-strip or you'll double-handle empty lines.
- `runNoteAdd`/`runRecall` both `await` their injected `readStdin()` — the stub can be a plain `async () => body`, no need to simulate a real stream.
- Test the license-gate path with a fresh temp `HOME` (same pattern as `bin.test.mjs:218-247`), not by mocking `isLicensed` — keeps the test honest against the real gate.
