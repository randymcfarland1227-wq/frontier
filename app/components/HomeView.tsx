'use client';

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { FeaturedItem, SourceId, SourceSnapshot, SpaceId, TaskItem } from '../../lib/types';
import { sourceById } from '../../lib/sources';
import { updatedLabel } from '../../lib/protocol';
import type { CompletionLedger, CompletionStats, CompletionEntry } from '../../lib/completions';
import type { FocusAreaConfig } from '../../lib/focusAreas';
import type { EnergyWindow } from '../../lib/energy';
import { SourceCard } from './SourceCard';
import { PriorityBoard } from './PriorityBoard';
import { ReviewPanel } from './ReviewPanel';
import { Collapsible } from './Collapsible';
import { getActionableMetric } from '../../lib/actionable';
import { usePriorityPins } from '../../lib/priorityPins';
import { criticalKeys, useFeaturedLevels } from '../../lib/featuredLevels';

const ROW_1: SourceId[] = ['ticktick', 'self', 'gmail', 'outlook', 'repair'];
const ROW_2: SourceId[] = ['radall', 'role', 'move'];
const ROW_3: SourceId[] = ['income', 'resale', 'candle'];

type Col = SourceId[];
const DAILY_LAYOUTS: Array<[Col, Col]> = [
  [['self', 'outlook'], ['gmail', 'repair']],
  [['self', 'repair'], ['gmail', 'outlook']],
  [['self'], ['gmail', 'outlook', 'repair']],
  [['self', 'outlook', 'repair'], ['gmail']],
];
const GAP = 14;

/**
 * Daily ops without padded boxes: no card is stretched. Self and Gmail anchor two columns and
 * Outlook / Repair go wherever the columns come out most even; TickTick is as tall as the taller
 * column (scrolling inside) but never taller than its own list. Re-measures whenever a card changes.
 */
function DailyOps({ card }: { card: (id: SourceId) => ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useState<[Col, Col]>(DAILY_LAYOUTS[0]);
  const [ttHeight, setTtHeight] = useState<number | null>(null);
  // Guard against flip-flopping: only re-arrange for a clear win, and not again for a few seconds.
  const lastSwitch = useRef(0);

  useLayoutEffect(() => {
    const grid = ref.current?.parentElement;
    if (!grid) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const h = (id: SourceId) => (grid.querySelector(`.space-card.${id}`) as HTMLElement | null)?.offsetHeight || 0;
        const colH = (c: Col) => c.reduce((sum, id) => sum + h(id), 0) + GAP * (c.length - 1);
        const diffOf = (layout: [Col, Col]) => Math.abs(colH(layout[0]) - colH(layout[1]));
        let best = cols;
        let bestDiff = diffOf(cols);
        for (const layout of DAILY_LAYOUTS) {
          const diff = diffOf(layout);
          if (diff < bestDiff - 60) {
            best = layout;
            bestDiff = diff;
          }
        }
        const now = Date.now();
        if (best !== cols && now - lastSwitch.current > 4000) {
          lastSwitch.current = now;
          setCols(best);
        } else {
          best = cols;
        }
        const tt = grid.querySelector('.space-card.ticktick') as HTMLElement | null;
        const threeCols = getComputedStyle(grid).gridTemplateColumns.split(' ').length >= 3;
        if (!tt || !threeCols || tt.classList.contains('is-collapsed')) {
          setTtHeight(prev => (prev === null ? prev : null));
          return;
        }
        const head = tt.querySelector('.card-head') as HTMLElement | null;
        const body = tt.querySelector('.card-body') as HTMLElement | null;
        const natural = (head?.offsetHeight || 0) + (body?.scrollHeight || 0) + 8;
        const next = Math.round(Math.min(natural, Math.max(colH(best[0]), colH(best[1]))));
        setTtHeight(prev => (prev !== null && Math.abs(prev - next) < 2 ? prev : next));
      });
    };
    const ro = new ResizeObserver(measure);
    grid.querySelectorAll('.space-card').forEach(el => ro.observe(el));
    window.addEventListener('resize', measure);
    measure();
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
      cancelAnimationFrame(frame);
    };
  }, [cols]);

  return (
    <>
      <div className="daily-tt" ref={ref} style={ttHeight ? { height: ttHeight } : undefined}>
        {card('ticktick')}
      </div>
      <div className="daily-col">{cols[0].map(id => card(id))}</div>
      <div className="daily-col">{cols[1].map(id => card(id))}</div>
    </>
  );
}

/** Pinned + critical counts for the collapsed Priority bar. */
function PrioritySummary() {
  const { pins } = usePriorityPins();
  const { levels } = useFeaturedLevels();
  const critical = criticalKeys(levels).length;
  return (
    <>
      <span className="sum-chip">
        <b>{pins.length}</b> pinned
      </span>
      {critical ? (
        <span className="sum-chip is-critical">
          <b>{critical}</b> critical
        </span>
      ) : null}
    </>
  );
}

/** "TickTick 17 · Gmail 5" — one chip per site in a row, for its section bar. */
function SiteChips({ ids, snapshots }: { ids: SourceId[]; snapshots: Record<SourceId, SourceSnapshot> }) {
  return (
    <>
      {ids.map(id => {
        const n = getActionableMetric(id, snapshots[id]).value || 0;
        return (
          <span key={id} className={`sum-chip site-chip src-${id}${n ? '' : ' is-zero'}`}>
            {sourceById[id].shortName} <b>{n}</b>
          </span>
        );
      })}
    </>
  );
}

function SourceRow({
  ids,
  label,
  snapshots,
  enter,
  openSource,
  onCompleteFeatured,
  onCompleteTask,
  onStarTask,
  fullWidth,
  extra,
  gridClass,
  tone,
  icon,
}: {
  tone?: string;
  icon?: string;
  ids: SourceId[];
  label: string;
  snapshots: Record<SourceId, SourceSnapshot>;
  enter: (id: SpaceId) => void;
  openSource: (id: SourceId) => void;
  onCompleteFeatured: (source: SourceId, item: FeaturedItem) => void;
  onCompleteTask: (source: SourceId, task: TaskItem) => void;
  onStarTask: (source: SourceId, task: TaskItem) => void;
  fullWidth?: boolean;
  extra?: Partial<Record<SourceId, ReactNode>>;
  /** Custom grid (e.g. Daily ops: TickTick wide, Gmail + Outlook stacked) */
  gridClass?: string;
}) {
  const card = (id: SourceId) => (
    <SourceCard
      key={id}
      source={sourceById[id]}
      snapshot={snapshots[id]}
      onEnter={() => enter(id)}
      onOpen={() => openSource(id)}
      onCompleteFeatured={item => onCompleteFeatured(id, item)}
      onCompleteTask={task => onCompleteTask(id, task)}
      onStarTask={task => onStarTask(id, task)}
      extra={extra?.[id]}
    />
  );

  return (
    <section className={`source-row ${fullWidth ? 'source-row-self' : ''}`} aria-label={label}>
      <Collapsible
        id={`row-${ids.join('-')}`}
        label={label}
        labelHeader
        tone={tone}
        icon={icon}
        summary={<SiteChips ids={ids} snapshots={snapshots} />}
        count={ids.reduce((sum, id) => sum + (getActionableMetric(id, snapshots[id]).value || 0), 0)}
        countLabel="to do"
      >
      <div
        className={`space-grid ${gridClass || (fullWidth ? 'space-grid-self' : ids.length === 4 ? 'space-grid-4' : 'space-grid-3')}`}
      >
        {gridClass === 'space-grid-daily' ? (
          <DailyOps card={card} />
        ) : (
          ids.map(card)
        )}
      </div>
      </Collapsible>
    </section>
  );
}

export function HomeView({
  snapshots,
  enter,
  openSource,
  onCompleteFeatured,
  onCompleteTask,
  onStarTask,
  completionStats,
  ledger,
  focusConfig,
  renderBalance,
  renderSorting,
  capturesPanel,
}: {
  snapshots: Record<SourceId, SourceSnapshot>;
  enter: (id: SpaceId) => void;
  openSource: (id: SourceId) => void;
  onCompleteFeatured: (source: SourceId, item: FeaturedItem) => void;
  onCompleteTask: (source: SourceId, task: TaskItem) => void;
  onStarTask: (source: SourceId, task: TaskItem) => void;
  completionStats: CompletionStats;
  ledger: CompletionLedger;
  focusConfig: FocusAreaConfig | null;
  renderBalance?: (period: EnergyWindow) => ReactNode;
  renderSorting?: (entries: CompletionEntry[]) => ReactNode;
  capturesPanel: ReactNode;
}) {
  const latest =
    Object.values(snapshots)
      .map(item => item.refreshedAt)
      .filter(Boolean)
      .sort()
      .at(-1) || '';

  // Open to-dos per site — the same blue numbers each card shows.
  const openBySite = [...ROW_1, ...ROW_2, ...ROW_3]
    .map(id => ({ id, name: sourceById[id].shortName, count: getActionableMetric(id, snapshots[id]).value || 0 }))
    .filter(site => site.count > 0)
    .sort((a, b) => b.count - a.count);
  const openTotal = openBySite.reduce((sum, site) => sum + site.count, 0);

  return (
    <>
      <section className="hero hero-flush" id="top">
        <div className="hero-title-row">
          <h1>
            Randy&apos;s <em>Life Hub.</em>
          </h1>
          <div className="hero-counts" aria-live="polite">
            <div className="hero-stats">
              <div className="hero-stat stat-done" title="Real completions recorded today, across every site">
                <strong>{completionStats.today}</strong>
                <span>done today</span>
              </div>
              <div className="hero-stat stat-open" title="Open to-dos across every site (each card's blue number)">
                <strong>{openTotal}</strong>
                <span>
                  open · {openBySite.length} {openBySite.length === 1 ? 'site' : 'sites'}
                </span>
              </div>
            </div>
            {openBySite.length ? (
              <div className="hero-count-sites">
                {openBySite.map(site => (
                  <button key={site.id} type="button" onClick={() => enter(site.id)} title={`Open ${site.name}`}>
                    {site.name} <b>{site.count}</b>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
        <p className="hero-status" title="Most recent source refresh">
          {updatedLabel(latest)}
        </p>
      </section>


      <section className="source-row" aria-label="Review">
        <Collapsible
          id="review"
          label="Review"
          title="Completions across sites"
          tone="review"
          icon="✓"
          summary={
            <>
              <span className="sum-chip">
                <b>{completionStats.today}</b> today
              </span>
              <span className="sum-chip">
                <b>{completionStats.last7}</b> past 7 days
              </span>
              <span className="sum-chip">
                <b>{completionStats.month}</b> this month
              </span>
              <span className="sum-chip">
                <b>{openTotal}</b> open
              </span>
            </>
          }
        >
          <ReviewPanel
            stats={completionStats}
            ledger={ledger}
            focusConfig={focusConfig}
            renderBalance={renderBalance}
            renderSorting={renderSorting}
          />
        </Collapsible>
      </section>


      <section className="source-row" aria-label="Priority">
        <Collapsible id="priority" label="Priority" title="Doing now" tone="priority" icon="◎" summary={<PrioritySummary />}>
          <PriorityBoard
            snapshots={snapshots}
            enter={id => enter(id)}
            onComplete={(source, item) => onCompleteFeatured(source, item)}
          />
        </Collapsible>
      </section>

      <SourceRow
        ids={ROW_1}
        extra={{ self: capturesPanel }}
        label="Daily ops"
        tone="ops"
        icon="◐"
        gridClass="space-grid-daily"
        snapshots={snapshots}
        enter={enter}
        openSource={openSource}
        onCompleteFeatured={onCompleteFeatured}
        onCompleteTask={onCompleteTask}
        onStarTask={onStarTask}
      />
      <SourceRow
        ids={ROW_2}
        label="Money · role · move"
        tone="money"
        icon="◆"
        snapshots={snapshots}
        enter={enter}
        openSource={openSource}
        onCompleteFeatured={onCompleteFeatured}
        onCompleteTask={onCompleteTask}
        onStarTask={onStarTask}
      />
      <SourceRow
        ids={ROW_3}
        label="Ventures"
        tone="ventures"
        icon="▲"
        snapshots={snapshots}
        enter={enter}
        openSource={openSource}
        onCompleteFeatured={onCompleteFeatured}
        onCompleteTask={onCompleteTask}
        onStarTask={onStarTask}
      />

      <footer className="home-footer">
        <span>Randy&apos;s Life Hub</span>
        <p>11 sources · completion ledger · cloud backup</p>
        <span>Est. 2026</span>
      </footer>
    </>
  );
}
