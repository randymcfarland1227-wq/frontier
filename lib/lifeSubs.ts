/**
 * Subscriptions added on Life Hub (new ones that aren't in the Radall sheet yet). Cloud-synced as
 * `subs` (union by id, newest edit wins — never deleted, only marked `removed`). Each active one
 * charges on its day every month (or once a year), and those charges show with the sheet's money:
 * on the calendar, in This week / This month, and in Subscriptions.
 */

import { useEffect, useState } from 'react';
import { readSaved, writeSaved, STORAGE_KEYS } from './storage';
import { addDays, dayKey, daysBetween, fromDayKey, startOfDay, type BillDue } from './schedule';

export type SubStatus = 'active' | 'trial' | 'paused' | 'cancelled';

export type LifeSub = {
  id: string;
  name: string;
  amount?: number;
  /** Day of the month it charges (1–31) */
  day: number;
  cycle: 'monthly' | 'yearly';
  /** For yearly ones: the month it charges (0–11) */
  month?: number;
  status: SubStatus;
  note?: string;
  removed?: boolean;
  createdAt: string;
  updatedAt: string;
};

export const LIFE_SUBS_EVENT = 'lifehub:subs';

export function loadLifeSubs(): LifeSub[] {
  return readSaved<LifeSub[]>(STORAGE_KEYS.lifeSubs, []);
}

function save(list: LifeSub[]) {
  writeSaved(STORAGE_KEYS.lifeSubs, list);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(LIFE_SUBS_EVENT));
}

export function addLifeSub(input: Omit<LifeSub, 'id' | 'createdAt' | 'updatedAt'>) {
  const at = new Date().toISOString();
  save([{ ...input, name: input.name.trim(), id: `sub-${Date.now()}`, createdAt: at, updatedAt: at }, ...loadLifeSubs()]);
}

export function updateLifeSub(id: string, patch: Partial<Omit<LifeSub, 'id' | 'createdAt'>>) {
  const at = new Date().toISOString();
  save(loadLifeSubs().map(s => (s.id === id ? { ...s, ...patch, updatedAt: at } : s)));
}

export function useLifeSubs(): LifeSub[] {
  const [subs, setSubs] = useState<LifeSub[]>(() => loadLifeSubs());
  useEffect(() => {
    const reload = () => setSubs(loadLifeSubs());
    window.addEventListener(LIFE_SUBS_EVENT, reload);
    window.addEventListener('lifehub:synced', reload);
    return () => {
      window.removeEventListener(LIFE_SUBS_EVENT, reload);
      window.removeEventListener('lifehub:synced', reload);
    };
  }, []);
  return subs.filter(s => !s.removed);
}

const charges = (s: LifeSub) => !s.removed && (s.status === 'active' || s.status === 'trial');

/** The charge date in a given month (the 31st becomes the month's last day). */
function chargeIn(year: number, month: number, day: number): Date {
  const last = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(day, last));
}

/** Charges from `back` days ago to `ahead` days out, in the calendar's bill shape. Paid keys are left out unless `keepPaid`. */
export function lifeSubDues(subs: LifeSub[], paid: Set<string>, today = new Date(), back = 45, ahead = 120, keepPaid = false): BillDue[] {
  const t = startOfDay(today);
  const from = addDays(t, -back);
  const to = addDays(t, ahead);
  const out: BillDue[] = [];
  for (const s of subs) {
    if (!charges(s)) continue;
    const created = startOfDay(new Date(s.createdAt));
    for (let i = -2; i <= 5; i++) {
      const y = t.getFullYear();
      const m = t.getMonth() + i;
      if (s.cycle === 'yearly' && ((m % 12) + 12) % 12 !== (s.month ?? t.getMonth())) continue;
      const d = chargeIn(y, m, s.day);
      if (d < from || d > to || d < addDays(created, -31)) continue;
      const due = dayKey(d);
      const key = `money:lhsub:${s.id}:${due}`;
      if (!keepPaid && paid.has(key)) continue;
      out.push({
        bill: { id: key, name: s.name, amount: s.amount, kind: 'sub', notes: ['Subscription', s.status === 'trial' ? 'Trial' : '', 'added on Life Hub'].filter(Boolean).join(' · ') },
        due,
        days: daysBetween(t, fromDayKey(due)),
        key,
      });
    }
  }
  return out;
}
