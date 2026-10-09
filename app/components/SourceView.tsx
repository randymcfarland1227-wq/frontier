'use client';

import type { FeaturedItem, SourceId, SourceSnapshot, TaskItem } from '../../lib/types';
import { sourceById } from '../../lib/sources';
import type { SelfItem } from '../../lib/adapters/self';
import { MetricGrid } from './MetricGrid';
import { FeaturedList } from './FeaturedList';
import { TaskList } from './TaskList';
import { ShelfList } from './ShelfList';
import { SiteIcon } from './SiteIcon';
import { SelfInbox } from './SelfInbox';

export function SourceView({
  sourceId,
  snapshot,
  openSource,
  onCompleteFeatured,
  onCompleteTask,
  onStarTask,
  selfItems,
  onSelfAdd,
  onSelfComplete,
  onSelfStar,
}: {
  sourceId: SourceId;
  snapshot: SourceSnapshot;
  openSource: () => void;
  onCompleteFeatured: (item: FeaturedItem) => void;
  onCompleteTask: (task: TaskItem) => void;
  onStarTask: (task: TaskItem) => void;
  selfItems: SelfItem[];
  onSelfAdd: (title: string, detail: string) => void;
  onSelfComplete: (id: string) => void;
  onSelfStar: (id: string) => void;
}) {
  const copy = sourceById[sourceId];
  const links = copy.relatedLinks || [];
  return (
    <div className="room">
      <section className="room-hero">
        <SiteIcon source={sourceId} className="room-icon" />
        <div className="room-hero-main">
          <p className="room-eyebrow">{copy.eyebrow}</p>
          <h1>{copy.name}</h1>
          {links.length ? (
            <div className="related-links room-related">
              {links.map(link => (
                <a key={link.url} href={link.url} target="_blank" rel="noopener noreferrer">
                  {link.label}
                </a>
              ))}
              <span className="related-hint">Goals build routines; routines build TickTick.</span>
            </div>
          ) : null}
          <p className="room-intro">{copy.intro}</p>
        </div>
      </section>
      <MetricGrid sourceId={sourceId} snapshot={snapshot} />
      <section className="room-body">
        <aside className="room-aside">
          <p className="section-label">{copy.bridge === 'local' ? 'Hub-native' : 'Original site'}</p>
          <h2>{copy.placeholder ? 'Placeholder for now.' : copy.bridge === 'local' ? 'Capture here.' : 'Use the full site.'}</h2>
          <p>
            {copy.placeholder
              ? 'This site isn\'t connected yet, so there are no numbers or tasks here.'
              : copy.bridge === 'local'
                ? 'Add, star, and complete Self tasks right here on the hub.'
                : 'Open the site from here. Star items there to feature them on this card. Marking something Done here also marks it done on that site when it supports it.'}
          </p>
          {copy.url ? (
            <button className="primary-link" type="button" onClick={openSource}>
              Open {copy.name} <span>↗</span>
            </button>
          ) : (
            <button className="primary-link" type="button" disabled>
              {copy.placeholder ? 'Coming soon' : 'No external link'}
            </button>
          )}
        </aside>
        <div className="work-ledger">
          {sourceId === 'self' ? (
            <SelfInbox items={selfItems} onAdd={onSelfAdd} onComplete={onSelfComplete} onStar={onSelfStar} />
          ) : (
            <>
              <FeaturedList sourceId={sourceId} snapshot={snapshot} onComplete={onCompleteFeatured} />
              <TaskList
                sourceId={sourceId}
                snapshot={snapshot}
                onComplete={onCompleteTask}
                onStar={onStarTask}
              />
              <ShelfList snapshot={snapshot} />
            </>
          )}
        </div>
      </section>
    </div>
  );
}
