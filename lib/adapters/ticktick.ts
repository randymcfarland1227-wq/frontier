import type { SourceAdapter } from './types';

/**
 * Live data arrives via public/data/ticktick.json once TICKTICK_ACCESS_TOKEN
 * exists on the sync box. Until then the committed file is an empty stub.
 */
export const ticktickAdapter: SourceAdapter = {
  id: 'ticktick',
  label: 'TickTick',
  mode: 'api',
  async refresh() {
    return null;
  },
};
