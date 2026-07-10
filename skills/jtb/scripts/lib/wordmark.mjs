/**
 * First-run wordmark banner: block-letter "TICKETLENS" art plus version,
 * GitHub, npm, website, and author. Shown once — postinstall message and
 * the future first-run onboarding hub. Never on regular command output.
 */

import { createStyler } from './ansi.mjs';
import { getPackageMeta } from './config.mjs';
import { siteBase } from './api-utils.mjs';

const NPM_PACKAGE_URL = 'npmjs.com/package/ticketlens';
const ART_WIDTH = 79;

const BLOCK_ART = [
  '████████╗██╗ ██████╗██╗  ██╗███████╗████████╗██╗     ███████╗███╗   ██╗███████╗',
  '╚══██╔══╝██║██╔════╝██║ ██╔╝██╔════╝╚══██╔══╝██║     ██╔════╝████╗  ██║██╔════╝',
  '   ██║   ██║██║     █████╔╝ █████╗     ██║   ██║     █████╗  ██╔██╗ ██║███████╗',
  '   ██║   ██║██║     ██╔═██╗ ██╔══╝     ██║   ██║     ██╔══╝  ██║╚██╗██║╚════██║',
  '   ██║   ██║╚██████╗██║  ██╗███████╗   ██║   ███████╗███████╗██║ ╚████║███████║',
  '   ╚═╝   ╚═╝ ╚═════╝╚═╝  ╚═╝╚══════╝   ╚═╝   ╚══════╝╚══════╝╚═╝  ╚═══╝╚══════╝',
];

function normalizeRepoUrl(url) {
  return url.replace(/^git\+/, '').replace(/\.git$/, '').replace(/^https?:\/\//, '');
}

function envAwareStyler(isTTY) {
  return createStyler({
    isTTY,
    forceColor: !!process.env.FORCE_COLOR,
    noColor: !!process.env.NO_COLOR,
    term: process.env.TERM,
    colorterm: process.env.COLORTERM,
  });
}

export function renderWordmark({ stream = process.stdout } = {}) {
  const { version, author, repository } = getPackageMeta();
  const repoDisplay = normalizeRepoUrl(repository);
  const siteUrl = siteBase();
  const siteDisplay = siteUrl.replace(/^https?:\/\//, '');

  const fitsArt = stream.isTTY && (stream.columns == null || stream.columns >= ART_WIDTH);
  if (!fitsArt) {
    return `TicketLens v${version} — ${repoDisplay} · ${NPM_PACKAGE_URL} · ${siteDisplay} · ${author}\n`;
  }

  const s = envAwareStyler(stream.isTTY);
  const versionAndRepoLine = [s.dim(`v${version}`), s.dim('·'), s.cyan(repoDisplay), s.dim('·'), s.cyan(NPM_PACKAGE_URL)].join(' ');
  const siteAndAuthorLine = [s.cyan(siteDisplay), s.dim('·'), s.dim(author)].join(' ');

  return [
    ...BLOCK_ART.map((line) => s.brand(line)),
    '',
    `  ${versionAndRepoLine}`,
    `  ${siteAndAuthorLine}`,
    '',
  ].join('\n') + '\n';
}
