import type { SourceAdapter } from './types';

/**
 * Live data arrives via public/data/outlook.json (agent MCP sync + commit).
 * This adapter remains a no-op for future direct API use.
 */
export const outlookAdapter: SourceAdapter = {
  id: 'outlook',
  label: 'Outlook',
  mode: 'api',
  async refresh() {
    return null;
  },
};
