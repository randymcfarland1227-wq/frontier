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
import { addIncoming, incomingDues, updateIncoming, useIncoming, type Incoming, type IncomingDue } from '../../lib/incoming';

type Save = (edits: CellEdit[]) => Promise<{ ok: boolean; results: EditResult[]; error?: string }>;

const ERRORS: Record<string, string> = {
  changed: 'That cell changed in the sheet since Life Hub last read it — showing the latest now. Try again if it still needs changing.',
  formula: 'That cell is a formula in the sheet, so Life Hub leaves it alone.',
  busy: 'Google was in the middle of a sync — try again in a few seconds.',
  wrong_key: 'This browser isn’t linked to the backup yet, so it can’t save to the sheet.',
  not_configured: 'Saving to the sheet isn’t set up on the Worker yet.',
  'bad cell': 'The sheet connection needs its Balancing update before new line items can be saved.',
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
  /** Add a computed Total row summing numeric columns over rows whose label doesn't match this */
  sumExcept?: RegExp;
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

function BalancingAdd({ table, onSave }: { table: Table; onSave: Save }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [pending, setPending] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Inserting inside the existing list keeps the sheet’s total ranges inclusive.
  const items = table.rows.filter(row => !row.some(cell => cell.formula) && !/^(cash on hand|balanced cash)/i.test(row[0]?.text || ''));
  const anchor = items.length > 1 ? items[items.length - 1] : table.firstRow;
  if (!anchor) return null;
  if (!open) return <button type="button" className="mny-btn" onClick={() => setOpen(true)}>+ Add line item</button>;
  const cancel = () => {
    if (busy) return;
    setOpen(false);
    setName(''); setAmount(''); setPending(''); setError('');
  };
  return (
    <form className="sub-form" onKeyDown={e => { if (e.key === 'Escape') cancel(); }} onSubmit={async e => {
      e.preventDefault();
      if (busy) return;
      if (!name.trim() || /^[=+@]/.test(name.trim())) return setError('Enter an account or line item name.');
      if ([amount, pending].some(v => v.trim() && amountOf(v) === undefined)) return setError('Enter a valid amount, such as 12.50.');
      const values = anchor.map(() => '');
      values[0] = name.trim();
      values[1] = String(amountOf(amount) ?? 0);
      const pendingCol = table.header.findIndex(h => /^pend/i.test(h));
      if (pendingCol >= 0) values[pendingCol] = pending.trim() ? String(amountOf(pending)) : '';
      setBusy(true); setError('');
      try {
        const result = await onSave([{ tab: table.tab, insertBalancing: true, r: anchor[0].r, startCol: anchor[0].c, expectRow: anchor.map(c => c.text), values }]);
        const failed = result.results.find(r => !r.ok);
        if (!result.ok || failed || result.results.length !== 1) setError(ERRORS[failed?.error || result.error || ''] || 'Couldn’t add the line item. Your entries are kept here so you can try again.');
        else { setOpen(false); setName(''); setAmount(''); setPending(''); }
      } catch { setError('Couldn’t add the line item. Try again.'); }
      finally { setBusy(false); }
    }}>
      <label className="sub-form-wide"><span>Account / line item</span><input autoFocus required maxLength={200} disabled={busy} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Cash or marketplace payout" /></label>
      <label><span>Amount</span><input inputMode="decimal" disabled={busy} value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" /></label>
      {table.header.some(h => /^pend/i.test(h)) ? <label><span>Pending amount</span><input inputMode="decimal" disabled={busy} value={pending} onChange={e => setPending(e.target.value)} placeholder="Optional" /></label> : null}
      {error ? <p role="alert" className="sub-form-wide">{error}</p> : null}
      <div className="sub-form-actions"><button type="submit" className="mny-btn" disabled={busy}>{busy ? 'Adding…' : 'Add line item'}</button><button type="button" className="mny-btn" disabled={busy} onClick={cancel}>Cancel</button></div>
    </form>
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
        {opts.sumExcept ? (
          <tfoot className="mtable-sum">
            <tr>
              {opts.check ? <td /> : null}
              {cols.map((i, ci) => {
                const items = rows.filter(row => !opts.sumExcept!.test(row[0]?.text || ''));
                const vals = items.map(row => amountOf(row[i]?.text || '')).filter((v): v is number => v !== undefined);
                return (
                  <td key={i} className={numeric.has(i) ? 'is-num' : ''}>
                    {ci === 0 ? 'Total' : numeric.has(i) && vals.length ? money(vals.reduce((a, b) => a + b, 0)) : ''}
                  </td>
                );
              })}
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

function IncomingRow({ d, showDay }: { d: IncomingDue; showDay: boolean }) {
  return (
    <li className="is-incoming" style={{ '--ev': '#14b8a6' } as React.CSSProperties}>
      {showDay ? <span className="mny-due-day">{fromDayKey(d.due).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}</span> : null}
      <span className="mny-due-kind">Incoming</span>
      <span className="mny-due-name">
        {d.item.source}
        {d.item.cycle !== 'once' ? <small> · {d.item.cycle}</small> : null}
      </span>
      <span className="mny-due-amt is-in">+{money(d.item.amount) || '?'}</span>
      <span className="mny-due-tools" />
    </li>
  );
}

function DueList({
  dues,
  onPaid,
  by,
  days,
  overdue = [],
  incoming = [],
}: {
  dues: BillDue[];
  onPaid: (d: BillDue) => void;
  by: 'day' | 'week';
  days: number;
  /** Shown first, as its own "Overdue" group */
  overdue?: BillDue[];
  incoming?: IncomingDue[];
}) {
  const today = startOfDay(new Date());
  const [folded, toggleFold] = useFoldedDays();
  const upcoming = dues.filter(d => d.days >= 0 && d.days <= days);
  const inUpcoming = incoming.filter(d => d.days >= 0 && d.days <= days);
  const groupKey = (due: string) => (by === 'day' ? due : dayKey(startOfWeek(fromDayKey(due))));
  const groups = new Map<string, { out: BillDue[]; in: IncomingDue[] }>();
  const slot = (k: string) => groups.get(k) || (groups.set(k, { out: [], in: [] }), groups.get(k)!);
  for (const d of upcoming) slot(groupKey(d.due)).out.push(d);
  for (const d of inUpcoming) slot(groupKey(d.due)).in.push(d);
  const keys = [...groups.keys()].sort();
  const label = (k: string) => {
    if (by === 'day') return dayName(fromDayKey(k));
    const weeksOut = Math.round((fromDayKey(k).getTime() - startOfWeek(today).getTime()) / (7 * 86_400_000));
    return weeksOut === 0 ? 'This week' : weeksOut === 1 ? 'Next week' : `Week of ${fromDayKey(k).toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
  };
  if (!keys.length && !overdue.length) return <p className="mny-empty">Nothing due{by === 'day' ? ' in the next 7 days' : ''}. Nice.</p>;
  const sumOut = (list: BillDue[]) => money(list.filter(d => !d.skipped).reduce((s, d) => s + (d.bill.amount || 0), 0));
  const dayGroup = (k: string, title: string, out: BillDue[], inc: IncomingDue[], extra = '') => {
    const isFolded = folded.has(k);
    const n = out.length + inc.length;
    return (
      <div key={k} className={`mny-due-group${isFolded ? ' is-folded' : ''}${extra}`}>
        <h3>
          <button type="button" className="mny-due-fold" aria-expanded={!isFolded} onClick={() => toggleFold(k)}>
            <span className="mny-fold-chev" aria-hidden="true" />
            <span>{title}</span>
            {isFolded ? <small>{n} {n === 1 ? 'item' : 'items'}</small> : null}
          </button>
          <b>{out.length ? sumOut(out) : ''}</b>
        </h3>
        {isFolded ? null : (
          <ul>
            {out.map(d => (
              <DueRow key={d.key} d={d} onPaid={onPaid} showDay={extra !== '' || by === 'week'} />
            ))}
            {inc.map(d => (
              <IncomingRow key={d.key} d={d} showDay={by === 'week'} />
            ))}
          </ul>
        )}
      </div>
    );
  };
  return (
    <div className="mny-due">
      {overdue.length ? dayGroup('overdue', 'Overdue', overdue, [], ' is-overdue-group') : null}
      {keys.map((k, gi) => {
        const g = groups.get(k)!;
        if (by === 'week') {
          return (
            <Fold key={k} title={label(k)} meta={`${g.out.length} payments${g.in.length ? ` · ${g.in.length} incoming` : ''}`} total={sumOut(g.out)} open={gi === 0}>
              <ul>
                {g.out.map(d => (
                  <DueRow key={d.key} d={d} onPaid={onPaid} showDay />
                ))}
                {g.in.map(d => (
                  <IncomingRow key={d.key} d={d} showDay />
                ))}
              </ul>
            </Fold>
          );
        }
        return dayGroup(k, label(k), g.out, g.in);
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Accounts + cards
// ---------------------------------------------------------------------------

function AccountsList({ model, onSave, only }: { model: MoneyModel; onSave: Save; only?: 1 | 2 }) {
  const accts = model.accounts;
  if (!accts) return null;
  const show = (i: 1 | 2) => !only || only === i;
  return (
    <ul className={`mny-accts${only ? ' is-single' : ''}`}>
      <li className="mny-accts-head">
        <span>Account</span>
        {show(1) ? <span>Checking</span> : null}
        {show(2) ? <span>Savings</span> : null}
      </li>
      {accts.rows.map(r => (
        <li key={r[0].r}>
          <span className="mny-accts-name">{r[0].text}</span>
          {show(1) ? <EditCell cell={r[1]} onSave={onSave} className="is-num" placeholder="—" /> : null}
          {show(2) ? <EditCell cell={r[2]} onSave={onSave} className="is-num" placeholder="—" /> : null}
        </li>
      ))}
      {accts.total ? (
        <li className="mny-accts-total">
          <span>All accounts</span>
          {show(1) ? <EditCell cell={accts.total[1]} onSave={onSave} className="is-num" placeholder="" /> : null}
          {show(2) ? <EditCell cell={accts.total[2]} onSave={onSave} className="is-num" placeholder="" /> : null}
        </li>
      ) : null}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// This month: every payment this month — paid ✓, charged, skipped, still to pay — like the sheet
// ---------------------------------------------------------------------------

/** Kinds that take themselves out (subscriptions, pay later, planned transfers). */
const shortDate = (k: string) => fromDayKey(k).toLocaleDateString([], { month: 'short', day: 'numeric' });

type MonthState = 'paid' | 'crossed' | 'charged' | 'skipped' | 'late' | 'today' | 'soon' | 'later';

/** Rows crossed out in the sheet — that's how the sheet marks a payment handled. */
const CROSSED = 'crossed:';

function monthState(d: BillDue, paidAt: Record<string, string>): MonthState {
  if (d.bill.id.startsWith(CROSSED)) return 'crossed';
  if (d.skipped) return 'skipped';
  if (paidAt[d.key]) return 'paid';
  // Past its day and not marked: overdue. Nothing is ever assumed charged — only a Paid click or the sheet's cross-off counts.
  if (d.days < 0) return 'late';
  if (d.days === 0) return 'today';
  return d.days <= 7 ? 'soon' : 'later';
}

const STATE_TEXT: Record<MonthState, (d: BillDue, paidAt: Record<string, string>) => string> = {
  paid: (d, p) => `Paid ${new Date(p[d.key]).toLocaleDateString([], { month: 'short', day: 'numeric' })}`,
  crossed: () => 'Crossed off',
  charged: () => 'Charged',
  skipped: () => 'Skipped',
  late: () => 'Overdue · not marked paid',
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
        {billChangeText(d) ? <small> · {billChangeText(d)}</small> : null}
      </span>
      <span className="mm-amt">{money(d.bill.amount) || '?'}</span>
      <span className="mm-state">
        {state === 'paid' || state === 'crossed' || state === 'charged' ? '✓ ' : ''}
        {STATE_TEXT[state](d, paidAt)}
      </span>
      <span className="mm-tools">
        {done ? null : (
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
        // Live: what's still unpaid this week (Paid on Life Hub or crossed off in the sheet drops out)
        const owedAll = list.filter(d => !d.skipped);
        const sum = owedAll.filter(d => !['paid', 'crossed', 'charged'].includes(monthState(d, paidAt))).reduce((s, d) => s + (d.bill.amount || 0), 0);
        const weekTotal = owedAll.reduce((s, d) => s + (d.bill.amount || 0), 0);
        const allDone = list.every(d => ['paid', 'crossed', 'charged', 'skipped'].includes(monthState(d, paidAt)));
        return (
          <details key={w} className={`mm-week${w === thisWeek ? ' is-now' : ''}${allDone ? ' is-done' : ''}`} open={!allDone || w === thisWeek}>
            <summary>
              <span className="mny-fold-chev" aria-hidden="true" />
              <span className="mm-week-name">
                {today.toLocaleDateString([], { month: 'short' })} {from}–{to}
              </span>
              {w === thisWeek ? <span className="mm-now">This week</span> : allDone ? <span className="mm-donechip">✓ All done</span> : null}
              <span className="mm-week-sum" title={`${money(weekTotal)} total this week`}>
                {money(sum)} <small>left</small>
              </span>
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
  // Charged = you marked it (Paid on Life Hub) or crossed it off in the sheet. A passed date alone is not a charge.
  const paidKeyOf = (r: SubRow) =>
    r.from === 'hub' ? `money:lhsub:${r.sub!.id}:${r.date}` : dues.find(d => d.due === r.date && d.bill.kind === 'sub' && d.bill.name.trim().toLowerCase() === r.name.toLowerCase())?.key;
  const isCharged = (r: SubRow) => r.status === 'skipped' || Boolean(r.date && paidAt[paidKeyOf(r) || '']);
  const chargedSoFar = all.filter(r => live(r) && isCharged(r)).reduce((s, r) => s + (r.amount || 0), 0);
  const order = (r: SubRow) => (live(r) ? 0 : r.status === 'trial' ? 1 : 2);
  const sorted = [...all].sort((a, b) => order(a) - order(b) || (a.day ?? 99) - (b.day ?? 99) || a.name.localeCompare(b.name));
  const stateOf = (r: SubRow) => {
    if (r.status === 'paused') return { text: 'Paused', tone: 'is-quiet' };
    if (r.status === 'cancelled') return { text: 'Cancelled', tone: 'is-quiet' };
    if (r.status === 'skipped') return { text: '✓ Crossed off', tone: 'is-paid' };
    if (!r.date) return { text: r.status === 'trial' ? 'Free trial' : '—', tone: r.status === 'trial' ? 'is-trial' : '' };
    const days = Math.round((fromDayKey(r.date).getTime() - today.getTime()) / 86_400_000);
    if (isCharged(r)) return { text: `✓ Charged ${shortDate(r.date)}`, tone: 'is-paid' };
    if (days < 0) return { text: `Overdue · ${shortDate(r.date)}`, tone: 'is-late' };
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
// Incoming funds — logged on Life Hub (cloud-synced), shown in Week / Month
// ---------------------------------------------------------------------------

function IncomeSection({ list, upcoming }: { list: Incoming[]; upcoming: IncomingDue[] }) {
  const [adding, setAdding] = useState(false);
  const [source, setSource] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(() => dayKey(new Date()));
  const [cycle, setCycle] = useState<Incoming['cycle']>('weekly');
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!source.trim() || !date) return;
    addIncoming({ source, amount: amountOf(amount), date, cycle });
    setSource('');
    setAmount('');
    setAdding(false);
  };
  const next30 = upcoming.filter(d => d.days >= 0 && d.days <= 30);
  const nextOf = (it: Incoming) => upcoming.find(d => d.item.id === it.id && d.days >= 0)?.due;
  return (
    <div className="mny-income">
      <div className="mny-income-top">
        <span>
          <b>{money(next30.reduce((s, d) => s + (d.item.amount || 0), 0))}</b> coming in the next 30 days
        </span>
        <button type="button" className="mny-btn is-primary" onClick={() => setAdding(v => !v)} aria-expanded={adding}>
          + Log income
        </button>
      </div>
      {adding ? (
        <form className="mny-income-form" onSubmit={submit}>
          <label>
            <span>Source</span>
            <input value={source} onChange={e => setSource(e.target.value)} placeholder="Unemployment" required />
          </label>
          <label>
            <span>Amount</span>
            <input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="300" />
          </label>
          <label>
            <span>{cycle === 'once' ? 'Date' : 'First date'}</span>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} required />
          </label>
          <label>
            <span>Repeats</span>
            <select value={cycle} onChange={e => setCycle(e.target.value as Incoming['cycle'])}>
              <option value="weekly">Every week</option>
              <option value="biweekly">Every 2 weeks</option>
              <option value="monthly">Every month</option>
              <option value="once">Just once</option>
            </select>
          </label>
          <button type="submit" className="mny-btn is-primary">Save</button>
        </form>
      ) : null}
      {list.length ? (
        <ul className="mny-income-list">
          {list.map(it => {
            const nx = nextOf(it);
            return (
              <li key={it.id}>
                <span className="mny-due-name">{it.source}</span>
                <span className="mny-income-when">
                  {it.cycle === 'once' ? shortDate(it.date) : `${it.cycle === 'weekly' ? 'Every' : it.cycle === 'biweekly' ? 'Every other' : 'Monthly ·'} ${it.cycle === 'monthly' ? ordinal(fromDayKey(it.date).getDate()) : fromDayKey(it.date).toLocaleDateString([], { weekday: 'long' })}`}
                  {nx ? ` · next ${shortDate(nx)}` : ''}
                </span>
                <span className="mny-due-amt is-in">+{money(it.amount) || '?'}</span>
                <button
                  type="button"
                  className="mny-btn"
                  aria-label={`Remove ${it.source}`}
                  onClick={() => window.confirm(`Remove ${it.source} from incoming funds?`) && updateIncoming(it.id, { removed: true })}
                >
                  ✕
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mny-empty">Nothing logged yet. Add unemployment, paychecks or transfers in.</p>
      )}
    </div>
  );
}

function SubTabs<T extends string>({ value, options, onChange, label }: { value: T; options: Array<[T, string, string?]>; onChange: (v: T) => void; label: string }) {
  return (
    <div className="mny-subtabs" role="tablist" aria-label={label}>
      {options.map(([id, text, fig]) => (
        <button key={id} type="button" role="tab" aria-selected={value === id} className={`mny-subtab${value === id ? ' is-on' : ''}`} onClick={() => onChange(id)}>
          {text}
          {fig ? <small>{fig}</small> : null}
        </button>
      ))}
    </div>
  );
}

function useSavedChoice<T extends string>(key: string, ids: readonly T[], fallback: T, legacy?: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    const saved = readSaved<string>(key, '');
    return ids.includes(saved as T) ? (saved as T) : legacy || fallback;
  });
  return [v, (n: T) => (setV(n), writeSaved(key, n))];
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

const NEEDED_OPTIONS = ['Yes', 'Y Low', 'No', 'Ordered'];
type TabId = 'flow' | 'accounts' | 'spend' | 'plan' | 'owed' | 'save';
const TAB_IDS: TabId[] = ['flow', 'accounts', 'spend', 'plan', 'owed', 'save'];
/** Old saved tabs → the merged container they now live in */
const LEGACY_TAB: Record<string, TabId> = { week: 'flow', month: 'flow', due: 'flow', cards: 'accounts', bills: 'spend', subs: 'spend', shop: 'spend' };
const FLOW_IDS = ['week', 'month'] as const;
const ACCT_IDS = ['checking', 'savings', 'cards'] as const;
const SPEND_IDS = ['out', 'bills', 'paylater', 'subs', 'shop'] as const;
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
  const [legacyTab] = useState(() => readSaved<string>(TAB_KEY, 'flow'));
  const [tab, setTabState] = useState<TabId>(() => (TAB_IDS.includes(legacyTab as TabId) ? (legacyTab as TabId) : LEGACY_TAB[legacyTab] || 'flow'));
  const [flowView, setFlowView] = useSavedChoice('lifehub-money-flow', FLOW_IDS, 'week', legacyTab === 'month' || legacyTab === 'due' ? 'month' : undefined);
  const [acctView, setAcctView] = useSavedChoice('lifehub-money-accounts', ACCT_IDS, 'checking', legacyTab === 'cards' ? 'cards' : undefined);
  const [spendView, setSpendView] = useSavedChoice('lifehub-money-spend', SPEND_IDS, 'out', legacyTab === 'subs' ? 'subs' : legacyTab === 'shop' ? 'shop' : undefined);
  const incomeList = useIncoming();
  const incoming = useMemo(() => incomingDues(incomeList, new Date(), 0, 45), [incomeList]);
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
  const go = (t: TabId, sub?: () => void) => {
    setTab(t);
    sub?.();
  };

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
  const monthPaid = monthCounted.filter(d => paidAt[d.key]).length + crossedThisMonth;
  const monthCount = monthCountBase + crossedThisMonth;
  // Bills still to pay this month (not paid on Life Hub, not crossed off in the sheet).
  const billsLeft = monthDues.filter(d => (d.bill.kind || 'bill') === 'bill' && !d.skipped && !paidAt[d.key]).length;
  const subsMonthly =
    (model.subs?.rows || []).filter(r => r[1]?.text).reduce((s, r) => s + (amountOf(r[2]?.text || '') || 0), 0) +
    lifeSubs.filter(x => x.status === 'active' && x.cycle === 'monthly').reduce((s, x) => s + (x.amount || 0), 0);

  const monthName = today.toLocaleDateString([], { month: 'long' });
  // Live "left this week" per breakdown — same weeks as the month list (1–7, 8–14, …): unpaid, not crossed off, not skipped.
  const blockFrom = Math.floor((today.getDate() - 1) / 7) * 7 + 1;
  const weekStart = new Date(today.getFullYear(), today.getMonth(), blockFrom);
  const weekEnd = new Date(today.getFullYear(), today.getMonth(), Math.min(blockFrom + 6, monthEnd.getDate()));
  const weekLeft = (kinds: string[]) =>
    monthDues
      .filter(d => kinds.includes(d.bill.kind || 'bill') && !d.skipped && !paidAt[d.key] && fromDayKey(d.due) >= weekStart && fromDayKey(d.due) <= weekEnd)
      .reduce((s, d) => s + (d.bill.amount || 0), 0);
  const OUT_KINDS = ['bill', 'card', 'paylater', 'sub'];
  const TABS: Array<{ id: TabId; tone: Tone; label: string; figure: string }> = [
    { id: 'flow', tone: 'due', label: `This week · ${monthName}`, figure: overdue.length ? `${overdue.length} overdue · ${money(dueWeek)}` : money(dueWeek) },
    { id: 'accounts', tone: 'cash', label: 'Accounts & cards', figure: model.cashOnHand?.text ? `${model.cashOnHand.text} on hand` : '' },
    { id: 'spend', tone: 'sub', label: 'Bills & spending', figure: `${billsLeft} bills left` },
    { id: 'plan', tone: 'plan', label: 'Plan', figure: livePlan ? livePlan.title : 'New' },
    { id: 'owed', tone: 'owed', label: 'What I owe', figure: money(owedSum) },
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
          <button type="button" className="mny-flow-step tone-due is-link" onClick={() => go('flow', () => setFlowView('week'))}>
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
            <button type="button" className="mny-mini tone-due" onClick={() => go('flow', () => setFlowView('month'))}>
              <span>Rest of {today.toLocaleDateString([], { month: 'long' })}</span>
              <b>{money(sum(restOfMonth))}</b>
            </button>
            <button type="button" className="mny-mini tone-card" onClick={() => go('accounts', () => setAcctView('cards'))}>
              <span>Cards</span>
              <b>{model.cards?.total?.[1]?.text || '—'}</b>
              {cardsUsed !== undefined ? <small>{cardsUsed}% used</small> : null}
            </button>
            <button type="button" className="mny-mini tone-due" onClick={() => go('spend', () => setSpendView('paylater'))}>
              <span>Pay later</span>
              <b>{pay?.total?.[1]?.text || '—'}</b>
            </button>
            <button type="button" className="mny-mini tone-owed" onClick={() => setTab('owed')}>
              <span>Owed elsewhere</span>
              <b>{money(owedSum)}</b>
            </button>
            {fico ? (
              <button type="button" className="mny-mini tone-card" onClick={() => go('accounts', () => setAcctView('cards'))}>
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
        {tab === 'flow' ? <SubTabs label="Week or month" value={flowView} onChange={setFlowView} options={[['week', 'Week', overdue.length ? `${overdue.length} overdue` : money(dueWeek)], ['month', monthName, `${monthPaid} of ${monthCount} paid`]]} /> : null}
        {tab === 'accounts' ? (
          <SubTabs
            label="Accounts"
            value={acctView}
            onChange={setAcctView}
            options={[['checking', 'Checking', model.accounts?.total?.[1]?.text], ['savings', 'Savings', model.accounts?.total?.[2]?.text], ['cards', 'Credit Cards', model.cards?.total?.[1]?.text ? `${model.cards.total[1].text} owed` : '']]}
          />
        ) : null}
        {tab === 'spend' ? (
          <SubTabs
            label="Spending"
            value={spendView}
            onChange={setSpendView}
            options={[['out', 'Outgoing', `${money(weekLeft(OUT_KINDS))} this wk`], ['bills', 'Bills', `${billsLeft} left`], ['paylater', 'Pay Later', pay?.total?.[1]?.text || ''], ['subs', 'Subscriptions', `${money(subsMonthly)}/mo`], ['shop', 'Shopping', `${neededNow.length + (openNeeded?.rows.length || 0)} needed`]]}
          />
        ) : null}
        {tab === 'flow' && flowView === 'week' ? (
          <div className="mny-cols">
            <div className="mny-stack">
              <Section
                tone="due"
                title="This week"
                hint="Overdue = past its day and not marked paid. Tap Paid when it’s done. Tap a day to fold it. Change skips or moves one payment."
                figure={money(dueWeek + sum(overdue))}
                figureLabel={`${next7.length} payments${overdue.length ? ` · ${overdue.length} overdue` : ''}`}
              >
                <DueList dues={dues} onPaid={onPaid} by="day" days={7} overdue={overdue} incoming={incoming} />
              </Section>
            </div>
            <div className="mny-stack">
              <Section tone="cash" title="Money right now" figure={model.cashOnHand?.text} figureLabel="on hand" href={link('Randy')}>
                <AccountsList model={model} onSave={save} />
              </Section>
              <Section tone="cash" title="Incoming funds" hint="Logged on Life Hub and synced to your other devices — not written to the sheet.">
                <IncomeSection list={incomeList} upcoming={incoming} />
              </Section>
              <Section tone="plan" title="Your plan" hint={livePlan ? `Open: ${livePlan.title}` : 'No plan yet for the coming days.'}>
                <button type="button" className="mny-cta" onClick={() => setTab('plan')}>
                  {livePlan ? 'Open the plan →' : 'Make a plan →'}
                </button>
              </Section>
            </div>
          </div>
        ) : null}

        {tab === 'flow' && flowView === 'month' ? (
          <div className="mny-stack">
            <Section tone="due" title={`${today.toLocaleDateString([], { month: 'long' })} at a glance`} figure={`${monthPaid} of ${monthCount}`} figureLabel="paid" href={link('Randy')}>
              <MonthView dues={monthDues} paidAt={paidAt} model={model} onPaid={onPaid} />
            </Section>
            <Section tone="cash" title={`Incoming in ${monthName}`} figure={money(incoming.filter(d => fromDayKey(d.due) <= monthEnd).reduce((s, d) => s + (d.item.amount || 0), 0))} figureLabel="still to come">
              {incoming.filter(d => fromDayKey(d.due) <= monthEnd).length ? (
                <div className="mny-due">
                  <div className="mny-due-group">
                    <ul>
                      {incoming
                        .filter(d => fromDayKey(d.due) <= monthEnd)
                        .map(d => (
                          <IncomingRow key={d.key} d={d} showDay />
                        ))}
                    </ul>
                  </div>
                </div>
              ) : (
                <p className="mny-empty">No incoming funds logged for the rest of the month. Log them under Week → Incoming funds.</p>
              )}
            </Section>
            <Section tone="due" title="After this month" figure={money(sum(dues.filter(d => fromDayKey(d.due) > monthEnd && d.days <= 35)))} figureLabel="next few weeks">
              <DueList dues={dues.filter(d => fromDayKey(d.due) > monthEnd)} onPaid={onPaid} by="week" days={35} incoming={incoming.filter(d => fromDayKey(d.due) > monthEnd)} />
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
            </Section>
          </div>
        ) : null}

        {tab === 'spend' && spendView === 'paylater' ? (
          <div className="mny-stack">
            <Section tone="due" title={`Pay later · ${monthName}`} hint="Affirm, Afterpay, Klarna, Zip. Nothing counts as paid until you tap Paid." figure={money(weekLeft(['paylater']))} figureLabel="left this week" href={link('Randy')}>
              <MonthView dues={monthDues} paidAt={paidAt} model={model} onPaid={onPaid} kinds={['paylater']} />
            </Section>
            <Section tone="due" title="Pay later in the sheet" figure={pay?.total?.[1]?.text} figureLabel="owed" href={link('Randy')}>
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
            </Section>
          </div>
        ) : null}

        {tab === 'accounts' && acctView === 'cards' ? (
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

        {tab === 'spend' && spendView === 'out' ? (
          <div className="mny-stack">
            <Section tone="due" title={`Outgoing · ${monthName}`} hint="Bills, card minimums, Pay Later and subscriptions together." figure={money(weekLeft(OUT_KINDS))} figureLabel="left this week" href={link('Randy')}>
              <MonthView dues={monthDues} paidAt={paidAt} model={model} onPaid={onPaid} kinds={OUT_KINDS} />
            </Section>
          </div>
        ) : null}

        {tab === 'spend' && spendView === 'bills' ? (
          <div className="mny-stack">
            <Section tone="due" title={`Bills · ${monthName}`} hint="Bills and card minimums." figure={money(weekLeft(['bill', 'card']))} figureLabel="left this week" href={link('Randy')}>
              <MonthView dues={monthDues} paidAt={paidAt} model={model} onPaid={onPaid} kinds={['bill', 'card']} />
            </Section>
            {model.bills ? (
              <Section tone="due" title="In the sheet" hint="Click any amount or date to change it in the sheet." href={link('Randy')}>
                <SheetTable table={model.bills} onSave={save} />
              </Section>
            ) : null}
          </div>
        ) : null}

        {tab === 'spend' && spendView === 'subs' ? (
          <Section tone="sub" title="Subscriptions" figure={money(weekLeft(['sub']))} figureLabel="left this week" href={link('Randy')}>
            <SubsView model={model} lifeSubs={lifeSubs} paidAt={paidAt} dues={monthDues} onSave={save} />
          </Section>
        ) : null}

        {tab === 'plan' ? (
          <Section tone="plan" title="Plan payments" hint="Pick the days, start from your cash, see what’s due, add extra payments — saved in Life Hub, not the sheet.">
            <PayPlanner dues={sheetDues} debts={debtOptions(model)} cashOnHand={model.cashOnHand?.text} balancedCash={model.balancedCash?.text} />
          </Section>
        ) : null}

        {tab === 'accounts' && acctView === 'savings' ? (
          <div className="mny-stack">
            <Section tone="save" title="Savings" figure={model.accounts?.total?.[2]?.text} figureLabel="in savings" href={link('Randy')}>
              <AccountsList model={model} onSave={save} only={2} />
              {model.savings ? (
                <Fold title="Savings funds" meta="CC/Savings Planner">
                  <SheetTable table={{ ...model.savings, header: ['Fund', ...model.savings.header.slice(1)] }} onSave={save} />
                </Fold>
              ) : null}
            </Section>
          </div>
        ) : null}

        {tab === 'accounts' && acctView === 'checking' ? (
          <div className="mny-cols">
            <div className="mny-stack">
              <Section tone="cash" title="Checking" figure={model.cashOnHand?.text} figureLabel={model.balancedCash?.text ? `on hand · ${model.balancedCash.text} balanced` : 'on hand'} href={link('Randy')}>
                <AccountsList model={model} onSave={save} only={1} />
                {model.balancing ? (
                  <Fold title="Balancing" meta="accounts + pending money → cash on hand">
                    <SheetTable table={{ ...model.balancing, header: ['Account', ...model.balancing.header.slice(1)] }} onSave={save} opts={{ sumExcept: /^(cash on hand|balanced cash|total)/i }} />
                    <BalancingAdd table={model.balancing} onSave={save} />
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

        {tab === 'spend' && spendView === 'shop' ? (
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
