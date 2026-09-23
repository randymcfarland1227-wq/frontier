'use client';

import { FormEvent, useState } from 'react';
import { CAPTURE_KINDS, type CaptureKind } from '../../lib/captures';

type Kind = 'task' | CaptureKind;

const KINDS: Array<{ id: Kind; label: string }> = [{ id: 'task', label: 'Task' }, ...CAPTURE_KINDS];

/** Self quick-add: a Task goes to Self; anything else goes to Thoughts, ideas & research. */
export function QuickCapture({
  onAddTask,
  onAddCapture,
}: {
  onAddTask: (title: string, detail: string) => void;
  onAddCapture: (kind: CaptureKind, title: string, notes: string) => void;
}) {
  const [kind, setKind] = useState<Kind>('task');
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');
  const [added, setAdded] = useState('');

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    if (kind === 'task') onAddTask(title, detail);
    else onAddCapture(kind, title, detail);
    setAdded(kind === 'task' ? 'Added to Self tasks' : `Saved to Thoughts, ideas & research as ${KINDS.find(k => k.id === kind)?.label}`);
    setTitle('');
    setDetail('');
    window.setTimeout(() => setAdded(''), 2500);
  }

  return (
    <form className="quick-capture" onSubmit={submit}>
      <div className="seg quick-kinds" role="group" aria-label="What is it?">
        {KINDS.map(k => (
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
      <div className="quick-row">
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder={kind === 'task' ? 'Add a Self task…' : `Add a ${KINDS.find(k => k.id === kind)?.label.toLowerCase()}…`}
          aria-label="Title"
        />
        <button type="submit" className="row-action" disabled={!title.trim()}>
          Add
        </button>
      </div>
      <input value={detail} onChange={e => setDetail(e.target.value)} placeholder="Detail (optional)" aria-label="Detail" />
      <p className="quick-hint" aria-live="polite">
        {added || (kind === 'task' ? 'Tasks count toward Review when done.' : "Not a task — won't clutter boards or Balance.")}
      </p>
    </form>
  );
}
