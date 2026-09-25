'use client';

import { useState } from 'react';
import { readSaved, writeSaved, STORAGE_KEYS } from '../../lib/storage';
import type { FeaturedItem, SourceDefinition, SourceSnapshot, TaskItem } from '../../lib/types';
import { isConnectorSource } from '../../lib/connectors';
import { getActionableMetric } from '../../lib/actionable';
import { MetricGrid } from './MetricGrid';
import { FeaturedList } from './FeaturedList';
import { TaskList } from './TaskList';

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

  return (
    <article className={`space-card ${source.id}${source.placeholder ? ' placeholder' : ''}${collapsed ? ' is-collapsed' : ''}`}>
      <div className="card-top">
        <span>{source.number}</span>
        <div className="card-top-right">
          <button
            type="button"
            className="card-collapse"
            aria-expanded={!collapsed}
            aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${source.name}`}
            title={collapsed ? 'Expand' : 'Collapse to header'}
            onClick={toggleCollapsed}
          >
            {collapsed ? '▸' : '▾'}
          </button>
          <span className="marker">{source.marker}</span>
        </div>
      </div>
      <div className="card-copy">
        <p>{source.label}</p>
        {collapsed ? (
          <h2 className="card-title-row">
            {/* Keep the count on the same line as the last word of the name */}
            {source.name.slice(0, source.name.lastIndexOf(' ') + 1)}
            <span className="title-tail">
              {source.name.slice(source.name.lastIndexOf(' ') + 1)}
              <CollapsedCount source={source} snapshot={snapshot} />
            </span>
          </h2>
        ) : (
          <h2 className="card-title-row">
            {source.name}
            {showSync ? <span className="sync-inline">{syncText(snapshot.refreshedAt)}</span> : null}
          </h2>
        )}
        {collapsed ? null : (
          <>
        {links.length ? (
          <div className="related-links">
            {links.map(link => (
              <a key={link.url} href={link.url} target="_blank" rel="noopener noreferrer">
                {link.label}
              </a>
            ))}
            <span className="related-hint">Goals → routines → TickTick</span>
          </div>
        ) : null}
        {source.description ? <p className="description">{source.description}</p> : null}
          </>
        )}
      </div>
      {collapsed ? null : (
        <>
      {extra}
      <MetricGrid sourceId={source.id} snapshot={snapshot} compact />
      <FeaturedList sourceId={source.id} snapshot={snapshot} compact onComplete={onCompleteFeatured} />
      <TaskList
        sourceId={source.id}
        snapshot={snapshot}
        compact
        onComplete={onCompleteTask}
        onStar={onStarTask}
        split={source.id === 'ticktick'}
      />
      <div className="card-actions">
        {source.url ? (
          <button type="button" className="open-button" onClick={onOpen}>
            Open <span>↗</span>
          </button>
        ) : (
          <button type="button" className="open-button muted" disabled>
            {source.placeholder ? 'Placeholder' : 'Hub-native'}
          </button>
        )}
        <button type="button" className="enter-button" onClick={onEnter}>
          {source.action}
          <span>→</span>
        </button>
      </div>
        </>
      )}
    </article>
  );
}

/** The card's blue "to do" number, shown beside the name while the card is collapsed. */
function CollapsedCount({ source, snapshot }: { source: SourceDefinition; snapshot: SourceSnapshot }) {
  const actionable = getActionableMetric(source.id, snapshot);
  if (!Number.isFinite(actionable.value)) return null;
  return (
    <span className="collapsed-count" title={`${actionable.value} ${actionable.label}`}>
      {actionable.value.toLocaleString()}
      <span className="sr-only"> {actionable.label}</span>
    </span>
  );
}
