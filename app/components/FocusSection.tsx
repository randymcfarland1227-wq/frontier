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

function Checks({ storageKey, items }: { storageKey: string; items: { id: string; label: string; hint?: string; hot?: boolean }[] }) {
  const [done, setDone] = useDayState<string[]>(storageKey, []);
  const toggle = (id: string) => setDone(done.includes(id) ? done.filter(d => d !== id) : [...done, id]);
  return (
    <ul className="fc-checks">
      {items.map(i => (
        <li key={i.id}>
          <button type="button" className={`fc-check${done.includes(i.id) ? ' is-done' : ''}${i.hot ? ' is-hot' : ''}`} aria-pressed={done.includes(i.id)} onClick={() => toggle(i.id)}>
            <b aria-hidden="true">{done.includes(i.id) ? '✓' : ''}</b>
            <span>
              {i.label}
              {i.hint ? <small>{i.hint}</small> : null}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

const FITNESS_RE = /gym|cardio|abdominal|active pt|movement break|recovery:|walk, stretch/i;
const WALK_DAYS = [1, 5, 6]; // Mon, Fri, Sat — "Walk Marvel — Priority"

export function FocusSection({ snapshots, enter }: { snapshots: Snaps; enter: (id: SpaceId) => void }) {
  const day = useDayKey();
  const dow = new Date().getDay();
  const tt = snapshots.ticktick?.tasks || [];
  const dueToday = tt.filter(t => t.kind !== 'habit' && t.status !== 'done');
  const fitnessHabits = tt.filter(t => t.kind === 'habit' && FITNESS_RE.test(t.title)).map(t => ({ id: t.id, label: t.title.replace(/\s*[—-]\s*(Complete Flow|Follow PDF)$/i, '') }));
  const role = snapshots.role?.metrics || {};
  const moveOpen = (snapshots.move?.featured || []).length;
  const [water, setWater] = useDayState<number>('lifehub-focus-water', 0);
  const [note, setNote] = useDayState<string>('lifehub-focus-fit-note', '');
  const [nutFocus, setNutFocus] = useState(() => readSaved<string>('lifehub-focus-nutrition', 'Drink more water'));
  const [fitFocus, setFitFocus] = useState(() => readSaved<string>('lifehub-focus-fitness', 'Full movement and positioning'));
  const BOTTLES = 5;
  const dowName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dow];

  return (
    <section className="focus-row" aria-label="Focus" data-day={day}>
      {/* Left: short-term focus */}
      <div className="fc-col fc-short">
        <p className="fc-kicker">Short-term focus · needs doing</p>
        <ul className="fc-list is-live">
          {dueToday.slice(0, 4).map(t => (
            <li key={t.id}>
              <button type="button" className="fc-row-link" onClick={() => enter('ticktick')}>
                {t.title}
              </button>
              <small>TickTick today</small>
            </li>
          ))}
        </ul>
        <EditableList storageKey="lifehub-focus-now" seed={['Ticket matters', 'Role follow-ups']} label="Add something that needs doing" onTap={t => enter(/ticket/i.test(t) ? 'money' : /role|job|interview/i.test(t) ? 'role' : 'ticktick')} />
        <hr className="fc-bar" />
        <p className="fc-kicker is-soft">Next few weeks</p>
        <ul className="fc-goals">
          <li>
            <button type="button" onClick={() => enter('role')}>
              <b>Find a job</b>
              <small>
                {Number(role.ready) || 0} ready · {Number(role.pipeline) || 0} in pipeline · {Number(role.applied) || 0} applied
              </small>
            </button>
          </li>
          <li>
            <button type="button" onClick={() => enter('move')}>
              <b>Find a means to move</b>
              <small>{moveOpen ? `${moveOpen} starred in Move OS` : 'Move OS gates'}</small>
            </button>
          </li>
          <li>
            <button type="button" onClick={() => enter('money')}>
              <b>Fix credit</b>
              <small>Money → Credit & Outstanding</small>
            </button>
          </li>
        </ul>
      </div>

      {/* Middle: nutrition over fitness */}
      <div className="fc-col fc-mid">
        <div className="fc-block fc-nut">
          <p className="fc-kicker">Nutrition flow</p>
          <input className="fc-focus" value={nutFocus} aria-label="Nutrition focus" onChange={e => { setNutFocus(e.target.value); writeSaved('lifehub-focus-nutrition', e.target.value); }} />
          <div className="fc-bottles" role="group" aria-label="Bottles of water today">
            {Array.from({ length: BOTTLES }, (_, i) => (
              <button key={i} type="button" className={i < water ? 'is-on' : ''} aria-label={`Bottle ${i + 1}`} aria-pressed={i < water} onClick={() => setWater(i + 1 === water ? i : i + 1)} />
            ))}
            <span>
              {water}/{BOTTLES} bottles
            </span>
          </div>
          <p className="fc-sub">Meals I can make this week</p>
          <EditableList storageKey="lifehub-focus-meals" seed={[]} label="Add a meal" />
          <button type="button" className="fc-link" onClick={() => enter('logs')}>
            Log in macro tracker · 170 g protein →
          </button>
        </div>
        <div className="fc-block fc-fit">
          <p className="fc-kicker">Fitness</p>
          <input className="fc-focus" value={fitFocus} aria-label="Fitness focus" onChange={e => { setFitFocus(e.target.value); writeSaved('lifehub-focus-fitness', e.target.value); }} />
          <Checks
            storageKey="lifehub-focus-fit-done"
            items={(fitnessHabits.length ? fitnessHabits : [{ id: 'gym', label: 'Full Gym Session' }, { id: 'cardio', label: 'Cardio' }, { id: 'move', label: 'Movement break' }]).slice(0, 6)}
          />
          <input className="fc-note" value={note} placeholder={`${dowName}'s log: what I did, how it felt`} aria-label="Fitness log for today" onChange={e => setNote(e.target.value)} />
        </div>
      </div>

      {/* Right: Marvel */}
      <div className="fc-col fc-marvel">
        <p className="fc-kicker">Marvel · today’s care menu</p>
        <p className="fc-sub">Pick at least one meaningful option{WALK_DAYS.includes(dow) ? ' · walk day' : ''}</p>
        <Checks
          storageKey="lifehub-focus-marvel"
          items={[
            { id: 'sniff', label: 'Sniff', hint: 'Sniff walk 15–25 min, quiet route', hot: WALK_DAYS.includes(dow) },
            { id: 'move', label: 'Move', hint: 'Tug with rules, 5–10 min' },
            { id: 'think', label: 'Think', hint: 'Find it: hide 10 kibble' },
            { id: 'cuddle', label: 'Cuddle', hint: '20–30 min, just for him' },
            { id: 'brush', label: 'Brush', hint: 'Coat, daily AM' },
            { id: 'teeth', label: 'Teeth', hint: 'Weekly' },
            { id: 'supplies', label: 'Supplies', hint: 'Weekly count: food, treats, chews, toys' },
          ]}
        />
      </div>
    </section>
  );
}
