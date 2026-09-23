'use client';

import { FormEvent, useState } from 'react';
import type { SelfItem } from '../../lib/adapters/self';

export function SelfInbox({
  items,
  onAdd,
  onComplete,
  onStar,
}: {
  items: SelfItem[];
  onAdd: (title: string, detail: string) => void;
  onComplete: (id: string) => void;
  onStar: (id: string) => void;
}) {
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    onAdd(title, detail);
    setTitle('');
    setDetail('');
  }

  return (
    <section className="self-inbox">
      <div className="ledger-heading">
        <div>
          <p className="section-label">Hub-native</p>
          <h2>Self capture inbox</h2>
        </div>
      </div>
      <form className="entry-form" onSubmit={submit}>
        <label>
          Capture
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="What’s on your mind…" aria-label="Self capture title" />
        </label>
        <label>
          Detail (optional)
          <textarea value={detail} onChange={e => setDetail(e.target.value)} rows={2} placeholder="Context or next step…" aria-label="Self capture detail" />
        </label>
        <button type="submit">Add to Self</button>
      </form>
      <div className="ledger-list">
        {items.length === 0 ? (
          <p className="local-note">Nothing captured yet. Add a note above — star it to feature it on the home card.</p>
        ) : (
          items.map(item => (
            <div className={`ledger-row ${item.done ? 'done' : ''}`} key={item.id}>
              <div className="ledger-dot" />
              <div>
                <span>{item.starred ? '★ Starred' : 'Self'}{item.done ? ' · done' : ''}</span>
                <h3>{item.title}</h3>
                {item.detail ? <p>{item.detail}</p> : null}
              </div>
              <div className="task-actions">
                <button type="button" className="row-action ghost" onClick={() => onStar(item.id)} aria-label="Toggle star">
                  {item.starred ? '★' : '☆'}
                </button>
                <button type="button" className="row-action" onClick={() => onComplete(item.id)}>
                  {item.done ? 'Undo' : 'Done'}
                </button>
              </div>
            </div>
          ))
        )}
      </div>
      <p className="local-note">Stored in this browser. Categorize-to-origin comes later.</p>
    </section>
  );
}
