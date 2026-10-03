'use client';

import { useMemo, useState, type DragEvent } from 'react';
import { tagTone } from '../../lib/tagTone';
import type { FeaturedItem, SourceId, SourceSnapshot } from '../../lib/types';
import { SOURCE_IDS, sourceById } from '../../lib/sources';
import { pinKey, placePin, unpin, usePriorityPins } from '../../lib/priorityPins';
import { byLevel, criticalKeys, useFeaturedLevels } from '../../lib/featuredLevels';
import { LevelDot } from './LevelDot';
import { CriticalFlag } from './CriticalFlag';
import { SiteIcon } from './SiteIcon';

type PriorityItem = FeaturedItem & { source: SourceId; key: string };

/** Every open task and featured item across the hub, by pin key. */
function buildCatalog(snapshots: Record<SourceId, SourceSnapshot>) {
  const catalog = new Map<string, PriorityItem>();
  for (const id of SOURCE_IDS) {
    const snap = snapshots[id];
    if (!snap) continue;
    for (const featured of snap.featured || []) {
      const key = pinKey(id, featured.id);
      catalog.set(key, { ...featured, source: id, key });
    }
    for (const task of snap.tasks || []) {
      if (task.status === 'done') continue;
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
        key,
      });
    }
  }
  return catalog;
}

const DRAG_TYPE = 'text/lifehub-pin';

/**
 * "Doing now": the things you've committed to, grouped into one container per site so the
 * grouping guides the work (all the Self items together, all the Outlook items together…).
 * Pin from any card, star a Self task, mark something Critical, or pull a task in from search.
 * Drag to reorder inside a site; Done completes it on its site; ✕ takes it off the plan.
 */
export function PriorityBoard({
  snapshots,
  enter,
  onComplete,
}: {
  snapshots: Record<SourceId, SourceSnapshot>;
  enter: (id: SourceId) => void;
  onComplete?: (source: SourceId, item: FeaturedItem) => void;
}) {
  const { pins } = usePriorityPins();
  const { levels, levelOf, cycle, isCritical, toggleCritical } = useFeaturedLevels();
  const [query, setQuery] = useState('');
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const catalog = useMemo(() => buildCatalog(snapshots), [snapshots]);
  const criticals = useMemo(() => criticalKeys(levels).map(([s, id]) => pinKey(s, id)), [levels]);

  // One group per site, in plan order; critical first, then red/yellow/green, then your order.
  const groups = useMemo(() => {
    const keys = [...criticals.filter(k => !pins.includes(k)), ...pins];
    const bySite = new Map<SourceId, PriorityItem[]>();
    for (const key of keys) {
      const item = catalog.get(key);
      if (!item) continue;
      const list = bySite.get(item.source) || [];
      if (!list.some(i => i.key === key)) list.push(item);
      bySite.set(item.source, list);
    }
    return [...bySite.entries()]
      .map(([source, items]) => ({
        source,
        items: byLevel(items, i => levelOf(i.source, i.id), i => isCritical(i.source, i.id)),
        critical: items.some(i => isCritical(i.source, i.id)),
      }))
      .sort((a, b) => Number(b.critical) - Number(a.critical) || b.items.length - a.items.length);
  }, [pins, criticals, catalog, levelOf, isCritical]);

  const placed = new Set(groups.flatMap(g => g.items.map(i => i.key)));
  const total = placed.size;
  const q = query.trim().toLowerCase();
  const matches = q
    ? [...catalog.values()]
        .filter(i => !placed.has(i.key) && (i.title.toLowerCase().includes(q) || sourceById[i.source].shortName.toLowerCase().includes(q)))
        .slice(0, 8)
    : [];

  const finish = (item: PriorityItem) => {
    onComplete?.(item.source, item);
    unpin(item.key);
    if (isCritical(item.source, item.id)) toggleCritical(item.source, item.id);
  };
  const remove = (item: PriorityItem) => {
    unpin(item.key);
    if (isCritical(item.source, item.id)) toggleCritical(item.source, item.id);
  };
  const onDrop = (before: string) => (e: DragEvent) => {
    e.preventDefault();
    const key = e.dataTransfer.getData(DRAG_TYPE) || dragging;
    if (key && key !== before) placePin(key, 'now', before);
    setDragging(null);
    setOver(null);
  };

  return (
    <section className="priority-board workstation glass-panel" aria-label="Priority">
      <div className="priority-head">
        <div>
          <p className="section-label">Priority</p>
          <h2>Doing now</h2>
          <p>
            {total
              ? `${total} thing${total === 1 ? '' : 's'} on deck across ${groups.length} site${groups.length === 1 ? '' : 's'}, grouped so you can work through one site at a time.`
              : 'Pin from any card, star a Self task, mark something Critical, or pull a task in here.'}
          </p>
        </div>
        <div className="ws-add">
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Pull in a task from any site…"
            aria-label="Find a task to add to Doing now"
          />
          {matches.length ? (
            <div className="ws-matches glass-panel" role="listbox">
              {matches.map(m => (
                <button
                  key={m.key}
                  type="button"
                  role="option"
                  aria-selected={false}
                  className={`ws-match src-${m.source}`}
                  onClick={() => {
                    placePin(m.key, 'now');
                    setQuery('');
                  }}
                >
                  <SiteIcon source={m.source} className="ws-match-icon" />
                  {m.tag ? <span className={`task-tag tone-${tagTone(m.tag)}`}>{m.tag}</span> : null}
                  <strong>{m.title}</strong>
                  <span className="ws-match-add">+ Add</span>
                </button>
              ))}
            </div>
          ) : q ? (
            <div className="ws-matches glass-panel">
              <p className="review-empty">No open task matches “{query.trim()}”.</p>
            </div>
          ) : null}
        </div>
      </div>

      {groups.length ? (
        <div className="plan-groups">
          {groups.map(group => {
            const def = sourceById[group.source];
            return (
              <div key={group.source} className={`plan-group grp-${group.source}${group.critical ? ' has-critical' : ''}`}>
                <div className="plan-group-head">
                  <SiteIcon source={group.source} className="plan-group-icon" />
                  <button type="button" className="plan-group-name" onClick={() => enter(group.source)} title={`Open ${def.name} page`}>
                    {def.name}
                  </button>
                  <span className="plan-group-count">{group.items.length}</span>
                </div>
                <div className="plan-group-list">
                  {group.items.map(item => {
                    const critical = isCritical(item.source, item.id);
                    return (
                      <article
                        key={item.key}
                        className={`plan-item${critical ? ' is-critical' : ''}${dragging === item.key ? ' is-dragging' : ''}${over === item.key ? ' is-over' : ''}`}
                        draggable
                        onDragStart={e => {
                          e.dataTransfer.setData(DRAG_TYPE, item.key);
                          e.dataTransfer.effectAllowed = 'move';
                          setDragging(item.key);
                        }}
                        onDragEnd={() => {
                          setDragging(null);
                          setOver(null);
                        }}
                        onDragOver={e => {
                          if (!dragging) return;
                          e.preventDefault();
                          setOver(item.key);
                        }}
                        onDrop={onDrop(item.key)}
                        title={[item.title, item.detail].filter(Boolean).join(' — ')}
                      >
                        <LevelDot level={levelOf(item.source, item.id)} title={item.title} onCycle={() => cycle(item.source, item.id)} />
                        <CriticalFlag on={critical} title={item.title} onToggle={() => toggleCritical(item.source, item.id)} />
                        <div className="plan-item-main">
                          {item.tag ? <span className={`task-tag tone-${tagTone(item.tag)}`}>{item.tag}</span> : null}
                          {item.originUrl ? (
                            <a className="origin-link" href={item.originUrl} target="_blank" rel="noopener noreferrer">
                              <strong>{item.title}</strong>
                            </a>
                          ) : (
                            <strong>{item.title}</strong>
                          )}
                        </div>
                        {onComplete ? (
                          <button type="button" className="row-action" onClick={() => finish(item)}>
                            Done
                          </button>
                        ) : null}
                        <button type="button" className="row-action ghost" aria-label={`Take ${item.title} off the plan`} title="Take off the plan" onClick={() => remove(item)}>
                          ✕
                        </button>
                      </article>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
