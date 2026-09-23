import type { SourceAdapter } from './types';

/**
 * Live data arrives via public/data/radall.json (Sheets MCP sync + commit).
 * This adapter remains a no-op for future direct API use.
 */
export const radallAdapter: SourceAdapter = {
  id: 'radall',
  label: 'Radall Finances',
  mode: 'api',
  async refresh() {
    return null;
  },
};
