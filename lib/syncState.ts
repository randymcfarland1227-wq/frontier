/**
 * Cloud-backup state shape + merge. Pure (no DOM, no storage) so the Worker and the
 * browser run the exact same merge. Merges only ever combine — nothing is dropped.
 */

import type { CompletionEntry, CompletionLedger } from './completions';
import type { Capture } from './captures';
import type { SelfItem } from './adapters/self';
import type { GoalLink } from './goals';

export type LocalGoalLinks = { added: GoalLink[]; removed: string[] };

export type SyncedState = {
  completions: CompletionLedger;
  captures: Capture[];
  self: SelfItem[];
  goalLinks: LocalGoalLinks;
};

/**
 * Before 2026-09-23 a task that merely disappeared from a source (rescheduled, filtered out,
 * regenerated) was logged as `via: 'origin-snapshot'`. Those were never real completions, so they
 * are dropped everywhere — browser, backup, and every device. Real source-reported completions
 * now use `via: 'origin-done'`. Role Hub's snapshot entries were always explicit applications.
 */
export function isRealCompletion(entry: CompletionEntry): boolean {
  return !(entry.via === 'origin-snapshot' && entry.source !== 'role');
}

function localDay(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** Title identity for TickTick copies of one recurring task (same name, case/space-insensitive). */
export function tickTickTitleKey(title?: string) {
  return (title || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Completing an overdue recurring task in TickTick creates one completed copy per missed date
 * (different ids, same title, done seconds apart). Count that task once per day: keep the
 * earliest entry per (title, local day). Deterministic, so every device and the Worker agree.
 */
export function collapseTickTickCopies(entries: Record<string, CompletionEntry>): Record<string, CompletionEntry> {
  const keep = new Map<string, [string, CompletionEntry]>();
  const out: Record<string, CompletionEntry> = {};
  for (const [key, e] of Object.entries(entries)) {
    const title = tickTickTitleKey(e.title);
    if (e.source !== 'ticktick' || !title) {
      out[key] = e;
      continue;
    }
    const group = `${title}|${localDay(e.completedAt)}`;
    const prev = keep.get(group);
    const earlier = !prev || e.completedAt < prev[1].completedAt || (e.completedAt === prev[1].completedAt && key < prev[0]);
    if (earlier) keep.set(group, [key, e]);
  }
  for (const [key, e] of keep.values()) out[key] = e;
  return out;
}

export function emptyState(): SyncedState {
  return { completions: { entries: {} }, captures: [], self: [], goalLinks: { added: [], removed: [] } };
}

/** Coerce anything (old payloads, partial JSON) into a full state. */
export function normalizeState(raw: unknown): SyncedState {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Partial<SyncedState>;
  const rawEntries = s.completions && typeof s.completions === 'object' ? s.completions.entries : undefined;
  const entries = collapseTickTickCopies(
    Object.fromEntries(
      Object.entries(rawEntries && typeof rawEntries === 'object' ? rawEntries : {}).filter(([, e]) => e && isRealCompletion(e)),
    ),
  );
  return {
    completions: { entries },
    captures: Array.isArray(s.captures) ? s.captures : [],
    self: Array.isArray(s.self) ? s.self : [],
    goalLinks: {
      added: Array.isArray(s.goalLinks?.added) ? s.goalLinks.added : [],
      removed: Array.isArray(s.goalLinks?.removed) ? s.goalLinks.removed : [],
    },
  };
}

function mergeEntry(a: CompletionEntry, b: CompletionEntry): CompletionEntry {
  const first = Date.parse(a.completedAt) <= Date.parse(b.completedAt) ? a : b;
  const other = first === a ? b : a;
  // Area: a hand-set area wins, then whichever copy was sorted under newer rules.
  const rank = (e: CompletionEntry) => (e.focusAreaId ? (e.focusManual ? 1e6 : (e.focusRules ?? 1)) : -1);
  const area = rank(other) > rank(first) ? other : first;
  return {
    ...first,
    title: first.title ?? other.title,
    focusAreaId: area.focusAreaId,
    focusRules: area.focusRules,
    focusManual: area.focusManual,
  };
}

function stamp(item: { createdAt?: string; updatedAt?: string; reviewedAt?: string }): number {
  const t = Date.parse(item.updatedAt || item.reviewedAt || item.createdAt || '');
  return Number.isNaN(t) ? 0 : t;
}

/** Union by id; on conflict the most recently changed copy wins. Newest first. */
function mergeById<T extends { id: string; createdAt?: string }>(a: T[], b: T[]): T[] {
  const out = new Map<string, T>();
  for (const item of [...a, ...b]) {
    const prev = out.get(item.id);
    if (!prev || stamp(item) >= stamp(prev)) out.set(item.id, item);
  }
  return [...out.values()].sort((x, y) => String(y.createdAt || '').localeCompare(String(x.createdAt || '')));
}

export function mergeState(aRaw: unknown, bRaw: unknown): SyncedState {
  const a = normalizeState(aRaw);
  const b = normalizeState(bRaw);
  const entries: Record<string, CompletionEntry> = { ...a.completions.entries };
  for (const [key, entry] of Object.entries(b.completions.entries)) {
    entries[key] = entries[key] ? mergeEntry(entries[key], entry) : entry;
  }
  return {
    completions: { entries },
    captures: mergeById(a.captures, b.captures),
    self: mergeById(a.self, b.self),
    goalLinks: {
      added: mergeById(a.goalLinks.added, b.goalLinks.added),
      removed: [...new Set([...a.goalLinks.removed, ...b.goalLinks.removed])],
    },
  };
}

export function stateCounts(s: SyncedState) {
  return {
    completions: Object.keys(s.completions.entries).length,
    captures: s.captures.length,
    self: s.self.length,
    links: s.goalLinks.added.length,
  };
}
