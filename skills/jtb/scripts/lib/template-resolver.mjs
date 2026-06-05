/**
 * Resolves a brief template by slug.
 * System templates (full / quick / code-review) are hardcoded and work offline.
 * Custom team templates require a CLI token and are fetched from /v1/templates.
 */

import { getApiBase } from './sync.mjs';

export const SYSTEM_TEMPLATES = [
  {
    slug: 'full',
    name: 'Full Brief',
    is_system: true,
    sections: {
      meta:        true,
      description: true,
      comments:    { enabled: true, max: 10 },
      linked:      true,
      code_refs:   true,
      confluence:  true,
      attachments: true,
    },
  },
  {
    slug: 'quick',
    name: 'Quick Scan',
    is_system: true,
    sections: {
      meta:        true,
      description: false,
      comments:    { enabled: true, max: 2 },
      linked:      false,
      code_refs:   false,
      confluence:  false,
      attachments: false,
    },
  },
  {
    slug: 'code-review',
    name: 'Code Review',
    is_system: true,
    sections: {
      meta:        true,
      description: true,
      comments:    { enabled: false, max: 0 },
      linked:      true,
      code_refs:   true,
      confluence:  false,
      attachments: false,
    },
  },
];

const SYSTEM_SLUGS = new Set(SYSTEM_TEMPLATES.map(t => t.slug));

/**
 * Resolve a template by slug.
 *
 * @param {string}  slug
 * @param {object}  opts
 * @param {string|null} opts.token    CLI token (null = offline)
 * @param {Function}    [opts.fetcher] globalThis.fetch override (for testing)
 * @returns {Promise<object>} template with { slug, sections, is_system, ... }
 * @throws  {Error} if slug is unknown and cannot be resolved
 */
export async function resolveTemplate(slug, { token, fetcher = globalThis.fetch } = {}) {
  if (!slug || !/^[a-z0-9_-]{1,64}$/.test(slug)) {
    throw new Error(`Invalid template slug "${slug}". Use lowercase letters, numbers, hyphens, or underscores (max 64 chars).`);
  }

  const systemMatch = SYSTEM_TEMPLATES.find(t => t.slug === slug);

  if (!token) {
    if (systemMatch) {
      process.stderr.write(
        `  ○ Template "${slug}" resolved from local system definitions (no login required).\n`,
      );
      return systemMatch;
    }
    throw new Error(
      `Template "${slug}" not found. Custom templates require \`ticketlens login\`.`,
    );
  }

  // Try the API first.
  let apiTemplates = null;
  try {
    const res = await fetcher(`${getApiBase()}/v1/templates`, {
      headers:  { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal:   AbortSignal.timeout(10_000),
    });
    if (res.ok) {
      apiTemplates = await res.json();
    } else {
      process.stderr.write(`  ⚠ Could not fetch templates (HTTP ${res.status}) — using local system definitions.\n`);
    }
  } catch {
    process.stderr.write(`  ⚠ Could not reach templates API — using local system definitions.\n`);
  }

  if (apiTemplates) {
    if (!Array.isArray(apiTemplates)) {
      process.stderr.write(`  ⚠ Unexpected templates API response format — using local system definitions.\n`);
    } else {
      const found = apiTemplates.find(t => t.slug === slug);
      if (found) return found;
      throw new Error(
        `Template "${slug}" not found. Available templates: ${apiTemplates.map(t => t.slug).join(', ')}.`,
      );
    }
  }

  // API unreachable — fall back to system templates
  if (systemMatch) {
    process.stderr.write(`  ⚠ Using local system template "${slug}" (API unavailable).\n`);
    return systemMatch;
  }

  throw new Error(
    `Template "${slug}" not found and API is unreachable. Custom templates require \`ticketlens login\`.`,
  );
}
