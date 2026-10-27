'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Goal, GoalsData } from '../../lib/goals';
import type { SourceSnapshot, SpaceId } from '../../lib/types';
import { ALIGNMENT, type AlignmentItem } from '../../lib/alignment';
import { localDayKey, useDayKey } from '../../lib/dayKey';
import { LOCAL_WRITE_EVENT, readSaved, writeSaved } from '../../lib/storage';
import { modeOf, routinesFor, setGoalMode, useGoalModes, type GoalModes } from '../../lib/goalModes';

const AFFIRMATIONS_KEY = 'lifehub-grounding-affirmations';
const dayKey = localDayKey;
type Affirmations = { day: string; entries: Record<string, string> };
const emptyAffirmations: Affirmations = { day: '', entries: {} };

/** Affirmations are daily reflections, separate from the task completion ledger. */
function useAffirmations() {
  const day = useDayKey();
  const [saved, setSaved] = useState(() => readSaved<Affirmations>(AFFIRMATIONS_KEY, emptyAffirmations));
  useEffect(() => {
    const refresh = () => {
      setSaved(readSaved<Affirmations>(AFFIRMATIONS_KEY, emptyAffirmations));
    };
    const interval = window.setInterval(refresh, 30_000);
    window.addEventListener('focus', refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);
  const submit = (id: string, text: string): boolean => {
    const affirmation = text.trim();
    if (!affirmation) return false;
    const currentDay = dayKey();
    if (day !== currentDay) return false;
    const current = readSaved<Affirmations>(AFFIRMATIONS_KEY, emptyAffirmations);
    const next = { day, entries: { ...(current?.day === day ? current.entries : {}), [id]: affirmation } };
    try {
      window.localStorage.setItem(AFFIRMATIONS_KEY, JSON.stringify(next));
    } catch { return false; }
    setSaved(next);
    window.dispatchEvent(new CustomEvent(LOCAL_WRITE_EVENT, { detail: AFFIRMATIONS_KEY }));
    return true;
  };
  return { day, entries: saved?.day === day ? saved.entries || {} : {}, submit };
}

/** The affirmation for one reminder: put it in your own words, press Enter. Required daily to count as reviewed. */
function AffirmationForm({ guide, reviewed, submit }: { guide: AlignmentItem; reviewed?: string; submit: (id: string, text: string) => boolean }) {
  const [draft, setDraft] = useState(reviewed || '');
  const [error, setError] = useState('');
  return (
    <form
      className="gr-affirm"
      aria-label={`${guide.title} affirmation`}
      onSubmit={event => {
        event.preventDefault();
        if (!draft.trim()) {
          setError('Write an affirmation in your own words first.');
          return;
        }
        if (submit(guide.id, draft)) {
          setDraft(draft.trim());
          setError('');
        } else setError('Your affirmation couldn’t be saved. Please try again.');
      }}
    >
      <label htmlFor={`affirmation-${guide.id}`}>{reviewed ? '✓ Affirmed today' : 'Affirmation'}</label>
      <div className="gr-affirm-row">
        <span className="gr-trace">
          <span className="gr-ghost" aria-hidden="true">{guide.ghost}</span>
          <textarea
            id={`affirmation-${guide.id}`}
            rows={3}
            value={draft}
            maxLength={1000}
            autoComplete="off"
            aria-invalid={!!error}
            aria-describedby={error ? `affirmation-error-${guide.id}` : undefined}
            onChange={event => {
              setDraft(event.target.value);
              setError('');
            }}
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
        </span>
        <button type="submit" className="gr-btn is-primary" disabled={!draft.trim() || draft.trim() === reviewed}>
          {reviewed ? 'Update' : 'Affirm'}
        </button>
      </div>
      {error ? (
        <p id={`affirmation-error-${guide.id}`} className="gr-affirm-error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}


/** Collapsed-bar summary: how many reminders are affirmed today. */
export function GroundingSummary() {
  const { entries } = useAffirmations();
  const total = ALIGNMENT.length;
  const done = Object.values(entries).filter(v => v?.trim()).length;
  return (
    <span className={`sum-chip${done >= total ? ' is-done' : ''}`}>
      <b>{Math.min(done, total)}</b>/{total} affirmed
    </span>
  );
}

/**
 * Daily grounding, top to bottom: Alignment (one box per item, each with its own affirmation, left to right)
 * → current goals as boxes by area → what unlocks the move.
 */
export function DailyGrounding({ move, goals, enter }: { move?: SourceSnapshot; goals: GoalsData | null; enter: (space: SpaceId) => void }) {
  const { day, entries, submit } = useAffirmations();
  const modes = useGoalModes();
  const [selectedGoal, selectGoal] = useState<string | null>(null);
  const affirmed = ALIGNMENT.filter(g => entries[g.id]?.trim()).length;
  const moveGoals = (move?.featured || []).filter(f => f.completable === false);
  const currentGoals = (goals?.goals || []).filter(g => g.status === 'active');
  const counts = { active: 0, passive: 0, none: 0 };
  for (const g of currentGoals) counts[modeOf(g.id, modes).mode || 'none']++;
  const selected = currentGoals.find(g => g.id === selectedGoal) || null;
  const [openCat, setOpenCat] = useState<string | null>(null);
  const openCategory = goals?.categories.find(c => c.id === openCat) || null;
  const popGoals = currentGoals.filter(g => g.categoryId === openCat);
  const openFlow = () => {
    writeSaved('lifehub-why-tab', 'flow');
    enter('why');
  };

  return (
    <section className="grounding glass-panel" aria-label="Daily grounding">
      <header className="gr-head">
        <p className="section-label">Grounding</p>
        <h2>Today</h2>
        <p className="gr-sub">{new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</p>
        <span className="gr-progress" aria-live="polite" aria-label={`${affirmed} of ${ALIGNMENT.length} affirmed today`}>
          {ALIGNMENT.map(g => (
            <i key={g.id} className={entries[g.id]?.trim() ? 'is-done' : ''} />
          ))}
          <b>
            {affirmed}/{ALIGNMENT.length}
          </b>{' '}
          affirmed
        </span>
      </header>

      {/* 1 · Alignment */}
      <div className="gr-part">
        <h3 className="gr-part-title">
          Alignment <span>· read each one, then put it in your own words</span>
        </h3>
        <div className="gr-align">
          {ALIGNMENT.map(item => (
            <article key={item.id} className={`gr-item tone-${item.tone}${entries[item.id]?.trim() ? ' is-done' : ''}`} aria-label={item.title}>
              <header>
                <span className="gr-card-icon" aria-hidden="true">
                  {item.icon}
                </span>
                <h4>{item.title}</h4>
              </header>
              <ul>
                {item.lines.map(l => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
              {item.via ? (
                <span className="gr-via">
                  {item.via.map(v => (
                    <i key={v}>{v}</i>
                  ))}
                </span>
              ) : null}
              {item.link?.url ? (
                <a className="gr-link gr-item-link" href={item.link.url} target="_blank" rel="noopener noreferrer">
                  {item.link.label} ↗
                </a>
              ) : null}
              <AffirmationForm key={`${day}:${item.id}`} guide={item} reviewed={entries[item.id]} submit={submit} />
            </article>
          ))}
        </div>
      </div>

      {/* 2 · Current goals */}
      <div className="gr-part">
        <h3 className="gr-part-title">
          Current goals <span>· tap one for its why and practices</span>
          <span className="gr-legend" aria-label="Key">
            <span className="gr-key is-active">Active {counts.active}</span>
            <span className="gr-key is-passive">Passive {counts.passive}</span>
            {counts.none ? <span className="gr-key is-none">No routine yet {counts.none}</span> : null}
          </span>
          <button type="button" className="gr-link" onClick={openFlow}>
            Open Flow →
          </button>
        </h3>
        {goals === null ? (
          <p className="gr-empty">Loading goals…</p>
        ) : (
          <>
            <div className="gr-cats">
              {goals.categories.map(c => {
                const list = currentGoals.filter(g => g.categoryId === c.id);
                if (!list.length) return null;
                return (
                  <button key={c.id} type="button" className={`gr-cat area-${c.id}`} onClick={() => { setOpenCat(c.id); selectGoal(null); }}>
                    <span className="gr-cat-icon" aria-hidden="true">{c.icon}</span>
                    <span className="gr-cat-name">{c.label}</span>
                    <span className="gr-cat-count">{list.length} goals</span>
                  </button>
                );
              })}
            </div>
            {openCategory ? createPortal(
              <div className="gr-pop-back" role="presentation" onClick={() => setOpenCat(null)}>
                <div className={`gr-pop area-${openCategory.id}`} role="dialog" aria-label={openCategory.label} onClick={e => e.stopPropagation()}>
                  <header>
                    <strong><span aria-hidden="true">{openCategory.icon}</span> {openCategory.label}</strong>
                    <button type="button" className="gr-pop-x" aria-label="Close" onClick={() => setOpenCat(null)}>✕</button>
                  </header>
                  <div className="gr-boxes">
                    {popGoals.map(g => {
                      const { mode } = modeOf(g.id, modes);
                      return (
                        <button key={g.id} type="button" className={`gr-gbox is-${mode || 'none'}${selectedGoal === g.id ? ' is-open' : ''}`} onClick={() => selectGoal(selectedGoal === g.id ? null : g.id)}>
                          <span className="gr-gbox-title">{g.title}</span>
                          <span className="gr-gbox-mode">{mode === 'active' ? 'Active' : mode === 'passive' ? 'Passive' : 'No routine yet'}</span>
                        </button>
                      );
                    })}
                  </div>
                  {selected && selected.categoryId === openCategory.id ? <GoalDetail goal={selected} modes={modes} close={() => selectGoal(null)} openFlow={openFlow} /> : null}
                </div>
              </div>,
              document.querySelector('.frontier-shell') || document.body,
            ) : null}
          </>
        )}
      </div>

      {/* 3 · Move */}
      <div className="gr-part">
        <h3 className="gr-part-title">
          Move <span>· what unlocks the move</span>
          <button type="button" className="gr-link" onClick={() => enter('move')}>
            Open Move OS →
          </button>
        </h3>
        {moveGoals.length ? (
          <ul className="gr-move">
            {moveGoals.map(g => (
              <li key={g.id}>
                <strong>{g.title}</strong>
                {g.detail ? <small>{g.detail}</small> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="gr-empty">Open Move OS once and its goals show here.</p>
        )}
      </div>
    </section>
  );
}

const TIER_LABEL: Record<string, string> = { drive: 'Drives it', enable: 'Makes it easier', upkeep: 'Keeps it up' };

/** The opened goal, under its area row: your why and how, active or passive, and the Flow routines behind it. */
function GoalDetail({ goal, modes, close, openFlow }: { goal: Goal; modes: GoalModes; close: () => void; openFlow: () => void }) {
  const { mode, mine } = modeOf(goal.id, modes);
  const routines = routinesFor(goal.id);
  const tiers = ['drive', 'enable', 'upkeep'].map(t => ({ t, list: routines.filter(r => r.tier === t) })).filter(x => x.list.length);
  return (
    <div className="gr-goal">
      <div className="gr-goal-head">
        <strong>{goal.title}</strong>
        <span className="gr-mode" role="group" aria-label={`${goal.title}: active or passive`}>
          {(['active', 'passive'] as const).map(m => (
            <button key={m} type="button" className={mode === m ? 'is-on' : ''} aria-pressed={mode === m} onClick={() => setGoalMode(goal.id, m)}>
              {m === 'active' ? 'Active' : 'Passive'}
            </button>
          ))}
        </span>
        <small className="gr-mode-src">{mine ? 'your call' : mode ? 'from Flow' : 'no routine yet — pick one'}</small>
        {mine ? (
          <button type="button" className="gr-link" onClick={() => setGoalMode(goal.id, null)}>
            Use Flow’s
          </button>
        ) : null}
        <button type="button" className="gr-link gr-goal-close" onClick={close} aria-label={`Close ${goal.title}`}>
          ✕
        </button>
      </div>
      {goal.why ? <p className="gr-goal-why">{goal.why}</p> : null}
      {goal.how ? (
        <p className="gr-goal-how">
          <b>How:</b> {goal.how}
        </p>
      ) : null}
      {tiers.length ? (
        <div className="gr-goal-tiers">
          {tiers.map(({ t, list }) => (
            <div key={t} className={`gr-tier tier-${t}`}>
              <span className="gr-tier-name">{TIER_LABEL[t] || t}</span>
              <span className="gr-tier-list">
                {list.map(r => (
                  <span key={r.id} className="gr-routine" title={r.when}>
                    {r.title}
                  </span>
                ))}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="gr-goal-how">
          Nothing in Flow drives this yet.{' '}
          <button type="button" className="gr-link" onClick={openFlow}>
            Link a routine in Flow →
          </button>
        </p>
      )}
    </div>
  );
}
