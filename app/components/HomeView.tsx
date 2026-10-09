'use client';

import type { ReactNode } from 'react';
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
import { addDays, billDues, eventStart, onDay, paidBillKeys, type BillDue, type CalTask, type ScheduleSnapshot } from '../../lib/schedule';
import { applyBillEdits, isOverdue, useBillEdits } from '../../lib/billEdits';
import { usePlans } from '../../lib/plans';
import { ScheduleSection } from './ScheduleSection';
import { BillsList } from './BillsList';
import { TickTickRings } from './TickTickRings';

const ROW_1: SourceId[] = ['ticktick', 'radall', 'self', 'gmail', 'outlook', 'repair'];
const ROW_2: SourceId[] = ['role', 'move'];
const ROW_3: SourceId[] = ['income', 'resale', 'candle'];

/**
 * Daily ops: TickTick (wide, its own fixed height, tasks | habits side by side) with Radall
 * Finances under it; Self over Gmail; Outlook over Repair. Every card sizes itself — opening
 * one never resizes another.
 */
function DailyOps({ card }: { card: (id: SourceId) => ReactNode }) {
  return (
    <>
      <div className="daily-col daily-main">
        {card('ticktick')}
        {card('radall')}
      </div>
      <div className="daily-col">
        {card('self')}
        {card('gmail')}
      </div>
      <div className="daily-col">
        {card('outlook')}
        {card('repair')}
      </div>
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

/** Collapsed Schedule bar: today's events, maybes waiting on an answer, bills due within 3 days. */
function ScheduleSummary({ schedule, bills }: { schedule: ScheduleSnapshot | null; bills: BillDue[] }) {
  const { plans } = usePlans();
  const today = new Date();
  const events = schedule?.events || [];
  const todayCount = events.filter(e => (e.myStatus === 'owner' || e.myStatus === 'yes') && onDay(e, today)).length;
  const maybes =
    plans.filter(p => p.status === 'open').length +
    events.filter(e => (e.myStatus === 'invited' || e.myStatus === 'maybe') && eventStart(e) >= addDays(today, -1)).length;
  const soon = bills.filter(b => b.days <= 3 && !(b.bill.kind && b.days < 0)).length;
  return (
    <>
      <span className="sum-chip">
        <b>{todayCount}</b> today
      </span>
      {maybes ? (
        <span className="sum-chip">
          <b>{maybes}</b> not confirmed
        </span>
      ) : null}
      {soon ? (
        <span className="sum-chip is-critical">
          <b>{soon}</b> {soon === 1 ? 'payment' : 'payments'} due soon
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
  schedule,
  moneyDues,
  onBillPaid,
  calTasks,
  onTaskDone,
  onAddPrep,
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
  schedule: ScheduleSnapshot | null;
  /** Money from the Radall sheet + planned payments (already minus what's marked paid) */
  moneyDues: BillDue[];
  onBillPaid: (due: BillDue) => void;
  calTasks: CalTask[];
  onTaskDone: (t: CalTask) => void;
  onAddPrep: (target: { id: string; title: string; date: string }, title: string, due?: string) => void;
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
  // Bills: next unpaid due date per bill (paid on Life Hub = a Radall completion in the ledger).
  // Plus the Radall sheet's money items (bills, card mins, subscriptions, pay later) — calendar only, never tasks.
  const paidKeys = paidBillKeys(ledger);
  const billEdits = useBillEdits();
  // Bills tab: each bill's next due still owed (an unpaid past one first), after Life Hub changes.
  const tabBills = (schedule?.bills || []).map(b => applyBillEdits(billDues(b, paidKeys), billEdits)[0]).filter((d): d is BillDue => Boolean(d));
  const bills = [...tabBills, ...moneyDues].sort((a, b) => a.due.localeCompare(b.due));
  const overdueBills = bills.filter(isOverdue);
  // Paid from anywhere a bill shows up as a Priority item ("Doing now").
  const payFromPriority = (source: SourceId, item: FeaturedItem) => {
    const due = bills.find(b => b.key === item.id);
    if (source === 'radall' && due) onBillPaid(due);
    else onCompleteFeatured(source, item);
  };
  const financeBills = (
    <div className="card-bills">
      <p className="card-bills-label">
        Money due · next 3 weeks
        <button type="button" className="card-bills-open" onClick={() => enter('money')}>
          Money page →
        </button>
      </p>
      <BillsList dues={bills.filter(b => b.days >= 0 && b.days <= 21)} onPaid={onBillPaid} limit={4} empty="Nothing due in the next 3 weeks." />
      {overdueBills.length ? (
        <div className="card-bills-overdue">
          <p className="card-bills-label">Overdue · not marked paid</p>
          <BillsList dues={overdueBills} onPaid={onBillPaid} />
        </div>
      ) : null}
    </div>
  );
  // TickTick split: tasks (the card's "to do") over habits still to check in today.
  const tt = snapshots.ticktick;
  const ticktickTasks = getActionableMetric('ticktick', tt).value || 0;
  const ticktickHabits = Number(tt?.metrics?.habits) || 0;

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
              <button
                type="button"
                className="hero-stat stat-ticktick has-rings"
                onClick={() => enter('ticktick')}
                title="TickTick today: how much is logged (done or won't do) — opens TickTick's page"
              >
                <TickTickRings ledger={ledger} openTasks={ticktickTasks} openHabits={ticktickHabits} />
              </button>
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


      <section className="source-row" aria-label="Schedule">
        <Collapsible id="schedule" label="Schedule" title="Calendar" tone="schedule" icon="▦" summary={<ScheduleSummary schedule={schedule} bills={bills} />}>
          <ScheduleSection schedule={schedule} bills={bills} onBillPaid={onBillPaid} tasks={calTasks} onTaskDone={onTaskDone} onAddPrep={onAddPrep} />
        </Collapsible>
      </section>

      <section className="source-row" aria-label="Priority">
        <Collapsible id="priority" label="Priority" title="Doing now" tone="priority" icon="◎" summary={<PrioritySummary />}>
          <PriorityBoard
            snapshots={snapshots}
            enter={id => enter(id)}
            onComplete={payFromPriority}
            bills={bills.filter(b => !b.skipped)}
          />
        </Collapsible>
      </section>

      <SourceRow
        ids={ROW_1}
        extra={{ self: capturesPanel, radall: bills.length ? financeBills : undefined }}
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
        label="Role · move"
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

      <section className="source-row" aria-label="Review">
        <Collapsible
          id="review"
          label="Review"
          title="Completions across sites"
          tone="review"
          icon="✓"
          summary={
            <span className="sum-chip is-done" title="Completed today across all sites">
              <b>{completionStats.today}</b> done today
            </span>
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

      <footer className="home-footer">
        <span>Randy&apos;s Life Hub</span>
        <p>11 sources · completion ledger · cloud backup</p>
        <span>Est. 2026</span>
      </footer>
    </>
  );
}
