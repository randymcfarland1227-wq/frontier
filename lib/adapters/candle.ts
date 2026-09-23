import type { SourceAdapter } from './types';

/**
 * Phase 1 stub — no live Peculiar Candle calls yet.
 * Wire secrets / OAuth / postMessage origin updates in a later pass.
 */
export const candleAdapter: SourceAdapter = {
  id: 'candle',
  label: 'Peculiar Candle',
  mode: 'placeholder',
  async refresh() {
    return null;
  },
};
