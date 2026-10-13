'use client';

import { useEffect, useState } from 'react';
import type { GoalsData } from '../../lib/goals';
import type { SourceSnapshot, SpaceId } from '../../lib/types';
import { readSaved, writeSaved } from '../../lib/storage';
import type { Goal } from '../../lib/goals';
import { modeOf, routinesFor, setGoalMode, useGoalModes, type GoalModes } from '../../lib/goalModes';

type Guide = {
  id: string;
  title: string;
  icon: string;
  when: 'Daily' | 'Weekdays';
  from: string;
  /** One line of Randy's own words shown on the card */
  key?: string;
  intro?: string;
  outro?: string;
  sections: Array<{ heading: string; lines: string[] }>;
  link?: { label: string; url?: string; space?: SpaceId };
};

const READ_KEY = 'lifehub-grounding-read';
const OPEN_KEY = 'lifehub-grounding-open';
const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Which guides were read today, on this device. Reading is a check-in — never a completed task. */
function useReadToday(): [Set<string>, (id: string) => void] {
  const today = dayKey();
  const [read, setRead] = useState<string[]>(() => {
    const saved = readSaved<{ day: string; ids: string[] }>(READ_KEY, { day: '', ids: [] });
    return saved.day === today ? saved.ids : [];
  });
  const toggle = (id: string) =>
    setRead(cur => {
      const next = cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id];
      writeSaved(READ_KEY, { day: today, ids: next });
      return next;
    });
  return [new Set(read), toggle];
}

/**
 * Daily grounding, top to bottom: today's guides as four equal cards → the one you open, in a
 * single reading panel → the directions you're moving toward (Move OS goals, current goals by
 * area) in two matching columns. Nothing here counts as a completion.
 */
export function DailyGrounding({ move, goals, enter }: { move?: SourceSnapshot; goals: GoalsData | null; enter: (space: SpaceId) => void }) {
  const [guides, setGuides] = useState<Guide[] | null>(null);
  const [open, setOpenState] = useState<string | null>(() => readSaved<string | null>(OPEN_KEY, null));
  const [read, toggleRead] = useReadToday();
  const setOpen = (id: string | null) => {
    setOpenState(id);
    writeSaved(OPEN_KEY, id);
  };
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/grounding.json?t=${Date.now()}`, { cache: 'no-store' })
      .then(r => (r.ok ? (r.json() as Promise<{ guides?: Guide[] }>) : null))
      .then(d => setGuides(Array.isArray(d?.guides) ? d.guides : []))
      .catch(() => setGuides([]));
  }, []);

  const weekday = ![0, 6].includes(new Date().getDay());
  const today = (guides || []).filter(g => g.when === 'Daily' || weekday);
  const readCount = today.filter(g => read.has(g.id)).length;
  const current = today.find(g => g.id === open) || null;
  const moveGoals = (move?.featured || []).filter(f => f.completable === false);
  const goalAreas = (goals?.categories || [])
    .map(c => ({ c, list: goals!.goals.filter(g => g.status === 'active' && g.categoryId === c.id) }))
    .filter(x => x.list.length);
  const goalCount = goalAreas.reduce((n, a) => n + a.list.length, 0);
  const goalModes = useGoalModes();
  const [goalOpen, setGoalOpen] = useState<string | null>(null);
  const modeCounts = { active: 0, passive: 0, none: 0 };
  for (const { list } of goalAreas) for (const g of list) modeCounts[modeOf(g.id, goalModes).mode || 'none']++;

  return (
    <section className="grounding glass-panel" aria-label="Daily grounding">
      <header className="gr-head">
        <p className="section-label">Grounding</p>
        <h2>Today</h2>
        <p className="gr-sub">{new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })} · read, don’t check off</p>
        <span className="gr-progress" aria-label={`${readCount} of ${today.length} guides read today`}>
          {today.map(g => (
            <i key={g.id} className={read.has(g.id) ? 'is-read' : ''} />
          ))}
          <b>
            {readCount}/{today.length}
          </b>{' '}
          read
        </span>
      </header>

      {/* 1 · Today's guides: four equal cards */}
      <div className="gr-cards" role="tablist" aria-label="Today's guides">
        {guides === null ? <p className="gr-empty">Loading…</p> : null}
        {today.map(g => {
          const isOpen = current?.id === g.id;
          const isRead = read.has(g.id);
          return (
            <button
              key={g.id}
              type="button"
              role="tab"
              aria-selected={isOpen}
              className={`gr-card${isOpen ? ' is-open' : ''}${isRead ? ' is-read' : ''}`}
              onClick={() => setOpen(isOpen ? null : g.id)}
            >
              <span className="gr-card-top">
                <span className="gr-card-icon" aria-hidden="true">
                  {g.icon}
                </span>
                <span className="gr-card-when">{isRead ? '✓ Read' : g.when}</span>
              </span>
              <span className="gr-card-title">{g.title}</span>
              {g.key ? <span className="gr-card-key">“{g.key}”</span> : null}
              <span className="gr-card-cta">{isOpen ? 'Close' : 'Read'}</span>
            </button>
          );
        })}
      </div>

      {/* 2 · The open guide, always in the same place */}
      {current ? (
        <article className="gr-reader" role="tabpanel" aria-label={current.title}>
          <header className="gr-reader-head">
            <span className="gr-card-icon" aria-hidden="true">
              {current.icon}
            </span>
            <h3>{current.title}</h3>
            {current.intro ? <p>{current.intro}</p> : null}
          </header>
          <div className="gr-reader-grid">
            {current.sections.map(s => (
              <div key={s.heading} className="gr-block">
                <h4>{s.heading}</h4>
                <ul>
                  {s.lines.map(l => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          {current.outro ? <p className="gr-outro">{current.outro}</p> : null}
          <footer className="gr-reader-foot">
            <button type="button" className={`gr-btn${read.has(current.id) ? ' is-on' : ' is-primary'}`} aria-pressed={read.has(current.id)} onClick={() => toggleRead(current.id)}>
              {read.has(current.id) ? '✓ Read today' : 'Mark read today'}
            </button>
            {current.link?.url ? (
              <a className="gr-btn" href={current.link.url} target="_blank" rel="noopener noreferrer">
                {current.link.label} ↗
              </a>
            ) : current.link?.space ? (
              <button type="button" className="gr-btn" onClick={() => enter(current.link!.space!)}>
                {current.link.label} →
              </button>
            ) : null}
          </footer>
        </article>
      ) : null}

      {/* 3 · Directions: two matching columns */}
      <div className="gr-dirs">
        <div className="gr-col tone-move">
          <header className="gr-col-head">
            <h3>Move</h3>
            <span className="gr-count">{moveGoals.length}</span>
            <span className="gr-col-sub">goals that unlock the move</span>
            <button type="button" className="gr-link" onClick={() => enter('move')}>
              Open Move OS →
            </button>
          </header>
          {moveGoals.length ? (
            <ul className="gr-rows">
              {moveGoals.map(g => (
                <li key={g.id} className="gr-row">
                  <span className="gr-row-title">{g.title}</span>
                  {g.detail ? <span className="gr-row-text">{g.detail}</span> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="gr-empty">Open Move OS once and its goals show here.</p>
          )}
        </div>
        <div className="gr-col tone-flow">
          <header className="gr-col-head">
            <h3>Current goals</h3>
            <span className="gr-count">{goalCount}</span>
            <span className="gr-legend" aria-label="Key">
              <span className="gr-key is-active">Active {modeCounts.active}</span>
              <span className="gr-key is-passive">Passive {modeCounts.passive}</span>
              {modeCounts.none ? <span className="gr-key is-none">No routine yet {modeCounts.none}</span> : null}
            </span>
            <button
              type="button"
              className="gr-link"
              onClick={() => {
                writeSaved('lifehub-why-tab', 'flow');
                enter('why');
              }}
            >
              Open Flow →
            </button>
          </header>
          {goalAreas.length ? (
            <div className="gr-areas">
              {goalAreas.map(({ c, list }) => {
                const picked = list.find(g => g.id === goalOpen);
                return (
                  <div key={c.id} className={`gr-area area-${c.id}`}>
                    <span className="gr-area-name">
                      <span aria-hidden="true">{c.icon}</span> {c.label}
                    </span>
                    <span className="gr-chips">
                      {list.map(g => {
                        const { mode } = modeOf(g.id, goalModes);
                        return (
                          <button
                            key={g.id}
                            type="button"
                            className={`gr-chip is-${mode || 'none'}${goalOpen === g.id ? ' is-open' : ''}`}
                            aria-expanded={goalOpen === g.id}
                            onClick={() => setGoalOpen(goalOpen === g.id ? null : g.id)}
                            title={`${g.title} — ${mode === 'active' ? 'Active' : mode === 'passive' ? 'Passive' : 'No routine yet'}`}
                          >
                            {g.title}
                          </button>
                        );
                      })}
                    </span>
                    {picked ? <GoalDetail goal={picked} modes={goalModes} /> : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="gr-empty">Loading goals…</p>
          )}
        </div>
      </div>
    </section>
  );
}

const TIER_LABEL: Record<string, string> = { drive: 'Drives it', enable: 'Makes it easier', upkeep: 'Keeps it up' };

/** One goal opened: your why, how it's set (active / passive), and the routines that actually drive it. */
function GoalDetail({ goal, modes }: { goal: Goal; modes: GoalModes }) {
  const { mode, mine } = modeOf(goal.id, modes);
  const routines = routinesFor(goal.id);
  const tiers = ['drive', 'enable', 'upkeep'].map(t => ({ t, list: routines.filter(r => r.tier === t) })).filter(x => x.list.length);
  return (
    <div className="gr-goal">
      <div className="gr-goal-head">
        <strong>{goal.title}</strong>
        <span className="gr-mode" role="group" aria-label={`${goal.title}: active or passive`}>
          {(['active', 'passive'] as const).map(m => (
            <button key={m} type="button" className={mode === m ? 'is-on' : ''} aria-pressed={mode === m} onClick={() => setGoalMode(goal.id, mode === m && mine ? null : m)}>
              {m === 'active' ? 'Active' : 'Passive'}
            </button>
          ))}
        </span>
        <small className="gr-mode-src">{mine ? 'your call' : mode ? 'from Flow' : 'no routine yet — pick one'}</small>
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
        <p className="gr-goal-how">Nothing in Flow drives this yet — link a routine to it in Flow, or mark it yourself.</p>
      )}
    </div>
  );
}
