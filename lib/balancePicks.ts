/**
 * The balancing sheet's picks: which upcoming bills (and incoming money) Randy put on his balancing
 * sheet to plan against his balances. Keyed by the payment / incoming key (one occurrence each), so a
 * pick belongs to its date and drops out by itself once that payment is paid. Cloud-synced as
 * `balancePicks` (key → 'in' / null, newest change wins). Nothing is written to the sheet.
 */

import { useEffect, useState } from 'react';
import { readSaved, writeSaved, STORAGE_KEYS } from './storage';

/** acct = the balance line it's paid from (its name), when chosen */
export type BalancePicks = Record<string, { mark: string | null; acct?: string; at: string }>;
export const BALANCE_PICKS_EVENT = 'lifehub:balance-picks';

export function loadBalancePicks(): BalancePicks {
  return readSaved<BalancePicks>(STORAGE_KEYS.balancePicks, {});
}

/** Put items on (or take them off) the balancing sheet. */
export function setBalancePicks(keys: string[], on: boolean) {
  const all = loadBalancePicks();
  const at = new Date().toISOString();
  for (const k of keys) all[k] = { mark: on ? 'in' : null, ...(on && all[k]?.acct ? { acct: all[k].acct } : {}), at };
  writeSaved(STORAGE_KEYS.balancePicks, all);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(BALANCE_PICKS_EVENT));
}

/** Which account a sheet line is paid from ('' = not chosen). */
export function setPickAccount(key: string, acct: string) {
  const all = loadBalancePicks();
  all[key] = { mark: 'in', ...(acct ? { acct } : {}), at: new Date().toISOString() };
  writeSaved(STORAGE_KEYS.balancePicks, all);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(BALANCE_PICKS_EVENT));
}

/** Picked keys → the account each is paid from ('' when not chosen). */
export function useBalancePicks(): Map<string, string> {
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
  return new Map(Object.entries(picks).filter(([, v]) => v?.mark === 'in').map(([k, v]) => [k, v.acct || '']));
}

/** Monday of the week `d` is in (weeks run Monday–Sunday). */
export function mondayOf(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}
