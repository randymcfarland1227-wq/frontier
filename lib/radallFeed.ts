/** Radall Finances "Task List", pushed every ~10 min by the "Life Hub Mail Sync" Apps Script. */

import type { SourceSnapshot } from './types';
import { syncKeyHeader } from './cloudSync';

const WORKER_BASE =
  (import.meta as ImportMeta & { env?: { VITE_WORKER_URL?: string } }).env?.VITE_WORKER_URL ||
  'https://frontier-work-room.randymcfarland1227.workers.dev';

export async function pullRadallSnapshot(): Promise<SourceSnapshot | null> {
  try {
    const res = await fetch(`${WORKER_BASE}/api/radall/snapshot`, { headers: syncKeyHeader(), cache: 'no-store' });
    if (!res.ok) return null;
    const s = ((await res.json()) as { snapshot?: SourceSnapshot | null }).snapshot;
    if (!s || !Array.isArray(s.tasks) || typeof s.refreshedAt !== 'string') return null;
    return { source: 'radall', metrics: s.metrics || {}, featured: s.featured || [], tasks: s.tasks, refreshedAt: s.refreshedAt };
  } catch {
    return null;
  }
}
