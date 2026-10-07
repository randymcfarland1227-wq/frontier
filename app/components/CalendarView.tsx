'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  addDays,
  dayKey,
  eventEnd,
  eventStart,
  fromDayKey,
  onDay,
  rangeLabel,
  startOfDay,
  startOfWeek,
  timeLabel,
  type BillDue,
  type CalTask,
} from '../../lib/schedule';

/** One thing on the calendar: a Google event, a maybe-plan, or a bill's due date. */
export type CalItem = {
  id: string;
  kind: 'event' | 'invite' | 'plan' | 'bill' | 'task';
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  color?: string;
  sub?: string;
  url?: string;
  bill?: BillDue;
  task?: CalTask;
};

const HOUR_PX = 44;
const DEFAULT_FROM = 7;
const DEFAULT_TO = 22;

function useNarrow(query = '(max-width: 720px)') {
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setNarrow(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return narrow;
}

/** Side-by-side lanes for overlapping timed items in one day. */
function layoutDay(items: CalItem[], day: Date) {
  const dayStart = startOfDay(day).getTime();
  const dayEnd = dayStart + 86_400_000;
  const placed = items
    .map(it => {
      const s = Math.max(eventStart(it).getTime(), dayStart);
      const e = Math.min(Math.max(eventEnd(it).getTime(), s + 15 * 60_000), dayEnd);
      return { it, s, e, lane: 0, lanes: 1 };
    })
    .sort((a, b) => a.s - b.s || b.e - a.e);
  let cluster: typeof placed = [];
  let clusterEnd = 0;
  const flush = () => {
    const lanes = Math.max(1, ...cluster.map(c => c.lane + 1));
    cluster.forEach(c => (c.lanes = lanes));
    cluster = [];
  };
  for (const p of placed) {
    if (cluster.length && p.s >= clusterEnd) flush();
    const used = new Set(cluster.filter(c => c.e > p.s).map(c => c.lane));
    let lane = 0;
    while (used.has(lane)) lane += 1;
    p.lane = lane;
    cluster.push(p);
    clusterEnd = Math.max(clusterEnd, p.e);
  }
  flush();
  return placed;
}

/** "Oct 4 – 10, 2026" / "Sep 28 – Oct 4, 2026" */
function weekTitle(a: Date, b: Date) {
  const left = a.toLocaleDateString([], { month: 'short', day: 'numeric' });
  const right = a.getMonth() === b.getMonth() ? String(b.getDate()) : b.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return `${left} – ${right}, ${b.getFullYear()}`;
}

function hourLabel(h: number) {
  const hh = ((h + 11) % 12) + 1;
  return `${hh}${h < 12 || h === 24 ? 'am' : 'pm'}`;
}

/**
 * Week / month calendar. Confirmed events are solid; invitations and maybe-plans are dashed so
 * you can see how they'd fit. Bills sit in the all-day row on their due date.
 */
export function CalendarView({
  items,
  focus,
  connected,
  onSelect,
  selectedId,
}: {
  items: CalItem[];
  /** Jump here (e.g. when you pick a plan in the list) */
  focus?: { date: string; nonce: number };
  connected: boolean;
  onSelect: (item: CalItem | null) => void;
  selectedId?: string;
}) {
  const narrow = useNarrow();
  const [view, setView] = useState<'week' | 'month'>('week');
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));
  const [now, setNow] = useState(() => new Date());
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    if (!focus) return;
    // Jumping the calendar to the date of a plan picked in the list (an outside event).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAnchor(fromDayKey(focus.date));
    setView('week');
  }, [focus]);

  const days = useMemo(() => {
    const count = narrow ? 3 : 7;
    const first = narrow ? anchor : startOfWeek(anchor);
    return Array.from({ length: count }, (_, i) => addDays(first, i));
  }, [anchor, narrow]);

  const timed = items.filter(i => !i.allDay);
  const allDay = items.filter(i => i.allDay);

  // Hours shown: 7am–10pm, stretched to fit anything earlier or later this week.
  const [fromH, toH] = useMemo(() => {
    let lo = DEFAULT_FROM;
    let hi = DEFAULT_TO;
    for (const d of days) {
      for (const it of timed) {
        if (!onDay(it, d)) continue;
        const s = eventStart(it);
        const e = eventEnd(it);
        if (dayKey(s) === dayKey(d)) lo = Math.min(lo, s.getHours());
        if (dayKey(e) === dayKey(d)) hi = Math.max(hi, e.getHours() + (e.getMinutes() ? 1 : 0));
        else hi = 24;
      }
    }
    return [lo, Math.min(24, hi)];
  }, [days, timed]);

  // Start the week view scrolled to the morning (or an hour before now, today).
  useEffect(() => {
    const el = scroller.current;
    if (!el || view !== 'week') return;
    const inView = days.some(d => dayKey(d) === dayKey(new Date()));
    const h = inView ? Math.max(fromH, new Date().getHours() - 1) : Math.max(fromH, 8);
    el.scrollTop = (h - fromH) * HOUR_PX;
  }, [view, days, fromH]);

  const step = (dir: -1 | 1) => {
    if (view === 'month') setAnchor(a => new Date(a.getFullYear(), a.getMonth() + dir, 1));
    else setAnchor(a => addDays(a, dir * (narrow ? 3 : 7)));
  };

  const title =
    view === 'month'
      ? anchor.toLocaleDateString([], { month: 'long', year: 'numeric' })
      : weekTitle(days[0], days[days.length - 1]);

  const chip = (it: CalItem, extra = '') => (
    <button
      key={it.id}
      type="button"
      className={`cal-chip kind-${it.kind}${selectedId === it.id ? ' is-selected' : ''}${extra}`}
      style={it.color ? ({ '--ev': it.color } as React.CSSProperties) : undefined}
      onClick={() => onSelect(it)}
      title={[it.title, it.allDay ? 'All day' : rangeLabel(it), it.sub].filter(Boolean).join(' · ')}
    >
      {it.kind === 'bill' ? <span aria-hidden="true">$ </span> : null}
      {it.kind === 'task' ? <span aria-hidden="true">{it.task?.done ? '✓ ' : '☐ '}</span> : null}
      {!it.allDay && view === 'month' ? <span className="cal-chip-time">{timeLabel(eventStart(it))}</span> : null}
      <span className="cal-chip-title">{it.title}</span>
    </button>
  );

  const today = dayKey(now);

  return (
    <div className="cal">
      <div className="cal-bar">
        <div className="cal-nav">
          <button type="button" className="row-action ghost" onClick={() => step(-1)} aria-label={view === 'month' ? 'Previous month' : 'Earlier days'}>
            ◀
          </button>
          <button type="button" className="row-action ghost" onClick={() => setAnchor(startOfDay(new Date()))}>
            Today
          </button>
          <button type="button" className="row-action ghost" onClick={() => step(1)} aria-label={view === 'month' ? 'Next month' : 'Later days'}>
            ▶
          </button>
        </div>
        <h3 className="cal-title" aria-live="polite">
          {title}
        </h3>
        <div className="seg cal-views" role="group" aria-label="Calendar view">
          <button type="button" className={view === 'week' ? 'active' : ''} aria-pressed={view === 'week'} onClick={() => setView('week')}>
            {narrow ? '3 days' : 'Week'}
          </button>
          <button type="button" className={view === 'month' ? 'active' : ''} aria-pressed={view === 'month'} onClick={() => setView('month')}>
            Month
          </button>
        </div>
      </div>

      {!connected ? (
        <p className="cal-notice">
          Google Calendar isn&apos;t connected yet — it needs a one-time setup from your Mac. Your maybe-plans and bills still show here.
        </p>
      ) : null}

      {view === 'week' ? (
        <div className="cal-week" style={{ '--cols': days.length } as React.CSSProperties}>
          <div className="cal-head">
            <span className="cal-gutter" />
            {days.map(d => (
              <span key={dayKey(d)} className={`cal-dayname${dayKey(d) === today ? ' is-today' : ''}`}>
                <span>{d.toLocaleDateString([], { weekday: 'short' })}</span>
                <b>{d.getDate()}</b>
              </span>
            ))}
          </div>
          <div className="cal-allday">
            <span className="cal-gutter">All day</span>
            {days.map(d => (
              <div key={dayKey(d)} className="cal-allday-cell">
                {allDay.filter(it => onDay(it, d)).map(it => chip(it))}
              </div>
            ))}
          </div>
          <div className="cal-scroll" ref={scroller}>
            <div className="cal-grid" style={{ height: (toH - fromH) * HOUR_PX }}>
              <div className="cal-gutter cal-hours">
                {Array.from({ length: toH - fromH }, (_, i) => (
                  <span key={i} style={{ top: i * HOUR_PX }}>
                    {i === 0 ? '' : hourLabel(fromH + i)}
                  </span>
                ))}
              </div>
              {days.map(d => {
                const dayItems = timed.filter(it => onDay(it, d));
                const isToday = dayKey(d) === today;
                const nowTop = ((now.getHours() - fromH) * 60 + now.getMinutes()) * (HOUR_PX / 60);
                return (
                  <div key={dayKey(d)} className={`cal-col${isToday ? ' is-today' : ''}`}>
                    {Array.from({ length: toH - fromH }, (_, i) => (
                      <span key={i} className="cal-line" style={{ top: i * HOUR_PX }} />
                    ))}
                    {layoutDay(dayItems, d).map(({ it, s, e, lane, lanes }) => {
                      // Anything starting before the first hour shown is clipped to the top.
                      const rawTop = ((new Date(s).getHours() - fromH) * 60 + new Date(s).getMinutes()) * (HOUR_PX / 60);
                      const top = Math.max(0, rawTop);
                      const height = Math.max(18, ((e - s) / 60_000) * (HOUR_PX / 60) - 2 - (top - rawTop));
                      return (
                        <button
                          key={it.id}
                          type="button"
                          className={`cal-ev kind-${it.kind}${selectedId === it.id ? ' is-selected' : ''}${height < 34 ? ' is-short' : ''}`}
                          style={
                            {
                              top,
                              height,
                              left: `calc(${(lane / lanes) * 100}% + 2px)`,
                              width: `calc(${100 / lanes}% - 4px)`,
                              '--ev': it.color || undefined,
                            } as React.CSSProperties
                          }
                          onClick={() => onSelect(it)}
                          title={[it.title, rangeLabel(it), it.sub].filter(Boolean).join(' · ')}
                        >
                          <span className="cal-ev-title">
                            {it.kind === 'plan' || it.kind === 'invite' ? <span className="sr-only">Not confirmed: </span> : null}
                            {it.title}
                          </span>
                          {height >= 34 ? <span className="cal-ev-time">{rangeLabel(it)}</span> : null}
                        </button>
                      );
                    })}
                    {isToday && nowTop >= 0 && nowTop <= (toH - fromH) * HOUR_PX ? (
                      <span className="cal-now" style={{ top: nowTop }} aria-hidden="true" />
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        <MonthGrid
          anchor={anchor}
          items={items}
          today={today}
          chip={chip}
          openDay={d => {
            setAnchor(d);
            setView('week');
          }}
        />
      )}

      <p className="cal-key">
        <span className="cal-key-solid" /> On your calendar <span className="cal-key-dash" /> Not confirmed yet <span className="cal-key-bill">$</span> Bill due
      </p>
    </div>
  );
}

function MonthGrid({
  anchor,
  items,
  today,
  chip,
  openDay,
}: {
  anchor: Date;
  items: CalItem[];
  today: string;
  chip: (it: CalItem, extra?: string) => React.ReactNode;
  openDay: (d: Date) => void;
}) {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const start = startOfWeek(first);
  const weeks = Math.ceil((first.getDay() + new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0).getDate()) / 7);
  const cells = Array.from({ length: weeks * 7 }, (_, i) => addDays(start, i));
  const names = cells.slice(0, 7).map(d => d.toLocaleDateString([], { weekday: 'short' }));
  return (
    <div className="cal-month">
      {names.map(n => (
        <span key={n} className="cal-month-name">
          {n}
        </span>
      ))}
      {cells.map(d => {
        const dayItems = items
          .filter(it => onDay(it, d))
          .sort((a, b) => Number(b.allDay) - Number(a.allDay) || eventStart(a).getTime() - eventStart(b).getTime());
        const k = dayKey(d);
        return (
          <div key={k} className={`cal-month-cell${d.getMonth() !== anchor.getMonth() ? ' is-other' : ''}${k === today ? ' is-today' : ''}`}>
            <button type="button" className="cal-month-day" onClick={() => openDay(d)} aria-label={`Open the week of ${d.toLocaleDateString()}`}>
              {d.getDate()}
            </button>
            {dayItems.slice(0, 3).map(it => chip(it))}
            {dayItems.length > 3 ? (
              <button type="button" className="cal-more" onClick={() => openDay(d)}>
                +{dayItems.length - 3} more
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
