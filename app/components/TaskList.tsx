'use client';

import { useMemo, useState } from 'react';
import type { SourceId, SourceSnapshot, TaskItem } from '../../lib/types';

const PREVIEW = 6;

function isHabit(task: TaskItem) {
  return task.kind === 'habit' || task.id.startsWith('habit-');
}

export function TaskList({
  sourceId,
  snapshot,
  compact = false,
  onComplete,
  onStar,
}: {
  sourceId: SourceId;
  snapshot: SourceSnapshot;
  compact?: boolean;
  onComplete?: (task: TaskItem) => void;
  onStar?: (task: TaskItem) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const openTasks = snapshot.tasks.filter(t => t.status !== 'done');
  const habits = openTasks.filter(isHabit);
  const tasks = openTasks.filter(t => !isHabit(t));
  const done = snapshot.tasks.filter(t => t.status === 'done');

  const visibleTasks = useMemo(() => {
    if (compact && !expanded) return [] as TaskItem[];
    const list = showAll ? [...tasks, ...habits, ...done] : [...tasks, ...habits].slice(0, PREVIEW);
    return list;
  }, [compact, expanded, showAll, tasks, habits, done]);

  const total = snapshot.tasks.length;
  const openCount = openTasks.length;
  const hiddenCount = Math.max(0, openCount - PREVIEW);
  const habitPreview = showAll ? habits.length : Math.min(habits.length, 8);
  const habitHidden = Math.max(0, habits.length - habitPreview);

  return (
    <section className={`task-list ${compact ? 'compact' : ''}`} data-source={sourceId}>
      <div className="task-heading">
        <div>
          <span className="task-count">{openCount}</span>
          <h3>
            Tasks{total ? ` · ${total}` : ''}
            {habits.length ? ` · ${habits.length} habits` : ''}
          </h3>
        </div>
        {compact ? (
          <button type="button" className="task-toggle" onClick={() => setExpanded(v => !v)} aria-expanded={expanded}>
            {expanded ? 'Collapse' : 'Expand'}
          </button>
        ) : null}
      </div>

      {compact && !expanded ? (
        <p className="task-summary">
          {total === 0
            ? snapshot.refreshedAt
              ? 'No tasks from this origin yet.'
              : 'Waiting for tasks…'
            : `${openCount} open${habits.length ? ` · ${habits.length} habits` : ''} · expand for board`}
        </p>
      ) : null}

      {(expanded || !compact) && (
        <>
          {habits.length > 0 ? (
            <div className="habit-chip-row" aria-label="Habits">
              {habits.slice(0, habitPreview).map(h => (
                <span className="habit-chip" key={h.id} title={h.detail || h.title}>
                  Habit · {h.title}
                </span>
              ))}
            </div>
          ) : null}

          <div className="task-board">
            {visibleTasks.length === 0 ? (
              <p className="featured-empty">No tasks yet.</p>
            ) : (
              visibleTasks.map(task => (
                <article
                  className={`task-row ${task.status === 'done' ? 'done' : ''} ${isHabit(task) ? 'habit' : ''}`}
                  key={task.id}
                >
                  <div className="task-main">
                    {isHabit(task) ? <span className="task-badge">Habit</span> : null}
                    {task.originUrl ? (
                      <a className="origin-link" href={task.originUrl} target="_blank" rel="noopener noreferrer">
                        <strong>{task.title}</strong>
                      </a>
                    ) : (
                      <strong>{task.title}</strong>
                    )}
                    {task.detail ? <p>{task.detail}</p> : null}
                    <span>
                      {task.status || 'open'}
                      {task.due ? ` · due ${task.due}` : ''}
                      {task.starred ? ' · ★' : ''}
                    </span>
                  </div>
                  <div className="task-actions">
                    {onStar ? (
                      <button type="button" className="row-action ghost" onClick={() => onStar(task)} aria-label="Toggle star">
                        {task.starred ? '★' : '☆'}
                      </button>
                    ) : null}
                    {onComplete && task.status !== 'done' ? (
                      <button
                        type="button"
                        className="row-action"
                        onClick={() => onComplete(task)}
                        aria-label={`Complete ${task.title}`}
                      >
                        Done
                      </button>
                    ) : null}
                  </div>
                </article>
              ))
            )}
          </div>

          {hiddenCount > 0 || habitHidden > 0 ? (
            <button type="button" className="task-toggle show-more" onClick={() => setShowAll(v => !v)}>
              {showAll
                ? 'Show less'
                : `Show ${Math.max(hiddenCount, habitHidden)} more`}
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}
