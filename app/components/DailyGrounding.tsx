'use client';

import { useEffect, useState } from 'react';
import type { Goal, GoalsData } from '../../lib/goals';
import type { SourceSnapshot, SpaceId } from '../../lib/types';
import { readSaved, writeSaved } from '../../lib/storage';
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

const READ_KEY = 'lifehub-grounding-read';
const OPEN_KEY = 'lifehub-grounding-open';
const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** A reading check-in stays separate from the task completion ledger. */
function useReadToday(): [Set<string>, (id: string) => void] {
  const today = dayKey();
  const [saved, setSaved] = useState(() => readSaved<{ day: string; ids: string[] }>(READ_KEY, { day: '', ids: [] }));
  const read = new Set(saved.day === today ? saved.ids : []);
  const toggle = (id: string) => setSaved(cur => {
    const ids = cur.day === today ? cur.ids : [];
    const next = { day: today, ids: ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id] };
    writeSaved(READ_KEY, next);
    return next;
  });
  return [read, toggle];
}

/** Reminders → active focuses / passive mindsets → compact relocation context. */
export function DailyGrounding({ move, goals, enter }: { move?: SourceSnapshot; goals: GoalsData | null; enter: (space: SpaceId) => void }) {
  const [guides, setGuides] = useState<Guide[] | null>(null);
  const [open, setOpenState] = useState<string | null>(() => readSaved<string | null>(OPEN_KEY, null));
  const [read, toggleRead] = useReadToday();
  const modes = useGoalModes();
  const [selectedGoal, selectGoal] = useState<string | null>(null);
  const setOpen = (id: string | null) => {
    setOpenState(id);
    writeSaved(OPEN_KEY, id);
  };
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
  const current = today.find(g => g.id === open);
  const readCount = today.filter(g => read.has(g.id)).length;
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
          <span className="gr-read-count" aria-live="polite">{readCount}/{today.length} read today</span>
        </header>
        <div className="gr-cards" aria-label="Today's reminders">
          {guides === null ? <p className="gr-empty">Loading reminders…</p> : null}
          {guides?.length === 0 ? <p className="gr-empty">Reminders couldn’t load. Refresh to try again.</p> : null}
          {today.map(g => (
            <button key={g.id} type="button" className={`gr-card${current?.id === g.id ? ' is-open' : ''}${read.has(g.id) ? ' is-read' : ''}`}
              aria-expanded={current?.id === g.id} aria-controls={current?.id === g.id ? 'gr-reader' : undefined} onClick={() => setOpen(current?.id === g.id ? null : g.id)}>
              <span className="gr-card-icon" aria-hidden="true">{g.icon}</span>
              <span className="gr-card-copy">
                <span className="gr-card-title">{g.title}</span>
                {g.key ? <span className="gr-card-key">{g.key}</span> : null}
              </span>
              <span className="gr-card-when">{read.has(g.id) ? '✓ Read' : current?.id === g.id ? 'Close' : 'Read'}</span>
            </button>
          ))}
        </div>
        {current ? (
          <article id="gr-reader" className="gr-reader" aria-label={current.title}>
            <header className="gr-reader-head">
              <h4>{current.title}</h4>
              <button type="button" className="gr-link" onClick={() => setOpen(null)}>Close reminder</button>
              {current.intro ? <p>{current.intro}</p> : null}
            </header>
            <div className="gr-reader-grid">
              {current.sections.map(s => (
                <div key={s.heading} className="gr-block">
                  <h5>{s.heading}</h5>
                  <ul>{s.lines.map(l => <li key={l}>{l}</li>)}</ul>
                </div>
              ))}
            </div>
            {current.outro ? <p className="gr-outro">{current.outro}</p> : null}
            <footer className="gr-reader-foot">
              <button type="button" className={`gr-btn${read.has(current.id) ? ' is-on' : ' is-primary'}`} aria-pressed={read.has(current.id)} onClick={() => toggleRead(current.id)}>
                {read.has(current.id) ? '✓ Read today' : 'Mark read today'}
              </button>
              {current.link?.url ? <a className="gr-btn" href={current.link.url} target="_blank" rel="noopener noreferrer">{current.link.label} ↗</a>
                : current.link?.space ? <button type="button" className="gr-btn" onClick={() => enter(current.link!.space!)}>{current.link.label} →</button> : null}
            </footer>
          </article>
        ) : null}
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
