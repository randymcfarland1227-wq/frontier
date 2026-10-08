import type { SourceAdapter } from './types';
import type { FeaturedItem, SourceSnapshot, TaskItem } from '../types';
import { readSaved, writeSaved, STORAGE_KEYS } from '../storage';

export type SelfItem = {
  id: string;
  title: string;
  detail?: string;
  done: boolean;
  starred: boolean;
  createdAt: string;
  /** Carried from a promoted capture; overrides focus-area rules on complete */
  focusAreaId?: string;
  fromCaptureId?: string;
  /** Last change — lets cloud backup pick the newest copy */
  updatedAt?: string;
  /** Optional day it's for (YYYY-MM-DD) — shows on the calendar */
  due?: string;
  /** Prep task for a calendar event / maybe-plan (e.g. "Change oil" before the game) */
  forEvent?: { id: string; title: string; date: string };
  /** Moved to another site's card (e.g. a finance task captured in Self). Unset = lives in Self. */
  home?: string;
  /** Moved here from another site's row (a Gmail or Outlook item…) — keeps its link */
  from?: { source: string; id: string; url?: string };
};

export function loadSelfItems(): SelfItem[] {
  return readSaved<SelfItem[]>(STORAGE_KEYS.self, []);
}

export function saveSelfItems(items: SelfItem[]) {
  writeSaved(STORAGE_KEYS.self, items);
}

export function selfSnapshotFrom(allItems: SelfItem[]): SourceSnapshot {
  // Tasks moved to another site show in that site's card instead (see life-hub visibleSnapshots).
  const items = allItems.filter(i => !i.home);
  const open = items.filter(i => !i.done);
  const starred = open.filter(i => i.starred);
  const done = items.filter(i => i.done);
  const featured: FeaturedItem[] = starred.map(i => ({
    id: i.id,
    title: i.title,
    detail: i.detail || 'Captured in Self inbox',
    meta: 'Self · starred',
    completable: true,
  }));
  const tasks: TaskItem[] = items.map(i => ({
    id: i.id,
    title: i.title,
    detail: i.detail,
    status: i.done ? 'done' : 'open',
    starred: i.starred,
  }));
  return {
    source: 'self',
    metrics: {
      open: open.length,
      starred: starred.length,
      done: done.length,
    },
    featured,
    tasks,
    refreshedAt: new Date().toISOString(),
  };
}

export function addSelfItem(
  title: string,
  detail = '',
  extra?: Pick<SelfItem, 'focusAreaId' | 'fromCaptureId' | 'due' | 'forEvent' | 'from'>,
): SelfItem[] {
  const items = loadSelfItems();
  const next: SelfItem = {
    id: `self-${Date.now()}`,
    title: title.trim(),
    detail: detail.trim() || undefined,
    done: false,
    starred: false,
    createdAt: new Date().toISOString(),
    ...extra,
  };
  const updated = [next, ...items];
  saveSelfItems(updated);
  return updated;
}

/** A task already done elsewhere, recorded after the fact (counts in Review + Balance). */
export function logSelfItem(title: string, detail: string, focusAreaId: string | undefined, at: string): SelfItem[] {
  const items = loadSelfItems();
  const next: SelfItem = {
    id: `self-${Date.now()}`,
    title: title.trim(),
    detail: detail.trim() || undefined,
    done: true,
    starred: false,
    createdAt: at,
    updatedAt: new Date().toISOString(),
    ...(focusAreaId ? { focusAreaId } : {}),
  };
  const updated = [next, ...items];
  saveSelfItems(updated);
  return updated;
}

export function toggleSelfComplete(id: string): SelfItem[] {
  const at = new Date().toISOString();
  const updated = loadSelfItems().map(i => (i.id === id ? { ...i, done: !i.done, updatedAt: at } : i));
  saveSelfItems(updated);
  return updated;
}

/** Set or clear a Self task's day. */
export function setSelfDue(id: string, due?: string): SelfItem[] {
  const at = new Date().toISOString();
  const updated = loadSelfItems().map(i => (i.id === id ? { ...i, due: due || undefined, updatedAt: at } : i));
  saveSelfItems(updated);
  return updated;
}

export const SELF_ITEMS_EVENT = 'lifehub:self-items';

/** Move a Self task to another site's card (or back to Self with `home` unset). */
export function setSelfHome(id: string, home?: string): SelfItem[] {
  const at = new Date().toISOString();
  const updated = loadSelfItems().map(i => (i.id === id ? { ...i, home: home || undefined, updatedAt: at } : i));
  saveSelfItems(updated);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(SELF_ITEMS_EVENT));
  return updated;
}

export function toggleSelfStar(id: string): SelfItem[] {
  const at = new Date().toISOString();
  const updated = loadSelfItems().map(i => (i.id === id ? { ...i, starred: !i.starred, updatedAt: at } : i));
  saveSelfItems(updated);
  return updated;
}

export const selfAdapter: SourceAdapter = {
  id: 'self',
  label: 'Self inbox',
  mode: 'local',
  async refresh() {
    return selfSnapshotFrom(loadSelfItems());
  },
};
