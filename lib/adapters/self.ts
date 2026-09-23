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
};

export function loadSelfItems(): SelfItem[] {
  return readSaved<SelfItem[]>(STORAGE_KEYS.self, []);
}

export function saveSelfItems(items: SelfItem[]) {
  writeSaved(STORAGE_KEYS.self, items);
}

export function selfSnapshotFrom(items: SelfItem[]): SourceSnapshot {
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
  extra?: Pick<SelfItem, 'focusAreaId' | 'fromCaptureId'>,
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

export function toggleSelfComplete(id: string): SelfItem[] {
  const at = new Date().toISOString();
  const updated = loadSelfItems().map(i => (i.id === id ? { ...i, done: !i.done, updatedAt: at } : i));
  saveSelfItems(updated);
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
