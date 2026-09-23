/** Actionable (blue) metric helpers for Life Hub source cards. */

import type { SourceId, SourceSnapshot, TaskItem } from './types';

export type ActionableMetric = {
  key: string;
  label: string;
  value: number;
  /** Metric keys already represented by this actionable value (skip duplicates in grid). */
  consumes?: string[];
};

function isHabit(task: TaskItem) {
  return task.kind === 'habit' || task.id.startsWith('habit-');
}

/** Open non-habit tasks still on the board. */
export function openActionableTasks(snapshot: SourceSnapshot): TaskItem[] {
  return (snapshot.tasks || []).filter(t => t.status !== 'done' && !isHabit(t));
}

export function openActionableCount(snapshot: SourceSnapshot): number {
  return openActionableTasks(snapshot).length;
}

/**
 * Primary actionable count for the blue metric on every source.
 * Prefers known metric keys; falls back to open non-habit task count.
 */
export function getActionableMetric(sourceId: SourceId, snapshot: SourceSnapshot): ActionableMetric {
  const m = snapshot.metrics || {};
  const open = openActionableCount(snapshot);

  switch (sourceId) {
    case 'ticktick': {
      const due = Number(m.dueToday) || 0;
      const overdue = Number(m.overdue) || 0;
      const sum = due + overdue;
      return {
        key: 'actionable',
        label: 'To do',
        value: sum > 0 || snapshot.refreshedAt ? sum : open,
        consumes: ['dueToday', 'overdue'],
      };
    }
    case 'gmail': {
      const action = Number.isFinite(m.action) ? Number(m.action) : Number.isFinite(m.starred) ? Number(m.starred) : open;
      return { key: 'action', label: 'Needs action', value: action, consumes: ['action'] };
    }
    case 'outlook': {
      const blue = Number.isFinite(m.blue) ? Number(m.blue) : open;
      return { key: 'blue', label: 'Blue items', value: blue, consumes: ['blue'] };
    }
    case 'radall':
      return {
        key: 'open',
        label: 'Open tasks',
        value: Number.isFinite(m.open) ? Number(m.open) : open,
        consumes: ['open'],
      };
    case 'candle':
      return {
        key: 'openStudioTasks',
        label: 'Open studio tasks',
        value: Number.isFinite(m.openStudioTasks) ? Number(m.openStudioTasks) : open,
        consumes: ['openStudioTasks'],
      };
    case 'move':
      return {
        key: 'openTasks',
        label: 'Open tasks',
        value: Number.isFinite(m.openTasks) ? Number(m.openTasks) : open,
        consumes: ['openTasks'],
      };
    case 'repair':
      return {
        key: 'open',
        label: 'Open repairs',
        value: Number.isFinite(m.open) ? Number(m.open) : open,
        consumes: ['open'],
      };
    case 'self':
      return {
        key: 'open',
        label: 'Open',
        value: Number.isFinite(m.open) ? Number(m.open) : open,
        consumes: ['open'],
      };
    case 'resale':
    case 'income':
    case 'role':
      return { key: 'actionable', label: 'Open tasks', value: open };
    default:
      return { key: 'actionable', label: 'Open', value: open };
  }
}

/** Decrement source metrics after a local hub dismiss so the blue count drops immediately. */
export function metricsAfterLocalComplete(
  sourceId: SourceId,
  snapshot: SourceSnapshot,
  taskId: string,
): Record<string, number> {
  const metrics = { ...snapshot.metrics };
  const task = (snapshot.tasks || []).find(t => t.id === taskId);
  const habit = task ? isHabit(task) : false;
  const hadItem =
    Boolean(task && task.status !== 'done') ||
    (snapshot.featured || []).some(f => f.id === taskId);

  if (!hadItem) return metrics;

  const dec = (key: string) => {
    if (Number.isFinite(metrics[key])) metrics[key] = Math.max(0, Number(metrics[key]) - 1);
  };

  switch (sourceId) {
    case 'ticktick':
      if (habit) dec('habits');
      else if ((metrics.overdue ?? 0) > 0) dec('overdue');
      else dec('dueToday');
      break;
    case 'gmail':
      dec('action');
      dec('starred');
      break;
    case 'outlook':
      dec('blue');
      if ((metrics.flagged ?? 0) > 0) dec('flagged');
      break;
    case 'radall':
    case 'repair':
    case 'self':
      dec('open');
      if (Number.isFinite(metrics.done)) metrics.done = Number(metrics.done) + 1;
      break;
    case 'candle':
      dec('openStudioTasks');
      break;
    case 'move':
      dec('openTasks');
      if (Number.isFinite(metrics.completedTasks)) {
        metrics.completedTasks = Number(metrics.completedTasks) + 1;
      } else {
        metrics.completedTasks = 1;
      }
      break;
    case 'resale':
    case 'income':
    case 'role':
      // Actionable comes from open task count; still bump done-ish counters when present.
      if (Number.isFinite(metrics.open)) dec('open');
      break;
    default:
      if (Number.isFinite(metrics.open)) dec('open');
  }

  return metrics;
}
