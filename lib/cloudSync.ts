/**
 * Cloud backup for Life Hub. Local storage stays the working copy; the Worker keeps a
 * merged copy in KV so data survives browser wipes and matches across devices.
 * The sync key is generated in the browser and never leaves it except as a request header
 * or inside a "link another device" URL fragment (fragments are never sent to servers).
 */

import { loadLedger } from './completions';
import { loadCaptures } from './captures';
import { loadSelfItems } from './adapters/self';
import { readSaved, writeSaved, STORAGE_KEYS, LOCAL_WRITE_EVENT } from './storage';
import { mergeState, normalizeState, stateCounts, type LocalGoalLinks, type SyncedState } from './syncState';

const WORKER_BASE =
  (import.meta as ImportMeta & { env?: { VITE_WORKER_URL?: string } }).env?.VITE_WORKER_URL ||
  'https://frontier-work-room.randymcfarland1227.workers.dev';
const STATE_URL = `${WORKER_BASE.replace(/\/$/, '')}/api/state`;

/** Fired after sync or import changed local data — the app reloads its state from storage. */
export const SYNCED_EVENT = 'lifehub:synced';
export const SYNC_STATUS_EVENT = 'lifehub:sync-status';

const SYNCED_KEYS: string[] = [STORAGE_KEYS.completions, STORAGE_KEYS.captures, STORAGE_KEYS.self, STORAGE_KEYS.goalLinks];

export type SyncStatus = {
  state: 'off' | 'syncing' | 'ok' | 'error';
  at?: string;
  error?: string;
  counts?: ReturnType<typeof stateCounts>;
  notice?: string;
};

type SyncConfig = { key?: string };

let status: SyncStatus = { state: 'off' };
let applying = false;
let pushTimer: ReturnType<typeof setTimeout> | undefined;
let started = false;

function setStatus(next: SyncStatus) {
  status = next;
  window.dispatchEvent(new CustomEvent(SYNC_STATUS_EVENT, { detail: status }));
}

export function getSyncStatus(): SyncStatus {
  return status;
}

function getKey(): string | undefined {
  return readSaved<SyncConfig>(STORAGE_KEYS.sync, {}).key;
}

function setKey(key: string | undefined) {
  writeSaved(STORAGE_KEYS.sync, key ? { key } : {});
}

export function readLocalState(): SyncedState {
  return normalizeState({
    completions: loadLedger(),
    captures: loadCaptures(),
    self: loadSelfItems(),
    goalLinks: readSaved<LocalGoalLinks>(STORAGE_KEYS.goalLinks, { added: [], removed: [] }),
  });
}

/** Write merged state to storage; returns true if anything changed. */
function writeLocalState(next: SyncedState): boolean {
  const current = readLocalState();
  const pairs: Array<[string, unknown, unknown]> = [
    [STORAGE_KEYS.completions, current.completions, next.completions],
    [STORAGE_KEYS.captures, current.captures, next.captures],
    [STORAGE_KEYS.self, current.self, next.self],
    [STORAGE_KEYS.goalLinks, current.goalLinks, next.goalLinks],
  ];
  let changed = false;
  applying = true;
  try {
    for (const [key, before, after] of pairs) {
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        writeSaved(key, after);
        changed = true;
      }
    }
  } finally {
    applying = false;
  }
  if (changed) window.dispatchEvent(new CustomEvent(SYNCED_EVENT));
  return changed;
}

/** Push local state; the Worker merges it with the backup and returns the union. */
export async function syncNow(): Promise<SyncStatus> {
  const key = getKey();
  if (!key) {
    setStatus({ state: 'off', notice: status.notice });
    return status;
  }
  setStatus({ ...status, state: 'syncing' });
  try {
    const res = await fetch(STATE_URL, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Sync-Key': key },
      body: JSON.stringify({ state: readLocalState() }),
    });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; state?: unknown };
    if (!res.ok || !body.ok) {
      setStatus({ state: 'error', error: body.error || `HTTP ${res.status}`, at: status.at });
      return status;
    }
    // Local writes may have happened while the request was in flight — merge, don't overwrite.
    const merged = mergeState(body.state, readLocalState());
    writeLocalState(merged);
    setStatus({ state: 'ok', at: new Date().toISOString(), counts: stateCounts(merged), notice: status.notice });
  } catch {
    setStatus({ state: 'error', error: 'offline', at: status.at });
  }
  return status;
}

function schedulePush() {
  if (!getKey()) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => void syncNow(), 2000);
}

/** Wire listeners once: push after local edits, pull when the tab comes back. */
export function startCloudSync() {
  if (started || typeof window === 'undefined') return;
  started = true;
  window.addEventListener(LOCAL_WRITE_EVENT, event => {
    const key = (event as CustomEvent<string>).detail;
    if (!applying && SYNCED_KEYS.includes(key)) schedulePush();
  });
  window.addEventListener('hashchange', () => {
    consumeLocationHash();
    setStatus(status);
    void syncNow();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void syncNow();
  });
  setInterval(() => {
    if (document.visibilityState === 'visible') void syncNow();
  }, 5 * 60 * 1000);
  void syncNow();
}

function randomKey(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function enableBackup(): Promise<SyncStatus> {
  if (!getKey()) setKey(randomKey());
  return syncNow();
}

export async function joinWithKey(key: string): Promise<SyncStatus> {
  const previous = getKey();
  setKey(key.trim());
  const result = await syncNow();
  if (result.state === 'error' && result.error === 'wrong_key') {
    setKey(previous);
  }
  return result;
}

export function disableBackup() {
  setKey(undefined);
  setStatus({ state: 'off' });
}

/** Link that sets up another device (key rides in the #fragment, never sent to a server). */
export function deviceLink(): string | null {
  const key = getKey();
  if (!key) return null;
  return `${window.location.origin}${window.location.pathname}#sync-key=${key}`;
}

function decodeBase64Json(value: string): unknown {
  return JSON.parse(decodeURIComponent(escape(atob(decodeURIComponent(value)))));
}

/**
 * Handle `#sync-key=…` (join backup from another device) and `#import=…` (history handed
 * over by the retired Worker copy). Runs before the app reads storage.
 */
export function consumeLocationHash() {
  const hash = window.location.hash;
  const keyMatch = hash.match(/^#sync-key=([0-9a-f]{24,})$/i);
  const importMatch = hash.match(/^#import=(.+)$/);
  if (!keyMatch && !importMatch) return;
  window.history.replaceState(null, '', window.location.pathname + window.location.search);

  if (keyMatch) {
    setKey(keyMatch[1]);
    status = { state: 'off', notice: 'This device is now linked to your backup.' };
    return;
  }
  try {
    const payload = decodeBase64Json(importMatch![1]) as { completions?: unknown; self?: unknown; from?: string };
    const before = readLocalState();
    const merged = mergeState(before, { completions: payload.completions, self: payload.self });
    const added = stateCounts(merged).completions - stateCounts(before).completions;
    writeLocalState(merged);
    status = { state: 'off', notice: `Brought over ${added} completion${added === 1 ? '' : 's'} from the old Life Hub.` };
  } catch {
    status = { state: 'off', notice: 'Could not read history from the old Life Hub link.' };
  }
}
