'use client';

import { createPortal } from 'react-dom';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  addDays,
  clashes,
  countdown,
  dayKey,
  dayName,
  eventEnd,
  eventStart,
  fromDayKey,
  googleCalendarLink,
  money,
  onDay,
  rangeLabel,
  sameDay,
  startOfDay,
  startOfWeek,
  timeLabel,
  type BillDue,
  type CalEvent,
  type CalTask,
  type ScheduleSnapshot,
} from '../../lib/schedule';
import { MONEY_KINDS } from '../../lib/money';
import { planSlot, usePlans, type Plan } from '../../lib/plans';
import { EVENTS_AHEAD_DAYS, eventCountdown, eventIcon, isAppointmentTitle, listKindOf, setEventMark, useEventMarks, type ListKind } from '../../lib/events';
import { readSaved, writeSaved } from '../../lib/storage';
import { BillsList } from './BillsList';
import { CalendarView, SEASON, type CalItem } from './CalendarView';

const PLAN_COLOR = '#7b4a68';
const EVENT_COLOR = '#b4532a';
const BILL_COLOR = '#a8632a';
const VIEW_KEY = 'lifehub-schedule-view';
const LAYERS_KEY = 'lifehub-schedule-layers';

/** Short tag for a money row: the pay-later provider, or Card / Sub / Bill. */
function moneyTag(due: BillDue) {
  const k = due.bill.kind;
  if (k === 'paylater') return due.bill.notes?.split(' · ')[1] || 'Pay later';
  if (k === 'plan') return 'Planned';
  if (k === 'card') return 'Card';
  if (k === 'sub') return 'Sub';
  return 'Bill';
}
const billColor = (due: BillDue) => (due.bill.kind ? MONEY_KINDS[due.bill.kind].color : BILL_COLOR);
const TASK_COLOR = '#2f6f6a';

/** Default day for a prep task: the day before the event (or the event day if that's already past). */
function prepDefault(eventDay: string) {
  const before = dayKey(addDays(fromDayKey(eventDay), -1));
  return before >= dayKey(new Date()) ? before : eventDay;
}

/** Prep tasks under an event / maybe-plan ("Change oil" before the game), with a quick add. */
function PrepList({
  target,
  tasks,
  onAdd,
  onDone,
}: {
  target: { id: string; title: string; date: string };
  tasks: CalTask[];
  onAdd?: (target: { id: string; title: string; date: string }, title: string, due?: string) => void;
  onDone?: (t: CalTask) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [due, setDue] = useState(() => prepDefault(target.date));
  if (!onAdd && !tasks.length) return null;
  return (
    <div className="prep">
      {tasks.length ? (
        <ul className="prep-list">
          {tasks.map(t => (
            <li key={t.id} className={t.done ? 'is-done' : ''}>
              <label>
                <input type="checkbox" checked={t.done} disabled={!onDone || !t.selfId} onChange={() => onDone?.(t)} />
                <span>{t.title}</span>
              </label>
              <small>{t.date === target.date ? 'same day' : dayName(fromDayKey(t.date))}</small>
            </li>
          ))}
        </ul>
      ) : null}
      {onAdd ? (
        adding ? (
          <form
            className="prep-add"
            onSubmit={e => {
              e.preventDefault();
              if (!title.trim()) return;
              onAdd(target, title.trim(), due || undefined);
              setTitle('');
              setAdding(false);
            }}
          >
            <input autoFocus value={title} onChange={e => setTitle(e.target.value)} placeholder="What needs doing first? e.g. Change oil" aria-label="Prep task" />
            <input type="date" value={due} max={target.date} onChange={e => setDue(e.target.value)} aria-label="Do it by" title="Do it by" />
            <button type="submit" className="row-action" disabled={!title.trim()}>
              Add
            </button>
            <button type="button" className="row-action ghost" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </form>
        ) : (
          <button type="button" className="prep-open" onClick={() => setAdding(true)}>
            + Prep task{tasks.length ? '' : ' (something to do before this)'}
          </button>
        )
      ) : null}
    </div>
  );
}

type Slot = { start: string; end: string; allDay?: boolean };

/** "Clashes with Dentist (2–3pm)" / "Free then" — how a maybe fits the confirmed schedule. */
function fitText(slot: Slot, events: CalEvent[], ignoreId?: string) {
  const hits = clashes(slot, events, ignoreId);
  if (hits.length) {
    const first = hits[0];
    return {
      tone: 'is-clash',
      text: `Clashes with ${first.title} (${rangeLabel(first)})${hits.length > 1 ? ` +${hits.length - 1} more` : ''}`,
    };
  }
  const day = sameDay(slot, events, ignoreId);
  if (slot.allDay) {
    return day.length
      ? { tone: 'is-busy', text: `That day: ${day.slice(0, 2).map(e => `${e.title}${e.allDay ? '' : ` ${timeLabel(eventStart(e))}`}`).join(', ')}${day.length > 2 ? ` +${day.length - 2}` : ''}` }
      : { tone: 'is-free', text: 'Nothing else that day' };
  }
  return { tone: 'is-free', text: day.length ? `Free then · ${day.length} other thing${day.length === 1 ? '' : 's'} that day` : 'Free then · nothing else that day' };
}

function whenText(slot: Slot) {
  return `${dayName(eventStart(slot))}${slot.allDay ? '' : ` · ${rangeLabel(slot)}`}`;
}

const isConfirmed = (e: CalEvent) => e.myStatus === 'owner' || e.myStatus === 'yes';
const isUnanswered = (e: CalEvent) => e.myStatus === 'invited' || e.myStatus === 'maybe';

function PlanForm({ onDone, date: initialDate }: { onDone: () => void; date?: string }) {
  const { add } = usePlans();
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(() => initialDate || dayKey(new Date()));
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [note, setNote] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !date) return;
    add({ title, date, from, to, note });
    onDone();
  };
  return (
    <form
      className="plan-form"
      onSubmit={submit}
      onKeyDown={e => {
        if (e.key !== 'Escape') return;
        e.stopPropagation();
        onDone();
      }}
    >
      <label className="plan-form-wide">
        <span>What</span>
        <input autoFocus value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Jess's birthday dinner" required />
      </label>
      <label>
        <span>Day</span>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} required />
      </label>
      <label>
        <span>From</span>
        <input type="time" value={from} onChange={e => setFrom(e.target.value)} />
      </label>
      <label>
        <span>To</span>
        <input type="time" value={to} onChange={e => setTo(e.target.value)} />
      </label>
      <label className="plan-form-wide">
        <span>Who asked / notes</span>
        <input value={note} onChange={e => setNote(e.target.value)} placeholder="Optional" />
      </label>
      <div className="plan-form-actions">
        <button type="submit" className="row-action">
          Add maybe
        </button>
        <button type="button" className="row-action ghost" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** Upcoming: the next 7 days, grouped by day. With `bills`, bills sit on their due day too. */
function Agenda({
  events,
  bills,
  tasks,
  schedule,
  onShow,
  limit = 8,
}: {
  events: CalEvent[];
  bills?: BillDue[];
  tasks?: CalTask[];
  schedule: ScheduleSnapshot | null;
  onShow: (date: string, id?: string) => void;
  limit?: number;
}) {
  const today = startOfDay(new Date());
  const now = new Date();
  const weekOut = addDays(today, 8);
  type Row = { key: string; day: string; sort: number; event?: CalEvent; bill?: BillDue; task?: CalTask };
  const rows: Row[] = events
    .filter(e => isConfirmed(e) && eventEnd(e) > now && eventStart(e) < weekOut)
    .map(e => {
      const day = dayKey(eventStart(e) < today ? today : eventStart(e));
      return { key: e.id, day, sort: e.allDay ? 0 : eventStart(e).getTime(), event: e };
    });
  // Bills due this week (overdue ones sit on today).
  for (const b of bills || []) {
    if (b.days > 7) continue;
    // Money from the sheet is never "overdue" — past ones stay on their day in the calendar.
    if (b.bill.kind && b.days < 0) continue;
    rows.push({ key: b.key, day: b.days < 0 ? dayKey(today) : b.due, sort: -1, bill: b });
  }
  for (const t of tasks || []) {
    if (t.done) continue;
    const d = fromDayKey(t.date);
    if (d < today || d >= weekOut) continue;
    rows.push({ key: `task:${t.id}`, day: t.date, sort: -2, task: t });
  }
  rows.sort((a, b) => a.day.localeCompare(b.day) || a.sort - b.sort);
  const shown = rows.slice(0, limit);
  const byDay = new Map<string, Row[]>();
  for (const r of shown) byDay.set(r.day, [...(byDay.get(r.day) || []), r]);

  if (!rows.length) {
    return <p className="sched-empty">{schedule ? 'Nothing coming up this week.' : 'Shows your next 7 days once Google Calendar is connected.'}</p>;
  }
  return (
    <ol className="agenda">
      {[...byDay.entries()].map(([k, list]) => (
        <li key={k}>
          <button type="button" className="agenda-day" onClick={() => onShow(k)}>
            {dayName(fromDayKey(k))}
          </button>
          <ul>
            {list.map(r =>
              r.task ? (
                <li key={r.key}>
                  <button type="button" className="agenda-item agenda-task" style={{ '--ev': TASK_COLOR } as React.CSSProperties} onClick={() => onShow(r.day)}>
                    <span className="agenda-time">Task</span>
                    <span className="agenda-title">
                      {r.task.title}
                      {r.task.forEvent ? <span className="agenda-sub"> · for {r.task.forEvent.title}</span> : null}
                    </span>
                  </button>
                </li>
              ) : r.event ? (
                <li key={r.key}>
                  <button
                    type="button"
                    className="agenda-item"
                    style={r.event.color ? ({ '--ev': r.event.color } as React.CSSProperties) : undefined}
                    onClick={() => onShow(r.day, r.event!.id)}
                  >
                    <span className="agenda-time">{r.event.allDay ? 'All day' : timeLabel(eventStart(r.event))}</span>
                    <span className="agenda-title">{r.event.title}</span>
                  </button>
                </li>
              ) : (
                <li key={r.key}>
                  <span
                    className={`agenda-item agenda-bill${r.bill!.bill.kind ? ` is-money kind-${r.bill!.bill.kind}` : ''}${r.bill!.days < 0 ? ' is-overdue' : r.bill!.days <= 3 && !r.bill!.bill.kind ? ' is-soon' : ''}`}
                    style={{ '--ev': billColor(r.bill!) } as React.CSSProperties}
                  >
                    <span className="agenda-time">{r.bill!.days < 0 ? 'Overdue' : moneyTag(r.bill!)}</span>
                    <span className="agenda-title">
                      <span className="agenda-name">{r.bill!.bill.name}</span>
                      <span className="agenda-sub">
                        {[money(r.bill!.bill.amount), r.bill!.bill.kind === 'paylater' ? r.bill!.bill.notes?.split(' · ')[2] : '', countdown(r.bill!.days)].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    {r.bill!.bill.payUrl ? (
                      <a className="agenda-pay" href={r.bill!.bill.payUrl} target="_blank" rel="noopener noreferrer" aria-label={`Pay ${r.bill!.bill.name}`}>
                        Pay ↗
                      </a>
                    ) : null}
                  </span>
                </li>
              ),
            )}
          </ul>
        </li>
      ))}
      {rows.length > limit ? <li className="sched-more">+{rows.length - limit} more this week — open a day on the calendar</li> : null}
    </ol>
  );
}

/** Short date for an Events row: "Sat, Oct 11" or "Fri, Oct 10 – Sun, Oct 12" for multi-day. */
function eventDates(slot: Slot) {
  const fmt = (d: Date) => d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  const start = eventStart(slot);
  // All-day ends are exclusive (the day after); timed ends are the real end.
  // (a party ending at midnight is still one day)
  const last = slot.allDay ? addDays(fromDayKey(slot.end.slice(0, 10)), -1) : new Date(eventEnd(slot).getTime() - 1);
  const multi = dayKey(last) > dayKey(start);
  return `${fmt(start)}${multi ? ` – ${fmt(last)}` : slot.allDay ? '' : ` · ${timeLabel(start)}`}`;
}

function EventForm({ onDone, appt }: { onDone: () => void; appt?: boolean }) {
  const { addEvent } = usePlans();
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(() => dayKey(new Date()));
  const [endDate, setEndDate] = useState('');
  const [note, setNote] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !date) return;
    addEvent({ title, date, endDate, note, kind: appt ? 'appointment' : 'event' });
    onDone();
  };
  return (
    <form
      className="plan-form"
      onSubmit={submit}
      onKeyDown={e => {
        if (e.key !== 'Escape') return;
        e.stopPropagation();
        onDone();
      }}
    >
      <label className="plan-form-wide">
        <span>{appt ? 'Appointment' : 'Event'}</span>
        <input autoFocus value={title} onChange={e => setTitle(e.target.value)} placeholder={appt ? 'e.g. Dentist — cleaning' : 'e.g. Trip to Morgantown'} required />
      </label>
      <label>
        <span>{appt ? 'Date' : 'From'}</span>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} required />
      </label>
      {appt ? null : (
        <label>
          <span>To (optional)</span>
          <input type="date" value={endDate} min={date} onChange={e => setEndDate(e.target.value)} />
        </label>
      )}
      <label className="plan-form-wide">
        <span>Note</span>
        <input value={note} onChange={e => setNote(e.target.value)} placeholder={appt ? 'Time, place — optional' : 'Optional'} />
      </label>
      <div className="plan-form-actions">
        <button type="submit" className="row-action">
          {appt ? 'Add appointment' : 'Add event'}
        </button>
        <button type="button" className="row-action ghost" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/**
 * Events: trips, parties, showers, appointments… over the next few months, apart from the
 * everyday calendar. Google events are picked automatically (see lib/events.ts); ✕ hides one,
 * ☆ in a day's pop-out adds one, and "+ Add an event" covers things not in Google Calendar.
 */
function EventsList({
  list = 'event',
  events,
  plans,
  onShow,
  onDropPlan,
}: {
  list?: ListKind;
  events: CalEvent[];
  plans: Plan[];
  onShow: (date: string, id?: string) => void;
  onDropPlan: (p: Plan) => void;
}) {
  const marks = useEventMarks();
  const appt = list === 'appt';
  const [adding, setAdding] = useState(false);
  const now = new Date();
  const horizon = addDays(startOfDay(now), EVENTS_AHEAD_DAYS);
  type Row = { id: string; title: string; slot: Slot; note?: string; url?: string; plan?: Plan };
  const rows: Row[] = [
    ...events
      .filter(e => listKindOf(e, marks) === list && eventEnd(e) > now && eventStart(e) < horizon)
      .map(e => ({ id: e.id, title: e.title, slot: e as Slot, note: e.location, url: e.url })),
    ...plans
      .filter(p => (p.kind === 'appointment' ? 'appt' : p.kind) === list && p.status === 'yes')
      .map(p => ({ id: p.id, title: p.title, slot: planSlot(p) as Slot, note: p.note, plan: p }))
      .filter(r => eventEnd(r.slot) > now && eventStart(r.slot) < horizon),
  ].sort((a, b) => eventStart(a.slot).getTime() - eventStart(b.slot).getTime());

  return (
    <>
      {rows.length ? (
        <ul className="events-list">
          {rows.map(r => {
            const start = eventStart(r.slot);
            const soon = eventCountdown(start, now);
            return (
              <li key={r.id} className={`event-row${soon === 'Now' || soon === 'Tomorrow' || soon === 'This weekend' ? ' is-soon' : ''}`}>
                <button type="button" className="event-main" onClick={() => onShow(dayKey(start < startOfDay(now) ? now : start), r.id)} title={[r.title, r.note].filter(Boolean).join(' — ')}>
                  <span className="event-icon" aria-hidden="true">
                    {eventIcon(r.title)}
                  </span>
                  <span className="event-text">
                    <strong>{r.title}</strong>
                    <span className="event-when">{eventDates(r.slot)}</span>
                  </span>
                  <span className="event-soon">{soon}</span>
                </button>
                {r.plan ? (
                  <a
                    className="event-tool"
                    href={googleCalendarLink({ title: r.title, ...r.slot, details: r.note })}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Add to Google Calendar"
                    aria-label={`Add ${r.title} to Google Calendar`}
                  >
                    ↗
                  </a>
                ) : null}
                <button
                  type="button"
                  className="event-tool"
                  onClick={() => (r.plan ? onDropPlan(r.plan) : setEventMark(r.id, 'hide'))}
                  title={`Remove from ${appt ? 'Appointments' : 'Events'}`}
                  aria-label={`Remove ${r.title} from ${appt ? 'Appointments' : 'Events'}`}
                >
                  ✕
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="sched-empty">
          {appt ? 'No appointments coming up.' : 'No trips or events coming up. Add one, or press ☆ on anything in a day\'s pop-out.'}
        </p>
      )}
      {adding ? (
        <EventForm appt={appt} onDone={() => setAdding(false)} />
      ) : (
        <button type="button" className="sched-add" onClick={() => setAdding(true)}>
          {appt ? '+ Add an appointment' : '+ Add an event'}
        </button>
      )}
    </>
  );
}

/** Needs to confirm: Google invitations not answered yet + maybe-plans, each with how it fits. */
function MaybeList({
  invites,
  plans,
  events,
  onShow,
  onAnswer,
}: {
  invites: CalEvent[];
  plans: Plan[];
  events: CalEvent[];
  onShow: (date: string, id?: string) => void;
  onAnswer: (p: Plan, yes: boolean) => void;
}) {
  const [adding, setAdding] = useState(false);
  const today = startOfDay(new Date());
  return (
    <>
      {invites.length || plans.length ? (
        <ul className="maybe-list">
          {invites.map(e => {
            const fit = fitText(e, events, e.id);
            return (
              <li key={e.id} className="maybe-row">
                <button type="button" className="maybe-main" onClick={() => onShow(dayKey(eventStart(e)), e.id)}>
                  <strong>{e.title}</strong>
                  <span className="maybe-when">
                    {whenText(e)} · {e.myStatus === 'maybe' ? 'you said maybe' : `invited${e.organizer ? ` by ${e.organizer}` : ''}`}
                  </span>
                  <span className={`maybe-fit ${fit.tone}`}>{fit.text}</span>
                </button>
                {e.url ? (
                  <a className="row-action ghost" href={e.url} target="_blank" rel="noopener noreferrer" aria-label={`Reply to ${e.title} in Google Calendar`}>
                    Reply ↗
                  </a>
                ) : null}
              </li>
            );
          })}
          {plans.map(p => {
            const slot = planSlot(p);
            const past = eventEnd(slot) < today;
            const fit = fitText(slot, events);
            return (
              <li key={p.id} className={`maybe-row is-plan${past ? ' is-past' : ''}`}>
                <button type="button" className="maybe-main" onClick={() => onShow(p.date, p.id)}>
                  <strong>{p.title}</strong>
                  <span className="maybe-when">
                    {whenText(slot)}
                    {p.note ? ` · ${p.note}` : ''}
                  </span>
                  {past ? <span className="maybe-fit is-busy">That date has passed</span> : <span className={`maybe-fit ${fit.tone}`}>{fit.text}</span>}
                </button>
                <span className="maybe-actions">
                  {past ? null : (
                    <button type="button" className="row-action" onClick={() => onAnswer(p, true)} title="Opens Google Calendar with it filled in" aria-label={`Yes to ${p.title}: add it to Google Calendar`}>
                      Yes
                    </button>
                  )}
                  <button type="button" className="row-action ghost" onClick={() => onAnswer(p, false)} aria-label={past ? `Clear ${p.title}` : `No to ${p.title}`}>
                    {past ? 'Clear' : 'No'}
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="sched-empty">Nothing waiting on an answer. Add something you&apos;ve been asked to, to see how it fits.</p>
      )}
      {adding ? (
        <PlanForm onDone={() => setAdding(false)} />
      ) : (
        <button type="button" className="sched-add" onClick={() => setAdding(true)}>
          + Add a maybe
        </button>
      )}
    </>
  );
}

const thisMonth = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1);
};

/** ◀ October 2026 Today ▶ — sits in the Schedule header so the month gets the room. */
function MonthNav({ month, setMonth }: { month: Date; setMonth: (fn: (m: Date) => Date) => void }) {
  return (
    <div className="mini-bar">
      <button type="button" className="row-action ghost" onClick={() => setMonth(m => new Date(m.getFullYear(), m.getMonth() - 1, 1))} aria-label="Previous month">
        ◀
      </button>
      <h3 className="mini-title" aria-live="polite">
        <span className="mini-long">{month.toLocaleDateString([], { month: 'long', year: 'numeric' })}</span>
        <span className="mini-short">
          {month.toLocaleDateString([], { month: 'short', year: 'numeric' })}
        </span>
      </h3>
      <button type="button" className="row-action ghost" onClick={() => setMonth(() => thisMonth())}>
        Today
      </button>
      <button type="button" className="row-action ghost" onClick={() => setMonth(m => new Date(m.getFullYear(), m.getMonth() + 1, 1))} aria-label="Next month">
        ▶
      </button>
    </div>
  );
}

/** Month at a glance: two lines per day; pick a day to see all of it. */
function MonthMini({ month, items, picked, onPick }: { month: Date; items: CalItem[]; picked?: string; onPick: (day: string, cell: HTMLElement) => void }) {
  const today = dayKey(new Date());
  const start = startOfWeek(month);
  const weeks = Math.ceil((month.getDay() + new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()) / 7);
  const cells = Array.from({ length: weeks * 7 }, (_, i) => addDays(start, i));
  const names = cells.slice(0, 7).map(d => d.toLocaleDateString([], { weekday: 'narrow' }));
  return (
    <div className="mini">
      <div className="mini-grid">
        {names.map((n, i) => (
          <span key={i} className="mini-name" aria-hidden="true">
            {n}
          </span>
        ))}
        {cells.map(d => {
          const k = dayKey(d);
          const dayItems = items
            .filter(it => onDay(it, d))
            .sort((a, b) => Number(b.allDay) - Number(a.allDay) || eventStart(a).getTime() - eventStart(b).getTime());
          const label = `${d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}: ${
            dayItems.length ? `${dayItems.length} thing${dayItems.length === 1 ? '' : 's'}` : 'nothing'
          }`;
          return (
            <button
              key={k}
              type="button"
              className={`mini-cell${d.getMonth() !== month.getMonth() ? ' is-other' : ''}${k === today ? ' is-today' : ''}${k === picked ? ' is-picked' : ''}${
                dayItems.some(i => i.kind === 'plan' || i.kind === 'invite') ? ' has-maybe' : ''
              }`}
              onClick={e => onPick(k, e.currentTarget)}
              aria-label={label}
              aria-haspopup="dialog"
            >
              <span className="mini-day">{d.getDate()}</span>
              {/* Two lines per day: two titles, or one title and "+N". */}
              {dayItems.slice(0, dayItems.length > 2 ? 1 : 2).map(it => (
                <span
                  key={it.id}
                  className={`mini-item kind-${it.kind}`}
                  style={it.color ? ({ '--ev': it.color } as React.CSSProperties) : undefined}
                >
                  {it.kind === 'bill' ? '$ ' : it.kind === 'task' ? (it.task?.done ? '✓ ' : '☐ ') : ''}
                  {it.title}
                </span>
              ))}
              {dayItems.length > 2 ? <span className="mini-more">+{dayItems.length - 1} more</span> : null}
              <span className="mini-dots" aria-hidden="true">
                {dayItems.slice(0, 4).map(it => (
                  <i key={it.id} className={`kind-${it.kind}`} style={it.color ? ({ '--ev': it.color } as React.CSSProperties) : undefined} />
                ))}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Pop-out for one day: everything on it, with the same actions as the lists. */
/** ☆ / ★ in a day's pop-out: show this event in Events (or take it out). */
function EventStar({ event }: { event: CalEvent }) {
  const marks = useEventMarks();
  const kind = listKindOf(event, marks);
  const on = kind !== null;
  const name = (kind ?? (isAppointmentTitle(event.title) ? 'appt' : 'event')) === 'appt' ? 'Appointment' : 'Event';
  const listName = name === 'Appointment' ? 'Appointments' : 'Events';
  return (
    <button
      type="button"
      className={`row-action ghost event-star${on ? ' is-on' : ''}`}
      aria-pressed={on}
      onClick={() => setEventMark(event.id, on ? 'hide' : name === 'Appointment' ? 'appt' : 'event')}
      title={on ? `In ${listName} — click to take it out` : `Show in ${listName}`}
      aria-label={on ? `Take ${event.title} out of ${listName}` : `Show ${event.title} in ${listName}`}
    >
      {on ? `★ ${name}` : `☆ ${name}`}
    </button>
  );
}

function DayPopover({
  day,
  pos,
  items,
  events,
  plans,
  onAnswer,
  onBillPaid,
  tasks,
  onTaskDone,
  onAddPrep,
  onWeek,
  onClose,
}: {
  day: string;
  pos: { top: number; left: number; above: boolean; maxHeight?: number };
  items: CalItem[];
  events: CalEvent[];
  plans: Plan[];
  onAnswer: (p: Plan, yes: boolean) => void;
  onBillPaid: (due: BillDue) => void;
  tasks: CalTask[];
  onTaskDone?: (t: CalTask) => void;
  onAddPrep?: (target: { id: string; title: string; date: string }, title: string, due?: string) => void;
  onWeek: (day: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLHeadingElement>(null);
  const [adding, setAdding] = useState(false);
  const closeLatest = useRef(onClose);
  useEffect(() => {
    closeLatest.current = onClose;
  }, [onClose]);
  useEffect(() => {
    headRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeLatest.current();
    // Close on a click outside (a click on another day re-opens it there).
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (ref.current && t && !ref.current.contains(t) && !t.closest('.mini-cell')) closeLatest.current();
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [day]);

  const date = fromDayKey(day);
  const dayItems = items
    .filter(it => onDay(it, date))
    .sort((a, b) => Number(b.allDay) - Number(a.allDay) || eventStart(a).getTime() - eventStart(b).getTime());
  const title = date.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  const rel = dayName(date);
  const heading = ['Today', 'Tomorrow', 'Yesterday'].includes(rel) ? `${rel} · ${title}` : title;

  void pos;
  const host = typeof document !== 'undefined' ? document.querySelector('.frontier-shell') || document.body : null;
  if (!host) return null;
  return createPortal(
    <>
    <div className="day-pop-backdrop" aria-hidden="true" />
    <div
      ref={ref}
      className="day-pop is-modal"
      role="dialog"
      aria-modal="true"
      aria-label={heading}
    >
      <div className="day-pop-head">
        <h3 ref={headRef} tabIndex={-1}>
          {heading}
        </h3>
        <button type="button" className="plan-panel-close" onClick={onClose} aria-label="Close day">
          ×
        </button>
      </div>
      {dayItems.length ? (
        <ul className="day-pop-list">
          {dayItems.map(it => {
            const plan = it.kind === 'plan' ? plans.find(p => p.id === it.id) : undefined;
            const fit = it.kind === 'plan' || it.kind === 'invite' ? fitText(it, events, it.id) : null;
            return (
              <li key={it.id} className={`day-pop-row kind-${it.kind}`} style={it.color ? ({ '--ev': it.color } as React.CSSProperties) : undefined}>
                <span className="day-pop-time">{it.kind === 'bill' ? 'Bill' : it.kind === 'task' ? 'Task' : it.allDay ? 'All day' : timeLabel(eventStart(it))}</span>
                <span className="day-pop-main">
                  <strong>{it.title}</strong>
                  <span className="day-pop-sub">
                    {it.kind === 'bill' && it.bill
                      ? [
                          money(it.bill.bill.amount),
                          it.bill.bill.notes,
                          it.bill.bill.kind && it.bill.days < 0 ? 'Earlier' : countdown(it.bill.days),
                          it.bill.bill.autopay ? 'Autopay' : '',
                        ]
                          .filter(Boolean)
                          .join(' · ')
                      : [it.allDay ? '' : rangeLabel(it), it.sub].filter(Boolean).join(' · ')}
                  </span>
                  {fit ? <span className={`maybe-fit ${fit.tone}`}>{fit.text}</span> : null}
                  {it.kind === 'event' || it.kind === 'invite' || it.kind === 'plan' ? (
                    <PrepList
                      target={{ id: it.id, title: it.title, date: dayKey(eventStart(it)) }}
                      tasks={tasks.filter(t => t.forEvent?.id === it.id)}
                      onAdd={onAddPrep}
                      onDone={onTaskDone}
                    />
                  ) : null}
                </span>
                <span className="day-pop-actions">
                  {plan ? (
                    <>
                      <button type="button" className="row-action" onClick={() => onAnswer(plan, true)} aria-label={`Yes to ${plan.title}: add it to Google Calendar`}>
                        Yes
                      </button>
                      <button type="button" className="row-action ghost" onClick={() => onAnswer(plan, false)} aria-label={`No to ${plan.title}`}>
                        No
                      </button>
                    </>
                  ) : null}
                  {it.kind === 'bill' && it.bill ? (
                    <>
                      {it.url ? (
                        <a className="row-action" href={it.url} target="_blank" rel="noopener noreferrer" aria-label={`Pay ${it.title}`}>
                          Pay ↗
                        </a>
                      ) : null}
                      <button type="button" className="row-action ghost" onClick={() => onBillPaid(it.bill!)} aria-label={`Mark ${it.title} paid`}>
                        Paid
                      </button>
                    </>
                  ) : null}
                  {it.kind === 'task' && it.task?.selfId && onTaskDone ? (
                    <button type="button" className={it.task.done ? 'row-action ghost' : 'row-action'} onClick={() => onTaskDone(it.task!)}>
                      {it.task.done ? 'Undo' : 'Done'}
                    </button>
                  ) : null}
                  {it.kind === 'event' && events.some(e => e.id === it.id) ? (
                    <EventStar event={events.find(e => e.id === it.id)!} />
                  ) : null}
                  {(it.kind === 'event' || it.kind === 'invite') && it.url ? (
                    <a className="row-action ghost" href={it.url} target="_blank" rel="noopener noreferrer" aria-label={`${it.kind === 'invite' ? 'Reply to' : 'Open'} ${it.title} in Google Calendar`}>
                      {it.kind === 'invite' ? 'Reply ↗' : 'Open ↗'}
                    </a>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="sched-empty">Nothing planned this day.</p>
      )}
      {adding ? (
        <PlanForm date={day} onDone={() => setAdding(false)} />
      ) : (
        <div className="day-pop-foot">
          <button type="button" className="sched-add" onClick={() => setAdding(true)}>
            + Add a maybe this day
          </button>
          <button type="button" className="row-action ghost" onClick={() => onWeek(day)}>
            See the week →
          </button>
        </div>
      )}
    </div>
    </>,
    host,
  );
}

/**
 * Schedule, at the very top. Default view: Upcoming | Needs to confirm | month calendar (pick a
 * day for a pop-out). Expanded view: the rail (Coming up, Not confirmed yet, Bills due) beside a
 * week / month calendar with times.
 */
export function ScheduleSection({
  schedule,
  bills,
  onBillPaid,
  tasks = [],
  onTaskDone,
  onAddPrep,
}: {
  schedule: ScheduleSnapshot | null;
  bills: BillDue[];
  onBillPaid: (due: BillDue) => void;
  /** Dated Self tasks and Priority items (calendar only) */
  tasks?: CalTask[];
  onTaskDone?: (t: CalTask) => void;
  onAddPrep?: (target: { id: string; title: string; date: string }, title: string, due?: string) => void;
}) {
  const { plans, update } = usePlans();
  const [expanded, setExpanded] = useState(() => readSaved<string>(VIEW_KEY, 'compact') === 'expanded');
  const [selected, setSelected] = useState<CalItem | null>(null);
  const [focus, setFocus] = useState<{ date: string; nonce: number } | undefined>();
  const [pop, setPop] = useState<{ day: string; top: number; left: number; above: boolean; maxHeight?: number } | null>(null);
  const [month, setMonth] = useState(thisMonth);
  const [layers, setLayers] = useState(() => ({ tasks: true, ...readSaved<{ google: boolean; money: boolean; tasks?: boolean }>(LAYERS_KEY, { google: true, money: true }) }));
  const toggleLayer = (k: 'google' | 'money' | 'tasks') =>
    setLayers(l => {
      const next = { ...l, [k]: !l[k] };
      writeSaved(LAYERS_KEY, next);
      return next;
    });
  const monthBox = useRef<HTMLDivElement>(null);
  const events = useMemo(() => (layers.google ? schedule?.events || [] : []), [schedule, layers.google]);
  const shownBills = useMemo(() => (layers.money ? bills : []), [bills, layers.money]);
  const shownTasks = useMemo(() => (layers.tasks ? tasks : []), [tasks, layers.tasks]);
  const today = startOfDay(new Date());

  const openPlans = plans.filter(p => p.status === 'open').sort((a, b) => a.date.localeCompare(b.date) || (a.from || '').localeCompare(b.from || ''));
  const invites = events.filter(e => isUnanswered(e) && eventEnd(e) >= today).sort((a, b) => eventStart(a).getTime() - eventStart(b).getTime());

  const items: CalItem[] = useMemo(() => {
    const out: CalItem[] = events.map(e => ({
      id: e.id,
      kind: isUnanswered(e) ? 'invite' : 'event',
      title: e.title,
      start: e.start,
      end: e.end,
      allDay: e.allDay,
      color: e.color,
      url: e.url,
      sub: [e.calendar, e.location, e.myStatus === 'invited' ? `Invited${e.organizer ? ` by ${e.organizer}` : ''}` : e.myStatus === 'maybe' ? 'You said maybe' : '']
        .filter(Boolean)
        .join(' · '),
    }));
    for (const p of plans.filter(p => p.status === 'open')) {
      out.push({ id: p.id, kind: 'plan', title: p.title, ...planSlot(p), color: PLAN_COLOR, sub: p.note });
    }
    // Events added on Life Hub (Schedule → Events) sit on the calendar like confirmed events.
    for (const p of plans.filter(p => (p.kind === 'event' || p.kind === 'appointment') && p.status === 'yes')) {
      out.push({ id: p.id, kind: 'event', title: p.title, ...planSlot(p), color: EVENT_COLOR, sub: ['Added on Life Hub', p.note].filter(Boolean).join(' · ') });
    }
    for (const b of shownBills) {
      out.push({
        id: b.key,
        kind: 'bill',
        title: b.bill.name,
        start: b.due,
        end: dayKey(addDays(fromDayKey(b.due), 1)),
        allDay: true,
        color: billColor(b),
        url: b.bill.payUrl,
        sub: b.bill.notes,
        bill: b,
      });
    }
    for (const t of shownTasks) {
      out.push({
        id: `task:${t.id}`,
        kind: 'task',
        title: t.title,
        start: t.date,
        end: dayKey(addDays(fromDayKey(t.date), 1)),
        allDay: true,
        color: TASK_COLOR,
        sub: [t.kind === 'priority' ? `Priority${t.sourceName ? ` · ${t.sourceName}` : ''}` : 'Self task', t.forEvent ? `for ${t.forEvent.title}` : '']
          .filter(Boolean)
          .join(' · '),
        task: t,
      });
    }
    return out;
  }, [events, plans, shownBills, shownTasks]);

  const setView = (next: boolean) => {
    setExpanded(next);
    setPop(null);
    writeSaved(VIEW_KEY, next ? 'expanded' : 'compact');
  };

  /** Open a day's pop-out under (or above) its cell, kept inside the month box. */
  const openDay = (day: string, cell?: HTMLElement | null) => {
    const box = monthBox.current;
    const target = cell || box?.querySelector<HTMLElement>(`.mini-cell[aria-label^="${fromDayKey(day).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}"]`);
    if (!box || !target) {
      setPop({ day, top: 0, left: 0, above: false });
      return;
    }
    // Layout units (offsets), not screen pixels: the page zoom (Auto 112% / 125%) would skew them.
    let x = 0;
    let y = 0;
    for (let el: HTMLElement | null = target; el && el !== box; el = el.offsetParent as HTMLElement | null) {
      x += el.offsetLeft;
      y += el.offsetTop;
    }
    const width = Math.min(360, box.offsetWidth);
    const left = Math.max(0, Math.min(x + target.offsetWidth / 2 - width / 2, box.offsetWidth - width));
    // Open toward the roomier side and stay inside the calendar box (scrolls if it's a busy day).
    const below = box.offsetHeight - (y + target.offsetHeight) - 12;
    const above = y - 12 > below;
    const room = Math.max(200, above ? y - 12 : below);
    setPop({ day, left, top: above ? y - 6 : y + target.offsetHeight + 6, above, maxHeight: room });
  };

  // From the lists: compact view opens that day's pop-out; expanded view jumps the week there.
  const show = (date: string, id?: string) => {
    if (!expanded) {
      openDay(date);
      return;
    }
    setFocus(f => ({ date, nonce: (f?.nonce || 0) + 1 }));
    if (id) setSelected(items.find(i => i.id === id) || null);
  };

  const answer = (p: Plan, yes: boolean) => {
    if (yes) window.open(googleCalendarLink({ title: p.title, ...planSlot(p), details: p.note }), '_blank', 'noopener');
    update(p.id, { status: yes ? 'yes' : 'no' });
    if (selected?.id === p.id) setSelected(null);
  };

  const selPlan = selected?.kind === 'plan' ? plans.find(p => p.id === selected.id) : undefined;
  const selEvent = selected && (selected.kind === 'event' || selected.kind === 'invite') ? events.find(e => e.id === selected.id) : undefined;
  const maybeCount = openPlans.length + invites.length;

  return (
    <section className={`schedule glass-panel${expanded ? ' is-expanded' : ' is-compact'}`} aria-label="Schedule">
      <div className="sched-head">
        <p className="section-label">Schedule</p>
        <h2>Calendar</h2>
        <p className="sched-sync">
          {schedule ? `Google Calendar · updated ${new Date(schedule.refreshedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Google Calendar not connected yet'}
        </p>
        <div className="layer-chips" role="group" aria-label="Show on the calendar">
          <button type="button" className={`layer-chip is-google${layers.google ? ' on' : ''}`} aria-pressed={layers.google} onClick={() => toggleLayer('google')} title="Google Calendar events">
            Google
          </button>
          <button type="button" className={`layer-chip is-money${layers.money ? ' on' : ''}`} aria-pressed={layers.money} onClick={() => toggleLayer('money')} title="Bills, card minimums, subscriptions and pay-later from the Radall sheet">
            $ Money
          </button>
          <button type="button" className={`layer-chip is-tasks${layers.tasks ? ' on' : ''}`} aria-pressed={layers.tasks} onClick={() => toggleLayer('tasks')} title="Self tasks with a day, and Priority items you gave a day">
            ☐ Tasks
          </button>
        </div>
        {!expanded ? (
          <MonthNav
            month={month}
            setMonth={fn => {
              setPop(null);
              setMonth(fn);
            }}
          />
        ) : null}
        <button type="button" className="row-action ghost sched-toggle" onClick={() => setView(!expanded)} aria-pressed={expanded}>
          {expanded ? 'Month view' : 'Expand ⤢'}
        </button>
      </div>

      {!expanded ? (
        <div className="sched-compact">
          <section className="sched-block sc-upcoming" aria-labelledby="sc-up">
            <h3 id="sc-up">
              Upcoming <span>· next 7 days</span>
            </h3>
            <Agenda events={events} bills={shownBills} tasks={shownTasks} schedule={schedule} onShow={show} limit={16} />
          </section>
          <div className="sc-mid">
            <section className="sched-block sc-events" aria-labelledby="sc-events">
              <h3 id="sc-events">
                Events <span>· trips, parties, plans</span>
              </h3>
              <EventsList events={events} plans={plans} onShow={show} onDropPlan={p => update(p.id, { status: 'dropped' })} />
            </section>
            <section className="sched-block sc-appts" aria-labelledby="sc-appts">
              <h3 id="sc-appts">
                Appointments <span>· doctor, dentist, vet…</span>
              </h3>
              <EventsList list="appt" events={events} plans={plans} onShow={show} onDropPlan={p => update(p.id, { status: 'dropped' })} />
            </section>
            <section className="sched-block sc-confirm" aria-labelledby="sc-confirm">
              <h3 id="sc-confirm">
                Needs to confirm <span>· {maybeCount}</span>
              </h3>
              <MaybeList invites={invites} plans={openPlans} events={events} onShow={show} onAnswer={answer} />
            </section>
          </div>
          <div className="sc-month cal-themed" ref={monthBox} data-season={SEASON[month.getMonth()]}>
            <h3 className="cal-title cal-script-title">{month.toLocaleDateString(undefined, { month: 'long' })}</h3>
            {!schedule ? <p className="cal-notice">Google Calendar isn&apos;t connected yet — maybe-plans and bills still show.</p> : null}
            <MonthMini month={month} items={items} picked={pop?.day} onPick={openDay} />
            {pop ? (
              <DayPopover
                key={pop.day}
                day={pop.day}
                pos={pop}
                items={items}
                events={events}
                plans={plans}
                onAnswer={answer}
                onBillPaid={onBillPaid}
                tasks={tasks}
                onTaskDone={onTaskDone}
                onAddPrep={onAddPrep}
                onWeek={day => {
                  setView(true);
                  setFocus(f => ({ date: day, nonce: (f?.nonce || 0) + 1 }));
                }}
                onClose={() => setPop(null)}
              />
            ) : null}
          </div>
        </div>
      ) : (
        <div className="sched-grid">
          <aside className="sched-rail" aria-label="Coming up, events, not confirmed, bills">
            <section className="sched-block">
              <h3>
                Coming up <span>· next 7 days</span>
              </h3>
              <Agenda events={events} schedule={schedule} onShow={show} />
            </section>

            <section className="sched-block">
              <h3>
                Events <span>· trips, parties, plans</span>
              </h3>
              <EventsList events={events} plans={plans} onShow={show} onDropPlan={p => update(p.id, { status: 'dropped' })} />
            </section>

            <section className="sched-block">
              <h3>
                Appointments <span>· doctor, dentist, vet…</span>
              </h3>
              <EventsList list="appt" events={events} plans={plans} onShow={show} onDropPlan={p => update(p.id, { status: 'dropped' })} />
            </section>

            <section className="sched-block">
              <h3>
                Not confirmed yet <span>· {maybeCount}</span>
              </h3>
              <MaybeList invites={invites} plans={openPlans} events={events} onShow={show} onAnswer={answer} />
            </section>

            <section className="sched-block">
              <h3>
                Money due <span>· from the Radall sheet</span>
              </h3>
              <BillsList
                dues={shownBills.filter(b => b.days <= 14 && !(b.bill.kind && b.days < 0))}
                onPaid={onBillPaid}
                limit={5}
                empty={schedule ? 'No bills due in the next two weeks.' : 'Shows bills from the Finances "Bills" tab once it’s connected.'}
              />
            </section>
          </aside>

          <div className="sched-cal">
            {selected ? (
              <div className={`cal-detail kind-${selected.kind}`} style={selected.color ? ({ '--ev': selected.color } as React.CSSProperties) : undefined}>
                <div className="cal-detail-main">
                  <strong>{selected.title}</strong>
                  <span>
                    {dayName(eventStart(selected))}
                    {selected.allDay ? '' : ` · ${rangeLabel(selected)}`}
                    {selected.sub ? ` · ${selected.sub}` : ''}
                  </span>
                  {selPlan || selected.kind === 'invite' ? (
                    <span className={`maybe-fit ${fitText(selected, events, selected.id).tone}`}>{fitText(selected, events, selected.id).text}</span>
                  ) : null}
                  {selected.bill ? (
                    <span>{[countdown(selected.bill.days), money(selected.bill.bill.amount)].filter(Boolean).join(' · ')}</span>
                  ) : null}
                  {selected.kind === 'event' || selected.kind === 'invite' || selected.kind === 'plan' ? (
                    <PrepList
                      key={selected.id}
                      target={{ id: selected.id, title: selected.title, date: dayKey(eventStart(selected)) }}
                      tasks={tasks.filter(t => t.forEvent?.id === selected.id)}
                      onAdd={onAddPrep}
                      onDone={onTaskDone}
                    />
                  ) : null}
                </div>
                <div className="cal-detail-actions">
                  {selPlan ? (
                    <>
                      <button type="button" className="row-action" onClick={() => answer(selPlan, true)}>
                        Yes — add to Google Calendar
                      </button>
                      <button type="button" className="row-action ghost" onClick={() => answer(selPlan, false)}>
                        No
                      </button>
                    </>
                  ) : null}
                  {selected.kind === 'task' && selected.task?.selfId && onTaskDone ? (
                    <button type="button" className="row-action" onClick={() => onTaskDone(selected.task!)}>
                      {selected.task.done ? 'Undo' : 'Done'}
                    </button>
                  ) : null}
                  {selEvent?.url ? (
                    <a className="row-action ghost" href={selEvent.url} target="_blank" rel="noopener noreferrer">
                      {selected.kind === 'invite' ? 'Reply in Google Calendar ↗' : 'Open in Google Calendar ↗'}
                    </a>
                  ) : null}
                  {selected.bill ? (
                    <>
                      {selected.bill.bill.payUrl ? (
                        <a className="row-action" href={selected.bill.bill.payUrl} target="_blank" rel="noopener noreferrer">
                          Pay ↗
                        </a>
                      ) : null}
                      <button
                        type="button"
                        className="row-action ghost"
                        onClick={() => {
                          onBillPaid(selected.bill!);
                          setSelected(null);
                        }}
                      >
                        Mark paid
                      </button>
                    </>
                  ) : null}
                  <button type="button" className="row-action ghost" onClick={() => setSelected(null)} aria-label="Close details">
                    ✕
                  </button>
                </div>
              </div>
            ) : null}
            <CalendarView items={items} focus={focus} connected={Boolean(schedule)} onSelect={setSelected} selectedId={selected?.id} />
          </div>
        </div>
      )}
    </section>
  );
}
