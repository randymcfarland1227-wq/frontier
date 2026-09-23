'use client';

import { useState } from 'react';
import type { SourceId, SourceSnapshot, TaskItem } from '../../lib/types';

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
  const openCount = snapshot.tasks.filter(t => t.status !== 'done').length;
  const total = snapshot.tasks.length;
  const show = expanded || !compact ? snapshot.tasks : snapshot.tasks.filter(t => t.status !== 'done').slice(0, 0);

  return (
    <section className={`task-list ${compact ? 'compact' : ''}`} data-source={sourceId}>
      <div className="task-heading">
        <div>
          <span className="task-count">{openCount}</span>
          <h3>Tasks{total ? ` · ${total} total` : ''}</h3>
        </div>
        {compact ? (
          <button type="button" className="task-toggle" onClick={() => setExpanded(v => !v)} aria-expanded={expanded}>
            {expanded ? 'Collapse' : 'Expand full list'}
          </button>
        ) : null}
      </div>
      {compact && !expanded ? (
        <p className="task-summary">
          {total === 0
            ? snapshot.refreshedAt
              ? 'No tasks from this origin yet.'
              : 'Waiting for tasks…'
            : `${openCount} open · tap expand for the full list`}
        </p>
      ) : null}
      {(expanded || !compact) && (
        <div className="task-rows">
          {show.length === 0 ? (
            <p className="featured-empty">No tasks yet.</p>
          ) : (
            show.map(task => (
              <article className={`task-row ${task.status === 'done' ? 'done' : ''}`} key={task.id}>
                <div className="task-main">
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
                    <button type="button" className="row-action" onClick={() => onComplete(task)} aria-label={`Complete ${task.title}`}>
                      Done
                    </button>
                  ) : null}
                </div>
              </article>
            ))
          )}
        </div>
      )}
    </section>
  );
}
