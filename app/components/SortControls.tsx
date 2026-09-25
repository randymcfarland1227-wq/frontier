'use client';

import type { FocusArea } from '../../lib/focusAreas';
import type { GoalsData } from '../../lib/goals';
import { NO_GOAL } from '../../lib/taskRules';

/** Bucket dropdown. '' = the default rules ("Auto · <what they pick>"). */
export function AreaSelect({
  areas,
  value,
  autoArea,
  onChange,
  label = 'Bucket',
}: {
  areas: FocusArea[];
  value: string;
  /** What the default rules pick when nothing is chosen */
  autoArea?: string;
  onChange: (areaId: string) => void;
  label?: string;
}) {
  const autoName = areas.find(a => a.id === autoArea)?.name;
  return (
    <select className="sort-select" value={value} onChange={e => onChange(e.target.value)} aria-label={label}>
      <option value="">{autoName ? `Auto · ${autoName}` : '— Pick a bucket —'}</option>
      {areas.map(a => (
        <option key={a.id} value={a.id}>
          {a.name}
        </option>
      ))}
    </select>
  );
}

/** Goal dropdown grouped by Goals hub category. '' = not sorted yet; NO_GOAL = no goal on purpose. */
export function GoalSelect({
  goals,
  value,
  onChange,
  label = 'Goal',
}: {
  goals: GoalsData | null;
  value: string;
  onChange: (goalId: string) => void;
  label?: string;
}) {
  const active = (goals?.goals || []).filter(g => g.status === 'active');
  return (
    <select className="sort-select" value={value} onChange={e => onChange(e.target.value)} aria-label={label}>
      <option value="">— Pick a goal —</option>
      <option value={NO_GOAL}>No goal</option>
      {(goals?.categories || []).map(c => {
        const inCat = active.filter(g => g.categoryId === c.id);
        return inCat.length ? (
          <optgroup key={c.id} label={`${c.icon} ${c.label}`}>
            {inCat.map(g => (
              <option key={g.id} value={g.id}>
                {g.title}
              </option>
            ))}
          </optgroup>
        ) : null;
      })}
    </select>
  );
}
