'use client';

/**
 * Priority workstation: pinned tasks laid out in lanes (Now / Next / Later) with an order inside
 * each lane. Stored as one map — `source:id` → { lane, order, at } — so it cloud-syncs like
 * levels (newest change per task wins). `lane: null` = unpinned. The old flat pin list
 * (`lifehub-priority-pins`) is folded into the Now lane once.
 */

import { useCallback, useEffect, useState } from 'react';
import type { SourceId } from './types';
import { readSaved, writeSaved, STORAGE_KEYS } from './storage';

export const PRIORITY_PINS_EVENT = 'lifehub:priority-pins';

export type Lane = 'now' | 'next' | 'later';
export const LANES: Array<{ id: Lane; name: string; hint: string }> = [
  { id: 'now', name: 'Now', hint: 'Doing today' },
  { id: 'next', name: 'Next', hint: 'This week' },
  { id: 'later', name: 'Later', hint: 'Parked, not forgotten' },
];

export type LaneEntry = { lane: Lane | null; order: number; at: string };
export type LaneMap = Record<string, LaneEntry>;

export function pinKey(source: SourceId, id: string): string {
  return `${source}:${id}`;
}

export function loadLanes(): LaneMap {
  const map = readSaved<LaneMap>(STORAGE_KEYS.priorityLanes, {});
  // One-time: bring the old flat pin list into the Now lane.
  const legacy = readSaved<string[]>(STORAGE_KEYS.priorityPins, []);
  if (legacy.length && !Object.keys(map).length) {
    const at = new Date().toISOString();
    legacy.forEach((key, i) => {
      map[key] = { lane: 'now', order: i, at };
    });
    writeSaved(STORAGE_KEYS.priorityLanes, map);
    writeSaved(STORAGE_KEYS.priorityPins, []);
  }
  return map;
}

function saveLanes(map: LaneMap) {
  writeSaved(STORAGE_KEYS.priorityLanes, map);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(PRIORITY_PINS_EVENT));
}

/** Pinned keys in plan order: Now, Next, Later, then by position. */
export function pinsInOrder(map: LaneMap): string[] {
  const rank: Record<Lane, number> = { now: 0, next: 1, later: 2 };
  return Object.entries(map)
    .filter(([, e]) => e?.lane)
    .sort(([, a], [, b]) => rank[a.lane as Lane] - rank[b.lane as Lane] || a.order - b.order)
    .map(([k]) => k);
}

export function loadPriorityPins(): string[] {
  return pinsInOrder(loadLanes());
}

/** Replace the whole pinned set (kept for callers that think in lists): new keys go to Now. */
export function savePriorityPins(pins: string[]) {
  const map = loadLanes();
  const at = new Date().toISOString();
  const keep = new Set(pins);
  for (const [k, e] of Object.entries(map)) if (e.lane && !keep.has(k)) map[k] = { ...e, lane: null, at };
  pins.forEach((k, i) => {
    if (!map[k]?.lane) map[k] = { lane: 'now', order: -1000 + i, at };
  });
  saveLanes(map);
}

/** Put a task in a lane; `before` = key to land in front of (end of lane if omitted). */
export function placePin(key: string, lane: Lane, before?: string) {
  const map = loadLanes();
  const at = new Date().toISOString();
  const inLane = Object.entries(map)
    .filter(([k, e]) => e.lane === lane && k !== key)
    .sort(([, a], [, b]) => a.order - b.order)
    .map(([k]) => k);
  const idx = before ? inLane.indexOf(before) : -1;
  inLane.splice(idx >= 0 ? idx : inLane.length, 0, key);
  inLane.forEach((k, i) => {
    const prev = map[k];
    // Bump the stamp on everything that moved, so the new order wins when devices sync.
    if (k === key || !prev || prev.order !== i || prev.lane !== lane) map[k] = { lane, order: i, at };
  });
  saveLanes(map);
}

export function unpin(key: string) {
  const map = loadLanes();
  if (!map[key]?.lane) return;
  map[key] = { ...map[key], lane: null, at: new Date().toISOString() };
  saveLanes(map);
}

export function usePriorityPins() {
  const [lanes, setLanes] = useState<LaneMap>(() => loadLanes());

  useEffect(() => {
    const reload = () => setLanes(loadLanes());
    window.addEventListener(PRIORITY_PINS_EVENT, reload);
    window.addEventListener('lifehub:synced', reload);
    return () => {
      window.removeEventListener(PRIORITY_PINS_EVENT, reload);
      window.removeEventListener('lifehub:synced', reload);
    };
  }, []);

  const pins = pinsInOrder(lanes);
  const addPin = useCallback((source: SourceId, id: string, lane: Lane = 'now') => placePin(pinKey(source, id), lane), []);
  const removePin = useCallback((source: SourceId, id: string) => unpin(pinKey(source, id)), []);
  const isPinned = useCallback((source: SourceId, id: string) => Boolean(lanes[pinKey(source, id)]?.lane), [lanes]);
  const laneOf = useCallback((key: string): Lane | null => lanes[key]?.lane ?? null, [lanes]);

  return { pins, lanes, addPin, removePin, isPinned, laneOf };
}
