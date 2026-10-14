/**
 * The balancing sheet's plan, one entry per payment / deposit (keyed by its due key, so a plan belongs
 * to that date and drops out once it's paid): whether it's on the sheet, which account it's paid from
 * or into, how (debit card / checking transfer / savings), the day Randy plans to pay it, and for
 * items he typed in himself, the item. `src:` entries remember the account + how for every date of
 * one bill / income source. Cloud-synced as `balancePicks` (newest change per key wins). Nothing here
 * is written to the sheet — except incoming money landing (see MoneyPage useIncomingLanding).
 */

import { useEffect, useState } from 'react';
import { readSaved, writeSaved, STORAGE_KEYS } from './storage';

/** debit = debit card (leaves right away) · ach = from checking (1–3 days to clear) · savings */
export type PayMethod = 'debit' | 'ach' | 'savings';
/** An item Randy added himself (not a bill or deposit from the sheet / Incoming funds). */
export type CustomItem = { name: string; amount: number; kind: 'pay' | 'in'; due: string };
export type BalancePick = {
  /** 'in' = on the balancing sheet */
  mark: string | null;
  /** The account's name */
  acct?: string;
  method?: PayMethod;
  /** The day Randy plans to pay it (YYYY-MM-DD) */
  payOn?: string;
  /** Incoming money: the day it was added to its account in the sheet (never added twice) */
  landed?: string;
  item?: CustomItem;
  at: string;
};
export type BalancePicks = Record<string, BalancePick>;
export type Remembered = { acct?: string; method?: PayMethod };

/** Key that remembers the account for every date of one bill / income source. */
export const srcKey = (kind: 'pay' | 'in', name: string) => `${kind}:${name.trim().toLowerCase()}`;
export const BALANCE_PICKS_EVENT = 'lifehub:balance-picks';
export const METHOD_LABEL: Record<PayMethod, string> = { debit: 'Debit card', ach: 'Checking · 1–3 days', savings: 'Savings' };

export function loadBalancePicks(): BalancePicks {
  return readSaved<BalancePicks>(STORAGE_KEYS.balancePicks, {});
}

function save(all: BalancePicks) {
  writeSaved(STORAGE_KEYS.balancePicks, all);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(BALANCE_PICKS_EVENT));
}

/** Put items on (or take them off) the balancing sheet — everything else about them is kept. */
export function setBalancePicks(keys: string[], on: boolean) {
  const all = loadBalancePicks();
  const at = new Date().toISOString();
  for (const k of keys) all[k] = { ...(all[k] || {}), mark: on ? 'in' : null, at };
  save(all);
}

/**
 * Change part of one item's plan (account, how, pay-on day, the item itself). Empty values clear.
 * With `remember` (its srcKey), the account + how carry to that bill / source's other dates.
 */
export function updatePick(key: string, patch: Partial<Omit<BalancePick, 'at'>>, remember?: string) {
  const all = loadBalancePicks();
  const at = new Date().toISOString();
  const next: BalancePick = { ...(all[key] || { mark: null }), ...patch, at };
  for (const f of ['acct', 'method', 'payOn', 'landed'] as const) if (!next[f]) delete next[f];
  all[key] = next;
  if (remember && ('acct' in patch || 'method' in patch)) {
    const src = `src:${remember}`;
    const cur = all[src] || { mark: null };
    const rem: BalancePick = { ...cur, mark: null, at };
    if ('acct' in patch) rem.acct = patch.acct || undefined;
    if ('method' in patch) rem.method = patch.method || undefined;
    if (!rem.acct) delete rem.acct;
    if (!rem.method) delete rem.method;
    all[src] = rem;
  }
  save(all);
}

/** Which account a sheet line is paid from / goes into ('' = not chosen); also puts it on the sheet. */
export function setPickAccount(key: string, acct: string, remember?: string) {
  updatePick(key, { mark: 'in', acct: acct || undefined }, remember);
}

/** Mark incoming money as added to its account in the sheet (day) — or clear it (null) if that write failed. */
export function setPickLanded(key: string, day: string | null) {
  updatePick(key, { landed: day || undefined });
}

/** Add an item Randy typed in himself; it goes straight onto the balancing sheet. */
export function addCustomItem(item: CustomItem, acct?: string): string {
  const key = `custom:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const all = loadBalancePicks();
  all[key] = { mark: 'in', item, ...(acct ? { acct } : {}), at: new Date().toISOString() };
  save(all);
  return key;
}

export type BalancePlan = {
  entries: BalancePicks;
  /** On-sheet keys → their own account ('' when not chosen on that date) */
  picks: Map<string, string>;
  /** srcKey → remembered account / how */
  remembered: Map<string, Remembered>;
  /** Incoming key → day it was added to the account */
  landed: Map<string, string>;
};

export function planFrom(entries: BalancePicks): BalancePlan {
  const list = Object.entries(entries);
  return {
    entries,
    picks: new Map(list.filter(([k, v]) => v?.mark === 'in' && !k.startsWith('src:')).map(([k, v]) => [k, v.acct || ''])),
    remembered: new Map(list.filter(([k, v]) => k.startsWith('src:') && (v?.acct || v?.method)).map(([k, v]) => [k.slice(4), { acct: v.acct, method: v.method }])),
    landed: new Map(list.filter(([, v]) => v?.landed).map(([k, v]) => [k, v.landed as string])),
  };
}

export function useBalancePicks(): BalancePlan {
  const [picks, setPicks] = useState<BalancePicks>(() => loadBalancePicks());
  useEffect(() => {
    const reload = () => setPicks(loadBalancePicks());
    window.addEventListener(BALANCE_PICKS_EVENT, reload);
    window.addEventListener('lifehub:synced', reload);
    return () => {
      window.removeEventListener(BALANCE_PICKS_EVENT, reload);
      window.removeEventListener('lifehub:synced', reload);
    };
  }, []);
  return planFrom(picks);
}

/** Monday of the week `d` is in (weeks run Monday–Sunday). */
export function mondayOf(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}
