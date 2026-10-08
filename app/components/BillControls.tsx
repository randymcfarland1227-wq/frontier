'use client';

import { useState, type FormEvent } from 'react';
import { fromDayKey, type BillDue } from '../../lib/schedule';
import { loadBillEdits, setBillEdit } from '../../lib/billEdits';
import { usePriorityPins } from '../../lib/priorityPins';

const shortDay = (k: string) => fromDayKey(k).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });

/** "Skipped · shopping for cheaper" / "Moved from Thu, Oct 10" — what was changed on Life Hub. */
export function billChangeText(d: BillDue): string {
  return [d.skipped ? 'Skipped' : '', d.orig ? `Moved from ${shortDay(d.orig)}` : '', d.editNote || ''].filter(Boolean).join(' · ');
}

/** Pin this due date to Priority ("Doing now"). Checking it off there marks it paid. */
export function BillPinButton({ due, className = 'row-action ghost' }: { due: BillDue; className?: string }) {
  const { isPinned, addPin, removePin } = usePriorityPins();
  const pinned = isPinned('radall', due.key);
  return (
    <button
      type="button"
      className={`${className} bill-pin${pinned ? ' is-on' : ''}`}
      aria-pressed={pinned}
      onClick={() => (pinned ? removePin('radall', due.key) : addPin('radall', due.key))}
      aria-label={pinned ? `Unpin ${due.bill.name} from Doing now` : `Pin ${due.bill.name} to Doing now`}
      title={pinned ? 'Pinned to Doing now — tap to unpin' : 'Pin to Doing now'}
    >
      {pinned ? 'Pinned' : 'Pin'}
    </button>
  );
}

/**
 * Change one due date of a bill: pay as usual, skip it this time, or move it — plus an amount for
 * this time and a note. Saved on Life Hub (synced), not in the sheet.
 */
export function BillChangeForm({ due, onDone }: { due: BillDue; onDone: () => void }) {
  const saved = loadBillEdits()[due.key];
  const original = due.orig || due.due;
  const [mode, setMode] = useState<'usual' | 'skip' | 'move'>(saved?.skip ? 'skip' : saved?.moveTo ? 'move' : 'usual');
  const [moveTo, setMoveTo] = useState(saved?.moveTo || original);
  const [amount, setAmount] = useState(saved?.amount !== undefined ? String(saved.amount) : '');
  const [note, setNote] = useState(saved?.note || '');
  const name = due.bill.name;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const n = amount.trim() === '' ? undefined : Number(amount.replace(/[$,]/g, ''));
    setBillEdit(due.key, {
      skip: mode === 'skip',
      moveTo: mode === 'move' && moveTo && moveTo !== original ? moveTo : undefined,
      amount: n !== undefined && Number.isFinite(n) ? n : undefined,
      note,
    });
    onDone();
  };

  return (
    <form
      className="bill-change"
      onSubmit={submit}
      onKeyDown={e => {
        if (e.key !== 'Escape') return;
        e.stopPropagation();
        onDone();
      }}
      aria-label={`Change ${name} due ${shortDay(original)}`}
    >
      <p className="bill-change-title">
        {name} · due {shortDay(original)}
      </p>
      <div className="bill-change-modes" role="radiogroup" aria-label="This time">
        {(
          [
            ['usual', 'Pay as usual'],
            ['skip', 'Skip this one'],
            ['move', 'Move to another day'],
          ] as const
        ).map(([id, label]) => (
          <label key={id} className={mode === id ? 'is-on' : ''}>
            <input type="radio" name={`mode-${due.key}`} checked={mode === id} onChange={() => setMode(id)} />
            {label}
          </label>
        ))}
      </div>
      {mode === 'move' ? (
        <label className="bill-change-field">
          <span>New day</span>
          <input type="date" value={moveTo} onChange={e => setMoveTo(e.target.value)} required />
        </label>
      ) : null}
      {mode !== 'skip' ? (
        <label className="bill-change-field">
          <span>Amount this time</span>
          <input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder={due.bill.amount !== undefined ? String(due.bill.amount) : 'Same as usual'} />
        </label>
      ) : null}
      <label className="bill-change-field is-wide">
        <span>Note</span>
        <input
          autoFocus
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder={mode === 'skip' ? 'Why? e.g. Shopping for cheaper insurance' : 'Optional'}
        />
      </label>
      <div className="bill-change-actions">
        <button type="submit" className="row-action">
          Save
        </button>
        <button type="button" className="row-action ghost" onClick={onDone}>
          Cancel
        </button>
        {saved && (saved.skip || saved.moveTo || saved.amount !== undefined || saved.note) ? (
          <button
            type="button"
            className="row-action ghost bill-change-reset"
            onClick={() => {
              setBillEdit(due.key, null);
              onDone();
            }}
          >
            Undo changes
          </button>
        ) : null}
      </div>
    </form>
  );
}
