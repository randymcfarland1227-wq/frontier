'use client';

import { useEffect } from 'react';
import type { FocusArea } from '../../lib/focusAreas';

/** "Which area does this count toward?" — shown when completing mail, where one bucket doesn't fit all. */
export function AreaPicker({
  title,
  sourceName,
  areas,
  suggested,
  onPick,
  onCancel,
}: {
  title: string;
  sourceName: string;
  areas: FocusArea[];
  suggested?: string;
  onPick: (areaId: string) => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="area-picker-backdrop" onClick={onCancel}>
      <div className="area-picker glass-panel" role="dialog" aria-modal="true" aria-label="Choose an area" onClick={e => e.stopPropagation()}>
        <p className="section-label">Mark done · {sourceName}</p>
        <h3>{title || 'This item'}</h3>
        <p className="review-lede">Which area does this count toward?</p>
        <div className="area-picker-grid">
          {areas.map(a => (
            <button
              key={a.id}
              type="button"
              className={`area-choice${a.id === suggested ? ' suggested' : ''}`}
              onClick={() => onPick(a.id)}
              autoFocus={a.id === suggested}
            >
              {a.name}
            </button>
          ))}
        </div>
        <button type="button" className="row-action ghost area-cancel" onClick={onCancel}>
          Cancel — keep it open
        </button>
      </div>
    </div>
  );
}
