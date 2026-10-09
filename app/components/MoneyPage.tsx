'use client';

import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { PayPlanner } from './PayPlanner';
import {
  amountOf,
  cardSummaries,
  debtOptions,
  MONEY_KINDS,
  parseSheetDate,
  sheetLink,
  type Cell,
  type CellEdit,
  type EditResult,
  type MoneyModel,
  type Table,
} from '../../lib/money';
import { dayKey, dayName, fromDayKey, money, startOfDay, startOfWeek, type BillDue } from '../../lib/schedule';
import { usePayPlans } from '../../lib/payPlans';
import { readSaved, writeSaved, STORAGE_KEYS } from '../../lib/storage';
import { isOverdue } from '../../lib/billEdits';
import { BillChangeForm, BillPinButton, billChangeText } from './BillControls';
import { addLifeSub, updateLifeSub, type LifeSub } from '../../lib/lifeSubs';

type Save = (edits: CellEdit[]) => Promise<{ ok: boolean; results: EditResult[]; error?: string }>;

const ERRORS: Record<string, string> = {
  changed: 'That cell changed in the sheet since Life Hub last read it — showing the latest now. Try again if it still needs changing.',
  formula: 'That cell is a formula in the sheet, so Life Hub leaves it alone.',
  busy: 'Google was in the middle of a sync — try again in a few seconds.',
  wrong_key: 'This browser isn’t linked to the backup yet, so it can’t save to the sheet.',
  not_configured: 'Saving to the sheet isn’t set up on the Worker yet.',
};

// ---------------------------------------------------------------------------
// Editable cell: click → input → Enter saves to the sheet (Esc cancels). Formulas are read-only.
// ---------------------------------------------------------------------------

function EditCell({ cell, onSave, className = '', placeholder = '—' }: { cell?: Cell; onSave: Save; className?: string; placeholder?: string }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);
  if (!cell) return <span className={`mcell is-empty ${className}`} />;
  const label = cell.text || placeholder;
  if (cell.formula) {
    return (
      <span className={`mcell is-formula${cell.struck ? ' is-struck' : ''} ${className}`} title="Worked out by a formula in the sheet">
        {label}
      </span>
    );
  }
  if (editing) {
    const commit = async () => {
      const next = value.trim();
      if (next === cell.text) return setEditing(false);
      setBusy(true);
      await onSave([{ tab: cell.tab, r: cell.r, c: cell.c, expect: cell.text, value: next }]);
      setBusy(false);
      setEditing(false);
    };
    return (
      <input
        ref={input}
        className={`mcell-input ${className}`}
        value={value}
        disabled={busy}
        aria-label={`Edit ${cell.text || 'cell'}`}
        onChange={e => setValue(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={e => {
          if (e.key === 'Enter') void commit();
          if (e.key === 'Escape') setEditing(false);
        }}
      />
    );
  }
  return (
    <button
      type="button"
      className={`mcell is-edit${cell.text ? '' : ' is-blank'}${cell.struck ? ' is-struck' : ''} ${className}`}
      onClick={() => {
        setValue(cell.text);
        setEditing(true);
      }}
      title="Click to change it in the sheet"
    >
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// A sheet block as a table
// ---------------------------------------------------------------------------

type TableOpts = {
  /** Trailing button that crosses the row out in the sheet (Skip / Unskip) */
  strike?: { on: string; off: string };
  /** Leading checkbox that crosses the row out (e.g. "Bought") */
  check?: string;
  /** Extra trailing buttons per row (e.g. "→ Wants") */
  actions?: (row: Cell[]) => ReactNode;
  /** A column shown as a dropdown that writes the chosen value */
  select?: { col: number; options: string[] };
  limit?: number;
  rowClass?: (row: Cell[]) => string;
  /** Columns to leave out (indexes) */
  hide?: number[];
  numeric?: number[];
};

const strikeEdit = (row: Cell[], strike: boolean): CellEdit => ({
  tab: row[0].tab,
  r: row[0].r,
  c1: row[0].c,
  c2: row[row.length - 1].c,
  expect: row[0].text,
  strike,
});

/** Dropdown for a cell (Needed? = Yes / Y Low / No / Ordered); keeps any value already there. */
function SelectCell({ cell, options, onSave }: { cell: Cell; options: string[]; onSave: Save }) {
  const [busy, setBusy] = useState(false);
  const opts = options.includes(cell.text) || !cell.text ? options : [cell.text, ...options];
  return (
    <select
      className={`mselect is-${(cell.text || 'none').toLowerCase().replace(/\s+/g, '-')}`}
      value={cell.text}
      disabled={busy || cell.formula}
      aria-label="Needed?"
      onChange={async e => {
        setBusy(true);
        await onSave([{ tab: cell.tab, r: cell.r, c: cell.c, expect: cell.text, value: e.target.value }]);
        setBusy(false);
      }}
    >
      {!cell.text ? <option value="">—</option> : null}
      {opts.map(o => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

function SheetTable({ table, onSave, opts = {} }: { table: Table; onSave: Save; opts?: TableOpts }) {
  const width = table.header.length;
  const cols = Array.from({ length: width }, (_, i) => i).filter(
    // Columns empty in every row are left out (the header alone doesn't keep one).
    i => !opts.hide?.includes(i) && (!table.rows.length ? Boolean(table.header[i]) : table.rows.some(r => r[i]?.text) || Boolean(table.total?.[i]?.text)),
  );
  const rows = opts.limit ? table.rows.slice(0, opts.limit) : table.rows;
  const numeric = new Set(
    opts.numeric ?? cols.filter(i => table.rows.filter(r => r[i]?.text).every(r => amountOf(r[i].text) !== undefined || /%$/.test(r[i].text))),
  );
  const trailing = Boolean(opts.strike || opts.actions);
  const span = cols.length + (trailing ? 1 : 0) + (opts.check ? 1 : 0);
  return (
    <div className="mtable-wrap">
      <table className="mtable">
        <thead>
          <tr>
            {opts.check ? <th className="mtable-check">{opts.check}</th> : null}
            {cols.map(i => (
              <th key={i} className={numeric.has(i) ? 'is-num' : ''}>
                {table.header[i]}
              </th>
            ))}
            {trailing ? <th aria-label="Actions" /> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => {
            const group = table.groups?.[ri] || '';
            const showGroup = group && group !== (table.groups?.[ri - 1] || '');
            const struck = row.some(c => c.struck);
            const name = row.find(c => c.text && amountOf(c.text) === undefined)?.text || 'this row';
            return (
              <Fragment key={`${row[0].r}`}>
                {showGroup ? (
                  <tr className="mtable-group">
                    <td colSpan={span}>{group}</td>
                  </tr>
                ) : null}
                <tr className={`${struck ? 'is-struck' : ''} ${opts.rowClass?.(row) || ''}`}>
                  {opts.check ? (
                    <td className="mtable-check">
                      <input
                        type="checkbox"
                        checked={struck}
                        onChange={() => void onSave([strikeEdit(row, !struck)])}
                        aria-label={`${opts.check}: ${name}`}
                        title={struck ? 'Un-cross it in the sheet' : `${opts.check} — crosses it out in the sheet`}
                      />
                    </td>
                  ) : null}
                  {cols.map(i => (
                    <td key={i} className={numeric.has(i) ? 'is-num' : ''}>
                      {opts.select?.col === i && row[i] ? (
                        <SelectCell cell={row[i]} options={opts.select.options} onSave={onSave} />
                      ) : (
                        <EditCell cell={row[i]} onSave={onSave} placeholder="" />
                      )}
                    </td>
                  ))}
                  {trailing ? (
                    <td className="mtable-act">
                      {opts.actions?.(row)}
                      {opts.strike ? (
                        <button
                          type="button"
                          className="row-action ghost"
                          onClick={() => void onSave([strikeEdit(row, !struck)])}
                          title={struck ? 'Un-cross it in the sheet' : 'Cross it out in the sheet'}
                        >
                          {struck ? opts.strike.off : opts.strike.on}
                        </button>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              </Fragment>
            );
          })}
          {opts.limit && table.rows.length > opts.limit ? (
            <tr className="mtable-more">
              <td colSpan={span}>+{table.rows.length - opts.limit} more in the sheet</td>
            </tr>
          ) : null}
        </tbody>
        {table.total && table.total.some(c => c.text) ? (
          <tfoot>
            <tr>
              {opts.check ? <td /> : null}
              {cols.map(i => (
                <td key={i} className={numeric.has(i) ? 'is-num' : ''}>
                  <EditCell cell={table.total![i]} onSave={onSave} placeholder="" />
                </td>
              ))}
              {trailing ? <td /> : null}
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Layout pieces, three levels: Section (a card with a colored header) → Fold (a row that opens)
// → the table or list inside it. Every Section belongs to one money "tone" (cash, due, owed,
// plan, shop, save), and the color means the same thing everywhere on the page.
// ---------------------------------------------------------------------------

type Tone = 'cash' | 'due' | 'owed' | 'plan' | 'shop' | 'save' | 'card' | 'sub';

function Section({
  tone,
  title,
  figure,
  figureLabel,
  hint,
  href,
  className = '',
  children,
}: {
  tone: Tone;
  title: string;
  /** The one number this section is about */
  figure?: ReactNode;
  figureLabel?: string;
  hint?: string;
  href?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`mny-sec tone-${tone} ${className}`}>
      <header className="mny-sec-head">
        <div className="mny-sec-titles">
          <h2>{title}</h2>
          {hint ? <p>{hint}</p> : null}
        </div>
        {figure !== undefined ? (
          <div className="mny-sec-figure">
            <b>{figure}</b>
            {figureLabel ? <span>{figureLabel}</span> : null}
          </div>
        ) : null}
        {href ? (
          <a className="mny-sec-link" href={href} target="_blank" rel="noopener noreferrer" title="Open this part of the sheet">
            Sheet ↗
          </a>
        ) : null}
      </header>
      <div className="mny-sec-body">{children}</div>
    </section>
  );
}

function Fold({
  title,
  meta,
  total,
  open = false,
  children,
}: {
  title: string;
  meta?: ReactNode;
  total?: ReactNode;
  open?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="mny-fold" open={open}>
      <summary>
        <span className="mny-fold-chev" aria-hidden="true" />
        <span className="mny-fold-title">{title}</span>
        {meta ? <span className="mny-fold-meta">{meta}</span> : null}
        {total ? <span className="mny-fold-total">{total}</span> : null}
      </summary>
      <div className="mny-fold-body">{children}</div>
    </details>
  );
}

// ---------------------------------------------------------------------------
// Due list: dated money items grouped by day (this week) or by week (the next five)
// ---------------------------------------------------------------------------

/** One payment: kind · name · amount · Paid · Pin · Change (skip / move / amount, logged on Life Hub). */
function DueRow({ d, onPaid, showDay }: { d: BillDue; onPaid: (d: BillDue) => void; showDay: boolean }) {
  const [changing, setChanging] = useState(false);
  const kind = d.bill.kind;
  const [, provider, installment] = (d.bill.notes || '').split(' · ');
  const changed = billChangeText(d);
  return (
    <>
      <li className={d.skipped ? 'is-skipped' : d.days < 0 ? 'is-overdue' : ''} style={{ '--ev': kind ? MONEY_KINDS[kind].color : '#a8632a' } as React.CSSProperties}>
        {showDay ? <span className="mny-due-day">{fromDayKey(d.due).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}</span> : null}
        <span className="mny-due-kind">{d.skipped ? 'Skipped' : kind === 'paylater' ? provider || 'Pay later' : kind ? MONEY_KINDS[kind].label : 'Bill'}</span>
        <span className="mny-due-name">
          {d.bill.name}
          {installment ? <small> · {installment}</small> : null}
          {changed ? <small className="mny-due-change"> · {changed}</small> : null}
        </span>
        <span className="mny-due-amt">{money(d.bill.amount) || '?'}</span>
        <span className="mny-due-tools">
          {d.skipped ? null : (
            <button type="button" className="mny-btn" onClick={() => onPaid(d)} aria-label={`Mark ${d.bill.name} paid`} title="Mark paid on Life Hub">
              Paid
            </button>
          )}
          {d.skipped ? null : <BillPinButton due={d} className="mny-btn" />}
          <button
            type="button"
            className="mny-btn"
            aria-expanded={changing}
            onClick={() => setChanging(v => !v)}
            aria-label={`Change ${d.bill.name}: skip, move or amount`}
            title="Skip, move or change the amount this time"
          >
            Change
          </button>
        </span>
      </li>
      {changing ? (
        <li className="mny-due-edit">
          <BillChangeForm due={d} onDone={() => setChanging(false)} />
        </li>
      ) : null}
    </>
  );
}

/** Days folded in the 7-day list, remembered on this device (past days drop out). */
function useFoldedDays(): [Set<string>, (day: string) => void] {
  const [folded, setFolded] = useState<string[]>(() => readSaved<string[]>(STORAGE_KEYS.moneyFoldedDays, []));
  const toggle = (day: string) => {
    const today = dayKey(new Date());
    setFolded(cur => {
      const next = (cur.includes(day) ? cur.filter(k => k !== day) : [...cur, day]).filter(k => k >= today);
      writeSaved(STORAGE_KEYS.moneyFoldedDays, next);
      return next;
    });
  };
  return [new Set(folded), toggle];
}

function DueList({ dues, onPaid, by, days }: { dues: BillDue[]; onPaid: (d: BillDue) => void; by: 'day' | 'week'; days: number }) {
  const today = startOfDay(new Date());
  const [folded, toggleFold] = useFoldedDays();
  const upcoming = dues.filter(d => d.days >= 0 && d.days <= days);
  const groups = new Map<string, BillDue[]>();
  for (const d of upcoming) {
    const k = by === 'day' ? d.due : dayKey(startOfWeek(fromDayKey(d.due)));
    groups.set(k, [...(groups.get(k) || []), d]);
  }
  const label = (k: string) => {
    if (by === 'day') return dayName(fromDayKey(k));
    const weeksOut = Math.round((fromDayKey(k).getTime() - startOfWeek(today).getTime()) / (7 * 86_400_000));
    return weeksOut === 0 ? 'This week' : weeksOut === 1 ? 'Next week' : `Week of ${fromDayKey(k).toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
  };
  if (!upcoming.length) return <p className="mny-empty">Nothing due{by === 'day' ? ' in the next 7 days' : ''}. Nice.</p>;
  return (
    <div className="mny-due">
      {[...groups.entries()].map(([k, list], gi) => {
        const owed = list.filter(d => !d.skipped);
        const total = money(owed.reduce((s, d) => s + (d.bill.amount || 0), 0));
        const items = (
          <ul>
            {list.map(d => (
              <DueRow key={d.key} d={d} onPaid={onPaid} showDay={by === 'week'} />
            ))}
          </ul>
        );
        // By week: each week is a fold (this week open). By day: each day folds on its header.
        if (by === 'week') {
          return (
            <Fold key={k} title={label(k)} meta={`${list.length} payments`} total={total} open={gi === 0}>
              {items}
            </Fold>
          );
        }
        const isFolded = folded.has(k);
        return (
          <div key={k} className={`mny-due-group${isFolded ? ' is-folded' : ''}`}>
            <h3>
              <button type="button" className="mny-due-fold" aria-expanded={!isFolded} onClick={() => toggleFold(k)}>
                <span className="mny-fold-chev" aria-hidden="true" />
                <span>{label(k)}</span>
                {isFolded ? <small>{list.length} {list.length === 1 ? 'payment' : 'payments'}</small> : null}
              </button>
              <b>{total}</b>
            </h3>
            {isFolded ? null : items}
          </div>
        );
      })}
    </div>
  );
}

/** Payments past their day and not marked paid (or skipped). */
function OverdueList({ dues, onPaid }: { dues: BillDue[]; onPaid: (d: BillDue) => void }) {
  return (
    <div className="mny-due mny-overdue">
      <div className="mny-due-group">
        <ul>
          {dues.map(d => (
            <DueRow key={d.key} d={d} onPaid={onPaid} showDay />
          ))}
        </ul>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Accounts + cards
// ---------------------------------------------------------------------------

function AccountsList({ model, onSave }: { model: MoneyModel; onSave: Save }) {
  const accts = model.accounts;
  if (!accts) return null;
  return (
    <ul className="mny-accts">
      <li className="mny-accts-head">
        <span>Account</span>
        <span>Checking</span>
        <span>Savings</span>
      </li>
      {accts.rows.map(r => (
        <li key={r[0].r}>
          <span className="mny-accts-name">{r[0].text}</span>
          <EditCell cell={r[1]} onSave={onSave} className="is-num" placeholder="—" />
          <EditCell cell={r[2]} onSave={onSave} className="is-num" placeholder="—" />
        </li>
      ))}
      {accts.total ? (
        <li className="mny-accts-total">
          <span>All accounts</span>
          <EditCell cell={accts.total[1]} onSave={onSave} className="is-num" placeholder="" />
          <EditCell cell={accts.total[2]} onSave={onSave} className="is-num" placeholder="" />
        </li>
      ) : null}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// This month: every payment this month — paid ✓, charged, skipped, still to pay — like the sheet
// ---------------------------------------------------------------------------

/** Kinds that take themselves out (subscriptions, pay later, planned transfers). */
const AUTO_KINDS = new Set(['sub', 'paylater', 'plan']);
const shortDate = (k: string) => fromDayKey(k).toLocaleDateString([], { month: 'short', day: 'numeric' });

type MonthState = 'paid' | 'crossed' | 'charged' | 'skipped' | 'late' | 'today' | 'soon' | 'later';

/** Rows crossed out in the sheet — that's how the sheet marks a payment handled. */
const CROSSED = 'crossed:';

function monthState(d: BillDue, paidAt: Record<string, string>): MonthState {
  if (d.bill.id.startsWith(CROSSED)) return 'crossed';
  if (d.skipped) return 'skipped';
  if (paidAt[d.key]) return 'paid';
  if (d.days < 0) return AUTO_KINDS.has(d.bill.kind || '') ? 'charged' : 'late';
  if (d.days === 0) return 'today';
  return d.days <= 7 ? 'soon' : 'later';
}

const STATE_TEXT: Record<MonthState, (d: BillDue, paidAt: Record<string, string>) => string> = {
  paid: (d, p) => `Paid ${new Date(p[d.key]).toLocaleDateString([], { month: 'short', day: 'numeric' })}`,
  crossed: () => 'Crossed off',
  charged: () => 'Charged',
  skipped: () => 'Skipped',
  late: () => 'Not marked paid',
  today: () => 'Today',
  soon: d => (d.days === 1 ? 'Tomorrow' : `In ${d.days} days`),
  later: d => `In ${d.days} days`,
};

function kindLabel(d: BillDue): string {
  const k = d.bill.kind;
  if (k === 'paylater') return (d.bill.notes || '').split(' · ')[1] || 'Pay later';
  return k ? MONEY_KINDS[k].label : 'Bill';
}

function MonthRow({ d, paidAt, onPaid }: { d: BillDue; paidAt: Record<string, string>; onPaid: (d: BillDue) => void }) {
  const state = monthState(d, paidAt);
  const day = fromDayKey(d.due);
  const done = state === 'paid' || state === 'crossed' || state === 'charged' || state === 'skipped';
  const installment = d.bill.kind === 'paylater' ? (d.bill.notes || '').split(' · ')[2] : '';
  return (
    <li className={`mm-row is-${state}`} style={{ '--ev': d.bill.kind ? MONEY_KINDS[d.bill.kind].color : '#a8632a' } as React.CSSProperties}>
      <span className="mm-day" aria-label={day.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}>
        <b>{day.getDate()}</b>
        <small>{day.toLocaleDateString([], { weekday: 'short' })}</small>
      </span>
      <span className="mm-kind">{kindLabel(d)}</span>
      <span className="mm-name">
        {d.bill.name}
        {installment ? <small> · {installment}</small> : null}
      </span>
      <span className="mm-amt">{money(d.bill.amount) || '?'}</span>
      <span className="mm-state">
        {state === 'paid' || state === 'crossed' || state === 'charged' ? '✓ ' : ''}
        {STATE_TEXT[state](d, paidAt)}
      </span>
      <span className="mm-tools">
        {done || AUTO_KINDS.has(d.bill.kind || '') ? null : (
          <button type="button" className="mny-btn" onClick={() => onPaid(d)} aria-label={`Mark ${d.bill.name} paid`}>
            Paid
          </button>
        )}
      </span>
    </li>
  );
}

function MonthView({
  dues: allDues,
  paidAt,
  model,
  onPaid,
  kinds,
}: {
  dues: BillDue[];
  paidAt: Record<string, string>;
  model: MoneyModel;
  onPaid: (d: BillDue) => void;
  /** Only these kinds (the Bills tab shows just bills) */
  kinds?: string[];
}) {
  const today = startOfDay(new Date());
  const dues = kinds ? allDues.filter(d => kinds.includes(d.bill.kind || 'bill')) : allDues;
  // Rows crossed out in the sheet (skipped this month) show too, so the month adds up like the sheet.
  const struck: BillDue[] = model.items
    .filter(i => (!kinds || kinds.includes(i.kind)) && i.skipped && i.date && fromDayKey(i.date).getMonth() === today.getMonth() && fromDayKey(i.date).getFullYear() === today.getFullYear())
    .map(i => ({ bill: { id: `${CROSSED}${i.id}`, name: i.name, amount: i.amount, kind: i.kind }, due: i.date!, days: Math.round((fromDayKey(i.date!).getTime() - today.getTime()) / 86_400_000), key: i.id }));
  const all = [...dues, ...struck.filter(s => !dues.some(d => d.key === s.key))].sort((a, b) => a.due.localeCompare(b.due) || a.bill.name.localeCompare(b.bill.name));
  const counted = all.filter(d => !d.skipped);
  const total = counted.reduce((s, d) => s + (d.bill.amount || 0), 0);
  const doneList = counted.filter(d => ['paid', 'crossed', 'charged'].includes(monthState(d, paidAt)));
  const done = doneList.reduce((s, d) => s + (d.bill.amount || 0), 0);
  const late = counted.filter(d => monthState(d, paidAt) === 'late');
  const left = total - done;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const byKind = (['bill', 'card', 'sub', 'paylater', 'plan'] as const)
    .map(k => ({ k, sum: counted.filter(d => d.bill.kind === k).reduce((s, d) => s + (d.bill.amount || 0), 0) }))
    .filter(x => x.sum > 0);
  // Weeks of the month: 1–7, 8–14, 15–21, 22–28, 29–end.
  const weeks = new Map<number, BillDue[]>();
  for (const d of all) {
    const w = Math.floor((fromDayKey(d.due).getDate() - 1) / 7);
    weeks.set(w, [...(weeks.get(w) || []), d]);
  }
  const monthName = today.toLocaleDateString([], { month: 'long' });
  const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const thisWeek = Math.floor((today.getDate() - 1) / 7);
  if (!all.length) return <p className="mny-empty">Nothing in {monthName} yet.</p>;
  return (
    <div className="mm">
      <div className="mm-top">
        <div className="mm-progress">
          <div className="mm-progress-figs">
            <span>
              <b>{money(done)}</b> paid
            </span>
            <span>
              <b>{money(left)}</b> left of {money(total)}
            </span>
          </div>
          <div className="mm-bar" role="img" aria-label={`${pct}% of ${monthName}'s payments done`}>
            {byKind.map(x => (
              <i key={x.k} style={{ width: `${(x.sum / (total || 1)) * 100}%`, background: MONEY_KINDS[x.k].color }} />
            ))}
            <em style={{ width: `${pct}%` }} />
          </div>
          <div className="mm-legend">
            {byKind.map(x => (
              <span key={x.k}>
                <i style={{ background: MONEY_KINDS[x.k].color }} />
                {MONEY_KINDS[x.k].plural} {money(x.sum)}
              </span>
            ))}
          </div>
        </div>
        <div className="mm-counts">
          <span className="is-paid">
            <b>{doneList.length}</b> done
          </span>
          <span>
            <b>{counted.length - doneList.length - late.length}</b> to go
          </span>
          {late.length ? (
            <span className="is-late">
              <b>{late.length}</b> not marked
            </span>
          ) : null}
        </div>
      </div>
      {[...weeks.entries()].map(([w, list]) => {
        const from = w * 7 + 1;
        const to = Math.min(from + 6, lastDay);
        const sum = list.filter(d => !d.skipped).reduce((s, d) => s + (d.bill.amount || 0), 0);
        const allDone = list.every(d => ['paid', 'crossed', 'charged', 'skipped'].includes(monthState(d, paidAt)));
        return (
          <details key={w} className={`mm-week${w === thisWeek ? ' is-now' : ''}${allDone ? ' is-done' : ''}`} open={!allDone || w === thisWeek}>
            <summary>
              <span className="mny-fold-chev" aria-hidden="true" />
              <span className="mm-week-name">
                {today.toLocaleDateString([], { month: 'short' })} {from}–{to}
              </span>
              {w === thisWeek ? <span className="mm-now">This week</span> : allDone ? <span className="mm-donechip">✓ All done</span> : null}
              <span className="mm-week-sum">{money(sum)}</span>
            </summary>
            <ul>
              {list.map(d => (
                <MonthRow key={d.key} d={d} paidAt={paidAt} onPaid={onPaid} />
              ))}
            </ul>
          </details>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Credit cards: one tile per card — balance, how much of the limit is used, this month's minimum
// ---------------------------------------------------------------------------

function nextMonth(key: string): string {
  const d = fromDayKey(key);
  const n = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  return dayKey(new Date(n.getFullYear(), n.getMonth(), Math.min(d.getDate(), new Date(n.getFullYear(), n.getMonth() + 1, 0).getDate())));
}

function CardTiles({ model, dues, paidAt, onPaid, onSave }: { model: MoneyModel; dues: BillDue[]; paidAt: Record<string, string>; onPaid: (d: BillDue) => void; onSave: Save }) {
  const cards = cardSummaries(model);
  const [open, setOpen] = useState<string | null>(null);
  const today = startOfDay(new Date());
  return (
    <ul className="cc-grid">
      {cards.map(c => {
        const bal = amountOf(c.balance?.text || '') || 0;
        const avail = amountOf(c.available?.text || '');
        const limit = amountOf(c.limit?.text || '') ?? (avail !== undefined ? bal + avail : undefined);
        const used = limit ? Math.min(100, Math.round((bal / limit) * 100)) : undefined;
        const level = used === undefined ? '' : used <= 10 ? 'is-great' : used <= 30 ? 'is-ok' : 'is-high';
        // This month's minimum, as a payment occurrence (so Paid here is the same Paid everywhere).
        const item = c.min ? model.items.find(i => i.kind === 'card' && i.cells.amount && i.cells.amount.r === c.min!.r && i.cells.amount.c === c.min!.c) : undefined;
        const due = item ? dues.find(d => d.key === item.id) : undefined;
        const paid = item ? paidAt[item.id] : undefined;
        const minAmt = item?.amount;
        let status: { text: string; tone: string; sub?: string };
        if (!item || !minAmt) status = { text: bal > 0 ? 'No minimum listed' : 'Nothing owed', tone: 'is-quiet' };
        else if (paid)
          status = {
            text: `✓ Paid ${new Date(paid).toLocaleDateString([], { month: 'short', day: 'numeric' })}`,
            tone: 'is-paid',
            sub: item.date ? `Next about ${shortDate(nextMonth(item.date))}` : undefined,
          };
        else if (item.skipped)
          status = { text: '✓ Crossed off', tone: 'is-paid', sub: item.date ? `Next about ${shortDate(nextMonth(item.date))}` : undefined };
        else if (item.date) {
          const days = Math.round((fromDayKey(item.date).getTime() - today.getTime()) / 86_400_000);
          status =
            days < 0
              ? { text: `Was due ${shortDate(item.date)}`, tone: 'is-late', sub: 'Not marked paid' }
              : { text: days === 0 ? 'Due today' : days === 1 ? 'Due tomorrow' : `Due ${shortDate(item.date)}`, tone: days <= 3 ? 'is-soon' : '', sub: days > 1 ? `in ${days} days` : undefined };
        } else status = { text: 'Minimum due', tone: '' };
        const isOpen = open === c.name;
        return (
          <li key={c.name} className={`cc-tile ${level}`}>
            <div className="cc-head">
              <strong>{c.name}</strong>
              {used !== undefined ? <span className="cc-used">{used}% used</span> : null}
            </div>
            <div className="cc-bal">
              <b>{c.balance?.text || '$0'}</b>
              <span>{limit ? `of ${money(limit)}` : c.available?.text ? `${c.available.text} free` : ''}</span>
            </div>
            <div className="cc-bar" aria-hidden="true">
              <i style={{ width: `${used ?? 0}%` }} />
              <em />
            </div>
            <div className={`cc-min ${status.tone}`}>
              <span className="cc-min-amt">{minAmt ? `${money(minAmt)} min` : ''}</span>
              <span className="cc-min-status">
                {status.text}
                {status.sub ? <small>{status.sub}</small> : null}
              </span>
            </div>
            <div className="cc-tools">
              {due && !paid && !due.skipped ? (
                <>
                  <button type="button" className="mny-btn is-primary" onClick={() => onPaid(due)}>
                    Paid
                  </button>
                  <BillPinButton due={due} className="mny-btn" />
                </>
              ) : null}
              <button type="button" className="mny-btn" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : c.name)}>
                {isOpen ? 'Close' : 'Edit'}
              </button>
            </div>
            {isOpen ? (
              <div className="mny-card-detail">
                <label>
                  <span>Balance</span>
                  <EditCell cell={c.balance} onSave={onSave} />
                </label>
                <label>
                  <span>Available</span>
                  <EditCell cell={c.available} onSave={onSave} />
                </label>
                {c.min ? (
                  <label>
                    <span>Minimum</span>
                    <EditCell cell={c.min} onSave={onSave} />
                  </label>
                ) : null}
                {c.minDate ? (
                  <label>
                    <span>Min due</span>
                    <EditCell cell={c.minDate} onSave={onSave} />
                  </label>
                ) : null}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Subscriptions: everything that charges you on its own — the sheet's list plus ones added here
// ---------------------------------------------------------------------------

type SubRow = {
  key: string;
  name: string;
  amount?: number;
  /** Day of the month it charges */
  day?: number;
  date?: string;
  status: 'active' | 'trial' | 'paused' | 'skipped' | 'cancelled';
  from: 'sheet' | 'hub';
  row?: Cell[];
  sub?: LifeSub;
};

function SubAdd({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [day, setDay] = useState(String(new Date().getDate()));
  const [status, setStatus] = useState<'active' | 'trial'>('active');
  const [cycle, setCycle] = useState<'monthly' | 'yearly'>('monthly');
  const [month, setMonth] = useState(new Date().getMonth());
  const [note, setNote] = useState('');
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const d = Number(day);
    if (!name.trim() || !(d >= 1 && d <= 31)) return;
    const amt = amountOf(amount);
    addLifeSub({ name, amount: amt, day: d, cycle, month: cycle === 'yearly' ? month : undefined, status, note: note.trim() || undefined });
    onDone();
  };
  return (
    <form className="sub-form" onSubmit={submit} onKeyDown={e => e.key === 'Escape' && onDone()}>
      <label className="sub-form-wide">
        <span>Subscription</span>
        <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Netflix" required />
      </label>
      <label>
        <span>Amount</span>
        <input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="$9.99" />
      </label>
      <label>
        <span>Charges on day</span>
        <input type="number" min={1} max={31} value={day} onChange={e => setDay(e.target.value)} required />
      </label>
      <label>
        <span>Every</span>
        <select value={cycle} onChange={e => setCycle(e.target.value as 'monthly' | 'yearly')}>
          <option value="monthly">Month</option>
          <option value="yearly">Year</option>
        </select>
      </label>
      {cycle === 'yearly' ? (
        <label>
          <span>In</span>
          <select value={month} onChange={e => setMonth(Number(e.target.value))}>
            {Array.from({ length: 12 }, (_, i) => (
              <option key={i} value={i}>
                {new Date(2026, i, 1).toLocaleDateString([], { month: 'long' })}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label>
        <span>Status</span>
        <select value={status} onChange={e => setStatus(e.target.value as 'active' | 'trial')}>
          <option value="active">Active</option>
          <option value="trial">Free trial</option>
        </select>
      </label>
      <label className="sub-form-wide">
        <span>Note</span>
        <input value={note} onChange={e => setNote(e.target.value)} placeholder="Optional — e.g. cancel before the trial ends" />
      </label>
      <div className="sub-form-actions">
        <button type="submit" className="mny-btn is-primary">
          Add subscription
        </button>
        <button type="button" className="mny-btn" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function SubsView({ model, lifeSubs, paidAt, dues, onSave }: { model: MoneyModel; lifeSubs: LifeSub[]; paidAt: Record<string, string>; dues: BillDue[]; onSave: Save }) {
  const [adding, setAdding] = useState(false);
  const today = startOfDay(new Date());
  const sheetRows: SubRow[] = (model.subs?.rows || [])
    .filter(r => r[1]?.text)
    .map(r => {
      const date = parseSheetDate(r[0]?.text || '', today);
      return {
        key: `sheet:${r[1].r}`,
        name: r[1].text.trim(),
        amount: amountOf(r[2]?.text || ''),
        date,
        day: date ? fromDayKey(date).getDate() : undefined,
        status: r.some(c => c.struck) ? 'skipped' : 'active',
        from: 'sheet' as const,
        row: r,
      };
    });
  const otherRows: SubRow[] = model.subsOther.map(r => ({
    key: `other:${r[1].r}`,
    name: r[1].text.trim(),
    amount: amountOf(r[2]?.text || ''),
    status: /trial/i.test(r[0].text) ? 'trial' : 'paused',
    from: 'sheet' as const,
  }));
  const hubRows: SubRow[] = lifeSubs.map(s => {
    const due = dues.find(d => d.key.startsWith(`money:lhsub:${s.id}:`) && fromDayKey(d.due).getMonth() === today.getMonth());
    return { key: `hub:${s.id}`, name: s.name, amount: s.amount, day: s.day, date: due?.due, status: s.status, from: 'hub' as const, sub: s };
  });
  const all = [...sheetRows, ...hubRows, ...otherRows];
  // Crossed off in the sheet = handled this month; it still costs you every month.
  const live = (r: SubRow) => r.status === 'active' || r.status === 'skipped';
  const charging = all.filter(r => live(r) || r.status === 'trial');
  const monthly = all
    .filter(r => live(r) && (r.from === 'sheet' || r.sub?.cycle !== 'yearly'))
    .reduce((s, r) => s + (r.amount || 0), 0);
  const yearlyOnly = lifeSubs.filter(s => s.status === 'active' && s.cycle === 'yearly').reduce((s, x) => s + (x.amount || 0), 0);
  const chargedSoFar = all.filter(r => live(r) && r.date && fromDayKey(r.date) <= today).reduce((s, r) => s + (r.amount || 0), 0);
  const order = (r: SubRow) => (live(r) ? 0 : r.status === 'trial' ? 1 : 2);
  const sorted = [...all].sort((a, b) => order(a) - order(b) || (a.day ?? 99) - (b.day ?? 99) || a.name.localeCompare(b.name));
  const stateOf = (r: SubRow) => {
    if (r.status === 'paused') return { text: 'Paused', tone: 'is-quiet' };
    if (r.status === 'cancelled') return { text: 'Cancelled', tone: 'is-quiet' };
    if (r.status === 'skipped') return { text: '✓ Crossed off', tone: 'is-paid' };
    if (!r.date) return { text: r.status === 'trial' ? 'Free trial' : '—', tone: r.status === 'trial' ? 'is-trial' : '' };
    const days = Math.round((fromDayKey(r.date).getTime() - today.getTime()) / 86_400_000);
    if (r.from === 'hub' && paidAt[`money:lhsub:${r.sub!.id}:${r.date}`]) return { text: `✓ Charged ${shortDate(r.date)}`, tone: 'is-paid' };
    if (days < 0) return { text: `✓ Charged ${shortDate(r.date)}`, tone: 'is-paid' };
    if (days === 0) return { text: 'Charges today', tone: 'is-soon' };
    return { text: `Charges ${shortDate(r.date)}`, tone: days <= 3 ? 'is-soon' : '' };
  };
  return (
    <div className="subs">
      <div className="subs-top">
        <div className="subs-fig">
          <b>{money(monthly)}</b>
          <span>a month</span>
        </div>
        <div className="subs-fig">
          <b>{money(monthly * 12 + yearlyOnly)}</b>
          <span>a year</span>
        </div>
        <div className="subs-fig">
          <b>{charging.length}</b>
          <span>charging you</span>
        </div>
        <div className="subs-fig">
          <b>{money(chargedSoFar)}</b>
          <span>charged so far this month</span>
        </div>
        <button type="button" className="mny-btn is-primary subs-add" onClick={() => setAdding(v => !v)} aria-expanded={adding}>
          + Add subscription
        </button>
      </div>
      {adding ? <SubAdd onDone={() => setAdding(false)} /> : null}
      <ul className="subs-list">
        {sorted.map(r => {
          const st = stateOf(r);
          return (
            <li key={r.key} className={`subs-row is-${r.status}`}>
              <span className="subs-avatar" aria-hidden="true" style={{ '--h': String((r.name.charCodeAt(0) * 37) % 360) } as React.CSSProperties}>
                {r.name.charAt(0).toUpperCase()}
              </span>
              <span className="subs-name">
                {r.name}
                {r.from === 'hub' ? <small>added here{r.sub?.note ? ` · ${r.sub.note}` : ''}</small> : null}
              </span>
              <span className="subs-day">{r.day ? `the ${ordinal(r.day)}${r.sub?.cycle === 'yearly' ? ` of ${new Date(2026, r.sub.month ?? 0, 1).toLocaleDateString([], { month: 'short' })}` : ''}` : ''}</span>
              <span className="subs-amt">
                {money(r.amount) || '?'}
                <small>{r.sub?.cycle === 'yearly' ? '/yr' : '/mo'}</small>
              </span>
              <span className={`subs-state ${st.tone}`}>{st.text}</span>
              <span className="subs-tools">
                {r.from === 'sheet' && r.row ? (
                  <button type="button" className="mny-btn" onClick={() => void onSave([strikeEdit(r.row!, r.status !== 'skipped')])} title="Crosses it out in the sheet (done or skipped this month)">
                    {r.status === 'skipped' ? 'Uncross' : 'Cross off'}
                  </button>
                ) : null}
                {r.sub ? (
                  <>
                    <select
                      className="mny-btn"
                      value={r.sub.status}
                      aria-label={`Status of ${r.name}`}
                      onChange={e => updateLifeSub(r.sub!.id, { status: e.target.value as LifeSub['status'] })}
                    >
                      <option value="active">Active</option>
                      <option value="trial">Trial</option>
                      <option value="paused">Paused</option>
                      <option value="cancelled">Cancelled</option>
                    </select>
                    <button
                      type="button"
                      className="mny-btn"
                      onClick={() => window.confirm(`Remove ${r.name} from Life Hub?`) && updateLifeSub(r.sub!.id, { removed: true })}
                      aria-label={`Remove ${r.name}`}
                    >
                      ✕
                    </button>
                  </>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

const NEEDED_OPTIONS = ['Yes', 'Y Low', 'No', 'Ordered'];
type TabId = 'week' | 'month' | 'accounts' | 'cards' | 'bills' | 'subs' | 'plan' | 'owed' | 'shop' | 'save';
const TAB_IDS: TabId[] = ['week', 'month', 'accounts', 'cards', 'bills', 'subs', 'plan', 'owed', 'shop', 'save'];
const TAB_KEY = 'lifehub-money-tab';

export function MoneyPage({
  model,
  dues,
  monthDues,
  paidAt,
  lifeSubs,
  onPaid,
  onSave,
  onRefresh,
  syncing,
}: {
  model: MoneyModel | null;
  dues: BillDue[];
  /** Every payment this month, paid ones included */
  monthDues: BillDue[];
  /** Payment key → when it was marked paid */
  paidAt: Record<string, string>;
  lifeSubs: LifeSub[];
  onPaid: (d: BillDue) => void;
  onSave: (edits: CellEdit[]) => Promise<{ ok: boolean; results: EditResult[]; error?: string }>;
  onRefresh: () => void;
  syncing: boolean;
}) {
  const [note, setNote] = useState<{ text: string; tone: 'ok' | 'bad' } | null>(null);
  const [provider, setProvider] = useState('All');
  const [tab, setTabState] = useState<TabId>(() => {
    const saved = readSaved<string>(TAB_KEY, 'week');
    return saved === 'due' ? 'month' : TAB_IDS.includes(saved as TabId) ? (saved as TabId) : 'week';
  });
  const setTab = (t: TabId) => {
    setTabState(t);
    writeSaved(TAB_KEY, t);
  };
  useEffect(() => {
    if (!note) return;
    const t = window.setTimeout(() => setNote(null), 6000);
    return () => window.clearTimeout(t);
  }, [note]);
  const payPlans = usePayPlans();

  const save: Save = async edits => {
    setNote({ text: 'Saving to the sheet…', tone: 'ok' });
    const res = await onSave(edits);
    const bad = res.results.find(r => !r.ok);
    if (!res.ok || bad) setNote({ text: ERRORS[bad?.error || res.error || ''] || `Couldn’t save: ${bad?.error || res.error || 'unknown error'}`, tone: 'bad' });
    else setNote({ text: 'Saved to the sheet ✓', tone: 'ok' });
    return res;
  };

  // Skipped ones (Change → Skip) are left out of the planner too.
  const sheetDues = useMemo(() => dues.filter(d => d.bill.kind !== 'plan' && !d.skipped), [dues]);
  const today = startOfDay(new Date());
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  // Skipped payments (Change → Skip) aren't money going out.
  const sum = (list: BillDue[]) => list.reduce((s, d) => s + (d.skipped ? 0 : d.bill.amount || 0), 0);
  const next7 = dues.filter(d => d.days >= 0 && d.days <= 7);
  const overdue = dues.filter(isOverdue);
  const restOfMonth = dues.filter(d => d.days >= 0 && fromDayKey(d.due) <= monthEnd);

  if (!model) {
    return (
      <div className="settings-view money-view">
        <section className="mny-sec tone-cash">
          <header className="mny-sec-head">
            <div className="mny-sec-titles">
              <h2>Money</h2>
              <p>Waiting for the Radall sheet. It arrives with Google’s next sync (every 10 minutes) — or press Refresh at the top.</p>
            </div>
          </header>
        </section>
      </div>
    );
  }

  const link = (t: string) => sheetLink(model, t);
  const cash = amountOf(model.cashOnHand?.text || '');
  const dueWeek = sum(next7);
  const afterWeek = cash !== undefined ? cash - dueWeek : undefined;
  const cardsOwed = amountOf(model.cards?.total?.[1]?.text || '');
  const cardsAvail = amountOf(model.cards?.total?.[2]?.text || '');
  const cardsUsed = cardsOwed !== undefined && cardsAvail !== undefined && cardsOwed + cardsAvail > 0 ? Math.round((cardsOwed / (cardsOwed + cardsAvail)) * 100) : undefined;
  const pay = model.paylaterSums;
  const fico = model.scores.find(s => /fico/i.test(s.label))?.value;
  const lastNum = (row?: Cell[]) => (row ? amountOf([...row].reverse().find(c => amountOf(c.text) !== undefined)?.text || '') || 0 : 0);
  const outstandingSum = (model.outstanding?.rows || []).reduce((s, r) => s + (amountOf(r[1]?.text || '') || 0), 0);
  const nonCreditSum = model.nonCredit.reduce((s, t) => s + lastNum(t.total), 0);
  const collectionsSum = (model.collections?.rows || []).reduce((s, r) => s + (amountOf(r[1]?.text || '') || 0), 0);
  const owedSum = outstandingSum + nonCreditSum + collectionsSum;

  const neededNow = model.recurring ? model.recurring.rows.filter(r => /^(yes|y\s*low)$/i.test(r[0].text)) : [];
  const struckOf = (t: Table | null, bought: boolean) => (t ? { ...t, rows: t.rows.filter(r => r.some(c => c.struck) === bought) } : null);
  const openNeeded = struckOf(model.restockNeeded, false);
  const openWants = struckOf(model.wants, false);
  const boughtRows = [...(struckOf(model.restockNeeded, true)?.rows || []), ...(struckOf(model.wants, true)?.rows || [])];
  const bought = model.wants && boughtRows.length ? { ...model.wants, key: 'bought', groups: undefined, rows: boughtRows } : null;
  const lastRow = (t: Table | null) => (t && t.rows.length ? t.rows[t.rows.length - 1][0].r : undefined);
  const moveTo = (row: Cell[], target: Table | null, label: string) => {
    const after = lastRow(target);
    if (after === undefined) return null;
    return (
      <button
        type="button"
        className="mny-btn"
        title={`Move it to ${label} in the sheet`}
        onClick={() => void save([{ tab: row[0].tab, r: row[0].r, c: row[0].c, c1: row[0].c, c2: row[row.length - 1].c, expect: row[0].text, moveAfter: after }])}
      >
        → {label}
      </button>
    );
  };
  const providers = ['All', ...new Set((model.ledger?.rows || []).map(r => r[4]?.text).filter(Boolean))];
  const ledgerAhead = model.ledger
    ? {
        ...model.ledger,
        rows: model.ledger.rows.filter(r => {
          const when = r[0]?.text ? parseSheetDate(r[0].text, today) : undefined;
          return (!when || fromDayKey(when) >= today) && (provider === 'All' || r[4]?.text === provider);
        }),
      }
    : null;
  const monthRe = new RegExp(`^(${today.toLocaleDateString('en-US', { month: 'long' })}|${today.toLocaleDateString('en-US', { month: 'short' })})[- ]?(${today.getFullYear()})?$`, 'i');
  const isNow = (row: Cell[]) => (row.slice(0, 2).some(c => monthRe.test(c.text)) ? 'is-now' : '');
  const livePlan = payPlans.find(p => !p.archived);
  const monthCounted = monthDues.filter(d => !d.skipped);
  const monthCountBase = monthCounted.length;
  const crossedThisMonth = model.items.filter(i => i.skipped && i.date && fromDayKey(i.date).getMonth() === today.getMonth() && fromDayKey(i.date).getFullYear() === today.getFullYear()).length;
  const monthPaid = monthCounted.filter(d => paidAt[d.key] || (d.days < 0 && ['sub', 'paylater', 'plan'].includes(d.bill.kind || ''))).length + crossedThisMonth;
  const monthCount = monthCountBase + crossedThisMonth;
  // Bills still to pay this month (not paid on Life Hub, not crossed off in the sheet).
  const billsLeft = monthDues.filter(d => (d.bill.kind || 'bill') === 'bill' && !d.skipped && !paidAt[d.key]).length;
  const subsMonthly =
    (model.subs?.rows || []).filter(r => r[1]?.text).reduce((s, r) => s + (amountOf(r[2]?.text || '') || 0), 0) +
    lifeSubs.filter(x => x.status === 'active' && x.cycle === 'monthly').reduce((s, x) => s + (x.amount || 0), 0);

  const TABS: Array<{ id: TabId; tone: Tone; label: string; figure: string }> = [
    { id: 'week', tone: 'due', label: 'This week', figure: money(dueWeek) },
    { id: 'month', tone: 'due', label: today.toLocaleDateString([], { month: 'long' }), figure: `${monthPaid} of ${monthCount} paid` },
    { id: 'accounts', tone: 'cash', label: 'Checking / Savings', figure: model.cashOnHand?.text ? `${model.cashOnHand.text} on hand` : '' },
    { id: 'cards', tone: 'card', label: 'Credit cards', figure: model.cards?.total?.[1]?.text ? `${model.cards.total[1].text} owed` : '' },
    { id: 'bills', tone: 'due', label: 'Bills', figure: `${billsLeft} left` },
    { id: 'subs', tone: 'sub', label: 'Subscriptions', figure: `${money(subsMonthly)}/mo` },
    { id: 'plan', tone: 'plan', label: 'Plan', figure: livePlan ? livePlan.title : 'New' },
    { id: 'owed', tone: 'owed', label: 'What I owe', figure: money(owedSum) },
    { id: 'shop', tone: 'shop', label: 'Shopping', figure: `${neededNow.length + (openNeeded?.rows.length || 0)} needed` },
    { id: 'save', tone: 'save', label: 'Savings & move', figure: '' },
  ];

  return (
    <div className="settings-view money-view mny">
      {/* The story in one line: what you have, what's coming, what's left. */}
      <section className="mny-stand" aria-label="Where you stand">
        <div className="mny-stand-top">
          <p className="mny-eyebrow">Money · where you stand</p>
          <span className="mny-stand-meta">
            Radall sheet · {new Date(model.refreshedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
            <button type="button" className="mny-btn" onClick={onRefresh} disabled={syncing}>
              {syncing ? 'Syncing…' : 'Refresh'}
            </button>
            {model.sheetUrl ? (
              <a className="mny-btn" href={model.sheetUrl} target="_blank" rel="noopener noreferrer">
                Open sheet ↗
              </a>
            ) : null}
          </span>
        </div>
        <div className="mny-flow">
          <div className="mny-flow-step tone-cash">
            <span>Cash on hand</span>
            <b>{model.cashOnHand?.text || '—'}</b>
            <small>{model.balancedCash?.text ? `${model.balancedCash.text} balanced` : ''}</small>
          </div>
          <span className="mny-flow-op" aria-hidden="true">
            −
          </span>
          <button type="button" className="mny-flow-step tone-due is-link" onClick={() => setTab('week')}>
            <span>Due next 7 days</span>
            <b>{money(dueWeek)}</b>
            <small>{next7.length} payments</small>
          </button>
          <span className="mny-flow-op" aria-hidden="true">
            =
          </span>
          <div className={`mny-flow-step is-result${afterWeek !== undefined && afterWeek < 0 ? ' is-short' : ' is-ok'}`}>
            <span>{afterWeek !== undefined && afterWeek < 0 ? 'Short this week' : 'Left after this week'}</span>
            <b>{afterWeek !== undefined ? money(Math.abs(afterWeek)) : '—'}</b>
            <small>{afterWeek !== undefined && afterWeek < 0 ? 'needs income or a plan' : 'before anything new comes in'}</small>
          </div>
          <div className="mny-flow-side">
            <button type="button" className="mny-mini tone-due" onClick={() => setTab('month')}>
              <span>Rest of {today.toLocaleDateString([], { month: 'long' })}</span>
              <b>{money(sum(restOfMonth))}</b>
            </button>
            <button type="button" className="mny-mini tone-card" onClick={() => setTab('cards')}>
              <span>Cards</span>
              <b>{model.cards?.total?.[1]?.text || '—'}</b>
              {cardsUsed !== undefined ? <small>{cardsUsed}% used</small> : null}
            </button>
            <button type="button" className="mny-mini tone-due" onClick={() => setTab('month')}>
              <span>Pay later</span>
              <b>{pay?.total?.[1]?.text || '—'}</b>
            </button>
            <button type="button" className="mny-mini tone-owed" onClick={() => setTab('owed')}>
              <span>Owed elsewhere</span>
              <b>{money(owedSum)}</b>
            </button>
            {fico ? (
              <button type="button" className="mny-mini tone-card" onClick={() => setTab('cards')}>
                <span>Credit score</span>
                <b>{Math.round(Number(fico)) || fico}</b>
              </button>
            ) : null}
          </div>
        </div>
        {note ? (
          <p className={`money-note is-${note.tone}`} role="status">
            {note.text}
          </p>
        ) : null}
      </section>

      <nav className="mny-tabs" role="tablist" aria-label="Money sections">
        {TABS.map(t => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`mny-tab tone-${t.tone}${tab === t.id ? ' is-on' : ''}`} onClick={() => setTab(t.id)}>
            <span className="mny-tab-label">{t.label}</span>
            {t.figure ? <span className="mny-tab-fig">{t.figure}</span> : null}
          </button>
        ))}
      </nav>

      <div className="mny-panel" role="tabpanel">
        {tab === 'week' ? (
          <div className="mny-cols">
            <div className="mny-stack">
              <Section tone="due" title="Due in the next 7 days" hint="Tap Paid when it’s done. Tap a day to fold it. Change skips or moves one payment." figure={money(dueWeek)} figureLabel={`${next7.length} payments`}>
                <DueList dues={dues} onPaid={onPaid} by="day" days={7} />
              </Section>
              {overdue.length ? (
                <Section tone="owed" className="mny-sec-overdue" title="Overdue" hint="Past its day and not marked paid. Paid clears it; Change can skip or move it." figure={money(sum(overdue))} figureLabel={`${overdue.length} ${overdue.length === 1 ? 'payment' : 'payments'}`}>
                  <OverdueList dues={overdue} onPaid={onPaid} />
                </Section>
              ) : null}
            </div>
            <div className="mny-stack">
              <Section tone="cash" title="Money right now" figure={model.cashOnHand?.text} figureLabel="on hand" href={link('Randy')}>
                <AccountsList model={model} onSave={save} />
              </Section>
              <Section tone="plan" title="Your plan" hint={livePlan ? `Open: ${livePlan.title}` : 'No plan yet for the coming days.'}>
                <button type="button" className="mny-cta" onClick={() => setTab('plan')}>
                  {livePlan ? 'Open the plan →' : 'Make a plan →'}
                </button>
              </Section>
            </div>
          </div>
        ) : null}

        {tab === 'month' ? (
          <div className="mny-stack">
            <Section tone="due" title={`${today.toLocaleDateString([], { month: 'long' })} at a glance`} figure={`${monthPaid} of ${monthCount}`} figureLabel="paid" href={link('Randy')}>
              <MonthView dues={monthDues} paidAt={paidAt} model={model} onPaid={onPaid} />
            </Section>
            <Section tone="due" title="After this month" figure={money(sum(dues.filter(d => fromDayKey(d.due) > monthEnd && d.days <= 35)))} figureLabel="next few weeks">
              <DueList dues={dues.filter(d => fromDayKey(d.due) > monthEnd)} onPaid={onPaid} by="week" days={35} />
            </Section>
            <Section tone="due" title="In the sheet" hint="Click any amount or date to change it in the sheet." href={link('Randy')}>
              {model.bills ? (
                <Fold title="Bills" total={model.bills.total?.[2]?.text} meta={`${model.bills.rows.length}`}>
                  <SheetTable table={model.bills} onSave={save} />
                </Fold>
              ) : null}
              {model.cardMins ? (
                <Fold title="Card minimums" total={model.cardMins.total?.[2]?.text} meta={`${model.cardMins.rows.length}`}>
                  <SheetTable table={{ ...model.cardMins, header: ['Date Due', 'Card', 'Amount'] }} onSave={save} />
                </Fold>
              ) : null}
              <Fold title="Pay later" total={pay?.total?.[1]?.text} meta="Klarna · Affirm · Afterpay · Zip">
                {pay ? (
                  <div className="mny-providers">
                    {pay.rows.map(r => (
                      <div key={r[0].r} className="mny-provider">
                        <strong>{r[0].text.replace(/\s*sum$/i, '')}</strong>
                        <span>
                          <EditCell cell={r[1]} onSave={save} /> owed
                        </span>
                        <span>
                          <EditCell cell={r[3]} onSave={save} /> available
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null}
                {model.buckets ? <SheetTable table={model.buckets} onSave={save} /> : null}
                {ledgerAhead ? (
                  <>
                    <div className="mny-filter" role="group" aria-label="Provider">
                      {providers.map(p => (
                        <button key={p} type="button" className={`mny-chip${provider === p ? ' is-on' : ''}`} aria-pressed={provider === p} onClick={() => setProvider(p)}>
                          {p}
                        </button>
                      ))}
                    </div>
                    <SheetTable table={ledgerAhead} onSave={save} opts={{ limit: 12 }} />
                  </>
                ) : null}
              </Fold>
            </Section>
          </div>
        ) : null}

        {tab === 'cards' ? (
          <div className="mny-stack">
            <Section
              tone="card"
              title="Credit cards"
              figure={model.cards?.total?.[1]?.text}
              figureLabel={[cardsUsed !== undefined ? `${cardsUsed}% used` : '', model.cards?.total?.[2]?.text ? `${model.cards.total[2].text} free` : ''].filter(Boolean).join(' · ')}
              href={link('Randy')}
            >
              <CardTiles model={model} dues={dues} paidAt={paidAt} onPaid={onPaid} onSave={save} />
            </Section>
            <Section tone="card" title="Credit" figure={fico ? String(Math.round(Number(fico)) || fico) : undefined} figureLabel="FICO" href={link('Credit Matrix')}>
              {model.scores.length ? (
                <div className="mny-tiles">
                  {model.scores.map(sc => (
                    <span key={sc.label} className="mny-tile">
                      <span>{sc.label}</span>
                      <b>{sc.value}</b>
                    </span>
                  ))}
                </div>
              ) : null}
              {model.creditAccounts ? (
                <Fold title="Loans & store credit" meta="Toyota · Fortiva · Nelnet">
                  <SheetTable table={model.creditAccounts} onSave={save} />
                </Fold>
              ) : null}
              {model.utilEst ? (
                <Fold title="Utilization estimate">
                  <SheetTable table={model.utilEst} onSave={save} />
                </Fold>
              ) : null}
            </Section>
          </div>
        ) : null}

        {tab === 'bills' ? (
          <div className="mny-stack">
            <Section tone="due" title={`Bills · ${today.toLocaleDateString([], { month: 'long' })}`} href={link('Randy')}>
              <MonthView dues={monthDues} paidAt={paidAt} model={model} onPaid={onPaid} kinds={['bill']} />
            </Section>
            {model.bills ? (
              <Section tone="due" title="In the sheet" hint="Click any amount or date to change it in the sheet." href={link('Randy')}>
                <SheetTable table={model.bills} onSave={save} />
              </Section>
            ) : null}
          </div>
        ) : null}

        {tab === 'subs' ? (
          <Section tone="sub" title="Subscriptions" href={link('Randy')}>
            <SubsView model={model} lifeSubs={lifeSubs} paidAt={paidAt} dues={monthDues} onSave={save} />
          </Section>
        ) : null}

        {tab === 'plan' ? (
          <Section tone="plan" title="Plan payments" hint="Pick the days, start from your cash, see what’s due, add extra payments — saved in Life Hub, not the sheet.">
            <PayPlanner dues={sheetDues} debts={debtOptions(model)} cashOnHand={model.cashOnHand?.text} balancedCash={model.balancedCash?.text} />
          </Section>
        ) : null}

        {tab === 'accounts' ? (
          <div className="mny-cols">
            <div className="mny-stack">
              <Section tone="cash" title="Checking / Savings" figure={model.cashOnHand?.text} figureLabel={model.balancedCash?.text ? `on hand · ${model.balancedCash.text} balanced` : 'on hand'} href={link('Randy')}>
                <AccountsList model={model} onSave={save} />
                {model.balancing ? (
                  <Fold title="Balancing" meta="accounts + pending money → cash on hand">
                    <SheetTable table={{ ...model.balancing, header: ['Account', ...model.balancing.header.slice(1)] }} onSave={save} />
                  </Fold>
                ) : null}
              </Section>
            </div>
          </div>
        ) : null}

        {tab === 'owed' ? (
          <div className="mny-cols">
            <div className="mny-stack">
              <Section tone="owed" title="Outstanding" figure={money(outstandingSum)} figureLabel="known" href={link('Randy')}>
                {model.outstanding ? <SheetTable table={model.outstanding} onSave={save} /> : null}
              </Section>
              <Section tone="owed" title="Not on credit" hint="Cash advances, repairs, tickets, taxes." figure={money(nonCreditSum)} href={link('Non-Credit')}>
                {model.nonCredit.map(t => (
                  <Fold key={t.key} title={t.title} meta={`${t.rows.length}`} total={t.total?.[t.total.length - 1]?.text}>
                    <SheetTable table={t} onSave={save} />
                  </Fold>
                ))}
              </Section>
            </div>
            <div className="mny-stack">
              {model.collections ? (
                <Section tone="owed" title="Collections & past due" figure={money(collectionsSum)} href={link('Credit Matrix')}>
                  <SheetTable table={model.collections} onSave={save} />
                </Section>
              ) : null}
              <Section tone="plan" title="Payoff plans" hint="Priorities from the CC/Savings Planner and month-by-month payoffs.">
                {model.payoff ? (
                  <Fold title="Payoff priorities" meta={`${model.payoff.rows.length} debts`} open>
                    <SheetTable table={model.payoff} onSave={save} />
                  </Fold>
                ) : null}
                {model.plans.map(t => (
                  <Fold key={t.key} title={t.title} meta="this month highlighted">
                    <SheetTable table={t} onSave={save} opts={{ rowClass: isNow }} />
                  </Fold>
                ))}
              </Section>
            </div>
          </div>
        ) : null}

        {tab === 'shop' ? (
          <div className="mny-cols">
            <Section tone="shop" title="Restock" hint="Set Needed? from the dropdown — Yes and Y Low rise to the top list." figure={model.upcomingSpend.rows.find(r => /resupply/i.test(r[0].text))?.[1]?.text} figureLabel="resupply" href={link('Restock/Purchases')}>
              {model.recurring ? (
                <>
                  <Fold title="Needed now" meta={`${neededNow.length} items`} open>
                    {neededNow.length ? (
                      <SheetTable table={{ ...model.recurring, rows: neededNow }} onSave={save} opts={{ hide: [3, 6], select: { col: 0, options: NEEDED_OPTIONS } }} />
                    ) : (
                      <p className="mny-empty">Nothing marked Yes or Y Low.</p>
                    )}
                  </Fold>
                  <Fold title="All re-occurring items" meta={`${model.recurring.rows.length}`}>
                    <SheetTable table={model.recurring} onSave={save} opts={{ hide: [3, 6], select: { col: 0, options: NEEDED_OPTIONS } }} />
                  </Fold>
                </>
              ) : null}
            </Section>
            <Section tone="shop" title="Purchases" hint="Tick when bought (crosses it out in the sheet). Move items between lists." href={link('Restock/Purchases')}>
              {openNeeded ? (
                <Fold title="Needed" meta={`${openNeeded.rows.length} open`} open={openNeeded.rows.length > 0}>
                  {openNeeded.rows.length ? (
                    <SheetTable table={openNeeded} onSave={save} opts={{ check: 'Bought', hide: [0, 3, 6], actions: row => moveTo(row, model.wants, 'Wants') }} />
                  ) : (
                    <p className="mny-empty">Nothing open — everything here is bought.</p>
                  )}
                </Fold>
              ) : null}
              {openWants ? (
                <Fold title="Wants" meta={`${openWants.rows.length} open`} open>
                  <SheetTable table={openWants} onSave={save} opts={{ check: 'Bought', hide: [0, 3, 6], actions: row => moveTo(row, model.restockNeeded, 'Needed') }} />
                </Fold>
              ) : null}
              {bought ? (
                <Fold title="Bought" meta={`${bought.rows.length} crossed off`}>
                  <SheetTable table={bought} onSave={save} opts={{ check: 'Bought', hide: [0, 3, 6] }} />
                </Fold>
              ) : null}
            </Section>
          </div>
        ) : null}

        {tab === 'save' ? (
          <div className="mny-cols">
            <Section tone="save" title="Savings" hint="Values are still right; the planner’s dates are older." href={link('🌟 CC/Savings Planner')}>
              {model.savings ? <SheetTable table={{ ...model.savings, header: ['Fund', ...model.savings.header.slice(1)] }} onSave={save} /> : null}
            </Section>
            <Section tone="save" title="Move estimate" href={link('Move Sav /COG Estimate')}>
              {model.move.map((t, i) => (
                <Fold key={t.key} title={t.title} meta={`${t.rows.length}`} open={i === 0}>
                  <SheetTable table={t} onSave={save} />
                </Fold>
              ))}
            </Section>
          </div>
        ) : null}
      </div>

      {model.missing.length ? (
        <p className="money-missing">
          Couldn’t find these headings in the sheet (renamed or moved?): {model.missing.join(', ')}. Everything else still shows.
        </p>
      ) : null}
      <p className="money-foot">Every change from Life Hub is logged on the sheet’s “Life Hub edits” tab.</p>
    </div>
  );
}
