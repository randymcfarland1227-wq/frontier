/**
 * Task type labels you set on Life Hub ("Items to buy", "Subscriptions"…), shown as the colored
 * tag before a task's title. Keyed "source::taskId"; cloud-synced as `tags` (newest change wins).
 */

import { useEffect, useState } from 'react';
import type { SourceId } from './types';
import { readSaved, writeSaved, STORAGE_KEYS } from './storage';

export type TaskTagMap = Record<string, { tag: string | null; at: string }>;
export const TASK_TAGS_EVENT = 'lifehub:task-tags';

/** Suggested labels per site (any other text works too). */
export const TAG_SUGGESTIONS: Partial<Record<SourceId, string[]>> = {
  radall: ['Items to buy', 'Bills', 'Subscriptions', 'Insurance', 'Paperwork', 'Taxes'],
};

/** Sites where you can label tasks (the ☆ menu shows a "Type" box). */
export const TAGGABLE: readonly SourceId[] = ['radall'];

const key = (source: SourceId, id: string) => `${source}::${id}`;

export function loadTaskTags(): TaskTagMap {
  return readSaved<TaskTagMap>(STORAGE_KEYS.taskTags, {});
}

export function setTaskTag(source: SourceId, id: string, tag: string | null) {
  const all = loadTaskTags();
  all[key(source, id)] = { tag: tag?.trim() || null, at: new Date().toISOString() };
  writeSaved(STORAGE_KEYS.taskTags, all);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(TASK_TAGS_EVENT));
}

export function tagOf(tags: TaskTagMap, source: SourceId, id: string): string | null | undefined {
  return tags[key(source, id)]?.tag;
}

export function useTaskTags() {
  const [tags, setTags] = useState<TaskTagMap>(() => loadTaskTags());
  useEffect(() => {
    const reload = () => setTags(loadTaskTags());
    window.addEventListener(TASK_TAGS_EVENT, reload);
    window.addEventListener('lifehub:synced', reload);
    return () => {
      window.removeEventListener(TASK_TAGS_EVENT, reload);
      window.removeEventListener('lifehub:synced', reload);
    };
  }, []);
  return tags;
}
