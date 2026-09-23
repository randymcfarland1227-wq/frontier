'use client';

import type { ReactNode } from 'react';
import type { FeaturedItem, SourceId, SourceSnapshot, SpaceId, TaskItem } from '../../lib/types';
import { sourceById } from '../../lib/sources';
import { updatedLabel } from '../../lib/protocol';
import type { CompletionLedger, CompletionStats, SourceShare } from '../../lib/completions';
import type { FocusAreaConfig } from '../../lib/focusAreas';
import { SourceCard } from './SourceCard';
import { PriorityBoard } from './PriorityBoard';
import { ReviewPanel } from './ReviewPanel';

const SELF_ROW: SourceId[] = ['self'];
const ROW_1: SourceId[] = ['ticktick', 'gmail', 'outlook', 'repair'];
const ROW_2: SourceId[] = ['radall', 'role', 'move'];
const ROW_3: SourceId[] = ['income', 'resale', 'candle'];

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
}: {
  ids: SourceId[];
  label: string;
  snapshots: Record<SourceId, SourceSnapshot>;
  enter: (id: SpaceId) => void;
  openSource: (id: SourceId) => void;
  onCompleteFeatured: (source: SourceId, item: FeaturedItem) => void;
  onCompleteTask: (source: SourceId, task: TaskItem) => void;
  onStarTask: (source: SourceId, task: TaskItem) => void;
  fullWidth?: boolean;
}) {
  return (
    <section className={`source-row ${fullWidth ? 'source-row-self' : ''}`} aria-label={label}>
      <p className="section-label">{label}</p>
      <div
        className={`space-grid ${fullWidth ? 'space-grid-self' : ids.length === 4 ? 'space-grid-4' : 'space-grid-3'}`}
      >
        {ids.map(id => (
          <SourceCard
            key={id}
            source={sourceById[id]}
            snapshot={snapshots[id]}
            onEnter={() => enter(id)}
            onOpen={() => openSource(id)}
            onCompleteFeatured={item => onCompleteFeatured(id, item)}
            onCompleteTask={task => onCompleteTask(id, task)}
            onStarTask={task => onStarTask(id, task)}
          />
        ))}
      </div>
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
  completionShares,
  ledger,
  focusConfig,
  capturesPanel,
}: {
  snapshots: Record<SourceId, SourceSnapshot>;
  enter: (id: SpaceId) => void;
  openSource: (id: SourceId) => void;
  onCompleteFeatured: (source: SourceId, item: FeaturedItem) => void;
  onCompleteTask: (source: SourceId, task: TaskItem) => void;
  onStarTask: (source: SourceId, task: TaskItem) => void;
  completionStats: CompletionStats;
  completionShares: SourceShare[];
  ledger: CompletionLedger;
  focusConfig: FocusAreaConfig | null;
  capturesPanel: ReactNode;
}) {
  const latest =
    Object.values(snapshots)
      .map(item => item.refreshedAt)
      .filter(Boolean)
      .sort()
      .at(-1) || '';

  return (
    <>
      <section className="hero" id="top">
        <div className="hero-kicker">
          <span />
          Eleven origins · one Life Hub
        </div>
        <h1>
          Randy&apos;s
          <br />
          <em>Life Hub.</em>
        </h1>
        <div className="hero-bottom">
          <p>
            Metrics, starred items, and task lists from TickTick, mail, Role Hub, resale, Peculiar Candle,
            ventures, Move OS, repair log, and Self — plus completion review across every site.
          </p>
          <div className="current-intent glass-panel">
            <span>Life Hub status</span>
            <strong>{updatedLabel(latest)}</strong>
          </div>
        </div>
      </section>

      <div className="hub-overview">
        <PriorityBoard
          snapshots={snapshots}
          enter={id => enter(id)}
          onComplete={(source, item) => onCompleteFeatured(source, item)}
        />
        <ReviewPanel stats={completionStats} shares={completionShares} ledger={ledger} focusConfig={focusConfig} />
      </div>

      <SourceRow
        ids={SELF_ROW}
        label="Self"
        snapshots={snapshots}
        enter={enter}
        openSource={openSource}
        onCompleteFeatured={onCompleteFeatured}
        onCompleteTask={onCompleteTask}
        onStarTask={onStarTask}
        fullWidth
      />
      <section className="source-row" aria-label="Ideas and research">
        {capturesPanel}
      </section>
      <SourceRow
        ids={ROW_1}
        label="Daily ops"
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
        snapshots={snapshots}
        enter={enter}
        openSource={openSource}
        onCompleteFeatured={onCompleteFeatured}
        onCompleteTask={onCompleteTask}
        onStarTask={onStarTask}
      />

      <footer className="home-footer">
        <span>Randy&apos;s Life Hub</span>
        <p>Work Room upgrade · 11 sources · completion ledger</p>
        <span>Est. 2026</span>
      </footer>
    </>
  );
}
