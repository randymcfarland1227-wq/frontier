'use client';

/**
 * Priority workstation. Stored as one map — `source:id` → { lane, order, at, note?, before? } — so
 * it cloud-syncs like levels (newest change per task wins). `lane: null` = unpinned.
 *
 * Two stages (2026-10-06): everything pinned lands **On deck** (grouped by site), then Randy moves
 * what he's decided to do into the ordered **Action list**. The lane values are the older
 * Now/Next/Later ones so nothing synced needs migrating: 'now' = On deck, 'next' = Action list.
 * Each item can carry a plan note and a "Before this" list (blockers / things that come first).
 * The old flat pin list (`lifehub-priority-pins`) is folded into On deck once.
 */

import { useCallback, useEffect, useState } from 'react';
import type { SourceId } from './types';
import { readSaved, writeSaved, STORAGE_KEYS } from './storage';

export const PRIORITY_PINS_EVENT = 'lifehub:priority-pins';
/** Any task title on any card fires this with a pin key; Doing now opens that item's panel. */
export const OPEN_TASK_EVENT = 'lifehub:open-task';
export const openTaskPanel = (key: string) => {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(OPEN_TASK_EVENT, { detail: key }));
};

export type Lane = 'now' | 'next' | 'later';
export const LANES: Array<{ id: Lane; name: string; hint: string }> = [
  { id: 'now', name: 'Now', hint: 'Doing today' },
  { id: 'next', name: 'Next', hint: 'This week' },
  { id: 'later', name: 'Later', hint: 'Parked, not forgotten' },
];

/** Pinned items land here, grouped by site. */
export const DECK: Lane = 'now';
/** The decided, ordered action list. */
export const PLAN: Lane = 'next';

/** Something that's in the way, or has to happen first. */
export type BeforeStep = { id: string; text: string; done: boolean };

export type LaneEntry = {
  lane: Lane | null;
  order: number;
  at: string;
  /** How Randy plans to go about it */
  note?: string;
  /** Blockers / things that need to happen first */
  before?: BeforeStep[];
  /** Subtasks: the pieces an umbrella task is made of. Never counted in any task total. */
  subs?: BeforeStep[];
  /** A day for it (YYYY-MM-DD) — Priority + calendar only, never sent back to its site */
  due?: string;
};
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
  // One-time (2026-10-09): bills pinned as "radall:bill:<due key>" (due keys start "bill:") now use "radall:<due key>".
  const old = Object.keys(map).filter(k => k.startsWith('radall:bill:bill:') && map[k]?.lane);
  if (old.length) {
    const at = new Date().toISOString();
    for (const k of old) {
      const next = `radall:${k.slice('radall:bill:'.length)}`;
      if (!map[next]?.lane) map[next] = { ...map[k], at };
      map[k] = { lane: null, order: 0, at };
    }
    writeSaved(STORAGE_KEYS.priorityLanes, map);
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
    if (k === key || !prev || prev.order !== i || prev.lane !== lane) map[k] = { ...prev, lane, order: i, at };
  });
  saveLanes(map);
}

export function unpin(key: string) {
  const map = loadLanes();
  if (!map[key]?.lane) return;
  map[key] = { ...map[key], lane: null, at: new Date().toISOString() };
  saveLanes(map);
}

/** Change an item's note / "Before this" list (kept even if it's taken off the plan). */
export function updatePinDetails(key: string, patch: Partial<Pick<LaneEntry, 'note' | 'before' | 'subs' | 'due'>>) {
  const map = loadLanes();
  const prev = map[key] || { lane: null, order: 0, at: '' };
  map[key] = { ...prev, ...patch, at: new Date().toISOString() };
  saveLanes(map);
}

/** Open "Before this" steps — anything left means the item is waiting on something. */
export function openBefore(entry?: LaneEntry): number {
  return (entry?.before || []).filter(b => !b.done).length;
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
  const addPin = useCallback((source: SourceId, id: string, lane: Lane = DECK) => placePin(pinKey(source, id), lane), []);
  const removePin = useCallback((source: SourceId, id: string) => unpin(pinKey(source, id)), []);
  const isPinned = useCallback((source: SourceId, id: string) => Boolean(lanes[pinKey(source, id)]?.lane), [lanes]);
  const laneOf = useCallback((key: string): Lane | null => lanes[key]?.lane ?? null, [lanes]);

  return { pins, lanes, addPin, removePin, isPinned, laneOf };
}

/**
 * On deck site boxes: a site locked to a position. Stored in the same synced map as pins, under
 * `deckslot:<source>` with lane null (so nothing treats it as a pin); order = position (1-based),
 * 0 = unlocked. Newest change wins across devices, like everything else here.
 */
export const deckSlotKey = (source: string) => `deckslot:${source}`;

export function setDeckSlot(source: string, position: number | null) {
  const map = loadLanes();
  map[deckSlotKey(source)] = { lane: null, order: position && position > 0 ? Math.round(position) : 0, at: new Date().toISOString() };
  saveLanes(map);
}

/** Final order: locked first (by position, older lock wins a tie), then moved-but-unlocked, then auto order. */
export function arrangeDeck<T extends string>(auto: T[], locked: Record<string, { pos: number; at: string }>, moved: Record<string, number>): T[] {
  const n = auto.length;
  const slots: Array<T | null> = Array(n).fill(null);
  const place = (id: T, want: number) => {
    const p = Math.min(Math.max(1, want), n) - 1;
    for (let d = 0; d < n; d++) {
      for (const i of [p + d, p - d]) {
        if (i >= 0 && i < n && slots[i] === null) {
          slots[i] = id;
          return;
        }
      }
    }
  };
  const lockedIds = auto.filter(id => locked[id]).sort((a, b) => locked[a].pos - locked[b].pos || locked[a].at.localeCompare(locked[b].at));
  lockedIds.forEach(id => place(id, locked[id].pos));
  const movedIds = auto.filter(id => !locked[id] && moved[id]);
  movedIds.forEach(id => place(id, moved[id]));
  const rest = auto.filter(id => !slots.includes(id));
  return slots.map(s => s ?? rest.shift()!) as T[];
}
