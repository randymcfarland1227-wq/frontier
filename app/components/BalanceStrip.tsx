'use client';

import { useMemo, useState } from 'react';
import type { CompletionLedger } from '../../lib/completions';
import type { FocusAreaConfig } from '../../lib/focusAreas';
import {
  computeEnergy,
  DEFAULT_PACES,
  FOCUS_LABEL,
  loadAvailabilityHistory,
  PROGRESS_LABEL,
  type AreaEnergy,
  type Availability,
  type BalanceSettings,
  type EnergyWindow,
} from '../../lib/energy';

const WINDOWS: Array<{ id: EnergyWindow; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: 'last7', label: 'Week' },
  { id: 'month', label: 'Month' },
];

const PROGRESS_ICON = { charge: '⚡', inline: '〰', onfire: '🔥' } as const;

function round(n: number) {
  return n >= 10 ? Math.round(n) : Math.round(n * 10) / 10;
}

function tip(a: AreaEnergy, window: EnergyWindow) {
  const span = window === 'today' ? 'today' : window === 'last7' ? 'over the week' : 'this month';
  return `${a.name}: ${a.done} done ${span} · goal ≈ ${round(a.goal)} (of ${a.available} available) · ${Math.round(a.share * 100)}% of your completions vs a fair ${Math.round(a.fairShare * 100)}%`;
}

function summary(areas: AreaEnergy[]) {
  const inLine = areas.filter(a => a.progress !== 'charge').length;
  const over = areas.filter(a => a.focus === 'over').map(a => a.name);
  const parts = [`${inLine} of ${areas.length} In-Line or better`];
  if (over.length) parts.push(`Overfocused on ${over.join(', ')}`);
  else if (areas.every(a => a.focus === 'balanced')) parts.push('Balanced across the board');
  return parts.join(' · ');
}

export function BalanceStrip({
  ledger,
  config,
  today,
  settings,
  onSaveSettings,
}: {
  ledger: CompletionLedger;
  config: FocusAreaConfig;
  today: Availability;
  settings: BalanceSettings;
  onSaveSettings: (paces: Record<string, number>) => void;
}) {
  const [window, setWindow] = useState<EnergyWindow>('today');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, number>>({});

  const report = useMemo(
    () => computeEnergy(ledger, config, window, settings, loadAvailabilityHistory(), today),
    [ledger, config, window, settings, today],
  );

  const openSettings = () => {
    setDraft(Object.fromEntries(config.areas.map(a => [a.id, Math.round((settings.paces[a.id] ?? DEFAULT_PACES[a.id] ?? 0.2) * 100)])));
    setEditing(true);
  };

  return (
    <div className="balance-strip" aria-label="Balance across life buckets">
      <div className="balance-head">
        <div>
          <p className="section-label">Balance</p>
          <p className="review-lede">
            {report.totalDone ? summary(report.areas) : 'Nothing completed in this window yet.'}
          </p>
        </div>
        <div className="balance-controls">
          <div className="balance-windows" role="group" aria-label="Balance window">
            {WINDOWS.map(w => (
              <button key={w.id} type="button" className={w.id === window ? 'active' : ''} aria-pressed={w.id === window} onClick={() => setWindow(w.id)}>
                {w.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="balance-gear"
            aria-label="Balance settings"
            aria-expanded={editing}
            title="Set each bucket's pace"
            onClick={() => (editing ? setEditing(false) : openSettings())}
          >
            ⚙
          </button>
        </div>
      </div>

      {editing ? (
        <form
          className="balance-settings"
          onSubmit={e => {
            e.preventDefault();
            onSaveSettings(Object.fromEntries(Object.entries(draft).map(([k, v]) => [k, Math.max(1, Math.min(100, v)) / 100])));
            setEditing(false);
          }}
        >
          <p className="balance-settings-lede">
            <strong>Pace</strong> = how much of a bucket&apos;s available work makes a good day. Lower it as a site&apos;s list
            shrinks and each task gets harder.
          </p>
          {config.areas.map(a => {
            const pct = draft[a.id] ?? 0;
            const avail = today[a.id] || 0;
            return (
              <label key={a.id} className="balance-pace">
                <span className="balance-pace-name">{a.name}</span>
                <input
                  type="range"
                  min={1}
                  max={100}
                  value={pct}
                  onChange={e => setDraft(d => ({ ...d, [a.id]: Number(e.target.value) }))}
                  aria-label={`${a.name} pace`}
                />
                <span className="balance-pace-value">
                  {pct}% <em>≈ {round((avail * pct) / 100)} of {avail} today</em>
                </span>
              </label>
            );
          })}
          <div className="balance-settings-actions">
            <button type="submit" className="row-action">
              Save
            </button>
            <button type="button" className="row-action ghost" onClick={() => setDraft(Object.fromEntries(config.areas.map(a => [a.id, Math.round((DEFAULT_PACES[a.id] ?? 0.2) * 100)])))}>
              Reset to defaults
            </button>
            <button type="button" className="row-action ghost" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      <div className="review-bars">
        {report.areas.map(a => (
          <div className={`review-bar-row energy-row is-${a.progress} focus-${a.focus}`} key={a.id} title={tip(a, window)}>
            <div className="review-bar-label">
              <span>{a.name}</span>
              <span className="energy-badges">
                <span className={`energy-badge progress-${a.progress}`}>
                  {PROGRESS_ICON[a.progress]} {PROGRESS_LABEL[a.progress]}
                </span>
                <span className={`energy-badge focus-${a.focus}`}>{FOCUS_LABEL[a.focus]}</span>
              </span>
            </div>
            <div className="review-bar-track energy-track" role="img" aria-label={tip(a, window)}>
              {a.ratio > 0 ? <div className="review-bar-fill" style={{ width: `${Math.min(100, (a.ratio / 1.5) * 100)}%` }} /> : null}
              <div className="balance-marker" style={{ left: `${(1 / 1.5) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
      <p className="review-empty balance-legend">
        Bar = progress toward each bucket&apos;s goal (tick = goal met). Week and month average the days.
        {report.estimated ? ' Earlier days use today’s workload until Life Hub has seen them.' : ''}
      </p>
    </div>
  );
}
