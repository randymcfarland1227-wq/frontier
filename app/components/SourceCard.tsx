'use client';

import { useState } from 'react';
import { readSaved, writeSaved, STORAGE_KEYS } from '../../lib/storage';
import type { FeaturedItem, SourceDefinition, SourceSnapshot, TaskItem } from '../../lib/types';
import { isConnectorSource } from '../../lib/connectors';
import { getActionableMetric } from '../../lib/actionable';
import { metricValue } from '../../lib/protocol';
import { FeaturedList } from './FeaturedList';
import { TaskList } from './TaskList';
import { ShelfList } from './ShelfList';
import { SiteIcon } from './SiteIcon';

/** "● live · 9:12 PM" when fresh, otherwise "synced Sep 25, 4:22 AM". */
function syncText(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (Date.now() - d.getTime() < 20 * 60 * 1000) return `● live · ${time}`;
  return `synced ${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
}

export function SourceCard({
  source,
  snapshot,
  onEnter,
  onOpen,
  onCompleteFeatured,
  onCompleteTask,
  onStarTask,
  extra,
}: {
  source: SourceDefinition;
  snapshot: SourceSnapshot;
  onEnter: () => void;
  onOpen: () => void;
  onCompleteFeatured?: (item: FeaturedItem) => void;
  onCompleteTask?: (task: TaskItem) => void;
  onStarTask?: (task: TaskItem) => void;
  /** Rendered under the header (e.g. Self quick-add) */
  extra?: React.ReactNode;
}) {
  const showSync = isConnectorSource(source.id) && Boolean(snapshot.refreshedAt);
  const [collapsed, setCollapsed] = useState(() =>
    readSaved<string[]>(STORAGE_KEYS.collapsedCards, []).includes(source.id),
  );
  const toggleCollapsed = () => {
    const next = !collapsed;
    const saved = readSaved<string[]>(STORAGE_KEYS.collapsedCards, []).filter(id => id !== source.id);
    writeSaved(STORAGE_KEYS.collapsedCards, next ? [...saved, source.id] : saved);
    setCollapsed(next);
  };
  const links = source.relatedLinks || [];

  const actionable = getActionableMetric(source.id, snapshot);
  const consumed = new Set(actionable.consumes || [actionable.key]);
  // Only stats that have a value — a row of "— applied today" placeholders is noise.
  const stats = source.metrics
    .filter(m => !consumed.has(m.key) && metricValue(snapshot.metrics, m.key) !== '—')
    .slice(0, source.id === 'role' ? 4 : 2);
  const sub = [source.label, showSync ? syncText(snapshot.refreshedAt) : ''].filter(Boolean).join(' · ');

  return (
    <article className={`space-card card-v2 ${source.id}${source.placeholder ? ' placeholder' : ''}${collapsed ? ' is-collapsed' : ''}`}>
      <header className="card-head">
        <button type="button" className="card-icon" onClick={onEnter} title={`Open ${source.name} page`} aria-label={`Open ${source.name} page`}>
          <SiteIcon source={source.id} />
        </button>
        <div className="card-head-main">
          <div className="card-head-line">
            <h2>
              <button type="button" className="card-name" onClick={onEnter} title={source.action}>
                {source.name}
              </button>
            </h2>
            <span className="card-stats">
              <span className="card-stat is-main" title={actionable.label}>
                <b>{Number.isFinite(actionable.value) ? actionable.value.toLocaleString() : '—'}</b>
                <span className="stat-label"> {actionable.label.toLowerCase()}</span>
              </span>
              {stats.map(m => (
                <span key={m.key} className="card-stat" title={m.label}>
                  <b>{metricValue(snapshot.metrics, m.key)}</b> {m.label.toLowerCase()}
                </span>
              ))}
            </span>
          </div>
          <p className="card-sub">
            {sub}
            {links.map(link => (
              <a key={link.url} href={link.url} target="_blank" rel="noopener noreferrer">
                {link.label}
              </a>
            ))}
          </p>
        </div>
        <div className="card-head-actions">
          {source.url ? (
            <button type="button" className="card-mini" onClick={onOpen} title={`Open ${source.shortName} site`} aria-label={`Open ${source.shortName} site`}>
              ↗
            </button>
          ) : null}
          <button
            type="button"
            className="card-mini card-collapse"
            aria-expanded={!collapsed}
            aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${source.name}`}
            title={collapsed ? 'Expand' : 'Collapse to header'}
            onClick={toggleCollapsed}
          >
            {collapsed ? '▸' : '▾'}
          </button>
        </div>
      </header>
      {collapsed ? null : (
        <div className="card-body">
          {/* The Self card's body is the Self tool itself; other cards' extras (Radall's money due) go below the tasks */}
          {source.id === 'self' ? extra : null}
          {extra && source.id === 'self' ? null : (
          <>
          {snapshot.featured.length ? (
            <FeaturedList sourceId={source.id} snapshot={snapshot} compact onComplete={onCompleteFeatured} />
          ) : null}
          <TaskList
            sourceId={source.id}
            snapshot={snapshot}
            compact
            open
            exclude={new Set(snapshot.featured.map(f => f.id))}
            onComplete={onCompleteTask}
            onStar={onStarTask}
            split={source.id === 'ticktick'}
            fill={source.id === 'ticktick'}
          />
          </>
          )}
          {source.id === 'self' ? null : extra}
          <ShelfList snapshot={snapshot} compact />
        </div>
      )}
    </article>
  );
}
