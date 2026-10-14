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

function AffirmationForm({ guide, reviewed, submit }: { guide: Guide; reviewed?: string; submit: (id: string, text: string) => boolean }) {
  const [draft, setDraft] = useState(reviewed || '');
  const [error, setError] = useState('');
  return <form className="gr-affirmation" aria-label={`${guide.title} affirmation`} onSubmit={event => {
    event.preventDefault();
    if (!draft.trim()) { setError('Write an affirmation in your own words first.'); return; }
    if (submit(guide.id, draft)) { setDraft(draft.trim()); setError(''); }
    else setError('Your affirmation couldn’t be saved. Please try again.');
  }}>
    <label htmlFor={`affirmation-${guide.id}`}>My affirmation for today</label>
    <p id={`affirmation-help-${guide.id}`} className="gr-affirmation-help">Put this reminder into your own words, then press Enter.</p>
    <div className="gr-affirmation-entry">
      <input id={`affirmation-${guide.id}`} value={draft} maxLength={1000} autoComplete="off"
        placeholder="Today, I…" aria-describedby={`affirmation-help-${guide.id}${error ? ` affirmation-error-${guide.id}` : ''}`}
        aria-invalid={!!error} onChange={event => { setDraft(event.target.value); setError(''); }}
        onKeyDown={event => { if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault(); }} />
      <button type="submit" className="gr-btn is-primary" disabled={!draft.trim() || draft.trim() === reviewed}>{reviewed ? 'Save changes' : 'Affirm'}</button>
    </div>
    <p className="gr-affirmation-status" role="status">{reviewed ? '✓ Reviewed today' : 'Not reviewed yet'}</p>
    {error ? <p id={`affirmation-error-${guide.id}`} className="gr-affirmation-error" role="alert">{error}</p> : null}
  </form>;
}

/** Reminders → active focuses / passive mindsets → compact relocation context. */
export function DailyGrounding({ move, goals, enter }: { move?: SourceSnapshot; goals: GoalsData | null; enter: (space: SpaceId) => void }) {
  const [guides, setGuides] = useState<Guide[] | null>(null);
  const { day, entries, submit } = useAffirmations();
  const modes = useGoalModes();
  const [selectedGoal, selectGoal] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${import.meta.env.BASE_URL}data/grounding.json?t=${Date.now()}`, { cache: 'no-store', signal: controller.signal })
      .then(r => (r.ok ? (r.json() as Promise<{ guides?: Guide[] }>) : null))
      .then(d => setGuides(Array.isArray(d?.guides) ? d.guides : []))
      .catch(() => { if (!controller.signal.aborted) setGuides([]); });
    return () => controller.abort();
  }, []);

  const weekday = ![0, 6].includes(new Date().getDay());
  const today = (guides || []).filter(g => g.when === 'Daily' || weekday);
  const readCount = today.filter(g => entries[g.id]?.trim()).length;
  const moveGoals = (move?.featured || []).filter(f => f.completable === false);
  const currentGoals = (goals?.goals || []).filter(g => g.status === 'active');
  const active = currentGoals.filter(g => modeOf(g.id, modes).mode === 'active');
  const passive = currentGoals.filter(g => modeOf(g.id, modes).mode === 'passive');
  const unlinked = currentGoals.filter(g => modeOf(g.id, modes).mode === null);
  const openFlow = () => {
    writeSaved('lifehub-why-tab', 'flow');
    enter('why');
  };

  return (
    <section className="grounding glass-panel" aria-label="Daily grounding">
      <header className="gr-head">
        <div>
          <p className="section-label">Grounding</p>
          <h2>Daily grounding</h2>
          <p className="gr-sub">{new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</p>
        </div>
        <button type="button" className="gr-btn" onClick={openFlow}>Open Flow →</button>
      </header>

      <section className="gr-reminders" aria-labelledby="gr-reminders-title">
        <header className="gr-section-head">
          <h3 id="gr-reminders-title">Reminders</h3>
          <p>Read and reconnect</p>
          <span className="gr-read-count" aria-live="polite">{readCount}/{today.length} reviewed today</span>
        </header>
        <div className="gr-guides" aria-label="Today's reminders">
          {guides === null ? <p className="gr-empty">Loading reminders…</p> : null}
          {guides?.length === 0 ? <p className="gr-empty">Reminders couldn’t load. Refresh to try again.</p> : null}
          {today.map(g => <article key={g.id} className="gr-guide" aria-label={g.title}>
            <header className="gr-guide-head">
              <h4><span aria-hidden="true">{g.icon}</span> {g.title}</h4>
              {g.key ? <p className="gr-guide-key">{g.key}</p> : null}
              {g.intro ? <p>{g.intro}</p> : null}
            </header>
            <div className="gr-guide-body">
              {g.sections.map(s => <div key={s.heading} className="gr-block">
                <h5>{s.heading}</h5>
                <ul>{s.lines.map(l => <li key={l}>{l}</li>)}</ul>
              </div>)}
              {g.outro ? <p className="gr-outro">{g.outro}</p> : null}
              {g.link?.url ? <a className="gr-link" href={g.link.url} target="_blank" rel="noopener noreferrer">{g.link.label} ↗</a>
                : g.link?.space ? <button type="button" className="gr-link" onClick={() => enter(g.link!.space!)}>{g.link.label} →</button> : null}
            </div>
            <AffirmationForm key={`${day}:${g.id}`} guide={g} reviewed={entries[g.id]} submit={submit} />
          </article>)}
        </div>
      </section>

      <section className="gr-focuses" aria-labelledby="gr-focuses-title">
        <header className="gr-section-head">
          <h3 id="gr-focuses-title">Current goals</h3>
          <p>Select a focus to see its why and practices.</p>
        </header>
        {goals === null ? <p className="gr-empty">Loading goals…</p> : (
          <>
            <div className="gr-key" aria-label="Goal modes">
              <span className="is-active">● Active {active.length}</span>
              <span className="is-passive">○ Passive / upkeep {passive.length}</span>
              {unlinked.length ? <span>· Unassigned {unlinked.length}</span> : null}
            </div>
            <div className="gr-overview">
              {[...goals.categories, ...Array.from(new Set(currentGoals.filter(g => !goals.categories.some(c => c.id === g.categoryId)).map(g => g.categoryId))).map(id => ({id, label: id, icon: ''}))].map(category => {
                const list = currentGoals.filter(g => g.categoryId === category.id);
                if (!list.length) return null;
                return <div className="gr-area-row" key={category.id}>
                  <h4><span aria-hidden="true">{category.icon}</span> {category.label}</h4>
                  <div className="gr-goal-buttons">{list.map(g => {
                    const { mode } = modeOf(g.id, modes);
                    return <button type="button" key={g.id} className={`gr-focus-button is-${mode || 'none'}`} aria-pressed={selectedGoal === g.id}
                      aria-label={`${g.title}: ${mode === 'active' ? 'active' : mode === 'passive' ? 'passive / upkeep' : 'unassigned'}`}
                      onClick={() => selectGoal(selectedGoal === g.id ? null : g.id)}>
                      <span aria-hidden="true">{mode === 'active' ? '●' : mode === 'passive' ? '○' : '·'}</span>{g.title}
                    </button>;
                  })}</div>
                </div>;
              })}
            </div>
            {currentGoals.find(g => g.id === selectedGoal) ? <GoalDetail goal={currentGoals.find(g => g.id === selectedGoal)!} modes={modes} close={() => selectGoal(null)} openFlow={openFlow} /> : null}
          </>
        )}
      </section>

      <section className="gr-move" aria-labelledby="gr-move-title">
        <header className="gr-section-head"><h3 id="gr-move-title">Move</h3><p>What unlocks the move</p><button type="button" className="gr-link" onClick={() => enter('move')}>Open Move OS →</button></header>
        {moveGoals.length ? <ul className="gr-move-list">{moveGoals.map(g => (
          <li key={g.id}>{g.detail ? <details><summary>{g.title}</summary><p>{g.detail}</p></details> : <span>{g.title}</span>}</li>
        ))}</ul> : <p className="gr-empty">Open Move OS once and its goals show here.</p>}
      </section>
    </section>
  );
}

const TIER_LABEL: Record<string, string> = { drive: 'Drives it', enable: 'Makes it easier', upkeep: 'Keeps it up' };

/** One shared panel keeps the overview short and every goal one click away. */
function GoalDetail({ goal, modes, close, openFlow }: { goal: Goal; modes: GoalModes; close: () => void; openFlow: () => void }) {
  const { mode, mine } = modeOf(goal.id, modes);
  const routines = routinesFor(goal.id);
  return <article className="gr-selection" aria-label={goal.title}>
    <header className="gr-section-head"><h4>{goal.title}</h4><button type="button" className="gr-link" onClick={close}>Close details</button></header>
    <div className="gr-selection-body">
      <div className="gr-selection-context">
        {goal.why ? <p className="gr-goal-why">{goal.why}</p> : null}
        {goal.how ? <p className="gr-goal-how"><b>How:</b> {goal.how}</p> : null}
        <div className="gr-mode-controls">
          <span className="gr-mode" role="group" aria-label={`${goal.title}: active or passive`}>
            {(['active', 'passive'] as const).map(m => <button key={m} type="button" className={mode === m ? 'is-on' : ''} aria-pressed={mode === m} onClick={() => setGoalMode(goal.id, m)}>{m === 'active' ? 'Active' : 'Passive / upkeep'}</button>)}
          </span>
          {mine ? <button type="button" className="gr-link" onClick={() => setGoalMode(goal.id, null)}>Use Flow’s suggestion</button> : null}
        </div>
      </div>
      <div><p className="gr-practice-label">Practices from Flow</p>
        {routines.length ? <ul className="gr-routine-list">{routines.map(r => <li key={r.id}><span>{r.title}</span><small>{TIER_LABEL[r.tier] || r.tier}{r.when ? ` · ${r.when}` : ''}</small></li>)}</ul> : <p className="gr-empty">No linked routine yet.</p>}
        <button type="button" className="gr-link" onClick={openFlow}>Open Flow →</button>
      </div>
    </div>
  </article>;
}
