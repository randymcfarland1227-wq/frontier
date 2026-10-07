'use client';

import { useMemo, useState, type DragEvent } from 'react';
import { tagTone } from '../../lib/tagTone';
import type { FeaturedItem, SourceId, SourceSnapshot } from '../../lib/types';
import { SOURCE_IDS, sourceById } from '../../lib/sources';
import { DECK, PLAN, openBefore, pinKey, placePin, unpin, usePriorityPins, type Lane } from '../../lib/priorityPins';
import { byLevel, criticalKeys, useFeaturedLevels } from '../../lib/featuredLevels';
import { LevelDot } from './LevelDot';
import { CriticalFlag } from './CriticalFlag';
import { SiteIcon } from './SiteIcon';
import { PriorityPanel, type PriorityItem } from './PriorityPanel';

/** Self's stand-in detail for starred items with no note — not worth a subtext line. */
const FILLER_DETAIL = 'Captured in Self inbox';

/** Every open task and featured item across the hub, by pin key. */
function buildCatalog(snapshots: Record<SourceId, SourceSnapshot>) {
  const catalog = new Map<string, PriorityItem>();
  for (const id of SOURCE_IDS) {
    const snap = snapshots[id];
    if (!snap) continue;
    for (const featured of snap.featured || []) {
      const key = pinKey(id, featured.id);
      catalog.set(key, { ...featured, detail: featured.detail === FILLER_DETAIL ? '' : featured.detail, source: id, key });
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

/** "Sat, Oct 10" / "Today" / "Tomorrow" for a Priority day. */
function dueChip(day: string) {
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const diff = Math.round((date.getTime() - new Date(new Date().toDateString()).getTime()) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff < 0) return `${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} (past)`;
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

/**
 * "Doing now", in two stages. **On deck**: everything pinned, starred-and-pinned or Critical,
 * grouped by site so you can see what's waiting where. **Action list**: what you've decided to do,
 * in the order you'll do it (drag or ▲▼ to reorder). Click any item for its side panel — the full
 * note from its site, your plan, and anything in the way / that has to happen first.
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
  const { lanes, pins } = usePriorityPins();
  const { levels, levelOf, cycle, isCritical, toggleCritical } = useFeaturedLevels();
  const [query, setQuery] = useState('');
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);

  const catalog = useMemo(() => buildCatalog(snapshots), [snapshots]);
  const criticals = useMemo(() => criticalKeys(levels).map(([s, id]) => pinKey(s, id)), [levels]);

  // Action list: your order. Items that aren't open anywhere any more drop out.
  const plan = useMemo(
    () => pins.filter(k => lanes[k]?.lane === PLAN).map(k => catalog.get(k)).filter((i): i is PriorityItem => Boolean(i)),
    [pins, lanes, catalog],
  );

  // On deck: one group per site; critical first, then red/yellow/green, then pin order.
  const groups = useMemo(() => {
    const inPlan = new Set(plan.map(i => i.key));
    const keys = [...criticals.filter(k => !pins.includes(k)), ...pins.filter(k => lanes[k]?.lane !== PLAN)];
    const bySite = new Map<SourceId, PriorityItem[]>();
    for (const key of keys) {
      const item = catalog.get(key);
      if (!item || inPlan.has(key)) continue;
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
  }, [pins, lanes, plan, criticals, catalog, levelOf, isCritical]);

  const deckCount = groups.reduce((n, g) => n + g.items.length, 0);
  const placed = new Set([...plan.map(i => i.key), ...groups.flatMap(g => g.items.map(i => i.key))]);
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
  const move = (item: PriorityItem, lane: Lane) => placePin(item.key, lane);
  const nudge = (index: number, by: -1 | 1) => {
    const target = plan[index + by];
    if (!target) return;
    // Moving up = land before the one above; moving down = land before the one after next.
    if (by < 0) placePin(plan[index].key, PLAN, target.key);
    else placePin(plan[index].key, PLAN, plan[index + 2]?.key);
  };
  const onDrop = (lane: Lane, before?: string) => (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const key = e.dataTransfer.getData(DRAG_TYPE) || dragging;
    if (key && key !== before) placePin(key, lane, before);
    setDragging(null);
    setOver(null);
  };
  const dragProps = (item: PriorityItem, lane: Lane) => ({
    draggable: true,
    onDragStart: (e: DragEvent) => {
      e.dataTransfer.setData(DRAG_TYPE, item.key);
      e.dataTransfer.effectAllowed = 'move' as const;
      setDragging(item.key);
    },
    onDragEnd: () => {
      setDragging(null);
      setOver(null);
    },
    onDragOver: (e: DragEvent) => {
      if (!dragging) return;
      e.preventDefault();
      setOver(item.key);
    },
    onDrop: onDrop(lane, item.key),
  });

  const rowMain = (item: PriorityItem) => {
    const blocked = openBefore(lanes[item.key]);
    const note = lanes[item.key]?.note;
    return (
      <button type="button" className="plan-open" onClick={() => setOpenKey(item.key)} title="Open details, plan and what's in the way">
        <span className="plan-open-title">
          {item.tag ? <span className={`task-tag tone-${tagTone(item.tag)}`}>{item.tag}</span> : null}
          <strong>{item.title}</strong>
          {lanes[item.key]?.due ? <span className="plan-due-chip">{dueChip(lanes[item.key]!.due!)}</span> : null}
        </span>
        {item.detail || note ? <span className="plan-open-sub">{item.detail || note}</span> : null}
        {blocked ? (
          <span className="plan-blocked">
            Waiting on {blocked} thing{blocked === 1 ? '' : 's'} first
          </span>
        ) : null}
      </button>
    );
  };

  const marks = (item: PriorityItem) => (
    <>
      <LevelDot level={levelOf(item.source, item.id)} title={item.title} onCycle={() => cycle(item.source, item.id)} />
      <CriticalFlag on={isCritical(item.source, item.id)} title={item.title} onToggle={() => toggleCritical(item.source, item.id)} />
    </>
  );

  const openItem = openKey ? catalog.get(openKey) : undefined;
  const openLane: Lane | null = openKey ? (lanes[openKey]?.lane as Lane | null) ?? (criticals.includes(openKey) ? DECK : null) : null;

  return (
    <section className="priority-board workstation glass-panel pb-v2" aria-label="Priority">
      <div className="priority-head">
        <div className="pb-title">
          <p className="section-label">Priority</p>
          <h2>Doing now</h2>
          <p className="pb-summary">
            {plan.length || deckCount
              ? `${plan.length} on your action list · ${deckCount} on deck · click any item for details and your plan`
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
                    placePin(m.key, DECK);
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

      <div className="pb-stages">
        <div className="pb-stage pb-deck">
          <h3 className="pb-stage-label">
            On deck <span>· by site</span>
          </h3>
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
                      {group.items.map(item => (
                        <article
                          key={item.key}
                          className={`plan-item${isCritical(item.source, item.id) ? ' is-critical' : ''}${dragging === item.key ? ' is-dragging' : ''}`}
                          {...dragProps(item, DECK)}
                        >
                          {marks(item)}
                          {rowMain(item)}
                          <button
                            type="button"
                            className="row-action plan-add"
                            onClick={() => move(item, PLAN)}
                            aria-label={`Add ${item.title} to the action list`}
                            title="Add to the action list"
                          >
                            +
                          </button>
                          {onComplete ? (
                            <button type="button" className="row-action" onClick={() => finish(item)} aria-label={`Done: ${item.title}`} title="Done">
                              ✓
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="row-action ghost"
                            aria-label={`Take ${item.title} off the plan`}
                            title="Take off the plan"
                            onClick={() => remove(item)}
                          >
                            ✕
                          </button>
                        </article>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="pb-empty">Nothing waiting. Pin items from any card, or search above.</p>
          )}
        </div>

        <div
          className={`pb-stage pb-plan${dragging && !plan.some(i => i.key === dragging) ? ' is-target' : ''}`}
          onDragOver={e => {
            if (dragging) e.preventDefault();
          }}
          onDrop={onDrop(PLAN)}
        >
          <h3 className="pb-stage-label">
            Action list <span>· in the order you&apos;ll do it</span>
          </h3>
          {plan.length ? (
            <ol className="pb-plan-list">
              {plan.map((item, i) => (
                <li
                  key={item.key}
                  className={`plan-item plan-step src-${item.source}${isCritical(item.source, item.id) ? ' is-critical' : ''}${dragging === item.key ? ' is-dragging' : ''}${over === item.key ? ' is-over' : ''}`}
                  {...dragProps(item, PLAN)}
                >
                  <span className="plan-num" aria-hidden="true">
                    {i + 1}
                  </span>
                  <SiteIcon source={item.source} className="plan-step-icon" />
                  {rowMain(item)}
                  <span className="plan-order">
                    <button type="button" className="row-action ghost" onClick={() => nudge(i, -1)} disabled={i === 0} aria-label={`Move ${item.title} up`} title="Move up">
                      ▲
                    </button>
                    <button
                      type="button"
                      className="row-action ghost"
                      onClick={() => nudge(i, 1)}
                      disabled={i === plan.length - 1}
                      aria-label={`Move ${item.title} down`}
                      title="Move down"
                    >
                      ▼
                    </button>
                  </span>
                  {onComplete ? (
                    <button type="button" className="row-action" onClick={() => finish(item)} aria-label={`Done: ${item.title}`} title="Done">
                      ✓
                    </button>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : (
            <p className="pb-empty">
              Decide what you&apos;re doing: press <b>+</b> on anything on deck (or drag it here), then put them in order.
            </p>
          )}
        </div>
      </div>

      {openItem ? (
        <PriorityPanel
          item={openItem}
          entry={lanes[openItem.key]}
          lane={openLane}
          level={levelOf(openItem.source, openItem.id)}
          critical={isCritical(openItem.source, openItem.id)}
          onCycleLevel={() => cycle(openItem.source, openItem.id)}
          onToggleCritical={() => toggleCritical(openItem.source, openItem.id)}
          onMove={lane => move(openItem, lane)}
          onDone={
            onComplete
              ? () => {
                  finish(openItem);
                  setOpenKey(null);
                }
              : undefined
          }
          onRemove={() => {
            remove(openItem);
            setOpenKey(null);
          }}
          enter={id => {
            setOpenKey(null);
            enter(id);
          }}
          close={() => setOpenKey(null)}
        />
      ) : null}
    </section>
  );
}
