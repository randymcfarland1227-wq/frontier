/**
 * Money: the Radall sheet's money tabs, read for the Money page and the money layer on the calendar.
 *
 * The "Life Hub Mail Sync" Apps Script (apps-script/LifeHubMoney.gs) ships each tab as shown —
 * display values, crossed-out cells, formula cells and merges — to the Worker every 10 min
 * (`/api/money/snapshot`). This file finds each block by its heading (so blocks can move around)
 * and turns it into tables and dated money items. The sheet stays the source of truth: edits made
 * on the Money page go back through the script (`/api/money/edit`), which only writes a cell if it
 * still shows what Life Hub showed, never touches formulas, and logs every change.
 *
 * Money items are never tasks: they show on the calendar and the Money page only.
 */

import { syncKeyHeader } from './cloudSync';
import { readSaved, writeSaved } from './storage';
import { addDays, dayKey, daysBetween, fromDayKey, startOfDay, type BillDue } from './schedule';

const WORKER_BASE =
  (import.meta as ImportMeta & { env?: { VITE_WORKER_URL?: string } }).env?.VITE_WORKER_URL ||
  'https://frontier-work-room.randymcfarland1227.workers.dev';

const CACHE_KEY = 'lifehub-money-cache';

// ---------------------------------------------------------------------------
// Snapshot (raw, as the script sends it)
// ---------------------------------------------------------------------------

export type MoneyTab = {
  gid?: number;
  /** Display values, trailing empty cells trimmed per row */
  v: string[][];
  /** Crossed-out cells [row, col] (0-based) */
  s?: Array<[number, number]>;
  /** Cells holding formulas */
  f?: Array<[number, number]>;
  /** Merged ranges [r1, c1, r2, c2] (0-based, inclusive) */
  m?: Array<[number, number, number, number]>;
};

export type MoneySnapshot = {
  source: 'money';
  refreshedAt: string;
  sheetUrl?: string;
  tabs: Record<string, MoneyTab>;
};

export function loadCachedMoney(): MoneySnapshot | null {
  return readSaved<MoneySnapshot | null>(CACHE_KEY, null);
}

function validSnapshot(s: unknown): s is MoneySnapshot {
  const x = s as MoneySnapshot | null;
  return Boolean(x && x.source === 'money' && typeof x.refreshedAt === 'string' && x.tabs && typeof x.tabs === 'object');
}

export async function pullMoneySnapshot(): Promise<MoneySnapshot | null> {
  try {
    const res = await fetch(`${WORKER_BASE}/api/money/snapshot`, { headers: syncKeyHeader(), cache: 'no-store' });
    if (!res.ok) return null;
    const s = ((await res.json()) as { snapshot?: unknown }).snapshot;
    if (!validSnapshot(s)) return null;
    writeSaved(CACHE_KEY, s);
    return s;
  } catch {
    return null;
  }
}

export type CellEdit =
  | { tab: string; r: number; c: number; expect: string; value: string }
  | { tab: string; r: number; c1: number; c2: number; expect: string; strike: boolean };

export type EditResult = { ok: boolean; error?: string; now?: string };

/** Write edits to the sheet (through the Worker + script). Returns the fresh snapshot on success. */
export async function saveMoneyEdits(edits: CellEdit[]): Promise<{ ok: boolean; results: EditResult[]; snapshot?: MoneySnapshot; error?: string }> {
  try {
    const res = await fetch(`${WORKER_BASE}/api/money/edit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...syncKeyHeader() },
      body: JSON.stringify({ edits }),
    });
    const body = (await res.json()) as { ok?: boolean; results?: EditResult[]; snapshot?: unknown; error?: string };
    const snapshot = validSnapshot(body.snapshot) ? body.snapshot : undefined;
    if (snapshot) writeSaved(CACHE_KEY, snapshot);
    return { ok: body.ok === true, results: body.results || [], snapshot, error: body.error };
  } catch (err) {
    return { ok: false, results: [], error: String(err) };
  }
}

// ---------------------------------------------------------------------------
// Grid helpers
// ---------------------------------------------------------------------------

export type Cell = {
  tab: string;
  r: number;
  c: number;
  text: string;
  formula: boolean;
  struck: boolean;
};

class Grid {
  readonly tab: string;
  private v: string[][];
  private struck: Set<string>;
  private formulas: Set<string>;
  private merges: Array<[number, number, number, number]>;

  constructor(tab: string, raw: MoneyTab) {
    this.tab = tab;
    this.v = raw.v || [];
    this.struck = new Set((raw.s || []).map(([r, c]) => `${r},${c}`));
    this.formulas = new Set((raw.f || []).map(([r, c]) => `${r},${c}`));
    this.merges = raw.m || [];
  }

  get rows() {
    return this.v.length;
  }

  text(r: number, c: number): string {
    return (this.v[r]?.[c] ?? '').trim();
  }

  cell(r: number, c: number): Cell {
    return {
      tab: this.tab,
      r,
      c,
      text: this.text(r, c),
      formula: this.formulas.has(`${r},${c}`),
      struck: this.struck.has(`${r},${c}`),
    };
  }

  /** Text of a merged block's top-left cell (group labels down the side). */
  mergedText(r: number, c: number): string {
    const m = this.merges.find(([r1, c1, r2, c2]) => r >= r1 && r <= r2 && c >= c1 && c <= c2);
    return m ? this.text(m[0], m[1]) : this.text(r, c);
  }

  mergeAt(r: number, c: number) {
    return this.merges.find(([r1, c1, r2, c2]) => r >= r1 && r <= r2 && c >= c1 && c <= c2);
  }

  /** First cell whose trimmed text matches (case-insensitive), scanning row by row. `merged`: only block titles (merged cells). */
  find(match: string | RegExp, from = 0, merged = false): { r: number; c: number } | null {
    const test = typeof match === 'string' ? (t: string) => t.toLowerCase() === match.toLowerCase() : (t: string) => match.test(t);
    for (let r = from; r < this.v.length; r++) {
      const row = this.v[r] || [];
      for (let c = 0; c < row.length; c++) if (row[c] && test(row[c].trim()) && (!merged || this.mergeAt(r, c))) return { r, c };
    }
    return null;
  }
}

export type Table = {
  key: string;
  title: string;
  tab: string;
  header: string[];
  rows: Cell[][];
  total?: Cell[];
  /** Group label per row (from a merged side column), when the block has one */
  groups?: string[];
};

type BlockOpts = {
  /** Column span; defaults to the title's merged width */
  cols?: [number, number];
  /** Header row: 'next' (the row under the title), 'same' (the title's own row), or fixed labels */
  header?: 'next' | 'same' | string[];
  /** Only match merged block titles */
  merged?: boolean;
  /** Column (within the span) that names a row; empty name + values = a total row (-1: no totals) */
  nameCol?: number;
  /** Stop at the first total row (default true) */
  stopAfterTotal?: boolean;
  /** Blank rows to step over before stopping (default 0) */
  gaps?: number;
  maxRows?: number;
  /** Column (absolute) holding a merged group label for each row */
  groupCol?: number;
  /** Stop when a row's name matches */
  stopAt?: RegExp;
};

function block(g: Grid | undefined, key: string, title: string | RegExp, o: BlockOpts = {}, from = 0): Table | null {
  if (!g) return null;
  const at = g.find(title, from, o.merged);
  if (!at) return null;
  const merge = g.mergeAt(at.r, at.c);
  const [c1, c2] = o.cols || (merge ? [merge[1], merge[3]] : [at.c, at.c]);
  const width = c2 - c1 + 1;
  let r = at.r + 1;
  let header: string[];
  if (Array.isArray(o.header)) header = o.header;
  else if (o.header === 'same') header = Array.from({ length: width }, (_, i) => g.text(at.r, c1 + i));
  else {
    header = Array.from({ length: width }, (_, i) => g.text(r, c1 + i));
    r += 1;
  }
  const nameCol = o.nameCol ?? 0;
  const rows: Cell[][] = [];
  const groups: string[] = [];
  let total: Cell[] | undefined;
  let gaps = 0;
  const last = Math.min(g.rows, r + (o.maxRows ?? 60));
  for (; r < last; r++) {
    const cells = Array.from({ length: width }, (_, i) => g.cell(r, c1 + i));
    if (cells.every(c => !c.text)) {
      gaps++;
      if (gaps > (o.gaps ?? 0)) break;
      continue;
    }
    gaps = 0;
    const name = cells[nameCol]?.text || '';
    if (o.stopAt && o.stopAt.test(name)) break;
    if (nameCol >= 0 && !name && cells.some(c => c.text)) {
      total = cells;
      if (o.stopAfterTotal ?? true) break;
      continue;
    }
    rows.push(cells);
    if (o.groupCol !== undefined) groups.push(g.mergedText(r, o.groupCol));
  }
  return {
    key,
    title: typeof title === 'string' ? title : g.text(at.r, at.c),
    tab: g.tab,
    header,
    rows,
    total,
    groups: o.groupCol !== undefined ? groups : undefined,
  };
}

// ---------------------------------------------------------------------------
// Parsing values
// ---------------------------------------------------------------------------

/** "$1,028.93" → 1028.93, "-$165" → -165, "??" → undefined */
export function amountOf(text: string): number | undefined {
  const t = text.replace(/[$,\s]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(t)) return undefined;
  return Number(t);
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * Sheet dates come typed many ways: "10/3", "September 30", "Oct 7,2026", "Jul 26", "Sep 14–20".
 * Without a year, pick the year that puts it closest to today.
 */
export function parseSheetDate(text: string, today = new Date()): string | undefined {
  const t = text.trim();
  let m: number | undefined;
  let d: number | undefined;
  let y: number | undefined;
  let hit = t.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (hit) {
    m = Number(hit[1]) - 1;
    d = Number(hit[2]);
    if (hit[3]) y = Number(hit[3].length === 2 ? `20${hit[3]}` : hit[3]);
  } else {
    hit = t.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:\s*[–-]\s*\d{1,2})?(?:\s*,\s*(\d{4}))?$/);
    if (hit) {
      m = MONTHS.indexOf(hit[1].slice(0, 3).toLowerCase());
      d = Number(hit[2]);
      if (hit[3]) y = Number(hit[3]);
    }
  }
  if (m === undefined || m < 0 || m > 11 || !d || d < 1 || d > 31) return undefined;
  if (y === undefined) {
    const base = today.getFullYear();
    const t0 = startOfDay(today).getTime();
    y = [base - 1, base, base + 1].reduce((best, cand) =>
      Math.abs(new Date(cand, m!, d).getTime() - t0) < Math.abs(new Date(best, m!, d).getTime() - t0) ? cand : best,
    );
  }
  const date = new Date(y, m, d);
  if (date.getMonth() !== m) return undefined;
  return dayKey(date);
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x';

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

export type MoneyKind = 'bill' | 'card' | 'sub' | 'paylater';

export const MONEY_KINDS: Record<MoneyKind, { label: string; plural: string; color: string }> = {
  bill: { label: 'Bill', plural: 'Bills', color: '#a8632a' },
  card: { label: 'Card min', plural: 'Card minimums', color: '#b4881f' },
  sub: { label: 'Subscription', plural: 'Subscriptions', color: '#7b4a68' },
  paylater: { label: 'Pay later', plural: 'Pay later', color: '#627332' },
};

export type MoneyItem = {
  /** Stable per occurrence: kind + name + date */
  id: string;
  kind: MoneyKind;
  name: string;
  amount?: number;
  /** YYYY-MM-DD, when the sheet's date could be read */
  date?: string;
  dateText: string;
  /** Crossed out in the sheet (a skipped subscription, a bought item) */
  skipped?: boolean;
  /** Trial / Paused subscriptions */
  status?: string;
  provider?: string;
  installment?: string;
  cells: { date?: Cell; name: Cell; amount?: Cell };
};

export type MoneyModel = {
  refreshedAt: string;
  sheetUrl?: string;
  gids: Record<string, number | undefined>;
  asOf?: string;
  accounts: Table | null;
  cards: Table | null;
  outstanding: Table | null;
  balancing: Table | null;
  cashOnHand?: Cell;
  balancedCash?: Cell;
  bills: Table | null;
  cardMins: Table | null;
  subs: Table | null;
  /** Trial / paused subscriptions listed under the monthly ones */
  subsOther: Cell[][];
  buckets: Table | null;
  monthTotal?: { label: string; cell: Cell };
  upcomingSpend: { rows: Cell[][]; items: Cell[] };
  ledger: Table | null;
  paylaterSums: Table | null;
  restockNeeded: Table | null;
  wants: Table | null;
  recurring: Table | null;
  scores: Array<{ label: string; value: string }>;
  creditAccounts: Table | null;
  creditCards: Table | null;
  collections: Table | null;
  plans: Table[];
  utilEst: Table | null;
  nonCredit: Table[];
  payoff: Table | null;
  savings: Table | null;
  move: Table[];
  items: MoneyItem[];
  /** Headings that weren't found (the sheet moved or renamed them) */
  missing: string[];
};

/** Rows of a block as dated money items. */
function itemsFrom(t: Table | null, kind: MoneyKind, cols: { date: number; name: number; amount: number; provider?: number; installment?: number }, today: Date): MoneyItem[] {
  if (!t) return [];
  return t.rows
    .filter(r => r[cols.name]?.text)
    .map(r => {
      const dateCell = r[cols.date];
      const date = dateCell ? parseSheetDate(dateCell.text, today) : undefined;
      const name = r[cols.name].text;
      const provider = cols.provider !== undefined ? r[cols.provider]?.text : undefined;
      return {
        id: `money:${kind}:${slug(name)}${provider ? `-${slug(provider)}` : ''}${cols.installment !== undefined ? `-${slug(r[cols.installment]?.text || '')}` : ''}:${date || slug(dateCell?.text || 'nodate')}`,
        kind,
        name,
        amount: r[cols.amount] ? amountOf(r[cols.amount].text) : undefined,
        date,
        dateText: dateCell?.text || '',
        skipped: r[cols.name].struck,
        provider,
        installment: cols.installment !== undefined ? r[cols.installment]?.text : undefined,
        cells: { date: dateCell, name: r[cols.name], amount: r[cols.amount] },
      };
    });
}

/** Split a column of stacked tables (each with its own header row) into separate tables. */
function stacked(g: Grid | undefined, key: string, title: string, cols: [number, number], headerFirst: RegExp, groupCol: number): Table[] {
  if (!g) return [];
  const at = g.find(title);
  if (!at) return [];
  const out: Table[] = [];
  let current: Table | null = null;
  for (let r = at.r + 1; r < g.rows; r++) {
    const cells = Array.from({ length: cols[1] - cols[0] + 1 }, (_, i) => g.cell(r, cols[0] + i));
    if (cells.every(c => !c.text)) continue;
    if (headerFirst.test(cells[0].text) && /amount/i.test(cells[cells.length - 1].text)) {
      current = { key: `${key}-${out.length}`, title: '', tab: g.tab, header: cells.map(c => c.text), rows: [] };
      out.push(current);
      continue;
    }
    if (!current) continue;
    const label = g.mergedText(r, groupCol);
    if (!current.title && label) current.title = label;
    if (!cells[0].text && !cells[1]?.text && cells[cells.length - 1].text) current.total = cells;
    else current.rows.push(cells);
  }
  return out.filter(t => t.rows.length);
}

export function parseMoney(snap: MoneySnapshot, today = new Date()): MoneyModel {
  const grid = (name: string) => (snap.tabs[name] ? new Grid(name, snap.tabs[name]) : undefined);
  const randy = grid('Randy');
  const pay = grid('Paylater');
  const restock = grid('Restock/Purchases');
  const credit = grid('Credit Matrix');
  const non = grid('Non-Credit');
  const planner = grid('🌟 CC/Savings Planner');
  const move = grid('Move Sav /COG Estimate');
  const missing: string[] = [];
  const need = <T,>(label: string, v: T | null): T | null => {
    if (!v) missing.push(label);
    return v;
  };

  const accounts = need('Debit Accounts', block(randy, 'accounts', 'Debit Accounts'));
  const cards = need('Credit Cards', block(randy, 'cards', 'Credit Cards', { header: ['Card', 'Balance', 'Available', '% available'] }));
  const outstanding = need('Outstanding', block(randy, 'outstanding', 'Outstanding', { header: ['Owed', 'Amount', 'Note'] }));
  const balancing = need('Balancing and Planning', block(randy, 'balancing', 'Balancing and Planning'));
  const findRow = (t: Table | null, name: RegExp) => t?.rows.find(r => name.test(r[0].text));
  const cashRow = findRow(balancing, /^cash on hand/i);
  const balancedRow = findRow(balancing, /^balanced cash/i);

  const bills = need('Bills', block(randy, 'bills', 'Bills', { nameCol: 1 }));
  const cardMins = need('Card Mins/Paylater', block(randy, 'cardMins', /^card mins/i, { nameCol: 1 }));
  const subs = need('Subscriptions', block(randy, 'subs', 'Subscriptions', { nameCol: 1 }));

  // Trial / Paused subscriptions sit right under the monthly total.
  const subsOther: Cell[][] = [];
  if (randy && subs?.total) {
    const { r, c } = subs.total[0];
    for (let rr = r + 1; rr < Math.min(randy.rows, r + 12); rr++) {
      const row = [randy.cell(rr, c), randy.cell(rr, c + 1), randy.cell(rr, c + 2)];
      if (!row[0].text && !row[1].text) break;
      if (row[1].text) subsOther.push(row);
    }
  }

  // Pay-later week buckets under the card minimums ("Bucket | Dates | Total" isn't merged).
  const bucketAt = randy?.find('Bucket');
  const bucketTable = bucketAt ? block(randy, 'buckets', 'Bucket', { cols: [bucketAt.c, bucketAt.c + 2], header: ['Week', 'Dates', 'Pay later'] }) : null;
  const monthTotalAt = randy?.find(/^\w+ total$/i);
  const monthTotal =
    randy && monthTotalAt
      ? { label: randy.text(monthTotalAt.r, monthTotalAt.c), cell: randy.cell(monthTotalAt.r, monthTotalAt.c + 2) }
      : undefined;

  const spendAt = randy?.find('Upcoming Spend');
  const upcomingSpend: MoneyModel['upcomingSpend'] = { rows: [], items: [] };
  if (randy && spendAt) {
    let r = spendAt.r + 1;
    for (; r < randy.rows; r++) {
      const label = randy.cell(r, spendAt.c);
      if (!label.text) break;
      if (/current needed items/i.test(label.text)) {
        for (let rr = r + 1; rr < randy.rows && randy.text(rr, spendAt.c); rr++) upcomingSpend.items.push(randy.cell(rr, spendAt.c));
        break;
      }
      upcomingSpend.rows.push([label, randy.cell(r, spendAt.c + 1)]);
    }
  } else missing.push('Upcoming Spend');

  const ledger = need('Full Ledger', block(pay, 'ledger', 'Full Ledger', { maxRows: 400 }));
  const paylaterSums = block(pay, 'paylaterSums', 'Sum', { header: ['Provider', 'Owed', '', 'Available'] });

  const restockNeeded = block(restock, 'needed', 'Needed Purchases', { nameCol: 1 });
  const wants = block(restock, 'wants', 'Wants', { nameCol: 1, gaps: 0 });
  const recurring = need('Needed Re-Occurring/Restock', block(restock, 'recurring', /^needed re-?occurring/i, { nameCol: 1 }));

  const scores: MoneyModel['scores'] = [];
  const scoreAt = credit?.find(/^current scores/i);
  if (credit && scoreAt) {
    for (const r of [scoreAt.r + 1, scoreAt.r + 2]) {
      for (let c = scoreAt.c; c < scoreAt.c + 6; c += 2) {
        const label = credit.text(r, c);
        const value = credit.text(r, c + 1);
        if (label && value) scores.push({ label, value });
      }
    }
  }
  const creditAccounts = block(credit, 'creditAccounts', /^current accounts\s*$/i);
  const creditCards = block(credit, 'creditCards', /^current accounts\s*-\s*credit cards/i);
  const collAt = credit?.find(/^collections/i);
  const collections = collAt ? block(credit, 'collections', /^collections/i, { groupCol: collAt.c - 1 }) : null;
  // Payoff plans (month-by-month tables): Toyota, Fortiva, Ableton.
  const plans: Table[] = [];
  const plan = (g: Grid | undefined, key: string, title: RegExp, label: (at: { r: number; c: number }) => string) => {
    const at = g?.find(title, 0, true);
    if (!g || !at) return;
    const t = block(g, key, title, { merged: true, cols: [Math.max(0, at.c - (key === 'toyota' ? 1 : 0)), at.c + (key === 'toyota' ? 3 : 4)], nameCol: -1 });
    if (t && t.rows.length) plans.push({ ...t, title: label(at) });
  };
  const owedLabel = (t: string) => (amountOf(t) !== undefined ? ` · $${amountOf(t)!.toLocaleString()} total` : '');
  plan(credit, 'toyota', /^toyota$/i, () => 'Toyota');
  plan(credit, 'fortiva', /^fortiva$/i, at => `Fortiva${owedLabel(credit!.text(at.r, at.c + 4))}`);
  plan(non, 'ableton', /^ab[el]{2}ton$/i, at => `Ableton${owedLabel(non!.text(at.r, at.c + 3))}`);
  const utilEst = block(credit, 'utilEst', /^cc util est/i, { gaps: 1 });

  const nonCredit: Table[] = [];
  const liabAt = non?.find(/^non car liabilities/i);
  if (non && liabAt) {
    const t = block(non, 'liabilities', /^non car liabilities/i, { cols: [liabAt.c, liabAt.c + 3], stopAfterTotal: false, gaps: 1, maxRows: 12, groupCol: liabAt.c - 1 });
    if (t) {
      // Stop before the Ableton plan if it sits below.
      const cut = t.groups ? t.groups.findIndex(g => /ab[el]{2}ton|payment/i.test(g)) : -1;
      if (cut >= 0) {
        t.rows = t.rows.slice(0, cut);
        t.groups = t.groups!.slice(0, cut);
      }
      nonCredit.push({ ...t, title: 'Non-car liabilities' });
    }
  } else missing.push('Non Car Liabilities');
  nonCredit.push(...stacked(non, 'car', 'Car and Regulatory', [7, 10], /^(repair|due|date)$/i, 11));

  // CC/Savings Planner: the payoff priority row (names, priority, planned, projected owed).
  let payoff: Table | null = null;
  if (planner) {
    const pr = planner.find('Priority');
    const owed = planner.find(/^projected owed$/i);
    if (pr) {
      const rows: Cell[][] = [];
      const groups: string[] = [];
      for (let c = pr.c + 1; c < pr.c + 40; c++) {
        const name = planner.cell(pr.r - 1, c);
        if (!name.text) continue;
        rows.push([name, planner.cell(pr.r, c), planner.cell(pr.r + 1, c), owed ? planner.cell(owed.r, c) : planner.cell(pr.r + 1, c)]);
        groups.push(planner.mergedText(pr.r - 2, c));
      }
      payoff = { key: 'payoff', title: 'Payoff priorities', tab: planner.tab, header: ['Debt', 'Priority', 'Set aside', 'Projected owed'], rows, groups };
    }
  }
  const savAt = planner?.find('Savings Balances');
  const savingsTable = savAt ? block(planner, 'savings', 'Savings Balances', { cols: [savAt.c + 1, savAt.c + 4], header: 'same', stopAfterTotal: true }) : null;

  const moveTables: Table[] = [];
  if (move) {
    for (const [key, title] of [
      ['housing', 'Housing'],
      ['moving', 'Moving Cost'],
      ['buffer', 'Buffer Amount'],
    ] as const) {
      const t = block(move, key, title, { header: ['Item', 'Amount'], stopAfterTotal: false });
      if (t) moveTables.push({ ...t, title });
    }
    const col = block(move, 'cogs', 'COGS Estimate', { cols: [7, 9], header: ['', 'Cost', 'Amount'], nameCol: 1, groupCol: 7, stopAfterTotal: false, gaps: 1, maxRows: 32 });
    if (col) moveTables.push({ ...col, title: 'Cost of living (monthly)' });
  }

  const items = [
    ...itemsFrom(bills, 'bill', { date: 0, name: 1, amount: 2 }, today),
    ...itemsFrom(cardMins, 'card', { date: 0, name: 1, amount: 2 }, today),
    ...itemsFrom(subs, 'sub', { date: 0, name: 1, amount: 2 }, today),
    ...itemsFrom(ledger, 'paylater', { date: 0, name: 1, amount: 3, provider: 4, installment: 2 }, today),
  ];
  for (const row of subsOther) {
    items.push({
      id: `money:sub:${slug(row[1].text)}:${slug(row[0].text)}`,
      kind: 'sub',
      name: row[1].text,
      amount: amountOf(row[2].text),
      dateText: '',
      status: row[0].text,
      skipped: row[1].struck,
      cells: { name: row[1], amount: row[2] },
    });
  }

  return {
    refreshedAt: snap.refreshedAt,
    sheetUrl: snap.sheetUrl,
    gids: Object.fromEntries(Object.entries(snap.tabs).map(([k, t]) => [k, t.gid])),
    asOf: randy?.text(1, 1) || undefined,
    accounts,
    cards,
    outstanding,
    balancing,
    cashOnHand: cashRow?.[1],
    balancedCash: balancedRow?.[1],
    bills,
    cardMins,
    subs,
    subsOther,
    buckets: bucketTable,
    monthTotal,
    upcomingSpend,
    ledger,
    paylaterSums,
    restockNeeded,
    wants,
    recurring,
    scores,
    creditAccounts,
    creditCards,
    collections,
    plans,
    utilEst,
    nonCredit,
    payoff,
    savings: savingsTable,
    move: moveTables,
    items,
    missing,
  };
}

// ---------------------------------------------------------------------------
// Dues: money items as dated entries for the calendar and lists
// ---------------------------------------------------------------------------

export type MoneyDue = {
  item: MoneyItem;
  /** YYYY-MM-DD */
  due: string;
  /** Days from today (negative = already past; never shown as "overdue") */
  days: number;
  /** Ledger task id for "paid" on Life Hub */
  key: string;
};

/** Money item ids marked paid on Life Hub (real Finance completions, so they sync). */
export function paidMoneyKeys(entries: Array<{ source: string; taskId: string }>): Set<string> {
  const out = new Set<string>();
  for (const e of entries) if (e.source === 'radall' && e.taskId.startsWith('money:')) out.add(e.taskId);
  return out;
}

/**
 * Dated money items from `back` days ago to `ahead` days out — not skipped, not paid on Life Hub.
 * Past ones stay on the calendar quietly; nothing here is ever "overdue".
 */
export function moneyDues(model: MoneyModel | null, paid: Set<string>, today = new Date(), back = 45, ahead = 120): MoneyDue[] {
  if (!model) return [];
  const t = startOfDay(today);
  const from = addDays(t, -back);
  const to = addDays(t, ahead);
  return model.items
    .filter(i => i.date && !i.skipped && !i.status && !paid.has(i.id))
    .filter(i => {
      const d = fromDayKey(i.date!);
      return d >= from && d <= to;
    })
    .map(i => ({ item: i, due: i.date!, days: daysBetween(t, fromDayKey(i.date!)), key: i.id }))
    .sort((a, b) => a.due.localeCompare(b.due) || a.item.kind.localeCompare(b.item.kind));
}

/** Money dues in the calendar's bill shape (Paid, countdown and the calendar all reuse it). */
export function moneyBillDues(model: MoneyModel | null, paid: Set<string>, today = new Date()): BillDue[] {
  return moneyDues(model, paid, today).map(d => ({
    bill: {
      id: d.item.id,
      name: d.item.name,
      amount: d.item.amount,
      kind: d.item.kind,
      notes: [MONEY_KINDS[d.item.kind].label, d.item.provider, d.item.installment].filter(Boolean).join(' · '),
    },
    due: d.due,
    days: d.days,
    key: d.key,
  }));
}

export function sumAmounts(dues: Array<{ item: { amount?: number } }>): number {
  return dues.reduce((s, d) => s + (d.item.amount || 0), 0);
}

/** Link to a tab (and cell) in the sheet. */
export function sheetLink(model: MoneyModel | null, tab: string, cell?: { r: number; c: number }): string | undefined {
  if (!model?.sheetUrl) return undefined;
  const gid = model.gids[tab];
  const a1 = cell ? `&range=${colName(cell.c)}${cell.r + 1}` : '';
  return `${model.sheetUrl}${gid !== undefined ? `#gid=${gid}${a1}` : ''}`;
}

export function colName(c: number): string {
  let n = c + 1;
  let s = '';
  while (n) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
