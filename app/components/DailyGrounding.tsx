'use client';

import { useEffect, useState } from 'react';
import type { Goal, GoalsData } from '../../lib/goals';
import type { SourceSnapshot, SpaceId } from '../../lib/types';
import { LOCAL_WRITE_EVENT, readSaved, writeSaved } from '../../lib/storage';
import { modeOf, routinesFor, setGoalMode, useGoalModes, type GoalModes } from '../../lib/goalModes';

type Guide = {
  id: string;
  title: string;
  icon: string;
  when: 'Daily' | 'Weekdays';
  from: string;
  key?: string;
  intro?: string;
  outro?: string;
  sections: Array<{ heading: string; lines: string[] }>;
  link?: { label: string; url?: string; space?: SpaceId };
};

const AFFIRMATIONS_KEY = 'lifehub-grounding-affirmations';
const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
type Affirmations = { day: string; entries: Record<string, string> };
const emptyAffirmations: Affirmations = { day: '', entries: {} };

/** Affirmations are daily reflections, separate from the task completion ledger. */
function useAffirmations() {
  const [day, setDay] = useState(dayKey);
  const [saved, setSaved] = useState(() => readSaved<Affirmations>(AFFIRMATIONS_KEY, emptyAffirmations));
  useEffect(() => {
    const refresh = () => {
      setDay(dayKey());
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
    if (day !== currentDay) { setDay(currentDay); return false; }
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
function AffirmationForm({ guide, reviewed, submit }: { guide: Guide; reviewed?: string; submit: (id: string, text: string) => boolean }) {
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
      <label htmlFor={`affirmation-${guide.id}`}>{reviewed ? '✓ Your affirmation today' : 'Put it in your own words'}</label>
      <div className="gr-affirm-row">
        <input
          id={`affirmation-${guide.id}`}
          value={draft}
          maxLength={1000}
          autoComplete="off"
          placeholder="Today, I…"
          aria-invalid={!!error}
          aria-describedby={error ? `affirmation-error-${guide.id}` : undefined}
          onChange={event => {
            setDraft(event.target.value);
            setError('');
          }}
          onKeyDown={event => {
            if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault();
          }}
        />
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

const OPEN_KEY = 'lifehub-grounding-open';
const AREAS_OPEN_KEY = 'lifehub-grounding-areas-open';

/** Collapsed-bar summary: how many reminders are affirmed today. */
export function GroundingSummary() {
  const { entries } = useAffirmations();
  // Alignment, Nutrition Flow, Creative menu — all daily
  const total = 3;
  const done = Object.values(entries).filter(v => v?.trim()).length;
  return (
    <span className={`sum-chip${done >= total ? ' is-done' : ''}`}>
      <b>{Math.min(done, total)}</b>/{total} affirmed
    </span>
  );
}

/**
 * Daily grounding, top to bottom: reminders as four cards → the one you open, with its affirmation
 * right under it → current goals by area (active / passive) → what unlocks the move.
 */
export function DailyGrounding({ move, goals, enter }: { move?: SourceSnapshot; goals: GoalsData | null; enter: (space: SpaceId) => void }) {
  const [guides, setGuides] = useState<Guide[] | null>(null);
  const { day, entries, submit } = useAffirmations();
  const modes = useGoalModes();
  const [selectedGoal, selectGoal] = useState<string | null>(null);
  // Goal areas start collapsed; the ones you open stay open
  const [openAreas, setOpenAreas] = useState<string[]>(() => readSaved<string[]>(AREAS_OPEN_KEY, []));
  const toggleArea = (id: string) => {
    const next = openAreas.includes(id) ? openAreas.filter(a => a !== id) : [...openAreas, id];
    setOpenAreas(next);
    writeSaved(AREAS_OPEN_KEY, next);
  };
  const [open, setOpenState] = useState<string | null>(() => readSaved<string | null>(OPEN_KEY, null));
  const setOpen = (id: string | null) => {
    setOpenState(id);
    writeSaved(OPEN_KEY, id);
  };
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${import.meta.env.BASE_URL}data/grounding.json?t=${Date.now()}`, { cache: 'no-store', signal: controller.signal })
      .then(r => (r.ok ? (r.json() as Promise<{ guides?: Guide[] }>) : null))
      .then(d => setGuides(Array.isArray(d?.guides) ? d.guides : []))
      .catch(() => {
        if (!controller.signal.aborted) setGuides([]);
      });
    return () => controller.abort();
  }, []);

  const weekday = ![0, 6].includes(new Date().getDay());
  const today = (guides || []).filter(g => g.when === 'Daily' || weekday);
  const affirmed = today.filter(g => entries[g.id]?.trim()).length;
  const current = today.find(g => g.id === open) || null;
  const moveGoals = (move?.featured || []).filter(f => f.completable === false);
  const currentGoals = (goals?.goals || []).filter(g => g.status === 'active');
  const counts = { active: 0, passive: 0, none: 0 };
  for (const g of currentGoals) counts[modeOf(g.id, modes).mode || 'none']++;
  const selected = currentGoals.find(g => g.id === selectedGoal) || null;
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
        <span className="gr-progress" aria-live="polite" aria-label={`${affirmed} of ${today.length} reminders affirmed today`}>
          {today.map(g => (
            <i key={g.id} className={entries[g.id]?.trim() ? 'is-done' : ''} />
          ))}
          <b>
            {affirmed}/{today.length}
          </b>{' '}
          affirmed
        </span>
      </header>

      {/* 1 · Reminders */}
      <div className="gr-part">
        <h3 className="gr-part-title">
          Reminders <span>· read one, then put it in your own words</span>
        </h3>
        {guides === null ? <p className="gr-empty">Loading reminders…</p> : null}
        {guides?.length === 0 ? <p className="gr-empty">Reminders couldn’t load. Refresh to try again.</p> : null}
        <div className="gr-cards" role="tablist" aria-label="Today's reminders">
          {today.map(g => {
            const isOpen = current?.id === g.id;
            const mine = entries[g.id]?.trim();
            return (
              <button
                key={g.id}
                type="button"
                role="tab"
                aria-selected={isOpen}
                className={`gr-card${isOpen ? ' is-open' : ''}${mine ? ' is-done' : ''}`}
                onClick={() => setOpen(isOpen ? null : g.id)}
              >
                <span className="gr-card-top">
                  <span className="gr-card-icon" aria-hidden="true">
                    {g.icon}
                  </span>
                  <span className="gr-card-state">{mine ? '✓ Affirmed' : g.when}</span>
                </span>
                <span className="gr-card-title">{g.title}</span>
                {mine ? <span className="gr-card-mine">“{mine}”</span> : g.key ? <span className="gr-card-key">{g.key}</span> : null}
                <span className="gr-card-cta">{isOpen ? 'Close' : mine ? 'Read again' : 'Read & affirm'}</span>
              </button>
            );
          })}
        </div>

        {current ? (
          <article className="gr-reader" role="tabpanel" aria-label={current.title}>
            <header className="gr-reader-head">
              <span className="gr-card-icon" aria-hidden="true">
                {current.icon}
              </span>
              <h4>{current.title}</h4>
              {current.link?.url ? (
                <a className="gr-link" href={current.link.url} target="_blank" rel="noopener noreferrer">
                  {current.link.label} ↗
                </a>
              ) : current.link?.space ? (
                <button type="button" className="gr-link" onClick={() => enter(current.link!.space!)}>
                  {current.link.label} →
                </button>
              ) : null}
            </header>
            {current.intro ? <p className="gr-note">{current.intro}</p> : null}
            <div className="gr-blocks">
              {current.sections.map(s => (
                <div key={s.heading} className="gr-block">
                  <h5>{s.heading}</h5>
                  <ul>
                    {s.lines.map(l => (
                      <li key={l}>{l}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            {current.outro ? <p className="gr-note is-quote">{current.outro}</p> : null}
            <AffirmationForm key={`${day}:${current.id}`} guide={current} reviewed={entries[current.id]} submit={submit} />
          </article>
        ) : null}
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
          <div className="gr-areas">
            {goals.categories.map(c => {
              const list = currentGoals.filter(g => g.categoryId === c.id);
              if (!list.length) return null;
              return (
                <div key={c.id} className={`gr-area area-${c.id}${openAreas.includes(c.id) ? ' is-open' : ' is-collapsed'}`}>
                  <button
                    type="button"
                    className="gr-area-name"
                    aria-expanded={openAreas.includes(c.id)}
                    onClick={() => toggleArea(c.id)}
                  >
                    <span aria-hidden="true">{c.icon}</span> {c.label}
                    <span className="gr-area-count">{list.length}</span>
                    <span className="gr-area-dots" aria-hidden="true">
                      {list.map(g => (
                        <i key={g.id} className={`is-${modeOf(g.id, modes).mode || 'none'}`} />
                      ))}
                    </span>
                    <span className="gr-area-caret" aria-hidden="true">{openAreas.includes(c.id) ? '▾' : '▸'}</span>
                  </button>
                  {openAreas.includes(c.id) ? (
                    <span className="gr-chips">
                      {list.map(g => {
                        const { mode } = modeOf(g.id, modes);
                        return (
                          <button
                            key={g.id}
                            type="button"
                            className={`gr-chip is-${mode || 'none'}${selectedGoal === g.id ? ' is-open' : ''}`}
                            aria-expanded={selectedGoal === g.id}
                            aria-label={`${g.title}: ${mode === 'active' ? 'active' : mode === 'passive' ? 'passive' : 'no routine yet'}`}
                            onClick={() => selectGoal(selectedGoal === g.id ? null : g.id)}
                          >
                            {g.title}
                          </button>
                        );
                      })}
                    </span>
                  ) : null}
                  {openAreas.includes(c.id) && selected && selected.categoryId === c.id ? <GoalDetail goal={selected} modes={modes} close={() => selectGoal(null)} openFlow={openFlow} /> : null}
                </div>
              );
            })}
          </div>
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
