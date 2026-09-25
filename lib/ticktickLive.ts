/**
 * Live TickTick list for the card: open tasks due today or overdue, plus habits due today that
 * aren't checked in yet — what TickTick's Today view shows. Reminders / reference notes are left out.
 */

import type { SourceSnapshot, TaskItem } from './types';
import type { CompletionLedger } from './completions';
import { syncKeyHeader } from './cloudSync';
import { habitDueOn, dayKey, type HabitSchedule } from './energy';
import { isIgnoredItem } from './focusAreas';

const WORKER_BASE =
  (import.meta as ImportMeta & { env?: { VITE_WORKER_URL?: string } }).env?.VITE_WORKER_URL ||
  'https://frontier-work-room.randymcfarland1227.workers.dev';

type OpenTask = {
  id: string;
  projectId?: string;
  list?: string;
  title?: string;
  detail?: string;
  dueAt?: string;
  allDay?: boolean;
  priority?: number;
  tags?: string[];
};

export async function fetchOpenTickTick(): Promise<OpenTask[] | null> {
  try {
    const res = await fetch(`${WORKER_BASE}/api/ticktick/open`, { headers: syncKeyHeader(), cache: 'no-store' });
    if (!res.ok) return null;
    const body = (await res.json()) as { ok?: boolean; tasks?: OpenTask[] };
    return body.ok && Array.isArray(body.tasks) ? body.tasks : null;
  } catch {
    return null;
  }
}

/** Build the TickTick snapshot from live data (tasks) + the habit schedule and today's check-ins. */
export function buildTickTickToday(
  open: OpenTask[],
  schedule: HabitSchedule[] | null,
  ledger: CompletionLedger,
  previous?: SourceSnapshot,
): SourceSnapshot {
  const now = new Date();
  const today = dayKey(now);
  const tasks: TaskItem[] = [];
  let dueToday = 0;
  let overdue = 0;

  const dated = open
    .filter(t => t.dueAt && t.title && !isIgnoredItem('ticktick', t.title))
    .map(t => ({ t, day: dayKey(new Date(t.dueAt!)) }))
    .filter(x => x.day <= today)
    .sort((a, b) => a.day.localeCompare(b.day) || (b.t.priority || 0) - (a.t.priority || 0));
  for (const { t, day } of dated) {
    if (day < today) overdue += 1;
    else dueToday += 1;
    tasks.push({
      id: t.id,
      title: t.title!,
      detail: [t.list, t.detail].filter(Boolean).join(' · ') || undefined,
      status: 'open',
      due: day,
      projectId: t.projectId,
      tags: t.tags,
      kind: 'task',
      originUrl: t.projectId ? `https://ticktick.com/webapp/#p/${t.projectId}/tasks/${t.id}` : undefined,
    });
  }

  let habits = 0;
  if (schedule) {
    const doneToday = new Set(
      Object.values(ledger.entries)
        .filter(e => e.source === 'ticktick' && dayKey(new Date(e.completedAt)) === today)
        .map(e => e.taskId),
    );
    for (const h of schedule) {
      if (!h.title || isIgnoredItem('ticktick', h.title) || !habitDueOn(h, now) || doneToday.has(h.id)) continue;
      habits += 1;
      tasks.push({ id: h.id, title: h.title, status: 'open', due: today, kind: 'habit' });
    }
  }

  const openIds = new Set(tasks.map(t => t.id));
  return {
    source: 'ticktick',
    metrics: { dueToday, overdue, habits },
    // Keep anything featured before that's still open today.
    featured: (previous?.featured || []).filter(f => openIds.has(f.id)),
    tasks,
    refreshedAt: now.toISOString(),
  };
}
