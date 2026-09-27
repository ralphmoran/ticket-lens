/**
 * Backlog #27 — open a real GitHub PR compare page for a ticket,
 * prefilled with the same markdown `ticketlens pr KEY` already prints.
 * GitHub only (v1). No repo-write credential: builds a `/compare` URL
 * and opens it in the browser — GitHub itself handles PR creation.
 */

import { spawnSync } from 'node:child_process';
import { scanCurrentBranch } from './branch-scanner.mjs';
import { openBrowser } from './browser-login.mjs';
import { runGit, detectRemoteUrl } from './git-exec.mjs';

const MAX_BODY_LEN = 4000;
// Repo group excludes only a trailing ".git", not every dot — real GitHub
// repos commonly contain one (next.js, socket.io); code review caught the
// original ([^/.]+?) form wrongly refusing every one of them.
const GITHUB_REMOTE_RE = /github\.com[:/]([^/]+)\/(.+?)(\.git)?$/;

export function parseGitHubRemote(remoteUrl) {
  if (!remoteUrl) return null;
  const m = remoteUrl.match(GITHUB_REMOTE_RE);
  return m ? { owner: m[1], repo: m[2] } : null;
}

// A literal "/" is common and load-bearing in real branch/repo names
// (feature/foo) and GitHub's own compare URLs handle it unencoded — a blanket
// encodeURIComponent would break that. "#" is the one character that must be
// escaped here: left raw, it starts a URL fragment and silently truncates
// everything after it (including title/body), rather than 404ing loudly.
function escapeHash(segment) {
  return segment.replace(/#/g, '%23');
}

export function buildCompareUrl({ owner, repo, base, head, title, body, ticketKey }) {
  const bareBase = escapeHash(base.replace(/^origin\//, ''));
  const safeHead = escapeHash(head);
  const safeOwner = escapeHash(owner);
  const safeRepo = escapeHash(repo);
  let finalBody = body;
  if (finalBody.length > MAX_BODY_LEN) {
    const note = `\n\n_…truncated — full description: \`ticketlens pr ${ticketKey ?? head}\`_`;
    finalBody = finalBody.slice(0, MAX_BODY_LEN) + note;
  }
  const params = new URLSearchParams({ expand: '1', title, body: finalBody });
  return `https://github.com/${safeOwner}/${safeRepo}/compare/${bareBase}...${safeHead}?${params.toString()}`;
}

/**
 * @param {string} ticketKey
 * @param {string} markdown - the exact markdown assemblePr() already produced
 * @param {object} [opts]
 * @returns {Promise<{ok: true, url: string} | {ok: false, reason: string, message: string}>}
 */
export async function openPr(ticketKey, markdown, {
  cwd = process.cwd(),
  execFn = spawnSync,
  scanCurrentBranchFn = scanCurrentBranch,
  openBrowserFn = openBrowser,
} = {}) {
  const remoteUrl = detectRemoteUrl(execFn, cwd);
  const gh = parseGitHubRemote(remoteUrl);
  if (!gh) {
    return { ok: false, reason: 'not-github', message: 'No GitHub remote detected on origin — `pr --open` supports GitHub only.' };
  }

  const [scan] = scanCurrentBranchFn({ cwd, execFn }) ?? [];
  if (!scan || !scan.branch) {
    return { ok: false, reason: 'no-branch', message: 'Not on a real branch (detached HEAD, or not a git repository).' };
  }
  if (!scan.base) {
    return { ok: false, reason: 'no-base', message: 'No base branch detected (tried origin/main, origin/master, origin/develop, main, master).' };
  }
  if (scan.branch === scan.base.replace(/^origin\//, '')) {
    return { ok: false, reason: 'head-equals-base', message: `Already on the base branch ("${scan.branch}") — nothing to compare.` };
  }

  const pushed = runGit(execFn, ['rev-parse', '--verify', `origin/${scan.branch}`], cwd);
  if (pushed === null) {
    return { ok: false, reason: 'unpushed', message: `Branch "${scan.branch}" isn't pushed to origin yet — push it first, then re-run.` };
  }

  const firstNewline = markdown.indexOf('\n');
  const titleLine = (firstNewline === -1 ? markdown : markdown.slice(0, firstNewline)).replace(/^##\s*/, '');
  const body = firstNewline === -1 ? '' : markdown.slice(firstNewline + 1).trim();

  const url = buildCompareUrl({
    owner: gh.owner,
    repo: gh.repo,
    base: scan.base,
    head: scan.branch,
    title: titleLine,
    body,
    ticketKey,
  });

  try {
    openBrowserFn(url);
  } catch {
    // best-effort — the URL is still returned/printed either way
  }

  return { ok: true, url };
}
