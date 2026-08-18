/**
 * The three Recall-capture strictness levels — single source of truth.
 * Zero imports of its own (a leaf module) so both profile-resolver.mjs and
 * recall-settings-sync.mjs can import it without risking a circular import
 * between those two.
 */

export const RECALL_STRICTNESS_LEVELS = ['loose', 'balanced', 'strict'];
export const DEFAULT_RECALL_STRICTNESS = 'balanced';
