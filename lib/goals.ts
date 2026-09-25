/**
 * Why / goals: mirror of Goals hub efforts (live via its Apps Script, fallback to data/goals.json)
 * plus GoalLinks that attach existing work (TickTick, Self, captures) to each goal.
 * Goals live in Goals hub — this module never writes goals, only links.
 */

import type { SourceId } from './types';
import type { FocusAreaId } from './focusAreas';
import type { CompletionLedger } from './completions';
import type { Capture } from './captures';
import { readSaved, writeSaved, STORAGE_KEYS } from './storage';
import { ruleFor, type TaskRuleMap } from './taskRules';

export type Momentum = 'On Track' | 'Slipping' | 'Stalled';

export type Goal = {
  id: string;
  title: string;
  why: string;
  how?: string;
  status: 'active' | 'paused' | 'done';
  categoryId: string;
  focusAreaId?: FocusAreaId;
  horizon?: 'now' | 'quarter' | 'year';
  updatedAt?: string;
  /** Latest bi-weekly review rating from Goals hub */
  review?: { momentum: Momentum | string; date: string; notes?: string };
};

export type GoalCategory = { id: string; label: string; icon: string; focusAreaId?: FocusAreaId };

export type GoalLinkTarget =
  | { type: 'task'; source: SourceId; taskId: string }
  | { type: 'ticktick'; taskId: string; projectId?: string }
  | { type: 'capture'; captureId: string }
  | { type: 'featured'; source: SourceId; featuredId: string };

export type GoalLink = {
  id: string;
  goalId: string;
  target: GoalLinkTarget;
  role: 'drives' | 'supports' | 'blocks';
  /** Human-readable hint only (seed file) */
  label?: string;
};

export type GoalsData = {
  goals: Goal[];
  categories: GoalCategory[];
  live: boolean;
  source: string;
};

type Effort = { id: string; category: string; effort: string; reason: string; how?: string };
type Review = { date: string; effortId: string; momentum: string; notes?: string };
type GoalsFile = {
  source: string;
  api: string;
  categories: GoalCategory[];
  areaOverrides?: Record<string, FocusAreaId>;
  efforts: Effort[];
};

function baseUrl(): string {
  const raw = (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env?.BASE_URL;
  if (typeof raw === 'string' && raw.length) return raw.endsWith('/') ? raw : `${raw}/`;
  if (typeof window !== 'undefined' && window.location.pathname.startsWith('/frontier')) return '/frontier/';
  return '/';
}

async function getJson<T>(url: string, timeoutMs = 8000): Promise<T | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { cache: 'no-store', signal: ctrl.signal });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const isEfforts = (v: unknown): v is Effort[] =>
  Array.isArray(v) && v.every(e => e && typeof e.id === 'string' && typeof e.effort === 'string');
const isReviews = (v: unknown): v is Review[] => Array.isArray(v) && v.every(r => r && typeof r.effortId === 'string');

/** Live efforts + latest review per effort from Goals hub; falls back to the bundled snapshot. */
export async function loadGoals(): Promise<GoalsData | null> {
  const file = await getJson<GoalsFile>(`${baseUrl()}data/goals.json`);
  if (!file) return null;
  const [liveEfforts, reviews] = await Promise.all([
    getJson<unknown>(`${file.api}?action=efforts`),
    getJson<unknown>(`${file.api}?action=reviews`),
  ]);
  const live = isEfforts(liveEfforts) && liveEfforts.length > 0;
  const efforts = live ? (liveEfforts as Effort[]) : file.efforts;

  const latest = new Map<string, Review>();
  if (isReviews(reviews)) {
    for (const r of reviews) {
      const prev = latest.get(r.effortId);
      if (!prev || String(r.date) >= String(prev.date)) latest.set(r.effortId, r);
    }
  }

  const areaFor = (e: Effort) =>
    file.areaOverrides?.[e.id] ?? file.categories.find(c => c.id === e.category)?.focusAreaId;

  const goals: Goal[] = efforts.map(e => {
    const r = latest.get(e.id);
    return {
      id: e.id,
      title: e.effort,
      why: e.reason,
      how: e.how || undefined,
      status: 'active',
      categoryId: e.category,
      focusAreaId: areaFor(e),
      review: r ? { momentum: r.momentum, date: String(r.date), notes: r.notes || undefined } : undefined,
    };
  });
  return { goals, categories: file.categories, live, source: file.source };
}

// ---------------------------------------------------------------------------
// Links: seed file + per-browser additions/removals
// ---------------------------------------------------------------------------

type LocalLinks = { added: GoalLink[]; removed: string[] };

export async function loadSeedLinks(): Promise<GoalLink[]> {
  const file = await getJson<{ links: GoalLink[] }>(`${baseUrl()}data/goal-links.json`);
  return Array.isArray(file?.links) ? file.links : [];
}

function loadLocal(): LocalLinks {
  return readSaved<LocalLinks>(STORAGE_KEYS.goalLinks, { added: [], removed: [] });
}

export function mergeLinks(seed: GoalLink[], local: LocalLinks = loadLocal()): GoalLink[] {
  const removed = new Set(local.removed);
  return [...seed, ...local.added].filter(l => !removed.has(l.id));
}

export function targetKey(t: GoalLinkTarget): string {
  switch (t.type) {
    case 'ticktick':
      return `ticktick::${t.taskId}`;
    case 'task':
      return `${t.source}::${t.taskId}`;
    case 'featured':
      return `${t.source}::${t.featuredId}`;
    case 'capture':
      return `capture::${t.captureId}`;
  }
}

export function addLink(seed: GoalLink[], goalId: string, target: GoalLinkTarget, label?: string): GoalLink[] {
  const local = loadLocal();
  const key = targetKey(target);
  const current = mergeLinks(seed, local);
  if (current.some(l => l.goalId === goalId && targetKey(l.target) === key)) return current;
  // Re-linking a previously unlinked seed restores it instead of duplicating
  const seedMatch = seed.find(l => l.goalId === goalId && targetKey(l.target) === key);
  if (seedMatch) {
    local.removed = local.removed.filter(id => id !== seedMatch.id);
  } else {
    local.added.push({ id: `link-${Date.now()}`, goalId, target, role: 'supports', label });
  }
  writeSaved(STORAGE_KEYS.goalLinks, local);
  return mergeLinks(seed, local);
}

export function removeLink(seed: GoalLink[], linkId: string): GoalLink[] {
  const local = loadLocal();
  local.added = local.added.filter(l => l.id !== linkId);
  if (seed.some(l => l.id === linkId) && !local.removed.includes(linkId)) local.removed.push(linkId);
  writeSaved(STORAGE_KEYS.goalLinks, local);
  return mergeLinks(seed, local);
}

/** Ledger keys (`source::taskId`) a link resolves to; a promoted capture resolves to its task. */
export function ledgerTaskKeys(link: GoalLink, captures: Capture[]): string[] {
  const t = link.target;
  if (t.type === 'capture') {
    const cap = captures.find(c => c.id === t.captureId);
    return cap?.promotedTo ? [`${cap.promotedTo.source}::${cap.promotedTo.taskId}`] : [];
  }
  return [targetKey(t)];
}

/** Link lookup: ledger key (`source::taskId`) → goal id. */
export function linkGoalIndex(links: GoalLink[], captures: Capture[]): Map<string, string> {
  const idx = new Map<string, string>();
  for (const l of links) for (const k of ledgerTaskKeys(l, captures)) if (!idx.has(k)) idx.set(k, l.goalId);
  return idx;
}

/** A task's goal: its sorting rule first, then any link. undefined = unknown (not sorted yet). */
export function goalOf(
  source: SourceId,
  title: string | undefined,
  taskIds: string[],
  rules: TaskRuleMap,
  linkIdx: Map<string, string>,
): string | undefined {
  const picked = ruleFor(source, title, taskIds[0] || '', rules).goal;
  if (picked) return picked;
  for (const id of taskIds) {
    const g = linkIdx.get(`${source}::${id}`);
    if (g) return g;
  }
  return undefined;
}

/** Completions in the last `days` (incl. today) that belong to the goal (sorting rule, else link). */
export function goalMomentum(
  goalId: string,
  links: GoalLink[],
  ledger: CompletionLedger,
  captures: Capture[],
  days = 7,
  rules: TaskRuleMap = {},
): number {
  const idx = linkGoalIndex(links, captures);
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - (days - 1) * 86400000;
  let n = 0;
  for (const e of Object.values(ledger.entries)) {
    const t = Date.parse(e.completedAt);
    if (Number.isNaN(t) || t < start) continue;
    if (goalOf(e.source, e.title, [e.taskId], rules, idx) === goalId) n += 1;
  }
  return n;
}
