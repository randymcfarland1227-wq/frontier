/**
 * Numbers from Randy's Life Hub Finance Checklist (answers dated 2026-10-27/28): card APRs and fees,
 * loan terms. Applied once per browser, only to fields still empty, so anything he has typed on the
 * site wins. Balances, minimums and due dates live in the Radall sheet, not here.
 */

import { loadMoneyMeta, setMeta, type MetaEntry } from './moneyMeta';
import { readSaved, writeSaved } from './storage';

const DONE_KEY = 'lifehub-finance-seed-v1';

const SEED: Record<string, Partial<Omit<MetaEntry, 'at'>>> = {
  // Capital One: purchase APR 29.24% variable on all four
  'card:cap1savor': { apr: 29.24 },
  'card:cap1sec': { apr: 29.24 },
  'card:cap1q': { apr: 29.24 },
  'card:cap1v': { apr: 29.24 },
  // Milestone: Optional Credit Protection $14.61 in October (formula unverified); $250 annual fee posted 8/21; APR not verified
  'card:milestone': { fee: 14.61 },
  // Indigo and Destiny: $9.95 monthly fee, separate from interest; APR not verified
  'card:indigo': { fee: 9.95 },
  'card:destiny': { fee: 9.95 },
  // Loans: lender figures (balance, minimum and due day are in the sheet)
  'loan:toyota': { principal: 20313.12, paymentsLeft: 12, apr: 5.14 },
  'loan:nelnet': { principal: 3107, paymentsLeft: 92, apr: 3.99 },
  'loan:fortiva': { principal: 1376 },
};

export function applyFinanceSeed() {
  if (typeof window === 'undefined' || readSaved<boolean>(DONE_KEY, false)) return;
  const all = loadMoneyMeta();
  for (const [key, patch] of Object.entries(SEED)) {
    const have = all[key];
    if (have?.gone) continue;
    const missing = Object.fromEntries(Object.entries(patch).filter(([k]) => (have as Record<string, unknown> | undefined)?.[k] === undefined));
    if (Object.keys(missing).length) setMeta(key, missing);
  }
  writeSaved(DONE_KEY, true);
}
