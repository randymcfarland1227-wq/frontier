'use client';

import { useMemo, useState } from 'react';
import type { SourceId, SourceSnapshot } from '../../lib/types';
import type { CompletionLedger } from '../../lib/completions';
import type { Capture } from '../../lib/captures';
import type { FocusArea } from '../../lib/focusAreas';
import type { SelfItem } from '../../lib/adapters/self';
import { sourceById } from '../../lib/sources';
import {
  goalMomentum,
  ledgerTaskKeys,
  targetKey,
  type Goal,
  type GoalLink,
  type GoalLinkTarget,
  type GoalsData,
} from '../../lib/goals';

const MOMENTUM_MARK: Record<string, string> = { 'On Track': '●', Slipping: '◐', Stalled: '○' };
const WEEK = 7;
/** Cards shown before "Show all" so the home page doesn't bury Self and sources. */
const PREVIEW_COUNT = 6;

type Candidate = { key: string; target: GoalLinkTarget; title: string; where: string };
type Resolved = { title: string; where: string; state: string };

function slug(v: string) {
  return v.toLowerCase().replace(/\s+/g, '-');
}

export function WhyPanel({
  data,
  links,
  ledger,
  captures,
  snapshots,
  selfItems,
  areas,
  onLink,
  onUnlink,
}: {
  data: GoalsData;
  links: GoalLink[];
  ledger: CompletionLedger;
  captures: Capture[];
  snapshots: Record<SourceId, SourceSnapshot>;
  selfItems: SelfItem[];
  areas: FocusArea[];
  onLink: (goalId: string, target: GoalLinkTarget, label: string) => void;
  onUnlink: (linkId: string) => void;
}) {
  const [category, setCategory] = useState<string>('all');
  const [open, setOpen] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(false);

  const doneKeys = useMemo(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - (WEEK - 1) * 86400000;
    return new Set(
      Object.values(ledger.entries)
        .filter(e => Date.parse(e.completedAt) >= start)
        .map(e => `${e.source}::${e.taskId}`),
    );
  }, [ledger]);

  const candidates = useMemo<Candidate[]>(() => {
    const out: Candidate[] = [];
    for (const [source, snap] of Object.entries(snapshots) as Array<[SourceId, SourceSnapshot]>) {
      if (source === 'self') continue;
      for (const t of snap.tasks || []) {
        if (t.status === 'done') continue;
        const target: GoalLinkTarget =
          source === 'ticktick'
            ? { type: 'ticktick', taskId: t.id, projectId: t.projectId }
            : { type: 'task', source, taskId: t.id };
        const where = source === 'ticktick' && t.kind === 'habit' ? 'TickTick habit' : sourceById[source].shortName;
        out.push({ key: targetKey(target), target, title: t.title, where });
      }
    }
    for (const i of selfItems.filter(i => !i.done)) {
      const target: GoalLinkTarget = { type: 'task', source: 'self', taskId: i.id };
      out.push({ key: targetKey(target), target, title: i.title, where: 'Self' });
    }
    for (const c of captures.filter(c => c.status !== 'dropped')) {
      const target: GoalLinkTarget = { type: 'capture', captureId: c.id };
      out.push({ key: targetKey(target), target, title: c.title, where: 'Idea' });
    }
    return out;
  }, [snapshots, selfItems, captures]);

  const resolve = (link: GoalLink): Resolved => {
    const t = link.target;
    const done = ledgerTaskKeys(link, captures).some(k => doneKeys.has(k));
    if (t.type === 'capture') {
      const c = captures.find(x => x.id === t.captureId);
      const state = !c ? 'removed' : c.status === 'promoted' ? (done ? 'done this week' : 'promoted') : c.status;
      return { title: c?.title || link.label || 'Idea', where: 'Idea', state };
    }
    const source: SourceId = t.type === 'ticktick' ? 'ticktick' : t.source;
    const id = t.type === 'featured' ? t.featuredId : t.taskId;
    if (source === 'self') {
      const i = selfItems.find(x => x.id === id);
      return { title: i?.title || link.label || 'Self task', where: 'Self', state: done || i?.done ? 'done this week' : i ? 'open' : 'removed' };
    }
    const task = snapshots[source]?.tasks?.find(x => x.id === id);
    const where = source === 'ticktick' && (task?.kind === 'habit' || id.startsWith('habit-')) ? 'TickTick habit' : sourceById[source].shortName;
    const state = done ? 'done this week' : task ? (task.status === 'done' ? 'done' : 'open') : 'not due today';
    return { title: task?.title || link.label || id, where, state };
  };

  const areaName = (id?: string) => areas.find(a => a.id === id)?.name;
  const shown = data.goals.filter(g => g.status === 'active' && (category === 'all' || g.categoryId === category));
  const visible = expanded ? shown : shown.slice(0, PREVIEW_COUNT);
  const byGoal = (g: Goal) => links.filter(l => l.goalId === g.id);
  const unlinkedCount = data.goals.filter(g => byGoal(g).length === 0).length;

  return (
    <section className="why-panel glass-panel" aria-label="Why — goals and attached work">
      <div className="why-head">
        <div>
          <p className="section-label">Why</p>
          <h2>What the work is for</h2>
          <p className="review-lede">
            {data.goals.length} present-focus goals from{' '}
            <a href={data.source} target="_blank" rel="noopener noreferrer">
              Goals hub
            </a>
            <span className="review-sep">·</span>
            {data.live ? 'live' : 'saved copy (Goals hub unreachable)'}
            {unlinkedCount ? (
              <>
                <span className="review-sep">·</span>
                {unlinkedCount} with no work attached
              </>
            ) : null}
          </p>
        </div>
      </div>

      <div className="seg why-cats" role="group" aria-label="Goal category">
        {[{ id: 'all', label: 'All', icon: '' }, ...data.categories].map(c => (
          <button
            key={c.id}
            type="button"
            className={c.id === category ? 'active' : ''}
            aria-pressed={c.id === category}
            onClick={() => setCategory(c.id)}
          >
            {c.icon ? `${c.icon} ` : ''}
            {c.label}
          </button>
        ))}
      </div>

      <div className="why-grid">
        {visible.map(goal => {
          const goalLinks = byGoal(goal);
          const momentum = goalMomentum(goal.id, links, ledger, captures, WEEK);
          const isOpen = open === goal.id;
          const linkedKeys = new Set(goalLinks.map(l => targetKey(l.target)));
          const q = query.trim().toLowerCase();
          const matches = isOpen && q
            ? candidates.filter(c => !linkedKeys.has(c.key) && c.title.toLowerCase().includes(q)).slice(0, 8)
            : [];
          const cat = data.categories.find(c => c.id === goal.categoryId);
          return (
            <article className={`why-card ${goalLinks.length ? '' : 'is-unlinked'}`} key={goal.id}>
              <div className="why-card-meta">
                <span>{cat?.icon} {cat?.label}</span>
                {areaName(goal.focusAreaId) ? <span className="capture-area">{areaName(goal.focusAreaId)}</span> : null}
                <span
                  className={`why-review m-${goal.review ? slug(goal.review.momentum) : 'none'}`}
                  title={goal.review ? `Goals hub review ${goal.review.date}${goal.review.notes ? ` — ${goal.review.notes}` : ''}` : undefined}
                >
                  {goal.review ? `${MOMENTUM_MARK[goal.review.momentum] || '•'} ${goal.review.momentum}` : 'Not reviewed'}
                </span>
              </div>
              <h3>{goal.title}</h3>
              <p className="why-quote">{goal.why}</p>
              <div className="why-card-foot">
                <span>
                  {goalLinks.length ? (
                    <>
                      <strong>{momentum}</strong> done this week · {goalLinks.length} linked
                    </>
                  ) : (
                    'No work attached yet'
                  )}
                </span>
                <button
                  type="button"
                  className="row-action ghost"
                  aria-expanded={isOpen}
                  onClick={() => {
                    setOpen(isOpen ? null : goal.id);
                    setQuery('');
                  }}
                >
                  {isOpen ? 'Close' : goalLinks.length ? 'Work' : 'Link work'}
                </button>
              </div>

              {isOpen ? (
                <div className="why-work">
                  {goal.how ? <p className="why-how"><span>How:</span> {goal.how}</p> : null}
                  {goalLinks.map(link => {
                    const r = resolve(link);
                    return (
                      <div className={`why-link state-${slug(r.state)}`} key={link.id}>
                        <div>
                          <strong>{r.title}</strong>
                          <span>
                            {r.where} · {r.state}
                            {link.role === 'drives' ? ' · drives' : ''}
                          </span>
                        </div>
                        <button type="button" className="why-unlink" aria-label={`Unlink ${r.title}`} onClick={() => onUnlink(link.id)}>
                          ×
                        </button>
                      </div>
                    );
                  })}
                  <input
                    className="why-search"
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder="Link a task, habit, Self item, or idea…"
                    aria-label={`Search work to link to ${goal.title}`}
                  />
                  {matches.map(m => (
                    <button
                      type="button"
                      className="why-candidate"
                      key={m.key}
                      onClick={() => {
                        onLink(goal.id, m.target, m.title);
                        setQuery('');
                      }}
                    >
                      <span>+ {m.title}</span>
                      <em>{m.where}</em>
                    </button>
                  ))}
                  {q && !matches.length ? <p className="review-empty">No open items match.</p> : null}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
      {shown.length > PREVIEW_COUNT ? (
        <button type="button" className="row-action ghost why-more" onClick={() => setExpanded(e => !e)}>
          {expanded ? 'Show fewer' : `Show all ${shown.length}`}
        </button>
      ) : null}
    </section>
  );
}
