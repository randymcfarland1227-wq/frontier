/** Completion ledger + review stats for Life Hub. */

import type { SourceId, SourceSnapshot, TaskItem } from './types';
import { SOURCE_IDS, sourceById } from './sources';
import { readSaved, writeSaved, STORAGE_KEYS } from './storage';
import { resolveFocusArea, type FocusAreaId } from './focusAreas';

export type CompletionEntry = {
  source: SourceId;
  taskId: string;
  completedAt: string; // ISO
  title?: string;
  via: 'hub' | 'origin-snapshot' | 'connector-diff' | 'self';
  /** Resolved via focus-areas.json at record time; persisted so history stays stable if maps change. */
  focusAreaId?: FocusAreaId;
};

export type CompletionLedger = {
  /** key = `${source}::${taskId}` */
  entries: Record<string, CompletionEntry>;
};

export type CompletionStats = {
  today: number;
  last7: number;
  month: number;
  allTime: number;
  bySource: Record<SourceId, number>;
  openAcrossSources: number;
  inventoryTasks: number;
};

function ledgerKey(source: SourceId, taskId: string) {
  return `${source}::${taskId}`;
}

export function loadLedger(): CompletionLedger {
  return readSaved<CompletionLedger>(STORAGE_KEYS.completions, { entries: {} });
}

export function saveLedger(ledger: CompletionLedger) {
  writeSaved(STORAGE_KEYS.completions, ledger);
}

/** Record a completion; dedupes by source+taskId (keeps earliest completedAt). */
export function recordCompletion(
  source: SourceId,
  taskId: string,
  opts?: {
    title?: string;
    via?: CompletionEntry['via'];
    at?: string;
    ledger?: CompletionLedger;
    /** Extra task fields focus rules can match on */
    task?: Pick<TaskItem, 'kind' | 'projectId' | 'tags'>;
    /** Explicit area (e.g. from a promoted capture) — skips rule resolution */
    focusAreaId?: FocusAreaId;
  },
): CompletionLedger {
  const ledger = opts?.ledger ?? loadLedger();
  const key = ledgerKey(source, taskId);
  if (ledger.entries[key]) return ledger;
  ledger.entries[key] = {
    source,
    taskId,
    completedAt: opts?.at || new Date().toISOString(),
    title: opts?.title,
    via: opts?.via || 'hub',
    focusAreaId: opts?.focusAreaId ?? resolveFocusArea({
      source,
      taskId,
      title: opts?.title,
      kind: opts?.task?.kind,
      projectId: opts?.task?.projectId,
      tags: opts?.task?.tags,
    }),
  };
  saveLedger(ledger);
  return ledger;
}

function startOfLocalDay(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function computeStats(
  ledger: CompletionLedger,
  snapshots: Record<SourceId, SourceSnapshot>,
): CompletionStats {
  const now = new Date();
  const todayStart = startOfLocalDay(now).getTime();
  const last7Start = todayStart - 6 * 24 * 60 * 60 * 1000;
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

  const bySource = Object.fromEntries(SOURCE_IDS.map(id => [id, 0])) as Record<SourceId, number>;
  let today = 0;
  let last7 = 0;
  let month = 0;
  let allTime = 0;

  for (const entry of Object.values(ledger.entries)) {
    allTime += 1;
    bySource[entry.source] = (bySource[entry.source] || 0) + 1;
    const t = Date.parse(entry.completedAt);
    if (Number.isNaN(t)) continue;
    if (t >= todayStart) today += 1;
    if (t >= last7Start) last7 += 1;
    if (t >= monthStart) month += 1;
  }

  let openAcrossSources = 0;
  let inventoryTasks = 0;
  for (const id of SOURCE_IDS) {
    const tasks = snapshots[id]?.tasks || [];
    inventoryTasks += tasks.length;
    openAcrossSources += tasks.filter(task => task.status !== 'done').length;
  }

  return { today, last7, month, allTime, bySource, openAcrossSources, inventoryTasks };
}

export type SourceShare = {
  id: SourceId;
  name: string;
  count: number;
  percent: number;
};

export function sourceShares(stats: CompletionStats): SourceShare[] {
  const total = stats.allTime || 0;
  return SOURCE_IDS.map(id => {
    const count = stats.bySource[id] || 0;
    return {
      id,
      name: sourceById[id].shortName,
      count,
      percent: total ? Math.round((count / total) * 1000) / 10 : 0,
    };
  })
    .filter(row => row.count > 0)
    .sort((a, b) => b.count - a.count);
}

/**
 * Diff previous vs next snapshot tasks: open/missing → done counts as origin completion.
 * Skips first-seen snapshots (no prior) to avoid flooding the ledger on first load.
 */
export function diffSnapshotCompletions(
  source: SourceId,
  previous: SourceSnapshot | undefined,
  next: SourceSnapshot,
  ledger?: CompletionLedger,
): CompletionLedger {
  let current = ledger ?? loadLedger();
  if (!previous || !previous.refreshedAt) {
    return current;
  }
  const prevOpen = new Map(
    (previous.tasks || [])
      .filter(t => t.status !== 'done')
      .map(t => [t.id, t]),
  );
  const nextById = new Map((next.tasks || []).map(t => [t.id, t]));

  for (const [id, prevTask] of prevOpen) {
    const nxt = nextById.get(id);
    if (!nxt) {
      // Task disappeared from open inventory → treat as completed on origin
      current = recordCompletion(source, id, {
        title: prevTask.title,
        via: source === 'self' ? 'self' : 'origin-snapshot',
        ledger: current,
        task: prevTask,
      });
    } else if (nxt.status === 'done' && prevTask.status !== 'done') {
      current = recordCompletion(source, id, {
        title: nxt.title || prevTask.title,
        via: source === 'self' ? 'self' : 'origin-snapshot',
        ledger: current,
        task: { ...prevTask, ...nxt },
      });
    }
  }
  return current;
}

export function emptyStats(): CompletionStats {
  return {
    today: 0,
    last7: 0,
    month: 0,
    allTime: 0,
    bySource: Object.fromEntries(SOURCE_IDS.map(id => [id, 0])) as Record<SourceId, number>,
    openAcrossSources: 0,
    inventoryTasks: 0,
  };
}
