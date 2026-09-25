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

function queueRoleAction(id: string, action: 'complete' | 'star' | 'unstar') {
  void fetch(`${WORKER_BASE}/api/role/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...syncKeyHeader() },
    body: JSON.stringify({ id, action }),
  }).catch(() => undefined);
}

/** Role Hub items Done can reach: its own tasks, certs, and portfolio ideas (not applications). */
export function isRoleCompletable(id: string) {
  return /^(hubtask|cert|portfolio):/.test(id);
}

/** Done on a Role Hub task / cert / portfolio idea: queued; Role Hub applies it on its next check-in. */
export function completeRoleTask(id: string) {
  if (isRoleCompletable(id)) queueRoleAction(id, 'complete');
}

/** Star / unstar a Role Hub item (roles, certs, portfolio ideas): queued the same way. */
export function starRoleItem(id: string, starred: boolean) {
  if (!id.startsWith('hubtask:')) queueRoleAction(id, starred ? 'star' : 'unstar');
}
