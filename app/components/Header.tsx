'use client';

import type { SourceId, SpaceId } from '../../lib/types';
import { sources } from '../../lib/sources';

export function Header({
  active,
  enter,
  unfinished,
  openFocus,
  onRefreshConnectors,
  connectorSyncing,
}: {
  active: SpaceId;
  enter: (id: SpaceId) => void;
  unfinished: number;
  openFocus: () => void;
  onRefreshConnectors?: () => void;
  connectorSyncing?: boolean;
}) {
  return (
    <header className="topbar">
      <button className="wordmark" onClick={() => enter('home')} aria-label="Randy's Life Hub home">
        <span className="wordmark-mark">R</span>
        <span>RANDY&apos;S LIFE HUB</span>
      </button>
      <nav className="room-nav" aria-label="Sources">
        {sources.map(space => (
          <button
            className={active === space.id ? 'active' : ''}
            key={space.id}
            onClick={() => enter(space.id as SourceId)}
            title={space.name}
          >
            {space.shortName}
          </button>
        ))}
      </nav>
      <div className="topbar-actions">
        {onRefreshConnectors ? (
          <button
            className="mode-button ghost"
            type="button"
            onClick={onRefreshConnectors}
            disabled={connectorSyncing}
            title="Reload connector JSON from this site"
          >
            {connectorSyncing ? 'Syncing…' : 'Refresh'}
          </button>
        ) : null}
        <button className="mode-button" type="button" onClick={openFocus}>
          Today <span>{String(unfinished).padStart(2, '0')}</span>
        </button>
      </div>
    </header>
  );
}
