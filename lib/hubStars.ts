/**
 * Stars kept by Life Hub itself, for sources that have no star of their own (TickTick).
 * "source::id" → starred or not; newest change wins. Cloud-synced like levels.
 */

import type { SourceId, SourceSnapshot } from './types';
import { readSaved, writeSaved, STORAGE_KEYS } from './storage';

export type HubStarMap = Record<string, { starred: boolean; at: string }>;

export const HUB_STARS_EVENT = 'lifehub:hub-stars';
/** Sources whose ☆ is stored in Life Hub instead of opening the source site. */
export const HUB_STAR_SOURCES: readonly SourceId[] = ['ticktick'];

const starKey = (source: SourceId, id: string) => `${source}::${id}`;

export function loadHubStars(): HubStarMap {
  return readSaved<HubStarMap>(STORAGE_KEYS.hubStars, {});
}

export function setHubStar(source: SourceId, id: string, starred: boolean) {
  const all = loadHubStars();
  all[starKey(source, id)] = { starred, at: new Date().toISOString() };
  writeSaved(STORAGE_KEYS.hubStars, all);
  window.dispatchEvent(new CustomEvent(HUB_STARS_EVENT));
}

/** Starred open tasks join the Starred list; unstarred ones leave it (even if a source file featured them). */
export function applyHubStars(source: SourceId, snap: SourceSnapshot, stars: HubStarMap): SourceSnapshot {
  const stateOf = (id: string) => stars[starKey(source, id)]?.starred;
  const today = new Date().toISOString().slice(0, 10);
  const featured = snap.featured.filter(f => stateOf(f.id) !== false);
  const inList = new Set(featured.map(f => f.id));
  // A row's ☆ matches the Starred list, so tapping it always does the obvious thing.
  const tasks = snap.tasks.map(t => ({ ...t, starred: stateOf(t.id) ?? inList.has(t.id) }));
  const have = new Set(featured.map(f => f.id));
  const added = tasks
    .filter(t => t.status !== 'done' && stateOf(t.id) === true && !have.has(t.id))
    .map(t => ({
      id: t.id,
      title: t.title,
      detail: t.detail || '',
      meta: t.kind === 'habit' ? 'Habit' : t.due && t.due.slice(0, 10) < today ? 'Overdue' : 'Today',
      originUrl: t.originUrl,
      completable: true,
    }));
  return { ...snap, tasks, featured: [...added, ...featured] };
}
