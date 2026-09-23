'use client';

import type { FeaturedItem, SourceId, SourceSnapshot } from '../../lib/types';
import { sourceById } from '../../lib/sources';

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
  return (
    <section className={`featured-list ${compact ? 'compact' : ''}`}>
      <div className="featured-heading">
        <span>★</span>
        <h3>{copy.feature}</h3>
      </div>
      {items.length ? (
        items.map(item => (
          <article className="featured-row" key={item.id}>
            <div>
              <strong>{item.title}</strong>
              <p>{item.detail}</p>
              <span>{item.meta}</span>
            </div>
            {!compact && item.completable && onComplete ? (
              <button type="button" className="row-action" onClick={() => onComplete(item)} aria-label={`Complete ${item.title}`}>
                Done
              </button>
            ) : null}
          </article>
        ))
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
