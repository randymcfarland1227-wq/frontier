export function readSaved<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Fired with the storage key after every successful write (cloud backup listens). */
export const LOCAL_WRITE_EVENT = 'lifehub:local-write';

export function writeSaved(key: string, value: unknown) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
    window.dispatchEvent(new CustomEvent(LOCAL_WRITE_EVENT, { detail: key }));
  } catch {
    /* quota / private mode */
  }
}

export const STORAGE_KEYS = {
  focus: 'lifehub-focus',
  snapshots: 'lifehub-source-snapshots',
  self: 'lifehub-self-inbox',
  completions: 'lifehub-completions',
  theme: 'lifehub-theme',
  priorityPins: 'lifehub-priority-pins',
  captures: 'lifehub-captures',
  goalLinks: 'lifehub-goal-links',
  /** Cloud backup key for this device — never synced */
  sync: 'lifehub-sync',
  /** Source cards collapsed to their header */
  collapsedCards: 'lifehub-collapsed-cards',
  /** Balance paces (settings gear) — cloud-synced */
  balanceSettings: 'lifehub-balance-settings',
  /** Each day's available work per bucket — cloud-synced */
  dailyAvailability: 'lifehub-daily-availability',
  /** Migrate from prior Work Room keys once */
  legacyFocus: 'workroom-focus',
  legacySnapshots: 'workroom-source-snapshots',
} as const;
