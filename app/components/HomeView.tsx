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
  extra,
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
  extra?: Partial<Record<SourceId, ReactNode>>;
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
            extra={extra?.[id]}
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
  whyPanel,
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
  whyPanel: ReactNode;
}) {
  const latest =
    Object.values(snapshots)
      .map(item => item.refreshedAt)
      .filter(Boolean)
      .sort()
      .at(-1) || '';

  return (
    <>
      <section className="hero hero-flush" id="top">
        <h1>
          Randy&apos;s <em>Life Hub.</em>
        </h1>
        <p className="hero-status" title="Most recent source refresh">
          {updatedLabel(latest)}
        </p>
      </section>

      {whyPanel ? (
        <section className="source-row" aria-label="Why">
          {whyPanel}
        </section>
      ) : null}

      <section className="source-row" aria-label="Review">
        <ReviewPanel stats={completionStats} shares={completionShares} ledger={ledger} focusConfig={focusConfig} />
      </section>

      <section className="source-row" aria-label="Self — thoughts, ideas, research and tasks">
        {capturesPanel}
      </section>

      <section className="source-row" aria-label="Priority">
        <PriorityBoard
          snapshots={snapshots}
          enter={id => enter(id)}
          onComplete={(source, item) => onCompleteFeatured(source, item)}
        />
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
        <p>11 sources · completion ledger · cloud backup</p>
        <span>Est. 2026</span>
      </footer>
    </>
  );
}
