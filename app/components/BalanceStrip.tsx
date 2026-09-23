'use client';

import { useMemo, useState } from 'react';
import type { CompletionLedger } from '../../lib/completions';
import { OTHER_AREA_ID, computeBalance, type AreaBalance, type BalanceWindow, type FocusAreaConfig } from '../../lib/focusAreas';

const WINDOWS: Array<{ id: BalanceWindow; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: 'last7', label: '7 days' },
  { id: 'month', label: 'Month' },
];

const STATUS_LABEL: Record<AreaBalance['status'], string> = {
  healthy: '● On target',
  starved: '▼ Starved',
  overloaded: '▲ Heavy',
};

/** Below this many completions the shares are too noisy to judge. */
const LOW_SAMPLE = 5;

function pct(share: number) {
  return `${Math.round(share * 100)}%`;
}

export function BalanceStrip({ ledger, config }: { ledger: CompletionLedger; config: FocusAreaConfig }) {
  const [window, setWindow] = useState<BalanceWindow>('last7');
  const report = useMemo(() => computeBalance(ledger, config, window), [ledger, config, window]);
  // Scale bars so the largest of actual/benchmark fills the track
  const scale = Math.max(0.01, ...report.areas.flatMap(a => [a.actualShare, a.benchmark]));

  return (
    <div className="balance-strip" aria-label="Focus area balance">
      <div className="balance-head">
        <div>
          <p className="section-label">Balance</p>
          <p className="review-lede">
            {report.total ? (
              <>
                <strong>{report.overall}</strong>/100 balance · {report.total} completion
                {report.total === 1 ? '' : 's'} across focus areas
                {report.total < LOW_SAMPLE ? <span className="balance-note"> · small sample</span> : null}
              </>
            ) : (
              'No completions in this window yet.'
            )}
          </p>
        </div>
        <div className="balance-windows" role="group" aria-label="Balance window">
          {WINDOWS.map(w => (
            <button
              key={w.id}
              type="button"
              className={w.id === window ? 'active' : ''}
              aria-pressed={w.id === window}
              onClick={() => setWindow(w.id)}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>
      <div className="review-bars">
        {report.areas.map(area => {
          const tip = `${area.name}: ${area.count} done · ${pct(area.actualShare)} actual vs ${pct(area.benchmark)} target (${area.delta >= 0 ? '+' : ''}${Math.round(area.delta * 100)} pts)`;
          return (
            <div className={`review-bar-row balance-row is-${area.status}`} key={area.focusAreaId} title={tip}>
              <div className="review-bar-label">
                <span>{area.name}</span>
                <span>
                  {pct(area.actualShare)} <span className="balance-target">/ {pct(area.benchmark)}</span>
                  {report.total && area.focusAreaId !== OTHER_AREA_ID ? <span className="balance-status"> {STATUS_LABEL[area.status]}</span> : null}
                </span>
              </div>
              <div className="review-bar-track balance-track" aria-label={tip} role="img">
                {area.count ? (
                  <div className="review-bar-fill" style={{ width: `${(area.actualShare / scale) * 100}%` }} />
                ) : null}
                {area.benchmark > 0 ? (
                  <div className="balance-marker" style={{ left: `${(area.benchmark / scale) * 100}%` }} />
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      <p className="review-empty balance-legend">Bar = share of completions · tick = target share. Weights live in data/focus-areas.json.</p>
    </div>
  );
}
