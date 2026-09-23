import type { SourceId, SourceSnapshot } from '../types';

/**
 * Adapter contract for Life Hub origins.
 * Phase 1: stubs return empty/connecting snapshots.
 * Later: TickTick / Gmail / Outlook / Sheets call real APIs;
 * iframe origins keep using postMessage (see protocol).
 */
export type SourceAdapter = {
  id: SourceId;
  /** Human label for logs / docs */
  label: string;
  /** How data is expected to arrive */
  mode: 'api' | 'postMessage' | 'local' | 'placeholder';
  /** Optional async refresh (API adapters). postMessage adapters no-op. */
  refresh?: () => Promise<SourceSnapshot | null>;
};
