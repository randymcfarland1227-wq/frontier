/**
 * Role Hub's certs and portfolio ideas wait on their own shelves ("Certs to get", "Portfolio to
 * add") instead of counting as open tasks — they take a while and get done one at a time. Mark one
 * Active and it moves into the card's open tasks; ↩ puts it back on its shelf. Cloud-synced as
 * `roleActive` (Role Hub item id → 'active' / null, newest change wins). Role Hub itself isn't changed.
 */

import { useEffect, useState } from 'react';
import { readSaved, writeSaved, STORAGE_KEYS } from './storage';
import type { SourceSnapshot, TaskItem } from './types';

export const ROLE_ACTIVE_EVENT = 'lifehub:role-active';
export type RoleActive = Record<string, { mark: string | null; at: string }>;

export const SHELVES = [
  { id: 'cert', label: 'Certs to get', one: 'Certs', metric: 'certsToGet' },
  { id: 'portfolio', label: 'Portfolio to add', one: 'Portfolio', metric: 'portfolioToAdd' },
] as const;

export function shelfOf(id: string) {
  return SHELVES.find(s => id.startsWith(`${s.id}:`));
}

export function loadRoleActive(): RoleActive {
  return readSaved<RoleActive>(STORAGE_KEYS.roleActive, {});
}

export function setRoleActive(id: string, on: boolean) {
  const all = loadRoleActive();
  all[id] = { mark: on ? 'active' : null, at: new Date().toISOString() };
  writeSaved(STORAGE_KEYS.roleActive, all);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(ROLE_ACTIVE_EVENT));
}

export function useRoleActive(): RoleActive {
  const [state, setState] = useState<RoleActive>(() => loadRoleActive());
  useEffect(() => {
    const reload = () => setState(loadRoleActive());
    window.addEventListener(ROLE_ACTIVE_EVENT, reload);
    window.addEventListener('lifehub:synced', reload);
    return () => {
      window.removeEventListener(ROLE_ACTIVE_EVENT, reload);
      window.removeEventListener('lifehub:synced', reload);
    };
  }, []);
  return state;
}

/** The Role snapshot with inactive certs / portfolio ideas moved off the open list onto shelves. */
export function withRoleShelves(snap: SourceSnapshot, active: RoleActive): SourceSnapshot {
  const isActive = (id: string) => active[id]?.mark === 'active';
  const shelved = (id: string) => Boolean(shelfOf(id)) && !isActive(id);
  const items = new Map<string, TaskItem>();
  for (const t of snap.tasks) if (shelved(t.id) && t.status !== 'done') items.set(t.id, t);
  for (const f of snap.featured) {
    if (!shelved(f.id) || items.has(f.id)) continue;
    items.set(f.id, { id: f.id, title: f.title, detail: f.detail, originUrl: f.originUrl, status: 'open', starred: true });
  }
  const shelves = SHELVES.map(s => ({ id: s.id, label: s.label, items: [...items.values()].filter(t => t.id.startsWith(`${s.id}:`)) }));
  const metrics = { ...snap.metrics };
  for (const s of SHELVES) metrics[s.metric] = shelves.find(x => x.id === s.id)!.items.length;
  return {
    ...snap,
    tasks: snap.tasks.filter(t => !(shelved(t.id) && t.status !== 'done')),
    featured: snap.featured.filter(f => !shelved(f.id)),
    metrics,
    shelves,
  };
}
