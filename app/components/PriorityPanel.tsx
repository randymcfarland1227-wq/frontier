'use client';

import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import type { FeaturedItem, SourceId } from '../../lib/types';
import { sourceById } from '../../lib/sources';
import { DECK, PLAN, updatePinDetails, type BeforeStep, type Lane, type LaneEntry } from '../../lib/priorityPins';
import type { Level } from '../../lib/featuredLevels';
import { LevelDot } from './LevelDot';
import { CriticalFlag } from './CriticalFlag';
import { SiteIcon } from './SiteIcon';

export type PriorityItem = FeaturedItem & { source: SourceId; key: string };

/**
 * Side panel for one Priority item: the full note from its site, a link into it, "Before this"
 * (anything in the way / that has to happen first, tick them off), and a free plan note.
 * Saved on the item's priority entry, so it cloud-syncs with the rest of Priority.
 */
export function PriorityPanel({
  item,
  entry,
  lane,
  level,
  critical,
  onCycleLevel,
  onToggleCritical,
  onMove,
  onDone,
  onRemove,
  enter,
  close,
}: {
  item: PriorityItem;
  entry?: LaneEntry;
  lane: Lane | null;
  level: Level | null;
  critical: boolean;
  onCycleLevel: () => void;
  onToggleCritical: () => void;
  onMove: (lane: Lane) => void;
  onDone?: () => void;
  onRemove: () => void;
  enter: (id: SourceId) => void;
  close: () => void;
}) {
  const def = sourceById[item.source];
  const closeRef = useRef<HTMLButtonElement>(null);
  const [note, setNote] = useState(entry?.note || '');
  const [newStep, setNewStep] = useState('');
  const before = entry?.before || [];

  // Behave like a dialog: focus moves in once when it opens, Escape closes it.
  const closeLatest = useRef(close);
  useEffect(() => {
    closeLatest.current = close;
  }, [close]);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeLatest.current();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Save the plan note a moment after typing stops, and on close if a save is still pending.
  const saved = useRef(entry?.note || '');
  const pending = useRef(note);
  useEffect(() => {
    pending.current = note;
    if (note === saved.current) return;
    const t = window.setTimeout(() => {
      saved.current = note;
      updatePinDetails(item.key, { note: note.trim() ? note : undefined });
    }, 500);
    return () => window.clearTimeout(t);
  }, [note, item.key]);
  useEffect(
    () => () => {
      const last = pending.current;
      if (last !== saved.current) updatePinDetails(item.key, { note: last.trim() ? last : undefined });
    },
    [item.key],
  );

  const setBefore = (next: BeforeStep[]) => updatePinDetails(item.key, { before: next.length ? next : undefined });
  const addStep = (e: FormEvent) => {
    e.preventDefault();
    const text = newStep.trim();
    if (!text) return;
    setBefore([...before, { id: `b-${Date.now()}`, text, done: false }]);
    setNewStep('');
  };

  // Rendered at the page shell (keeps the theme colours) so the Priority box's blur effect
  // doesn't trap a fixed-position panel inside it.
  const host = typeof document !== 'undefined' ? document.querySelector('.frontier-shell') || document.body : null;
  if (!host) return null;
  return createPortal(
    <div className="drawer-wrap open plan-panel-wrap">
      <button className="drawer-scrim" onClick={close} aria-label="Close details" />
      <aside
        className="plan-panel"
        style={{ '--card-accent': `var(--c-${item.source})` } as CSSProperties}
        role="dialog" aria-modal="true" aria-labelledby="plan-panel-title">
        <div className="plan-panel-head">
          <button type="button" className="plan-panel-site" onClick={() => enter(item.source)} title={`Open ${def.name} page`}>
            <SiteIcon source={item.source} className="plan-panel-icon" />
            {def.name}
          </button>
          <button ref={closeRef} type="button" className="plan-panel-close" onClick={close} aria-label="Close details">
            ×
          </button>
        </div>

        <h2 id="plan-panel-title">{item.title}</h2>
        <div className="plan-panel-marks">
          <LevelDot level={level} title={item.title} onCycle={onCycleLevel} />
          <CriticalFlag on={critical} title={item.title} onToggle={onToggleCritical} />
          <span className="plan-panel-where">{lane === PLAN ? 'On your action list' : lane === DECK ? 'On deck' : ''}</span>
        </div>
        {item.detail ? <p className="plan-panel-detail">{item.detail}</p> : null}
        {item.originUrl ? (
          <a className="plan-panel-link" href={item.originUrl} target="_blank" rel="noopener noreferrer">
            Open in {def.shortName} ↗
          </a>
        ) : null}

        <section className="plan-panel-sec" aria-labelledby="plan-before">
          <h3 id="plan-before">Before this</h3>
          <p className="plan-panel-hint">Anything in the way, or that has to happen first.</p>
          {before.length ? (
            <ul className="plan-before-list">
              {before.map(step => (
                <li key={step.id} className={step.done ? 'is-done' : ''}>
                  <label>
                    <input
                      type="checkbox"
                      checked={step.done}
                      onChange={() => setBefore(before.map(b => (b.id === step.id ? { ...b, done: !b.done } : b)))}
                    />
                    <span>{step.text}</span>
                  </label>
                  <button
                    type="button"
                    className="row-action ghost"
                    onClick={() => setBefore(before.filter(b => b.id !== step.id))}
                    aria-label={`Remove “${step.text}”`}
                    title="Remove"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <form className="plan-before-add" onSubmit={addStep}>
            <input
              value={newStep}
              onChange={e => setNewStep(e.target.value)}
              placeholder="e.g. Get the account number from Mom"
              aria-label="Add something that has to happen first"
            />
            <button type="submit" className="row-action">
              Add
            </button>
          </form>
        </section>

        <section className="plan-panel-sec">
          <h3>
            <label htmlFor="plan-note">Plan</label>
          </h3>
          <textarea
            id="plan-note"
            value={note}
            onChange={e => setNote(e.target.value)}
            rows={5}
            placeholder="How you'll go about it…"
          />
        </section>

        <div className="plan-panel-actions">
          {lane === PLAN ? (
            <button type="button" className="row-action ghost" onClick={() => onMove(DECK)}>
              ← Back to on deck
            </button>
          ) : (
            <button type="button" className="row-action" onClick={() => onMove(PLAN)}>
              Add to action list →
            </button>
          )}
          {onDone ? (
            <button type="button" className="row-action" onClick={onDone}>
              Done
            </button>
          ) : null}
          <button type="button" className="row-action ghost plan-panel-remove" onClick={onRemove}>
            Take off the plan
          </button>
        </div>
      </aside>
    </div>,
    host,
  );
}
