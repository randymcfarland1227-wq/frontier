import type { SourceAdapter } from './types';

/**
 * Phase 1 stub — no live Site Repair Log calls yet.
 * Wire secrets / OAuth / postMessage origin updates in a later pass.
 */
export const repairAdapter: SourceAdapter = {
  id: 'repair',
  label: 'Site Repair Log',
  mode: 'postMessage',
  async refresh() {
    return null;
  },
};
