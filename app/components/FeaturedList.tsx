'use client';

import { useState } from 'react';
import { tagTone } from '../../lib/tagTone';
import type { FeaturedItem, SourceId, SourceSnapshot } from '../../lib/types';
import { sourceById, isMusicTask, MUSIC_HUB_URL } from '../../lib/sources';
import { pinKey, usePriorityPins } from '../../lib/priorityPins';
import { DayMenu, shortDue } from './DayMenu';
import { setTaskTag, TAG_SUGGESTIONS, TAGGABLE } from '../../lib/taskTags';
import { setSelfHome } from '../../lib/adapters/self';
import { moveItem, removeItem } from '../../lib/siteMoves';
import { setRoleActive, shelfOf } from '../../lib/roleShelves';
import { byLevel, useFeaturedLevels } from '../../lib/featuredLevels';
import { LevelDot } from './LevelDot';
import { CriticalFlag } from './CriticalFlag';
import { readSaved, writeSaved, STORAGE_KEYS } from '../../lib/storage';

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
  const { levelOf, cycle, isCritical, toggleCritical } = useFeaturedLevels();
  // Critical first, then red, yellow, green, then the rest.
  const sorted = byLevel(snapshot.featured, f => levelOf(sourceId, f.id), f => isCritical(sourceId, f.id));
  const [showAll, setShowAll] = useState(false);
  const PREVIEW = compact ? 4 : 12;
  const items = showAll ? sorted : sorted.slice(0, PREVIEW);
  const { addPin, removePin, isPinned, lanes } = usePriorityPins();
  // Row whose Pin menu (pin / give it a day) is open
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const dueOf = (id: string) => {
    const e = lanes[pinKey(sourceId, id)];
    return e?.lane ? e.due : undefined;
  };
  /** Card view only: the starred list can fold down to its heading (remembered per card). */
  const [folded, setFolded] = useState(() =>
    compact && readSaved<string[]>(STORAGE_KEYS.collapsedFeatured, []).includes(sourceId),
  );
  const toggleFolded = () => {
    const next = !folded;
    const saved = readSaved<string[]>(STORAGE_KEYS.collapsedFeatured, []).filter(id => id !== sourceId);
    writeSaved(STORAGE_KEYS.collapsedFeatured, next ? [...saved, sourceId] : saved);
    setFolded(next);
  };

  return (
    <section className={`featured-list ${compact ? 'compact' : ''}`}>
      {compact ? (
        <button
          type="button"
          className={`featured-heading featured-fold${folded ? ' is-folded' : ''}`}
          aria-expanded={!folded}
          title={folded ? 'Show starred items' : 'Collapse starred items'}
          onClick={toggleFolded}
        >
          <span>★</span>
          <h3>{copy.feature}</h3>
          {folded && snapshot.featured.length ? <em className="featured-fold-count">{snapshot.featured.length}</em> : null}
          <span className="featured-fold-icon" aria-hidden="true">{folded ? '▸' : '▾'}</span>
        </button>
      ) : (
        <div className="featured-heading">
          <span>★</span>
          <h3>{copy.feature}</h3>
        </div>
      )}
      {folded ? null : items.length ? (
        <div className="featured-strip">{items.map(item => {
          const pinned = isPinned(sourceId, item.id);
          return (
            <article
              className={`featured-row one-line${isCritical(sourceId, item.id) ? ' is-critical' : ''}${menuFor === item.id ? ' has-menu' : ''}`}
              key={item.id}
              title={[item.title, item.detail, item.meta].filter(Boolean).join(' — ')}
            >
              <LevelDot level={levelOf(sourceId, item.id)} title={item.title} onCycle={() => cycle(sourceId, item.id)} />
              {/* No "!" on starred rows — the list already says it's starred; the flag shows only once it's Critical */}
              {isCritical(sourceId, item.id) ? (
                <CriticalFlag on title={item.title} onToggle={() => toggleCritical(sourceId, item.id)} />
              ) : null}
              <div className="featured-main">
                {item.tag ? <span className={`task-tag tone-${tagTone(item.tag)}`}>{item.tag}</span> : null}
                {item.originUrl ? (
                  <a className="origin-link" href={item.originUrl} target="_blank" rel="noopener noreferrer">
                    <strong>{item.title}</strong>
                  </a>
                ) : (
                  <strong>{item.title}</strong>
                )}
                {isMusicTask(item.title) ? (
                  <a className="row-music" href={MUSIC_HUB_URL} target="_blank" rel="noopener noreferrer" title="Open Music Hub" aria-label="Open Music Hub">
                    ♪
                  </a>
                ) : null}
                {dueOf(item.id) ? <span className="row-day">{shortDue(dueOf(item.id)!)}</span> : null}
                {item.meta ? <span className="featured-meta">{compact ? item.meta.replace(/^From /, '') : item.meta}</span> : null}
              </div>
              <div className="featured-actions">
                <button
                  type="button"
                  className={`row-action ghost ${pinned ? 'active' : ''}`}
                  data-day-trigger
                  onClick={() => setMenuFor(m => (m === item.id ? null : item.id))}
                  aria-expanded={menuFor === item.id}
                  aria-label={`Pin or give a day: ${item.title}`}
                >
                  {pinned ? 'Pinned' : 'Pin'}
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
              {menuFor === item.id ? (
                <DayMenu
                  itemKey={pinKey(sourceId, item.id)}
                  title={item.title}
                  toggle={{
                    label: pinned ? '◎ Pinned' : '◎ Pin to Priority',
                    on: pinned,
                    onClick: () => (pinned ? removePin(sourceId, item.id) : addPin(sourceId, item.id)),
                  }}
                  tag={
                    TAGGABLE.includes(sourceId)
                      ? { value: item.tag || '', suggestions: TAG_SUGGESTIONS[sourceId] || [], onChange: t => setTaskTag(sourceId, item.id, t) }
                      : undefined
                  }
                  backToSelf={item.id.startsWith('self:') ? () => setSelfHome(item.id.slice(5), undefined) : undefined}
                  critical={{ on: isCritical(sourceId, item.id), onClick: () => toggleCritical(sourceId, item.id) }}
                  move={sourceId !== 'self' ? { from: sourceId, onMove: to => moveItem(sourceId, item, to) } : undefined}
                  onRemove={sourceId !== 'self' ? () => removeItem(sourceId, item.id) : undefined}
                  shelf={shelfOf(item.id) ? { label: shelfOf(item.id)!.one, onClick: () => setRoleActive(item.id, false) } : undefined}
                  onClose={() => setMenuFor(null)}
                />
              ) : null}
            </article>
          );
        })}</div>
      ) : (
        <p className="featured-empty">
          {copy.placeholder
            ? copy.empty
            : snapshot.refreshedAt
              ? copy.empty
              : 'Connecting to the source…'}
        </p>
      )}
      {!folded && snapshot.featured.length > PREVIEW ? (
        <button type="button" className="featured-more" onClick={() => setShowAll(v => !v)}>
          {showAll ? 'Show fewer' : `+${snapshot.featured.length - PREVIEW} more starred`}
        </button>
      ) : null}
    </section>
  );
}
