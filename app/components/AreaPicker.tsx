'use client';

import { useEffect, useState } from 'react';
import type { FocusArea } from '../../lib/focusAreas';
import type { GoalsData } from '../../lib/goals';
import { GoalSelect } from './SortControls';

export type SortChoice = { area: string; goal: string; wholeSource: boolean };

/**
 * "What is this for?" — shown when marking something done that has no bucket or goal yet.
 * The answer is remembered for this task (or every task from the site), so it only asks once.
 */
export function AreaPicker({
  title,
  sourceName,
  areas,
  goals,
  suggested,
  initialGoal,
  onPick,
  onCancel,
}: {
  title: string;
  sourceName: string;
  areas: FocusArea[];
  goals: GoalsData | null;
  /** Bucket to preselect (current or default rules) */
  suggested?: string;
  initialGoal?: string;
  onPick: (choice: SortChoice) => void;
  onCancel: () => void;
}) {
  const [area, setArea] = useState(suggested || '');
  const [goal, setGoal] = useState(initialGoal || '');
  const [wholeSource, setWholeSource] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="area-picker-backdrop" onClick={onCancel}>
      <div className="area-picker glass-panel" role="dialog" aria-modal="true" aria-label="Sort this task" onClick={e => e.stopPropagation()}>
        <p className="section-label">Mark done · {sourceName}</p>
        <h3>{title || 'This item'}</h3>
        <p className="review-lede">Which bucket does this count toward?</p>
        <div className="area-picker-grid">
          {areas.map(a => (
            <button
              key={a.id}
              type="button"
              className={`area-choice${a.id === area ? ' suggested' : ''}`}
              aria-pressed={a.id === area}
              onClick={() => setArea(a.id)}
            >
              {a.name}
            </button>
          ))}
        </div>
        <p className="review-lede area-picker-goal-label">Which goal does it work toward?</p>
        <GoalSelect goals={goals} value={goal} onChange={setGoal} />
        <label className="area-picker-scope">
          <input type="checkbox" checked={wholeSource} onChange={e => setWholeSource(e.target.checked)} />
          Use this for every {sourceName} task
        </label>
        <p className="area-picker-note">Remembered — next time this task is done it&apos;s sorted automatically.</p>
        <div className="area-picker-actions">
          <button
            type="button"
            className="row-action"
            disabled={!area || !goal}
            onClick={() => onPick({ area, goal, wholeSource })}
          >
            Mark done
          </button>
          <button type="button" className="row-action ghost" onClick={onCancel}>
            Cancel — keep it open
          </button>
        </div>
      </div>
    </div>
  );
}
