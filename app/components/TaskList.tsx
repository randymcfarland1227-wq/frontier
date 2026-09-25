'use client';

import { useMemo, useState } from 'react';
import type { SourceId, SourceSnapshot, TaskItem } from '../../lib/types';

/** Rows per column in the side-by-side view before "Show more". */
const SPLIT_PREVIEW = 8;
const PREVIEW = 6;

function isHabit(task: TaskItem) {
  return task.kind === 'habit' || task.id.startsWith('habit-');
}

/** Short tag after the title: overdue / today / done. */
function whenLabel(task: TaskItem) {
  if (task.status === 'done') return 'done';
  if (!task.due) return '';
  const today = new Date();
  const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const due = task.due.slice(0, 10);
  if (due < key) return 'overdue';
  if (due === key) return 'today';
  return `due ${due.slice(5)}`;
}

export function TaskList({
  sourceId,
  snapshot,
  compact = false,
  onComplete,
  onStar,
  split = false,
}: {
  sourceId: SourceId;
  snapshot: SourceSnapshot;
  compact?: boolean;
  onComplete?: (task: TaskItem) => void;
  onStar?: (task: TaskItem) => void;
  /** Wide card: tasks and habits side by side */
  split?: boolean;
}) {
  const [expandedState, setExpanded] = useState(false);
  /** The split view is always open: Tasks and Habits columns show without tapping Expand. */
  const expanded = split || expandedState;
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
  /** "20 tasks · 28 habits" — habits are counted separately, never folded into tasks. */
  const countLabel = [
    `${tasks.length} task${tasks.length === 1 ? '' : 's'}`,
    habits.length ? `${habits.length} habit${habits.length === 1 ? '' : 's'}` : '',
  ].filter(Boolean).join(' · ');
  const hiddenCount = Math.max(0, openCount - PREVIEW);
  const habitPreview = showAll ? habits.length : Math.min(habits.length, 8);
  const habitHidden = Math.max(0, habits.length - habitPreview);
  const moreCount = split
    ? Math.max(0, tasks.length - SPLIT_PREVIEW, habits.length - SPLIT_PREVIEW)
    : Math.max(hiddenCount, habitHidden);

  const renderRow = (task: TaskItem) => (
                <article
                  className={`task-row one-line ${task.status === 'done' ? 'done' : ''} ${isHabit(task) ? 'habit' : ''}`}
                  key={task.id}
                  title={[task.title, task.detail].filter(Boolean).join(' — ')}
                >
                  <div className="task-main">
                    {isHabit(task) ? <span className="task-badge">Habit</span> : null}
                    {task.tag ? <span className="task-tag">{task.tag}</span> : null}
                    {task.originUrl ? (
                      <a className="origin-link" href={task.originUrl} target="_blank" rel="noopener noreferrer">
                        <strong>{task.title}</strong>
                      </a>
                    ) : (
                      <strong>{task.title}</strong>
                    )}
                    <span className="task-when">{whenLabel(task)}</span>
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
  );

  return (
    <section className={`task-list ${compact ? 'compact' : ''}`} data-source={sourceId}>
      {split ? null : (
      <div className="task-heading">
        <div>
          <span className="task-count">{tasks.length}</span>
          <h3>{openCount ? countLabel : 'Tasks'}</h3>
        </div>
        {compact && !split ? (
          <button type="button" className="task-toggle" onClick={() => setExpanded(v => !v)} aria-expanded={expanded}>
            {expanded ? 'Collapse' : 'Expand'}
          </button>
        ) : null}
      </div>
      )}

      {compact && !expanded && total === 0 ? (
        <p className="task-summary">{snapshot.refreshedAt ? 'Nothing open right now.' : 'Waiting for tasks…'}</p>
      ) : null}

      {(expanded || !compact) && (
        <>
          {habits.length > 0 && !split ? (
            <div className="habit-chip-row" aria-label="Habits">
              {habits.slice(0, habitPreview).map(h => (
                <span className="habit-chip" key={h.id} title={h.detail || h.title}>
                  Habit · {h.title}
                </span>
              ))}
            </div>
          ) : null}

          {split ? (
            <div className="task-split">
              <div>
                <p className="task-split-label">Tasks · {tasks.length}</p>
                <div className="task-board">
                  {tasks.length ? (showAll ? tasks : tasks.slice(0, SPLIT_PREVIEW)).map(renderRow) : <p className="featured-empty">No tasks due.</p>}
                </div>
              </div>
              <div>
                <p className="task-split-label">Habits · {habits.length}</p>
                <div className="task-board">
                  {habits.length ? (showAll ? habits : habits.slice(0, SPLIT_PREVIEW)).map(renderRow) : <p className="featured-empty">No habits left today.</p>}
                </div>
              </div>
            </div>
          ) : (
          <div className="task-board">
            {visibleTasks.length === 0 ? (
              <p className="featured-empty">No tasks yet.</p>
            ) : (
              visibleTasks.map(renderRow)
            )}
          </div>
          )}

          {moreCount > 0 ? (
            <button type="button" className="task-toggle show-more" onClick={() => setShowAll(v => !v)}>
              {showAll
                ? 'Show less'
                : `Show ${moreCount} more`}
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}
