'use client';

import { useState } from 'react';
import { syncKeyHeader } from '../../lib/cloudSync';
import flowMap from '../../public/data/flow-map.json';

const WORKER = (import.meta.env.VITE_WORKER_URL || 'https://frontier-work-room.randymcfarland1227.workers.dev').replace(/\/$/, '');

/** Flow plan field → TickTick task field. Only these three are ever written. */
const FIELDS: Record<string, { label: string; tt: 'title' | 'content' | 'repeatFlag' }> = {
  title: { label: 'Name', tt: 'title' },
  content: { label: 'Instructions', tt: 'content' },
  repeatRule: { label: 'Repeat', tt: 'repeatFlag' },
};

type Change = { key: string; id: string; projectId: string; title: string; field: string; tt: 'title' | 'content' | 'repeatFlag'; from: string; to: string };
type Result = { id: string; ok: boolean; error?: string; fields?: string[]; before?: Record<string, string> };

type Plan = {
  desired?: Array<Record<string, unknown>>;
  differences?: Array<{ id: string; executionType?: string; changes?: Array<{ field: string; expected: unknown; actual: unknown }> }>;
};

const str = (v: unknown) => (v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v));
const short = (v: string) => (v.length > 70 ? `${v.slice(0, 70)}…` : v || '(empty)');

function download(name: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The setup snapshot Flow started from — anything different in the plan is an edit Randy made in Flow. */
const BASELINE = new Map((flowMap as { records: Array<Record<string, unknown>> }).records.map(r => [String(r.id), r]));

/**
 * Only fields Randy actually changed in Flow (plan value ≠ setup snapshot) are candidates; each is
 * then compared with **live** TickTick, so Flow doesn't need its own catalog import first.
 */
function editsFrom(plan: Plan, live: Map<string, Record<string, unknown>>): { changes: Change[]; edited: number; alreadyLive: number } {
  const changes: Change[] = [];
  let edited = 0;
  let alreadyLive = 0;
  for (const d of plan.desired || []) {
    if (d.executionType !== 'Task' || typeof d.id !== 'string') continue;
    const base = BASELINE.get(d.id);
    const projectId = typeof d.projectId === 'string' ? d.projectId : '';
    if (!base || !projectId) continue;
    for (const [field, f] of Object.entries(FIELDS)) {
      if (!Object.hasOwn(d, field) || str(d[field]) === str(base[field])) continue;
      edited++;
      const now = live.get(d.id);
      if (!now) continue; // not open in TickTick any more
      const current = str(now[field]);
      if (current === str(d[field])) {
        alreadyLive++;
        continue;
      }
      changes.push({ key: `${d.id}:${f.tt}`, id: d.id, projectId, title: str(d.title) || d.id, field: f.label, tt: f.tt, from: current, to: str(d[field]) });
    }
  }
  return { changes, edited, alreadyLive };
}

/**
 * Write Flow's reviewed changes back to TickTick — tasks only, and only name / instructions /
 * repeat. Each write is checked against what the plan saw; anything edited in TickTick since is
 * skipped. The before-values download first and "Undo" writes them back.
 */
export function TickTickWriteBack() {
  const [changes, setChanges] = useState<Change[]>([]);
  const [skipped, setSkipped] = useState(0);
  const [picked, setPicked] = useState<string[]>([]);
  const [results, setResults] = useState<Record<string, Result>>({});
  const [undo, setUndo] = useState<Array<{ id: string; projectId: string; set: Record<string, string>; expect: Record<string, string> }>>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const load = async (input: HTMLInputElement) => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const plan = JSON.parse(await file.text()) as Plan & { state?: unknown; rows?: unknown };
      if (!plan.desired && (plan.state || plan.rows)) {
        setChanges([]);
        setNotice(
          `"${file.name}" is Life Hub's own review export, not Flow's plan. In Flow: Review → TickTick sync ⇄ → Export reviewed sync plan (it downloads flow-reviewed-sync-plan.json); load that here.`,
        );
        return;
      }
      if (!plan.desired) {
        setChanges([]);
        setNotice(`"${file.name}" isn't a Flow sync plan. Use flow-reviewed-sync-plan.json from Flow's TickTick sync page.`);
        return;
      }
      setNotice('Checking your Flow edits against live TickTick…');
      const res = await fetch(`${WORKER}/api/flow/ticktick/catalog`, { headers: syncKeyHeader(), cache: 'no-store' });
      const cat = (await res.json().catch(() => ({}))) as { ok?: boolean; records?: Array<Record<string, unknown>> };
      if (!res.ok || !cat.ok) {
        setNotice("Couldn't read live TickTick. This needs this browser's normal backup connection — nothing was written.");
        return;
      }
      const live = new Map((cat.records || []).filter(r => r.executionType === 'Task').map(r => [String(r.id), r]));
      const { changes: list, edited, alreadyLive } = editsFrom(plan, live);
      setChanges(list);
      setSkipped(0);
      setPicked([]);
      setResults({});
      setUndo([]);
      setNotice(
        list.length
          ? `${list.length} change${list.length === 1 ? '' : 's'} you made in Flow ${list.length === 1 ? 'differs' : 'differ'} from TickTick — tick and write.`
          : edited
            ? `Your ${edited} Flow edit${edited === 1 ? ' is' : 's are'} already in TickTick${alreadyLive < edited ? ' (or the task is no longer open)' : ''} — nothing to write.`
            : "Nothing to write: Flow's tasks still match TickTick — no task name, instructions or repeat has been edited in Flow yet. To change one: Flow → Review → TickTick sync ⇄ → open a task → Review intended definition → edit → Save, then export and load the plan again.",
      );
    } catch {
      setNotice("That file isn't a Flow sync plan.");
    }
  };

  const send = async (payload: Array<{ id: string; projectId: string; set: Record<string, string>; expect: Record<string, string> }>) => {
    const res = await fetch(`${WORKER}/api/flow/ticktick/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...syncKeyHeader() },
      body: JSON.stringify({ changes: payload }),
    });
    const body = (await res.json()) as { ok?: boolean; results?: Result[]; error?: string };
    if (!res.ok || !body.ok) throw new Error(body.error || `HTTP ${res.status}`);
    return body.results || [];
  };

  const apply = async () => {
    const chosen = changes.filter(c => picked.includes(c.key));
    if (!chosen.length) return;
    if (!window.confirm(`Write ${chosen.length} change${chosen.length === 1 ? '' : 's'} to TickTick? Anything edited in TickTick since the plan is skipped.`)) return;
    // One request item per task, with every reviewed field for it.
    const byTask = new Map<string, { id: string; projectId: string; set: Record<string, string>; expect: Record<string, string> }>();
    for (const c of chosen) {
      const t = byTask.get(c.id) || { id: c.id, projectId: c.projectId, set: {}, expect: {} };
      t.set[c.tt] = c.to;
      t.expect[c.tt] = c.from;
      byTask.set(c.id, t);
    }
    setBusy(true);
    setNotice('Writing to TickTick…');
    try {
      const out = await send([...byTask.values()]);
      const map: Record<string, Result> = {};
      const undoList: typeof undo = [];
      for (const r of out) {
        map[r.id] = r;
        const t = byTask.get(r.id);
        if (r.ok && r.before && t) undoList.push({ id: r.id, projectId: t.projectId, set: r.before, expect: t.set });
      }
      setResults(map);
      setUndo(undoList);
      if (undoList.length) download('ticktick-before-flow-write.json', { version: 1, at: new Date().toISOString(), undo: undoList });
      const ok = out.filter(r => r.ok).length;
      setNotice(`${ok} task${ok === 1 ? '' : 's'} updated in TickTick${out.length - ok ? ` · ${out.length - ok} skipped (see each row)` : ''}. The before-values were downloaded; Undo writes them back.`);
      setPicked([]);
    } catch (e) {
      setNotice(`Nothing written: ${(e as Error).message}. This needs this browser's normal backup connection.`);
    } finally {
      setBusy(false);
    }
  };

  const revert = async () => {
    if (!undo.length || !window.confirm(`Put the old values back on ${undo.length} task${undo.length === 1 ? '' : 's'} in TickTick?`)) return;
    setBusy(true);
    try {
      const out = await send(undo);
      const ok = out.filter(r => r.ok).length;
      setNotice(`Undo: ${ok} of ${undo.length} restored${ok < undo.length ? ' (the rest were edited in TickTick since, so they were left alone)' : ''}.`);
      setUndo([]);
      setResults({});
    } catch (e) {
      setNotice(`Undo failed: ${(e as Error).message}. The downloaded before-file has the old values.`);
    } finally {
      setBusy(false);
    }
  };

  const reason = (r?: Result) =>
    !r ? '' : r.ok ? 'Written ✓' : r.error === 'changed_in_ticktick' ? 'Skipped · changed in TickTick since' : r.error === 'not_open' ? 'Skipped · not open in TickTick' : `Skipped · ${r.error}`;

  return (
    <div className="tt-writeback">
      <h3 className="flow-history-head">Write Flow&apos;s changes to TickTick</h3>
      <p className="flow-summary">
        Tasks only: <b>name</b>, <b>instructions</b> and <b>repeat</b>. Checklists, sections, status and deletions are never written, and habits stay
        read-only for now. In Flow: Review → TickTick sync → <b>Export reviewed sync plan</b>, then load that file here.
      </p>
      <div className="flow-bar">
        <label className="row-action ghost tt-file">
          Load Flow plan…
          <input type="file" accept="application/json,.json" hidden onChange={e => void load(e.currentTarget)} />
        </label>
        {changes.length ? (
          <>
            <button type="button" className="row-action ghost" onClick={() => setPicked(changes.map(c => c.key))}>
              Select all {changes.length}
            </button>
            <button type="button" className="row-action ghost" disabled={!picked.length} onClick={() => setPicked([])}>
              Clear
            </button>
          </>
        ) : null}
      </div>
      <p role="status" className="flow-summary">
        {notice}
        {skipped ? ` ${skipped} other differences (habits, checklists, sections, unverified) are left alone.` : ''}
      </p>
      {changes.length ? (
        <div className="flow-list">
          {changes.map(c => (
            <label className={`flow-row tt-row${results[c.id]?.ok ? ' is-ok' : results[c.id] ? ' is-skip' : ''}`} key={c.key} title={`${c.title}\n${c.field}\nTickTick now: ${c.from}\nFlow: ${c.to}`}>
              <input type="checkbox" checked={picked.includes(c.key)} onChange={e => setPicked(p => (e.target.checked ? [...p, c.key] : p.filter(k => k !== c.key)))} />
              <span className="flow-title">
                {c.title}
                <small>{c.field}</small>
              </span>
              <span className="flow-from">{short(c.from)}</span>
              <span className="flow-arrow" aria-hidden="true">
                →
              </span>
              <span className="flow-to">{short(c.to)}</span>
              <span className="flow-n">{reason(results[c.id])}</span>
            </label>
          ))}
        </div>
      ) : null}
      <div className="flow-bar">
        <button type="button" className="row-action" disabled={busy || !picked.length} onClick={() => void apply()}>
          Write {picked.length} to TickTick
        </button>
        {undo.length ? (
          <button type="button" className="row-action ghost" disabled={busy} onClick={() => void revert()}>
            Undo last write ({undo.length})
          </button>
        ) : null}
      </div>
    </div>
  );
}
