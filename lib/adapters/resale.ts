import type { SourceAdapter } from './types';

/**
 * Phase 1 stub — no live Resale Hub calls yet.
 * Wire secrets / OAuth / postMessage origin updates in a later pass.
 */
export const resaleAdapter: SourceAdapter = {
  id: 'resale',
  label: 'Resale Hub',
  mode: 'postMessage',
  async refresh() {
    return null;
  },
};
