'use client';

import { useMemo, useState } from 'react';
import type { SourceId, SourceSnapshot } from '../../lib/types';
import type { CompletionLedger } from '../../lib/completions';
import type { Capture } from '../../lib/captures';
import { resolveFocusArea, type FocusAreaConfig } from '../../lib/focusAreas';
import { goalOf, linkGoalIndex, type GoalLink, type GoalsData } from '../../lib/goals';
import { SOURCE_IDS, sourceById } from '../../lib/sources';
import { sourceRuleKey, taskRuleKey, useTaskRules } from '../../lib/taskRules';
import { AreaSelect, GoalSelect } from './SortControls';

type Row = {
  key: string;
  source: SourceId;
  title: string;
  ids: string[];
  open: boolean;
  done: number;
  last?: string;
  /** What the default rules pick */
  autoArea?: string;
};

type Show = 'all' | 'unsorted' | 'open' | 'done';
const PAGE = 120;

function shortDay(iso?: string) {
  return iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
}

/** Every task that exists or has been done, across all sites, with its bucket and goal. */
export function TaskSorting({
  snapshots,
  ledger,
  config,
  goals,
  links,
  captures,
}: {
  snapshots: Record<SourceId, SourceSnapshot>;
  ledger: CompletionLedger;
  config: FocusAreaConfig | null;
  goals: GoalsData | null;
  links: GoalLink[];
  captures: Capture[];
}) {
  const { rules, save } = useTaskRules();
  const [query, setQuery] = useState('');
  const [source, setSource] = useState<SourceId | ''>('');
  const [show, setShow] = useState<Show>('unsorted');
  const [limit, setLimit] = useState(PAGE);
  const areas = config?.areas || [];
  const linkIdx = useMemo(() => linkGoalIndex(links, captures), [links, captures]);

  const rows = useMemo(() => {
    const byKey = new Map<string, Row>();
    const touch = (src: SourceId, id: string, title: string | undefined, extra: { kind?: string; projectId?: string }) => {
      const key = taskRuleKey(src, title, id);
      let row = byKey.get(key);
      if (!row) {
        row = {
          key,
          source: src,
          title: title || id,
          ids: [],
          open: false,
          done: 0,
          autoArea: resolveFocusArea({ source: src, taskId: id, title, ...extra }, config, false),
        };
        byKey.set(key, row);
      }
      if (!row.ids.includes(id)) row.ids.push(id);
      return row;
    };
    for (const src of SOURCE_IDS) {
      const snap = snapshots[src];
      if (!snap) continue;
      for (const t of snap.tasks || []) {
        if (t.status === 'done') continue;
        touch(src, t.id, t.title, { kind: t.kind, projectId: t.projectId }).open = true;
      }
      for (const f of snap.featured || []) touch(src, f.id, f.title, {}).open = true;
    }
    for (const e of Object.values(ledger.entries)) {
      const row = touch(e.source, e.taskId, e.title, {});
      row.done += 1;
      if (!row.last || e.completedAt > row.last) row.last = e.completedAt;
    }
    return [...byKey.values()];
  }, [snapshots, ledger, config]);

  const view = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .map(r => {
        const own = rules[r.key];
        const wide = rules[sourceRuleKey(r.source)];
        const area = own?.area || wide?.area || '';
        const goal = goalOf(r.source, r.title, r.ids, rules, linkIdx) || '';
        return { ...r, area, goal, unsorted: !(area || r.autoArea) || !goal };
      })
      .filter(
        r =>
          (!source || r.source === source) &&
          (!q || r.title.toLowerCase().includes(q)) &&
          (show === 'all' || (show === 'unsorted' ? r.unsorted : show === 'open' ? r.open : r.done > 0)),
      )
      .sort(
        (a, b) =>
          Number(b.unsorted) - Number(a.unsorted) ||
          Number(b.open) - Number(a.open) ||
          String(b.last || '').localeCompare(String(a.last || '')) ||
          a.title.localeCompare(b.title),
      );
  }, [rows, rules, linkIdx, query, source, show]);

  const unsortedTotal = useMemo(
    () =>
      rows.filter(r => {
        const area = rules[r.key]?.area || rules[sourceRuleKey(r.source)]?.area || r.autoArea;
        return !area || !goalOf(r.source, r.title, r.ids, rules, linkIdx);
      }).length,
    [rows, rules, linkIdx],
  );

  const wide = source ? rules[sourceRuleKey(source)] : undefined;

  return (
    <section className="sorting-page glass-panel" aria-label="Task sorting">
      <div className="sorting-head">
        <div>
          <p className="section-label">Settings</p>
          <h2>Task sorting</h2>
          <p className="review-lede">
            Every task that exists or has been done, across all sites. Pick the bucket it counts toward and the goal it
            works for — it sticks, so the next time that task is done it lands in the same place. Changes also re-sort
            past completions.
          </p>
        </div>
        <p className="sorting-count">
          <strong>{unsortedTotal}</strong> need sorting · {rows.length} tasks
        </p>
      </div>

      <div className="sorting-filters">
        <input
          type="search"
          value={query}
          onChange={e => {
            setQuery(e.target.value);
            setLimit(PAGE);
          }}
          placeholder="Search tasks"
          aria-label="Search tasks"
        />
        <select
          value={source}
          onChange={e => {
            setSource(e.target.value as SourceId | '');
            setLimit(PAGE);
          }}
          aria-label="Site"
        >
          <option value="">All sites</option>
          {SOURCE_IDS.filter(id => rows.some(r => r.source === id)).map(id => (
            <option key={id} value={id}>
              {sourceById[id].shortName}
            </option>
          ))}
        </select>
        <div className="seg" role="group" aria-label="Show">
          {(
            [
              ['unsorted', 'Needs sorting'],
              ['all', 'All'],
              ['open', 'Open'],
              ['done', 'Done'],
            ] as Array<[Show, string]>
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={show === id ? 'active' : ''}
              aria-pressed={show === id}
              onClick={() => {
                setShow(id);
                setLimit(PAGE);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {source ? (
        <div className="sorting-row sorting-default">
          <div className="sorting-task">
            <strong>Every {sourceById[source].shortName} task</strong>
            <span className="sorting-sub">Default for anything from this site you haven&apos;t sorted one by one</span>
          </div>
          <AreaSelect
            areas={areas}
            value={wide?.area || ''}
            onChange={v => save(sourceRuleKey(source), { area: v || null })}
            label={`Bucket for every ${sourceById[source].shortName} task`}
          />
          <GoalSelect
            goals={goals}
            value={wide?.goal || ''}
            onChange={v => save(sourceRuleKey(source), { goal: v || null })}
            label={`Goal for every ${sourceById[source].shortName} task`}
          />
        </div>
      ) : null}

      <div className="sorting-list">
        {view.length === 0 ? (
          <p className="review-empty">{show === 'unsorted' ? 'Everything here is sorted.' : 'No tasks match.'}</p>
        ) : null}
        {view.slice(0, limit).map(r => (
          <div className={`sorting-row${r.unsorted ? ' is-unsorted' : ''}`} key={r.key}>
            <div className="sorting-task">
              <span className="priority-source">{sourceById[r.source]?.shortName || r.source}</span>
              <strong title={r.title}>{r.title}</strong>
              <span className="sorting-sub">
                {[r.open ? 'open' : '', r.done ? `done ${r.done}×${r.last ? ` · last ${shortDay(r.last)}` : ''}` : '']
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </div>
            <AreaSelect
              areas={areas}
              value={rules[r.key]?.area || ''}
              autoArea={rules[sourceRuleKey(r.source)]?.area || r.autoArea}
              onChange={v => save(r.key, { area: v || null })}
              label={`Bucket for ${r.title}`}
            />
            <GoalSelect
              goals={goals}
              value={r.goal}
              onChange={v => save(r.key, { goal: v || null })}
              label={`Goal for ${r.title}`}
            />
          </div>
        ))}
      </div>
      {view.length > limit ? (
        <button type="button" className="task-toggle show-more" onClick={() => setLimit(l => l + PAGE)}>
          Show {Math.min(PAGE, view.length - limit)} more of {view.length - limit}
        </button>
      ) : null}
    </section>
  );
}
