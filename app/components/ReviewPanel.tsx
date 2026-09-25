'use client';

import { useMemo, useState } from 'react';
import type { CompletionEntry, CompletionLedger, CompletionStats, SourceShare } from '../../lib/completions';
import type { EnergyWindow } from '../../lib/energy';
import { sourceById } from '../../lib/sources';
import type { FocusAreaConfig } from '../../lib/focusAreas';
import { BalanceStrip } from './BalanceStrip';
import { CloudBackup } from './CloudBackup';

const SHOW_DONE = 40;

const PERIODS: Array<{ id: EnergyWindow; label: string; key: keyof CompletionStats }> = [
  { id: 'today', label: 'Today', key: 'today' },
  { id: 'last7', label: 'Past 7 days', key: 'last7' },
  { id: 'month', label: 'This month', key: 'month' },
  { id: 'all', label: 'All time', key: 'allTime' },
];

function periodStart(period: EnergyWindow, now = new Date()): number {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (period === 'today') return today;
  if (period === 'last7') return today - 6 * 86400000;
  if (period === 'month') return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  return -Infinity;
}

function doneWhen(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  // Date-only completions (e.g. Role Hub applied dates) land at local midnight — show just the day.
  const time = d.getHours() || d.getMinutes() ? ` ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : '';
  return `${sameDay ? 'Today' : d.toLocaleDateString([], { month: 'short', day: 'numeric' })}${time}`;
}

export function ReviewPanel({
  stats,
  ledger,
  focusConfig,
  renderBalance,
  renderSorting,
}: {
  stats: CompletionStats;
  ledger: CompletionLedger;
  focusConfig: FocusAreaConfig | null;
  /** Balance strip from LifeHub, drawn for the period chosen here */
  renderBalance?: (period: EnergyWindow) => React.ReactNode;
  /** "Needs a bucket or goal" box for this period's completions */
  renderSorting?: (entries: CompletionEntry[]) => React.ReactNode;
}) {
  // One period for the whole panel: the tiles pick it; By source and Balance follow.
  const [period, setPeriod] = useState<EnergyWindow>('today');
  const inPeriod = useMemo(() => {
    const start = periodStart(period);
    return Object.values(ledger.entries)
      .filter(e => Date.parse(e.completedAt) >= start)
      .sort((x, y) => Date.parse(y.completedAt) - Date.parse(x.completedAt));
  }, [ledger, period]);
  const periodShares: SourceShare[] = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of inPeriod) counts.set(e.source, (counts.get(e.source) || 0) + 1);
    const total = inPeriod.length;
    return [...counts.entries()]
      .map(([id, count]) => ({
        id: id as SourceShare['id'],
        name: sourceById[id as SourceShare['id']]?.shortName || id,
        count,
        percent: total ? Math.round((count / total) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.count - a.count);
  }, [inPeriod]);
  const periodLabel = PERIODS.find(p => p.id === period)!.label.toLowerCase();
  const max = Math.max(1, ...periodShares.map(s => s.count));
  return (
    <section className="review-panel glass-panel" aria-label="Completion review">
      <div className="review-columns">
      <div className="review-main">
      <div className="review-head">
        <p className="section-label">Review</p>
        <h2>Completions across sites</h2>
        <p className="review-lede">
          <strong>{stats.allTime}</strong> total tasks completed across all sources
          <span className="review-sep">·</span>
          <strong>{stats.openAcrossSources}</strong> open now
          <span className="review-sep">·</span>
          <strong>{stats.inventoryTasks}</strong> in hub inventory
        </p>
      </div>
      <div className="stats-strip period-tiles" role="group" aria-label="Choose a period">
        {PERIODS.map(p => (
          <button
            type="button"
            key={p.id}
            className={p.id === period ? 'active' : ''}
            aria-pressed={p.id === period}
            onClick={() => setPeriod(p.id)}
          >
            <strong>{stats[p.key] as number}</strong>
            <span>{p.id === 'today' ? 'Completed today' : p.label}</span>
          </button>
        ))}
      </div>
      <p className="section-label review-sources-label">By source · {periodLabel}</p>
      <div className="review-bars">
        {periodShares.length === 0 ? (
          <p className="review-empty">Nothing completed {period === 'all' ? 'yet' : periodLabel}.</p>
        ) : (
          periodShares.map(row => {
            const done = inPeriod.filter(e => e.source === row.id);
            return (
              <details className="review-bar-row review-source" key={row.id}>
                <summary>
                  <div className="review-bar-label">
                    <span>
                      <span className="review-caret" aria-hidden="true">▸</span>
                      {row.name}
                    </span>
                    <span>
                      {row.percent}% ({row.count} task{row.count === 1 ? '' : 's'})
                    </span>
                  </div>
                  <div className="review-bar-track" aria-hidden="true">
                    <div className="review-bar-fill" style={{ width: `${(row.count / max) * 100}%` }} />
                  </div>
                </summary>
                <ol className="review-done-list">
                  {done.slice(0, SHOW_DONE).map(e => (
                    <li key={`${e.taskId}-${e.completedAt}`}>
                      <span>{e.title || e.taskId}</span>
                      <time dateTime={e.completedAt}>{doneWhen(e.completedAt)}</time>
                    </li>
                  ))}
                  {done.length > SHOW_DONE ? <li className="review-done-more">+ {done.length - SHOW_DONE} earlier</li> : null}
                </ol>
              </details>
            );
          })
        )}
      </div>
      {renderSorting ? renderSorting(inPeriod) : null}
      </div>
      {focusConfig ? (
        <div className="review-side">
          {renderBalance ? (
            renderBalance(period)
          ) : (
            <BalanceStrip ledger={ledger} config={focusConfig} today={{}} settings={{ paces: {}, updatedAt: '' }} onSaveSettings={() => undefined} window={period} />
          )}
        </div>
      ) : null}
      </div>
      <CloudBackup />
    </section>
  );
}
