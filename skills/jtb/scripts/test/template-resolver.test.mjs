import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveTemplate, SYSTEM_TEMPLATES } from '../lib/template-resolver.mjs';
import { assembleBrief } from '../lib/brief-assembler.mjs';

// ── helpers ──────────────────────────────────────────────────────────────────

function makeApiTemplates() {
  return [
    {
      id: 1, slug: 'full', name: 'Full Brief', is_system: true,
      sections: { meta: true, description: true, comments: { enabled: true, max: 10 }, linked: true, code_refs: true, confluence: true, attachments: true },
    },
    {
      id: 2, slug: 'quick', name: 'Quick Scan', is_system: true,
      sections: { meta: true, description: false, comments: { enabled: true, max: 2 }, linked: false, code_refs: false, confluence: false, attachments: false },
    },
    {
      id: 3, slug: 'code-review', name: 'Code Review', is_system: true,
      sections: { meta: true, description: true, comments: { enabled: false, max: 0 }, linked: true, code_refs: true, confluence: false, attachments: false },
    },
    {
      id: 4, slug: 'my-team-template', name: 'My Team Template', is_system: false,
      sections: { meta: true, description: true, comments: { enabled: true, max: 5 }, linked: false, code_refs: false, confluence: false, attachments: false },
    },
  ];
}

function makeJsonFetch(templates) {
  return async (_url, _opts) => ({
    ok: true,
    json: async () => templates,
  });
}

function makeFailFetch() {
  return async (_url, _opts) => { throw new Error('Network failure'); };
}

// ── SYSTEM_TEMPLATES export ───────────────────────────────────────────────────

describe('SYSTEM_TEMPLATES', () => {
  it('exports all three system template slugs', () => {
    assert.ok(Array.isArray(SYSTEM_TEMPLATES), 'SYSTEM_TEMPLATES must be an array');
    const slugs = SYSTEM_TEMPLATES.map(t => t.slug);
    assert.ok(slugs.includes('full'), 'full template present');
    assert.ok(slugs.includes('quick'), 'quick template present');
    assert.ok(slugs.includes('code-review'), 'code-review template present');
  });

  it('quick template limits comments to 2 and disables description', () => {
    const quick = SYSTEM_TEMPLATES.find(t => t.slug === 'quick');
    assert.ok(quick, 'quick template must exist');
    assert.strictEqual(quick.sections.description, false, 'quick disables description');
    assert.strictEqual(quick.sections.comments.enabled, true, 'quick enables comments');
    assert.strictEqual(quick.sections.comments.max, 2, 'quick limits to 2 comments');
    assert.strictEqual(quick.sections.linked, false, 'quick disables linked tickets');
  });

  it('code-review template disables comments and enables linked+code_refs', () => {
    const cr = SYSTEM_TEMPLATES.find(t => t.slug === 'code-review');
    assert.ok(cr, 'code-review template must exist');
    assert.strictEqual(cr.sections.comments.enabled, false, 'code-review disables comments');
    assert.strictEqual(cr.sections.linked, true, 'code-review enables linked');
    assert.strictEqual(cr.sections.code_refs, true, 'code-review enables code_refs');
    assert.strictEqual(cr.sections.confluence, false, 'code-review disables confluence');
  });

  it('full template enables all sections', () => {
    const full = SYSTEM_TEMPLATES.find(t => t.slug === 'full');
    assert.ok(full, 'full template must exist');
    assert.strictEqual(full.sections.description, true);
    assert.strictEqual(full.sections.comments.enabled, true);
    assert.strictEqual(full.sections.linked, true);
    assert.strictEqual(full.sections.code_refs, true);
    assert.strictEqual(full.sections.confluence, true);
    assert.strictEqual(full.sections.attachments, true);
  });
});

// ── resolveTemplate — slug validation ────────────────────────────────────────

describe('resolveTemplate — slug validation', () => {
  it('throws for an empty slug', async () => {
    await assert.rejects(
      () => resolveTemplate('', { token: null }),
      /invalid.*slug/i,
    );
  });

  it('throws for a slug with uppercase letters', async () => {
    await assert.rejects(
      () => resolveTemplate('MyTemplate', { token: null }),
      /invalid.*slug/i,
    );
  });

  it('throws for a slug with special characters', async () => {
    await assert.rejects(
      () => resolveTemplate('../../etc/passwd', { token: null }),
      /invalid.*slug/i,
    );
  });

  it('throws for a slug exceeding 64 characters', async () => {
    await assert.rejects(
      () => resolveTemplate('a'.repeat(65), { token: null }),
      /invalid.*slug/i,
    );
  });

  it('accepts valid slugs: lowercase, hyphens, underscores', async () => {
    const result = await resolveTemplate('quick', { token: null });
    assert.strictEqual(result.slug, 'quick');
    const result2 = await resolveTemplate('code-review', { token: null });
    assert.strictEqual(result2.slug, 'code-review');
  });
});

// ── resolveTemplate — API response validation ─────────────────────────────────

describe('resolveTemplate — API response validation', () => {
  it('falls back to system template when API returns a non-array (object)', async () => {
    const objectFetch = async () => ({ ok: true, json: async () => ({ error: 'unexpected' }) });
    const result = await resolveTemplate('quick', { token: 'tl_test', fetcher: objectFetch });
    assert.strictEqual(result.slug, 'quick', 'must fall back to system quick template');
  });

  it('falls back to system template when API returns null', async () => {
    const nullFetch = async () => ({ ok: true, json: async () => null });
    const result = await resolveTemplate('full', { token: 'tl_test', fetcher: nullFetch });
    assert.strictEqual(result.slug, 'full');
  });
});

// ── resolveTemplate — offline mode ────────────────────────────────────────────

describe('resolveTemplate — no CLI token (offline mode)', () => {
  it('resolves system slug "quick" without a token and warns stderr', async () => {
    const lines = [];
    const orig  = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk, ...rest) => { lines.push(String(chunk)); return orig(chunk, ...rest); };
    try {
      const result = await resolveTemplate('quick', { token: null, fetcher: makeFailFetch() });
      assert.ok(result, 'must return a template');
      assert.strictEqual(result.slug, 'quick', 'must return the quick template');
      assert.ok(lines.some(l => /quick|local|system|offline/i.test(l)), `must warn stderr: ${lines.join('')}`);
    } finally {
      process.stderr.write = orig;
    }
  });

  it('resolves system slug "code-review" without a token', async () => {
    const result = await resolveTemplate('code-review', { token: null, fetcher: makeFailFetch() });
    assert.strictEqual(result.slug, 'code-review');
  });

  it('resolves system slug "full" without a token', async () => {
    const result = await resolveTemplate('full', { token: null, fetcher: makeFailFetch() });
    assert.strictEqual(result.slug, 'full');
  });

  it('throws for unknown custom slug without a token', async () => {
    await assert.rejects(
      () => resolveTemplate('my-team-template', { token: null, fetcher: makeFailFetch() }),
      (err) => {
        assert.ok(/not found|login/i.test(err.message), `error must mention not found or login: ${err.message}`);
        return true;
      },
    );
  });
});

// ── resolveTemplate — online mode ────────────────────────────────────────────

describe('resolveTemplate — with CLI token (online mode)', () => {
  it('fetches from /v1/templates and returns the matching template', async () => {
    const result = await resolveTemplate('quick', { token: 'tl_test', fetcher: makeJsonFetch(makeApiTemplates()) });
    assert.strictEqual(result.slug, 'quick');
    assert.strictEqual(result.sections.comments.max, 2);
  });

  it('resolves custom team template found in API response', async () => {
    const result = await resolveTemplate('my-team-template', { token: 'tl_test', fetcher: makeJsonFetch(makeApiTemplates()) });
    assert.strictEqual(result.slug, 'my-team-template');
    assert.strictEqual(result.is_system, false);
  });

  it('throws for custom slug not returned by API', async () => {
    const templates = makeApiTemplates().filter(t => t.slug !== 'my-team-template');
    await assert.rejects(
      () => resolveTemplate('unknown-custom', { token: 'tl_test', fetcher: makeJsonFetch(templates) }),
      /not found/i,
    );
  });

  it('falls back to system template on network error and warns stderr', async () => {
    const lines = [];
    const orig  = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk, ...rest) => { lines.push(String(chunk)); return orig(chunk, ...rest); };
    try {
      const result = await resolveTemplate('quick', { token: 'tl_test', fetcher: makeFailFetch() });
      assert.strictEqual(result.slug, 'quick', 'falls back to system quick template');
      assert.ok(lines.some(l => /quick|local|system|offline|warn/i.test(l)), `must warn stderr: ${lines.join('')}`);
    } finally {
      process.stderr.write = orig;
    }
  });

  it('falls back to system template when API returns error status', async () => {
    const badFetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
    const result = await resolveTemplate('full', { token: 'tl_test', fetcher: badFetch });
    assert.strictEqual(result.slug, 'full');
  });
});

// ── assembleBrief — sections filter ─────────────────────────────────────────

describe('assembleBrief — sections filter', () => {
  const ticketWithAll = {
    key: 'F18-1', summary: 'Brief template test', type: 'Story', status: 'Open',
    priority: 'High', assignee: 'Dev', reporter: 'QA',
    description: 'Full description here.',
    comments: [
      { author: 'A', body: 'Comment 1', created: '2026-01-01T00:00:00Z' },
      { author: 'B', body: 'Comment 2', created: '2026-01-02T00:00:00Z' },
      { author: 'C', body: 'Comment 3', created: '2026-01-03T00:00:00Z' },
    ],
    linkedTicketDetails: [{ key: 'F18-2', summary: 'Linked', type: 'Bug', status: 'Open', description: 'Linked desc' }],
    confluencePages: [{ title: 'Wiki', text: 'Some wiki content.' }],
    attachments: [{ id: 'a1', filename: 'doc.txt', mimeType: 'text/plain', size: 50, content: 'https://example.com/doc.txt' }],
  };
  const codeRefs = { filePaths: ['/lib/foo.js'], methods: [], classes: [], shas: [], svnRevisions: [], branches: [], namespaces: [] };

  const quickSections = { meta: true, description: false, comments: { enabled: true, max: 2 }, linked: false, code_refs: false, confluence: false, attachments: false };
  const crSections   = { meta: true, description: true,  comments: { enabled: false, max: 0 }, linked: true, code_refs: true, confluence: false, attachments: false };

  it('quick sections: omits description', () => {
    const result = assembleBrief(ticketWithAll, null, quickSections);
    assert.ok(!result.includes('## Description'), 'quick must omit description');
  });

  it('quick sections: limits comments to max 2', () => {
    const result = assembleBrief(ticketWithAll, null, quickSections);
    assert.ok(result.includes('Comment 1'), '1st comment present');
    assert.ok(result.includes('Comment 2'), '2nd comment present');
    assert.ok(!result.includes('Comment 3'), '3rd comment must be truncated by quick template');
  });

  it('quick sections: omits linked tickets, confluence, attachments', () => {
    const result = assembleBrief(ticketWithAll, null, quickSections);
    assert.ok(!result.includes('## Linked Tickets'), 'linked section absent');
    assert.ok(!result.includes('## Confluence Pages'), 'confluence section absent');
    assert.ok(!result.includes('## Attachments'), 'attachments section absent');
  });

  it('code-review sections: omits comments', () => {
    const result = assembleBrief(ticketWithAll, codeRefs, crSections);
    assert.ok(!result.includes('## Comments'), 'code-review must omit comments');
  });

  it('code-review sections: includes description, linked, code_refs', () => {
    const result = assembleBrief(ticketWithAll, codeRefs, crSections);
    assert.ok(result.includes('## Description'), 'description present');
    assert.ok(result.includes('## Linked Tickets'), 'linked present');
    assert.ok(result.includes('## Code References'), 'code refs present');
  });

  it('meta (header + meta line) is always included regardless of sections', () => {
    const noEverything = { meta: false, description: false, comments: { enabled: false, max: 0 }, linked: false, code_refs: false, confluence: false, attachments: false };
    const result = assembleBrief(ticketWithAll, null, noEverything);
    assert.ok(result.includes('# F18-1:'), 'header always present');
    assert.ok(result.includes('**Type:**'), 'meta line always present');
  });

  it('code_refs excluded when sections.code_refs is false', () => {
    const noCodeRefs = { ...quickSections, code_refs: false };
    const result = assembleBrief(ticketWithAll, codeRefs, noCodeRefs);
    assert.ok(!result.includes('## Code References'), 'code refs section absent when disabled');
  });

  it('attachments excluded when sections.attachments is false', () => {
    const result = assembleBrief(ticketWithAll, null, quickSections);
    assert.ok(!result.includes('## Attachments'), 'attachments section absent when disabled');
  });
});
