import type { SourceAdapter } from './types';

/**
 * Phase 1 stub — no live Move OS calls yet.
 * Wire secrets / OAuth / postMessage origin updates in a later pass.
 */
export const moveAdapter: SourceAdapter = {
  id: 'move',
  label: 'Move OS',
  mode: 'postMessage',
  async refresh() {
    return null;
  },
};
