'use client';

import type { SourceDefinition, SourceSnapshot } from '../../lib/types';
import { MetricGrid } from './MetricGrid';
import { FeaturedList } from './FeaturedList';
import { TaskList } from './TaskList';

export function SourceCard({
  source,
  snapshot,
  onEnter,
  onOpen,
}: {
  source: SourceDefinition;
  snapshot: SourceSnapshot;
  onEnter: () => void;
  onOpen: () => void;
}) {
  return (
    <article className={`space-card ${source.id}${source.placeholder ? ' placeholder' : ''}`}>
      <div className="card-top">
        <span>{source.number}</span>
        <span className="marker">{source.marker}</span>
      </div>
      <div className="card-copy">
        <p>{source.label}</p>
        <h2>{source.name}</h2>
        <p className="description">{source.description}</p>
      </div>
      <MetricGrid sourceId={source.id} snapshot={snapshot} compact />
      <FeaturedList sourceId={source.id} snapshot={snapshot} compact />
      <TaskList sourceId={source.id} snapshot={snapshot} compact />
      <div className="card-actions">
        {source.url ? (
          <button type="button" className="open-button" onClick={onOpen}>
            Open <span>↗</span>
          </button>
        ) : (
          <button type="button" className="open-button muted" disabled>
            {source.placeholder ? 'Placeholder' : 'Hub-native'}
          </button>
        )}
        <button type="button" className="enter-button" onClick={onEnter}>
          {source.action}
          <span>→</span>
        </button>
      </div>
    </article>
  );
}
