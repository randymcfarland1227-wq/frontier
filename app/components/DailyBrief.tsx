'use client';

import { useMemo, useState } from 'react';
import { buildBrief, type BriefSection } from '../../lib/dailyBrief';
import { openTaskPanel } from '../../lib/priorityPins';
import { readSaved, writeSaved } from '../../lib/storage';
import type { BillDue } from '../../lib/schedule';
import type { SourceId, SourceSnapshot, SpaceId } from '../../lib/types';

const SEEN_KEY = 'lifehub-brief-seen';
const SHOWN = typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches ? 4 : 6;

/** The chips on the folded bar: only sections that have something. */
export function BriefSummary({ snapshots, bills }: { snapshots: Record<SourceId, SourceSnapshot>; bills: BillDue[] }) {
  const sections = useMemo(() => buildBrief(snapshots, bills), [snapshots, bills]);
  const short: Record<BriefSection['id'], string> = { money: 'money', tasks: 'tasks today', mail: 'mail', roles: 'roles', sales: 'sales' };
  const live = sections.filter(s => s.rows.length);
  if (!live.length) return <span className="sum-chip">All clear</span>;
  return (
    <>
      {live.map(s => (
        <span key={s.id} className={`sum-chip${s.id === 'money' && s.rows.some(r => r.tone === 'late') ? ' is-critical' : ''}`}>
          <b>{s.rows.length}</b> {short[s.id]}
        </span>
      ))}
    </>
  );
}

export function DailyBrief({ snapshots, bills, enter }: { snapshots: Record<SourceId, SourceSnapshot>; bills: BillDue[]; enter: (id: SpaceId) => void }) {
  const sections = useMemo(() => buildBrief(snapshots, bills), [snapshots, bills]);
  const [seen, setSeen] = useState<string[]>(() => readSaved<string[]>(SEEN_KEY, []));
  const [more, setMore] = useState<string | null>(null);
  const all = sections.flatMap(s => s.rows.map(r => r.id));
  const fresh = all.filter(id => !seen.includes(id)).length;
  const markSeen = () => {
    writeSaved(SEEN_KEY, all);
    setSeen(all);
  };
  const stamp = new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  return (
    <div className="brief">
      <p className="brief-head">
        <span>{stamp}</span>
        {fresh ? (
          <button type="button" className="mny-btn" onClick={markSeen} title="Clears the NEW tags; items stay until they’re dealt with">
            {fresh} new · mark all seen
          </button>
        ) : null}
      </p>
      {sections.every(s => !s.rows.length) ? <p className="mny-empty">Nothing overdue, due today, or waiting on you. 🎉</p> : null}
      <div className="brief-grid">
        {sections
          .filter(s => s.rows.length)
          .map(s => {
            const rows = more === s.id ? s.rows : s.rows.slice(0, SHOWN);
            return (
              <section key={s.id} className={`brief-sec brief-${s.id}`}>
                <h3>
                  {s.label} <b>{s.rows.length}</b>
                </h3>
                <ul>
                  {rows.map(r => (
                    <li key={r.id}>
                      <button type="button" className="brief-row" onClick={() => (r.pin ? openTaskPanel(r.pin) : enter(r.go))} title={r.title}>
                        {!seen.includes(r.id) ? <i className="brief-new">NEW</i> : null}
                        <span className="brief-title">{r.title}</span>
                        <span className={`brief-note${r.tone ? ` is-${r.tone}` : ''}`}>{r.note}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                {s.rows.length > SHOWN ? (
                  <button type="button" className="brief-more" onClick={() => setMore(more === s.id ? null : s.id)}>
                    {more === s.id ? 'Show fewer' : `+ ${s.rows.length - SHOWN} more`}
                  </button>
                ) : null}
              </section>
            );
          })}
      </div>
    </div>
  );
}
