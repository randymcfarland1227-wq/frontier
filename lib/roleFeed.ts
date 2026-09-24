/** Role Hub pushes its snapshot to the Worker whenever it loads; Life Hub reads it here. */

import type { SourceSnapshot } from './types';
import { syncKeyHeader } from './cloudSync';

const WORKER_BASE =
  (import.meta as ImportMeta & { env?: { VITE_WORKER_URL?: string } }).env?.VITE_WORKER_URL ||
  'https://frontier-work-room.randymcfarland1227.workers.dev';

export async function pullRoleSnapshot(): Promise<SourceSnapshot | null> {
  try {
    const res = await fetch(`${WORKER_BASE}/api/role/snapshot`, { headers: syncKeyHeader(), cache: 'no-store' });
    if (!res.ok) return null;
    const body = (await res.json()) as { snapshot?: SourceSnapshot | null };
    const s = body.snapshot;
    if (!s || !Array.isArray(s.tasks) || typeof s.refreshedAt !== 'string') return null;
    return { source: 'role', metrics: s.metrics || {}, featured: s.featured || [], tasks: s.tasks, refreshedAt: s.refreshedAt };
  } catch {
    return null;
  }
}
