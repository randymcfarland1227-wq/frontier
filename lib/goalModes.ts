/**
 * Active vs passive goals. Active = you're pushing on it; passive = you're maintaining it.
 * Starts from Flow: a goal with "drive" routines is Active, one with only upkeep / enable routines
 * is Passive, one with no routine yet says so. Randy's own choice (one tap) wins and is
 * cloud-synced as `goalModes` (goal id → 'active' / 'passive' / null = back to Flow's).
 */

import { useEffect, useState } from 'react';
import flowMap from '../public/data/flow-map.json';
import { readSaved, writeSaved, STORAGE_KEYS } from './storage';

export type GoalMode = 'active' | 'passive';
export type GoalModes = Record<string, { mode: GoalMode | null; at: string }>;
export type GoalRoutine = { id: string; title: string; tier: 'drive' | 'enable' | 'upkeep' | string; when?: string };

type FlowRoutine = { id: string; focus: string; frequency?: string; active?: boolean; link?: { tier?: string; efforts?: string[] } };
const ROUTINES = (flowMap as { routines: FlowRoutine[] }).routines;
const TIER_ORDER: Record<string, number> = { drive: 0, enable: 1, upkeep: 2 };

export const GOAL_MODES_EVENT = 'lifehub:goal-modes';

/** The routines that feed a goal in Flow, driving ones first. */
export function routinesFor(goalId: string): GoalRoutine[] {
  return ROUTINES.filter(r => r.active !== false && (r.link?.efforts || []).includes(goalId))
    .map(r => ({ id: r.id, title: r.focus, tier: r.link?.tier || 'drive', when: r.frequency }))
    .sort((a, b) => (TIER_ORDER[a.tier] ?? 3) - (TIER_ORDER[b.tier] ?? 3) || a.title.localeCompare(b.title));
}

/** What Flow suggests: drive → active, only upkeep / enable → passive, nothing → null. */
export function flowMode(goalId: string): GoalMode | null {
  const rs = routinesFor(goalId);
  if (!rs.length) return null;
  return rs.some(r => r.tier === 'drive') ? 'active' : 'passive';
}

export function loadGoalModes(): GoalModes {
  return readSaved<GoalModes>(STORAGE_KEYS.goalModes, {});
}

export function setGoalMode(goalId: string, mode: GoalMode | null) {
  const all = loadGoalModes();
  all[goalId] = { mode, at: new Date().toISOString() };
  writeSaved(STORAGE_KEYS.goalModes, all);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(GOAL_MODES_EVENT));
}

export function useGoalModes(): GoalModes {
  const [modes, setModes] = useState<GoalModes>(() => loadGoalModes());
  useEffect(() => {
    const reload = () => setModes(loadGoalModes());
    window.addEventListener(GOAL_MODES_EVENT, reload);
    window.addEventListener('lifehub:synced', reload);
    return () => {
      window.removeEventListener(GOAL_MODES_EVENT, reload);
      window.removeEventListener('lifehub:synced', reload);
    };
  }, []);
  return modes;
}

/** The goal's mode: Randy's choice if he made one, else Flow's suggestion. */
export function modeOf(goalId: string, modes: GoalModes): { mode: GoalMode | null; mine: boolean } {
  const m = modes[goalId]?.mode;
  if (m === 'active' || m === 'passive') return { mode: m, mine: true };
  return { mode: flowMode(goalId), mine: false };
}
