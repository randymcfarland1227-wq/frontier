'use client';

import type { SourceId, SourceSnapshot, SpaceId } from '../../lib/types';
import { sources } from '../../lib/sources';
import { updatedLabel } from '../../lib/protocol';
import { SourceCard } from './SourceCard';

export function HomeView({
  snapshots,
  enter,
  openSource,
}: {
  snapshots: Record<SourceId, SourceSnapshot>;
  enter: (id: SpaceId) => void;
  openSource: (id: SourceId) => void;
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
            Metrics, starred items, and full task lists from TickTick, finances, mail, Role Hub, resale,
            ventures, Move OS, repair log, and your Self inbox — with Candle held as a placeholder.
          </p>
          <div className="current-intent">
            <span>Life Hub status</span>
            <strong>{updatedLabel(latest)}</strong>
          </div>
        </div>
      </section>
      <section className="space-grid" aria-label="Your eleven life sources">
        {sources.map(source => (
          <SourceCard
            key={source.id}
            source={source}
            snapshot={snapshots[source.id]}
            onEnter={() => enter(source.id)}
            onOpen={() => openSource(source.id)}
          />
        ))}
      </section>
      <footer className="home-footer">
        <span>Randy&apos;s Life Hub</span>
        <p>Work Room upgrade · 11 sources</p>
        <span>Est. 2026</span>
      </footer>
    </>
  );
}
