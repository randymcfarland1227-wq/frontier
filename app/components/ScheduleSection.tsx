'use client';

import { useMemo, useState, type FormEvent } from 'react';
import {
  addDays,
  clashes,
  dayKey,
  dayName,
  eventEnd,
  eventStart,
  fromDayKey,
  googleCalendarLink,
  rangeLabel,
  sameDay,
  startOfDay,
  timeLabel,
  type BillDue,
  type CalEvent,
  type ScheduleSnapshot,
} from '../../lib/schedule';
import { planSlot, usePlans, type Plan } from '../../lib/plans';
import { BillsList } from './BillsList';
import { CalendarView, type CalItem } from './CalendarView';

const PLAN_COLOR = '#7b4a68';
const BILL_COLOR = '#a8632a';

/** "Clashes with Dentist (2–3pm)" / "You're free then" — how a maybe fits the confirmed schedule. */
function fitText(slot: { start: string; end: string; allDay?: boolean }, events: CalEvent[], ignoreId?: string) {
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

function whenText(slot: { start: string; end: string; allDay?: boolean }) {
  const d = eventStart(slot);
  return `${dayName(d)}${slot.allDay ? '' : ` · ${rangeLabel(slot)}`}`;
}

function PlanForm({ onDone }: { onDone: () => void }) {
  const { add } = usePlans();
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(() => dayKey(new Date()));
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
    <form className="plan-form" onSubmit={submit} onKeyDown={e => e.key === 'Escape' && onDone()}>
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

/**
 * Schedule, at the very top: a rail of what's coming up, what's not confirmed yet (invitations +
 * maybe-plans, each with how it fits) and bills due — beside a week / month calendar.
 */
export function ScheduleSection({
  schedule,
  bills,
  onBillPaid,
}: {
  schedule: ScheduleSnapshot | null;
  bills: BillDue[];
  onBillPaid: (due: BillDue) => void;
}) {
  const { plans, update } = usePlans();
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<CalItem | null>(null);
  const [focus, setFocus] = useState<{ date: string; nonce: number } | undefined>();
  const events = useMemo(() => schedule?.events || [], [schedule]);
  const today = startOfDay(new Date());
  const weekOut = addDays(today, 8);

  const openPlans = plans.filter(p => p.status === 'open').sort((a, b) => a.date.localeCompare(b.date) || (a.from || '').localeCompare(b.from || ''));
  const invites = events
    .filter(e => (e.myStatus === 'invited' || e.myStatus === 'maybe') && eventEnd(e) >= today)
    .sort((a, b) => eventStart(a).getTime() - eventStart(b).getTime());

  // Coming up: confirmed events from now through the next week, grouped by day.
  const now = new Date();
  const upcoming = events
    .filter(e => (e.myStatus === 'owner' || e.myStatus === 'yes') && eventEnd(e) > now && eventStart(e) < weekOut)
    .sort((a, b) => eventStart(a).getTime() - eventStart(b).getTime() || Number(b.allDay) - Number(a.allDay));
  const byDay = new Map<string, CalEvent[]>();
  for (const e of upcoming.slice(0, 8)) {
    const k = dayKey(eventStart(e) < today ? today : eventStart(e));
    byDay.set(k, [...(byDay.get(k) || []), e]);
  }

  const items: CalItem[] = useMemo(() => {
    const out: CalItem[] = events.map(e => ({
      id: e.id,
      kind: e.myStatus === 'invited' || e.myStatus === 'maybe' ? 'invite' : 'event',
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
      const slot = planSlot(p);
      out.push({ id: p.id, kind: 'plan', title: p.title, ...slot, color: PLAN_COLOR, sub: p.note });
    }
    for (const b of bills) {
      const next = dayKey(addDays(fromDayKey(b.due), 1));
      out.push({ id: b.key, kind: 'bill', title: b.bill.name, start: b.due, end: next, allDay: true, color: BILL_COLOR, url: b.bill.payUrl, bill: b });
    }
    return out;
  }, [events, plans, bills]);

  const show = (date: string, item?: CalItem) => {
    setFocus(f => ({ date, nonce: (f?.nonce || 0) + 1 }));
    if (item) setSelected(item);
  };
  const planItem = (p: Plan) => items.find(i => i.id === p.id);
  const answer = (p: Plan, yes: boolean) => {
    if (yes) {
      const slot = planSlot(p);
      window.open(googleCalendarLink({ title: p.title, ...slot, details: p.note }), '_blank', 'noopener');
    }
    update(p.id, { status: yes ? 'yes' : 'no' });
    if (selected?.id === p.id) setSelected(null);
  };

  const selPlan = selected?.kind === 'plan' ? plans.find(p => p.id === selected.id) : undefined;
  const selEvent = selected && (selected.kind === 'event' || selected.kind === 'invite') ? events.find(e => e.id === selected.id) : undefined;

  return (
    <section className="schedule glass-panel" aria-label="Schedule">
      <div className="sched-head">
        <p className="section-label">Schedule</p>
        <h2>Calendar</h2>
        <p className="sched-sync">
          {schedule ? `Google Calendar · updated ${new Date(schedule.refreshedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Google Calendar not connected yet'}
        </p>
      </div>

      <div className="sched-grid">
        <aside className="sched-rail" aria-label="Coming up, not confirmed, bills">
          <section className="sched-block">
            <h3>
              Coming up <span>· next 7 days</span>
            </h3>
            {byDay.size ? (
              <ol className="agenda">
                {[...byDay.entries()].slice(0, 5).map(([k, list]) => (
                  <li key={k}>
                    <button type="button" className="agenda-day" onClick={() => show(k)}>
                      {dayName(fromDayKey(k))}
                    </button>
                    <ul>
                      {list.slice(0, 4).map(e => (
                        <li key={e.id}>
                          <button
                            type="button"
                            className="agenda-item"
                            style={e.color ? ({ '--ev': e.color } as React.CSSProperties) : undefined}
                            onClick={() => show(dayKey(eventStart(e) < today ? today : eventStart(e)), items.find(i => i.id === e.id))}
                          >
                            <span className="agenda-time">{e.allDay ? 'All day' : timeLabel(eventStart(e))}</span>
                            <span className="agenda-title">{e.title}</span>
                          </button>
                        </li>
                      ))}
                      {list.length > 4 ? <li className="sched-more">+{list.length - 4} more</li> : null}
                    </ul>
                  </li>
                ))}
                {upcoming.length > 8 ? <li className="sched-more">+{upcoming.length - 8} more this week — see the calendar</li> : null}
              </ol>
            ) : (
              <p className="sched-empty">{schedule ? 'Nothing on the calendar this week.' : 'Shows your next 7 days once Google Calendar is connected.'}</p>
            )}
          </section>

          <section className="sched-block">
            <h3>
              Not confirmed yet <span>· {openPlans.length + invites.length}</span>
            </h3>
            {invites.length || openPlans.length ? (
              <ul className="maybe-list">
                {invites.map(e => {
                  const fit = fitText(e, events, e.id);
                  return (
                    <li key={e.id} className="maybe-row">
                      <button type="button" className="maybe-main" onClick={() => show(dayKey(eventStart(e)), items.find(i => i.id === e.id))}>
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
                {openPlans.map(p => {
                  const slot = planSlot(p);
                  const past = eventEnd(slot) < today;
                  const fit = fitText(slot, events);
                  return (
                    <li key={p.id} className={`maybe-row is-plan${past ? ' is-past' : ''}`}>
                      <button type="button" className="maybe-main" onClick={() => show(p.date, planItem(p))}>
                        <strong>{p.title}</strong>
                        <span className="maybe-when">
                          {whenText(slot)}
                          {p.note ? ` · ${p.note}` : ''}
                        </span>
                        {past ? <span className="maybe-fit is-busy">That date has passed</span> : <span className={`maybe-fit ${fit.tone}`}>{fit.text}</span>}
                      </button>
                      <span className="maybe-actions">
                        {past ? null : (
                          <button type="button" className="row-action" onClick={() => answer(p, true)} title="Opens Google Calendar with it filled in" aria-label={`Yes to ${p.title}: add it to Google Calendar`}>
                            Yes
                          </button>
                        )}
                        <button type="button" className="row-action ghost" onClick={() => answer(p, false)} aria-label={past ? `Clear ${p.title}` : `No to ${p.title}`}>
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
          </section>

          <section className="sched-block">
            <h3>
              Bills due <span>· from Finances</span>
            </h3>
            <BillsList
              dues={bills.filter(b => b.days <= 14)}
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
                {selected.bill ? <span>{[selected.bill.days < 0 ? 'Overdue' : `Due in ${selected.bill.days} day${selected.bill.days === 1 ? '' : 's'}`, selected.bill.bill.amount !== undefined ? `$${selected.bill.bill.amount}` : ''].filter(Boolean).join(' · ')}</span> : null}
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
    </section>
  );
}
