/**
 * Count work finished inside the TickTick app. The Worker reads TickTick's own completed-task
 * list and habit check-ins (Open API), so postponed tasks never count — TickTick only lists
 * what it marked complete. Each completion is recorded once per day.
 */

import { recordCompletion, loadLedger, type CompletionLedger } from './completions';
import { syncKeyHeader } from './cloudSync';

const WORKER_BASE =
  (import.meta as ImportMeta & { env?: { VITE_WORKER_URL?: string } }).env?.VITE_WORKER_URL ||
  'https://frontier-work-room.randymcfarland1227.workers.dev';

const DAYS = 7;

type DoneTask = { id: string; projectId?: string; title?: string; completedAt?: string };
type DoneHabit = { id: string; title?: string; stamp: string; completedAt?: string };

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
  const q = new URLSearchParams({
    from: stamp(start),
    to: stamp(end),
    start: start.toISOString(),
    end: end.toISOString(),
  });
  let body: { ok?: boolean; tasks?: DoneTask[]; habits?: DoneHabit[] };
  try {
    const res = await fetch(`${WORKER_BASE}/api/ticktick/done?${q}`, { headers: syncKeyHeader(), cache: 'no-store' });
    if (!res.ok) return null;
    body = await res.json();
  } catch {
    return null;
  }
  let ledger = loadLedger();
  const before = Object.keys(ledger.entries).length;
  for (const t of body.tasks || []) {
    ledger = recordCompletion('ticktick', t.id, {
      via: 'origin-done',
      at: t.completedAt,
      title: t.title,
      task: { kind: 'task', projectId: t.projectId },
      ledger,
    });
  }
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
  return Object.keys(ledger.entries).length === before ? null : ledger;
}

/** Hub Done on a habit: check it in on TickTick too (fire-and-forget). */
export function checkInTickTickHabit(habitId: string) {
  void fetch(`${WORKER_BASE}/api/ticktick/habit-checkin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...syncKeyHeader() },
    body: JSON.stringify({ habitId, stamp: stamp(new Date()) }),
  }).catch(() => undefined);
}
