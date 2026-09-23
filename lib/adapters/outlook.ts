import type { SourceAdapter } from './types';

/**
 * Phase 1 stub — no live Outlook calls yet.
 * Wire secrets / OAuth / postMessage origin updates in a later pass.
 */
export const outlookAdapter: SourceAdapter = {
  id: 'outlook',
  label: 'Outlook',
  mode: 'api',
  async refresh() {
    return null;
  },
};
