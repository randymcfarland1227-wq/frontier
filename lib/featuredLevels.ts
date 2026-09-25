/** Red / yellow / green priority on featured and pinned items (red = highest). Cloud-synced. */

import { useCallback, useEffect, useState } from 'react';
import type { SourceId } from './types';
import { readSaved, writeSaved, STORAGE_KEYS } from './storage';

export type Level = 'red' | 'yellow' | 'green';
export type LevelMap = Record<string, { level: Level | null; at: string }>;

export const LEVELS_EVENT = 'lifehub:featured-levels';
const CYCLE: Array<Level | null> = [null, 'red', 'yellow', 'green'];
const RANK: Record<string, number> = { red: 0, yellow: 1, green: 2 };
export const LEVEL_LABEL: Record<Level, string> = { red: 'Highest priority', yellow: 'Medium priority', green: 'Lower priority' };

export const levelKey = (source: SourceId, id: string) => `${source}::${id}`;

export function loadLevels(): LevelMap {
  return readSaved<LevelMap>(STORAGE_KEYS.featuredLevels, {});
}

/** Sort helper: red, yellow, green, then everything else (original order kept within a level). */
export function byLevel<T>(items: T[], levelOf: (item: T) => Level | null): T[] {
  return items
    .map((item, i) => ({ item, i, r: RANK[levelOf(item) || ''] ?? 3 }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map(x => x.item);
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

  const levelOf = useCallback((source: SourceId, id: string) => levels[levelKey(source, id)]?.level ?? null, [levels]);

  const cycle = useCallback((source: SourceId, id: string) => {
    const all = loadLevels();
    const key = levelKey(source, id);
    const current = all[key]?.level ?? null;
    const next = CYCLE[(CYCLE.indexOf(current) + 1) % CYCLE.length];
    all[key] = { level: next, at: new Date().toISOString() };
    writeSaved(STORAGE_KEYS.featuredLevels, all);
    window.dispatchEvent(new CustomEvent(LEVELS_EVENT));
  }, []);

  return { levelOf, cycle };
}
