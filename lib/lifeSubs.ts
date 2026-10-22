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
  /** First charge day (YYYY-MM-DD); nothing is due before it */
  start?: string;
  note?: string;
  removed?: boolean;
  createdAt: string;
  updatedAt: string;
};

export const LIFE_SUBS_EVENT = 'lifehub:subs';

/** Added from Randy's emails (2026-10-22). Fixed ids, so an edit on any device replaces the built-in copy. */
const SEEDED_SUBS: LifeSub[] = [
  {
    id: 'sub-seed-google-one',
    name: 'Google One (200 GB)',
    amount: 2.99,
    day: 27,
    cycle: 'monthly',
    status: 'active',
    start: '2026-10-27',
    note: 'Storage · Google Play · intro price ends Oct 27, then $2.99/mo + tax',
    createdAt: '2026-10-22T12:00:00.000Z',
    updatedAt: '2026-10-22T12:00:00.000Z',
  },
  {
    id: 'sub-seed-google-workspace',
    name: 'Google Workspace (peculiarcandle.com)',
    day: 1,
    cycle: 'monthly',
    status: 'active',
    start: '2026-11-01',
    note: 'Peculiar Candle · info@peculiarcandle.com · paid from Nov 1 · price not in the email (Admin Console → Billing)',
    createdAt: '2026-10-22T12:00:00.000Z',
    updatedAt: '2026-10-22T12:00:00.000Z',
  },
  {
    id: 'sub-seed-canva-business',
    name: 'Canva Business',
    amount: 250,
    day: 3,
    cycle: 'yearly',
    month: 10,
    status: 'trial',
    start: '2026-11-03',
    note: 'Free 14-day trial · cancel before Nov 3 or $250/yr + tax charges · 1 seat',
    createdAt: '2026-10-22T12:00:00.000Z',
    updatedAt: '2026-10-22T12:00:00.000Z',
  },
];

export function loadLifeSubs(): LifeSub[] {
  const saved = readSaved<LifeSub[]>(STORAGE_KEYS.lifeSubs, []);
  const ids = new Set(saved.map(s => s.id));
  return [...saved, ...SEEDED_SUBS.filter(s => !ids.has(s.id))];
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
      if (s.start && due < s.start) continue;
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
