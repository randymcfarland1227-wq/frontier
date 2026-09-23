import type { SourceAdapter } from './types';

/**
 * Phase 1 stub — no live Income & Venture Lab calls yet.
 * Wire secrets / OAuth / postMessage origin updates in a later pass.
 */
export const incomeAdapter: SourceAdapter = {
  id: 'income',
  label: 'Income & Venture Lab',
  mode: 'postMessage',
  async refresh() {
    return null;
  },
};
