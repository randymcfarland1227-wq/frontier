/**
 * Incoming funds logged on Life Hub (unemployment, paychecks, transfers in). Cloud-synced as
 * `incoming` (union by id, newest edit wins — never deleted, only marked `removed`).
 * Not written to the Radall sheet: the sheet bridge only edits existing cells/rows.
 */

import { useEffect, useState } from 'react';
import { readSaved, writeSaved, STORAGE_KEYS } from './storage';
import { addDays, dayKey, daysBetween, fromDayKey, startOfDay } from './schedule';

export type Incoming = {
  id: string;
  source: string;
  amount?: number;
  /** once = on `date`; weekly = every `weekday` from `date` on; biweekly = every other week from `date` */
  cycle: 'once' | 'weekly' | 'biweekly' | 'monthly';
  /** First (or only) day, YYYY-MM-DD */
  date: string;
  /** Optional last day for recurring ones */
  until?: string;
  note?: string;
  removed?: boolean;
  createdAt: string;
  updatedAt: string;
};

export type IncomingDue = { item: Incoming; due: string; days: number; key: string };

export const INCOMING_EVENT = 'lifehub:incoming';

export function loadIncoming(): Incoming[] {
  return readSaved<Incoming[]>(STORAGE_KEYS.incoming, []);
}

function save(list: Incoming[]) {
  writeSaved(STORAGE_KEYS.incoming, list);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(INCOMING_EVENT));
}

export function addIncoming(input: Omit<Incoming, 'id' | 'createdAt' | 'updatedAt'>) {
  const at = new Date().toISOString();
  save([{ ...input, source: input.source.trim(), id: `in-${Date.now()}`, createdAt: at, updatedAt: at }, ...loadIncoming()]);
}

export function updateIncoming(id: string, patch: Partial<Omit<Incoming, 'id' | 'createdAt'>>) {
  const at = new Date().toISOString();
  save(loadIncoming().map(s => (s.id === id ? { ...s, ...patch, updatedAt: at } : s)));
}

export function useIncoming(): Incoming[] {
  const [list, setList] = useState<Incoming[]>(() => loadIncoming());
  useEffect(() => {
    const reload = () => setList(loadIncoming());
    window.addEventListener(INCOMING_EVENT, reload);
    window.addEventListener('lifehub:synced', reload);
    return () => {
      window.removeEventListener(INCOMING_EVENT, reload);
      window.removeEventListener('lifehub:synced', reload);
    };
  }, []);
  return list.filter(s => !s.removed);
}

/** Occurrences between `back` days ago and `ahead` days out. */
export function incomingDues(list: Incoming[], today = new Date(), back = 0, ahead = 45): IncomingDue[] {
  const t = startOfDay(today);
  const from = addDays(t, -back);
  const to = addDays(t, ahead);
  const out: IncomingDue[] = [];
  for (const it of list) {
    if (it.removed || !it.date) continue;
    const start = fromDayKey(it.date);
    const end = it.until ? fromDayKey(it.until) : null;
    const push = (d: Date) => {
      if (d < from || d > to || d < start || (end && d > end)) return;
      const due = dayKey(d);
      out.push({ item: it, due, days: daysBetween(t, d), key: `in:${it.id}:${due}` });
    };
    if (it.cycle === 'once') push(start);
    else if (it.cycle === 'monthly') {
      for (let i = -2; i <= 3; i++) {
        const last = new Date(t.getFullYear(), t.getMonth() + i + 1, 0).getDate();
        push(new Date(t.getFullYear(), t.getMonth() + i, Math.min(start.getDate(), last)));
      }
    } else {
      const step = it.cycle === 'biweekly' ? 14 : 7;
      let d = start;
      if (d < from) d = addDays(d, Math.floor(daysBetween(d, from) / step) * step);
      for (let n = 0; d <= to && n < 60; n++, d = addDays(d, step)) push(d);
    }
  }
  return out.sort((a, b) => a.due.localeCompare(b.due));
}
