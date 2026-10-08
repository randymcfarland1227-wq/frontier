'use client';

import { useEffect, useState } from 'react';
import type { GoalsData } from '../../lib/goals';

type ReviewRecap = {
  id: string;
  icon: string;
  title: string;
  month: string;
  monthNote?: string;
  link: string;
  linkLabel: string;
  gist: string;
  points: Array<{ label: string; text: string }>;
  carry: string[];
};
type SummaryFile = { updated: string; reviews: ReviewRecap[]; goalsIntro: string; categoryGists: Record<string, string> };

/**
 * Why → Summary: a short recap of last month's Music and Marvel reviews (written from Randy's own
 * review notes into data/why-summary.json) and an overview of current goals by area. Goal names
 * come live from the goals data; the one-line area summaries live in the same JSON.
 */
export function WhySummary({ goals }: { goals: GoalsData | null }) {
  const [data, setData] = useState<SummaryFile | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/why-summary.json?t=${Date.now()}`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(d => setData(d as SummaryFile))
      .catch(() => setFailed(true));
  }, []);

  if (failed) return <p className="review-empty">The summary couldn&apos;t load. Try Refresh.</p>;
  if (!data) return <p className="review-empty">Loading summary…</p>;

  const active = goals?.goals.filter(g => g.status === 'active') || [];
  return (
    <div className="why-summary">
      <section className="ws-block" aria-labelledby="ws-reviews">
        <h2 id="ws-reviews">Last month&apos;s reviews</h2>
        <div className="ws-reviews">
          {data.reviews.map(r => (
            <article key={r.id} className={`ws-review ws-${r.id}`}>
              <header>
                <span className="ws-icon" aria-hidden="true">
                  {r.icon}
                </span>
                <div>
                  <h3>{r.title}</h3>
                  <p className="ws-month">
                    {r.month}
                    {r.monthNote ? <span> · {r.monthNote}</span> : null}
                  </p>
                </div>
              </header>
              <p className="ws-gist">{r.gist}</p>
              <dl className="ws-points">
                {r.points.map(p => (
                  <div key={p.label}>
                    <dt>{p.label}</dt>
                    <dd>{p.text}</dd>
                  </div>
                ))}
              </dl>
              <div className="ws-carry">
                <p>Carrying forward</p>
                <ul>
                  {r.carry.map(c => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </div>
              <a className="ws-link" href={r.link} target="_blank" rel="noopener noreferrer">
                {r.linkLabel} ↗
              </a>
            </article>
          ))}
        </div>
      </section>

      <section className="ws-block" aria-labelledby="ws-goals">
        <h2 id="ws-goals">
          Your goals <span>· {active.length} across {goals?.categories.length || 0} areas</span>
        </h2>
        <p className="ws-intro">{data.goalsIntro}</p>
        {!goals ? (
          <p className="review-empty">Loading goals…</p>
        ) : (
          <div className="ws-areas">
            {goals.categories.map(c => {
              const list = active.filter(g => g.categoryId === c.id);
              if (!list.length) return null;
              return (
                <article key={c.id} className="ws-area">
                  <h3>
                    <span aria-hidden="true">{c.icon}</span> {c.label} <span className="ws-count">{list.length}</span>
                  </h3>
                  {data.categoryGists[c.id] ? <p className="ws-area-gist">{data.categoryGists[c.id]}</p> : null}
                  <ul className="ws-goal-list">
                    {list.map(g => (
                      <li key={g.id} title={[g.why, g.how].filter(Boolean).join(' — ')}>
                        {g.title}
                        {g.review ? <span className={`ws-mom mom-${String(g.review.momentum).toLowerCase().replace(/\s+/g, '-')}`}>{g.review.momentum}</span> : null}
                      </li>
                    ))}
                  </ul>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
