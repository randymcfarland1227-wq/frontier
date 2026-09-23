import type { SourceAdapter } from './types';

/**
 * Phase 1 stub — no live Gmail Starred calls yet.
 * Wire secrets / OAuth / postMessage origin updates in a later pass.
 */
export const gmailAdapter: SourceAdapter = {
  id: 'gmail',
  label: 'Gmail Starred',
  mode: 'api',
  async refresh() {
    return null;
  },
};
