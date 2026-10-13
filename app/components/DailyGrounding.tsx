'use client';

import { useEffect, useState } from 'react';
import type { GoalsData } from '../../lib/goals';
import type { SourceSnapshot, SpaceId } from '../../lib/types';
import { readSaved, writeSaved } from '../../lib/storage';

type Guide = {
  id: string;
  title: string;
  icon: string;
  when: 'Daily' | 'Weekdays';
  from: string;
  intro?: string;
  outro?: string;
  sections: Array<{ heading: string; lines: string[] }>;
  link?: { label: string; url?: string; space?: SpaceId };
};

const READ_KEY = 'lifehub-grounding-read';
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
 * Daily grounding: the guides that used to be TickTick "tasks" (they're reminders, not to-dos),
 * blended with the directions you're moving toward — Move OS's goals and your current goals.
 * Nothing here counts as a completion.
 */
export function DailyGrounding({ move, goals, enter }: { move?: SourceSnapshot; goals: GoalsData | null; enter: (space: SpaceId) => void }) {
  const [guides, setGuides] = useState<Guide[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [read, toggleRead] = useReadToday();
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/grounding.json?t=${Date.now()}`, { cache: 'no-store' })
      .then(r => (r.ok ? (r.json() as Promise<{ guides?: Guide[] }>) : null))
      .then(d => setGuides(Array.isArray(d?.guides) ? d.guides : []))
      .catch(() => setGuides([]));
  }, []);

  const weekday = ![0, 6].includes(new Date().getDay());
  const today = (guides || []).filter(g => g.when === 'Daily' || weekday);
  const moveGoals = (move?.featured || []).filter(f => f.completable === false);
  const goalAreas = (goals?.categories || [])
    .map(c => ({ c, list: goals!.goals.filter(g => g.status === 'active' && g.categoryId === c.id) }))
    .filter(x => x.list.length);

  return (
    <div className="grounding">
      <section className="gr-guides" aria-labelledby="gr-today">
        <h3 id="gr-today">
          Today’s grounding <span>· {read.size ? `${[...read].filter(id => today.some(g => g.id === id)).length} of ${today.length} read` : 'read, don’t check off'}</span>
        </h3>
        {guides === null ? <p className="gr-empty">Loading…</p> : null}
        <ul className="gr-list">
          {today.map(g => {
            const isOpen = open === g.id;
            const isRead = read.has(g.id);
            return (
              <li key={g.id} className={`gr-guide${isOpen ? ' is-open' : ''}${isRead ? ' is-read' : ''}`}>
                <button type="button" className="gr-guide-head" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : g.id)}>
                  <span className="gr-icon" aria-hidden="true">
                    {g.icon}
                  </span>
                  <span className="gr-title">{g.title}</span>
                  <span className="gr-when">{g.when}</span>
                  <span className="gr-chev" aria-hidden="true" />
                </button>
                {isOpen ? (
                  <div className="gr-body">
                    {g.intro ? <p className="gr-intro">{g.intro}</p> : null}
                    {g.sections.map(s => (
                      <div key={s.heading} className="gr-sec">
                        <h4>{s.heading}</h4>
                        <ul>
                          {s.lines.map(l => (
                            <li key={l}>{l}</li>
                          ))}
                        </ul>
                      </div>
                    ))}
                    {g.outro ? <p className="gr-outro">{g.outro}</p> : null}
                    <div className="gr-tools">
                      <button type="button" className={`row-action${isRead ? ' ghost' : ''}`} aria-pressed={isRead} onClick={() => toggleRead(g.id)}>
                        {isRead ? '✓ Read today' : 'Mark read today'}
                      </button>
                      {g.link?.url ? (
                        <a className="row-action ghost" href={g.link.url} target="_blank" rel="noopener noreferrer">
                          {g.link.label} ↗
                        </a>
                      ) : g.link?.space ? (
                        <button type="button" className="row-action ghost" onClick={() => enter(g.link!.space!)}>
                          {g.link.label} →
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="gr-dirs" aria-labelledby="gr-dirs">
        <h3 id="gr-dirs">
          Directions <span>· not one-time tasks — what you’re moving toward</span>
        </h3>
        <div className="gr-dir-block tone-move">
          <p className="gr-dir-label">
            Move <button type="button" className="gr-dir-link" onClick={() => enter('move')}>Open →</button>
          </p>
          {moveGoals.length ? (
            <ul className="gr-dir-list">
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
        <div className="gr-dir-block tone-flow">
          <p className="gr-dir-label">
            Flow · current goals <button
              type="button"
              className="gr-dir-link"
              onClick={() => {
                writeSaved('lifehub-why-tab', 'flow');
                enter('why');
              }}
            >
              Open Flow →
            </button>
          </p>
          {goalAreas.length ? (
            <div className="gr-areas">
              {goalAreas.map(({ c, list }) => (
                <div key={c.id} className="gr-area">
                  <span className="gr-area-name">
                    <span aria-hidden="true">{c.icon}</span> {c.label}
                  </span>
                  <span className="gr-chips">
                    {list.map(g => (
                      <span key={g.id} className={`gr-chip${g.review ? ' has-review' : ''}`} title={[g.why, g.review ? `Last review: ${g.review.momentum}` : ''].filter(Boolean).join(' — ')}>
                        {g.title}
                      </span>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="gr-empty">Loading goals…</p>
          )}
        </div>
      </section>
    </div>
  );
}
