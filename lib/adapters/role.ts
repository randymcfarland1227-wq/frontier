import type { SourceAdapter } from './types';

/**
 * Phase 1 stub — no live Role Hub calls yet.
 * Wire secrets / OAuth / postMessage origin updates in a later pass.
 */
export const roleAdapter: SourceAdapter = {
  id: 'role',
  label: 'Role Hub',
  mode: 'postMessage',
  async refresh() {
    return null;
  },
};
