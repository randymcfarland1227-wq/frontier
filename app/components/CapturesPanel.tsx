'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import {
  CAPTURE_KINDS,
  type Capture,
  type CaptureKind,
  type CaptureStatus,
} from '../../lib/captures';
import type { FocusArea } from '../../lib/focusAreas';
import type { SelfItem } from '../../lib/adapters/self';
import { MenuRow, type RowMenuItem } from './RowMenu';
import { usePriorityPins } from '../../lib/priorityPins';

/** Where a Self task can be moved (it then shows in that site's card). */
const MOVE_TO: Array<[string, string]> = [
  ['radall', 'Finances'],
  ['repair', 'Repair Log'],
  ['role', 'Role Hub'],
  ['move', 'Move OS'],
  ['income', 'Venture Lab'],
  ['resale', 'Resale Hub'],
  ['candle', 'Peculiar Candle'],
];

type Tab = CaptureStatus | 'tasks';
type Kind = 'task' | 'log' | CaptureKind;

const KINDS: Array<{ id: Kind; label: string }> = [
  { id: 'task', label: 'Task' },
  { id: 'log', label: 'Log done' },
  ...CAPTURE_KINDS,
];

function localDay(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Today → now; an earlier day → noon that day, so it lands on the right day everywhere. */
function loggedAt(day: string) {
  if (!day || day >= localDay()) return new Date().toISOString();
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, 12).toISOString();
}

function shortDay(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** "Sat, Oct 10" for a YYYY-MM-DD day */
function dueLabel(day: string) {
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const diff = Math.round((date.getTime() - new Date(new Date().toDateString()).getTime()) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

/** Date picker for a Self task's day; opened from the row menu. */
function DueInput({ due, onChange, onClose }: { due?: string; onChange: (due?: string) => void; onClose: () => void }) {
  return (
    <input
      type="date"
      className="capture-due-input"
      autoFocus
      defaultValue={due || localDay()}
      aria-label="Day for this task"
      onBlur={e => {
        onClose();
        if (e.target.value && e.target.value !== due) onChange(e.target.value);
      }}
      onKeyDown={e => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') onClose();
      }}
    />
  );
}

/** A set day, as a small read-only chip (change it from the row menu). */
function DueText({ due }: { due?: string }) {
  if (!due) return null;
  return <span className={`capture-due${due < localDay() ? ' is-late' : ''}`}>{dueLabel(due)}</span>;
}

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'inbox', label: 'Inbox' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'parked', label: 'Parked' },
  { id: 'promoted', label: 'Promoted' },
  { id: 'dropped', label: 'Dropped' },
];

const KIND_LABEL = Object.fromEntries(CAPTURE_KINDS.map(k => [k.id, k.label])) as Record<CaptureKind, string>;

function ago(iso: string) {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86400000);
  if (Number.isNaN(days)) return '';
  if (days <= 0) return 'today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

export function CapturesPanel({
  captures,
  areas,
  selfItems,
  onAdd,
  onStatus,
  onPromote,
  onAddTask,
  onLogTask,
  onTaskDone,
  onTaskUndo,
  onTaskStar,
  onTaskDue,
  onTaskMove,
}: {
  captures: Capture[];
  areas: FocusArea[];
  selfItems: SelfItem[];
  onAdd: (input: { kind: CaptureKind; title: string; notes: string; url: string; focusAreaId: string }) => void;
  onStatus: (id: string, status: Exclude<CaptureStatus, 'promoted'>) => void;
  onPromote: (capture: Capture) => void;
  onAddTask: (title: string, detail: string, focusAreaId: string, due?: string) => void;
  /** Record something already done (off-site) so it counts */
  onLogTask: (title: string, detail: string, focusAreaId: string, at: string) => void;
  onTaskDone: (id: string) => void;
  onTaskUndo: (id: string) => void;
  onTaskStar: (id: string) => void;
  /** Set or clear a task's optional day */
  onTaskDue: (id: string, due?: string) => void;
  /** Move a task to another site's card */
  onTaskMove?: (id: string, home: string) => void;
}) {
  const { isPinned, addPin, removePin } = usePriorityPins();
  const [kind, setKind] = useState<Kind>('task');
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [area, setArea] = useState('');
  // Open on the inbox only when it has something in it; otherwise on your tasks.
  const [tab, setTab] = useState<Tab>(() => (captures.some(c => c.status === 'inbox') ? 'inbox' : 'tasks'));
  const [doneDay, setDoneDay] = useState(() => localDay());
  const [taskDay, setTaskDay] = useState('');
  const [logged, setLogged] = useState('');
  // The form starts as one line; the kind buttons, link, area and notes open when you click in.
  const [expanded, setExpanded] = useState(false);
  const formOpen = expanded || Boolean(title || url || notes);
  const formRef = useRef<HTMLFormElement>(null);
  // Close only when you click or tab somewhere outside the form (Safari doesn't focus buttons on
  // click, so a blur check would fold the form away mid-tap on "Log done").
  useEffect(() => {
    if (!expanded) return;
    const away = (e: Event) => {
      if (!formRef.current || formRef.current.contains(e.target as Node)) return;
      setExpanded(false);
      // Nothing typed: fold back to a plain "Task" box for next time.
      if (!title && !url && !notes) setKind('task');
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('focusin', away);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('focusin', away);
    };
  }, [expanded, title, url, notes]);

  const areaName = (id?: string) => areas.find(a => a.id === id)?.name;
  const [dayFor, setDayFor] = useState<string | null>(null);
  const dayShift = (n: number) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return localDay(d);
  };
  /** Everything a Self task row used to show as buttons — star, pin, day, move — lives in its right-click / long-press menu. */
  const taskMenu = (t: SelfItem): RowMenuItem[] => [
    { label: t.starred ? 'Unstar' : 'Star', onSelect: () => onTaskStar(t.id), hidden: t.done },
    { label: 'Pin to Priority', onSelect: () => addPin('self', t.id), hidden: t.done || !t.starred || isPinned('self', t.id) },
    { label: 'Take off Priority', onSelect: () => removePin('self', t.id), hidden: t.done || !isPinned('self', t.id) },
    { label: 'Day: today', onSelect: () => onTaskDue(t.id, dayShift(0)), hidden: t.done },
    { label: 'Day: tomorrow', onSelect: () => onTaskDue(t.id, dayShift(1)), hidden: t.done },
    { label: t.due ? 'Change day…' : 'Pick a day…', onSelect: () => setDayFor(t.id), hidden: t.done },
    { label: 'Clear the day', onSelect: () => onTaskDue(t.id, undefined), hidden: t.done || !t.due },
    ...(onTaskMove && !t.done ? MOVE_TO.map(([id, name]) => ({ label: `Move → ${name}`, onSelect: () => onTaskMove(t.id, id) })) : []),
  ];
  // Dated tasks first (soonest first), then the rest in the order they were added.
  // Tasks moved to another site live in that site's card now.
  const mine = selfItems.filter(i => !i.home);
  const allOpen = mine
    .filter(i => !i.done)
    .map((t, i) => ({ t, i }))
    .sort((a, b) => (a.t.due && b.t.due ? a.t.due.localeCompare(b.t.due) : a.t.due ? -1 : b.t.due ? 1 : a.i - b.i))
    .map(x => x.t);
  // Starred ones sit in their own list above the tabs; Pin there is what sends one to Priority.
  const starredTasks = allOpen.filter(t => t.starred);
  const openTasks = allOpen.filter(t => !t.starred);
  const doneTasks = mine.filter(i => i.done).slice(0, 15);
  const counts: Record<Tab, number> = Object.fromEntries(
    TABS.map(t => [t.id, t.id === 'tasks' ? openTasks.length : captures.filter(c => c.status === t.id).length]),
  ) as Record<Tab, number>;
  const visible = tab === 'tasks' ? [] : captures.filter(c => c.status === tab);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    if (kind === 'log') {
      if (!area) return;
      onLogTask(title, [notes, url].filter(Boolean).join('\n'), area, loggedAt(doneDay));
      setLogged(`Logged “${title.trim()}” · ${areaName(area)}${doneDay < localDay() ? ` · ${shortDay(loggedAt(doneDay))}` : ''}`);
      setDoneDay(localDay());
      setTab('tasks');
    } else if (kind === 'task') {
      onAddTask(title, [notes, url].filter(Boolean).join('\n'), area, taskDay || undefined);
      setTaskDay('');
      setTab('tasks');
    } else {
      onAdd({ kind, title, notes, url, focusAreaId: area });
      setTab('inbox');
    }
    setTitle('');
    setUrl('');
    setNotes('');
    setArea('');
  }

  return (
    <section className="captures-panel glass-panel" aria-label="Ideas and research">
      <div className="captures-head">
        <div>
          <p className="section-label">Self</p>
          <h2>Thoughts, ideas, research &amp; tasks</h2>
          <p className="review-lede">
            Tasks count toward Review when done. Log done records something you already finished off-site. Thoughts, ideas, and research stay off task boards and Balance —
            promote one when it becomes a task.
          </p>
        </div>
      </div>

      <form
        className={`capture-form${formOpen ? '' : ' is-compact'}`}
        onSubmit={submit}
        ref={formRef}
        onFocus={() => setExpanded(true)}
      >
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder={
            !formOpen
              ? 'Add a task, log something done, or jot a thought…'
              : kind === 'task'
                ? 'What needs doing?'
                : kind === 'log'
                  ? 'What did you get done?'
                  : "What's the thought, idea, or question?"
          }
          aria-label="Capture title"
        />
        {formOpen ? (
          <>
            <div className="seg" role="group" aria-label="Capture kind">
              {KINDS.map(k => (
                <button
                  key={k.id}
                  type="button"
                  className={k.id === kind ? 'active' : ''}
                  aria-pressed={k.id === kind}
                  onClick={() => {
                    setKind(k.id);
                    setLogged('');
                  }}
                >
                  {k.label}
                </button>
              ))}
            </div>
            <div className={`capture-form-row${kind === 'log' || kind === 'task' ? ' has-date' : ''}`}>
              <input value={url} onChange={e => setUrl(e.target.value)} placeholder="Link (optional)" aria-label="Link" inputMode="url" />
              {kind === 'log' ? (
                <input
                  type="date"
                  value={doneDay}
                  max={localDay()}
                  onChange={e => setDoneDay(e.target.value)}
                  aria-label="Day it was done"
                  title="Day it was done"
                />
              ) : null}
              {kind === 'task' ? (
                <input
                  type="date"
                  value={taskDay}
                  onChange={e => setTaskDay(e.target.value)}
                  aria-label="Day for it (optional)"
                  title="Day for it (optional) — shows on the calendar"
                />
              ) : null}
              <select value={area} onChange={e => setArea(e.target.value)} aria-label="Focus area" required={kind === 'log'}>
                <option value="">{kind === 'log' ? 'Pick an area…' : 'No area'}</option>
                {areas.map(a => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Notes (optional)" aria-label="Notes" />
            <button type="submit" disabled={!title.trim() || (kind === 'log' && !area)}>
              {kind === 'task' ? 'Add task' : kind === 'log' ? 'Log as done' : 'Capture'}
            </button>
          </>
        ) : null}
        {kind === 'log' && logged ? <p className="capture-logged" role="status">✓ {logged}</p> : null}
      </form>

      {starredTasks.length ? (
        <div className="self-starred" aria-label="Starred Self tasks">
          <p className="self-starred-head">
            <span aria-hidden="true">★</span> Starred <span className="seg-count">{starredTasks.length}</span>
          </p>
          {starredTasks.map(t => {
            const pinned = isPinned('self', t.id);
            return (
              <MenuRow className="capture-row is-task is-starred" key={t.id} items={() => taskMenu(t)} title={t.title}>
                <div className="capture-main">
                  {t.due || pinned ? (
                    <div className="capture-meta">
                      <DueText due={t.due} />
                      {pinned ? <span title="On your Priority list">📌</span> : null}
                    </div>
                  ) : null}
                  <h3 title={[t.title, t.detail].filter(Boolean).join(' — ')}>{t.title}</h3>
                  {dayFor === t.id ? <DueInput due={t.due} onChange={due => onTaskDue(t.id, due)} onClose={() => setDayFor(null)} /> : null}
                </div>
                <div className="capture-actions">
                  <button type="button" className="row-action" onClick={() => onTaskDone(t.id)}>
                    Done
                  </button>
                </div>
              </MenuRow>
            );
          })}
        </div>
      ) : null}

      <div className="seg capture-tabs" role="tablist" aria-label="Capture status">
        {/* Empty tabs step aside (the open one always shows), so the row stays one line. */}
        {TABS.filter(t => t.id === tab || t.id === 'inbox' || t.id === 'tasks' || counts[t.id] > 0).map(t => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={t.id === tab}
            className={t.id === tab ? 'active' : ''}
            onClick={() => setTab(t.id)}
          >
            {t.label} <span className="seg-count">{counts[t.id]}</span>
          </button>
        ))}
      </div>

      {tab === 'tasks' ? (
        <div className="capture-list">
          {openTasks.length === 0 && doneTasks.length === 0 ? (
            <p className="capture-empty">No Self tasks yet.</p>
          ) : null}
          {[...openTasks, ...doneTasks].map(t => (
            <MenuRow className={`capture-row is-task${t.done ? ' is-done' : ''}`} key={t.id} items={() => taskMenu(t)} title={t.title}>
              <div className="capture-main">
                <div className="capture-meta">
                  <span className="capture-kind kind-task">Task</span>
                  {areaName(t.focusAreaId) ? <span className="capture-area">{areaName(t.focusAreaId)}</span> : null}
                  {t.done ? <span>done · {shortDay(t.createdAt)}</span> : <span className="capture-ago">{ago(t.createdAt)}</span>}
                  {t.due ? (t.done ? <span>{dueLabel(t.due)}</span> : <DueText due={t.due} />) : null}
                  {t.forEvent ? <span className="capture-for">for {t.forEvent.title}</span> : null}
                </div>
                <h3>{t.title}</h3>
                {t.detail ? <p>{t.detail}</p> : null}
                {dayFor === t.id ? <DueInput due={t.due} onChange={due => onTaskDue(t.id, due)} onClose={() => setDayFor(null)} /> : null}
              </div>
              <div className="capture-actions">
                {t.done ? (
                  <button type="button" className="row-action ghost" onClick={() => onTaskUndo(t.id)}>
                    Undo
                  </button>
                ) : (
                  <button type="button" className="row-action" onClick={() => onTaskDone(t.id)}>
                    Done
                  </button>
                )}
              </div>
            </MenuRow>
          ))}
        </div>
      ) : (
      <div className="capture-list">
        {visible.length === 0 ? (
          <p className="capture-empty">{tab === 'inbox' ? 'Inbox clear.' : `Nothing ${tab}.`}</p>
        ) : (
          visible.map(c => {
            const task = c.promotedTo?.source === 'self' ? selfItems.find(i => i.id === c.promotedTo?.taskId) : undefined;
            return (
              <article className={`capture-row is-${c.status}`} key={c.id}>
                <div className="capture-main">
                  <div className="capture-meta">
                    <span className={`capture-kind kind-${c.kind}`}>{KIND_LABEL[c.kind]}</span>
                    {areaName(c.focusAreaId) ? <span className="capture-area">{areaName(c.focusAreaId)}</span> : null}
                    <span className="capture-ago">{ago(c.createdAt)}</span>
                  </div>
                  <h3>
                    {c.url ? (
                      <a href={c.url} target="_blank" rel="noopener noreferrer">
                        {c.title} ↗
                      </a>
                    ) : (
                      c.title
                    )}
                  </h3>
                  {c.notes ? <p>{c.notes}</p> : null}
                  {c.status === 'promoted' ? (
                    <p className="capture-promoted">
                      → Self task · {task ? (task.done ? 'done ✓' : 'open') : 'removed'}
                    </p>
                  ) : null}
                </div>
                <div className="capture-actions">
                  {c.status === 'inbox' || c.status === 'parked' ? (
                    <>
                      <button type="button" className="row-action" onClick={() => onPromote(c)}>
                        Promote
                      </button>
                      <button
                        type="button"
                        className="row-action ghost"
                        onClick={() => onStatus(c.id, c.status === 'inbox' ? 'parked' : 'inbox')}
                      >
                        {c.status === 'inbox' ? 'Park' : 'Unpark'}
                      </button>
                      <button type="button" className="row-action ghost" onClick={() => onStatus(c.id, 'dropped')}>
                        Drop
                      </button>
                    </>
                  ) : null}
                  {c.status === 'dropped' ? (
                    <button type="button" className="row-action ghost" onClick={() => onStatus(c.id, 'inbox')}>
                      Restore
                    </button>
                  ) : null}
                </div>
              </article>
            );
          })
        )}
      </div>
      )}
    </section>
  );
}
