'use client';

import { useMemo, useState } from 'react';
import type { CompletionEntry } from '../../lib/completions';
import type { Capture } from '../../lib/captures';
import type { FocusArea } from '../../lib/focusAreas';
import { goalOf, linkGoalIndex, type GoalLink, type GoalsData } from '../../lib/goals';
import { sourceById } from '../../lib/sources';
import { taskRuleKey, useTaskRules } from '../../lib/taskRules';
import { AreaSelect, GoalSelect } from './SortControls';

const SHOW = 8;

/**
 * Under "Completions across sites": things finished (often on their own site) that have no
 * bucket or goal yet. Picking one saves a rule, so the same task sorts itself next time.
 */
export function NeedsSorting({
  entries,
  areas,
  goals,
  links,
  captures,
  openSorting,
}: {
  entries: CompletionEntry[];
  areas: FocusArea[];
  goals: GoalsData | null;
  links: GoalLink[];
  captures: Capture[];
  openSorting: () => void;
}) {
  const { rules, save } = useTaskRules();
  const [open, setOpen] = useState(true);
  const linkIdx = useMemo(() => linkGoalIndex(links, captures), [links, captures]);

  const pending = useMemo(() => {
    const seen = new Map<string, { entry: CompletionEntry; key: string; area: string; goal: string; n: number }>();
    for (const e of entries) {
      const key = taskRuleKey(e.source, e.title, e.taskId);
      const prev = seen.get(key);
      if (prev) {
        prev.n += 1;
        continue;
      }
      const area = e.focusAreaId || '';
      const goal = goalOf(e.source, e.title, [e.taskId], rules, linkIdx) || '';
      if (area && goal) continue;
      seen.set(key, { entry: e, key, area, goal, n: 1 });
    }
    return [...seen.values()];
  }, [entries, rules, linkIdx]);

  if (!pending.length) return null;

  return (
    <div className="needs-sorting" role="region" aria-label="Completed tasks that need sorting">
      <button type="button" className="needs-sorting-head" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <span className="needs-sorting-dot" aria-hidden="true" />
        <strong>
          {pending.length} completed task{pending.length === 1 ? '' : 's'} need{pending.length === 1 ? 's' : ''} a bucket or goal
        </strong>
        <span className="featured-fold-icon" aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>
      {open ? (
        <>
          <div className="needs-sorting-list">
            {pending.slice(0, SHOW).map(p => (
              <div className="sorting-row" key={p.key}>
                <div className="sorting-task">
                  <span className="priority-source">{sourceById[p.entry.source]?.shortName || p.entry.source}</span>
                  <strong title={p.entry.title}>{p.entry.title || p.entry.taskId}</strong>
                  {p.n > 1 ? <span className="sorting-sub">{p.n}×</span> : null}
                </div>
                <AreaSelect
                  areas={areas}
                  value={p.area}
                  onChange={v => save(p.key, { area: v || null })}
                  label={`Bucket for ${p.entry.title || 'task'}`}
                />
                <GoalSelect
                  goals={goals}
                  value={p.goal}
                  onChange={v => save(p.key, { goal: v || null })}
                  label={`Goal for ${p.entry.title || 'task'}`}
                />
              </div>
            ))}
          </div>
          <p className="needs-sorting-foot">
            Saved as you pick — the same task sorts itself next time.
            {pending.length > SHOW ? ` +${pending.length - SHOW} more. ` : ' '}
            <button type="button" className="link-button" onClick={openSorting}>
              Open Task sorting
            </button>
          </p>
        </>
      ) : null}
    </div>
  );
}
