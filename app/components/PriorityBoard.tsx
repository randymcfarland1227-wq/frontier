'use client';

import { useMemo, useState, type DragEvent } from 'react';
import { tagTone } from '../../lib/tagTone';
import type { FeaturedItem, SourceId, SourceSnapshot } from '../../lib/types';
import { SOURCE_IDS, sourceById } from '../../lib/sources';
import { LANES, pinKey, placePin, unpin, usePriorityPins, type Lane } from '../../lib/priorityPins';
import { byLevel, criticalKeys, useFeaturedLevels } from '../../lib/featuredLevels';
import { LevelDot } from './LevelDot';
import { CriticalFlag } from './CriticalFlag';

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
 * The plan: pinned tasks from any site in Now / Next / Later lanes. Drag between lanes or within
 * one to reorder (or use ◀ ▶), pull any open task in from the search box, Done completes it on
 * its site. Critical items always show (in Now unless you move them).
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
  const { pins, laneOf } = usePriorityPins();
  const { levels, levelOf, cycle, isCritical, toggleCritical } = useFeaturedLevels();
  const [query, setQuery] = useState('');
  const [addTo, setAddTo] = useState<Lane>('now');
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const catalog = useMemo(() => buildCatalog(snapshots), [snapshots]);
  const criticals = useMemo(() => criticalKeys(levels).map(([s, id]) => pinKey(s, id)), [levels]);

  const lanes = useMemo(() => {
    const out: Record<Lane, PriorityItem[]> = { now: [], next: [], later: [] };
    const seen = new Set<string>();
    for (const key of pins) {
      const item = catalog.get(key);
      const lane = laneOf(key);
      if (!item || !lane) continue;
      out[lane].push(item);
      seen.add(key);
    }
    // Critical but never placed → top of Now.
    for (const key of criticals) {
      const item = catalog.get(key);
      if (item && !seen.has(key)) out.now.unshift(item);
    }
    // Inside a lane: critical first, then your order.
    for (const l of Object.keys(out) as Lane[]) out[l] = byLevel(out[l], () => null, i => isCritical(i.source, i.id));
    return out;
  }, [pins, catalog, criticals, laneOf, isCritical]);

  const placed = new Set(Object.values(lanes).flat().map(i => i.key));
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
  const shift = (item: PriorityItem, from: Lane, dir: -1 | 1) => {
    const idx = LANES.findIndex(l => l.id === from) + dir;
    if (idx >= 0 && idx < LANES.length) placePin(item.key, LANES[idx].id);
  };

  const onDrop = (lane: Lane, before?: string) => (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const key = e.dataTransfer.getData(DRAG_TYPE) || dragging;
    if (key && key !== before) placePin(key, lane, before);
    setDragging(null);
    setOver(null);
  };
  const allowDrop = (id: string) => (e: DragEvent) => {
    if (!dragging) return;
    e.preventDefault();
    setOver(id);
  };

  const total = Object.values(lanes).reduce((n, l) => n + l.length, 0);

  return (
    <section className="priority-board workstation glass-panel iridescent-border" aria-label="Priority">
      <div className="priority-head">
        <div>
          <p className="section-label">Priority</p>
          <h2>Your plan</h2>
          <p>
            {total
              ? `${total} task${total === 1 ? '' : 's'} planned. Drag between lanes to re-plan; Done completes it on its site.`
              : 'Pin from any card, star a Self task, mark something Critical, or pull a task in below.'}
          </p>
        </div>
        <div className="ws-add">
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Pull in a task from any site…"
            aria-label="Find a task to add to the plan"
          />
          <select value={addTo} onChange={e => setAddTo(e.target.value as Lane)} aria-label="Add to lane">
            {LANES.map(l => (
              <option key={l.id} value={l.id}>
                to {l.name}
              </option>
            ))}
          </select>
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
                    placePin(m.key, addTo);
                    setQuery('');
                  }}
                >
                  <span className="priority-source">{sourceById[m.source].shortName}</span>
                  {m.tag ? <span className={`task-tag tone-${tagTone(m.tag)}`}>{m.tag}</span> : null}
                  <strong>{m.title}</strong>
                  <span className="ws-match-add">+ {LANES.find(l => l.id === addTo)?.name}</span>
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

      <div className="ws-lanes">
        {LANES.map(lane => (
          <div
            key={lane.id}
            className={`ws-lane lane-${lane.id}${over === `lane:${lane.id}` ? ' is-over' : ''}`}
            onDragOver={allowDrop(`lane:${lane.id}`)}
            onDragLeave={() => setOver(o => (o === `lane:${lane.id}` ? null : o))}
            onDrop={onDrop(lane.id)}
          >
            <div className="ws-lane-head">
              <strong>{lane.name}</strong>
              <span>{lane.hint}</span>
              <b>{lanes[lane.id].length}</b>
            </div>
            <div className="ws-lane-list">
              {lanes[lane.id].length === 0 ? <p className="ws-empty">Drop tasks here</p> : null}
              {lanes[lane.id].map(item => {
                const critical = isCritical(item.source, item.id);
                return (
                  <article
                    key={item.key}
                    className={`ws-card src-${item.source}${critical ? ' is-critical' : ''}${dragging === item.key ? ' is-dragging' : ''}${over === item.key ? ' is-over' : ''}`}
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
                    onDragOver={allowDrop(item.key)}
                    onDrop={onDrop(lane.id, item.key)}
                    title={[item.title, item.detail].filter(Boolean).join(' — ')}
                  >
                    <div className="ws-card-top">
                      <LevelDot level={levelOf(item.source, item.id)} title={item.title} onCycle={() => cycle(item.source, item.id)} />
                      <CriticalFlag on={critical} title={item.title} onToggle={() => toggleCritical(item.source, item.id)} />
                      <button type="button" className="priority-source" onClick={() => enter(item.source)}>
                        {sourceById[item.source].shortName}
                      </button>
                      {item.tag ? <span className={`task-tag tone-${tagTone(item.tag)}`}>{item.tag}</span> : null}
                      <span className="ws-grip" aria-hidden="true">⋮⋮</span>
                    </div>
                    <div className="ws-card-title">
                      {item.originUrl ? (
                        <a className="origin-link" href={item.originUrl} target="_blank" rel="noopener noreferrer">
                          <strong>{item.title}</strong>
                        </a>
                      ) : (
                        <strong>{item.title}</strong>
                      )}
                    </div>
                    <div className="ws-card-actions">
                      <button
                        type="button"
                        className="row-action ghost"
                        disabled={lane.id === 'now'}
                        onClick={() => shift(item, lane.id, -1)}
                        aria-label={`Move ${item.title} earlier`}
                        title="Move to the lane on the left"
                      >
                        ◀
                      </button>
                      <button
                        type="button"
                        className="row-action ghost"
                        disabled={lane.id === 'later'}
                        onClick={() => shift(item, lane.id, 1)}
                        aria-label={`Move ${item.title} later`}
                        title="Move to the lane on the right"
                      >
                        ▶
                      </button>
                      <span className="ws-spacer" />
                      {onComplete ? (
                        <button type="button" className="row-action" onClick={() => finish(item)}>
                          Done
                        </button>
                      ) : null}
                      <button type="button" className="row-action ghost" aria-label={`Unpin ${item.title}`} title="Take off the plan" onClick={() => remove(item)}>
                        ✕
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
