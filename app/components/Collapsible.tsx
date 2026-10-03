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
  tone = 'default',
  icon,
  summary,
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
  /** Section color family (why, review, self, priority, ops, money, ventures) */
  tone?: string;
  /** Small glyph shown before the label */
  icon?: string;
  /** What fills the collapsed bar: chips / short stats instead of empty space */
  summary?: ReactNode;
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

  const mark = icon ? (
    <span className="sec-icon" aria-hidden="true">
      {icon}
    </span>
  ) : null;

  if (collapsed) {
    return (
      <div className={`sec tone-${tone} is-collapsed`}>
        <button type="button" className="collapsed-bar glass-panel" aria-expanded={false} aria-label={`Expand ${name}`} onClick={toggle}>
          <span className="collapsed-bar-caret" aria-hidden="true">▸</span>
          {mark}
          <span className="section-label">{label}</span>
          {title ? <span className="collapsed-bar-title">{title}</span> : null}
          {summary ? <span className="collapsed-summary">{summary}</span> : null}
          {count !== undefined && Number.isFinite(count) ? (
            <span className="collapsed-count" title={countLabel ? `${count} ${countLabel}` : undefined}>
              {count.toLocaleString()}
              {countLabel ? <span className="sr-only"> {countLabel}</span> : null}
            </span>
          ) : null}
        </button>
      </div>
    );
  }

  if (labelHeader) {
    return (
      <div className={`sec tone-${tone}`}>
        <button type="button" className="section-toggle" aria-expanded aria-label={`Collapse ${name}`} onClick={toggle}>
          <span aria-hidden="true">▾</span>
          {mark}
          <span className="section-label">{label}</span>
          {summary ? <span className="section-toggle-summary">{summary}</span> : null}
        </button>
        {children}
      </div>
    );
  }

  return (
    <div className={`sec tone-${tone}`}>
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
    </div>
  );
}
