'use client';

import { useCallback, useState, type FormEvent } from 'react';
import type { SourceId, SourceSnapshot, SpaceId } from '../../lib/types';
import { readSaved, writeSaved } from '../../lib/storage';
import { dayRecord, useDayKey } from '../../lib/dayKey';

type Snaps = Record<SourceId, SourceSnapshot>;

/** A tiny per-day record on this device (starts empty every new day). */
function useDayState<T>(key: string, fallback: T) {
  const day = useDayKey();
  const [state, setState] = useState<{ day: string; v: T }>(() => ({ day, v: dayRecord(key, day, fallback) }));
  // A new day shows the empty fallback until something is logged.
  const value = state.day === day ? state.v : fallback;
  const set = useCallback(
    (next: T) => {
      setState({ day, v: next });
      writeSaved(key, { day, v: next });
    },
    [key, day],
  );
  return [value, set] as const;
}

type Entry = { id: string; title: string; note?: string; done?: boolean; push?: number };

/** A typed list: a title plus an optional note (folds to two lines, tap to open), ✓ to mark off, ✕ to remove. */
function FocusList({ storageKey, label, noteLabel = 'Details (optional)', empty, week, marks = true }: { storageKey: string; label: string; noteLabel?: string; empty?: string; week?: boolean; marks?: boolean }) {
  const scope = week ? mondayKey() : '';
  const [state, setState] = useState(() => readSaved<{ scope: string; items: Entry[] }>(storageKey, { scope, items: [] }));
  const items = state.scope === scope ? state.items : [];
  const save = (next: Entry[]) => {
    const v = { scope, items: next };
    setState(v);
    writeSaved(storageKey, v);
  };
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const add = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    save([...items, { id: `${Date.now()}`, title: title.trim(), note: note.trim() || undefined }]);
    setTitle('');
    setNote('');
  };
  const live = items.filter(i => !i.done);
  const finished = items.filter(i => i.done);
  const row = (i: Entry) => (
    <li key={i.id} className={`fc-entry${i.done ? ' is-done' : ''}${open === i.id ? ' is-open' : ''}`}>
      {marks ? (
        <button type="button" className="fc-tick" aria-pressed={!!i.done} aria-label={i.done ? `Mark ${i.title} not done` : `Mark ${i.title} done`} onClick={() => save(items.map(x => (x.id === i.id ? { ...x, done: !x.done } : x)))}>
          {i.done ? '✓' : ''}
        </button>
      ) : null}
      <button type="button" className="fc-entry-text" onClick={() => setOpen(open === i.id ? null : i.id)}>
        <strong>{i.title}</strong>
        {i.note ? <span>{i.note}</span> : null}
      </button>
      <button type="button" className="fc-x" aria-label={`Remove ${i.title}`} onClick={() => save(items.filter(x => x.id !== i.id))}>✕</button>
    </li>
  );
  return (
    <div className="fc-flist">
      {items.length ? <ul className="fc-entries">{live.map(row)}{finished.map(row)}</ul> : empty ? <p className="fc-empty">{empty}</p> : null}
      <form className="fc-compose" onSubmit={add}>
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder={`+ ${label}`} aria-label={label} maxLength={120} />
        {title.trim() ? (
          <>
            <textarea value={note} onChange={e => setNote(e.target.value)} placeholder={noteLabel} aria-label={noteLabel} rows={2} maxLength={400} />
            <button type="submit" className="fc-addbtn">Add</button>
          </>
        ) : null}
      </form>
    </div>
  );
}

const mondayKey = () => {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};

const FIT_AREAS = ['Abs', 'Cardio', 'Movement', 'Strength', 'Mobility', 'Positioning', 'Posture', 'Legs', 'Back', 'Recovery'];

/** Fitness: tap an area to start pushing it, set how hard (1–3), add a note. */
function FitnessFocus() {
  const [state, setState] = useState(() => readSaved<Entry[]>('lifehub-focus-fit-areas', []));
  const save = (next: Entry[]) => {
    setState(next);
    writeSaved('lifehub-focus-fit-areas', next);
  };
  const [custom, setCustom] = useState('');
  const has = (t: string) => state.some(i => i.title.toLowerCase() === t.toLowerCase());
  const add = (t: string) => t.trim() && !has(t) && save([...state, { id: `fit-${t.trim().toLowerCase()}`, title: t.trim(), push: 2 }]);
  return (
    <div className="fc-flist">
      <div className="fc-areas">
        {FIT_AREAS.map(a => (
          <button key={a} type="button" className={`fc-area${has(a) ? ' is-on' : ''}`} onClick={() => (has(a) ? save(state.filter(i => i.title !== a)) : add(a))}>{a}</button>
        ))}
        <form onSubmit={e => { e.preventDefault(); add(custom); setCustom(''); }}>
          <input className="fc-area-in" value={custom} onChange={e => setCustom(e.target.value)} placeholder="+ other" aria-label="Other area" maxLength={40} />
        </form>
      </div>
      {state.length ? (
        <ul className="fc-entries">
          {state.map(i => (
            <li key={i.id} className="fc-entry fc-fitrow">
              <strong>{i.title}</strong>
              <span className="fc-push" role="group" aria-label={`${i.title} effort`}>
                {[1, 2, 3].map(n => (
                  <button key={n} type="button" className={n <= (i.push || 0) ? 'is-on' : ''} aria-label={`Push level ${n}`} aria-pressed={n === i.push} onClick={() => save(state.map(x => (x.id === i.id ? { ...x, push: n } : x)))} />
                ))}
                <small>{['', 'steady', 'more', 'all in'][i.push || 0]}</small>
              </span>
              <input className="fc-note" value={i.note || ''} placeholder="note…" aria-label={`${i.title} note`} maxLength={140} onChange={e => save(state.map(x => (x.id === i.id ? { ...x, note: e.target.value } : x)))} />
              <button type="button" className="fc-x" aria-label={`Remove ${i.title}`} onClick={() => save(state.filter(x => x.id !== i.id))}>✕</button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

const BOTTLES = 5;
function Water() {
  const [water, setWater] = useDayState<number>('lifehub-focus-water', 0);
  return (
    <div className="fc-bottles" role="group" aria-label="Bottles of water today">
      {Array.from({ length: BOTTLES }, (_, i) => (
        <button key={i} type="button" className={i < water ? 'is-on' : ''} aria-label={`Bottle ${i + 1}`} aria-pressed={i < water} onClick={() => setWater(i + 1 === water ? i : i + 1)} />
      ))}
      <span>{water}/{BOTTLES} bottles today</span>
    </div>
  );
}

/** Marvel's options for today, straight from the Calm Plan in his Den: this OR that in each group, then mark it done. */
const MARVEL_MENU: { id: string; label: string; options: { id: string; t: string; d: string }[] }[] = [
  { id: 'sniff', label: 'Sniff', options: [
    { id: 'walk', t: 'Sniff walk', d: '15–25 min, quiet route' },
    { id: 'scatter', t: 'Scatter a meal', d: 'In the grass, bowl up after 15 min' },
  ] },
  { id: 'move', label: 'Move', options: [
    { id: 'tug', t: 'Tug with rules', d: '5 min · sit, get it, drop' },
    { id: 'outlet', t: 'Walk', d: '15–25 min, slack leash' },
  ] },
  { id: 'think', label: 'Think', options: [
    { id: 'findit', t: 'Find it', d: 'Hide 10 kibble, he finds it' },
    { id: 'paycalm', t: 'Pay calm', d: 'Lies down quiet → toss kibble ×10' },
  ] },
];

function MarvelMenu() {
  const [st, setSt] = useDayState<Record<string, { pick?: string; done?: boolean }>>('lifehub-focus-marvel-pick', {});
  return (
    <div className="fc-menu">
      {MARVEL_MENU.map(g => {
        const cur = st[g.id] || {};
        return (
          <div key={g.id} className={`fc-menu-group${cur.done ? ' is-done' : ''}`}>
            <div className="fc-menu-head">
              <b>{g.label}</b>
              <span className="fc-menu-state">{cur.done ? '✓ done' : cur.pick ? 'picked' : 'pick one'}</span>
            </div>
            <div className="fc-either">
              {g.options.map((o, idx) => (
                <span key={o.id} className="fc-either-cell">
                  {idx === 1 ? <i className="fc-or">or</i> : null}
                  <button type="button" className={`fc-opt${cur.pick === o.id ? ' is-on' : cur.pick ? ' is-off' : ''}`} aria-pressed={cur.pick === o.id} onClick={() => setSt({ ...st, [g.id]: { pick: cur.pick === o.id ? undefined : o.id } })}>
                    <span>{o.t}</span>
                    <small>{o.d}</small>
                  </button>
                </span>
              ))}
            </div>
            {cur.pick ? (
              <button type="button" className={`fc-donebtn${cur.done ? ' is-on' : ''}`} onClick={() => setSt({ ...st, [g.id]: { ...cur, done: !cur.done } })}>
                {cur.done ? '✓ Done today' : 'Mark done'}
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function FocusSection({ enter }: { snapshots?: Snaps; enter: (id: SpaceId) => void }) {
  const day = useDayKey();
  return (
    <section className="focus-row" aria-label="Focus" data-day={day}>
      <div className="fc-col fc-short">
        <p className="fc-kicker">Short-term focus · right now</p>
        <FocusList storageKey="lifehub-focus-now2" label="What needs doing" noteLabel="The detail: what, why, next step" empty="Type what needs real attention right now." />
        <hr className="fc-bar" />
        <p className="fc-kicker is-soft">Next few weeks</p>
        <FocusList storageKey="lifehub-focus-weeks2" label="A short-term goal" noteLabel="What it takes" />
      </div>

      <div className="fc-col fc-mid">
        <div className="fc-block fc-nut">
          <p className="fc-kicker">Nutrition flow</p>
          <Water />
          <p className="fc-sub">Focus now</p>
          <FocusList storageKey="lifehub-focus-nut2" label="e.g. more protein" noteLabel="How: 170 g, shake after the gym…" marks={false} />
          <p className="fc-sub">Meals this week</p>
          <FocusList storageKey="lifehub-focus-meals2" label="A meal I can make" noteLabel="What it uses" week />
          <button type="button" className="fc-link" onClick={() => enter('logs')}>Log in the tracker →</button>
        </div>
        <div className="fc-block fc-fit">
          <p className="fc-kicker">Fitness · where I’m pushing</p>
          <FitnessFocus />
        </div>
      </div>

      <div className="fc-col fc-marvel">
        <p className="fc-kicker">Marvel · today, this or that</p>
        <MarvelMenu />
      </div>
    </section>
  );
}
