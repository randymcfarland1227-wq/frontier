/**
 * Daily brief: what needs you today, gathered from the snapshots Life Hub already holds.
 * Pure functions so the Home section and anything else (a routine's report) read the same list.
 */

import type { SourceId, SourceSnapshot, TaskItem } from './types';
import { isOverdue } from './billEdits';
import { dayKey, money, type BillDue } from './schedule';
import { sourceById } from './sources';

export type BriefRow = {
  /** Stable id (for "new since you last looked") */
  id: string;
  title: string;
  note: string;
  tone?: 'late' | 'today';
  /** Where a tap goes: a site's page, or the Money page */
  go: SourceId | 'money';
  /** Pin key, when the row is a task the side panel can open */
  pin?: string;
};
export type BriefSection = { id: 'money' | 'tasks' | 'mail' | 'roles' | 'sales'; label: string; rows: BriefRow[] };

const isHabit = (t: TaskItem) => t.kind === 'habit' || t.id.startsWith('habit-');
const DAY = 86400000;

function money_(bills: BillDue[]): BriefRow[] {
  return bills
    .filter(d => !d.skipped && d.bill.kind !== 'plan' && (isOverdue(d) || d.days === 0))
    .sort((a, b) => a.due.localeCompare(b.due))
    .map(d => ({
      id: `bill:${d.key}`,
      title: d.bill.name,
      note: `${d.bill.amount ? `${money(d.bill.amount)} · ` : ''}${d.days < 0 ? `${-d.days}d overdue` : 'due today'}`,
      tone: d.days < 0 ? ('late' as const) : ('today' as const),
      go: 'money' as const,
    }));
}

function tasksDue(snaps: Record<SourceId, SourceSnapshot>, now: Date): BriefRow[] {
  const today = dayKey(now);
  const rows: BriefRow[] = [];
  for (const id of Object.keys(snaps) as SourceId[]) {
    if (id === 'gmail' || id === 'outlook' || id === 'role' || id === 'resale') continue;
    for (const t of snaps[id].tasks) {
      if (t.status === 'done' || isHabit(t) || !t.due) continue;
      const due = t.due.slice(0, 10);
      if (due > today) continue;
      const late = Math.round((new Date(`${today}T00:00:00`).getTime() - new Date(`${due}T00:00:00`).getTime()) / DAY);
      rows.push({
        id: `task:${id}:${t.id}`,
        title: t.title,
        note: `${sourceById[id]?.shortName || id} · ${late > 0 ? `${late}d overdue` : 'today'}`,
        tone: late > 0 ? 'late' : 'today',
        go: id,
        pin: `${id}:${t.id}`,
      });
    }
  }
  return rows.sort((a, b) => Number(b.tone === 'late') - Number(a.tone === 'late'));
}

function mailRows(snaps: Record<SourceId, SourceSnapshot>): BriefRow[] {
  const rows: BriefRow[] = [];
  for (const id of ['gmail', 'outlook'] as const) {
    for (const f of snaps[id]?.featured || []) {
      rows.push({ id: `mail:${id}:${f.id}`, title: f.title, note: [sourceById[id].shortName, f.meta].filter(Boolean).join(' · '), go: id });
    }
  }
  return rows;
}

const RESPONSE = /repl|respon|interview|recruit|offer|assess|screen|reject|schedule/i;
function roleRows(snap?: SourceSnapshot): BriefRow[] {
  if (!snap) return [];
  const rows: BriefRow[] = [];
  for (const f of snap.featured) rows.push({ id: `role:f:${f.id}`, title: f.title, note: f.meta || f.detail, go: 'role' });
  for (const t of snap.tasks) {
    if (t.status === 'done') continue;
    if (RESPONSE.test(`${t.tag || ''} ${t.title}`)) rows.push({ id: `role:t:${t.id}`, title: t.title, note: t.tag || 'Role Hub', go: 'role', pin: `role:${t.id}` });
  }
  return rows;
}

function saleRows(snap?: SourceSnapshot): BriefRow[] {
  if (!snap) return [];
  return snap.tasks
    .filter(t => t.status !== 'done' && /ship|sold|offer|end listing/i.test(t.tag || t.title))
    .map(t => ({ id: `sale:${t.id}`, title: t.title, note: t.tag || 'Resale', go: 'resale' as const, pin: `resale:${t.id}` }));
}

export function buildBrief(snaps: Record<SourceId, SourceSnapshot>, bills: BillDue[], now = new Date()): BriefSection[] {
  return [
    { id: 'money', label: 'Money · overdue or due today', rows: money_(bills) },
    { id: 'tasks', label: 'Tasks due today', rows: tasksDue(snaps, now) },
    { id: 'mail', label: 'Mail needing you', rows: mailRows(snaps) },
    { id: 'roles', label: 'Roles · replies & next steps', rows: roleRows(snaps.role) },
    { id: 'sales', label: 'Sold & selling · to do', rows: saleRows(snaps.resale) },
  ];
}

// ---------------------------------------------------------------------------
// Morning digest feed: Home pushes this to the Worker (PUT /api/brief) so Queen Bee's routine can read it.
// ---------------------------------------------------------------------------

import { useEffect, useRef } from 'react';
import { syncKeyHeader } from './cloudSync';
import { incomingDues, useIncoming } from './incoming';
import { loadCachedMoney, parseMoney } from './money';

const WORKER_BASE =
  (import.meta as ImportMeta & { env?: { VITE_WORKER_URL?: string } }).env?.VITE_WORKER_URL ||
  'https://frontier-work-room.randymcfarland1227.workers.dev';

export function briefPayload(snaps: Record<SourceId, SourceSnapshot>, bills: BillDue[], paydays: { source: string; due: string; amount?: number }[], cashAvailable: string | null, now = new Date()) {
  const open = bills.filter(d => !d.skipped && d.bill.kind !== 'plan');
  const line = (d: BillDue) => ({ name: d.bill.name, amount: d.bill.amount ?? null, dueDate: d.due });
  const sections = buildBrief(snaps, bills, now);
  const rows = (id: BriefSection['id']) => sections.find(s => s.id === id)?.rows || [];
  return {
    generatedAt: now.toISOString(),
    dueToday: open.filter(d => d.days === 0).map(line),
    overdue: open.filter(isOverdue).map(line),
    cashAvailable,
    nextPayday: paydays[0] ? { source: paydays[0].source, date: paydays[0].due, amount: paydays[0].amount ?? null } : null,
    tasksDueToday: rows('tasks').map(r => ({ title: r.title, note: r.note, link: `https://randymcfarland1227-wq.github.io/frontier/` })),
    mail: rows('mail').map(r => ({ title: r.title, note: r.note })),
    roles: rows('roles').map(r => ({ title: r.title, note: r.note })),
    soldItems: rows('sales').map(r => ({ title: r.title, note: r.note })),
  };
}

/** Pushes the brief when it changes (and at most every 5 minutes). Quiet when backup is off or offline. */
export function useBriefPush(snaps: Record<SourceId, SourceSnapshot>, bills: BillDue[]) {
  const incoming = useIncoming();
  const last = useRef({ sig: '', at: 0 });
  useEffect(() => {
    const t = window.setTimeout(() => {
      const headers = syncKeyHeader();
      if (!headers['X-Sync-Key']) return;
      let cash: string | null = null;
      try {
        const snap = loadCachedMoney();
        cash = (snap && parseMoney(snap).cashOnHand?.text) || null;
      } catch {
        cash = null;
      }
      const paydays = incomingDues(incoming, new Date(), 0, 30).filter(d => (d.item.amount || 0) > 0).map(d => ({ source: d.item.source, due: d.due, amount: d.item.amount }));
      const body = briefPayload(snaps, bills, paydays, cash);
      const sig = JSON.stringify({ ...body, generatedAt: '' });
      if (sig === last.current.sig && Date.now() - last.current.at < 30 * 60 * 1000) return;
      if (Date.now() - last.current.at < 5 * 60 * 1000) return;
      last.current = { sig, at: Date.now() };
      void fetch(`${WORKER_BASE}/api/brief`, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }).catch(() => undefined);
    }, 4000);
    return () => window.clearTimeout(t);
  }, [snaps, bills, incoming]);
}
