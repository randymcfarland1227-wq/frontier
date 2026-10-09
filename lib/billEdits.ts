/**
 * Bill changes logged on Life Hub, one due date at a time: skip it ("shopping for cheaper
 * insurance"), move it to another day, or a different amount this time — with a note. Keyed by the
 * due's id (`bill:…` / `money:…` / plan ids), which never changes, so Paid and Pin keep working
 * after a move. Cloud-synced as `billEdits` (newest change per bill wins). The sheet isn't written.
 */

import { useEffect, useState } from 'react';
import { readSaved, writeSaved, STORAGE_KEYS } from './storage';
import { daysBetween, fromDayKey, startOfDay, type BillDue } from './schedule';

export type BillEdit = {
  /** Not paying this one */
  skip?: boolean;
  /** New due date for this one — YYYY-MM-DD */
  moveTo?: string;
  /** Amount for this one */
  amount?: number;
  note?: string;
  at: string;
};

export type BillEdits = Record<string, BillEdit>;

export const BILL_EDITS_EVENT = 'lifehub:bill-edits';

/**
 * Overdue tracking starts here: anything due earlier was from before Life Hub watched for it
 * (likely paid without a tap), so it never lands in Overdue.
 */
export const OVERDUE_SINCE = '2026-10-08';

/** Kinds that charge themselves (subscriptions, pay later) never go overdue. */
const SELF_CHARGING = new Set(['sub', 'paylater', 'plan']);

export function loadBillEdits(): BillEdits {
  return readSaved<BillEdits>(STORAGE_KEYS.billEdits, {});
}

/** Save a change for one due; `null` (or nothing left in it) puts it back to normal. */
export function setBillEdit(key: string, edit: Omit<BillEdit, 'at'> | null) {
  const all = loadBillEdits();
  const at = new Date().toISOString();
  const clean = edit
    ? {
        ...(edit.skip ? { skip: true } : {}),
        ...(edit.moveTo && !edit.skip ? { moveTo: edit.moveTo } : {}),
        ...(edit.amount !== undefined && Number.isFinite(edit.amount) ? { amount: edit.amount } : {}),
        ...(edit.note?.trim() ? { note: edit.note.trim() } : {}),
      }
    : {};
  // A cleared change is kept as an empty, newer entry so other devices drop theirs too.
  all[key] = { ...clean, at };
  writeSaved(STORAGE_KEYS.billEdits, all);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(BILL_EDITS_EVENT));
}

export function useBillEdits(): BillEdits {
  const [edits, setEdits] = useState<BillEdits>(() => loadBillEdits());
  useEffect(() => {
    const reload = () => setEdits(loadBillEdits());
    window.addEventListener(BILL_EDITS_EVENT, reload);
    window.addEventListener('lifehub:synced', reload);
    return () => {
      window.removeEventListener(BILL_EDITS_EVENT, reload);
      window.removeEventListener('lifehub:synced', reload);
    };
  }, []);
  return edits;
}

export function hasEdit(e?: BillEdit): boolean {
  return Boolean(e && (e.skip || e.moveTo || e.amount !== undefined || e.note));
}

/**
 * Dues with Life Hub changes applied: a moved one counts down to its new day (and keeps its
 * original day in `orig`), a skipped one stays visible until its day passes, then drops off.
 */
export function applyBillEdits(dues: BillDue[], edits: BillEdits, today = new Date()): BillDue[] {
  const t = startOfDay(today);
  return dues
    .map(d => {
      const e = edits[d.key];
      if (!hasEdit(e)) return d;
      const due = e!.moveTo || d.due;
      return {
        ...d,
        bill: e!.amount !== undefined ? { ...d.bill, amount: e!.amount } : d.bill,
        due,
        days: daysBetween(t, fromDayKey(due)),
        orig: e!.moveTo && e!.moveTo !== d.due ? d.due : undefined,
        skipped: e!.skip || undefined,
        editNote: e!.note,
      };
    })
    .filter(d => !(d.skipped && d.days < 0))
    .sort((a, b) => a.due.localeCompare(b.due));
}

/** Past its day, not paid, not skipped, not self-charging, and due since overdue tracking began. */
export function isOverdue(d: BillDue): boolean {
  return d.days < 0 && !d.skipped && !d.bill.autopay && !(d.bill.kind && SELF_CHARGING.has(d.bill.kind)) && (d.orig || d.due) >= OVERDUE_SINCE;
}
