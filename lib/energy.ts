/**
 * Balance, two metrics per life bucket, judged per day and averaged over a week or month:
 *
 * 1. Progress — Charge / In-Line / On-Fire. Done that day ÷ that day's goal, where the goal
 *    is a pace (share of what was available in the bucket, from every source). It moves with
 *    the workload: 20 available at 12% → ~2–3 is In-Line; 2 available → 1 is On-Fire.
 * 2. Focus — Underfocused / Balanced / Overfocused. The bucket's completions vs its fair count:
 *    its fair slice of everything completed (halfway between an equal split and a split by goal
 *    size) — capped at its own goal, so a bucket with only a few tasks isn't Underfocused just
 *    for being small. It's only Underfocused when it's skipping the little work it has.
 *
 * The aim: every bucket In-Line and Balanced.
 */

import type { SourceId, SourceSnapshot, TaskItem } from './types';
import type { CompletionEntry, CompletionLedger } from './completions';
import type { SelfItem } from './adapters/self';
import { resolveFocusArea, type FocusAreaConfig, type FocusAreaId } from './focusAreas';
import { readSaved, writeSaved, STORAGE_KEYS } from './storage';

export type EnergyWindow = 'today' | 'last7' | 'month' | 'all';
export type Progress = 'charge' | 'inline' | 'onfire';
export type Focus = 'under' | 'balanced' | 'over';

export const PROGRESS_LABEL: Record<Progress, string> = { charge: 'Charge', inline: 'In-Line', onfire: 'On-Fire' };
export const FOCUS_LABEL: Record<Focus, string> = { under: 'Underfocused', balanced: 'Balanced', over: 'Overfocused' };

/** Pace = share of a bucket's available work that makes a good day. Editable in Balance settings. */
export type BalanceSettings = { paces: Record<FocusAreaId, number>; updatedAt: string };

/** Routine buckets: most of what's due. Backlog buckets: a slice of what's open. */
export const DEFAULT_PACES: Record<FocusAreaId, number> = {
  self: 0.6,
  body: 0.6,
  marvel: 0.6,
  home: 0.6,
  venture: 0.14,
  work: 0.15,
  money: 0.2,
};

/** done ÷ goal thresholds */
const IN_LINE_FROM = 0.75;
const ON_FIRE_ABOVE = 1.3;
/** Focus, in task counts vs the fair count, with minimum gaps so one task doesn't flip labels. */
const OVER_RATIO = 1.4;
const OVER_MIN_TASKS = 2;
const UNDER_RATIO = 0.5;
const UNDER_MIN_TASKS = 1;
/** One huge day can't carry a whole week. */
const RATIO_CAP = 3;

/** Sources whose open items don't define a bucket's workload (you pick their area when done). */
const NO_WORKLOAD_SOURCES: SourceId[] = ['gmail', 'outlook'];

export function loadBalanceSettings(): BalanceSettings {
  const saved = readSaved<Partial<BalanceSettings>>(STORAGE_KEYS.balanceSettings, {});
  return { paces: { ...DEFAULT_PACES, ...(saved.paces || {}) }, updatedAt: saved.updatedAt || '' };
}

export function saveBalanceSettings(paces: Record<FocusAreaId, number>): BalanceSettings {
  const next = { paces, updatedAt: new Date().toISOString() };
  writeSaved(STORAGE_KEYS.balanceSettings, next);
  return next;
}

export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// TickTick habit schedule → which habits are due on a day
// ---------------------------------------------------------------------------

export type HabitSchedule = { id: string; title?: string; repeatRule?: string; targetStartDate?: number; exDates?: string[] };

const WEEKDAY: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

function stampToDate(stamp?: number): Date | null {
  if (!stamp) return null;
  const s = String(stamp);
  return new Date(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8)));
}

export function habitDueOn(h: HabitSchedule, day: Date): boolean {
  const stamp = dayKey(day).replace(/-/g, '');
  if ((h.exDates || []).includes(stamp)) return false;
  const rule = Object.fromEntries(
    String(h.repeatRule || '')
      .replace(/^RRULE:/, '')
      .split(';')
      .map(p => p.split('=') as [string, string]),
  );
  const start = stampToDate(h.targetStartDate);
  if (start && day < start) return false;
  const interval = Math.max(1, Number(rule.INTERVAL) || 1);
  if (rule.FREQ === 'DAILY') {
    if (interval === 1 || !start) return true;
    const days = Math.round((day.getTime() - start.getTime()) / 86400000);
    return days % interval === 0;
  }
  if (rule.FREQ === 'WEEKLY') {
    const days = rule.BYDAY ? rule.BYDAY.split(',').map((d: string) => WEEKDAY[d]) : [start?.getDay() ?? day.getDay()];
    return days.includes(day.getDay());
  }
  return true;
}

// ---------------------------------------------------------------------------
// Available work per bucket for a day (open now + done that day, from every source)
// ---------------------------------------------------------------------------

export type Availability = Record<FocusAreaId, number>;

function areaFor(config: FocusAreaConfig, source: SourceId, task: Partial<TaskItem> & { id: string }): FocusAreaId | undefined {
  return resolveFocusArea({ source, taskId: task.id, title: task.title, kind: task.kind, projectId: task.projectId }, config);
}

function entryArea(config: FocusAreaConfig, e: CompletionEntry): FocusAreaId | undefined {
  return e.focusAreaId ?? resolveFocusArea({ source: e.source, taskId: e.taskId, title: e.title }, config);
}

/** What was on each bucket's plate today. */
export function todayAvailability(
  config: FocusAreaConfig,
  snapshots: Record<SourceId, SourceSnapshot>,
  selfItems: SelfItem[],
  ledger: CompletionLedger,
  schedule: HabitSchedule[] | null,
): Availability {
  const out: Availability = {};
  const add = (area: FocusAreaId | undefined, n = 1) => {
    if (area && config.areas.some(a => a.id === area)) out[area] = (out[area] || 0) + n;
  };
  const today = new Date();
  const todayKey = dayKey(today);

  for (const [source, snap] of Object.entries(snapshots) as Array<[SourceId, SourceSnapshot]>) {
    if (source === 'self' || NO_WORKLOAD_SOURCES.includes(source) || config.excludeSources?.includes(source)) continue;
    for (const t of snap.tasks || []) {
      if (t.status === 'done') continue;
      // Habits come from the schedule below (the TickTick file lists every habit, due or not).
      if (source === 'ticktick' && (t.kind === 'habit' || t.id.startsWith('habit-')) && schedule) continue;
      add(areaFor(config, source, t));
    }
  }
  for (const i of selfItems) if (!i.done) add(i.focusAreaId || areaFor(config, 'self', { id: i.id, title: i.title }));

  // Everything finished today was on the plate too (except scheduled habits, counted as due below).
  for (const e of Object.values(ledger.entries)) {
    if (dayKey(new Date(e.completedAt)) !== todayKey) continue;
    if (NO_WORKLOAD_SOURCES.includes(e.source) || config.excludeSources?.includes(e.source)) continue;
    if (schedule && e.source === 'ticktick' && e.taskId.startsWith('habit-')) continue;
    add(entryArea(config, e));
  }
  if (schedule) {
    for (const h of schedule) {
      if (habitDueOn(h, today)) add(resolveFocusArea({ source: 'ticktick', taskId: h.id, title: h.title, kind: 'habit' }, config));
    }
  }
  return out;
}

/** Remember each day's workload (largest seen) so past days are judged fairly. */
export function recordAvailability(day: string, avail: Availability) {
  const all = readSaved<Record<string, Availability>>(STORAGE_KEYS.dailyAvailability, {});
  const prev = all[day] || {};
  const merged: Availability = { ...prev };
  let changed = false;
  for (const [area, n] of Object.entries(avail)) {
    if (n > (merged[area] || 0)) {
      merged[area] = n;
      changed = true;
    }
  }
  if (!changed) return;
  all[day] = merged;
  // Keep ~3 months
  const keys = Object.keys(all).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - 95))) delete all[k];
  writeSaved(STORAGE_KEYS.dailyAvailability, all);
}

export function loadAvailabilityHistory(): Record<string, Availability> {
  return readSaved<Record<string, Availability>>(STORAGE_KEYS.dailyAvailability, {});
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export type AreaEnergy = {
  id: FocusAreaId;
  name: string;
  done: number;
  goal: number;
  available: number;
  /** done ÷ goal over the window */
  ratio: number;
  progress: Progress;
  /** share of the window's completions vs fair share (for the tooltip) */
  share: number;
  fairShare: number;
  /** fair number of completions for this bucket over the window (capped at its goal) */
  fairCount: number;
  focus: Focus;
  /** tasks still needed to reach In-Line (0 when already there) */
  toInLine: number;
  /** tasks still needed to leave Underfocused (0 when not Underfocused) */
  toBalanced: number;
  /** tasks beyond the fair count when Overfocused */
  overBy: number;
  /** nothing was on this bucket's plate and nothing was done */
  idle: boolean;
};

export type EnergyReport = {
  window: EnergyWindow;
  days: number;
  totalDone: number;
  areas: AreaEnergy[];
  /** true when past days had no recorded workload and today's was used instead */
  estimated: boolean;
};

/** 'all' reaches back to the first completion, capped so it stays quick. */
const ALL_DAYS_CAP = 120;

function windowDays(window: EnergyWindow, firstDay: Date | null, now = new Date()): Date[] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const sinceFirst = firstDay ? Math.round((today.getTime() - firstDay.getTime()) / 86400000) + 1 : 1;
  const count =
    window === 'today' ? 1 : window === 'last7' ? 7 : window === 'month' ? today.getDate() : Math.min(ALL_DAYS_CAP, Math.max(1, sinceFirst));
  return Array.from({ length: count }, (_, i) => new Date(today.getFullYear(), today.getMonth(), today.getDate() - (count - 1 - i)));
}

function progressOf(ratio: number): Progress {
  if (ratio > ON_FIRE_ABOVE) return 'onfire';
  if (ratio >= IN_LINE_FROM) return 'inline';
  return 'charge';
}

function focusOf(done: number, fairCount: number): Focus {
  if (done > fairCount * OVER_RATIO && done - fairCount >= OVER_MIN_TASKS) return 'over';
  if (done < fairCount * UNDER_RATIO && fairCount - done >= UNDER_MIN_TASKS) return 'under';
  return 'balanced';
}

export function computeEnergy(
  ledger: CompletionLedger,
  config: FocusAreaConfig,
  window: EnergyWindow,
  settings: BalanceSettings,
  history: Record<string, Availability>,
  today: Availability,
): EnergyReport {
  const areas = config.areas;
  const firstMs = Math.min(...Object.values(ledger.entries).map(e => Date.parse(e.completedAt)).filter(t => !Number.isNaN(t)));
  const first = Number.isFinite(firstMs) ? new Date(new Date(firstMs).setHours(0, 0, 0, 0)) : null;
  const days = windowDays(window, first);
  const todayKey = dayKey(new Date());

  // Completions per day per bucket
  const doneBy = new Map<string, Record<FocusAreaId, number>>();
  for (const e of Object.values(ledger.entries)) {
    if (config.excludeSources?.includes(e.source)) continue;
    const area = entryArea(config, e);
    if (!area || !areas.some(a => a.id === area)) continue;
    const k = dayKey(new Date(e.completedAt));
    const row = doneBy.get(k) || {};
    row[area] = (row[area] || 0) + 1;
    doneBy.set(k, row);
  }

  let estimated = false;
  const acc = new Map<FocusAreaId, { fairCount: number; fairShare: number; focusDays: number; done: number; goal: number; available: number }>();
  for (const a of areas) acc.set(a.id, { fairCount: 0, fairShare: 0, focusDays: 0, done: 0, goal: 0, available: 0 });
  let totalDone = 0;

  for (const day of days) {
    const k = dayKey(day);
    let avail = k === todayKey ? today : history[k];
    if (!avail) {
      avail = today;
      estimated = true;
    }
    const done = doneBy.get(k) || {};
    const goals: Record<FocusAreaId, number> = {};
    for (const a of areas) goals[a.id] = (avail[a.id] || 0) * (settings.paces[a.id] ?? DEFAULT_PACES[a.id] ?? 0.2);
    const goalSum = Object.values(goals).reduce((s, n) => s + n, 0);
    const active = areas.filter(a => goals[a.id] > 0 || (done[a.id] || 0) > 0).length;
    const doneSum = areas.reduce((s, a) => s + (done[a.id] || 0), 0);
    totalDone += doneSum;

    for (const a of areas) {
      const r = acc.get(a.id)!;
      const d = done[a.id] || 0;
      const g = goals[a.id];
      r.done += d;
      r.goal += g;
      r.available += avail[a.id] || 0;
      if (doneSum > 0 && goalSum > 0) {
        const isActive = g > 0 || d > 0;
        const fair = isActive ? (1 / active + g / goalSum) / 2 : 0;
        // Capacity: never expect more of a bucket than its own goal (at least one task when it has any work).
        const cap = g > 0 ? Math.max(g, 1) : 0;
        r.fairShare += fair;
        r.fairCount += Math.min(fair * doneSum, cap);
        r.focusDays += 1;
      }
    }
  }

  return {
    window,
    days: days.length,
    totalDone,
    estimated,
    areas: areas.map(a => {
      const r = acc.get(a.id)!;
      // Over a window, a light day and a strong day balance out: judge the totals.
      const ratio = r.goal > 0 ? Math.min(RATIO_CAP, r.done / r.goal) : r.done > 0 ? RATIO_CAP : 0;
      const idle = r.goal === 0 && r.done === 0;
      // Nothing on its plate → nothing to nudge.
      const progress = idle ? 'inline' : progressOf(ratio);
      const focus = r.focusDays ? focusOf(r.done, r.fairCount) : 'balanced';
      const inLineAt = r.goal > 0 ? Math.max(1, Math.ceil(r.goal * IN_LINE_FROM - 1e-9)) : 0;
      return {
        id: a.id,
        name: a.name,
        done: r.done,
        goal: r.goal,
        available: r.available,
        ratio,
        progress,
        share: totalDone ? r.done / totalDone : 0,
        fairShare: r.focusDays ? r.fairShare / r.focusDays : 0,
        fairCount: r.fairCount,
        focus,
        toInLine: progress === 'charge' ? Math.max(0, inLineAt - r.done) : 0,
        toBalanced: focus === 'under' ? Math.max(1, Math.ceil(r.fairCount * UNDER_RATIO - r.done - 1e-9)) : 0,
        overBy: focus === 'over' ? Math.round(r.done - r.fairCount) : 0,
        idle,
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Suggestions: open work that would charge a bucket (habits due today first)
// ---------------------------------------------------------------------------

export type Suggestion = { title: string; source: SourceId; why: 'habit' | 'task' };

export function bucketSuggestions(
  config: FocusAreaConfig,
  snapshots: Record<SourceId, SourceSnapshot>,
  selfItems: SelfItem[],
  ledger: CompletionLedger,
  schedule: HabitSchedule[] | null,
): Record<FocusAreaId, Suggestion[]> {
  const out: Record<FocusAreaId, Suggestion[]> = {};
  const seen = new Set<string>();
  const add = (area: FocusAreaId | undefined, s: Suggestion) => {
    if (!area || !config.areas.some(a => a.id === area)) return;
    const key = `${area}|${s.title.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    (out[area] ||= []).push(s);
  };
  const todayKey = dayKey(new Date());
  const doneToday = new Set(
    Object.values(ledger.entries)
      .filter(e => dayKey(new Date(e.completedAt)) === todayKey)
      .map(e => `${e.source}::${e.taskId}`),
  );

  // 1. TickTick habits due today and not yet done
  if (schedule) {
    for (const h of schedule) {
      if (!habitDueOn(h, new Date()) || doneToday.has(`ticktick::${h.id}`)) continue;
      add(resolveFocusArea({ source: 'ticktick', taskId: h.id, title: h.title, kind: 'habit' }, config), {
        title: h.title || 'Habit',
        source: 'ticktick',
        why: 'habit',
      });
    }
  }
  // 2. TickTick tasks due today / overdue, then Self tasks, then everything else that's open
  const order: SourceId[] = [
    'ticktick',
    ...(Object.keys(snapshots) as SourceId[]).filter(s => s !== 'ticktick' && s !== 'self'),
  ];
  const fromSource = (source: SourceId) => {
    if (NO_WORKLOAD_SOURCES.includes(source) || config.excludeSources?.includes(source)) return;
    for (const t of snapshots[source]?.tasks || []) {
      if (t.status === 'done' || doneToday.has(`${source}::${t.id}`)) continue;
      if (source === 'ticktick' && (t.kind === 'habit' || t.id.startsWith('habit-'))) continue;
      add(areaFor(config, source, t), { title: t.title, source, why: 'task' });
    }
  };
  fromSource(order[0]);
  for (const i of selfItems) {
    if (!i.done) add(i.focusAreaId || areaFor(config, 'self', { id: i.id, title: i.title }), { title: i.title, source: 'self', why: 'task' });
  }
  for (const source of order.slice(1)) fromSource(source);
  return out;
}
