/**
 * Refresh button: ask the Worker to have the "Life Hub Mail Sync" Apps Script push Gmail, Radall
 * and Schedule (calendar + bills) right now, then tell every live card to pull again.
 */

import { syncKeyHeader } from './cloudSync';

const WORKER_BASE =
  (import.meta as ImportMeta & { env?: { VITE_WORKER_URL?: string } }).env?.VITE_WORKER_URL ||
  'https://frontier-work-room.randymcfarland1227.workers.dev';

/** Fired after a Refresh; the live-feed effects (Gmail, Radall, Role, Schedule, TickTick) re-pull on it. */
export const REFRESH_EVENT = 'lifehub:refresh';

/** True when Google finished a fresh sync. Takes ~10–30 s; false if it failed or isn't set up. */
export async function syncGoogleNow(): Promise<boolean> {
  try {
    const res = await fetch(`${WORKER_BASE}/api/sync/now`, { method: 'POST', headers: syncKeyHeader(), cache: 'no-store' });
    return res.ok && ((await res.json()) as { ok?: boolean }).ok === true;
  } catch {
    return false;
  }
}
