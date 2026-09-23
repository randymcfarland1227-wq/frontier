'use client';

import { FormEvent, useState } from 'react';
import {
  CAPTURE_KINDS,
  type Capture,
  type CaptureKind,
  type CaptureStatus,
} from '../../lib/captures';
import type { FocusArea } from '../../lib/focusAreas';
import type { SelfItem } from '../../lib/adapters/self';

const TABS: Array<{ id: CaptureStatus; label: string }> = [
  { id: 'inbox', label: 'Inbox' },
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
}: {
  captures: Capture[];
  areas: FocusArea[];
  selfItems: SelfItem[];
  onAdd: (input: { kind: CaptureKind; title: string; notes: string; url: string; focusAreaId: string }) => void;
  onStatus: (id: string, status: Exclude<CaptureStatus, 'promoted'>) => void;
  onPromote: (capture: Capture) => void;
}) {
  const [kind, setKind] = useState<CaptureKind>('idea');
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [area, setArea] = useState('');
  const [tab, setTab] = useState<CaptureStatus>('inbox');

  const areaName = (id?: string) => areas.find(a => a.id === id)?.name;
  const counts = Object.fromEntries(TABS.map(t => [t.id, captures.filter(c => c.status === t.id).length]));
  const visible = captures.filter(c => c.status === tab);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    onAdd({ kind, title, notes, url, focusAreaId: area });
    setTitle('');
    setUrl('');
    setNotes('');
    setArea('');
    setTab('inbox');
  }

  return (
    <section className="captures-panel glass-panel" aria-label="Ideas and research">
      <div className="captures-head">
        <div>
          <p className="section-label">Not tasks yet</p>
          <h2>Ideas &amp; research</h2>
          <p className="review-lede">
            Things to research, learn, or look into. They stay off task boards and Balance until you promote one
            into a Self task.
          </p>
        </div>
      </div>

      <form className="capture-form" onSubmit={submit}>
        <div className="seg" role="group" aria-label="Capture kind">
          {CAPTURE_KINDS.map(k => (
            <button
              key={k.id}
              type="button"
              className={k.id === kind ? 'active' : ''}
              aria-pressed={k.id === kind}
              onClick={() => setKind(k.id)}
            >
              {k.label}
            </button>
          ))}
        </div>
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="What's the idea or question?"
          aria-label="Capture title"
        />
        <div className="capture-form-row">
          <input value={url} onChange={e => setUrl(e.target.value)} placeholder="Link (optional)" aria-label="Link" inputMode="url" />
          <select value={area} onChange={e => setArea(e.target.value)} aria-label="Focus area">
            <option value="">No area</option>
            {areas.map(a => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Notes (optional)" aria-label="Notes" />
        <button type="submit" disabled={!title.trim()}>
          Capture
        </button>
      </form>

      <div className="seg capture-tabs" role="tablist" aria-label="Capture status">
        {TABS.map(t => (
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

      <div className="capture-list">
        {visible.length === 0 ? (
          <p className="review-empty">
            {tab === 'inbox' ? 'Inbox clear. Capture anything you want to come back to.' : `Nothing ${tab}.`}
          </p>
        ) : (
          visible.map(c => {
            const task = c.promotedTo?.source === 'self' ? selfItems.find(i => i.id === c.promotedTo?.taskId) : undefined;
            return (
              <article className={`capture-row is-${c.status}`} key={c.id}>
                <div className="capture-main">
                  <div className="capture-meta">
                    <span className={`capture-kind kind-${c.kind}`}>{KIND_LABEL[c.kind]}</span>
                    {areaName(c.focusAreaId) ? <span className="capture-area">{areaName(c.focusAreaId)}</span> : null}
                    <span>{ago(c.createdAt)}</span>
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
    </section>
  );
}
