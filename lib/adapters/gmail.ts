import type { SourceAdapter } from './types';

/**
 * Live data arrives via public/data/gmail.json (agent MCP sync + commit).
 * This adapter remains a no-op for future direct API use.
 */
export const gmailAdapter: SourceAdapter = {
  id: 'gmail',
  label: 'Gmail Starred',
  mode: 'api',
  async refresh() {
    return null;
  },
};
