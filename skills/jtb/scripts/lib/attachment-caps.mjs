/**
 * Per-call attachment count caps, by tier. Byte caps (10 MB/file, 50 MB/call)
 * are unchanged and live next to the code that enforces them.
 * Mirrors ticketlens-api's RecallAttachmentStorage::maxFilesFor().
 */

import { isLicensed } from './license.mjs';
import { DEFAULT_CONFIG_DIR } from './config.mjs';

export const FREE_MAX_ATTACHMENTS = 10;
export const PAID_MAX_ATTACHMENTS = 50;

export function attachmentCapFor(configDir = DEFAULT_CONFIG_DIR, isLicensedFn = isLicensed) {
  return isLicensedFn('pro', configDir) ? PAID_MAX_ATTACHMENTS : FREE_MAX_ATTACHMENTS;
}

export function attachmentLimitNotice(count, cap, { verb = 'dropped', scope = 'call' } = {}) {
  const base = `${count} attachment(s) ${verb} — exceeds the ${cap}-file limit per ${scope}.`;
  return cap < PAID_MAX_ATTACHMENTS
    ? `${base} Upgrade to Pro for up to ${PAID_MAX_ATTACHMENTS}.`
    : base;
}
