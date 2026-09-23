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

export function writeSaved(key: string, value: unknown) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
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
  /** Migrate from prior Work Room keys once */
  legacyFocus: 'workroom-focus',
  legacySnapshots: 'workroom-source-snapshots',
} as const;
