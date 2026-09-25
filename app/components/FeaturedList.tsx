'use client';

import type { FeaturedItem, SourceId, SourceSnapshot } from '../../lib/types';
import { sourceById } from '../../lib/sources';
import { usePriorityPins } from '../../lib/priorityPins';
import { byLevel, useFeaturedLevels } from '../../lib/featuredLevels';
import { LevelDot } from './LevelDot';

export function FeaturedList({
  sourceId,
  snapshot,
  compact = false,
  onComplete,
}: {
  sourceId: SourceId;
  snapshot: SourceSnapshot;
  compact?: boolean;
  onComplete?: (item: FeaturedItem) => void;
}) {
  const copy = sourceById[sourceId];
  const { levelOf, cycle } = useFeaturedLevels();
  // Red first, then yellow, then green, then the rest.
  const sorted = byLevel(snapshot.featured, f => levelOf(sourceId, f.id));
  const items = sorted.slice(0, compact ? 3 : 12);
  const { addPin, removePin, isPinned } = usePriorityPins();

  return (
    <section className={`featured-list ${compact ? 'compact' : ''}`}>
      <div className="featured-heading">
        <span>★</span>
        <h3>{copy.feature}</h3>
      </div>
      {items.length ? (
        items.map(item => {
          const pinned = isPinned(sourceId, item.id);
          return (
            <article className="featured-row one-line" key={item.id} title={[item.title, item.detail, item.meta].filter(Boolean).join(' — ')}>
              <LevelDot level={levelOf(sourceId, item.id)} title={item.title} onCycle={() => cycle(sourceId, item.id)} />
              <div className="featured-main">
                {item.originUrl ? (
                  <a className="origin-link" href={item.originUrl} target="_blank" rel="noopener noreferrer">
                    <strong>{item.title}</strong>
                  </a>
                ) : (
                  <strong>{item.title}</strong>
                )}
                {item.meta ? <span className="featured-meta">{item.meta}</span> : null}
              </div>
              <div className="featured-actions">
                <button
                  type="button"
                  className={`row-action ghost ${pinned ? 'active' : ''}`}
                  onClick={() => (pinned ? removePin(sourceId, item.id) : addPin(sourceId, item.id))}
                  aria-pressed={pinned}
                  aria-label={pinned ? `Remove ${item.title} from priority` : `Add ${item.title} to priority`}
                >
                  {compact ? (pinned ? 'Pinned' : 'Pin') : pinned ? 'In priority' : 'Priority'}
                </button>
                {onComplete ? (
                  <button
                    type="button"
                    className="row-action"
                    onClick={() => onComplete(item)}
                    aria-label={`Complete ${item.title}`}
                  >
                    Done
                  </button>
                ) : null}
              </div>
            </article>
          );
        })
      ) : (
        <p className="featured-empty">
          {copy.placeholder
            ? copy.empty
            : snapshot.refreshedAt
              ? copy.empty
              : 'Connecting to the source…'}
        </p>
      )}
      {compact && snapshot.featured.length > 3 ? (
        <p className="featured-more">+{snapshot.featured.length - 3} more featured</p>
      ) : null}
    </section>
  );
}
