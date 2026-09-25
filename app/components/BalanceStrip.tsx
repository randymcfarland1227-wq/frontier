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
  type Suggestion,
} from '../../lib/energy';

/** Items listed in the Charge pop-up before "+N more". */
const SHOW_SUGGESTIONS = 6;

/** e.g. "3 done · 2 more to In-Line · 1 more to Balanced" */
function meta(a: AreaEnergy) {
  if (a.idle) return 'Nothing on its plate right now';
  const parts = [`${a.done} done`];
  if (a.progress === 'charge') parts.push(`${a.toInLine} more to In-Line`);
  else if (a.goal > 0) parts.push(a.progress === 'onfire' ? 'well past its goal' : 'goal met');
  if (a.focus === 'under') parts.push(`${a.toBalanced} more to Balanced`);
  if (a.focus === 'over') parts.push(`${a.overBy} past its fair share`);
  return parts.join(' · ');
}



const PROGRESS_ICON = { charge: '⚡', inline: '〰', onfire: '🔥' } as const;

function round(n: number) {
  return n >= 10 ? Math.round(n) : Math.round(n * 10) / 10;
}

function tip(a: AreaEnergy, window: EnergyWindow) {
  const span = window === 'today' ? 'today' : window === 'last7' ? 'over the past 7 days' : window === 'month' ? 'this month' : 'overall';
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
  window,
  suggestions = {},
}: {
  ledger: CompletionLedger;
  config: FocusAreaConfig;
  today: Availability;
  settings: BalanceSettings;
  onSaveSettings: (paces: Record<string, number>) => void;
  /** Period chosen in the Review panel */
  window: EnergyWindow;
  /** Open work per bucket that would charge it */
  suggestions?: Record<string, Suggestion[]>;
}) {
  const [editing, setEditing] = useState(false);
  /** Charge pop-up opened by tap (touch screens); hover/focus opens it on desktop. */
  const [openCharge, setOpenCharge] = useState<string | null>(null);
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
          <p className="section-label">
            Balance · {window === 'today' ? 'today' : window === 'last7' ? 'past 7 days' : window === 'month' ? 'this month' : 'all time'}
          </p>
          <p className="review-lede">
            {report.totalDone ? summary(report.areas) : 'Nothing completed in this window yet.'}
          </p>
        </div>
        <div className="balance-controls">
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
          <div className={`review-bar-row energy-row is-${a.progress} focus-${a.focus}`} key={a.id}>
            <div className="review-bar-label">
              <span>{a.name}</span>
              <span className="energy-badges">
                {(a.progress === 'charge' || a.focus === 'under') && (suggestions[a.id] || []).length ? (
                  <span className={`energy-charge${openCharge === a.id ? ' is-open' : ''}`}>
                    <button
                      type="button"
                      className={`energy-badge progress-${a.progress} energy-charge-btn`}
                      aria-expanded={openCharge === a.id}
                      aria-label={`${PROGRESS_LABEL[a.progress]} — show what could charge ${a.name}`}
                      onClick={() => setOpenCharge(o => (o === a.id ? null : a.id))}
                    >
                      {PROGRESS_ICON[a.progress]} {PROGRESS_LABEL[a.progress]}
                    </button>
                    <span className="energy-pop" role="tooltip">
                      <span className="energy-pop-title">Could charge it</span>
                      {suggestions[a.id].slice(0, SHOW_SUGGESTIONS).map(s => (
                        <span key={s.title} className="energy-pop-item">
                          {s.title}
                          {s.why === 'habit' ? <em> · habit</em> : null}
                        </span>
                      ))}
                      {suggestions[a.id].length > SHOW_SUGGESTIONS ? (
                        <span className="energy-pop-more">+{suggestions[a.id].length - SHOW_SUGGESTIONS} more</span>
                      ) : null}
                    </span>
                  </span>
                ) : (
                  <span className={`energy-badge progress-${a.progress}`}>
                    {PROGRESS_ICON[a.progress]} {PROGRESS_LABEL[a.progress]}
                  </span>
                )}
                <span className={`energy-badge focus-${a.focus}`}>{FOCUS_LABEL[a.focus]}</span>
              </span>
            </div>
            <div className="review-bar-track energy-track" role="img" aria-label={tip(a, window)}>
              {a.ratio > 0 ? <div className="review-bar-fill" style={{ width: `${Math.min(100, (a.ratio / 1.5) * 100)}%` }} /> : null}
              <div className="balance-marker" style={{ left: `${(1 / 1.5) * 100}%` }} />
            </div>
            <p className="energy-meta">{meta(a)}</p>
          </div>
        ))}
      </div>
      <p className="review-empty balance-legend">
        Bar = progress toward each bucket&apos;s goal (tick = goal met). Longer periods average the days.
        {report.estimated ? ' Earlier days use today’s workload until Life Hub has seen them.' : ''}
      </p>
    </div>
  );
}
