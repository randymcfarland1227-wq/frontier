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

/** A short list you edit yourself (kept on this device). */
function useList(key: string, seed: string[]) {
  const [list, setList] = useState<string[]>(() => readSaved<string[]>(key, seed));
  const save = (next: string[]) => {
    setList(next);
    writeSaved(key, next);
  };
  return [list, save] as const;
}

function AddLine({ onAdd, label }: { onAdd: (text: string) => void; label: string }) {
  const [text, setText] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    onAdd(text.trim());
    setText('');
  };
  return (
    <form className="fc-add" onSubmit={submit}>
      <input value={text} onChange={e => setText(e.target.value)} placeholder={`+ ${label}`} aria-label={label} maxLength={140} />
    </form>
  );
}

function EditableList({ storageKey, seed, label, onTap }: { storageKey: string; seed: string[]; label: string; onTap?: (text: string) => void }) {
  const [list, save] = useList(storageKey, seed);
  return (
    <>
      <ul className="fc-list">
        {list.map(t => (
          <li key={t}>
            {onTap ? (
              <button type="button" className="fc-row-link" onClick={() => onTap(t)}>
                {t}
              </button>
            ) : (
              <span>{t}</span>
            )}
            <button type="button" className="fc-x" aria-label={`Remove ${t}`} onClick={() => save(list.filter(x => x !== t))}>
              ✕
            </button>
          </li>
        ))}
      </ul>
      <AddLine label={label} onAdd={t => !list.includes(t) && save([...list, t])} />
    </>
  );
}

const mondayKey = () => {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};

/** Recipes from the Body (Daylight Matrix) library, so a week's meals can be picked in one tap. */
const BODY_RECIPES = [
  'Sweet-spicy chicken personal pizza',
  'Crispy chicken nugget wraps',
  'Curry chicken + baby potato skillet',
  'Crisp pierogies + green beans',
  'Toasted ravioli + seasoned green beans',
  'Strawberry-banana yogurt smoothie',
  'Strawberry-banana pancakes',
];

/** Marvel's options for today, straight from the Calm Plan in his Den: pick one in each group. */
const MARVEL_MENU: { id: string; label: string; options: { id: string; t: string; d: string }[] }[] = [
  { id: 'sniff', label: 'Sniff', options: [
    { id: 'walk', t: 'Sniff walk · 15–25 min', d: 'Quiet route. Let him sniff.' },
    { id: 'scatter', t: 'Scatter a meal', d: 'Scatter in the grass, or bowl up after 15 min.' },
  ] },
  { id: 'move', label: 'Move', options: [
    { id: 'tug', t: 'Tug with rules · 5 min', d: 'Sit → “Get it” → tug 10–15 sec → “Drop” → kibble.' },
    { id: 'outlet', t: 'Walk · 15–25 min', d: 'Slack leash; pay him at your side.' },
  ] },
  { id: 'think', label: 'Think', options: [
    { id: 'findit', t: 'Find it', d: 'Him on Place, hide 10 kibble in one room, “Find it!”' },
    { id: 'paycalm', t: 'Pay calm', d: 'He lies down quietly → toss kibble, no words. About 10 times.' },
  ] },
];

function Chips({ storageKey, seed, label, tone }: { storageKey: string; seed: string[]; label: string; tone?: string }) {
  const [list, save] = useList(storageKey, seed);
  return (
    <div className={`fc-chips ${tone || ''}`}>
      {list.map(t => (
        <span key={t} className="fc-chip">
          {t}
          <button type="button" aria-label={`Remove ${t}`} onClick={() => save(list.filter(x => x !== t))}>✕</button>
        </span>
      ))}
      <AddLine label={label} onAdd={t => !list.includes(t) && save([...list, t])} />
    </div>
  );
}

function Meals() {
  const week = mondayKey();
  const [state, setState] = useState(() => readSaved<{ week: string; meals: string[] }>('lifehub-focus-week-meals', { week, meals: [] }));
  const meals = state.week === week ? state.meals : [];
  const save = (next: string[]) => {
    const v = { week, meals: next };
    setState(v);
    writeSaved('lifehub-focus-week-meals', v);
  };
  const toggle = (m: string) => save(meals.includes(m) ? meals.filter(x => x !== m) : [...meals, m]);
  return (
    <>
      <p className="fc-sub">This week’s meals · from your Body recipes</p>
      <div className="fc-chips">
        {BODY_RECIPES.map(r => (
          <button key={r} type="button" className={`fc-pick${meals.includes(r) ? ' is-on' : ''}`} aria-pressed={meals.includes(r)} onClick={() => toggle(r)}>
            {r}
          </button>
        ))}
        {meals.filter(m => !BODY_RECIPES.includes(m)).map(m => (
          <button key={m} type="button" className="fc-pick is-on" onClick={() => toggle(m)}>{m}</button>
        ))}
        <AddLine label="Another meal" onAdd={t => !meals.includes(t) && save([...meals, t])} />
      </div>
    </>
  );
}

function MarvelMenu() {
  const [picked, setPicked] = useDayState<Record<string, string>>('lifehub-focus-marvel-pick', {});
  return (
    <div className="fc-menu">
      {MARVEL_MENU.map(g => (
        <div key={g.id} className="fc-menu-group">
          <b>{g.label}</b>
          <div className="fc-menu-opts">
            {g.options.map(o => (
              <button key={o.id} type="button" className={`fc-pick${picked[g.id] === o.id ? ' is-on' : ''}`} aria-pressed={picked[g.id] === o.id} onClick={() => setPicked({ ...picked, [g.id]: picked[g.id] === o.id ? '' : o.id })}>
                <span>{o.t}</span>
                <small>{o.d}</small>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function FocusSection({ enter }: { snapshots?: Snaps; enter: (id: SpaceId) => void }) {
  const day = useDayKey();
  return (
    <section className="focus-row" aria-label="Focus" data-day={day}>
      <div className="fc-col fc-short">
        <p className="fc-kicker">Short-term focus · right now</p>
        <EditableList storageKey="lifehub-focus-now" seed={[]} label="Type something that needs doing" />
        <hr className="fc-bar" />
        <p className="fc-kicker is-soft">Next few weeks</p>
        <EditableList storageKey="lifehub-focus-weeks" seed={[]} label="Type a short-term goal" />
      </div>

      <div className="fc-col fc-mid">
        <div className="fc-block fc-nut">
          <p className="fc-kicker">Nutrition flow</p>
          <Chips storageKey="lifehub-focus-nutrition-list" seed={[]} label="Focus: protein, water, veg…" />
          <Meals />
          <button type="button" className="fc-link" onClick={() => enter('logs')}>
            Log in the tracker →
          </button>
        </div>
        <div className="fc-block fc-fit">
          <p className="fc-kicker">Fitness · where I’m pushing</p>
          <Chips storageKey="lifehub-focus-fitness-list" seed={[]} label="Focus: abs, cardio, movement…" />
        </div>
      </div>

      <div className="fc-col fc-marvel">
        <p className="fc-kicker">Marvel · today</p>
        <MarvelMenu />
      </div>
    </section>
  );
}
