/**
 * Stars kept by Life Hub itself, for sources that have no star of their own (TickTick, Radall),
 * and Gmail — where every starred email is already a task (the action list), so Life Hub's own
 * ☆ is what lifts one into the Starred box.
 * "source::id" → starred or not; newest change wins. Cloud-synced like levels.
 */

import type { SourceId, SourceSnapshot } from './types';
import { readSaved, writeSaved, STORAGE_KEYS } from './storage';

export type HubStarMap = Record<string, { starred: boolean; at: string }>;

export const HUB_STARS_EVENT = 'lifehub:hub-stars';
/** Sources whose ☆ is stored in Life Hub instead of opening the source site. */
export const HUB_STAR_SOURCES: readonly SourceId[] = ['ticktick', 'radall', 'gmail'];

/** Sources whose own "featured" list is just a copy of the tasks: only Life Hub stars count. */
const TASKS_ARE_FEATURED: readonly SourceId[] = ['gmail'];

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
  const mirror = TASKS_ARE_FEATURED.includes(source);
  // Keep the source's own detail line (e.g. Gmail's sender) for items starred here.
  const metaOf = new Map(snap.featured.map(f => [f.id, f.meta]));
  const featured = mirror ? [] : snap.featured.filter(f => stateOf(f.id) !== false);
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
      meta: mirror ? metaOf.get(t.id) || '' : t.kind === 'habit' ? 'Habit' : t.due && t.due.slice(0, 10) < today ? 'Overdue' : 'Today',
      originUrl: t.originUrl,
      completable: true,
    }));
  return { ...snap, tasks, featured: [...added, ...featured] };
}
