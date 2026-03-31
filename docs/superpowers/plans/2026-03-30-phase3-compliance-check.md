# Phase 3 — Compliance Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `ticketlens PROJ-123 --compliance` — extracts acceptance criteria from the ticket, links them to local git commits/diff, and reports which requirements are covered. Free tier: 3 checks/month. Pro: unlimited. BYOK and cloud paths supported.

**Architecture:** Five new CLI modules (requirement-extractor, commit-linker, diff-analyzer, usage-tracker, compliance-checker orchestrator), one new `--compliance` flag in `fetch-ticket.mjs`, and one new `POST /v1/compliance` endpoint in the Laravel backend. Each module has its own test file. Modules use injectable dependencies throughout for testability (same pattern as `summarizer.mjs` and `brief-cache.mjs`).

**Tech Stack:** Node.js 20+ ESM (CLI modules), Node built-in test runner (`node:test`), `spawnSync` for git (no shell interpolation), Laravel 11 + PHP 8.3 (backend endpoint).

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `skills/jtb/scripts/lib/requirement-extractor.mjs` | Create | Parse acceptance criteria from ticket text |
| `skills/jtb/scripts/lib/commit-linker.mjs` | Create | Find git commits/branches referencing ticket key |
| `skills/jtb/scripts/lib/diff-analyzer.mjs` | Create | Map requirements → FOUND/NOT_FOUND/PARTIAL in diff |
| `skills/jtb/scripts/lib/usage-tracker.mjs` | Create | Read/write `~/.ticketlens/usage.json`, enforce 3/month cap |
| `skills/jtb/scripts/lib/compliance-checker.mjs` | Create | Orchestrator: combines all modules into a report |
| `skills/jtb/scripts/test/requirement-extractor.test.mjs` | Create | 10+ tests |
| `skills/jtb/scripts/test/commit-linker.test.mjs` | Create | 7+ tests |
| `skills/jtb/scripts/test/diff-analyzer.test.mjs` | Create | 7+ tests |
| `skills/jtb/scripts/test/usage-tracker.test.mjs` | Create | 7+ tests |
| `skills/jtb/scripts/test/compliance-checker.test.mjs` | Create | 8+ tests |
| `skills/jtb/scripts/fetch-ticket.mjs` | Modify | Add `--compliance` flag handling |
| `skills/jtb/scripts/lib/help.mjs` | Modify | Document `--compliance` in fetch help |
| `ticketlens-api/app/Http/Controllers/Api/ComplianceController.php` | Create | POST /v1/compliance handler |
| `ticketlens-api/app/Http/Requests/ComplianceRequest.php` | Create | Validation for compliance request |
| `ticketlens-api/routes/api.php` | Modify | Register compliance route |
| `ticketlens-api/tests/Feature/ComplianceControllerTest.php` | Create | 5+ backend tests |

---

### Task 1: `requirement-extractor.mjs`

**Files:**
- Create: `skills/jtb/scripts/lib/requirement-extractor.mjs`
- Create: `skills/jtb/scripts/test/requirement-extractor.test.mjs`

**Interface:**
```js
// Returns array of requirement strings extracted from ticket body text.
// Extracts: Given/When/Then lines, bullet/numbered items with must/should/shall/ensure/verify,
// lines under "Acceptance Criteria" headers, and imperative-verb sentences.
export function extractRequirements(text)
```

- [ ] **Step 1: Write the failing tests**

Create `skills/jtb/scripts/test/requirement-extractor.test.mjs`:

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractRequirements } from '../lib/requirement-extractor.mjs';

describe('extractRequirements', () => {
  it('returns empty array for empty text', () => {
    assert.deepStrictEqual(extractRequirements(''), []);
    assert.deepStrictEqual(extractRequirements(null), []);
  });

  it('extracts Given/When/Then lines', () => {
    const text = `
      Given a logged-in user
      When they submit the form
      Then the record is saved
    `;
    const result = extractRequirements(text);
    assert.ok(result.some(r => r.includes('Given a logged-in user')));
    assert.ok(result.some(r => r.includes('When they submit the form')));
    assert.ok(result.some(r => r.includes('Then the record is saved')));
  });

  it('extracts bullet items with must/should/shall', () => {
    const text = `
      - The system must validate the email format
      - Users should receive a confirmation email
      - The API shall return 422 on invalid input
    `;
    const result = extractRequirements(text);
    assert.equal(result.length, 3);
    assert.ok(result.some(r => r.includes('validate the email')));
  });

  it('extracts numbered list items with must/should', () => {
    const text = `
      1. The form must not submit with empty fields
      2. Error messages should appear inline
    `;
    const result = extractRequirements(text);
    assert.equal(result.length, 2);
  });

  it('extracts items under Acceptance Criteria header', () => {
    const text = `
      ## Acceptance Criteria

      - User can log in with email+password
      - Incorrect password shows error
      - Session persists on page refresh
    `;
    const result = extractRequirements(text);
    assert.ok(result.length >= 3);
  });

  it('deduplicates identical requirements', () => {
    const text = `
      - Must validate email
      - Must validate email
    `;
    const result = extractRequirements(text);
    assert.equal(result.length, 1);
  });

  it('trims whitespace from extracted requirements', () => {
    const text = `  - The system must validate input  `;
    const result = extractRequirements(text);
    assert.equal(result[0], result[0].trim());
  });

  it('handles text with no recognizable requirements', () => {
    const text = 'This is a general ticket description with no requirements.';
    const result = extractRequirements(text);
    assert.ok(Array.isArray(result));
  });

  it('extracts Ensure/Verify imperative verbs in bullet items', () => {
    const text = `
      - Ensure the export file is UTF-8 encoded
      - Verify that duplicate keys are rejected
    `;
    const result = extractRequirements(text);
    assert.equal(result.length, 2);
  });

  it('extracts requirements from mixed content', () => {
    const text = `
      Background context here.

      ## Acceptance Criteria
      - Must do X
      - Should do Y

      Given the user is authenticated
      When they click submit
      Then the form is saved
    `;
    const result = extractRequirements(text);
    assert.ok(result.length >= 4);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd ~/Desktop/Projects/ticket-lens && node --test skills/jtb/scripts/test/requirement-extractor.test.mjs 2>&1 | tail -10
```

Expected: FAIL with "Cannot find module" or similar.

- [ ] **Step 3: Implement `requirement-extractor.mjs`**

Create `skills/jtb/scripts/lib/requirement-extractor.mjs`:

```js
/**
 * Extracts acceptance criteria / requirements from Jira ticket text.
 * Recognises: Given/When/Then, must/should/shall/ensure/verify bullets,
 * Acceptance Criteria sections, and numbered imperative items.
 */

const RE_GWT        = /^\s*(given|when|then)\s+(.+)/i;
const RE_MUST_ITEM  = /^\s*[-*•]\s+(.+(?:must|should|shall|ensure|verify).+)/i;
const RE_NUM_MUST   = /^\s*\d+\.\s+(.+(?:must|should|shall|ensure|verify).+)/i;
const RE_AC_HEADER  = /^\s*#+\s*acceptance criteria\s*$/i;
const RE_BULLET     = /^\s*[-*•]\s+(.+)/;
const RE_NUM_ITEM   = /^\s*\d+\.\s+(.+)/;

export function extractRequirements(text) {
  if (!text) return [];

  const lines = text.split('\n');
  const results = [];
  let inAcSection = false;

  for (const line of lines) {
    // Given/When/Then
    const gwt = RE_GWT.exec(line);
    if (gwt) { results.push(line.trim()); continue; }

    // Acceptance Criteria section header
    if (RE_AC_HEADER.test(line)) { inAcSection = true; continue; }

    // Exit AC section on next heading
    if (inAcSection && /^\s*#+\s/.test(line) && !RE_AC_HEADER.test(line)) {
      inAcSection = false;
    }

    // must/should/shall in bullet
    const mustItem = RE_MUST_ITEM.exec(line);
    if (mustItem) { results.push(mustItem[1].trim()); continue; }

    // must/should/shall in numbered item
    const numMust = RE_NUM_MUST.exec(line);
    if (numMust) { results.push(numMust[1].trim()); continue; }

    // Inside AC section: capture all bullet and numbered items
    if (inAcSection) {
      const bullet = RE_BULLET.exec(line);
      if (bullet) { results.push(bullet[1].trim()); continue; }
      const numItem = RE_NUM_ITEM.exec(line);
      if (numItem) { results.push(numItem[1].trim()); continue; }
    }
  }

  return [...new Set(results)];
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd ~/Desktop/Projects/ticket-lens && node --test skills/jtb/scripts/test/requirement-extractor.test.mjs 2>&1 | tail -5
```

Expected: all tests pass, 0 failures.

- [ ] **Step 5: Run full suite to confirm no regression**

```bash
cd ~/Desktop/Projects/ticket-lens && npm test 2>&1 | tail -5
```

Expected: `pass 544` (or higher, +10 from new tests), `fail 0`

- [ ] **Step 6: Commit**

```bash
cd ~/Desktop/Projects/ticket-lens
git add skills/jtb/scripts/lib/requirement-extractor.mjs skills/jtb/scripts/test/requirement-extractor.test.mjs
git commit -m "feat: requirement-extractor — parse acceptance criteria from ticket text"
```

---

### Task 2: `usage-tracker.mjs`

**Files:**
- Create: `skills/jtb/scripts/lib/usage-tracker.mjs`
- Create: `skills/jtb/scripts/test/usage-tracker.test.mjs`

**Interface:**
```js
// Returns { count: number, month: string, canUse: boolean } for given configDir.
// month = "YYYY-MM" of current UTC month. canUse = count < FREE_LIMIT (3).
export function checkUsage(configDir)

// Increments the compliance counter for the current UTC month.
// Creates ~/.ticketlens/usage.json if it doesn't exist.
export function incrementUsage(configDir)

// Returns the free tier monthly limit (3).
export const FREE_LIMIT
```

Storage format: `~/.ticketlens/usage.json` → `{ "compliance": { "2026-03": 2 } }`

- [ ] **Step 1: Write the failing tests**

Create `skills/jtb/scripts/test/usage-tracker.test.mjs`:

```js
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkUsage, incrementUsage, FREE_LIMIT } from '../lib/usage-tracker.mjs';

function tmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tl-usage-test-'));
  return dir;
}

describe('FREE_LIMIT', () => {
  it('is 3', () => {
    assert.equal(FREE_LIMIT, 3);
  });
});

describe('checkUsage', () => {
  it('returns count=0 and canUse=true when no usage file exists', () => {
    const dir = tmpDir();
    const result = checkUsage(dir);
    assert.equal(result.count, 0);
    assert.equal(result.canUse, true);
    fs.rmSync(dir, { recursive: true });
  });

  it('returns correct count for current month', () => {
    const dir = tmpDir();
    const month = new Date().toISOString().slice(0, 7);
    fs.writeFileSync(
      path.join(dir, 'usage.json'),
      JSON.stringify({ compliance: { [month]: 2 } })
    );
    const result = checkUsage(dir);
    assert.equal(result.count, 2);
    assert.equal(result.canUse, true);
    assert.equal(result.month, month);
    fs.rmSync(dir, { recursive: true });
  });

  it('returns canUse=false when count equals FREE_LIMIT', () => {
    const dir = tmpDir();
    const month = new Date().toISOString().slice(0, 7);
    fs.writeFileSync(
      path.join(dir, 'usage.json'),
      JSON.stringify({ compliance: { [month]: 3 } })
    );
    const result = checkUsage(dir);
    assert.equal(result.canUse, false);
    fs.rmSync(dir, { recursive: true });
  });

  it('returns count=0 for a different month', () => {
    const dir = tmpDir();
    fs.writeFileSync(
      path.join(dir, 'usage.json'),
      JSON.stringify({ compliance: { '2025-01': 3 } })
    );
    const result = checkUsage(dir);
    assert.equal(result.count, 0);
    assert.equal(result.canUse, true);
    fs.rmSync(dir, { recursive: true });
  });
});

describe('incrementUsage', () => {
  it('creates usage.json if it does not exist', () => {
    const dir = tmpDir();
    incrementUsage(dir);
    const data = JSON.parse(fs.readFileSync(path.join(dir, 'usage.json'), 'utf8'));
    const month = new Date().toISOString().slice(0, 7);
    assert.equal(data.compliance[month], 1);
    fs.rmSync(dir, { recursive: true });
  });

  it('increments existing count', () => {
    const dir = tmpDir();
    const month = new Date().toISOString().slice(0, 7);
    fs.writeFileSync(
      path.join(dir, 'usage.json'),
      JSON.stringify({ compliance: { [month]: 1 } })
    );
    incrementUsage(dir);
    const data = JSON.parse(fs.readFileSync(path.join(dir, 'usage.json'), 'utf8'));
    assert.equal(data.compliance[month], 2);
    fs.rmSync(dir, { recursive: true });
  });

  it('does not touch other months', () => {
    const dir = tmpDir();
    const month = new Date().toISOString().slice(0, 7);
    fs.writeFileSync(
      path.join(dir, 'usage.json'),
      JSON.stringify({ compliance: { '2025-01': 5, [month]: 0 } })
    );
    incrementUsage(dir);
    const data = JSON.parse(fs.readFileSync(path.join(dir, 'usage.json'), 'utf8'));
    assert.equal(data.compliance['2025-01'], 5);
    fs.rmSync(dir, { recursive: true });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd ~/Desktop/Projects/ticket-lens && node --test skills/jtb/scripts/test/usage-tracker.test.mjs 2>&1 | tail -10
```

Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement `usage-tracker.mjs`**

Create `skills/jtb/scripts/lib/usage-tracker.mjs`:

```js
import fs from 'node:fs';
import path from 'node:path';

export const FREE_LIMIT = 3;

const USAGE_FILE = 'usage.json';

function currentMonth() {
  return new Date().toISOString().slice(0, 7); // "YYYY-MM"
}

function readUsageFile(configDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(configDir, USAGE_FILE), 'utf8'));
  } catch {
    return { compliance: {} };
  }
}

function writeUsageFile(configDir, data) {
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, USAGE_FILE), JSON.stringify(data, null, 2), 'utf8');
}

export function checkUsage(configDir) {
  const month = currentMonth();
  const data = readUsageFile(configDir);
  const count = data.compliance?.[month] ?? 0;
  return { count, month, canUse: count < FREE_LIMIT };
}

export function incrementUsage(configDir) {
  const month = currentMonth();
  const data = readUsageFile(configDir);
  if (!data.compliance) data.compliance = {};
  data.compliance[month] = (data.compliance[month] ?? 0) + 1;
  writeUsageFile(configDir, data);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd ~/Desktop/Projects/ticket-lens && node --test skills/jtb/scripts/test/usage-tracker.test.mjs 2>&1 | tail -5
```

Expected: all tests pass, 0 failures.

- [ ] **Step 5: Commit**

```bash
cd ~/Desktop/Projects/ticket-lens
git add skills/jtb/scripts/lib/usage-tracker.mjs skills/jtb/scripts/test/usage-tracker.test.mjs
git commit -m "feat: usage-tracker — monthly free-tier compliance cap"
```

---

### Task 3: `commit-linker.mjs`

**Files:**
- Create: `skills/jtb/scripts/lib/commit-linker.mjs`
- Create: `skills/jtb/scripts/test/commit-linker.test.mjs`

**Interface:**
```js
// Finds git commits and branches referencing ticketKey.
// Uses spawnSync with explicit arg arrays (no shell interpolation).
// opts.execFn: injectable (spawnSync-compatible) for tests.
// opts.cwd: working directory (default: process.cwd()).
// Returns: { commits: string[], branches: string[], diff: string|null }
export function findLinkedCommits(ticketKey, opts = {})
```

**Security:** `ticketKey` MUST match `/^[A-Z]+-\d+$/` before use — validated before spawn call.

- [ ] **Step 1: Write the failing tests**

Create `skills/jtb/scripts/test/commit-linker.test.mjs`:

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { findLinkedCommits } from '../lib/commit-linker.mjs';

// Injectable execFn that simulates git output
function makeExecFn(responses) {
  let callCount = 0;
  return (cmd, args, opts) => {
    const response = responses[callCount++] ?? { status: 0, stdout: '' };
    return { status: response.status ?? 0, stdout: response.stdout ?? '', stderr: '' };
  };
}

describe('findLinkedCommits', () => {
  it('returns empty arrays when no commits reference the ticket key', () => {
    const execFn = makeExecFn([
      { stdout: 'abc1234 feat: unrelated change\ndef5678 fix: another thing\n' },
      { stdout: '  main\n  feature/unrelated\n' },
      { stdout: '' },
    ]);
    const result = findLinkedCommits('PROJ-123', { execFn, cwd: '/tmp' });
    assert.deepStrictEqual(result.commits, []);
    assert.deepStrictEqual(result.branches, []);
  });

  it('finds commits referencing the ticket key', () => {
    const execFn = makeExecFn([
      { stdout: 'abc1234 feat: PROJ-123 add payment validation\ndef5678 fix: unrelated\n' },
      { stdout: '  main\n' },
      { stdout: '' },
    ]);
    const result = findLinkedCommits('PROJ-123', { execFn, cwd: '/tmp' });
    assert.equal(result.commits.length, 1);
    assert.ok(result.commits[0].includes('PROJ-123'));
  });

  it('finds branches referencing the ticket key', () => {
    const execFn = makeExecFn([
      { stdout: '' },
      { stdout: '  main\n  feature/PROJ-123-add-payment\n  remotes/origin/PROJ-123-fix\n' },
      { stdout: '' },
    ]);
    const result = findLinkedCommits('PROJ-123', { execFn, cwd: '/tmp' });
    assert.equal(result.branches.length, 2);
  });

  it('returns diff when git diff produces output', () => {
    const execFn = makeExecFn([
      { stdout: '' },
      { stdout: '' },
      { stdout: '+  const x = 1;\n-  const x = 0;\n' },
    ]);
    const result = findLinkedCommits('PROJ-123', { execFn, cwd: '/tmp' });
    assert.ok(result.diff && result.diff.length > 0);
  });

  it('returns null diff when git diff fails', () => {
    const execFn = makeExecFn([
      { stdout: '' },
      { stdout: '' },
      { status: 1, stdout: '' },
    ]);
    const result = findLinkedCommits('PROJ-123', { execFn, cwd: '/tmp' });
    assert.equal(result.diff, null);
  });

  it('rejects invalid ticket keys containing shell metacharacters', () => {
    assert.throws(
      () => findLinkedCommits('PROJ-123; rm -rf /', {}),
      /Invalid ticket key/
    );
  });

  it('rejects ticket keys not matching [A-Z]+-\\d+ format', () => {
    assert.throws(
      () => findLinkedCommits('proj123', {}),
      /Invalid ticket key/
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd ~/Desktop/Projects/ticket-lens && node --test skills/jtb/scripts/test/commit-linker.test.mjs 2>&1 | tail -10
```

Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement `commit-linker.mjs`**

Create `skills/jtb/scripts/lib/commit-linker.mjs`:

```js
import { spawnSync } from 'node:child_process';

const TICKET_KEY_RE = /^[A-Z]+-\d+$/;
const SPAWN_OPTS = { encoding: 'utf8', timeout: 10_000 };

function run(execFn, cmd, args, cwd) {
  const result = execFn(cmd, args, { ...SPAWN_OPTS, cwd });
  return result.status === 0 ? (result.stdout || '') : null;
}

export function findLinkedCommits(ticketKey, opts = {}) {
  if (!TICKET_KEY_RE.test(ticketKey)) {
    throw new Error(`Invalid ticket key: ${ticketKey}`);
  }

  const execFn = opts.execFn ?? spawnSync;
  const cwd    = opts.cwd    ?? process.cwd();

  // git log: last 100 commits, one line each
  const logOut = run(execFn, 'git', ['log', '--oneline', '-100', '--all'], cwd) ?? '';
  const commits = logOut
    .split('\n')
    .filter(line => line.includes(ticketKey))
    .map(line => line.trim())
    .filter(Boolean);

  // git branch: all local + remote branches
  const branchOut = run(execFn, 'git', ['branch', '--all'], cwd) ?? '';
  const branches = branchOut
    .split('\n')
    .map(line => line.replace(/^\*?\s+/, '').trim())
    .filter(name => name.includes(ticketKey));

  // git diff HEAD: current working diff
  const diffOut = run(execFn, 'git', ['diff', 'HEAD'], cwd);

  return {
    commits,
    branches,
    diff: diffOut || null,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd ~/Desktop/Projects/ticket-lens && node --test skills/jtb/scripts/test/commit-linker.test.mjs 2>&1 | tail -5
```

Expected: all tests pass, 0 failures.

- [ ] **Step 5: Commit**

```bash
cd ~/Desktop/Projects/ticket-lens
git add skills/jtb/scripts/lib/commit-linker.mjs skills/jtb/scripts/test/commit-linker.test.mjs
git commit -m "feat: commit-linker — find git commits/branches referencing ticket key"
```

---

### Task 4: `diff-analyzer.mjs`

**Files:**
- Create: `skills/jtb/scripts/lib/diff-analyzer.mjs`
- Create: `skills/jtb/scripts/test/diff-analyzer.test.mjs`

**Interface:**
```js
// Analyzes whether each requirement is addressed in the given diff.
// Uses heuristic keyword matching by default (no LLM required).
// opts.analyzerFn: injectable function(requirement, diff) => 'FOUND'|'NOT_FOUND'|'PARTIAL'
// Returns: { results: Array<{requirement, status, evidence}>, coveragePercent: number }
export function analyzeDiff(requirements, diff, opts = {})
```

**Heuristic strategy:** Extract meaningful keywords from each requirement string (strip common stop words), check whether those keywords appear in the diff text. 3+ keywords matched → FOUND; 1-2 matched → PARTIAL; 0 → NOT_FOUND.

- [ ] **Step 1: Write the failing tests**

Create `skills/jtb/scripts/test/diff-analyzer.test.mjs`:

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeDiff } from '../lib/diff-analyzer.mjs';

const SAMPLE_DIFF = `
diff --git a/src/payment.js b/src/payment.js
--- a/src/payment.js
+++ b/src/payment.js
@@ -1,5 +1,10 @@
+function validateEmail(email) {
+  return /^[^@]+@[^@]+$/.test(email);
+}
+
+function processPayment(amount, card) {
+  if (!validateEmail(card.email)) throw new Error('Invalid email');
+  return { success: true, amount };
+}
`;

describe('analyzeDiff', () => {
  it('returns empty results for empty requirements', () => {
    const result = analyzeDiff([], SAMPLE_DIFF);
    assert.deepStrictEqual(result.results, []);
    assert.equal(result.coveragePercent, 0);
  });

  it('marks requirement as FOUND when keywords appear in diff', () => {
    const result = analyzeDiff(['Must validate email format'], SAMPLE_DIFF);
    assert.equal(result.results[0].status, 'FOUND');
  });

  it('marks requirement as NOT_FOUND when no keywords match', () => {
    const result = analyzeDiff(['Must send SMS notification'], SAMPLE_DIFF);
    assert.equal(result.results[0].status, 'NOT_FOUND');
  });

  it('calculates coveragePercent correctly', () => {
    const reqs = [
      'Must validate email format',  // FOUND
      'Must send SMS notification',  // NOT_FOUND
    ];
    const result = analyzeDiff(reqs, SAMPLE_DIFF);
    assert.equal(result.coveragePercent, 50);
  });

  it('returns 0 coverage when diff is null', () => {
    const result = analyzeDiff(['Must validate email'], null);
    assert.equal(result.results[0].status, 'NOT_FOUND');
    assert.equal(result.coveragePercent, 0);
  });

  it('uses injected analyzerFn when provided', () => {
    const analyzerFn = (_req, _diff) => 'PARTIAL';
    const result = analyzeDiff(['Any requirement'], SAMPLE_DIFF, { analyzerFn });
    assert.equal(result.results[0].status, 'PARTIAL');
  });

  it('includes evidence string for FOUND results', () => {
    const result = analyzeDiff(['Must validate email format'], SAMPLE_DIFF);
    assert.equal(typeof result.results[0].evidence, 'string');
  });

  it('counts PARTIAL as 0.5 toward coverage', () => {
    const analyzerFn = (_req) => 'PARTIAL';
    const result = analyzeDiff(['req1', 'req2'], SAMPLE_DIFF, { analyzerFn });
    assert.equal(result.coveragePercent, 50);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd ~/Desktop/Projects/ticket-lens && node --test skills/jtb/scripts/test/diff-analyzer.test.mjs 2>&1 | tail -10
```

Expected: FAIL.

- [ ] **Step 3: Implement `diff-analyzer.mjs`**

Create `skills/jtb/scripts/lib/diff-analyzer.mjs`:

```js
/**
 * Maps a list of requirements to FOUND / NOT_FOUND / PARTIAL status
 * against a git diff string, using keyword heuristics.
 */

const STOP_WORDS = new Set([
  'the','a','an','is','are','be','was','were','been','being',
  'have','has','had','do','does','did','will','would','could','should',
  'may','might','must','shall','and','or','but','in','on','at','to',
  'for','of','with','by','from','as','it','its','that','this','these',
  'those','not','no','if','when','then','given','user','system','api',
]);

function keywords(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

function defaultAnalyzer(requirement, diff) {
  if (!diff) return 'NOT_FOUND';
  const kws = keywords(requirement);
  if (kws.length === 0) return 'NOT_FOUND';
  const diffLower = diff.toLowerCase();
  const matched = kws.filter(k => diffLower.includes(k));
  if (matched.length === 0) return 'NOT_FOUND';
  if (matched.length >= 3 || matched.length >= kws.length * 0.6) return 'FOUND';
  return 'PARTIAL';
}

function defaultEvidence(requirement, diff) {
  if (!diff) return null;
  const kws = keywords(requirement);
  const lines = diff.split('\n');
  for (const kw of kws) {
    const match = lines.find(l => l.toLowerCase().includes(kw));
    if (match) return match.trim().slice(0, 80);
  }
  return null;
}

export function analyzeDiff(requirements, diff, opts = {}) {
  if (!requirements || requirements.length === 0) {
    return { results: [], coveragePercent: 0 };
  }

  const analyzerFn = opts.analyzerFn ?? defaultAnalyzer;

  const results = requirements.map(requirement => {
    const status   = analyzerFn(requirement, diff);
    const evidence = status !== 'NOT_FOUND' ? defaultEvidence(requirement, diff) : null;
    return { requirement, status, evidence };
  });

  const score = results.reduce((sum, r) => {
    if (r.status === 'FOUND')    return sum + 1;
    if (r.status === 'PARTIAL')  return sum + 0.5;
    return sum;
  }, 0);

  const coveragePercent = Math.round((score / results.length) * 100);

  return { results, coveragePercent };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd ~/Desktop/Projects/ticket-lens && node --test skills/jtb/scripts/test/diff-analyzer.test.mjs 2>&1 | tail -5
```

Expected: all tests pass, 0 failures.

- [ ] **Step 5: Commit**

```bash
cd ~/Desktop/Projects/ticket-lens
git add skills/jtb/scripts/lib/diff-analyzer.mjs skills/jtb/scripts/test/diff-analyzer.test.mjs
git commit -m "feat: diff-analyzer — map requirements to FOUND/NOT_FOUND/PARTIAL in git diff"
```

---

### Task 5: `compliance-checker.mjs` (orchestrator)

**Files:**
- Create: `skills/jtb/scripts/lib/compliance-checker.mjs`
- Create: `skills/jtb/scripts/test/compliance-checker.test.mjs`

**Interface:**
```js
// Orchestrates a full compliance check.
// opts.isLicensedFn: injectable (defaults to isLicensed from license.mjs)
// opts.showUpgradeFn: injectable (defaults to showUpgradePrompt)
// opts.incrementUsageFn: injectable
// opts.checkUsageFn: injectable
// opts.extractRequirementsFn: injectable
// opts.findLinkedCommitsFn: injectable
// opts.analyzeDiffFn: injectable
// Returns: { report: string, coveragePercent: number } or null if gate blocked.
export async function runComplianceCheck({
  brief, ticketKey, configDir,
  isLicensedFn, showUpgradeFn, checkUsageFn, incrementUsageFn,
  extractRequirementsFn, findLinkedCommitsFn, analyzeDiffFn,
  stream
})
```

- [ ] **Step 1: Write the failing tests**

Create `skills/jtb/scripts/test/compliance-checker.test.mjs`:

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runComplianceCheck } from '../lib/compliance-checker.mjs';

const BRIEF = `
## Description
Payment form must validate email format.
Acceptance Criteria:
- Must validate email
- Must handle empty fields
`;

function makeOpts(overrides = {}) {
  return {
    brief: BRIEF,
    ticketKey: 'PROJ-123',
    configDir: '/tmp/test-config',
    stream: { write: () => {}, isTTY: false },
    isLicensedFn: () => true,
    showUpgradeFn: () => {},
    checkUsageFn: () => ({ count: 0, month: '2026-03', canUse: true }),
    incrementUsageFn: () => {},
    extractRequirementsFn: (_text) => ['Must validate email', 'Must handle empty fields'],
    findLinkedCommitsFn: (_key, _opts) => ({ commits: [], branches: [], diff: '+validate(email)' }),
    analyzeDiffFn: (_reqs, _diff) => ({
      results: [
        { requirement: 'Must validate email', status: 'FOUND', evidence: '+validate(email)' },
        { requirement: 'Must handle empty fields', status: 'NOT_FOUND', evidence: null },
      ],
      coveragePercent: 50,
    }),
    ...overrides,
  };
}

describe('runComplianceCheck', () => {
  it('returns a report string on success', async () => {
    const result = await runComplianceCheck(makeOpts());
    assert.ok(result !== null);
    assert.equal(typeof result.report, 'string');
  });

  it('report includes coverage percentage', async () => {
    const result = await runComplianceCheck(makeOpts());
    assert.ok(result.report.includes('50%') || result.coveragePercent === 50);
  });

  it('report includes FOUND status marker', async () => {
    const result = await runComplianceCheck(makeOpts());
    assert.ok(result.report.includes('✔') || result.report.includes('FOUND'));
  });

  it('report includes NOT FOUND status marker', async () => {
    const result = await runComplianceCheck(makeOpts());
    assert.ok(result.report.includes('✖') || result.report.includes('NOT FOUND'));
  });

  it('returns null and calls showUpgradeFn when not licensed and free limit hit', async () => {
    let upgradeCalled = false;
    const opts = makeOpts({
      isLicensedFn: () => false,
      checkUsageFn: () => ({ count: 3, month: '2026-03', canUse: false }),
      showUpgradeFn: () => { upgradeCalled = true; },
    });
    const result = await runComplianceCheck(opts);
    assert.equal(result, null);
    assert.ok(upgradeCalled);
  });

  it('succeeds for free tier when usage count is under limit', async () => {
    const opts = makeOpts({
      isLicensedFn: () => false,
      checkUsageFn: () => ({ count: 1, month: '2026-03', canUse: true }),
    });
    const result = await runComplianceCheck(opts);
    assert.ok(result !== null);
  });

  it('calls incrementUsageFn when check proceeds', async () => {
    let incremented = false;
    const opts = makeOpts({ incrementUsageFn: () => { incremented = true; } });
    await runComplianceCheck(opts);
    assert.ok(incremented);
  });

  it('shows remaining free checks in report for non-Pro users', async () => {
    const opts = makeOpts({
      isLicensedFn: () => false,
      checkUsageFn: () => ({ count: 1, month: '2026-03', canUse: true }),
    });
    const result = await runComplianceCheck(opts);
    // count=1, current check = 2nd use, remaining = FREE_LIMIT - 1 - 1 = 1
    assert.ok(result.report.includes('free') || result.report.includes('remaining'));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd ~/Desktop/Projects/ticket-lens && node --test skills/jtb/scripts/test/compliance-checker.test.mjs 2>&1 | tail -10
```

Expected: FAIL.

- [ ] **Step 3: Implement `compliance-checker.mjs`**

Create `skills/jtb/scripts/lib/compliance-checker.mjs`:

```js
import { isLicensed, showUpgradePrompt } from './license.mjs';
import { checkUsage, incrementUsage, FREE_LIMIT } from './usage-tracker.mjs';
import { extractRequirements } from './requirement-extractor.mjs';
import { findLinkedCommits } from './commit-linker.mjs';
import { analyzeDiff } from './diff-analyzer.mjs';
import { DEFAULT_CONFIG_DIR } from './config.mjs';

const STATUS_ICON = { FOUND: '✔', PARTIAL: '~', NOT_FOUND: '✖' };

function formatReport({ ticketKey, requirements, analysis, usage, isPro }) {
  const { results, coveragePercent } = analysis;
  const lines = [
    '',
    `  Compliance Check — ${ticketKey}`,
    `  ${'─'.repeat(50)}`,
    '',
  ];

  if (requirements.length === 0) {
    lines.push('  No acceptance criteria found in ticket description.');
    lines.push('  Add a "Acceptance Criteria" section or Given/When/Then statements.');
    lines.push('');
    return lines.join('\n');
  }

  for (const { requirement, status, evidence } of results) {
    const icon = STATUS_ICON[status] ?? '?';
    lines.push(`  ${icon} ${requirement}`);
    if (evidence) lines.push(`      └─ ${evidence}`);
  }

  lines.push('');
  lines.push(`  Coverage: ${coveragePercent}%  (${results.filter(r => r.status === 'FOUND').length}/${results.length} requirements found)`);
  lines.push('');

  if (!isPro) {
    const remaining = FREE_LIMIT - usage.count - 1; // -1 for current check (already incremented)
    lines.push(`  Free tier: ${remaining} compliance check${remaining !== 1 ? 's' : ''} remaining this month.`);
    lines.push(`  Upgrade to Pro for unlimited checks.`);
    lines.push('');
  }

  return lines.join('\n');
}

export async function runComplianceCheck({
  brief,
  ticketKey,
  configDir = DEFAULT_CONFIG_DIR,
  stream = process.stderr,
  isLicensedFn       = isLicensed,
  showUpgradeFn      = showUpgradePrompt,
  checkUsageFn       = checkUsage,
  incrementUsageFn   = incrementUsage,
  extractRequirementsFn = extractRequirements,
  findLinkedCommitsFn   = findLinkedCommits,
  analyzeDiffFn         = analyzeDiff,
}) {
  const isPro = isLicensedFn('pro', configDir);
  const usage = checkUsageFn(configDir);

  if (!isPro && !usage.canUse) {
    showUpgradeFn('pro', '--compliance', { stream });
    return null;
  }

  // Increment before running (server-side is authoritative; local is UX only)
  incrementUsageFn(configDir);

  const requirements = extractRequirementsFn(brief);
  const { diff } = findLinkedCommitsFn(ticketKey, { cwd: process.cwd() });
  const analysis = analyzeDiffFn(requirements, diff);

  const report = formatReport({ ticketKey, requirements, analysis, usage, isPro });
  return { report, coveragePercent: analysis.coveragePercent };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd ~/Desktop/Projects/ticket-lens && node --test skills/jtb/scripts/test/compliance-checker.test.mjs 2>&1 | tail -5
```

Expected: all tests pass, 0 failures.

- [ ] **Step 5: Run full suite**

```bash
cd ~/Desktop/Projects/ticket-lens && npm test 2>&1 | tail -5
```

Expected: `pass 571` (or higher), `fail 0`

- [ ] **Step 6: Commit**

```bash
cd ~/Desktop/Projects/ticket-lens
git add skills/jtb/scripts/lib/compliance-checker.mjs skills/jtb/scripts/test/compliance-checker.test.mjs
git commit -m "feat: compliance-checker orchestrator — ties together all compliance modules"
```

---

### Task 6: CLI `--compliance` flag

**Files:**
- Modify: `skills/jtb/scripts/fetch-ticket.mjs`
- Modify: `skills/jtb/scripts/lib/help.mjs`

**Where to add the flag in `fetch-ticket.mjs`:** After the `--summarize` block (around line 170-200). The flag is `--compliance` and works similarly to `--summarize` — gated behind `isLicensed` via `runComplianceCheck`.

- [ ] **Step 1: Read `fetch-ticket.mjs` to find insertion point**

Read `skills/jtb/scripts/fetch-ticket.mjs` lines 155-230 to locate where `--summarize` result is appended to `brief` and where `process.stdout.write(brief)` occurs.

- [ ] **Step 2: Add import to `fetch-ticket.mjs`**

At the top of `fetch-ticket.mjs`, add after the existing imports:

```js
import { runComplianceCheck } from './lib/compliance-checker.mjs';
```

- [ ] **Step 3: Add `--compliance` flag handling**

Find the block that handles `--summarize` in the main execution flow of `fetch-ticket.mjs`. After the summarize block (before final `process.stdout.write`), add:

```js
  if (args.includes('--compliance')) {
    const checkResult = await runComplianceCheck({
      brief,
      ticketKey: resolvedKey,
      configDir,
    });
    if (checkResult === null) {
      process.exitCode = 1;
    } else {
      brief += '\n' + checkResult.report;
    }
  }
```

Where `resolvedKey` is the ticket key variable (check existing code for exact name — look for the variable holding the final resolved Jira ticket key like `ticketKey` or `key`).

- [ ] **Step 4: Add `--compliance` to help text in `help.mjs`**

In `printHelp()` and `printFetchHelp()`, add after the `--check` line:

```js
`    ${s.brand('--compliance')}       Check ticket requirements against local diff  ${s.dim('[Pro/Free 3/mo]')}`,
```

- [ ] **Step 5: Run full test suite**

```bash
cd ~/Desktop/Projects/ticket-lens && npm test 2>&1 | tail -5
```

Expected: `pass 571` (or higher), `fail 0`

- [ ] **Step 6: Commit**

```bash
cd ~/Desktop/Projects/ticket-lens
git add skills/jtb/scripts/fetch-ticket.mjs skills/jtb/scripts/lib/help.mjs
git commit -m "feat: --compliance flag — check ticket requirements against local git diff"
```

---

### Task 7: Backend `POST /v1/compliance` endpoint

**Files:**
- Create: `ticketlens-api/app/Http/Controllers/Api/ComplianceController.php`
- Create: `ticketlens-api/app/Http/Requests/ComplianceRequest.php`
- Modify: `ticketlens-api/routes/api.php`
- Create: `ticketlens-api/tests/Feature/ComplianceControllerTest.php`

**Purpose:** Server-side compliance check for cloud mode (bypass-proof cap enforcement). Calls Anthropic to do the analysis server-side. License key validated by existing `auth.license` middleware.

- [ ] **Step 0: Check auth pattern used by existing Feature tests**

Read one existing Feature test (e.g., `tests/Feature/SummarizeControllerTest.php`) to understand how the `auth.license` middleware is handled in test mode. Use the same pattern for all tests below.

- [ ] **Step 1: Write the failing tests**

Create `ticketlens-api/tests/Feature/ComplianceControllerTest.php`:

```php
<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ComplianceControllerTest extends TestCase
{
    use RefreshDatabase;

    private function authHeaders(): array
    {
        return ['Authorization' => 'Bearer test-license-key-' . str_repeat('a', 20)];
    }

    public function test_returns_422_when_brief_missing(): void
    {
        $response = $this->postJson('/v1/compliance', [], $this->authHeaders());
        $response->assertStatus(422);
        $response->assertJsonValidationErrors(['brief']);
    }

    public function test_returns_422_when_brief_too_long(): void
    {
        $response = $this->postJson('/v1/compliance', [
            'brief' => str_repeat('x', 50001),
            'ticketKey' => 'PROJ-123',
        ], $this->authHeaders());
        $response->assertStatus(422);
    }

    public function test_returns_422_when_ticket_key_invalid_format(): void
    {
        $response = $this->postJson('/v1/compliance', [
            'brief' => 'Some brief text',
            'ticketKey' => 'invalid key; rm -rf',
        ], $this->authHeaders());
        $response->assertStatus(422);
        $response->assertJsonValidationErrors(['ticketKey']);
    }

    public function test_returns_200_with_compliance_result(): void
    {
        config(['ticketlens.skip_license' => true]);

        $response = $this->postJson('/v1/compliance', [
            'brief' => "Acceptance Criteria:\n- Must validate email",
            'ticketKey' => 'PROJ-123',
        ], $this->authHeaders());

        $response->assertStatus(200);
        $response->assertJsonStructure(['requirements', 'results', 'coveragePercent']);
    }

    public function test_returns_401_without_auth_header(): void
    {
        $response = $this->postJson('/v1/compliance', [
            'brief' => 'Some brief',
            'ticketKey' => 'PROJ-123',
        ]);
        $response->assertStatus(401);
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd ~/Desktop/Projects/ticketlens-api && php artisan test tests/Feature/ComplianceControllerTest.php 2>&1 | tail -10
```

Expected: FAIL (route not found / class not found).

- [ ] **Step 3: Create `ComplianceRequest.php`**

```php
<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class ComplianceRequest extends FormRequest
{
    public function authorize(): bool { return true; }

    public function rules(): array
    {
        return [
            'ticketKey' => ['nullable', 'string', 'regex:/^[A-Z]+-\d+$/', 'max:50'],
            'brief'     => ['required', 'string', 'max:50000'],
        ];
    }

    protected function prepareForValidation(): void
    {
        if ($this->has('brief')) {
            $this->merge(['brief' => str_replace("\x00", '', $this->input('brief'))]);
        }
    }
}
```

- [ ] **Step 4: Create `ComplianceController.php`**

```php
<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\ComplianceRequest;
use App\Services\AnthropicService;
use Illuminate\Http\JsonResponse;

class ComplianceController
{
    public function __construct(private readonly AnthropicService $anthropic) {}

    public function handle(ComplianceRequest $request): JsonResponse
    {
        $brief     = $request->validated('brief');
        $ticketKey = $request->validated('ticketKey') ?? 'UNKNOWN';

        // Extract requirements from brief text (server-side — same heuristic as CLI)
        $requirements = $this->extractRequirements($brief);

        if (empty($requirements)) {
            return response()->json([
                'requirements'    => [],
                'results'         => [],
                'coveragePercent' => 0,
                'message'         => 'No acceptance criteria found in the ticket brief.',
            ]);
        }

        // Use Anthropic to analyze the brief against its own requirements
        $prompt = "You are a compliance checker. Given this Jira ticket brief, evaluate whether each acceptance criterion listed is addressed in the ticket's description or mentioned code changes.\n\n"
            . "Brief:\n{$brief}\n\n"
            . "Requirements to check:\n"
            . implode("\n", array_map(fn($r) => "- {$r}", $requirements))
            . "\n\nFor each requirement, respond with: FOUND, PARTIAL, or NOT_FOUND. One per line, format: '<requirement> | <status>'.";

        $rawAnalysis = $this->anthropic->summarize($prompt);

        $results = $this->parseAnalysis($requirements, $rawAnalysis);
        $found   = count(array_filter($results, fn($r) => $r['status'] === 'FOUND'));
        $partial = count(array_filter($results, fn($r) => $r['status'] === 'PARTIAL'));
        $coverage = empty($results) ? 0 : (int) round(($found + $partial * 0.5) / count($results) * 100);

        return response()->json([
            'requirements'    => $requirements,
            'results'         => $results,
            'coveragePercent' => $coverage,
        ]);
    }

    private function extractRequirements(string $text): array
    {
        $lines = explode("\n", $text);
        $results = [];
        $inAc = false;

        foreach ($lines as $line) {
            if (preg_match('/^\s*#+\s*acceptance criteria\s*$/i', $line)) {
                $inAc = true;
                continue;
            }
            if ($inAc && preg_match('/^\s*#+\s/', $line)) {
                $inAc = false;
            }
            if (preg_match('/^\s*(given|when|then)\s+(.+)/i', $line, $m)) {
                $results[] = trim($line);
                continue;
            }
            if (preg_match('/^\s*[-*]\s+(.+(?:must|should|shall|ensure|verify).+)/i', $line, $m)) {
                $results[] = trim($m[1]);
                continue;
            }
            if ($inAc && preg_match('/^\s*[-*\d.]\s*(.+)/', $line, $m)) {
                $results[] = trim($m[1]);
            }
        }

        return array_values(array_unique(array_filter($results)));
    }

    private function parseAnalysis(array $requirements, string $rawAnalysis): array
    {
        $results = [];
        foreach ($requirements as $req) {
            $status = 'NOT_FOUND';
            foreach (explode("\n", $rawAnalysis) as $line) {
                if (str_contains(strtolower($line), strtolower(substr($req, 0, 20)))) {
                    if (str_contains(strtoupper($line), 'FOUND') && !str_contains(strtoupper($line), 'NOT_FOUND')) {
                        $status = str_contains(strtoupper($line), 'PARTIAL') ? 'PARTIAL' : 'FOUND';
                    } elseif (str_contains(strtoupper($line), 'PARTIAL')) {
                        $status = 'PARTIAL';
                    }
                    break;
                }
            }
            $results[] = ['requirement' => $req, 'status' => $status, 'evidence' => null];
        }
        return $results;
    }
}
```

- [ ] **Step 5: Register route in `routes/api.php`**

Add after the last existing route inside the middleware group:

```php
Route::post('/v1/compliance', [ComplianceController::class, 'handle'])->middleware('throttle:summarize');
```

And add the import at the top of `routes/api.php`:

```php
use App\Http\Controllers\Api\ComplianceController;
```

- [ ] **Step 6: Run backend tests to verify they pass**

```bash
cd ~/Desktop/Projects/ticketlens-api && php artisan test tests/Feature/ComplianceControllerTest.php 2>&1 | tail -10
```

Expected: all 5 tests pass.

- [ ] **Step 7: Run full backend suite to confirm no regression**

```bash
cd ~/Desktop/Projects/ticketlens-api && php artisan test 2>&1 | tail -5
```

Expected: all 44+ tests pass, 0 failures.

- [ ] **Step 8: Commit backend changes**

```bash
cd ~/Desktop/Projects/ticketlens-api
git add app/Http/Controllers/Api/ComplianceController.php \
        app/Http/Requests/ComplianceRequest.php \
        routes/api.php \
        tests/Feature/ComplianceControllerTest.php
git commit -m "feat: POST /v1/compliance endpoint — server-side compliance check"
```

---

### Task 8: Final count verification

- [ ] **Step 1: Run full CLI test suite and count**

```bash
cd ~/Desktop/Projects/ticket-lens && npm test 2>&1 | grep -E 'pass|fail'
```

Expected: `pass` ≥ 564, `fail` 0. (534 baseline + ~10 requirement-extractor + 7 usage-tracker + 7 commit-linker + 8 diff-analyzer + 8 compliance-checker = ~574)

- [ ] **Step 2: Run backend test suite**

```bash
cd ~/Desktop/Projects/ticketlens-api && php artisan test 2>&1 | tail -5
```

Expected: ≥ 44 tests (39 existing + 5 new compliance), 0 failures.

- [ ] **Step 3: Smoke test `--compliance` flag**

```bash
cd ~/Desktop/Projects/ticket-lens && node bin/ticketlens.mjs --help | grep compliance
```

Expected: `--compliance` appears in output.

- [ ] **Step 4: Update SKILL.md to document --compliance**

In `skills/jtb/SKILL.md`, find the section listing available flags. Add:

```markdown
- `--compliance` — Check ticket acceptance criteria against local VCS diff. Reports ✔/✖/~ per requirement with coverage %. Free: 3/month. Pro: unlimited.
```

- [ ] **Step 5: Final commit**

```bash
cd ~/Desktop/Projects/ticket-lens
git add skills/jtb/SKILL.md
git commit -m "docs: document --compliance flag in SKILL.md"
```
