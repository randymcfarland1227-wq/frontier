'use client';

import { useMemo } from 'react';
import type { FeaturedItem, SourceId, SourceSnapshot } from '../../lib/types';
import { SOURCE_IDS, sourceById } from '../../lib/sources';
import { pinKey, usePriorityPins } from '../../lib/priorityPins';
import { byLevel, useFeaturedLevels } from '../../lib/featuredLevels';
import { LevelDot } from './LevelDot';

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
        tag: task.tag,
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
  const { levelOf, cycle } = useFeaturedLevels();
  const ordered = byLevel(
    useMemo(() => resolvePinned(snapshots, pins), [snapshots, pins]),
    item => levelOf(item.source, item.id),
  );

  return (
    <section className="priority-board glass-panel iridescent-border" aria-label="Priority">
      <div className="priority-head">
        <p className="section-label">Priority</p>
        <h2>Pinned priorities</h2>
        <p>Pin a featured item from any source card, or star a Self task, to keep it here.</p>
      </div>
      {ordered.length === 0 ? (
        <p className="priority-empty">
          Nothing pinned yet.
        </p>
      ) : (
        <div className="priority-list">
          {ordered.map(item => (
            <article
              key={pinKey(item.source, item.id)}
              className={`priority-row level-row-${levelOf(item.source, item.id) || 'none'}`}
              title={[item.title, item.detail, item.meta].filter(Boolean).join(' — ')}
            >
              <LevelDot level={levelOf(item.source, item.id)} title={item.title} onCycle={() => cycle(item.source, item.id)} />
              <div className="priority-row-main">
                {item.tag ? <span className="task-tag">{item.tag}</span> : null}
                {item.originUrl ? (
                  <a className="origin-link" href={item.originUrl} target="_blank" rel="noopener noreferrer">
                    <strong>{item.title}</strong>
                  </a>
                ) : (
                  <strong>{item.title}</strong>
                )}
                <button type="button" className="priority-source" onClick={() => enter(item.source)}>
                  {sourceById[item.source].shortName}
                </button>
              </div>
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
                  aria-label={`Unpin ${item.title}`}
                  title="Unpin"
                  onClick={() => removePin(item.source, item.id)}
                >
                  ✕
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
