'use client';

/**
 * Payment plans (Money page): pick a stretch of days, start from your cash, see what's due in it,
 * add extra payments (cards, debts) and money coming in, and watch what's left. Life Hub-only —
 * the sheet isn't touched — and cloud-synced (newest edit per plan wins).
 */

import { useEffect, useState } from 'react';
import { readSaved, writeSaved, STORAGE_KEYS } from './storage';
import { daysBetween, fromDayKey, startOfDay, type BillDue } from './schedule';

export type PayLine = {
  id: string;
  label: string;
  amount: number;
  /** 'out' = a payment, 'in' = money coming in (paycheck, eBay payout) */
  dir: 'out' | 'in';
  /** YYYY-MM-DD — shows on the money calendar as a planned payment */
  date?: string;
  done?: boolean;
};

export type PayPlan = {
  id: string;
  title: string;
  /** YYYY-MM-DD, inclusive */
  start: string;
  end: string;
  /** Starting money; empty = use Cash on hand from the sheet */
  startCash?: number;
  lines: PayLine[];
  /** Per due item in the stretch (key = money item id): changed amount, left out, or paid */
  dues: Record<string, { amount?: number; skip?: boolean; done?: boolean }>;
  createdAt: string;
  updatedAt: string;
  archived?: boolean;
};

export const PAY_PLANS_EVENT = 'lifehub:pay-plans';

export function loadPayPlans(): PayPlan[] {
  return readSaved<PayPlan[]>(STORAGE_KEYS.payPlans, []).filter(p => p && typeof p.id === 'string');
}

function savePayPlans(items: PayPlan[]) {
  writeSaved(STORAGE_KEYS.payPlans, items);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(PAY_PLANS_EVENT));
}

export function newPayPlan(input: Pick<PayPlan, 'title' | 'start' | 'end'>): PayPlan {
  const at = new Date().toISOString();
  const plan: PayPlan = { id: `pay-${Date.now()}`, ...input, lines: [], dues: {}, createdAt: at, updatedAt: at };
  savePayPlans([plan, ...loadPayPlans()]);
  return plan;
}

export function updatePayPlan(id: string, patch: Partial<Omit<PayPlan, 'id' | 'createdAt'>>) {
  const at = new Date().toISOString();
  savePayPlans(loadPayPlans().map(p => (p.id === id ? { ...p, ...patch, updatedAt: at } : p)));
}

export function usePayPlans() {
  const [plans, setPlans] = useState<PayPlan[]>(() => loadPayPlans());
  useEffect(() => {
    const reload = () => setPlans(loadPayPlans());
    window.addEventListener(PAY_PLANS_EVENT, reload);
    window.addEventListener('lifehub:synced', reload);
    return () => {
      window.removeEventListener(PAY_PLANS_EVENT, reload);
      window.removeEventListener('lifehub:synced', reload);
    };
  }, []);
  return plans;
}

/** Dated, not-yet-done planned payments as calendar money items ("Planned · Destiny $50"). */
export function payPlanDues(plans: PayPlan[], paid: Set<string>, today = new Date()): BillDue[] {
  const t = startOfDay(today);
  const out: BillDue[] = [];
  for (const p of plans) {
    if (p.archived) continue;
    for (const l of p.lines) {
      if (l.dir !== 'out' || !l.date || l.done) continue;
      const key = `money:plan:${p.id}:${l.id}`;
      if (paid.has(key)) continue;
      out.push({
        bill: { id: key, name: l.label || 'Planned payment', amount: l.amount, kind: 'plan', notes: `Planned · ${p.title}` },
        due: l.date,
        days: daysBetween(t, fromDayKey(l.date)),
        key,
      });
    }
  }
  return out;
}
