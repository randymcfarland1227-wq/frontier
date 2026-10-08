'use client';

import { useMemo, useState, type DragEvent } from 'react';
import { tagTone } from '../../lib/tagTone';
import type { FeaturedItem, SourceId, SourceSnapshot } from '../../lib/types';
import { SOURCE_IDS, sourceById } from '../../lib/sources';
import { DECK, PLAN, openBefore, pinKey, placePin, unpin, usePriorityPins, type Lane } from '../../lib/priorityPins';
import { byLevel, criticalKeys, useFeaturedLevels } from '../../lib/featuredLevels';
import { SiteIcon } from './SiteIcon';
import { PriorityPanel, type PriorityItem } from './PriorityPanel';
import { DayMenu } from './DayMenu';

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
  // Row whose 📅 day line is open
  const [dayFor, setDayFor] = useState<string | null>(null);

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

  const levelClass = (item: PriorityItem) => {
    const lv = levelOf(item.source, item.id);
    return `${lv ? ` lv-${lv}` : ''}${isCritical(item.source, item.id) ? ' is-critical' : ''}`;
  };

  /** Title button (opens the side panel) + the small chips that matter: due day, waiting, note. */
  const rowTitle = (item: PriorityItem) => {
    const entry = lanes[item.key];
    const blocked = openBefore(entry);
    const critical = isCritical(item.source, item.id);
    const hasSub = Boolean(item.tag || critical || entry?.due || blocked || entry?.note);
    return (
      <>
        <button
          type="button"
          className="pv-title"
          onClick={() => setOpenKey(item.key)}
          title={[item.title, item.detail, entry?.note].filter(Boolean).join(' — ')}
        >
          <span className="pv-text">{item.title}</span>
        </button>
        {/* Type, date and status sit together on one small line under the name */}
        {hasSub ? (
          <span className="pv-sub">
            {item.tag ? <span className={`task-tag tone-${tagTone(item.tag)}`} title={item.tag}>{item.tag}</span> : null}
            {critical ? <span className="pv-chip is-crit">Critical</span> : null}
            {entry?.due ? <span className="pv-chip">{dueChip(entry.due)}</span> : null}
            {blocked ? (
              <span className="pv-chip is-wait" title={`Waiting on ${blocked} thing${blocked === 1 ? '' : 's'} first`}>
                Waiting · {blocked}
              </span>
            ) : null}
            {entry?.note ? (
              <span className="pv-chip is-note" title={entry.note} aria-label="Has a plan note">
                ✎
              </span>
            ) : null}
          </span>
        ) : null}
      </>
    );
  };

  const check = (item: PriorityItem) =>
    onComplete ? (
      <button type="button" className="pv-check" onClick={() => finish(item)} aria-label={`Done: ${item.title}`} title="Mark done" />
    ) : null;

  const openItem = openKey ? catalog.get(openKey) : undefined;
  const openLane: Lane | null = openKey ? (lanes[openKey]?.lane as Lane | null) ?? (criticals.includes(openKey) ? DECK : null) : null;

  return (
    <section className="priority-board workstation glass-panel pb-v3" aria-label="Priority">
      <div className="pv-head">
        <h2 className="pv-heading">Doing now</h2>
        <p className="pv-counts">
          <b>{plan.length}</b> on your list · <b>{deckCount}</b> on deck
        </p>
        <div className="ws-add pv-search">
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
                  <strong>{m.title}</strong>
                  {m.tag ? <span className={`task-tag tone-${tagTone(m.tag)}`} title={m.tag}>{m.tag}</span> : null}
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

      <div className="pv-cols">
        <div
          className={`pv-col pv-plan${dragging && !plan.some(i => i.key === dragging) ? ' is-target' : ''}`}
          onDragOver={e => {
            if (dragging) e.preventDefault();
          }}
          onDrop={onDrop(PLAN)}
        >
          <h3 className="pv-col-head">
            Action list <span>in the order you&apos;ll do it</span>
          </h3>
          {plan.length ? (
            <ol className="pv-list">
              {plan.map((item, i) => (
                <li
                  key={item.key}
                  className={`pv-row src-${item.source}${levelClass(item)}${dragging === item.key ? ' is-dragging' : ''}${over === item.key ? ' is-over' : ''}`}
                  {...dragProps(item, PLAN)}
                >
                  <span className="pv-num" aria-hidden="true">
                    {i + 1}
                  </span>
                  {check(item)}
                  <SiteIcon source={item.source} className="pv-site" />
                  {rowTitle(item)}
                  <span className="pv-tools">
                    <button
                    type="button"
                    className={`pv-tool pv-cal${lanes[item.key]?.due ? ' is-set' : ''}`}
                    data-day-trigger
                    onClick={() => setDayFor(d => (d === item.key ? null : item.key))}
                    aria-expanded={dayFor === item.key}
                    aria-label={`Give ${item.title} a day`}
                    title="Give it a day (shows on the calendar)"
                    >
                    📅
                    </button>
                    <button type="button" className="pv-tool" onClick={() => nudge(i, -1)} disabled={i === 0} aria-label={`Move ${item.title} up`} title="Move up">
                      ▲
                    </button>
                    <button
                      type="button"
                      className="pv-tool"
                      onClick={() => nudge(i, 1)}
                      disabled={i === plan.length - 1}
                      aria-label={`Move ${item.title} down`}
                      title="Move down"
                    >
                      ▼
                    </button>
                    <button type="button" className="pv-tool" onClick={() => move(item, DECK)} aria-label={`Put ${item.title} back on deck`} title="Back on deck">
                      ↩
                    </button>
                  </span>
                  {dayFor === item.key ? <DayMenu itemKey={item.key} title={item.title} onClose={() => setDayFor(null)} /> : null}
                </li>
              ))}
            </ol>
          ) : (
            <p className="pv-empty">Nothing on your list yet. Press + List on anything on deck, or drag it here.</p>
          )}
        </div>

        <div className="pv-col pv-deck">
          <h3 className="pv-col-head">
            On deck <span>by site · + List moves it over</span>
          </h3>
          {groups.length ? (
            // A grid of site boxes that grows with the number of sites: 2 → 2×1, 3 → 3×1, 4+ → 3 across.
            <div className="pv-groups" style={{ '--cols': Math.min(groups.length, 3) } as React.CSSProperties}>
              {groups.map(group => {
                const def = sourceById[group.source];
                return (
                  <section key={group.source} className={`pv-group src-${group.source}`} aria-label={def.name}>
                    <button type="button" className="pv-group-head" onClick={() => enter(group.source)} title={`Open ${def.name} page`}>
                      <SiteIcon source={group.source} className="pv-site" />
                      <span>{def.name}</span>
                      <b>{group.items.length}</b>
                    </button>
                    <ul className="pv-list">
                      {group.items.map(item => (
                        <li key={item.key} className={`pv-row${levelClass(item)}${dragging === item.key ? ' is-dragging' : ''}`} {...dragProps(item, DECK)}>
                          {check(item)}
                          {rowTitle(item)}
                          <span className="pv-tools">
                            <button
                              type="button"
                              className={`pv-tool pv-cal${lanes[item.key]?.due ? ' is-set' : ''}`}
                              data-day-trigger
                              onClick={() => setDayFor(d => (d === item.key ? null : item.key))}
                              aria-expanded={dayFor === item.key}
                              aria-label={`Give ${item.title} a day`}
                              title="Give it a day (shows on the calendar)"
                            >
                              📅
                            </button>
                            <button
                              type="button"
                              className="pv-tool pv-add"
                              onClick={() => move(item, PLAN)}
                              aria-label={`Add ${item.title} to the action list`}
                              title="Add to the action list"
                            >
                              + List
                            </button>
                            <button type="button" className="pv-tool" aria-label={`Take ${item.title} off the plan`} title="Take off the plan" onClick={() => remove(item)}>
                              ✕
                            </button>
                          </span>
                          {dayFor === item.key ? <DayMenu itemKey={item.key} title={item.title} onClose={() => setDayFor(null)} /> : null}
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          ) : (
            <p className="pv-empty">Nothing waiting. Pin items from any card, or search above.</p>
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
