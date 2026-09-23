'use client';

import type { FeaturedItem, SourceId, SourceSnapshot } from '../../lib/types';
import { sourceById } from '../../lib/sources';
import { usePriorityPins } from '../../lib/priorityPins';

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
  const items = snapshot.featured.slice(0, compact ? 2 : 12);
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
            <article className="featured-row" key={item.id}>
              <div>
                {item.originUrl ? (
                  <a className="origin-link" href={item.originUrl} target="_blank" rel="noopener noreferrer">
                    <strong>{item.title}</strong>
                  </a>
                ) : (
                  <strong>{item.title}</strong>
                )}
                <p>{item.detail}</p>
                <span>{item.meta}</span>
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
      {compact && snapshot.featured.length > 2 ? (
        <p className="featured-more">+{snapshot.featured.length - 2} more featured</p>
      ) : null}
    </section>
  );
}
