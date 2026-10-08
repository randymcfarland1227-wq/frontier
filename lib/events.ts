/**
 * Schedule → Events: the things worth seeing coming from a distance — trips, parties, showers,
 * appointments, holidays you're doing something for — kept apart from the everyday calendar.
 *
 * A Google event shows here when it's confirmed, one-off (not a weekly repeat), not on a
 * holidays/birthdays calendar, and either all-day / multi-day, 4+ hours long, or titled like an
 * event ("shower", "trip", "dental", "party"…). Randy can show any other event (☆ in the day
 * pop-out) or hide one (✕); that choice is cloud-synced as `eventMarks`. Events added on Life Hub
 * are plans with `kind: 'event'`.
 */

import { useEffect, useState } from 'react';
import type { CalEvent } from './schedule';
import { readSaved, writeSaved, STORAGE_KEYS } from './storage';

export const EVENT_MARKS_EVENT = 'lifehub:event-marks';
export type EventMarks = Record<string, { mark: string | null; at: string }>;

/** How far ahead the Events list looks. */
export const EVENTS_AHEAD_DAYS = 120;

const SKIP_CALENDARS = /holiday|birthday|week number|phases of the moon/i;
const EVENT_WORDS =
  /\b(shower|party|trip|travel|flight|fly|airport|hotel|vacation|cruise|camping|beach|wedding|birthday|bday|anniversary|dental|dentist|doctor|dr\.?|appointment|appt|surgery|procedure|hospital|concert|game|tickets|festival|fair|reunion|graduation|funeral|visit|visiting|halloween|thanksgiving|christmas|new year|moving|interview|ceremony|recital|show)\b/i;

const ICONS: Array<[RegExp, string]> = [
  [/halloween|costume/i, '🎃'],
  [/thanksgiving/i, '🦃'],
  [/christmas|xmas/i, '🎄'],
  [/baby|shower/i, '🍼'],
  [/wedding|engagement/i, '💍'],
  [/birthday|bday/i, '🎂'],
  [/graduation/i, '🎓'],
  [/dental|dentist|teeth/i, '🦷'],
  [/doctor|dr\.?\b|appointment|appt|surgery|procedure|hospital|clinic/i, '🩺'],
  [/trip|travel|flight|fly|airport|hotel|vacation|cruise|road|visit|camping|beach/i, '✈️'],
  [/concert|game|tickets|show|festival|fair/i, '🎟️'],
  [/party|reunion|dinner|celebrat/i, '🎉'],
  [/interview/i, '💼'],
];

export function eventIcon(title: string): string {
  for (const [re, icon] of ICONS) if (re.test(title)) return icon;
  return '📅';
}

export function isAutoEvent(e: CalEvent): boolean {
  if (e.myStatus !== 'owner' && e.myStatus !== 'yes') return false;
  if (SKIP_CALENDARS.test(e.calendar || '')) return false;
  if (e.recurring) return false;
  if (e.allDay) return true;
  const hours = (Date.parse(e.end) - Date.parse(e.start)) / 3.6e6;
  if (hours >= 4) return true;
  return EVENT_WORDS.test(e.title);
}

/** "Today" / "Tomorrow" / "This weekend" / "In 5 days" / "In 3 weeks". */
export function eventCountdown(start: Date, now = new Date()): string {
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(start) - day(now)) / 864e5);
  if (days <= 0) return 'Now';
  if (days === 1) return 'Tomorrow';
  const dow = now.getDay();
  const toSat = (6 - dow + 7) % 7;
  if (days <= 6 && (start.getDay() === 6 || start.getDay() === 0) && days <= toSat + 1) return 'This weekend';
  if (days < 14) return `In ${days} days`;
  if (days < 60) return `In ${Math.round(days / 7)} weeks`;
  return `In ${Math.round(days / 30)} months`;
}

export function loadEventMarks(): EventMarks {
  return readSaved<EventMarks>(STORAGE_KEYS.eventMarks, {});
}

export function setEventMark(id: string, mark: 'event' | 'hide' | null) {
  const marks = loadEventMarks();
  marks[id] = { mark, at: new Date().toISOString() };
  writeSaved(STORAGE_KEYS.eventMarks, marks);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(EVENT_MARKS_EVENT));
}

export function useEventMarks() {
  const [marks, setMarks] = useState<EventMarks>(() => loadEventMarks());
  useEffect(() => {
    const reload = () => setMarks(loadEventMarks());
    window.addEventListener(EVENT_MARKS_EVENT, reload);
    window.addEventListener('lifehub:synced', reload);
    return () => {
      window.removeEventListener(EVENT_MARKS_EVENT, reload);
      window.removeEventListener('lifehub:synced', reload);
    };
  }, []);
  return marks;
}

/** Shown in Events? Your ☆ / ✕ wins over the automatic rule. */
export function isListedEvent(e: CalEvent, marks: EventMarks): boolean {
  const m = marks[e.id]?.mark;
  if (m === 'event') return true;
  if (m === 'hide') return false;
  return isAutoEvent(e);
}
