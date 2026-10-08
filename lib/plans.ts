/**
 * Maybe-plans: things Randy's been asked to (or is thinking about) but hasn't said yes to,
 * so he can see how they fit before committing. Cloud-synced as `plans` (merge by id, newest
 * edit wins). Never deleted — answered or dropped plans keep a status so other devices agree.
 */

import { useEffect, useState } from 'react';
import { readSaved, writeSaved, STORAGE_KEYS } from './storage';

export type PlanStatus = 'open' | 'yes' | 'no' | 'dropped';

export type Plan = {
  id: string;
  title: string;
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM (24h); empty = time not set yet */
  from?: string;
  to?: string;
  /** Who asked / where / anything to remember */
  note?: string;
  status: PlanStatus;
  /** 'event' = a confirmed event added on Life Hub (Schedule → Events), not a maybe */
  kind?: 'event' | 'appointment';
  /** Last day of a multi-day event (YYYY-MM-DD, inclusive) */
  endDate?: string;
  createdAt: string;
  updatedAt?: string;
};

export const PLANS_EVENT = 'lifehub:plans';

export function loadPlans(): Plan[] {
  return readSaved<Plan[]>(STORAGE_KEYS.plans, []);
}

function save(items: Plan[]) {
  writeSaved(STORAGE_KEYS.plans, items);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(PLANS_EVENT));
}

export function addPlan(input: Pick<Plan, 'title' | 'date' | 'from' | 'to' | 'note'>) {
  const now = new Date().toISOString();
  save([
    {
      id: `plan-${Date.now()}`,
      title: input.title.trim(),
      date: input.date,
      from: input.from || undefined,
      to: input.to || undefined,
      note: input.note?.trim() || undefined,
      status: 'open',
      createdAt: now,
      updatedAt: now,
    },
    ...loadPlans(),
  ]);
}

/** A confirmed event added on Life Hub (a trip, a party…) — shows in Events and on the calendar. */
export function addEvent(input: { title: string; date: string; endDate?: string; note?: string; kind?: 'event' | 'appointment' }) {
  const now = new Date().toISOString();
  save([
    {
      id: `${input.kind === 'appointment' ? 'appt' : 'event'}-${Date.now()}`,
      title: input.title.trim(),
      date: input.date,
      endDate: input.endDate && input.endDate > input.date ? input.endDate : undefined,
      note: input.note?.trim() || undefined,
      status: 'yes',
      kind: input.kind || 'event',
      createdAt: now,
      updatedAt: now,
    },
    ...loadPlans(),
  ]);
}

export function updatePlan(id: string, patch: Partial<Omit<Plan, 'id' | 'createdAt'>>) {
  const now = new Date().toISOString();
  save(loadPlans().map(p => (p.id === id ? { ...p, ...patch, updatedAt: now } : p)));
}

/** The plan as a calendar slot: no start time = all day; no end time = one hour. */
export function planSlot(p: Plan): { start: string; end: string; allDay: boolean } {
  if (!p.from) {
    const [y, m, d] = (p.endDate || p.date).split('-').map(Number);
    const next = new Date(y, m - 1, d + 1);
    const nextKey = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
    return { start: p.date, end: nextKey, allDay: true };
  }
  const start = new Date(`${p.date}T${p.from}:00`);
  let end = p.to ? new Date(`${p.date}T${p.to}:00`) : new Date(start.getTime() + 60 * 60 * 1000);
  if (end <= start) end = new Date(end.getTime() + 24 * 60 * 60 * 1000); // runs past midnight
  return { start: start.toISOString(), end: end.toISOString(), allDay: false };
}

export function usePlans() {
  const [plans, setPlans] = useState<Plan[]>(() => loadPlans());
  useEffect(() => {
    const reload = () => setPlans(loadPlans());
    window.addEventListener(PLANS_EVENT, reload);
    window.addEventListener('lifehub:synced', reload);
    return () => {
      window.removeEventListener(PLANS_EVENT, reload);
      window.removeEventListener('lifehub:synced', reload);
    };
  }, []);
  return { plans, add: addPlan, addEvent, update: updatePlan };
}
