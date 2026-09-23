'use client';

import { useState, type ReactNode } from 'react';
import { readSaved, writeSaved, STORAGE_KEYS } from '../../lib/storage';

/**
 * Wraps a home section so it can fold down to a one-line bar. Remembered per browser in the same
 * list as collapsed source cards (keyed `section:<id>`).
 */
export function Collapsible({
  id,
  label,
  title,
  count,
  countLabel,
  labelHeader = false,
  children,
}: {
  id: string;
  label: string;
  title?: string;
  /** Shown as a blue badge on the collapsed bar */
  count?: number;
  countLabel?: string;
  /** Expanded: show the label as the toggle (for rows of cards) instead of a corner button */
  labelHeader?: boolean;
  children: ReactNode;
}) {
  const key = `section:${id}`;
  const [collapsed, setCollapsed] = useState(() => readSaved<string[]>(STORAGE_KEYS.collapsedCards, []).includes(key));
  const toggle = () => {
    const next = !collapsed;
    const saved = readSaved<string[]>(STORAGE_KEYS.collapsedCards, []).filter(k => k !== key);
    writeSaved(STORAGE_KEYS.collapsedCards, next ? [...saved, key] : saved);
    setCollapsed(next);
  };
  const name = title ? `${label} — ${title}` : label;

  if (collapsed) {
    return (
      <button type="button" className="collapsed-bar glass-panel" aria-expanded={false} aria-label={`Expand ${name}`} onClick={toggle}>
        <span className="collapsed-bar-caret" aria-hidden="true">▸</span>
        <span className="section-label">{label}</span>
        {title ? <span className="collapsed-bar-title">{title}</span> : null}
        {count !== undefined && Number.isFinite(count) ? (
          <span className="collapsed-count" title={countLabel ? `${count} ${countLabel}` : undefined}>
            {count.toLocaleString()}
            {countLabel ? <span className="sr-only"> {countLabel}</span> : null}
          </span>
        ) : null}
      </button>
    );
  }

  if (labelHeader) {
    return (
      <>
        <button type="button" className="section-toggle" aria-expanded aria-label={`Collapse ${name}`} onClick={toggle}>
          <span aria-hidden="true">▾</span>
          <span className="section-label">{label}</span>
        </button>
        {children}
      </>
    );
  }

  return (
    <div className="collapsible">
      <button
        type="button"
        className="card-collapse section-collapse"
        aria-expanded
        aria-label={`Collapse ${name}`}
        title="Collapse"
        onClick={toggle}
      >
        ▾
      </button>
      {children}
    </div>
  );
}
