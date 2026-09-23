import type { SourceAdapter } from './types';

/**
 * Peculiar Candle Pre Launch — iframe + postMessage (see LIFE_HUB.md).
 */
export const candleAdapter: SourceAdapter = {
  id: 'candle',
  label: 'Peculiar Candle',
  mode: 'postMessage',
  async refresh() {
    return null;
  },
};
