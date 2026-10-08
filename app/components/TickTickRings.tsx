'use client';

import { useEffect, useState } from 'react';
import type { CompletionLedger } from '../../lib/completions';
import { loadDayLog, TICKTICK_DAYLOG_EVENT } from '../../lib/ticktickDone';

type Counts = { done: number; skipped: number; open: number };

const isToday = (iso: string) => new Date(iso).toDateString() === new Date().toDateString();

/** One donut: done (green) + won't do (amber) = logged; the rest of the ring is still open. */
function Ring({ label, counts }: { label: string; counts: Counts }) {
  const logged = counts.done + counts.skipped;
  const total = logged + counts.open;
  const pct = total ? Math.round((logged / total) * 100) : 100;
  const r = 15.5;
  const c = 2 * Math.PI * r;
  const seg = (n: number) => (total ? (n / total) * c : 0);
  const doneLen = total ? seg(counts.done) : c;
  const skipLen = seg(counts.skipped);
  const tip = total
    ? `${label} today: ${counts.done} done · ${counts.skipped} won't do · ${counts.open} still open (${pct}% logged)`
    : `${label}: nothing due today`;
  return (
    <span className="tt-ring" title={tip} aria-label={tip}>
      <svg viewBox="0 0 40 40" aria-hidden="true">
        <circle className="tt-ring-track" cx="20" cy="20" r={r} />
        <circle className="tt-ring-done" cx="20" cy="20" r={r} strokeDasharray={`${doneLen} ${c}`} />
        {skipLen ? <circle className="tt-ring-skip" cx="20" cy="20" r={r} strokeDasharray={`${skipLen} ${c}`} strokeDashoffset={-doneLen} /> : null}
        <text x="20" y="20" className="tt-ring-pct">
          {pct}%
        </text>
      </svg>
      <span className="tt-ring-text">
        <b>{label}</b>
        <span>
          {total ? `${logged}/${total} logged` : 'none today'}
          {counts.open ? ` · ${counts.open} open` : ''}
        </span>
      </span>
    </span>
  );
}

/**
 * TickTick today, as two rings: how much of today's tasks and habits are logged — done or marked
 * won't do — versus still open. Open counts are the card's own numbers; done comes from the
 * completion ledger (today); won't do comes from TickTick's last pull.
 */
export function TickTickRings({ ledger, openTasks, openHabits }: { ledger: CompletionLedger; openTasks: number; openHabits: number }) {
  const [log, setLog] = useState(loadDayLog);
  useEffect(() => {
    const reload = () => setLog(loadDayLog());
    window.addEventListener(TICKTICK_DAYLOG_EVENT, reload);
    // Day rolls over while the page is open.
    const timer = window.setInterval(reload, 60_000);
    return () => {
      window.removeEventListener(TICKTICK_DAYLOG_EVENT, reload);
      window.clearInterval(timer);
    };
  }, []);

  let tasksDone = 0;
  let habitsDone = 0;
  for (const e of Object.values(ledger.entries)) {
    if (e.source !== 'ticktick' || !isToday(e.completedAt)) continue;
    if (e.taskId.startsWith('habit-')) habitsDone++;
    else tasksDone++;
  }
  return (
    <>
      <Ring label="Tasks" counts={{ done: tasksDone, skipped: log.wontDoTasks.length, open: openTasks }} />
      <Ring label="Habits" counts={{ done: habitsDone, skipped: log.skippedHabits.length, open: openHabits }} />
    </>
  );
}
