'use client';

import type { SourceId, SourceSnapshot, SpaceId } from '../../lib/types';
import { sourceById } from '../../lib/sources';
import { updatedLabel } from '../../lib/protocol';
import type { CompletionStats, SourceShare } from '../../lib/completions';
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
  fullWidth,
}: {
  ids: SourceId[];
  label: string;
  snapshots: Record<SourceId, SourceSnapshot>;
  enter: (id: SpaceId) => void;
  openSource: (id: SourceId) => void;
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
  completionStats,
  completionShares,
}: {
  snapshots: Record<SourceId, SourceSnapshot>;
  enter: (id: SpaceId) => void;
  openSource: (id: SourceId) => void;
  completionStats: CompletionStats;
  completionShares: SourceShare[];
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
        <PriorityBoard snapshots={snapshots} enter={id => enter(id)} />
        <ReviewPanel stats={completionStats} shares={completionShares} />
      </div>

      <SourceRow ids={SELF_ROW} label="Self" snapshots={snapshots} enter={enter} openSource={openSource} fullWidth />
      <SourceRow ids={ROW_1} label="Daily ops" snapshots={snapshots} enter={enter} openSource={openSource} />
      <SourceRow ids={ROW_2} label="Money · role · move" snapshots={snapshots} enter={enter} openSource={openSource} />
      <SourceRow ids={ROW_3} label="Ventures" snapshots={snapshots} enter={enter} openSource={openSource} />

      <footer className="home-footer">
        <span>Randy&apos;s Life Hub</span>
        <p>Work Room upgrade · 11 sources · completion ledger</p>
        <span>Est. 2026</span>
      </footer>
    </>
  );
}
