/**
 * Task sorting rules: which bucket (focus area) and which goal a task belongs to.
 * Keyed by source + task name, so a recurring task or the same task done again later
 * lands in the same place automatically. A source-wide rule ("every Role Hub task")
 * fills in whatever the task's own rule leaves unset. Cloud-synced; newest change wins.
 */

import { useCallback, useEffect, useState } from 'react';
import type { SourceId } from './types';
import { readSaved, writeSaved, STORAGE_KEYS } from './storage';

/** No goal on purpose — counts as sorted, never asks again. */
export const NO_GOAL = 'none';

export type TaskRule = {
  /** Focus area id; null = back to the default rules */
  area?: string | null;
  /** Goal id, NO_GOAL, or null = unset */
  goal?: string | null;
  at: string;
};
export type TaskRuleMap = Record<string, TaskRule>;

export const TASK_RULES_EVENT = 'lifehub:task-rules';

export function taskTitleKey(title?: string) {
  return (title || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** One rule per task name within a source (falls back to the id when there's no title). */
export function taskRuleKey(source: SourceId, title: string | undefined, taskId: string) {
  const t = taskTitleKey(title);
  return t ? `${source}::t:${t}` : `${source}::id:${taskId}`;
}

export const sourceRuleKey = (source: SourceId) => `${source}::*`;

let active: TaskRuleMap = {};

export function loadTaskRules(): TaskRuleMap {
  active = readSaved<TaskRuleMap>(STORAGE_KEYS.taskRules, {});
  return active;
}

/** The task's own rule, with the source-wide rule filling unset fields. */
export function ruleFor(
  source: SourceId,
  title: string | undefined,
  taskId: string,
  rules: TaskRuleMap = active,
): { area?: string; goal?: string } {
  const own = rules[taskRuleKey(source, title, taskId)];
  const wide = rules[sourceRuleKey(source)];
  return {
    area: own?.area || wide?.area || undefined,
    goal: own?.goal || wide?.goal || undefined,
  };
}

export function saveTaskRule(key: string, patch: Partial<Pick<TaskRule, 'area' | 'goal'>>) {
  const all = loadTaskRules();
  all[key] = { ...all[key], ...patch, at: new Date().toISOString() };
  writeSaved(STORAGE_KEYS.taskRules, all);
  active = all;
  window.dispatchEvent(new CustomEvent(TASK_RULES_EVENT));
}

export function useTaskRules() {
  const [rules, setRules] = useState<TaskRuleMap>(() => loadTaskRules());
  useEffect(() => {
    const reload = () => setRules(loadTaskRules());
    window.addEventListener(TASK_RULES_EVENT, reload);
    window.addEventListener('lifehub:synced', reload);
    return () => {
      window.removeEventListener(TASK_RULES_EVENT, reload);
      window.removeEventListener('lifehub:synced', reload);
    };
  }, []);
  const save = useCallback((key: string, patch: Partial<Pick<TaskRule, 'area' | 'goal'>>) => saveTaskRule(key, patch), []);
  return { rules, save };
}
