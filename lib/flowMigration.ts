/** Pure, review-first classification migration. Never creates or removes a completion. */
import type { CompletionLedger } from './completions';
import type { TaskRuleMap } from './taskRules';

export type SortingState = { rules: TaskRuleMap; completions: CompletionLedger };
export type SortingChange = { key: string; area: string; goal?: string | null };
export type SortingAudit = { version: 1; at: string; changes: Array<{ key: string; before: TaskRuleMap[string] | null; after: TaskRuleMap[string]; entries: string[] }> };
export const sortingTitle = (title?: string) => (title || '').toLowerCase().replace(/\s+/g, ' ').trim();
export const sortingKey = (source: string, title: string | undefined, id: string) => sortingTitle(title) ? `${source}::t:${sortingTitle(title)}` : `${source}::id:${id}`;

export function migrateSorting(before: SortingState, changes: SortingChange[], areas: string[], goals: string[], at: string) {
  if (!Number.isFinite(Date.parse(at))) throw new Error('Invalid migration date');
  const next: SortingState = structuredClone(before);
  const audit: SortingAudit = { version: 1, at, changes: [] };
  const seen = new Set<string>();
  for (const c of changes) {
    if (seen.has(c.key) || !c.key.includes('::') || c.key.endsWith('::*')) throw new Error('Only unique, individual task changes may be applied');
    seen.add(c.key);
    if (!areas.includes(c.area) || (c.goal && c.goal !== 'none' && !goals.includes(c.goal))) throw new Error('Unknown bucket or goal');
    const old = before.rules[c.key];
    const rule = { ...old, area: c.area, ...(c.goal === undefined ? {} : { goal: c.goal }), at };
    const entries: string[] = [];
    for (const [id, e] of Object.entries(next.completions.entries)) {
      if (sortingKey(e.source, e.title, e.taskId) !== c.key || e.focusAreaId === c.area) continue;
      e.focusAreaId = c.area;
      e.focusManual = true;
      e.focusUpdatedAt = at;
      entries.push(id);
    }
    if (old?.area === rule.area && old?.goal === rule.goal && !entries.length) continue;
    next.rules[c.key] = rule;
    audit.changes.push({ key: c.key, before: old || null, after: rule, entries });
  }
  return { next, audit };
}
