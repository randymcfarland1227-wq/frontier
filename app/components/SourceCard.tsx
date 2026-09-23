'use client';

import type { FeaturedItem, SourceDefinition, SourceSnapshot, TaskItem } from '../../lib/types';
import { updatedLabel } from '../../lib/protocol';
import { isConnectorSource } from '../../lib/connectors';
import { MetricGrid } from './MetricGrid';
import { FeaturedList } from './FeaturedList';
import { TaskList } from './TaskList';

export function SourceCard({
  source,
  snapshot,
  onEnter,
  onOpen,
  onCompleteFeatured,
  onCompleteTask,
  onStarTask,
}: {
  source: SourceDefinition;
  snapshot: SourceSnapshot;
  onEnter: () => void;
  onOpen: () => void;
  onCompleteFeatured?: (item: FeaturedItem) => void;
  onCompleteTask?: (task: TaskItem) => void;
  onStarTask?: (task: TaskItem) => void;
}) {
  const showSync = isConnectorSource(source.id) && Boolean(snapshot.refreshedAt);
  const links = source.relatedLinks || [];

  return (
    <article className={`space-card ${source.id}${source.placeholder ? ' placeholder' : ''}`}>
      <div className="card-top">
        <span>{source.number}</span>
        <span className="marker">{source.marker}</span>
      </div>
      <div className="card-copy">
        <p>{source.label}</p>
        <h2>{source.name}</h2>
        {links.length ? (
          <div className="related-links">
            {links.map(link => (
              <a key={link.url} href={link.url} target="_blank" rel="noopener noreferrer">
                {link.label}
              </a>
            ))}
            <span className="related-hint">Goals → routines → TickTick</span>
          </div>
        ) : null}
        <p className="description">{source.description}</p>
        {showSync ? <p className="sync-stamp">Synced {updatedLabel(snapshot.refreshedAt).replace(/^Updated\s+/i, '')}</p> : null}
      </div>
      <MetricGrid sourceId={source.id} snapshot={snapshot} compact />
      <FeaturedList sourceId={source.id} snapshot={snapshot} compact onComplete={onCompleteFeatured} />
      <TaskList
        sourceId={source.id}
        snapshot={snapshot}
        compact
        onComplete={onCompleteTask}
        onStar={onStarTask}
      />
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
