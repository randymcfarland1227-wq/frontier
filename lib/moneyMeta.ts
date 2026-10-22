/**
 * Money details the Radall sheet has no column for, typed in on Life Hub. One entry per key, newest
 * change wins (cloud-synced as `moneyMeta`). Nothing here is written to the sheet.
 *   card:<name>  → { apr, fee }                      APR % and extra monthly fee (Milestone, Indigo, Destiny)
 *   loan:<name>  → { principal, paymentsLeft, closed } loan terms; balance / min / due stay in the sheet
 *   sale:<id>    → { platform, name, amount, state, availOn } one eBay / Poshmark sale
 *   from:<src>   → { acct }                           which account or card pays a bill / sub / pay later
 * A removed entry keeps `gone: true` so the removal syncs too.
 */

import { useEffect, useState } from 'react';
import { readSaved, writeSaved, STORAGE_KEYS } from './storage';

export type MetaEntry = {
  at: string;
  gone?: boolean;
  apr?: number;
  fee?: number;
  principal?: number;
  paymentsLeft?: number;
  closed?: boolean;
  platform?: 'ebay' | 'posh';
  name?: string;
  amount?: number;
  state?: 'pend' | 'avail';
  availOn?: string;
  acct?: string;
};
export type MoneyMeta = Record<string, MetaEntry>;

export const MONEY_META_EVENT = 'lifehub:money-meta';
/** Same loose key the sheet matching uses: lower case, letters and digits only. */
export const metaName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

export function loadMoneyMeta(): MoneyMeta {
  return readSaved<MoneyMeta>(STORAGE_KEYS.moneyMeta, {});
}

/** Change part of one entry; undefined / '' / NaN values clear that field. */
export function setMeta(key: string, patch: Partial<Omit<MetaEntry, 'at'>>) {
  const all = loadMoneyMeta();
  const next: MetaEntry = { ...(all[key] || {}), ...patch, at: new Date().toISOString() };
  for (const [k, v] of Object.entries(next)) {
    if (v === undefined || v === '' || (typeof v === 'number' && !Number.isFinite(v))) delete (next as Record<string, unknown>)[k];
  }
  if (!patch.gone) delete next.gone;
  all[key] = next;
  writeSaved(STORAGE_KEYS.moneyMeta, all);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(MONEY_META_EVENT));
}

export function removeMeta(key: string) {
  setMeta(key, { gone: true });
}

export function useMoneyMeta(): { meta: MoneyMeta; get: (key: string) => MetaEntry | undefined } {
  const [meta, setState] = useState<MoneyMeta>(() => loadMoneyMeta());
  useEffect(() => {
    const reload = () => setState(loadMoneyMeta());
    window.addEventListener(MONEY_META_EVENT, reload);
    window.addEventListener('lifehub:synced', reload);
    return () => {
      window.removeEventListener(MONEY_META_EVENT, reload);
      window.removeEventListener('lifehub:synced', reload);
    };
  }, []);
  return { meta, get: (key: string) => (meta[key] && !meta[key].gone ? meta[key] : undefined) };
}

/** Interest for one month at this APR on this balance. */
export const monthlyCarry = (balance: number, apr?: number) => (apr === undefined ? undefined : Math.round(((balance * apr) / 100 / 12) * 100) / 100);
