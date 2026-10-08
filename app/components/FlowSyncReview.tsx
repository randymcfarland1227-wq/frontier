'use client';
import { useState } from 'react';
import map from '../../public/data/flow-map.json';
import { readSaved, STORAGE_KEYS, LOCAL_WRITE_EVENT } from '../../lib/storage';
import { syncKeyHeader, SYNCED_EVENT } from '../../lib/cloudSync';
import { migrateSorting, sortingKey, type SortingChange, type SortingState } from '../../lib/flowMigration';
import { sourceById } from '../../lib/sources';
import type { SourceId } from '../../lib/types';
import { TASK_RULES_EVENT } from '../../lib/taskRules';

function readSorting(): SortingState {
  return { rules: readSaved(STORAGE_KEYS.taskRules, {}), completions: readSaved(STORAGE_KEYS.completions, { entries: {} }) };
}
function download(name: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const WORKER = (import.meta.env.VITE_WORKER_URL || 'https://frontier-work-room.randymcfarland1227.workers.dev').replace(/\/$/, '');

export function FlowSyncReview() {
  const [review, setReview] = useState<SortingState | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  // Everything else in the history: chosen bucket / goal per task key (only rows you change apply)
  const [picks, setPicks] = useState<Record<string, { area?: string; goal?: string }>>({});
  const [histFilter, setHistFilter] = useState<'review' | 'all'>('review');
  const rows = map.records.map(t => {
    const key = sortingKey('ticktick', t.title, t.id);
    const own = review?.rules[key]; const wide = review?.rules['ticktick::*'];
    const prior = Object.values(review?.completions.entries || {}).filter(e => sortingKey(e.source, e.title, e.taskId) === key);
    const beforeArea = own?.area || wide?.area || prior[0]?.focusAreaId;
    const beforeGoal = own?.goal || wide?.goal;
    return { ...t, key, beforeArea, beforeGoal, prior, differs: beforeArea !== t.bucket || (t.primaryGoal && beforeGoal !== t.primaryGoal) };
  });
  const areaName = (id?: string | null) => map.buckets.find(b => b.id === id)?.name || id || 'Not saved';
  const goalName = (id?: string | null) => id === 'none' ? 'No goal (intentional)' : map.efforts.find(g => g.id === id)?.effort || id || 'Needs goal / care standard';
  function inspect() { setReview(readSorting()); setSelected([]); setNotice('Read from this browser. No saved choices have changed.'); }
  function apply() {
    const chosen = rows.filter(r => selected.includes(r.key));
    applyChanges(chosen.map(r => ({ key: r.key, area: r.bucket, goal: r.primaryGoal || undefined })));
  }
  function applyHistory() {
    const changes: SortingChange[] = [];
    for (const h of history) {
      const p = picks[h.key];
      if (!p) continue;
      const area = p.area ?? h.area;
      const goal = p.goal ?? h.goal;
      if (!area || (area === h.area && goal === h.goal && !h.mixed)) continue;
      changes.push({ key: h.key, area, goal: goal || undefined });
    }
    if (!changes.length) { setNotice('Pick a bucket (and goal) on the rows you want to change first.'); return; }
    applyChanges(changes);
    setPicks({});
  }
  function applyChanges(changes: SortingChange[]) {
    if (!review) return;
    const current = readSorting();
    if (JSON.stringify(current) !== JSON.stringify(review)) { setNotice('Saved data changed since review. Inspect again before applying.'); return; }
    let result: ReturnType<typeof migrateSorting>;
    try {
      result = migrateSorting(current, changes, map.buckets.map(b => b.id), map.efforts.map(g => g.id), new Date().toISOString());
    } catch (e) { setNotice(`Nothing changed: ${(e as Error).message}.`); return; }
    // Backup is written before mutation. No credentials or unrelated settings enter this file.
    const backup = { version: 1, before: current, audit: result.audit };
    try { localStorage.setItem('lifehub-flow-sorting-backup', JSON.stringify(backup)); } catch { setNotice('Backup could not be saved. Nothing changed.'); return; }
    download('frontier-sorting-before.json', backup);
    // Publish events only after both durable writes succeed, preventing a half-applied cloud push.
    const oldRules = localStorage.getItem(STORAGE_KEYS.taskRules);
    const oldLedger = localStorage.getItem(STORAGE_KEYS.completions);
    try {
      localStorage.setItem(STORAGE_KEYS.taskRules, JSON.stringify(result.next.rules));
      localStorage.setItem(STORAGE_KEYS.completions, JSON.stringify(result.next.completions));
    } catch {
      try {
        if (oldRules === null) localStorage.removeItem(STORAGE_KEYS.taskRules); else localStorage.setItem(STORAGE_KEYS.taskRules, oldRules);
        if (oldLedger === null) localStorage.removeItem(STORAGE_KEYS.completions); else localStorage.setItem(STORAGE_KEYS.completions, oldLedger);
      } catch { /* The downloaded backup remains the recovery copy. */ }
      setNotice('Storage could not save the migration. Use the downloaded backup if restoration is needed; no sync was requested.'); return;
    }
    window.dispatchEvent(new CustomEvent(LOCAL_WRITE_EVENT, { detail: STORAGE_KEYS.taskRules }));
    window.dispatchEvent(new CustomEvent(LOCAL_WRITE_EVENT, { detail: STORAGE_KEYS.completions }));
    window.dispatchEvent(new CustomEvent(TASK_RULES_EVENT)); window.dispatchEvent(new CustomEvent(SYNCED_EVENT));
    setReview(readSorting()); setSelected([]); setNotice(`${result.audit.changes.length} reviewed task assignments applied. Dates, task identities, completion count and unrelated settings preserved. Normal Frontier backup sync carries these choices to other devices.`);
  }
  async function ticktick() {
    setBusy(true); setNotice('Reading the full TickTick catalog…');
    try {
      const res = await fetch(`${WORKER}/api/flow/ticktick/catalog`, { headers: syncKeyHeader(), cache: 'no-store' });
      const body = await res.json() as { ok?: boolean; complete?: boolean; records?: unknown[] };
      if (!res.ok || !body.ok) throw new Error('Catalog unavailable');
      download('flow-ticktick-current.json', body);
      setNotice(body.complete ? 'Current TickTick catalog downloaded. Import it in Flow’s sync review to compare instructions, schedules and active records.' : 'Partial catalog downloaded. Flow will show the missing sources and will not treat missing records as deletions.');
    } catch { setNotice('The full catalog endpoint is not available yet, or this browser needs its normal Frontier backup connection. Local integration remains usable; no TickTick items changed.'); }
    finally { setBusy(false); }
  }
  const known = new Set(rows.map(r => r.key));
  const outside = review ? Object.keys(review.rules).filter(k => !known.has(k)) : [];
  // Everything in the real history that isn't one of the inspected TickTick definitions:
  // every task you've completed (any site) plus remembered rules with no completions yet.
  const history = (() => {
    if (!review) return [] as Array<{ key: string; source: string; title: string; count: number; area?: string; goal?: string; areas: string[]; mixed: boolean; last?: string }>;
    const groups = new Map<string, { key: string; source: string; title: string; count: number; areas: Set<string>; last?: string }>();
    for (const e of Object.values(review.completions.entries)) {
      const key = sortingKey(e.source, e.title, e.taskId);
      if (known.has(key)) continue;
      const g = groups.get(key) || { key, source: e.source, title: e.title || e.taskId, count: 0, areas: new Set<string>() };
      g.count++;
      if (e.focusAreaId) g.areas.add(e.focusAreaId);
      if (!g.last || e.completedAt > g.last) g.last = e.completedAt;
      groups.set(key, g);
    }
    for (const key of Object.keys(review.rules)) {
      if (known.has(key) || key.endsWith('::*') || groups.has(key)) continue;
      const [source, rest = ''] = key.split('::');
      groups.set(key, { key, source, title: rest.replace(/^t:|^id:/, ''), count: 0, areas: new Set() });
    }
    return [...groups.values()]
      .map(g => {
        const rule = review.rules[g.key];
        const wide = review.rules[`${g.source}::*`];
        const areas = [...g.areas];
        const area = rule?.area || (areas.length === 1 ? areas[0] : undefined) || wide?.area || undefined;
        const goal = rule?.goal || wide?.goal || undefined;
        return { key: g.key, source: g.source, title: g.title, count: g.count, area, goal, areas, mixed: areas.length > 1, last: g.last };
      })
      .sort((a, b) => a.source.localeCompare(b.source) || b.count - a.count);
  })();
  const needsReview = (h: (typeof history)[number]) => !h.area || !h.goal || h.mixed;
  const shownHistory = history.filter(h => histFilter === 'all' || needsReview(h));
  const pickedCount = Object.keys(picks).length;
  return <section className="sorting-page glass-panel" aria-label="Flow and Life Hub sync">
    <p className="section-label">Flow connection · local integration</p><h2>Review the homes for your work</h2>
    <p className="review-lede">Six lasting goal and care categories. Nine practical attention buckets. Your original seven bucket IDs stay intact. Each task keeps one bucket and one goal or care standard.</p>
    <p>Inspect your saved choices before applying individual changes. A checked row explicitly replaces its old task assignment, including old manual marks. Music formats keep their existing goal until you choose the actual session content. Source defaults, pace settings and past workload totals are preserved.</p>
    <div className="sorting-filters"><button type="button" className="row-action" onClick={inspect}>Inspect saved sorting</button><button type="button" className="row-action ghost" disabled={busy} onClick={ticktick}>Read TickTick catalog for Flow</button><a className="row-action ghost" href={import.meta.env.VITE_LOCAL_PREVIEW === 'true' ? '/flow/#sync' : 'https://randymcfarland1227-wq.github.io/flow-hub/#sync'}>Open Flow sync</a></div>
    <p role="status">{notice}</p>
    {review && <>
      <p>{Object.keys(review.completions.entries).length} stored completion records · {Object.keys(review.rules).length} remembered rules · {rows.filter(r => r.differs).length} proposed differences. Zero completions are created by sorting.</p>
      <p>{outside.length} additional rules or source defaults remain visible in Task sorting below. They are preserved, including intentional “No goal” choices. Existing source defaults only change if you edit them there.</p>
      <div className="sorting-list">{rows.map(r => <label className="sorting-row" key={r.key}>
        <input type="checkbox" checked={selected.includes(r.key)} disabled={!r.differs} onChange={e => setSelected(s => e.target.checked ? [...s, r.key] : s.filter(k => k !== r.key))} />
        <div className="sorting-task"><strong>{r.title}</strong><span>{r.executionType} · {r.semanticKind === 'action' ? 'Action credit' : 'Orientation / container · no action credit'} · {r.prior.length} historical marks</span>
          <span>Saved: {areaName(r.beforeArea)} → {goalName(r.beforeGoal)}</span><span>Proposed: {areaName(r.bucket)} → {r.primaryGoal ? goalName(r.primaryGoal) : 'Keep your chosen goal; session content decides'}</span>
        </div>
      </label>)}</div>
      <button type="button" className="row-action" disabled={!selected.length} onClick={apply}>Back up and apply {selected.length} reviewed assignments</button>
      <button type="button" className="row-action ghost" onClick={() => download('frontier-flow-sorting-review.json', { version: 1, state: review, rows, history })}>Export this review</button>

      <h3 className="flow-history-head">Everything else in your history</h3>
      <p>{history.length} tasks from every other site (Self, Gmail, Radall, Role Hub…) and remembered rules · {history.filter(needsReview).length} need a look (no bucket, no goal, or done under more than one bucket). Nothing here changes unless you pick a new bucket or goal on a row.</p>
      <div className="seg" role="group" aria-label="Show">
        <button type="button" className={histFilter === 'review' ? 'active' : ''} onClick={() => setHistFilter('review')}>Needs a look</button>
        <button type="button" className={histFilter === 'all' ? 'active' : ''} onClick={() => setHistFilter('all')}>All {history.length}</button>
      </div>
      <div className="sorting-list">{shownHistory.map(h => {
        const p = picks[h.key] || {};
        const set = (patch: { area?: string; goal?: string }) => setPicks(all => ({ ...all, [h.key]: { ...all[h.key], ...patch } }));
        return <div className="sorting-row flow-history-row" key={h.key}>
          <div className="sorting-task">
            <span className="priority-source">{sourceById[h.source as SourceId]?.shortName || h.source}</span>
            <strong title={h.title}>{h.title}</strong>
            <span>{h.count ? `${h.count}× done${h.last ? ` · last ${new Date(h.last).toLocaleDateString()}` : ''}` : 'Remembered rule · not done yet'}{h.mixed ? ` · done under ${h.areas.map(areaName).join(' + ')}` : ''}</span>
          </div>
          <select value={p.area ?? h.area ?? ''} onChange={e => set({ area: e.target.value || undefined })} aria-label={`Bucket for ${h.title}`}>
            <option value="">{h.area ? areaName(h.area) : 'Pick a bucket…'}</option>
            {map.buckets.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <select value={p.goal ?? h.goal ?? ''} onChange={e => set({ goal: e.target.value || undefined })} aria-label={`Goal for ${h.title}`}>
            <option value="">{h.goal ? goalName(h.goal) : 'Pick a goal…'}</option>
            <option value="none">No goal (intentional)</option>
            {map.efforts.map(g => <option key={g.id} value={g.id}>{g.effort}</option>)}
          </select>
        </div>;
      })}</div>
      <button type="button" className="row-action" disabled={!pickedCount} onClick={applyHistory}>Back up and apply {pickedCount} picked {pickedCount === 1 ? 'row' : 'rows'}</button>
    </>}
  </section>;
}
