/**
 * Schedule: Google Calendar events + bills from the Finances sheet's "Bills" tab.
 *
 * The "Life Hub Schedule" Apps Script (apps-script/LifeHubSchedule.gs) reads both every 10 min
 * and POSTs one snapshot to the Worker (`/api/schedule/snapshot`, X-Mail-Key). Life Hub GETs it
 * with the backup key — calendar and bill data never go into the public `public/data` files.
 * The last good snapshot is kept in this browser so the calendar still shows offline.
 */

import { syncKeyHeader } from './cloudSync';
import { readSaved, writeSaved } from './storage';
import type { CompletionLedger } from './completions';

const WORKER_BASE =
  (import.meta as ImportMeta & { env?: { VITE_WORKER_URL?: string } }).env?.VITE_WORKER_URL ||
  'https://frontier-work-room.randymcfarland1227.workers.dev';

const CACHE_KEY = 'lifehub-schedule-cache';

/** My answer to an event: owner/yes = on the schedule; invited/maybe = not confirmed yet. */
export type MyStatus = 'owner' | 'yes' | 'maybe' | 'invited' | 'no';

export type CalEvent = {
  id: string;
  title: string;
  /** ISO date-time, or YYYY-MM-DD for all-day */
  start: string;
  /** ISO date-time, or YYYY-MM-DD (exclusive) for all-day */
  end: string;
  allDay: boolean;
  calendar: string;
  color?: string;
  location?: string;
  /** Opens the event in Google Calendar */
  url?: string;
  myStatus: MyStatus;
  /** Who invited me, when it's an invitation */
  organizer?: string;
  /** Part of a repeating series (weekly class etc.) — never auto-listed as an Event */
  recurring?: boolean;
};

export type Bill = {
  id: string;
  name: string;
  amount?: number;
  /** Day of the month it's due (monthly bills) */
  dueDay?: number;
  /** A specific due date (one-off, or overrides the monthly day) — YYYY-MM-DD */
  dueDate?: string;
  /** Last due date already paid — YYYY-MM-DD */
  paidThrough?: string;
  payUrl?: string;
  autopay?: boolean;
  notes?: string;
  /** Set for items from the Radall money tabs (bill, card min, subscription, pay later) */
  kind?: 'bill' | 'card' | 'sub' | 'paylater' | 'plan';
};

/** A dated task on the calendar: a Self task with a day, or a Priority item given a day. */
export type CalTask = {
  id: string;
  title: string;
  /** YYYY-MM-DD */
  date: string;
  done: boolean;
  kind: 'self' | 'priority';
  /** Site it's from (Priority items) */
  sourceName?: string;
  /** Self task id, so it can be ticked done from the calendar */
  selfId?: string;
  /** Prep task for this event / maybe-plan */
  forEvent?: { id: string; title: string; date: string };
};

export type ScheduleSnapshot = {
  source: 'schedule';
  refreshedAt: string;
  calendars?: Array<{ name: string; color?: string }>;
  events: CalEvent[];
  bills: Bill[];
};

export function loadCachedSchedule(): ScheduleSnapshot | null {
  return readSaved<ScheduleSnapshot | null>(CACHE_KEY, null);
}

export async function pullScheduleSnapshot(): Promise<ScheduleSnapshot | null> {
  try {
    const res = await fetch(`${WORKER_BASE}/api/schedule/snapshot`, { headers: syncKeyHeader(), cache: 'no-store' });
    if (!res.ok) return null;
    const s = ((await res.json()) as { snapshot?: Partial<ScheduleSnapshot> | null }).snapshot;
    if (!s || typeof s.refreshedAt !== 'string') return null;
    const snap: ScheduleSnapshot = {
      source: 'schedule',
      refreshedAt: s.refreshedAt,
      calendars: Array.isArray(s.calendars) ? s.calendars : [],
      events: Array.isArray(s.events) ? s.events.filter(e => e && e.id && e.start && e.end) : [],
      bills: Array.isArray(s.bills) ? s.bills.filter(b => b && b.id && b.name) : [],
    };
    writeSaved(CACHE_KEY, snap);
    return snap;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Dates (local time — Randy is in America/New_York and so is his browser)
// ---------------------------------------------------------------------------

export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** YYYY-MM-DD → local midnight */
export function fromDayKey(key: string): Date {
  const [y, m, d] = key.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Sunday-start week, like Google Calendar's default */
export function startOfWeek(d: Date): Date {
  return addDays(startOfDay(d), -d.getDay());
}

export function daysBetween(from: Date, to: Date): number {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / 86_400_000);
}

export function eventStart(e: { start: string; allDay?: boolean }): Date {
  return e.allDay || e.start.length <= 10 ? fromDayKey(e.start) : new Date(e.start);
}

export function eventEnd(e: { end: string; allDay?: boolean }): Date {
  return e.allDay || e.end.length <= 10 ? fromDayKey(e.end) : new Date(e.end);
}

/** Does the event touch this local day? */
export function onDay(e: { start: string; end: string; allDay?: boolean }, day: Date): boolean {
  const s = startOfDay(day);
  const next = addDays(s, 1);
  const a = eventStart(e);
  const b = eventEnd(e);
  return a < next && (b > s || (b.getTime() === a.getTime() && a >= s));
}

export function timeLabel(d: Date): string {
  const h = d.getHours();
  const m = d.getMinutes();
  const hh = ((h + 11) % 12) + 1;
  return `${hh}${m ? `:${String(m).padStart(2, '0')}` : ''}${h < 12 ? 'am' : 'pm'}`;
}

export function rangeLabel(e: { start: string; end: string; allDay?: boolean }): string {
  if (e.allDay) return 'All day';
  const a = eventStart(e);
  const b = eventEnd(e);
  const sameHalf = (a.getHours() < 12) === (b.getHours() < 12);
  const left = timeLabel(a);
  return `${sameHalf ? left.replace(/am|pm/, '') : left}–${timeLabel(b)}`;
}

export function dayName(d: Date, today = new Date()): string {
  const diff = daysBetween(today, d);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

// ---------------------------------------------------------------------------
// Fitting things in: what does a maybe-plan or invitation clash with?
// ---------------------------------------------------------------------------

export type Slot = { start: string; end: string; allDay?: boolean };

/** Confirmed timed events that overlap the slot (all-day events don't block time). */
export function clashes(slot: Slot, events: CalEvent[], ignoreId?: string): CalEvent[] {
  if (slot.allDay) return [];
  const a = eventStart(slot);
  const b = eventEnd(slot);
  return events.filter(
    e => e.id !== ignoreId && !e.allDay && (e.myStatus === 'owner' || e.myStatus === 'yes') && eventStart(e) < b && eventEnd(e) > a,
  );
}

/** Confirmed events the same day, for "also that day" context. */
export function sameDay(slot: Slot, events: CalEvent[], ignoreId?: string): CalEvent[] {
  const day = eventStart(slot);
  return events.filter(e => e.id !== ignoreId && (e.myStatus === 'owner' || e.myStatus === 'yes') && onDay(e, day));
}

/** Google Calendar "new event" link, prefilled — no sign-in or API needed on our side. */
export function googleCalendarLink(p: { title: string; start: string; end: string; allDay?: boolean; details?: string; location?: string }) {
  const fmt = (d: Date) =>
    `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}00`;
  const dates = p.allDay
    ? `${p.start.replace(/-/g, '').slice(0, 8)}/${p.end.replace(/-/g, '').slice(0, 8)}`
    : `${fmt(eventStart(p))}/${fmt(eventEnd(p))}`;
  const q = new URLSearchParams({ action: 'TEMPLATE', text: p.title, dates });
  if (p.details) q.set('details', p.details);
  if (p.location) q.set('location', p.location);
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}

// ---------------------------------------------------------------------------
// Bills: next unpaid due date + countdown
// ---------------------------------------------------------------------------

export type BillDue = {
  bill: Bill;
  /** YYYY-MM-DD */
  due: string;
  /** Days from today (negative = overdue) */
  days: number;
  /** Ledger task id for "paid" on Life Hub */
  key: string;
};

export function billKey(bill: Bill, due: string) {
  return `bill:${bill.id}:${due}`;
}

/** Monthly due date for a month, clamped (due day 31 in February → the 28th/29th). */
function monthlyDue(year: number, month: number, day: number): Date {
  const last = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(day, last));
}

/** Due dates still owed: after "paid through", not marked paid on Life Hub, up to `ahead` days out. */
export function billDues(bill: Bill, paidOnHub: Set<string>, today = new Date(), ahead = 45): BillDue[] {
  const t = startOfDay(today);
  const horizon = addDays(t, ahead);
  const paidThrough = bill.paidThrough ? fromDayKey(bill.paidThrough) : null;
  const dates: Date[] = [];
  if (bill.dueDate) dates.push(fromDayKey(bill.dueDate));
  if (bill.dueDay && bill.dueDay >= 1 && bill.dueDay <= 31) {
    // No "paid through" yet: start from today, so a freshly filled-in sheet doesn't flag
    // bills already paid as overdue. Set "Paid through" to see real overdue ones.
    const from = paidThrough ? addDays(paidThrough, 1) : t;
    for (let i = 0; i < 24; i++) {
      const d = monthlyDue(from.getFullYear(), from.getMonth() + i, bill.dueDay);
      if (d < from) continue;
      if (d > horizon) break;
      dates.push(d);
    }
  }
  const seen = new Set<string>();
  return dates
    .filter(d => !paidThrough || d > paidThrough)
    .map(d => dayKey(d))
    .filter(k => (seen.has(k) ? false : (seen.add(k), true)))
    .sort()
    .map(due => ({ bill, due, days: daysBetween(t, fromDayKey(due)), key: billKey(bill, due) }))
    // Autopay takes care of itself once the date passes.
    .filter(d => !paidOnHub.has(d.key) && !(bill.autopay && d.days < 0));
}

/** Bill ids marked paid on Life Hub (they're real completions in the ledger, so they sync). */
export function paidBillKeys(ledger: CompletionLedger): Set<string> {
  const out = new Set<string>();
  for (const e of Object.values(ledger.entries)) if (e.source === 'radall' && (e.taskId.startsWith('bill:') || e.taskId.startsWith('money:'))) out.add(e.taskId);
  return out;
}

/** The next unpaid due date per bill, soonest first. */
export function upcomingBills(bills: Bill[], paidOnHub: Set<string>, today = new Date(), ahead = 45): BillDue[] {
  return bills
    .map(b => billDues(b, paidOnHub, today, ahead)[0])
    .filter((d): d is BillDue => Boolean(d))
    .sort((a, b) => a.days - b.days || a.bill.name.localeCompare(b.bill.name));
}

export function countdown(days: number): string {
  if (days < -1) return `${-days} days overdue`;
  if (days === -1) return '1 day overdue';
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  return `${days} days`;
}

export function money(n?: number): string {
  if (n === undefined || !Number.isFinite(n)) return '';
  return n.toLocaleString([], { style: 'currency', currency: 'USD', minimumFractionDigits: n % 1 ? 2 : 0 });
}
