import type { SourceAdapter } from './types';

/**
 * Phase 1 stub — no live TickTick calls yet.
 * Wire secrets / OAuth / postMessage origin updates in a later pass.
 */
export const ticktickAdapter: SourceAdapter = {
  id: 'ticktick',
  label: 'TickTick',
  mode: 'api',
  async refresh() {
    return null;
  },
};
