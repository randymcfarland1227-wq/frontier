'use client';

import { useEffect, useRef, useState } from 'react';

import type { SourceId, SpaceId } from '../../lib/types';
import { ZoomControl } from './ZoomControl';
import { sources } from '../../lib/sources';

export function Header({
  active,
  enter,
  unfinished,
  openFocus,
  onRefreshConnectors,
  connectorSyncing,
  theme,
  onToggleTheme,
}: {
  active: SpaceId;
  enter: (id: SpaceId) => void;
  unfinished: number;
  openFocus: () => void;
  onRefreshConnectors?: () => void;
  connectorSyncing?: boolean;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
}) {
  return (
    <header className="topbar glass-panel">
      <button className="wordmark" onClick={() => enter('home')} aria-label="Randy's Life Hub home">
        <span className="wordmark-mark">R</span>
        <span>RANDY&apos;S LIFE HUB</span>
      </button>
      <div className="top-nav">
        <SitesMenu active={active} enter={enter} />
        <button
          type="button"
          className={`nav-pill${active === 'why' ? ' active' : ''}`}
          onClick={() => enter(active === 'why' ? 'home' : 'why')}
          title="Why: your goals and the work attached to them"
        >
          <span aria-hidden="true">✦</span> Why
        </button>
      </div>
      <div className="topbar-actions">
        <ZoomControl />
        <button
          className={`mode-button ghost settings-button${active === 'settings' ? ' active' : ''}`}
          type="button"
          onClick={() => enter(active === 'settings' ? 'home' : 'settings')}
          title="Settings · Task sorting"
          aria-label="Settings — task sorting"
          aria-pressed={active === 'settings'}
        >
          ⚙
        </button>
        <button
          className="mode-button ghost"
          type="button"
          onClick={onToggleTheme}
          title="Toggle dark mode"
          aria-label="Toggle dark mode"
        >
          {theme === 'dark' ? 'Light' : 'Dark'}
        </button>
        {onRefreshConnectors ? (
          <button
            className="mode-button ghost refresh-button"
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

/** One "Sites ▾" button instead of a row of every site; opens on hover or tap. */
function SitesMenu({ active, enter }: { active: SpaceId; enter: (id: SpaceId) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = sources.find(s => s.id === active);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const go = (id: SpaceId) => {
    setOpen(false);
    enter(id);
  };

  return (
    <div className="sites-menu" ref={ref} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" className="sites-trigger" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        {current ? (
          <>
            <span className="sites-mark" aria-hidden="true">{current.marker}</span>
            {current.shortName}
          </>
        ) : (
          'Sites'
        )}
        <span aria-hidden="true" className="sites-caret">▾</span>
      </button>
      {open ? (
        <div className="sites-pop glass-panel" role="menu">
          <button type="button" role="menuitem" className={active === 'home' ? 'active' : ''} onClick={() => go('home')}>
            <span className="sites-mark" aria-hidden="true">⌂</span>
            <span>
              <strong>Home</strong>
              <small>Everything at a glance</small>
            </span>
          </button>
          {sources.map(site => (
            <button
              type="button"
              role="menuitem"
              key={site.id}
              className={`src-${site.id}${active === site.id ? ' active' : ''}`}
              onClick={() => go(site.id as SourceId)}
            >
              <span className="sites-mark" aria-hidden="true">{site.marker}</span>
              <span>
                <strong>{site.name}</strong>
                <small>{site.label}</small>
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
