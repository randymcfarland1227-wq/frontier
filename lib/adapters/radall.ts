import type { SourceAdapter } from './types';

/**
 * Phase 1 stub — no live Radall Google Sheet calls yet.
 * Wire secrets / OAuth / postMessage origin updates in a later pass.
 */
export const radallAdapter: SourceAdapter = {
  id: 'radall',
  label: 'Radall Google Sheet',
  mode: 'api',
  async refresh() {
    return null;
  },
};
