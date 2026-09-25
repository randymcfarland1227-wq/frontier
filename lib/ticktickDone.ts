/**
 * Count work finished inside the TickTick app. The Worker reads TickTick's own completed-task
 * list and habit check-ins (Open API), so postponed tasks never count — TickTick only lists
 * what it marked complete. Each completion is recorded once per day.
 */

import { recordCompletion, loadLedger, moveCompletionEarlier, saveLedger, type CompletionLedger } from './completions';
import { tickTickTitleKey } from './syncState';
import { syncKeyHeader } from './cloudSync';
import type { HabitSchedule } from './energy';

const WORKER_BASE =
  (import.meta as ImportMeta & { env?: { VITE_WORKER_URL?: string } }).env?.VITE_WORKER_URL ||
  'https://frontier-work-room.randymcfarland1227.workers.dev';

const DAYS = 7;

type DoneTask = { id: string; projectId?: string; title?: string; completedAt?: string; dueAt?: string; allDay?: boolean };

/** Ticks of the same task this close together are one catch-up, not separate completions. */
const BURST_MS = 2 * 60 * 1000;

function dayOf(iso: string) {
  const d = new Date(iso);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * When a TickTick task counts:
 * - Done late (ticked after the day it was due) → on its due day (all-day tasks at midday).
 * - Done on or before its due day → when it was ticked.
 * - Clicking through overdue copies of a recurring task (same title, ticked within a couple of
 *   minutes) is catching up, not doing it several times: every copy lands on the latest copy's
 *   day, so it counts once.
 */
export function attributeTickTickTasks(tasks: DoneTask[]): Array<DoneTask & { at: string }> {
  const when = (t: DoneTask): string | undefined => {
    if (!t.completedAt) return undefined;
    if (!t.dueAt || dayOf(t.dueAt) >= dayOf(t.completedAt)) return t.completedAt;
    const due = new Date(t.dueAt);
    return t.allDay ? new Date(due.getFullYear(), due.getMonth(), due.getDate(), 12).toISOString() : t.dueAt;
  };
  const out: Array<DoneTask & { at: string }> = [];
  const byTitle = new Map<string, DoneTask[]>();
  for (const t of tasks) {
    if (!t.completedAt) continue;
    const k = tickTickTitleKey(t.title) || t.id;
    byTitle.set(k, [...(byTitle.get(k) || []), t]);
  }
  for (const group of byTitle.values()) {
    group.sort((a, b) => Date.parse(a.completedAt!) - Date.parse(b.completedAt!));
    let burst: DoneTask[] = [];
    const flush = () => {
      if (!burst.length) return;
      const latest = burst.reduce((best, t) =>
        Date.parse(t.dueAt || t.completedAt!) >= Date.parse(best.dueAt || best.completedAt!) ? t : best,
      );
      const at = when(latest)!;
      for (const t of burst) out.push({ ...t, at });
      burst = [];
    };
    for (const t of group) {
      const prev = burst[burst.length - 1];
      if (prev && Date.parse(t.completedAt!) - Date.parse(prev.completedAt!) > BURST_MS) flush();
      burst.push(t);
    }
    flush();
  }
  return out;
}
type DoneHabit = { id: string; title?: string; stamp: string; completedAt?: string };

/** Latest habit schedules from the feed (which habits are due on which days). */
let lastSchedule: HabitSchedule[] | null = null;
export function getHabitSchedule(): HabitSchedule[] | null {
  return lastSchedule;
}

function stamp(d: Date) {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

function stampDate(s: string) {
  // Midday avoids a timezone shift moving the check-in to another day.
  return new Date(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8)), 12);
}

export async function pullTickTickDone(): Promise<CompletionLedger | null> {
  const end = new Date();
  const start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - (DAYS - 1));
  // TickTick's habit check-in range excludes the `to` day, so ask through tomorrow
  // (otherwise today's check-ins never show up).
  const tomorrow = new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1);
  const q = new URLSearchParams({
    from: stamp(start),
    to: stamp(tomorrow),
    start: start.toISOString(),
    end: end.toISOString(),
  });
  let body: { ok?: boolean; tasks?: DoneTask[]; habits?: DoneHabit[]; schedule?: HabitSchedule[] };
  try {
    const res = await fetch(`${WORKER_BASE}/api/ticktick/done?${q}`, { headers: syncKeyHeader(), cache: 'no-store' });
    if (!res.ok) return null;
    body = await res.json();
  } catch {
    return null;
  }
  if (Array.isArray(body.schedule) && body.schedule.length) lastSchedule = body.schedule;
  let ledger = loadLedger();
  const before = Object.keys(ledger.entries).length;
  let moved = false;
  for (const t of attributeTickTickTasks(body.tasks || [])) {
    // Already recorded (e.g. hub Done, or before this rule)? Move it to the right day.
    if (moveCompletionEarlier(ledger, 'ticktick', t.id, t.at)) moved = true;
    ledger = recordCompletion('ticktick', t.id, {
      via: 'origin-done',
      at: t.at,
      title: t.title,
      task: { kind: 'task', projectId: t.projectId },
      ledger,
    });
  }
  if (moved) saveLedger(ledger);
  for (const h of body.habits || []) {
    const day = stampDate(h.stamp);
    const exact = h.completedAt ? new Date(h.completedAt) : null;
    const sameDay = exact && stamp(exact) === h.stamp;
    ledger = recordCompletion('ticktick', h.id, {
      via: 'origin-done',
      at: (sameDay ? exact : day).toISOString(),
      title: h.title,
      task: { kind: 'habit' },
      ledger,
    });
  }
  return Object.keys(ledger.entries).length === before && !moved ? null : ledger;
}

/** Hub Done on a habit: check it in on TickTick too (fire-and-forget). */
export function checkInTickTickHabit(habitId: string) {
  void fetch(`${WORKER_BASE}/api/ticktick/habit-checkin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...syncKeyHeader() },
    body: JSON.stringify({ habitId, stamp: stamp(new Date()) }),
  }).catch(() => undefined);
}
