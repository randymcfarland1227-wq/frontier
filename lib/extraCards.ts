/**
 * Cards added on Life Hub that aren't in the Radall sheet (yet) — e.g. a placeholder for a card whose figures
 * aren't known. Cloud-synced as `extraCards` (union by id, newest edit wins — never deleted, only `removed`).
 */

import { useEffect, useState } from 'react';
import { readSaved, writeSaved, STORAGE_KEYS } from './storage';

export type ExtraCard = {
  id: string;
  name: string;
  /** Credit limit, balance and monthly fee are all optional placeholders until real figures arrive */
  limit?: number;
  balance?: number;
  fee?: number;
  note?: string;
  removed?: boolean;
  createdAt: string;
  updatedAt: string;
};

export const EXTRA_CARDS_EVENT = 'lifehub:extra-cards';

export function loadExtraCards(): ExtraCard[] {
  return readSaved<ExtraCard[]>(STORAGE_KEYS.extraCards, []);
}

function save(list: ExtraCard[]) {
  writeSaved(STORAGE_KEYS.extraCards, list);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(EXTRA_CARDS_EVENT));
}

export function addExtraCard(input: Omit<ExtraCard, 'id' | 'createdAt' | 'updatedAt'>) {
  const at = new Date().toISOString();
  save([{ ...input, name: input.name.trim(), id: `card-${Date.now()}`, createdAt: at, updatedAt: at }, ...loadExtraCards()]);
}

export function updateExtraCard(id: string, patch: Partial<Omit<ExtraCard, 'id' | 'createdAt'>>) {
  const at = new Date().toISOString();
  save(loadExtraCards().map(c => (c.id === id ? { ...c, ...patch, updatedAt: at } : c)));
}

export function useExtraCards(): ExtraCard[] {
  const [cards, setCards] = useState<ExtraCard[]>(() => loadExtraCards());
  useEffect(() => {
    const reload = () => setCards(loadExtraCards());
    window.addEventListener(EXTRA_CARDS_EVENT, reload);
    window.addEventListener('lifehub:synced', reload);
    return () => {
      window.removeEventListener(EXTRA_CARDS_EVENT, reload);
      window.removeEventListener('lifehub:synced', reload);
    };
  }, []);
  return cards.filter(c => !c.removed);
}
