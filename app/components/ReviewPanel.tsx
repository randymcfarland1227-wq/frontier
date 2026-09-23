'use client';

import type { CompletionLedger, CompletionStats, SourceShare } from '../../lib/completions';
import type { FocusAreaConfig } from '../../lib/focusAreas';
import { BalanceStrip } from './BalanceStrip';
import { CloudBackup } from './CloudBackup';

const SHOW_DONE = 40;

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
  shares,
  ledger,
  focusConfig,
}: {
  stats: CompletionStats;
  shares: SourceShare[];
  ledger: CompletionLedger;
  focusConfig: FocusAreaConfig | null;
}) {
  const max = Math.max(1, ...shares.map(s => s.count));
  return (
    <section className="review-panel glass-panel" aria-label="Completion review">
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
      <div className="stats-strip" aria-label="Tasks completed">
        <article>
          <strong>{stats.today}</strong>
          <span>Completed today</span>
        </article>
        <article>
          <strong>{stats.last7}</strong>
          <span>Past 7 days</span>
        </article>
        <article>
          <strong>{stats.month}</strong>
          <span>This month</span>
        </article>
        <article>
          <strong>{stats.allTime}</strong>
          <span>All time</span>
        </article>
      </div>
      {focusConfig ? <BalanceStrip ledger={ledger} config={focusConfig} /> : null}
      <p className="section-label review-sources-label">By source</p>
      <div className="review-bars">
        {shares.length === 0 ? (
          <p className="review-empty">
            Complete tasks on the hub or an origin to build this chart. Counts persist in this browser.
          </p>
        ) : (
          shares.map(row => {
            const done = Object.values(ledger.entries)
              .filter(e => e.source === row.id)
              .sort((x, y) => Date.parse(y.completedAt) - Date.parse(x.completedAt));
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
      <CloudBackup />
    </section>
  );
}
