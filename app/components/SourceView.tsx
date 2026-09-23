'use client';

import type { FeaturedItem, SourceId, SourceSnapshot, TaskItem } from '../../lib/types';
import { sourceById } from '../../lib/sources';
import type { SelfItem } from '../../lib/adapters/self';
import { MetricGrid } from './MetricGrid';
import { FeaturedList } from './FeaturedList';
import { TaskList } from './TaskList';
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
  return (
    <div className="room">
      <section className="room-hero">
        <div className="room-index">{copy.number}</div>
        <div>
          <p className="room-eyebrow">{copy.eyebrow}</p>
          <h1>{copy.name}</h1>
          <p className="room-intro">{copy.intro}</p>
        </div>
        <div className="room-symbol" aria-hidden="true">
          {copy.marker}
        </div>
      </section>
      <MetricGrid sourceId={sourceId} snapshot={snapshot} />
      <section className="room-body">
        <aside className="room-aside">
          <p className="section-label">{copy.bridge === 'local' ? 'Hub-native' : 'Original site'}</p>
          <h2>{copy.placeholder ? 'Placeholder for now.' : copy.bridge === 'local' ? 'Capture here.' : 'Use the full site.'}</h2>
          <p>
            {copy.placeholder
              ? 'Peculiar Candle Pre Launch is reserved. Metrics and bridge wiring come in a later pass.'
              : copy.bridge === 'local'
                ? 'Add, star, and complete Self items on this hub. They stay in this browser until you categorize them to another origin.'
                : 'Open the origin from here. Star items there so they feature on this card. Completing on the hub will notify the origin when its bridge listens for randys-workroom:complete.'}
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
            </>
          )}
        </div>
      </section>
    </div>
  );
}
