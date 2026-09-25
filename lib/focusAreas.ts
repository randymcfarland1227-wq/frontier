/** Focus areas (life balance): map completions to areas and score share vs benchmark. */

import type { SourceId, SourceSnapshot } from './types';
import type { CompletionEntry, CompletionLedger } from './completions';

export type FocusAreaId = string;

export type FocusSourceRule = {
  source: SourceId;
  /** Every field given must match. If match is omitted, all items from this source count. */
  match?: {
    projectIds?: string[];
    tags?: string[];
    titleIncludes?: string[];
    kinds?: Array<'habit' | 'task' | 'mail'>;
  };
};

export type FocusArea = {
  id: FocusAreaId;
  name: string;
  /** 0–1; all weights should sum to 1 */
  weight: number;
  /** Target share of completions; default = weight */
  benchmark?: number;
  sourceMap: FocusSourceRule[];
  color?: string;
};

export type RoutineConfig = {
  /** Routine Hub Apps Script `?action=routines` (live) */
  api?: string;
  /** Bundled fallback, relative to the site base */
  snapshot?: string;
  categoryAreas: Record<string, FocusAreaId>;
  /** Per-routine override (routine id → area) for mixed categories like Organizing */
  routineAreas?: Record<string, FocusAreaId>;
};

type Routine = { id: string; category: string; focus: string };

export type FocusAreaConfig = {
  version: number;
  /** Bump to re-sort history recorded under older rules */
  rulesVersion?: number;
  routines?: RoutineConfig;
  areas: FocusArea[];
  /** Items that aren't tasks (reminders, reference notes), per source */
  ignore?: Partial<Record<SourceId, { titleIncludes?: string[]; titles?: string[] }>>;
  /** Sources whose completions never count toward Balance (e.g. site repair) */
  excludeSources?: SourceId[];
};

/** Bucket for completions no rule matched — counted, never dropped. */
export const OTHER_AREA_ID = 'other';

/** What a rule can see about an item at record time. */
export type FocusSubject = {
  source: SourceId;
  taskId: string;
  title?: string;
  kind?: string;
  projectId?: string;
  tags?: string[];
};

let loadedConfig: FocusAreaConfig | null = null;
/** Normalized routine name → area, built from Routine Hub */
let routineIndex: Array<{ key: string; area: FocusAreaId }> = [];

/** Lowercase words, trailing plural "s" dropped, so "Healthy Mind Sessions- Foundations" ≈ "Healthy Minds Session". */
function routineKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .map(w => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w))
    .join(' ');
}

function buildRoutineIndex(routines: Routine[], cfg: RoutineConfig) {
  routineIndex = routines
    .map(r => ({ key: routineKey(r.focus || ''), area: cfg.routineAreas?.[r.id] ?? cfg.categoryAreas[r.category] }))
    .filter((r): r is { key: string; area: FocusAreaId } => Boolean(r.key && r.area))
    // Longest name first so the most specific routine wins a prefix match
    .sort((a, b) => b.key.length - a.key.length);
}

/** Area from Routine Hub: exact name match, else the title starts with a routine's name. */
function routineArea(title?: string): FocusAreaId | undefined {
  if (!title || !routineIndex.length) return undefined;
  const key = routineKey(title);
  return (
    routineIndex.find(r => r.key === key)?.area ??
    routineIndex.find(r => r.key.split(' ').length >= 2 && key.startsWith(`${r.key} `))?.area
  );
}

export function getFocusConfig(): FocusAreaConfig | null {
  return loadedConfig;
}

/** True for items that aren't tasks (reminders, reference notes) per focus-areas.json `ignore`. */
export function isIgnoredItem(source: SourceId, title: string | undefined, config: FocusAreaConfig | null = loadedConfig): boolean {
  const rule = config?.ignore?.[source];
  if (!rule || !title) return false;
  const t = title.trim().toLowerCase();
  return (
    (rule.titles || []).some(x => x.trim().toLowerCase() === t) ||
    (rule.titleIncludes || []).some(x => x && t.includes(x.toLowerCase()))
  );
}

function baseUrl(): string {
  const raw = (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env?.BASE_URL;
  if (typeof raw === 'string' && raw.length) return raw.endsWith('/') ? raw : `${raw}/`;
  if (typeof window !== 'undefined' && window.location.pathname.startsWith('/frontier')) return '/frontier/';
  return '/';
}

function isConfig(value: unknown): value is FocusAreaConfig {
  if (!value || typeof value !== 'object') return false;
  const areas = (value as FocusAreaConfig).areas;
  return (
    Array.isArray(areas) &&
    areas.every(
      a => a && typeof a.id === 'string' && typeof a.name === 'string' && typeof a.weight === 'number' && Array.isArray(a.sourceMap),
    )
  );
}

/** Fetch `public/data/focus-areas.json` once and cache it for record-time resolution. */
export async function loadFocusAreas(): Promise<FocusAreaConfig | null> {
  try {
    const res = await fetch(`${baseUrl()}data/focus-areas.json`, { cache: 'no-store' });
    if (!res.ok) return null;
    const json: unknown = await res.json();
    if (!isConfig(json)) return null;
    if (json.routines) await loadRoutines(json.routines);
    loadedConfig = json;
    return json;
  } catch {
    return null;
  }
}

async function loadRoutines(cfg: RoutineConfig) {
  const get = async (url: string) => {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      return res.ok ? ((await res.json()) as unknown) : null;
    } catch {
      return null;
    }
  };
  const isRoutines = (v: unknown): v is Routine[] =>
    Array.isArray(v) && v.length > 0 && v.every(r => r && typeof r.focus === 'string' && typeof r.category === 'string');
  const live = cfg.api ? await get(cfg.api) : null;
  if (isRoutines(live)) return buildRoutineIndex(live, cfg);
  const snap = cfg.snapshot ? ((await get(`${baseUrl()}${cfg.snapshot}`)) as { routines?: unknown } | null) : null;
  if (isRoutines(snap?.routines)) buildRoutineIndex(snap.routines, cfg);
}

function inferKind(subject: FocusSubject): string | undefined {
  if (subject.kind) return subject.kind;
  if (subject.source === 'ticktick' && subject.taskId.startsWith('habit-')) return 'habit';
  return undefined;
}

/**
 * Specificity of a matching rule, or -1 when it does not match.
 * projectIds/tags (3) > titleIncludes (2) > kinds (1) > bare source (0); criteria add up.
 */
function ruleScore(rule: FocusSourceRule, subject: FocusSubject): number {
  if (rule.source !== subject.source) return -1;
  const m = rule.match;
  if (!m) return 0;
  let score = 0;
  if (m.projectIds?.length) {
    if (!subject.projectId || !m.projectIds.includes(subject.projectId)) return -1;
    score += 3;
  }
  if (m.tags?.length) {
    const tags = (subject.tags || []).map(t => t.toLowerCase());
    if (!m.tags.some(t => tags.includes(t.toLowerCase()))) return -1;
    score += 3;
  }
  if (m.titleIncludes?.length) {
    const title = (subject.title || '').toLowerCase();
    if (!m.titleIncludes.some(s => title.includes(s.toLowerCase()))) return -1;
    score += 2;
  }
  if (m.kinds?.length) {
    const kind = inferKind(subject);
    if (!kind || !(m.kinds as string[]).includes(kind)) return -1;
    score += 1;
  }
  return score;
}

/** Most specific matching rule wins; ties go to the area listed first. Undefined = Other. */
export function resolveFocusArea(
  subject: FocusSubject,
  config: FocusAreaConfig | null = loadedConfig,
): FocusAreaId | undefined {
  if (!config) return undefined;
  let best: { id: FocusAreaId; score: number } | undefined;
  // Routine Hub category: beats a single project/tag rule (3), loses to project+title combos (5)
  if (subject.source === 'ticktick') {
    const area = routineArea(subject.title);
    if (area) best = { id: area, score: 4 };
  }
  for (const area of config.areas) {
    for (const rule of area.sourceMap) {
      const score = ruleScore(rule, subject);
      if (score > (best?.score ?? -1)) best = { id: area.id, score };
    }
  }
  return best?.id;
}

/**
 * Tag ledger entries recorded before areas loaded (or before this feature). Looks each task up in
 * the current snapshots so project/kind rules apply; falls back to title-only. Returns true if changed.
 */
export function backfillFocusAreas(
  ledger: CompletionLedger,
  config: FocusAreaConfig,
  snapshots?: Partial<Record<SourceId, SourceSnapshot>>,
): boolean {
  let changed = false;
  for (const entry of Object.values(ledger.entries)) {
    if (entry.focusManual) continue;
    if (entry.focusAreaId && (entry.focusRules ?? 1) >= (config.rulesVersion ?? 1)) continue;
    const task = snapshots?.[entry.source]?.tasks?.find(t => t.id === entry.taskId);
    const id = resolveFocusArea(
      {
        source: entry.source,
        taskId: entry.taskId,
        title: entry.title || task?.title,
        kind: task?.kind,
        projectId: task?.projectId,
        tags: task?.tags,
      },
      config,
    );
    if (id && (id !== entry.focusAreaId || entry.focusRules !== (config.rulesVersion ?? 1))) {
      entry.focusAreaId = id;
      entry.focusRules = config.rulesVersion ?? 1;
      changed = true;
    }
  }
  return changed;
}

export type BalanceWindow = 'today' | 'last7' | 'month';

export type AreaBalance = {
  focusAreaId: FocusAreaId;
  name: string;
  count: number;
  actualShare: number;
  benchmark: number;
  delta: number;
  score: number;
  status: 'healthy' | 'starved' | 'overloaded';
};

export type BalanceReport = {
  window: BalanceWindow;
  total: number;
  /** 0–100: 100 minus total-variation distance between actual and benchmark shares */
  overall: number;
  areas: AreaBalance[];
};

/** |delta| within this many share points reads as on target. */
export const BALANCE_TOLERANCE = 0.05;

function windowStart(window: BalanceWindow, now = new Date()): number {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (window === 'today') return today;
  if (window === 'last7') return today - 6 * 24 * 60 * 60 * 1000;
  return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
}

function areaOf(entry: CompletionEntry, config: FocusAreaConfig): FocusAreaId {
  const id = entry.focusAreaId ?? resolveFocusArea({ source: entry.source, taskId: entry.taskId, title: entry.title }, config);
  return id && config.areas.some(a => a.id === id) ? id : OTHER_AREA_ID;
}

export function computeBalance(
  ledger: CompletionLedger,
  config: FocusAreaConfig,
  window: BalanceWindow,
): BalanceReport {
  const start = windowStart(window);
  const counts = new Map<FocusAreaId, number>();
  let total = 0;
  for (const entry of Object.values(ledger.entries)) {
    const t = Date.parse(entry.completedAt);
    if (Number.isNaN(t) || t < start) continue;
    if (config.excludeSources?.includes(entry.source)) continue;
    total += 1;
    const id = areaOf(entry, config);
    counts.set(id, (counts.get(id) || 0) + 1);
  }

  const rows = [
    ...config.areas.map(a => ({ id: a.id, name: a.name, benchmark: a.benchmark ?? a.weight })),
    { id: OTHER_AREA_ID, name: 'Other', benchmark: 0 },
  ];

  const areas: AreaBalance[] = rows
    .map(row => {
      const count = counts.get(row.id) || 0;
      const actualShare = total ? count / total : 0;
      const delta = actualShare - row.benchmark;
      return {
        focusAreaId: row.id,
        name: row.name,
        count,
        actualShare,
        benchmark: row.benchmark,
        delta,
        score: Math.round(100 - Math.min(100, Math.abs(delta) * 100)),
        status:
          Math.abs(delta) <= BALANCE_TOLERANCE ? 'healthy' : delta < 0 ? 'starved' : 'overloaded',
      } satisfies AreaBalance;
    })
    // Hide Other when nothing fell through
    .filter(a => a.focusAreaId !== OTHER_AREA_ID || a.count > 0);

  const tvd = areas.reduce((sum, a) => sum + Math.abs(a.delta), 0) / 2;
  return { window, total, overall: total ? Math.round(100 * (1 - Math.min(1, tvd))) : 0, areas };
}
