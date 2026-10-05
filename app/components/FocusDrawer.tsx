'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import type { FocusItem, SourceId, SpaceId } from '../../lib/types';
import { sources } from '../../lib/sources';

export function FocusDrawer({
  open,
  close,
  focus,
  setFocus,
  enter,
}: {
  open: boolean;
  close: () => void;
  focus: FocusItem[];
  setFocus: (items: FocusItem[]) => void;
  enter: (id: SpaceId) => void;
}) {
  const [newText, setNewText] = useState('');
  const [space, setSpace] = useState<SourceId>('self');
  const closeRef = useRef<HTMLButtonElement>(null);

  // Behave like a dialog: focus moves in when it opens, Escape closes it.
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  function addFocus(event: FormEvent) {
    event.preventDefault();
    if (!newText.trim()) return;
    setFocus([...focus, { id: Date.now(), text: newText.trim(), space, done: false }]);
    setNewText('');
  }

  return (
    <div className={`drawer-wrap ${open ? 'open' : ''}`} aria-hidden={!open}>
      <button className="drawer-scrim" onClick={close} aria-label="Close daily focus" tabIndex={open ? 0 : -1} />
      <aside className="focus-drawer" role="dialog" aria-modal={open} aria-label="Today's tasks">
        <div className="drawer-head">
          <div>
            <p>Across all sources</p>
            <h2>Today&apos;s tasks</h2>
          </div>
          <button ref={closeRef} onClick={close} aria-label="Close Today's tasks" tabIndex={open ? 0 : -1}>
            ×
          </button>
        </div>
        <p className="drawer-intro">Quick focus list for anything across the Life Hub. Stored in this browser.</p>
        <div className="focus-list">
          {focus.map(item => (
            <div className={`focus-item ${item.done ? 'done' : ''}`} key={item.id}>
              <button
                className="check"
                onClick={() =>
                  setFocus(focus.map(current => (current.id === item.id ? { ...current, done: !current.done } : current)))
                }
                aria-label={item.done ? 'Mark incomplete' : 'Mark complete'}
              >
                {item.done ? '✓' : ''}
              </button>
              <button
                className="focus-copy"
                onClick={() => {
                  enter(item.space);
                  close();
                }}
              >
                <span>{sources.find(src => src.id === item.space)?.shortName || item.space}</span>
                <strong>{item.text}</strong>
              </button>
            </div>
          ))}
        </div>
        <form className="quick-add" onSubmit={addFocus}>
          <select value={space} onChange={e => setSpace(e.target.value as SourceId)} aria-label="Focus source">
            {sources.map(s => (
              <option key={s.id} value={s.id}>
                {s.shortName}
              </option>
            ))}
          </select>
          <input
            value={newText}
            onChange={event => setNewText(event.target.value)}
            placeholder="Add a task for today…"
            aria-label="New focus item"
          />
          <button type="submit" aria-label="Add task">+</button>
        </form>
      </aside>
    </div>
  );
}
