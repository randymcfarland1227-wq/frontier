/** Red / yellow / green priority on featured and pinned items (red = highest). Cloud-synced. */

import { useCallback, useEffect, useState } from 'react';
import type { SourceId } from './types';
import { readSaved, writeSaved, STORAGE_KEYS } from './storage';

export type Level = 'red' | 'yellow' | 'green';
export type LevelMap = Record<string, { level: Level | 'critical' | null; at: string }>;

export const LEVELS_EVENT = 'lifehub:featured-levels';
const CYCLE: Array<Level | null> = [null, 'red', 'yellow', 'green'];
const RANK: Record<string, number> = { red: 0, yellow: 1, green: 2 };
export const LEVEL_LABEL: Record<Level, string> = { red: 'Highest priority', yellow: 'Medium priority', green: 'Lower priority' };

export const levelKey = (source: SourceId, id: string) => `${source}::${id}`;
/** Critical rides in the same (cloud-synced) map under its own key: must get done, sorts above every color. */
const criticalKey = (source: SourceId, id: string) => `${levelKey(source, id)}::critical`;

export function loadLevels(): LevelMap {
  return readSaved<LevelMap>(STORAGE_KEYS.featuredLevels, {});
}

/** Sort helper: critical first, then red, yellow, green, then everything else (original order kept within a level). */
export function byLevel<T>(items: T[], levelOf: (item: T) => Level | null, criticalOf?: (item: T) => boolean): T[] {
  return items
    .map((item, i) => ({ item, i, c: criticalOf?.(item) ? 0 : 1, r: RANK[levelOf(item) || ''] ?? 3 }))
    .sort((a, b) => a.c - b.c || a.r - b.r || a.i - b.i)
    .map(x => x.item);
}

/** Every item marked critical, as [source, id]. */
export function criticalKeys(levels: LevelMap): Array<[SourceId, string]> {
  return Object.entries(levels)
    .filter(([k, v]) => k.endsWith('::critical') && v?.level)
    .map(([k]) => {
      const [source, ...rest] = k.slice(0, -'::critical'.length).split('::');
      return [source as SourceId, rest.join('::')];
    });
}

export function useFeaturedLevels() {
  const [levels, setLevels] = useState<LevelMap>(() => loadLevels());

  useEffect(() => {
    const reload = () => setLevels(loadLevels());
    window.addEventListener(LEVELS_EVENT, reload);
    // Cloud sync may bring levels from another device.
    window.addEventListener('lifehub:synced', reload);
    return () => {
      window.removeEventListener(LEVELS_EVENT, reload);
      window.removeEventListener('lifehub:synced', reload);
    };
  }, []);

  const levelOf = useCallback(
    (source: SourceId, id: string) => (levels[levelKey(source, id)]?.level as Level | null | undefined) ?? null,
    [levels],
  );
  const isCritical = useCallback((source: SourceId, id: string) => Boolean(levels[criticalKey(source, id)]?.level), [levels]);

  const toggleCritical = useCallback((source: SourceId, id: string) => {
    const all = loadLevels();
    const key = criticalKey(source, id);
    all[key] = { level: all[key]?.level ? null : 'critical', at: new Date().toISOString() };
    writeSaved(STORAGE_KEYS.featuredLevels, all);
    window.dispatchEvent(new CustomEvent(LEVELS_EVENT));
  }, []);

  const cycle = useCallback((source: SourceId, id: string) => {
    const all = loadLevels();
    const key = levelKey(source, id);
    const current = (all[key]?.level as Level | null | undefined) ?? null;
    const next = CYCLE[(CYCLE.indexOf(current) + 1) % CYCLE.length];
    all[key] = { level: next, at: new Date().toISOString() };
    writeSaved(STORAGE_KEYS.featuredLevels, all);
    window.dispatchEvent(new CustomEvent(LEVELS_EVENT));
  }, []);

  return { levels, levelOf, cycle, isCritical, toggleCritical };
}
