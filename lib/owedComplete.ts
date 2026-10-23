/**
 * Outstanding items marked complete on Life Hub. Recurring ones (pay-later plans) are only marked off
 * for that month; one-offs (a paid cash advance, taxes, legal, tickets, projects) stay off the open
 * list until undone. Kept on this device; nothing is written to the sheet.
 *   { [lineKey]: { at, month? } }   month = 'YYYY-MM' for recurring lines
 */

import { useEffect, useState } from 'react';
import { readSaved, writeSaved } from './storage';

export type OwedDone = Record<string, { at: string; month?: string }>;
const KEY = 'lifehub-owed-complete';
const EVENT = 'lifehub:owed-complete';

const monthOf = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

/** Is this line marked off right now? (A recurring mark only counts in its own month.) */
export const isOwedDone = (done: OwedDone, key: string) => {
  const m = done[key];
  return Boolean(m && (!m.month || m.month === monthOf()));
};

export function setOwedDone(key: string, on: boolean, recurring = false) {
  const all = readSaved<OwedDone>(KEY, {});
  if (on) all[key] = { at: new Date().toISOString(), ...(recurring ? { month: monthOf() } : {}) };
  else delete all[key];
  writeSaved(KEY, all);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(EVENT));
}

export function useOwedDone(): OwedDone {
  const [done, setDone] = useState<OwedDone>(() => readSaved<OwedDone>(KEY, {}));
  useEffect(() => {
    const reload = () => setDone(readSaved<OwedDone>(KEY, {}));
    window.addEventListener(EVENT, reload);
    return () => window.removeEventListener(EVENT, reload);
  }, []);
  return done;
}
