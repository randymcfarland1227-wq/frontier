/**
 * Remove and move for site rows.
 *
 * Remove: takes an item off Life Hub without counting it as done (a duplicate, something that no
 * longer applies). Cloud-synced as `hidden` ("source::id" → 'hide'); nothing is changed at the
 * origin site. A Self task that was moved to a site is keyed "self::<self id>".
 *
 * Move: puts an item in another site's list with the same name, details and link. Self tasks just
 * change home; anything else (a Gmail or Outlook item…) becomes a Self task homed on the new site
 * that remembers where it came from, and the original row is removed.
 */

import { useEffect, useState } from 'react';
import { readSaved, writeSaved, STORAGE_KEYS } from './storage';
import { addSelfItem, setSelfHome, SELF_ITEMS_EVENT } from './adapters/self';
import type { SourceId } from './types';

export const HIDDEN_EVENT = 'lifehub:hidden-items';
export type HiddenItems = Record<string, { mark: string | null; at: string }>;

/** Where an item can be moved. */
export const MOVE_TARGETS: Array<[string, string]> = [
  ['self', 'Self'],
  ['radall', 'Finances'],
  ['repair', 'Repair Log'],
  ['role', 'Role Hub'],
  ['move', 'Move OS'],
  ['income', 'Venture Lab'],
  ['resale', 'Resale Hub'],
  ['candle', 'Peculiar Candle'],
];

/** Key for the hidden list: a moved Self task is keyed by its Self id wherever it lives. */
export function hiddenKey(source: string, id: string): string {
  return id.startsWith('self:') ? `self::${id.slice(5)}` : `${source}::${id}`;
}

export function loadHidden(): HiddenItems {
  return readSaved<HiddenItems>(STORAGE_KEYS.hiddenItems, {});
}

export function isHidden(hidden: HiddenItems, source: string, id: string): boolean {
  return hidden[hiddenKey(source, id)]?.mark === 'hide';
}

function setHidden(key: string, on: boolean) {
  const all = loadHidden();
  all[key] = { mark: on ? 'hide' : null, at: new Date().toISOString() };
  writeSaved(STORAGE_KEYS.hiddenItems, all);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(HIDDEN_EVENT));
}

export function removeItem(source: string, id: string) {
  setHidden(hiddenKey(source, id), true);
}

export function useHiddenItems(): HiddenItems {
  const [hidden, setState] = useState<HiddenItems>(() => loadHidden());
  useEffect(() => {
    const reload = () => setState(loadHidden());
    window.addEventListener(HIDDEN_EVENT, reload);
    window.addEventListener('lifehub:synced', reload);
    return () => {
      window.removeEventListener(HIDDEN_EVENT, reload);
      window.removeEventListener('lifehub:synced', reload);
    };
  }, []);
  return hidden;
}

/** Move a row to another site's list, keeping its name, details and link. */
export function moveItem(
  source: SourceId,
  item: { id: string; title: string; detail?: string; originUrl?: string },
  to: string,
) {
  if (to === source) return;
  const home = to === 'self' ? undefined : to;
  if (item.id.startsWith('self:')) {
    setSelfHome(item.id.slice(5), home);
    return;
  }
  const [created] = addSelfItem(item.title, item.detail || '', {
    from: { source, id: item.id, url: item.originUrl },
  });
  if (home) setSelfHome(created.id, home);
  else if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(SELF_ITEMS_EVENT));
  removeItem(source, item.id);
}
