'use client';

import { useEffect, useRef } from 'react';
import { useId, useState } from 'react';
import { DECK, placePin, updatePinDetails, usePriorityPins } from '../../lib/priorityPins';

const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** "Oct 9" (or "Today" / "Tomorrow") for a row's small day chip. */
export function shortDue(due: string): string {
  const today = dayKey(new Date());
  const now = new Date();
  const tomorrow = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  if (due === today) return 'Today';
  if (due === tomorrow) return 'Tomorrow';
  const [y, m, d] = due.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** The day an item was given (its Priority entry), if any. */
export function useDueOf(key: string): string | undefined {
  const { lanes } = usePriorityPins();
  return lanes[key]?.lane ? lanes[key]?.due : undefined;
}

/**
 * The small second line under a row when you press ☆ / Pin / 📅: star (or pin) it, and/or give
 * it a day. A day pins the item to Priority (On deck) and puts it on the calendar.
 */
export function DayMenu({
  itemKey,
  title,
  toggle,
  tag,
  backToSelf,
  onClose,
}: {
  itemKey: string;
  title: string;
  toggle?: { label: string; on: boolean; onClick: () => void };
  /** Task type label ("Items to buy") — typed or picked from suggestions */
  tag?: { value: string; suggestions: string[]; onChange: (tag: string | null) => void };
  /** For a Self task moved here: send it back to the Self card */
  backToSelf?: () => void;
  onClose: () => void;
}) {
  const listId = useId();
  const [tagDraft, setTagDraft] = useState(tag?.value || '');
  const { lanes } = usePriorityPins();
  const due = lanes[itemKey]?.lane ? lanes[itemKey]?.due : undefined;
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('button, input')?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current();
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      // Clicks inside the menu or on the row's own buttons don't close it.
      if (ref.current && t && !ref.current.contains(t) && !t.closest('[data-day-trigger]')) closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, []);

  const setDay = (day?: string) => {
    if (day && !lanes[itemKey]?.lane) placePin(itemKey, DECK);
    updatePinDetails(itemKey, { due: day || undefined });
  };
  const now = new Date();
  const today = dayKey(now);
  const tomorrow = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));

  return (
    <div ref={ref} className="day-menu" role="group" aria-label={`Star or give a day: ${title}`}>
      {toggle ? (
        <button type="button" className={`day-menu-btn${toggle.on ? ' is-on' : ''}`} aria-pressed={toggle.on} onClick={toggle.onClick}>
          {toggle.label}
        </button>
      ) : null}
      <span className="day-menu-label">Day</span>
      <button type="button" className={`day-menu-btn${due === today ? ' is-on' : ''}`} onClick={() => setDay(today)}>
        Today
      </button>
      <button type="button" className={`day-menu-btn${due === tomorrow ? ' is-on' : ''}`} onClick={() => setDay(tomorrow)}>
        Tomorrow
      </button>
      <input type="date" className="day-menu-date" value={due || ''} onChange={e => setDay(e.target.value)} aria-label="Pick a day" />
      {due ? (
        <button type="button" className="day-menu-btn" onClick={() => setDay(undefined)} title="Remove the day">
          No day
        </button>
      ) : null}
      {tag ? (
        <span className="day-menu-tag">
          <span className="day-menu-label">Type</span>
          <input
            className="day-menu-type"
            list={listId}
            value={tagDraft}
            placeholder="e.g. Items to buy"
            onChange={e => setTagDraft(e.target.value)}
            onBlur={() => tagDraft !== tag.value && tag.onChange(tagDraft || null)}
            onKeyDown={e => {
              if (e.key === 'Enter') tag.onChange(tagDraft || null);
            }}
            aria-label="Task type"
          />
          <datalist id={listId}>
            {tag.suggestions.map(t => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </span>
      ) : null}
      {backToSelf ? (
        <button type="button" className="day-menu-btn" onClick={backToSelf} title="Move it back to the Self card">
          ↩ Back to Self
        </button>
      ) : null}
      <button type="button" className="day-menu-close" onClick={onClose} aria-label="Close">
        ✕
      </button>
    </div>
  );
}
