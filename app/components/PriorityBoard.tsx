'use client';

import { useMemo, useState } from 'react';
import type { FeaturedItem, SourceId, SourceSnapshot } from '../../lib/types';
import { SOURCE_IDS, sourceById } from '../../lib/sources';
import { readSaved, writeSaved, STORAGE_KEYS } from '../../lib/storage';

type PriorityItem = FeaturedItem & { source: SourceId };

function collectFeatured(snapshots: Record<SourceId, SourceSnapshot>): PriorityItem[] {
  const items: PriorityItem[] = [];
  for (const id of SOURCE_IDS) {
    const snap = snapshots[id];
    if (!snap) continue;
    for (const f of snap.featured || []) items.push({ ...f, source: id });
    for (const t of snap.tasks || []) {
      if (!t.starred) continue;
      if (items.some(i => i.source === id && i.id === t.id)) continue;
      items.push({
        id: t.id,
        title: t.title,
        detail: t.detail || '',
        meta: 'Starred',
        originUrl: t.originUrl,
        completable: true,
        source: id,
      });
    }
  }
  return items;
}

export function PriorityBoard({
  snapshots,
  enter,
}: {
  snapshots: Record<SourceId, SourceSnapshot>;
  enter: (id: SourceId) => void;
}) {
  const featured = useMemo(() => collectFeatured(snapshots), [snapshots]);
  const [pinOrder, setPinOrder] = useState<string[]>(() =>
    readSaved<string[]>(STORAGE_KEYS.priorityPins, []),
  );

  const ordered = useMemo(() => {
    const keyOf = (item: PriorityItem) => `${item.source}:${item.id}`;
    const map = new Map(featured.map(item => [keyOf(item), item]));
    const pinned = pinOrder.map(k => map.get(k)).filter(Boolean) as PriorityItem[];
    const rest = featured.filter(item => !pinOrder.includes(keyOf(item)));
    return [...pinned, ...rest].slice(0, 12);
  }, [featured, pinOrder]);

  const pin = (item: PriorityItem) => {
    const k = `${item.source}:${item.id}`;
    setPinOrder(current => {
      const next = current.includes(k) ? current : [k, ...current];
      writeSaved(STORAGE_KEYS.priorityPins, next);
      return next;
    });
  };

  return (
    <section className="priority-board glass-panel iridescent-border" aria-label="Priority">
      <div className="priority-head">
        <p className="section-label">Priority</p>
        <h2>Starred across every origin</h2>
        <p>Featured and starred items from all sources. Pin to keep order in this browser.</p>
      </div>
      {ordered.length === 0 ? (
        <p className="priority-empty">Star or feature items in any source to gather them here.</p>
      ) : (
        <div className="priority-grid">
          {ordered.map(item => (
            <article key={`${item.source}:${item.id}`} className="priority-card">
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
                <button type="button" className="row-action ghost" onClick={() => pin(item)}>
                  Pin
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
