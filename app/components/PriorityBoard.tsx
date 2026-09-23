'use client';

import { useMemo } from 'react';
import type { FeaturedItem, SourceId, SourceSnapshot } from '../../lib/types';
import { SOURCE_IDS, sourceById } from '../../lib/sources';
import { pinKey, usePriorityPins } from '../../lib/priorityPins';

type PriorityItem = FeaturedItem & { source: SourceId };

/** Resolve only explicitly pinned keys — never auto-dump featured/starred. */
function resolvePinned(
  snapshots: Record<SourceId, SourceSnapshot>,
  pinOrder: string[],
): PriorityItem[] {
  if (!pinOrder.length) return [];

  const catalog = new Map<string, PriorityItem>();
  for (const id of SOURCE_IDS) {
    const snap = snapshots[id];
    if (!snap) continue;
    for (const featured of snap.featured || []) {
      catalog.set(pinKey(id, featured.id), { ...featured, source: id });
    }
    for (const task of snap.tasks || []) {
      const key = pinKey(id, task.id);
      if (catalog.has(key)) continue;
      catalog.set(key, {
        id: task.id,
        title: task.title,
        detail: task.detail || '',
        meta: task.starred ? 'Starred' : task.status || 'Task',
        originUrl: task.originUrl,
        completable: true,
        source: id,
      });
    }
  }

  return pinOrder
    .map(key => catalog.get(key))
    .filter((item): item is PriorityItem => Boolean(item));
}

export function PriorityBoard({
  snapshots,
  enter,
  onComplete,
}: {
  snapshots: Record<SourceId, SourceSnapshot>;
  enter: (id: SourceId) => void;
  onComplete?: (source: SourceId, item: FeaturedItem) => void;
}) {
  const { pins, removePin } = usePriorityPins();
  const ordered = useMemo(() => resolvePinned(snapshots, pins), [snapshots, pins]);

  return (
    <section className="priority-board glass-panel iridescent-border" aria-label="Priority">
      <div className="priority-head">
        <p className="section-label">Priority</p>
        <h2>Pinned priorities</h2>
        <p>Promote a featured item from any source to pin it here.</p>
      </div>
      {ordered.length === 0 ? (
        <p className="priority-empty">
          Promote a featured item from any source to pin it here.
        </p>
      ) : (
        <div className="priority-grid">
          {ordered.map(item => (
            <article key={pinKey(item.source, item.id)} className="priority-card">
              <button type="button" className="priority-source" onClick={() => enter(item.source)}>
                {sourceById[item.source].shortName}
              </button>
              {item.originUrl ? (
                <a className="origin-link" href={item.originUrl} target="_blank" rel="noopener noreferrer">
                  <strong>{item.title}</strong>
                </a>
              ) : (
                <strong>{item.title}</strong>
              )}
              {item.detail ? <p>{item.detail}</p> : null}
              <div className="priority-actions">
                <span>{item.meta}</span>
                <div className="priority-action-buttons">
                  {onComplete ? (
                    <button
                      type="button"
                      className="row-action"
                      onClick={() => {
                        onComplete(item.source, item);
                        removePin(item.source, item.id);
                      }}
                    >
                      Done
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="row-action ghost"
                    onClick={() => removePin(item.source, item.id)}
                  >
                    Remove
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
