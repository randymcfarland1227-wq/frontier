'use client';

import { createContext, Fragment, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { MoneySelector } from './MoneySelector';
import { isLedgerPaid, ledgerMonthRows } from '../../lib/moneyLedger';
import { PayPlanner } from './PayPlanner';
import {
  amountOf,
  balanceTwin,
  cardSummaries,
  cardUtilization,
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
import { addDays, dayKey, dayName, daysBetween, fromDayKey, money, startOfDay, startOfWeek, type BillDue } from '../../lib/schedule';
import { usePayPlans } from '../../lib/payPlans';
import { readSaved, writeSaved, STORAGE_KEYS } from '../../lib/storage';
import { isOverdue } from '../../lib/billEdits';
import { BillChangeForm, BillFlagsFields, BillPinButton, FlagBadges, billChangeText } from './BillControls';
import { addExtraCard, updateExtraCard, useExtraCards, type ExtraCard } from '../../lib/extraCards';
import { addLifeSub, updateLifeSub, type LifeSub } from '../../lib/lifeSubs';
import { addCustomItem, METHOD_LABEL, mondayOf, setBalancePicks, setPickLanded, srcKey, updatePick, useBalancePicks, type BalancePlan, type CustomItem, type PayMethod } from '../../lib/balancePicks';
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

/** onOpen: a double click opens the details instead (one click still edits). */
function EditCell({ cell, onSave, className = '', placeholder = '—', onOpen }: { cell?: Cell; onSave: Save; className?: string; placeholder?: string; onOpen?: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const clickTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);
  if (!cell) return <span className={`mcell is-empty ${className}`} />;
  const label = cell.text || placeholder;
  if (cell.formula) {
    return (
      <span
        className={`mcell is-formula${cell.struck ? ' is-struck' : ''}${onOpen ? ' is-open' : ''} ${className}`}
        title={onOpen ? 'Worked out by a formula in the sheet · double-click for details' : 'Worked out by a formula in the sheet'}
        onDoubleClick={onOpen}
      >
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
        const start = () => {
          setValue(cell.text);
          setEditing(true);
        };
        if (!onOpen) return start();
        // Wait a moment: a second click means "open the details", not "edit".
        window.clearTimeout(clickTimer.current);
        clickTimer.current = window.setTimeout(start, 240);
      }}
      onDoubleClick={() => {
        if (!onOpen) return;
        window.clearTimeout(clickTimer.current);
        onOpen();
      }}
      title={onOpen ? 'Click to change it in the sheet · double-click for details' : 'Click to change it in the sheet'}
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
  if (!open) return <button type="button" className="mny-btn" onClick={() => setOpen(true)}>+ Add an account</button>;
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
      <li className={d.skipped ? 'is-skipped' : d.days < 0 ? `is-overdue${d.bill.nonCritical ? ' is-noncritical' : ''}` : ''} style={{ '--ev': kind ? MONEY_KINDS[kind].color : '#a8632a' } as React.CSSProperties}>
        {showDay ? <span className="mny-due-day">{fromDayKey(d.due).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}</span> : null}
        <span className="mny-due-kind">{d.skipped ? 'Skipped' : kind === 'paylater' ? provider || 'Pay later' : kind ? MONEY_KINDS[kind].label : 'Bill'}</span>
        <span className="mny-due-name">
          <ItemName id={d.key}>{d.bill.name}</ItemName>
          {installment ? <small> · {installment}</small> : null}
          {changed ? <small className="mny-due-change"> · {changed}</small> : null}
          <FlagBadges d={d} />
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

/** An account amount: one click edits, a double click opens the account. */
function AcctCell({ cell, name, onSave }: { cell?: Cell; name: string; onSave: Save }) {
  const panels = useMoneyPanels();
  return <EditCell cell={cell} onSave={onSave} className="is-num" placeholder="—" onOpen={() => panels.openAccount(name)} />;
}

/** An account name that opens its panel (Accounts & cards, balancing sheet). */
function AccountName({ name }: { name: string }) {
  const panels = useMoneyPanels();
  return (
    <button type="button" className="mny-accts-name mny-item-link" onClick={() => panels.openAccount(name)} title="Account details">
      {name}
    </button>
  );
}

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
          <AccountName name={r[0].text} />
          {show(1) ? <AcctCell cell={r[1]} name={r[0].text} onSave={onSave} /> : null}
          {show(2) ? <AcctCell cell={r[2]} name={r[0].text} onSave={onSave} /> : null}
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

const payByText = (k: string) => fromDayKey(k).toLocaleDateString([], { month: 'short', day: 'numeric' });

function kindLabel(d: BillDue): string {
  const k = d.bill.kind;
  if (k === 'paylater') return (d.bill.notes || '').split(' · ')[1] || 'Pay later';
  return k ? MONEY_KINDS[k].label : 'Bill';
}

function MonthRow({ d, paidAt, onPaid, fullDate = false }: { d: BillDue; paidAt: Record<string, string>; onPaid: (d: BillDue) => void; fullDate?: boolean }) {
  const state = monthState(d, paidAt);
  const day = fromDayKey(d.due);
  const done = state === 'paid' || state === 'crossed' || state === 'charged' || state === 'skipped';
  const installment = d.bill.kind === 'paylater' ? (d.bill.notes || '').split(' · ')[2] : '';
  return (
    <li className={`mm-row is-${state}${d.bill.nonCritical ? ' is-noncritical' : ''}`} style={{ '--ev': d.bill.kind ? MONEY_KINDS[d.bill.kind].color : '#a8632a' } as React.CSSProperties}>
      <span className="mm-day" aria-label={day.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}>
        <b>{day.getDate()}</b>
        <small>{day.toLocaleDateString([], fullDate ? { month: 'short' } : { weekday: 'short' })}</small>
      </span>
      <span className="mm-kind">{kindLabel(d)}</span>
      <span className="mm-name">
        <ItemName id={d.key}>{d.bill.name}</ItemName>
        {installment ? <small> · {installment}</small> : null}
        {billChangeText(d) ? <small> · {billChangeText(d)}</small> : null}
        <FlagBadges d={d} />
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
  hidePaid = false,
}: {
  dues: BillDue[];
  paidAt: Record<string, string>;
  model: MoneyModel;
  onPaid: (d: BillDue) => void;
  /** Only these kinds (the Bills tab shows just bills) */
  kinds?: string[];
  hidePaid?: boolean;
}) {
  const today = startOfDay(new Date());
  const dues = kinds ? allDues.filter(d => kinds.includes(d.bill.kind || 'bill')) : allDues;
  const all = ledgerMonthRows(dues, model.items.filter(i => !kinds || kinds.includes(i.kind)), today);
  const counted = all.filter(d => !d.skipped);
  const total = counted.reduce((s, d) => s + (d.bill.amount || 0), 0);
  const doneList = counted.filter(d => ['paid', 'crossed', 'charged'].includes(monthState(d, paidAt)));
  const done = doneList.reduce((s, d) => s + (d.bill.amount || 0), 0);
  const late = counted.filter(d => monthState(d, paidAt) === 'late');
  const left = total - done;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const byKind = (['bill', 'card', 'paylater', 'cash', 'sub', 'plan'] as const)
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
              {hidePaid && list.every(d => isLedgerPaid(d, paidAt)) ? <li className="mny-empty">Paid items hidden.</li> : null}
              {list.filter(d => !hidePaid || !isLedgerPaid(d, paidAt)).map(d => (
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
              {used !== undefined ? <span className="cc-used">{used}% used</span> : <span className="cc-used" title="Type its limit in More Cards (Randy tab, Limit column) to include it in % used">Limit unknown</span>}
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
      <ExtraCardTiles sheetNames={cards.map(c => c.name)} />
    </ul>
  );
}

/** Cards that live on Life Hub only (not in the sheet): placeholders until the real figures arrive. */
function ExtraCardTile({ card }: { card: ExtraCard }) {
  const fields: Array<['limit' | 'balance' | 'fee', string]> = [['limit', 'Limit'], ['balance', 'Balance'], ['fee', 'Monthly fee']];
  const bal = card.balance ?? 0;
  const used = card.limit ? Math.min(100, Math.round((bal / card.limit) * 100)) : undefined;
  return (
    <li className="cc-tile">
      <div className="cc-head">
        <strong>{card.name}</strong>
        <span className="cc-used">{card.limit === undefined && card.balance === undefined && card.fee === undefined ? 'Placeholder' : used !== undefined ? `${used}% used` : 'Added here'}</span>
      </div>
      <div className="cc-bal">
        <b>{card.balance !== undefined ? money(card.balance) : '—'}</b>
        <span>{card.limit !== undefined ? `of ${money(card.limit)}` : 'limit not set'}</span>
      </div>
      <div className="cc-bar" aria-hidden="true">
        <i style={{ width: `${used ?? 0}%` }} />
        <em />
      </div>
      <div className="mny-card-detail">
        {fields.map(([k, label]) => (
          <label key={k}>
            <span>{label}</span>
            <input
              inputMode="decimal"
              defaultValue={card[k] ?? ''}
              placeholder="—"
              onBlur={e => {
                const raw = e.target.value.replace(/[$,\s]/g, '');
                const n = raw === '' ? undefined : Number(raw);
                if (n === undefined || !Number.isNaN(n)) updateExtraCard(card.id, { [k]: n });
              }}
            />
          </label>
        ))}
        <label>
          <span>Note</span>
          <input defaultValue={card.note || ''} placeholder="—" onBlur={e => updateExtraCard(card.id, { note: e.target.value.trim() || undefined })} />
        </label>
      </div>
    </li>
  );
}

/** Placeholder cards added on Life Hub; one that's now in the sheet (e.g. Atlas under "More Cards") shows once, from the sheet. */
function ExtraCardTiles({ sheetNames = [] }: { sheetNames?: string[] }) {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const cards = useExtraCards().filter(c => !sheetNames.some(n => norm(n) === norm(c.name)));
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  return (
    <>
      {cards.map(c => (
        <ExtraCardTile key={c.id} card={c} />
      ))}
      <li className="cc-tile">
        {adding ? (
          <form
            onSubmit={e => {
              e.preventDefault();
              if (!name.trim()) return;
              addExtraCard({ name });
              setName('');
              setAdding(false);
            }}
          >
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Card name" aria-label="Card name" autoFocus />
            <button type="submit" className="mny-btn is-primary">Add</button>
          </form>
        ) : (
          <button type="button" className="mny-btn" onClick={() => setAdding(true)}>+ Add a card</button>
        )}
      </li>
    </>
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

// ---------------------------------------------------------------------------
// The money "book": every bill, deposit and account as its own item with its own panel, shared by
// the balancing sheet, Upcoming, the bill lists and Accounts & cards. The balancing sheet is the
// worksheet: put items on it, then decide which account each comes out of (or goes into), how, and
// on what day — and see each account's balance line by line, week by week.
// ---------------------------------------------------------------------------

type BalanceLine = {
  key: string;
  kind: 'pay' | 'in';
  due: string;
  name: string;
  amount?: number;
  tag: string;
  group: string;
  color: string;
  /** Past its day and still unpaid */
  overdue?: boolean;
  /** Non Critical: overdue shows orange, not red */
  nonCritical?: boolean;
  /** Pay by (grace day after the due date) */
  payBy?: string;
  /** Counts toward this month's sheet (unpaid future, or overdue) */
  open: boolean;
  /** Paid on Life Hub / in the sheet (only for this month's list) */
  paid?: string;
  /** Typed in by Randy */
  custom?: boolean;
  /** Remember key for this bill / source */
  src: string;
};
/** "By type" groups on the Upcoming side, in this order. */
const OFFER_GROUPS: Array<[string, string]> = [
  ['in', 'Coming in'],
  ['bill', 'Bills'],
  ['card', 'Credit cards'],
  ['paylater', 'Pay later'],
  ['cash', 'Cash advances'],
  ['sub', 'Subscriptions'],
  ['plan', 'Planned'],
  ['custom', 'Added by you'],
];
const OFFER_VIEW_KEY = 'lifehub-balance-offer-view';
/** Upcoming "By type" groups left open (closed by default) */
const OPEN_GROUPS_KEY = 'lifehub-balance-open-groups';
const DRAG_KEY = 'text/lifehub-balance';
const shortDay = (k: string) => fromDayKey(k).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
const dayNum = (k: string) => `${fromDayKey(k).toLocaleDateString([], { weekday: 'short' })} ${fromDayKey(k).getDate()}`;
/** How a balance is typed into the sheet: $12.50 / -$48.00 */
const cellMoney = (n: number) => (n < 0 ? `-$${(-n).toFixed(2)}` : `$${n.toFixed(2)}`);
const signed = (n: number) => (n < 0 ? `−${money(-n)}` : money(n));
const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

function payLine(d: BillDue, paidAt: Record<string, string>): BalanceLine {
  return {
    key: d.key,
    kind: 'pay',
    due: d.due,
    name: d.bill.name.trim(),
    amount: d.bill.amount,
    tag: kindLabel(d),
    group: d.bill.kind || 'bill',
    color: d.bill.kind ? MONEY_KINDS[d.bill.kind].color : '#a8632a',
    overdue: d.days < 0 && !paidAt[d.key],
    nonCritical: d.bill.nonCritical,
    payBy: d.bill.payBy,
    open: !d.skipped && !paidAt[d.key] && (d.days >= 0 || isOverdue(d)),
    paid: paidAt[d.key],
    src: srcKey('pay', d.bill.name),
  };
}
function inLine(d: IncomingDue): BalanceLine {
  return { key: d.key, kind: 'in', due: d.due, name: d.item.source, amount: d.item.amount, tag: 'Coming in', group: 'in', color: '#0f766e', open: true, src: srcKey('in', d.item.source) };
}
function customLine(key: string, it: CustomItem): BalanceLine {
  return { key, kind: it.kind, due: it.due, name: it.name, amount: it.amount, tag: 'Added by you', group: 'custom', color: it.kind === 'in' ? '#0f766e' : '#7c3aed', open: true, custom: true, src: `custom:${key}` };
}

type WeekSpan = { i: number; mon: Date; sun: Date; key: string; label: string };

/** This week and every later week that starts in this month (Monday–Sunday; later weeks stop at month end). */
function monthWeeks(today: Date): WeekSpan[] {
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  const out: WeekSpan[] = [];
  for (let mon = mondayOf(today), i = 0; mon <= monthEnd; mon = addDays(mon, 7), i++) {
    const sun = i === 0 || addDays(mon, 6) <= monthEnd ? addDays(mon, 6) : monthEnd;
    out.push({ i, mon, sun, key: dayKey(mon), label: `${shortDay(dayKey(mon)).replace(/^\w+, /, '')} – ${shortDay(dayKey(sun)).replace(/^\w+, /, '')}` });
  }
  return out;
}

/** The cell an account's balance is typed in: its Balancing amount, or the Checking cell a formula there points at. */
function balanceCellOf(model: MoneyModel, row: Cell[]): Cell | undefined {
  return row[1]?.formula ? balanceTwin(model, row[1]) : row[1];
}

/** One account: its Balancing row (if any), checking + savings cells (Debit Accounts), pending. */
type BookAcct = { name: string; bal?: Cell[]; chk?: Cell; sav?: Cell; pend?: Cell; note?: string; linked: boolean };
type RegLine = BalanceLine & { acct: string; week: number; when: string; method?: PayMethod; pot: 'chk' | 'sav'; landed?: string; before: number; after: number };
type Reg = { start: number; startChk: number; startSav: number; pend: number; lines: RegLine[]; end: number; endChk: number; endSav: number };

type Book = {
  today: Date;
  todayKey: string;
  weeks: WeekSpan[];
  accounts: BookAcct[];
  acct: (name: string) => BookAcct | undefined;
  /** Account names, then '' (not chosen yet) */
  keys: string[];
  universe: BalanceLine[];
  line: (key: string) => BalanceLine | undefined;
  /** The payment behind a line (for marking it paid) */
  due: (key: string) => BillDue | undefined;
  plan: BalancePlan;
  acctOf: (l: BalanceLine) => string;
  methodOf: (l: BalanceLine) => PayMethod | undefined;
  payOnOf: (l: BalanceLine) => string | undefined;
  /** The day it moves money: its planned pay day, else its due day */
  whenOf: (l: BalanceLine) => string;
  /** Week index on this month's sheet (0 for anything earlier), −1 past the month */
  weekOf: (k: string) => number;
  /** Lines this month can hold (unpaid; overdue count as this week) */
  month: BalanceLine[];
  regs: Array<Record<string, Reg>>;
  regLine: (key: string) => RegLine | undefined;
  /** Merge of every week (the month) for one account */
  monthReg: (a: string) => Reg;
};

function useBalanceBook(model: MoneyModel | null, dues: BillDue[], monthDues: BillDue[], incoming: IncomingDue[], paidAt: Record<string, string>): Book {
  const plan = useBalancePicks();
  const today = startOfDay(new Date());
  const todayKey = dayKey(today);
  const weeks = monthWeeks(today);
  const last = weeks[weeks.length - 1];

  // Accounts: the Balancing list first, then Debit Accounts that aren't on it.
  const t = model?.balancing || null;
  const pendCol = t ? t.header.findIndex(h => /^pend/i.test(h)) : -1;
  const noteCol = t ? t.header.findIndex(h => /^note/i.test(h)) : -1;
  const balRows = (t?.rows || []).filter(r => r[0]?.text && !/^(cash on hand|balanced cash|total)/i.test(r[0].text));
  const debitRows = (model?.accounts?.rows || []).filter(r => r[0]?.text.trim());
  const accounts: BookAcct[] = balRows.map(r => {
    const d = debitRows.find(x => normName(x[0].text) === normName(r[0].text));
    return {
      name: r[0].text.trim(),
      bal: r,
      chk: model ? balanceCellOf(model, r) || r[1] : r[1],
      sav: d?.[2],
      pend: pendCol >= 0 ? r[pendCol] : undefined,
      note: noteCol >= 0 ? r[noteCol]?.text : undefined,
      linked: !!r[1]?.formula || !!d,
    };
  });
  for (const d of debitRows) {
    if (accounts.some(a => normName(a.name) === normName(d[0].text))) continue;
    accounts.push({ name: d[0].text.replace(/\s+/g, ' ').trim(), chk: d[1], sav: d[2], linked: true });
  }
  const acct = (name: string) => accounts.find(a => a.name === name) || accounts.find(a => normName(a.name) === normName(name));
  const keys = [...accounts.map(a => a.name), ''];

  // Every item: unpaid payments (any date), this month's paid ones, deposits, and Randy's own items.
  const seen = new Set<string>();
  const universe: BalanceLine[] = [];
  const push = (l: BalanceLine) => {
    if (seen.has(l.key)) return;
    seen.add(l.key);
    universe.push(l);
  };
  dues.forEach(d => push(payLine(d, paidAt)));
  monthDues.forEach(d => push(payLine(d, paidAt)));
  incoming.forEach(d => push(inLine(d)));
  for (const [k, v] of Object.entries(plan.entries)) if (k.startsWith('custom:') && v.item && v.mark === 'in') push(customLine(k, v.item));
  const line = (key: string) => universe.find(l => l.key === key);
  const due = (key: string) => dues.find(d => d.key === key) || monthDues.find(d => d.key === key);

  const acctOf = (l: BalanceLine) => {
    const a = plan.entries[l.key]?.acct || plan.remembered.get(l.src)?.acct || '';
    return a && acct(a) ? acct(a)!.name : '';
  };
  const methodOf = (l: BalanceLine) => plan.entries[l.key]?.method || plan.remembered.get(l.src)?.method;
  const payOnOf = (l: BalanceLine) => (l.kind === 'pay' ? plan.entries[l.key]?.payOn : undefined);
  const whenOf = (l: BalanceLine) => payOnOf(l) || l.due;
  const weekOf = (k: string) => {
    const d = fromDayKey(k);
    if (d < weeks[0].mon) return 0;
    if (d > last.sun) return -1;
    return weeks.findIndex(w => d >= w.mon && d <= w.sun);
  };
  const month = universe
    .filter(l => !l.paid && weekOf(whenOf(l)) >= 0 && (l.kind === 'in' ? fromDayKey(l.due) >= weeks[0].mon : l.open || !!payOnOf(l)))
    .sort((a, b) => whenOf(a).localeCompare(whenOf(b)) || (a.kind === b.kind ? 0 : a.kind === 'in' ? -1 : 1) || a.name.localeCompare(b.name));
  const onSheet = month.filter(l => plan.picks.has(l.key));

  const amt = (c?: Cell) => amountOf(c?.text || '') || 0;
  const regs: Array<Record<string, Reg>> = [];
  weeks.forEach((w, wi) => {
    const rec: Record<string, Reg> = {};
    for (const a of keys) {
      const ac = a ? acct(a) : undefined;
      const prev = wi ? regs[wi - 1][a] : undefined;
      let chk = prev ? prev.endChk : amt(ac?.chk);
      let sav = prev ? prev.endSav : amt(ac?.sav);
      const startChk = chk;
      const startSav = sav;
      const lines = onSheet
        .filter(l => weekOf(whenOf(l)) === wi && acctOf(l) === a)
        .map(l => {
          const method = methodOf(l);
          const pot: 'chk' | 'sav' = method === 'savings' && ac?.sav ? 'sav' : 'chk';
          const landed = l.kind === 'in' ? plan.landed.get(l.key) : undefined;
          const before = chk + sav;
          if (!landed) {
            const delta = (l.kind === 'in' ? 1 : -1) * (l.amount || 0);
            if (pot === 'sav') sav += delta;
            else chk += delta;
          }
          return { ...l, acct: a, week: wi, when: whenOf(l), method, pot, landed, before, after: chk + sav };
        });
      rec[a] = { start: startChk + startSav, startChk, startSav, pend: amt(ac?.pend), lines, end: chk + sav, endChk: chk, endSav: sav };
    }
    regs.push(rec);
  });
  const regLine = (key: string) => {
    for (const r of regs) for (const a of keys) {
      const hit = r[a].lines.find(l => l.key === key);
      if (hit) return hit;
    }
    return undefined;
  };
  const monthReg = (a: string): Reg => {
    const f = regs[0][a];
    const e = regs[regs.length - 1][a];
    return { ...f, lines: regs.flatMap(r => r[a].lines), end: e.end, endChk: e.endChk, endSav: e.endSav };
  };
  return { today, todayKey, weeks, accounts, acct, keys, universe, line, due, plan, acctOf, methodOf, payOnOf, whenOf, weekOf, month, regs, regLine, monthReg };
}

/**
 * On (or after) its day, incoming money on the balancing sheet is added to its account in the sheet —
 * once: it's marked landed first (synced), and the mark is cleared again if the write fails.
 */
function useIncomingLanding(model: MoneyModel | null, book: Book, save: Save) {
  const tried = useRef(new Set<string>());
  const busy = useRef(false);
  useEffect(() => {
    if (!model?.balancing || busy.current) return;
    const ready = book.universe.find(l => {
      if (l.kind !== 'in' || l.custom || l.due > book.todayKey || !l.amount) return false;
      if (!book.plan.picks.has(l.key) || book.plan.landed.has(l.key) || tried.current.has(l.key)) return false;
      const ac = book.acct(book.acctOf(l));
      const cell = book.methodOf(l) === 'savings' && ac?.sav ? ac.sav : ac?.chk;
      return !!cell && !cell.formula;
    });
    if (!ready) return;
    const ac = book.acct(book.acctOf(ready))!;
    const cell = (book.methodOf(ready) === 'savings' && ac.sav ? ac.sav : ac.chk)!;
    const next = (amountOf(cell.text) || 0) + (ready.amount || 0);
    tried.current.add(ready.key);
    busy.current = true;
    setPickLanded(ready.key, book.todayKey);
    void save([{ tab: cell.tab, r: cell.r, c: cell.c, expect: cell.text, value: cellMoney(next) }])
      .then(res => {
        if (!res.ok || !res.results[0]?.ok) setPickLanded(ready.key, null);
      })
      .finally(() => {
        busy.current = false;
      });
  }, [model, book, save]);
}

/** Open any item's panel from anywhere on the Money page. */
type PanelState = { type: 'line' | 'acct'; id: string; back?: PanelState };
const MoneyPanelCtx = createContext<{ openLine: (key: string) => void; openAccount: (name: string) => void; has: (key: string) => boolean }>({
  openLine: () => {},
  openAccount: () => {},
  has: () => false,
});
const useMoneyPanels = () => useContext(MoneyPanelCtx);

/** A bill / deposit name that opens its panel (plain text where there's no panel for it). */
function ItemName({ id, children }: { id: string; children: ReactNode }) {
  const panels = useMoneyPanels();
  if (!panels.has(id)) return <>{children}</>;
  return (
    <button type="button" className="mny-item-link" onClick={() => panels.openLine(id)} title="Details">
      {children}
    </button>
  );
}

/** An item Randy types in himself: money out or in, name, amount, day, account (optional). */
function NewItemForm({ book, onDone }: { book: Book; onDone: () => void }) {
  const [kind, setKind] = useState<'pay' | 'in'>('pay');
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [due, setDue] = useState(book.todayKey);
  const [acct, setAcct] = useState('');
  const n = amountOf(amount);
  const ok = name.trim() && n && due;
  return (
    <form
      className="bal-new"
      onSubmit={e => {
        e.preventDefault();
        if (!ok) return;
        addCustomItem({ name: name.trim(), amount: Math.abs(n!), kind, due }, acct || undefined);
        onDone();
      }}
    >
      <span className="bal-toggle" role="group" aria-label="Money out or in">
        <button type="button" className={kind === 'pay' ? 'is-on' : ''} aria-pressed={kind === 'pay'} onClick={() => setKind('pay')}>
          − Going out
        </button>
        <button type="button" className={kind === 'in' ? 'is-on' : ''} aria-pressed={kind === 'in'} onClick={() => setKind('in')}>
          + Coming in
        </button>
      </span>
      <input aria-label="What it is" placeholder={kind === 'pay' ? 'e.g. Car repair' : 'e.g. Sold jacket'} value={name} onChange={e => setName(e.target.value)} autoFocus />
      <input aria-label="Amount" inputMode="decimal" placeholder="$0.00" value={amount} onChange={e => setAmount(e.target.value)} />
      <input aria-label="Day" type="date" value={due} onChange={e => setDue(e.target.value)} />
      <select aria-label="Account" value={acct} onChange={e => setAcct(e.target.value)}>
        <option value="">Account later…</option>
        {book.accounts.map(a => (
          <option key={a.name} value={a.name}>
            {a.name}
          </option>
        ))}
      </select>
      <button type="submit" className="bal-btn is-primary" disabled={!ok}>
        Add
      </button>
      <button type="button" className="bal-btn" onClick={onDone}>
        Cancel
      </button>
    </form>
  );
}

/**
 * The balancing sheet (worksheet): an inbox of items not given an account yet, then one register per
 * account — its Now (checking + savings), then each payment / deposit line by line with the balance
 * after it. Incoming money is grey (still counted) until its day, when it's added to the account in
 * the sheet and crossed out. Pending stays pending until moved into Now. Weeks carry forward; the
 * month is every week in one register with a line between weeks.
 */
function BalancingSheet({ period, book, model, onSave, tasks }: { period: 'week' | 'month'; book: Book; model: MoneyModel; onSave: Save; tasks?: ReactNode }) {
  const panels = useMoneyPanels();
  const { weeks, regs, keys } = book;
  const [dropping, setDropping] = useState(false);
  const [adding, setAdding] = useState(false);
  const [weekIdx, setWeekIdx] = useState(0);
  const [offerView, setOfferViewState] = useState<'date' | 'type'>(() => (readSaved<string>(OFFER_VIEW_KEY, 'date') === 'type' ? 'type' : 'date'));
  const setOfferView = (v: 'date' | 'type') => {
    setOfferViewState(v);
    writeSaved(OFFER_VIEW_KEY, v);
  };
  const week = weeks[Math.min(weekIdx, weeks.length - 1)];
  const last = weeks[weeks.length - 1];
  const next = weeks[week.i + 1];
  const firstWeek = period === 'month' || week.i === 0;
  const inScope = (l: BalanceLine) => (period === 'month' ? true : book.weekOf(book.whenOf(l)) === week.i);
  // Incoming whose day has passed isn't offered: the bank balance likely has it already.
  // Upcoming shows this week (or the whole month — click the dates to switch).
  const [offerScope, setOfferScope] = useState<'week' | 'month'>('week');
  const offerMonth = period === 'month' || offerScope === 'month';
  const monthLabel = book.today.toLocaleDateString([], { month: 'long' });
  const offered = book.month.filter(l => !book.plan.picks.has(l.key) && (offerMonth || inScope(l)) && !(l.kind === 'in' && l.due < book.todayKey));
  const [openGroups, setOpenGroups] = useState<string[]>(() => readSaved<string[]>(OPEN_GROUPS_KEY, []));
  const toggleGroup = (g: string) =>
    setOpenGroups(cur => {
      const next = cur.includes(g) ? cur.filter(x => x !== g) : [...cur, g];
      writeSaved(OPEN_GROUPS_KEY, next);
      return next;
    });
  const view = (a: string): Reg => (period === 'week' ? regs[week.i][a] : book.monthReg(a));
  const tot = keys.reduce((s, a) => ({ start: s.start + view(a).start, pend: s.pend + view(a).pend, end: s.end + view(a).end }), { start: 0, pend: 0, end: 0 });
  const shown = keys.flatMap(a => view(a).lines);
  const add = (ks: string[]) => setBalancePicks(ks, true);

  const amountCell = (ac: BookAcct, v: Reg) => {
    if (!firstWeek)
      return (
        <button type="button" className="bal-num is-now bal-open" onClick={() => panels.openAccount(ac.name)} title="Details">
          {signed(v.start)}
        </button>
      );
    if (!ac.sav?.text.trim()) return <EditCell cell={ac.chk} onSave={onSave} className="bal-num is-now" onOpen={() => panels.openAccount(ac.name)} />;
    return (
      <span className="bal-num is-now bal-split">
        <EditCell cell={ac.chk} onSave={onSave} className="is-now" onOpen={() => panels.openAccount(ac.name)} />
        <small>
          + sav <EditCell cell={ac.sav} onSave={onSave} className="is-now" onOpen={() => panels.openAccount(ac.name)} />
        </small>
      </span>
    );
  };

  return (
    <div className="bal">
      <section
        className={`bal-sheet${dropping ? ' is-drop' : ''}`}
        aria-label="Balancing sheet"
        onDragOver={e => {
          if (!e.dataTransfer.types.includes(DRAG_KEY)) return;
          e.preventDefault();
          setDropping(true);
        }}
        onDragLeave={() => setDropping(false)}
        onDrop={e => {
          const key = e.dataTransfer.getData(DRAG_KEY);
          setDropping(false);
          if (key) add([key]);
        }}
      >
        <header className="bal-head">
          <h3>Balancing sheet</h3>
          {period === 'week' ? (
            <span className="bal-weeknav" role="group" aria-label="Week">
              <button type="button" disabled={week.i === 0} onClick={() => setWeekIdx(week.i - 1)} aria-label="Previous week">
                ‹
              </button>
              <b>{week.label}</b>
              {week.i === 0 ? <i>This week</i> : <i>Week {week.i + 1} of {weeks.length}</i>}
              <button type="button" disabled={!next} onClick={() => setWeekIdx(week.i + 1)} aria-label="Next week">
                ›
              </button>
            </span>
          ) : (
            <span>
              {weeks.length} weeks · {weeks[0].label.split(' – ')[0]} – {last.label.split(' – ')[1]}
            </span>
          )}
          {model.sheetUrl ? (
            <a className="bal-link" href={sheetLink(model, 'Randy')} target="_blank" rel="noopener noreferrer">
              Sheet ↗
            </a>
          ) : null}
        </header>
        <p className="bal-group-name">
          {firstWeek ? 'Click an amount to change it · double-click it, or click any item, for its details' : 'Each account starts where last week ended · pending stays pending until you move it into Now'}
        </p>

        {(() => {
          // A plain balance sheet: credits (each account's Now + Pending on one row, then money coming in,
          // grey but counted), then outgoing as negative lines, then credits − outgoing = balanced.
          const byWhen = (a: RegLine, b: RegLine) => a.when.localeCompare(b.when) || a.name.localeCompare(b.name);
          const ins = shown.filter(l => l.kind === 'in').sort(byWhen);
          const outs = shown.filter(l => l.kind === 'pay').sort(byWhen);
          const credits = book.accounts.filter(ac => ac.bal || view(ac.name).start);
          const itemRow = (l: RegLine) => (
            <button
              key={l.key}
              type="button"
              className={`bal-led-row is-item is-${l.kind}${l.kind === 'in' && !l.landed ? ' is-coming' : ''}${l.landed ? ' is-landed' : ''}${l.overdue ? ` is-overdue${l.nonCritical ? ' is-noncritical' : ''}` : ''}`}
              style={{ '--ev': l.color } as React.CSSProperties}
              onClick={() => panels.openLine(l.key)}
              title="Details"
            >
              <span className="bal-led-name">
                {l.name}
                <small>
                  {l.overdue && !book.payOnOf(l) ? <b className="bal-late">Late</b> : null}
                  {l.tag}
                  {l.payBy ? <i className="mny-flag is-payby">Pay by {payByText(l.payBy)}</i> : null}
                  {l.acct ? (
                    <>
                      {' · '}
                      {l.kind === 'in' ? 'into' : 'from'} {l.acct}
                    </>
                  ) : (
                    <em className="bal-need">Choose account</em>
                  )}
                </small>
              </span>
              <span className={`bal-led-amt ${l.kind === 'in' ? 'is-inc' : 'is-out'}`}>{l.amount === undefined ? '?' : `${l.kind === 'in' ? '+' : '−'}${money(l.amount)}`}</span>
              <span />
            </button>
          );
          return (
            <div className="bal-led">
              <div className="bal-led-row is-head">
                <span>Checking &amp; money sources</span>
                <span className="is-num">{firstWeek ? 'Now' : 'Start'}</span>
                <span className="is-num">Pending</span>
              </div>
              {credits.map(ac => {
                const v = view(ac.name);
                return (
                  <div key={ac.name} className="bal-led-row is-acct">
                    <span className="bal-led-name bal-acct">
                      <button type="button" className="bal-acct-name" onClick={() => panels.openAccount(ac.name)} title="Its outgoing, incoming and end of week">
                        {ac.name}
                        {ac.note ? <small>{ac.note}</small> : null}
                      </button>
                      {ac.bal && firstWeek && !ac.bal.some(c => c.formula) ? (
                        <button
                          type="button"
                          className="bal-del"
                          title="Remove this line from the sheet"
                          aria-label={`Remove ${ac.name} from the balancing sheet`}
                          onClick={() => {
                            const row = ac.bal!;
                            if (!window.confirm(`Remove “${ac.name}” from the Balancing list in your sheet?\n\nOnly this line goes; the rest moves up and the totals update.`)) return;
                            void onSave([{ tab: row[0].tab, deleteBalancing: true, r: row[0].r, startCol: row[0].c, expectRow: row.map(c => c.text) }]);
                          }}
                        >
                          ✕
                        </button>
                      ) : null}
                    </span>
                    {amountCell(ac, v)}
                    {firstWeek && ac.pend ? (
                      <EditCell cell={ac.pend} onSave={onSave} className="bal-num is-pend" placeholder="" onOpen={() => panels.openAccount(ac.name)} />
                    ) : (
                      <span className="bal-num is-pend">{v.pend ? money(v.pend) : ''}</span>
                    )}
                  </div>
                );
              })}
              {ins.map(itemRow)}
              {outs.map(itemRow)}
              <div className={`bal-led-row is-balanced${tot.end < 0 ? ' is-short' : ''}`}>
                <span>
                  Balanced
                  <small>money sources + coming in − outgoing{period === 'week' && next ? ` · carries into ${next.label}` : ''}</small>
                </span>
                <span className={`bal-num${tot.end < 0 ? ' is-neg' : ''}`}>{signed(tot.end)}</span>
                <span className="bal-num is-pend">
                  {tot.pend ? (
                    <>
                      {signed(tot.end + tot.pend)}
                      <small>with pending</small>
                    </>
                  ) : null}
                </span>
              </div>
            </div>
          );
        })()}
        <div className="bal-adds">
          {adding ? (
            <NewItemForm book={book} onDone={() => setAdding(false)} />
          ) : (
            <button type="button" className="mny-btn" onClick={() => setAdding(true)}>
              + New item (not in Upcoming)
            </button>
          )}
          {firstWeek && model.balancing && !adding ? <BalancingAdd table={model.balancing} onSave={onSave} /> : null}
        </div>
      </section>

      <div className="bal-side">
      {tasks ? <section className="mny-tasks" aria-label="Finance tasks">{tasks}</section> : null}
      <aside className="bal-offer" aria-label="Upcoming — add to the sheet">
        <header className="bal-head">
          <h3>Upcoming</h3>
          {period === 'week' ? (
            <button type="button" className="bal-scope" onClick={() => setOfferScope(offerMonth ? 'week' : 'month')} title={offerMonth ? 'Show just this week' : `Show all of ${monthLabel}`}>
              {offerMonth ? `All of ${monthLabel}` : week.label} · unpaid <i>⇄</i>
            </button>
          ) : (
            <span>through the month · unpaid</span>
          )}
          <span className="bal-toggle" role="group" aria-label="Sort upcoming">
            {(['date', 'type'] as const).map(v => (
              <button key={v} type="button" className={offerView === v ? 'is-on' : ''} aria-pressed={offerView === v} onClick={() => setOfferView(v)}>
                {v === 'date' ? 'By date' : 'By type'}
              </button>
            ))}
          </span>
          {offered.length && !offerMonth ? (
            <button type="button" className="bal-link" onClick={() => add(offered.map(l => l.key))}>
              Add all
            </button>
          ) : null}
        </header>
        {(() => {
          const offerRow = (l: BalanceLine) => (
            <li
              key={l.key}
              className={`bal-line is-${l.kind}${l.overdue ? ` is-overdue${l.nonCritical ? ' is-noncritical' : ''}` : ''}`}
              style={{ '--ev': l.color } as React.CSSProperties}
              draggable
              onDragStart={e => {
                e.dataTransfer.setData(DRAG_KEY, l.key);
                e.dataTransfer.effectAllowed = 'copy';
              }}
            >
              <span className="bal-day">{l.overdue ? 'Late' : shortDay(l.due).replace(/,.*/, '')}</span>
              <button type="button" className="bal-name bal-name-btn" onClick={() => panels.openLine(l.key)} title="Details">
                {l.name}
                <small>
                  {l.tag}
                  {l.overdue ? ` · was due ${shortDay(l.due)}` : ` · ${shortDay(l.due)}`}
                  {l.payBy ? <i className="mny-flag is-payby">Pay by {payByText(l.payBy)}</i> : null}
                </small>
              </button>
              <span className={`bal-amt${l.kind === 'in' ? ' is-in' : ''}`}>{l.amount === undefined ? '?' : `${l.kind === 'in' ? '+' : '−'}${money(l.amount)}`}</span>
              <button type="button" className="bal-add" onClick={() => add([l.key])} aria-label={`Add ${l.name} to the balancing sheet`}>
                + Add
              </button>
            </li>
          );
          if (!offered.length) return <p className="mny-empty">Everything {offerMonth ? 'this month' : 'this week'} is on the sheet or paid.</p>;
          if (offerView === 'type')
            return (
              <div className="bal-types">
                {OFFER_GROUPS.map(([g, label]) => {
                  const list = offered.filter(l => l.group === g);
                  if (!list.length) return null;
                  const total = list.reduce((sum, l) => sum + (l.amount || 0), 0);
                  const isOpen = openGroups.includes(g);
                  return (
                    <div key={g} className={`bal-type${isOpen ? ' is-open' : ''}`}>
                      <p className="bal-type-head">
                        <button type="button" className="bal-type-toggle" aria-expanded={isOpen} onClick={() => toggleGroup(g)}>
                          <i aria-hidden="true">{isOpen ? '▾' : '▸'}</i>
                          <b>{label}</b> <span>{list.length}</span>
                          <em>
                            {g === 'in' ? '+' : '−'}
                            {money(total)}
                          </em>
                        </button>
                        <button type="button" className="bal-link" onClick={() => add(list.map(l => l.key))}>
                          Add all
                        </button>
                      </p>
                      {isOpen ? <ul className="bal-lines">{list.map(offerRow)}</ul> : null}
                    </div>
                  );
                })}
              </div>
            );
          if (!offerMonth) return <ul className="bal-lines">{offered.map(offerRow)}</ul>;
          return (
            <ul className="bal-lines">
              {weeks.map(w => {
                const items = offered.filter(l => book.weekOf(book.whenOf(l)) === w.i);
                if (!items.length) return null;
                return (
                  <Fragment key={w.key}>
                    <li className="bal-wk">
                      <span>{w.i === 0 ? 'This week' : w.label}</span>
                    </li>
                    {items.map(offerRow)}
                  </Fragment>
                );
              })}
            </ul>
          );
        })()}
      </aside>
      </div>
    </div>
  );
}

function Modal({ label, onClose, onBack, children }: { label: string; onClose: () => void; onBack?: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="bal-dlg-backdrop" onClick={onClose}>
      <div className="bal-dlg" role="dialog" aria-modal="true" aria-label={label} onClick={e => e.stopPropagation()}>
        {onBack ? (
          <button type="button" className="bal-dlg-back" onClick={onBack}>
            ‹ Back
          </button>
        ) : null}
        <button type="button" className="bal-dlg-x" onClick={onClose} aria-label="Close">
          ✕
        </button>
        {children}
      </div>
    </div>
  );
}

const daysText = (days: number, kind: 'pay' | 'in') =>
  days === 0 ? 'Today' : days > 0 ? `${days} day${days === 1 ? '' : 's'}` : `${-days} day${days === -1 ? '' : 's'} ${kind === 'in' ? 'ago' : 'late'}`;

/**
 * One bill / deposit as its own item: amount, due day, days to go, the day you plan to pay it, the
 * account and how — plus its effect on that account and its other dates.
 */
function LinePanel({
  id,
  book,
  model,
  onSave,
  onPaid,
  onBack,
  onClose,
}: {
  id: string;
  book: Book;
  model: MoneyModel;
  onSave: Save;
  onPaid: (d: BillDue) => void;
  onBack?: () => void;
  onClose: () => void;
}) {
  const panels = useMoneyPanels();
  const [paying, setPaying] = useState(false);
  const l = book.line(id);
  if (!l)
    return (
      <Modal label="Item" onClose={onClose} onBack={onBack}>
        <h3>Not found</h3>
        <p className="mny-empty">This item isn’t in Life Hub’s list any more (paid, removed or past its window).</p>
      </Modal>
    );
  const isIn = l.kind === 'in';
  const pick = book.plan.entries[l.key];
  const onSheet = book.plan.picks.has(l.key);
  const acctName = book.acctOf(l);
  const ac = acctName ? book.acct(acctName) : undefined;
  const method = book.methodOf(l);
  const payOn = book.payOnOf(l);
  const reg = book.regLine(l.key);
  const days = daysBetween(book.today, fromDayKey(l.due));
  const payDays = payOn ? daysBetween(book.today, fromDayKey(payOn)) : undefined;
  const planned = onSheet && !!acctName && (isIn || !!payOn);
  const set = (patch: Parameters<typeof updatePick>[1]) => updatePick(l.key, { mark: 'in', ...patch }, l.custom ? undefined : l.src);
  const others = book.universe
    .filter(x => x.src === l.src && x.key !== l.key && !x.paid && x.due >= book.todayKey)
    .sort((a, b) => a.due.localeCompare(b.due))
    .slice(0, 4);
  // Pay (or receive) it now: the account's balance changes in the sheet, it's marked paid everywhere
  // on Life Hub, and it leaves the balancing sheet.
  const potCell = ac ? (method === 'savings' && ac.sav ? ac.sav : ac.chk) : undefined;
  const canWrite = !!potCell && !potCell.formula && l.amount !== undefined;
  const nowAmt = amountOf(potCell?.text || '') || 0;
  const afterAmt = nowAmt + (isIn ? 1 : -1) * (l.amount || 0);
  const pay = async () => {
    const what = isIn ? `Mark ${l.name} received` : `Pay ${l.name}`;
    const msg = canWrite
      ? `${what}${l.amount !== undefined ? ` (${money(l.amount)})` : ''}?\n\n${acctName}${method === 'savings' ? ' savings' : ''} goes ${money(nowAmt)} → ${signed(afterAmt)} in your sheet, ${isIn ? 'it' : 'it’s marked paid everywhere on Life Hub and'} comes off the balancing sheet.`
      : `${what}?\n\nNo account${acctName ? ' amount Life Hub can change' : ' chosen'}, so no balance changes — ${isIn ? 'it' : 'it’s marked paid everywhere on Life Hub and'} comes off the balancing sheet.`;
    if (!window.confirm(msg)) return;
    setPaying(true);
    if (canWrite) {
      const res = await onSave([{ tab: potCell!.tab, r: potCell!.r, c: potCell!.c, expect: potCell!.text, value: cellMoney(afterAmt) }]);
      if (!res.ok || !res.results[0]?.ok) {
        setPaying(false);
        return;
      }
    }
    if (isIn) setPickLanded(l.key, book.todayKey);
    else {
      const d = book.due(l.key);
      if (d) onPaid(d);
    }
    setBalancePicks([l.key], false);
    setPaying(false);
    onClose();
  };
  const methods: PayMethod[] = isIn ? ['ach', ...(ac?.sav ? (['savings'] as const) : [])] : ['debit', 'ach', ...(ac?.sav ? (['savings'] as const) : [])];
  return (
    <Modal label={`${l.name} details`} onClose={onClose} onBack={onBack}>
      <div className="bal-drw-head">
        <p className="section-label">{isIn ? 'Money coming in' : l.tag}</p>
        <h3>{l.name}</h3>
        <p className="bal-drw-chips">
          {l.paid ? <span className="is-ok">Paid ✓</span> : planned ? <span className="is-ok">Planned</span> : onSheet ? <span className="is-pend">{acctName ? 'Needs a pay day' : 'Needs an account'}</span> : <span>Not planned</span>}
          {l.overdue ? <span className={l.nonCritical ? 'is-pend' : 'is-short'}>{l.nonCritical ? 'Overdue · non critical' : 'Overdue'}</span> : null}
          {l.payBy ? <span className="is-pend">Pay by {payByText(l.payBy)}</span> : null}
          {reg?.landed ? <span className="is-ok">Added to {acctName} ✓</span> : null}
          {onSheet ? <span>On the balancing sheet</span> : null}
        </p>
      </div>

      <div className="bal-drw-tiles">
        <div className={isIn ? 'is-in' : 'is-out'}>
          <span>Amount</span>
          <b>{l.amount === undefined ? '?' : `${isIn ? '+' : '−'}${money(l.amount)}`}</b>
        </div>
        <div>
          <span>{isIn ? 'Paid on' : 'Due'}</span>
          <b>{shortDay(l.due).replace(/^\w+, /, '')}</b>
          <small>{fromDayKey(l.due).toLocaleDateString([], { weekday: 'long' })}</small>
        </div>
        <div className={l.overdue ? (l.nonCritical ? 'is-end is-noncritical' : 'is-end is-neg') : ''}>
          <span>{days < 0 ? (isIn ? 'Since' : 'Late') : 'Days left'}</span>
          <b>{daysText(days, l.kind)}</b>
        </div>
        {!isIn ? (
          <div className={payOn ? 'is-now' : ''}>
            <span>Pay on</span>
            <b>{payOn ? shortDay(payOn).replace(/^\w+, /, '') : '—'}</b>
            <small>{payOn ? daysText(payDays!, 'pay') : 'not set'}</small>
          </div>
        ) : null}
        <div className={acctName ? 'is-now' : ''}>
          <span>{isIn ? 'Into' : 'From'}</span>
          <b>{acctName || '—'}</b>
          <small>{method ? METHOD_LABEL[method] : acctName ? '' : 'not set'}</small>
        </div>
      </div>

      {!l.paid && !reg?.landed ? (
        <div className="bal-pay">
          <button type="button" className="bal-btn is-pay" disabled={paying} onClick={() => void pay()}>
            {paying ? 'Saving…' : isIn ? `Mark received${acctName ? ` into ${acctName}` : ''}` : `Pay${l.amount !== undefined ? ` ${money(l.amount)}` : ''}${acctName ? ` from ${acctName}` : ''}`}
          </button>
          <small>
            {canWrite
              ? `${acctName}${method === 'savings' ? ' savings' : ''} ${money(nowAmt)} → ${signed(afterAmt)} in your sheet · ${isIn ? 'comes off the sheet' : 'marked paid everywhere'}`
              : acctName
                ? 'Marks it paid; this account’s amount isn’t one Life Hub can change'
                : 'No account chosen — marks it paid without changing a balance'}
          </small>
        </div>
      ) : null}

      {!isIn && book.due(l.key) ? (
        <section className="bal-drw-sec">
          <h4>Flags</h4>
          <BillFlagsFields due={book.due(l.key)!} />
        </section>
      ) : null}

      <section className="bal-drw-sec">
        <h4>Plan</h4>
        <div className="bal-form">
          {!isIn ? (
            <label>
              <span>Pay on</span>
              <span className="bal-form-row">
                <input type="date" value={payOn || ''} onChange={e => set({ payOn: e.target.value || undefined })} />
                {payOn !== l.due ? (
                  <button type="button" className="bal-btn" onClick={() => set({ payOn: l.due })}>
                    Due day
                  </button>
                ) : null}
                {payOn ? (
                  <button type="button" className="bal-btn" onClick={() => updatePick(l.key, { payOn: undefined })}>
                    Clear
                  </button>
                ) : null}
              </span>
            </label>
          ) : null}
          <label>
            <span>{isIn ? 'Paid into' : 'Paid from'}</span>
            <select className={`bal-from${acctName ? '' : ' is-unset'}`} value={acctName} onChange={e => set({ acct: e.target.value || undefined })}>
              <option value="">Choose an account…</option>
              {book.accounts.map(a => (
                <option key={a.name} value={a.name}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          {acctName ? (
            <label>
              <span>How</span>
              <select className={`bal-from${method ? '' : ' is-unset'}`} value={method || ''} onChange={e => set({ method: (e.target.value || undefined) as PayMethod | undefined })}>
                <option value="">Not set</option>
                {methods.map(m => (
                  <option key={m} value={m}>
                    {isIn ? (m === 'savings' ? 'Into savings' : 'Into checking') : m === 'debit' ? 'Debit card — leaves right away' : m === 'ach' ? 'From checking — 1–3 days to clear' : 'From savings'}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <p className="bal-form-note">
            {l.custom ? 'Added by you.' : `The account and how are remembered for ${l.name}’s other dates.`}
            {method === 'ach' && !isIn ? ' Checking transfers take 1–3 days, so your bank balance can still show this money after you pay.' : ''}
            {isIn && !reg?.landed && acctName ? ` On ${shortDay(l.due)}, Life Hub adds ${l.amount ? money(l.amount) : 'it'} to ${acctName} in your sheet once and crosses it out.` : ''}
          </p>
        </div>
        <div className="bal-form-row">
          {onSheet ? (
            <button type="button" className="bal-btn is-quiet" onClick={() => setBalancePicks([l.key], false)}>
              {l.custom ? 'Delete this item' : 'Take off the balancing sheet'}
            </button>
          ) : (
            <button type="button" className="bal-btn is-primary" onClick={() => setBalancePicks([l.key], true)}>
              Add to the balancing sheet
            </button>
          )}
        </div>
      </section>

      {reg && reg.acct ? (
        <section className="bal-drw-sec">
          <h4>Effect on {reg.acct}</h4>
          <p className="bal-drw-effect">
            {reg.landed ? (
              <>Already in its Now amount (added {shortDay(reg.landed)}).</>
            ) : (
              <>
                {signed(reg.before)} → <b className={reg.after < 0 ? 'is-neg' : ''}>{signed(reg.after)}</b> on {shortDay(reg.when)}
                {reg.pot === 'sav' ? ' · from savings' : ''} · week of {book.weeks[reg.week].label}
              </>
            )}
          </p>
          <button type="button" className="bal-link" onClick={() => panels.openAccount(reg.acct)}>
            Open {reg.acct} ›
          </button>
        </section>
      ) : null}

      {others.length ? (
        <section className="bal-drw-sec">
          <h4>Other dates</h4>
          <ul className="bal-drw-others">
            {others.map(o => {
              const oPlanned = book.plan.picks.has(o.key) && book.acctOf(o) && (o.kind === 'in' || book.payOnOf(o));
              return (
                <li key={o.key}>
                  <button type="button" onClick={() => panels.openLine(o.key)}>
                    <span>{shortDay(o.due)}</span>
                    <b>{o.amount === undefined ? '?' : money(o.amount)}</b>
                    <em className={oPlanned ? 'is-ok' : book.plan.picks.has(o.key) ? 'is-pend' : ''}>{oPlanned ? 'Planned' : book.plan.picks.has(o.key) ? 'On the sheet' : 'Not planned'}</em>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <div className="bal-dlg-actions">
        {model.sheetUrl && !l.custom ? (
          <a className="bal-btn is-quiet-link" href={sheetLink(model, 'Randy')} target="_blank" rel="noopener noreferrer">
            Open in sheet ↗
          </a>
        ) : null}
        <button type="button" className="bal-btn is-primary" onClick={onClose}>
          Done
        </button>
      </div>
      {pick?.at ? <p className="bal-form-note">Plan last changed {new Date(pick.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</p> : null}
    </Modal>
  );
}

/**
 * One account as its own item: checking + savings (or Now), pending, and its sub-ledger — what's
 * planned to come out of it and go into it — for a week or the whole month.
 */
function AccountPanel({ name, book, model, onSave, onBack, onClose }: { name: string; book: Book; model: MoneyModel; onSave: Save; onBack?: () => void; onClose: () => void }) {
  const panels = useMoneyPanels();
  const [wi, setWi] = useState<number | 'month'>(0);
  const ac = book.acct(name);
  if (!ac)
    return (
      <Modal label="Account" onClose={onClose} onBack={onBack}>
        <h3>{name}</h3>
        <p className="mny-empty">This account isn’t in the sheet’s Balancing list or Debit Accounts.</p>
      </Modal>
    );
  const r = wi === 'month' ? book.monthReg(ac.name) : book.regs[wi][ac.name];
  const outs = r.lines.filter(l => l.kind === 'pay');
  const ins = r.lines.filter(l => l.kind === 'in');
  const out = outs.reduce((s, l) => s + (l.amount || 0), 0);
  const inn = ins.filter(l => !l.landed).reduce((s, l) => s + (l.amount || 0), 0);
  const first = wi === 0 || wi === 'month';
  const hasSav = !!ac.sav;
  const pend = amountOf(ac.pend?.text || '') || 0;
  const canMove = !!(ac.chk && ac.pend && !ac.chk.formula && !ac.pend.formula && pend > 0);
  const label = wi === 'month' ? 'this month' : wi === 0 ? 'this week' : book.weeks[wi].label;
  const lineRow = (l: RegLine) => (
    <li key={l.key}>
      <button type="button" className={`bal-rl is-${l.kind}${l.kind === 'in' && !l.landed ? ' is-coming' : ''}${l.landed ? ' is-landed' : ''}${l.overdue ? ` is-overdue${l.nonCritical ? ' is-noncritical' : ''}` : ''}`} style={{ '--ev': l.color } as React.CSSProperties} onClick={() => panels.openLine(l.key)}>
        <span className="bal-day">{dayNum(l.when)}</span>
        <span className="bal-name">
          {l.name}
          <small>
            {l.tag}
            {l.method ? ` · ${METHOD_LABEL[l.method]}` : ''}
          </small>
        </span>
        <span className={`bal-amt${l.kind === 'in' ? ' is-in' : ''}`}>{l.amount === undefined ? '?' : `${l.kind === 'in' ? '+' : '−'}${money(l.amount)}`}</span>
        <span className={`bal-after${l.after < 0 ? ' is-neg' : ''}`}>{l.landed ? 'in Now ✓' : signed(l.after)}</span>
      </button>
    </li>
  );
  return (
    <Modal label={`${ac.name} details`} onClose={onClose} onBack={onBack}>
      <div className="bal-drw-head">
        <p className="section-label">Account</p>
        <h3>{ac.name}</h3>
        <p>
          {ac.note ? `${ac.note} · ` : ''}
          {ac.bal ? 'On the balancing sheet' : 'In Debit Accounts'}
          {ac.linked ? ' · same numbers as Accounts & cards → Checking' : ''}
        </p>
        <p className="bal-drw-chips">
          <span className={r.end < 0 ? 'is-short' : 'is-ok'}>{r.end < 0 ? 'Short' : 'On track'}</span>
          {pend ? <span className="is-pend">{money(pend)} pending</span> : null}
          <span>
            {outs.length} out · {ins.length} in
          </span>
        </p>
      </div>

      <div className="bal-drw-weeks" role="group" aria-label="Period">
        {book.weeks.map(w => (
          <button key={w.key} type="button" className={wi === w.i ? 'is-on' : ''} aria-pressed={wi === w.i} onClick={() => setWi(w.i)}>
            {w.i === 0 ? 'This week' : w.label}
          </button>
        ))}
        <button type="button" className={wi === 'month' ? 'is-on' : ''} aria-pressed={wi === 'month'} onClick={() => setWi('month')}>
          Month
        </button>
      </div>

      <div className="bal-drw-tiles">
        {hasSav ? (
          <>
            <div className="is-now">
              <span>{first ? 'Checking' : 'Checking start'}</span>
              {first && ac.chk ? <EditCell cell={ac.chk} onSave={onSave} className="bal-drw-num" /> : <b>{signed(r.startChk)}</b>}
            </div>
            <div className="is-now">
              <span>{first ? 'Savings' : 'Savings start'}</span>
              {first && ac.sav ? <EditCell cell={ac.sav} onSave={onSave} className="bal-drw-num" placeholder="$0" /> : <b>{signed(r.startSav)}</b>}
            </div>
          </>
        ) : (
          <div className="is-now">
            <span>{first ? 'Now' : 'Start'}</span>
            {first && ac.chk ? <EditCell cell={ac.chk} onSave={onSave} className="bal-drw-num" /> : <b>{signed(r.start)}</b>}
          </div>
        )}
        <div className="is-pend">
          <span>Pending</span>
          {first && ac.pend ? <EditCell cell={ac.pend} onSave={onSave} className="bal-drw-num" placeholder="—" /> : <b>{pend ? money(pend) : '—'}</b>}
          <small>not counted</small>
        </div>
        <div className="is-out">
          <span>Out</span>
          <b>{out ? `−${money(out)}` : '—'}</b>
        </div>
        <div className="is-in">
          <span>In</span>
          <b>{inn ? `+${money(inn)}` : '—'}</b>
        </div>
        <div className={`is-end${r.end < 0 ? ' is-neg' : ''}`}>
          <span>{wi === 'month' ? 'End of month' : 'End of week'}</span>
          <b>{signed(r.end)}</b>
          {hasSav ? (
            <small>
              chk {signed(r.endChk)} · sav {signed(r.endSav)}
            </small>
          ) : null}
        </div>
      </div>

      <section className="bal-drw-sec">
        <h4>
          Going out · {label} <em>{out ? `−${money(out)}` : ''}</em>
        </h4>
        {outs.length ? <ol className="bal-drw-lines">{outs.map(lineRow)}</ol> : <p className="mny-empty">Nothing planned to come out of {ac.name} {label}.</p>}
      </section>
      <section className="bal-drw-sec">
        <h4>
          Coming in · {label} <em>{inn ? `+${money(inn)}` : ''}</em>
        </h4>
        {ins.length ? <ol className="bal-drw-lines">{ins.map(lineRow)}</ol> : <p className="mny-empty">Nothing planned to go into {ac.name} {label}.</p>}
      </section>

      {canMove ? (
        <section className="bal-drw-sec">
          <h4>Pending landed?</h4>
          <div className="bal-drw-move">
            <p>
              Move the {money(pend)} pending into Now: {signed(amountOf(ac.chk!.text) || 0)} → <b>{signed((amountOf(ac.chk!.text) || 0) + pend)}</b>
            </p>
            <button
              type="button"
              className="bal-btn is-primary"
              onClick={() => {
                const next = (amountOf(ac.chk!.text) || 0) + pend;
                if (!window.confirm(`Move ${money(pend)} from Pending into Now for ${ac.name}?\n\nNow becomes ${money(next)} and Pending is cleared, in your sheet.`)) return;
                void onSave([
                  { tab: ac.chk!.tab, r: ac.chk!.r, c: ac.chk!.c, expect: ac.chk!.text, value: cellMoney(next) },
                  { tab: ac.pend!.tab, r: ac.pend!.r, c: ac.pend!.c, expect: ac.pend!.text, value: '' },
                ]);
              }}
            >
              Move into Now
            </button>
          </div>
        </section>
      ) : null}

      <section className="bal-drw-sec">
        <h4>Week by week</h4>
        <table className="bal-drw-table">
          <thead>
            <tr>
              <th>Week</th>
              <th>Start</th>
              <th>In</th>
              <th>Out</th>
              <th>End</th>
            </tr>
          </thead>
          <tbody>
            {[...book.weeks.map(w => ({ id: w.i as number | 'month', label: w.i === 0 ? 'This week' : w.label, x: book.regs[w.i][ac.name] })), { id: 'month' as const, label: 'Month', x: book.monthReg(ac.name) }].map(({ id, label: lb, x }) => {
              const o = x.lines.filter(l => l.kind === 'pay').reduce((s, l) => s + (l.amount || 0), 0);
              const n = x.lines.filter(l => l.kind === 'in' && !l.landed).reduce((s, l) => s + (l.amount || 0), 0);
              return (
                <tr key={String(id)} className={`${wi === id ? 'is-on' : ''}${id === 'month' ? ' is-month' : ''}`} onClick={() => setWi(id)}>
                  <td>{lb}</td>
                  <td>{signed(x.start)}</td>
                  <td className="is-in">{n ? `+${money(n)}` : ''}</td>
                  <td className="is-out">{o ? `−${money(o)}` : ''}</td>
                  <td className={x.end < 0 ? 'is-neg' : ''}>
                    <b>{signed(x.end)}</b>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <div className="bal-dlg-actions">
        {model.sheetUrl ? (
          <a className="bal-btn is-quiet-link" href={sheetLink(model, 'Randy')} target="_blank" rel="noopener noreferrer">
            Open in sheet ↗
          </a>
        ) : null}
        <button type="button" className="bal-btn is-primary" onClick={onClose}>
          Done
        </button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Ledger by category: Bills · Credit cards · Pay later · Subscriptions — is everything paid?
// ---------------------------------------------------------------------------

const LEDGER_KINDS: Array<[string, string]> = [
  ['bill', 'Bills'],
  ['card', 'Credit card payments'],
  ['paylater', 'Pay later'],
  ['cash', 'Cash advances'],
  ['sub', 'Subscriptions'],
];

function LedgerByCategory({ dues, paidAt, model, onPaid, hidePaid }: { dues: BillDue[]; paidAt: Record<string, string>; model: MoneyModel; onPaid: (d: BillDue) => void; hidePaid: boolean }) {
  const today = startOfDay(new Date());
  const all = ledgerMonthRows(dues, model.items, today);
  return (
    <div className="ledger-cats">
      {LEDGER_KINDS.map(([kind, label]) => {
        const list = all.filter(d => (d.bill.kind || 'bill') === kind && !d.skipped).sort((a, b) => a.due.localeCompare(b.due));
        const done = list.filter(d => ['paid', 'crossed', 'charged'].includes(monthState(d, paidAt)));
        const leftAmt = list.filter(d => !done.includes(d)).reduce((s, d) => s + (d.bill.amount || 0), 0);
        const all_done = list.length > 0 && done.length === list.length;
        return (
          <section key={kind} className={`ledger-cat${all_done ? ' is-done' : ''}`} style={{ '--ev': MONEY_KINDS[kind as keyof typeof MONEY_KINDS].color } as React.CSSProperties}>
            <header>
              <h3>{label}</h3>
              <span className="ledger-cat-count">
                {all_done ? '✓ All paid' : `${done.length} of ${list.length} paid`}
              </span>
              {!all_done && leftAmt ? <span className="ledger-cat-left">{money(leftAmt)} left</span> : null}
            </header>
            <div className="ledger-cat-bar" aria-hidden="true">
              <i style={{ width: `${list.length ? (done.length / list.length) * 100 : 0}%` }} />
            </div>
            {list.length ? (
              <ul>
                {hidePaid && list.every(d => isLedgerPaid(d, paidAt)) ? <li className="mny-empty">Paid items hidden.</li> : null}
                {list.filter(d => !hidePaid || !isLedgerPaid(d, paidAt)).map(d => {
                  const st = monthState(d, paidAt);
                  const isDone = ['paid', 'crossed', 'charged'].includes(st);
                  return (
                    <li key={d.key} className={`ledger-row is-${st}${d.bill.nonCritical ? ' is-noncritical' : ''}`}>
                      <span className="ledger-day">{fromDayKey(d.due).getDate()}</span>
                      <span className="ledger-name">{d.bill.name}<FlagBadges d={d} /></span>
                      <span className="ledger-amt">{money(d.bill.amount) || '?'}</span>
                      {isDone ? (
                        <span className="ledger-state">✓</span>
                      ) : st === 'late' ? (
                        <button type="button" className="ledger-paid is-late" onClick={() => onPaid(d)} title="Past its day — mark paid">
                          Paid
                        </button>
                      ) : kind === 'sub' || kind === 'paylater' ? (
                        <span className="ledger-state is-soon">{STATE_TEXT[st](d, paidAt).replace(/^In /, '')}</span>
                      ) : (
                        <button type="button" className="ledger-paid" onClick={() => onPaid(d)}>
                          Paid
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mny-empty">None this month.</p>
            )}
          </section>
        );
      })}
    </div>
  );
}

const NEEDED_OPTIONS = ['Yes', 'Y Low', 'No', 'Ordered'];
type TabId = 'flow' | 'accounts' | 'spend' | 'plan' | 'owed' | 'save';
const TAB_IDS: TabId[] = ['flow', 'accounts', 'spend', 'plan', 'owed', 'save'];
/** Old saved tabs → the merged container they now live in */
const LEGACY_TAB: Record<string, TabId> = { week: 'flow', month: 'flow', due: 'flow', cards: 'accounts', bills: 'spend', subs: 'spend', shop: 'spend' };
const FLOW_IDS = ['week', 'month', 'ledger'] as const;
const LEDGER_IDS = ['date', 'category', 'selector'] as const;
const ACCT_IDS = ['checking', 'savings', 'cards'] as const;
const SPEND_IDS = ['out', 'bills', 'paylater', 'cash', 'subs', 'shop'] as const;
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
  financeTasks,
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
  /** The Radall Finances task card (same Done / priority / chips as on Home) */
  financeTasks?: ReactNode;
}) {
  const [note, setNote] = useState<{ text: string; tone: 'ok' | 'bad' } | null>(null);
  const [provider, setProvider] = useState('All');
  const [legacyTab] = useState(() => readSaved<string>(TAB_KEY, 'flow'));
  const [tab, setTabState] = useState<TabId>(() => (TAB_IDS.includes(legacyTab as TabId) ? (legacyTab as TabId) : LEGACY_TAB[legacyTab] || 'flow'));
  const [flowView, setFlowView] = useSavedChoice('lifehub-money-flow', FLOW_IDS, 'week', legacyTab === 'month' || legacyTab === 'due' ? 'month' : undefined);
  const [hidePaid, setHidePaid] = useState(() => readSaved<boolean>('lifehub-money-ledger-hide-paid', false));
  const [ledgerView, setLedgerView] = useSavedChoice('lifehub-money-ledger', LEDGER_IDS, 'date');
  const [acctView, setAcctView] = useSavedChoice('lifehub-money-accounts', ACCT_IDS, 'checking', legacyTab === 'cards' ? 'cards' : undefined);
  const [spendView, setSpendView] = useSavedChoice('lifehub-money-spend', SPEND_IDS, 'out', legacyTab === 'subs' ? 'subs' : legacyTab === 'shop' ? 'shop' : undefined);
  const incomeList = useIncoming();
  const incoming = useMemo(() => incomingDues(incomeList, new Date(), 0, 45), [incomeList]);
  // The balancing sheet also needs this week's past days (deposits already added to an account).
  const incomingBal = useMemo(() => incomingDues(incomeList, new Date(), 14, 45), [incomeList]);
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
    // An account balance typed in one place (Checking or the balancing sheet) is written to its twin too.
    const twins: CellEdit[] = [];
    for (const e of edits) {
      if (!('value' in e) || !model) continue;
      const twin = balanceTwin(model, e);
      if (twin && twin.text !== e.value && !edits.some(x => 'value' in x && x.r === twin.r && x.c === twin.c && x.tab === twin.tab)) {
        twins.push({ tab: twin.tab, r: twin.r, c: twin.c, expect: twin.text, value: e.value });
      }
    }
    const res = await onSave([...edits, ...twins]);
    const mainBad = res.results.slice(0, edits.length).find(r => !r.ok);
    const twinBad = res.results.slice(edits.length).some(r => !r.ok);
    if (res.ok && !mainBad && twinBad) {
      setNote({ text: 'Saved ✓ — but the matching balance in the other table changed in the sheet, so it wasn’t updated. Check Accounts & cards → Checking.', tone: 'bad' });
      return res;
    }
    const bad = mainBad;
    if (!res.ok || bad) setNote({ text: ERRORS[bad?.error || res.error || ''] || `Couldn’t save: ${bad?.error || res.error || 'unknown error'}`, tone: 'bad' });
    else setNote({ text: 'Saved to the sheet ✓', tone: 'ok' });
    return res;
  };
  // Every bill, deposit and account as its own item, with one panel system for the whole page.
  const book = useBalanceBook(model, dues, monthDues, incomingBal, paidAt);
  // Incoming money on the balancing sheet is added to its account in the sheet on its day.
  useIncomingLanding(model, book, save);
  const [panel, setPanel] = useState<PanelState | null>(null);
  const panelApi = useMemo(
    () => ({
      openLine: (key: string) => setPanel(cur => ({ type: 'line' as const, id: key, back: cur || undefined })),
      openAccount: (name: string) => setPanel(cur => ({ type: 'acct' as const, id: name, back: cur || undefined })),
      has: (key: string) => !!book.line(key),
    }),
    [book],
  );

  // Skipped ones (Change → Skip) are left out of the planner too.
  const sheetDues = useMemo(() => dues.filter(d => d.bill.kind !== 'plan' && !d.skipped), [dues]);
  const today = startOfDay(new Date());
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  // Skipped payments (Change → Skip) aren't money going out.
  const sum = (list: BillDue[]) => list.reduce((s, d) => s + (d.skipped ? 0 : d.bill.amount || 0), 0);
  // This week = Monday–Sunday (it turns over each Monday), not a rolling 7 days.
  const sunday = addDays(mondayOf(today), 6);
  const next7 = dues.filter(d => d.days >= 0 && fromDayKey(d.due) <= sunday && !d.skipped);
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
  // % used only over cards with a known limit (Atlas has none yet), so a limitless balance doesn't read as maxed out.
  const util = cardUtilization(model);
  const cardsUsed = util.used ?? (cardsOwed !== undefined && cardsAvail !== undefined && cardsOwed + cardsAvail > 0 ? Math.round((cardsOwed / (cardsOwed + cardsAvail)) * 100) : undefined);
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
  const OUT_KINDS = ['bill', 'card', 'paylater', 'cash', 'sub'];
  const TABS: Array<{ id: TabId; tone: Tone; label: string; figure: string }> = [
    { id: 'flow', tone: 'due', label: `Week · ${monthName} · Ledger`, figure: overdue.length ? `${overdue.length} overdue · ${money(dueWeek)}` : money(dueWeek) },
    { id: 'accounts', tone: 'cash', label: 'Accounts & cards', figure: model.cashOnHand?.text ? `${model.cashOnHand.text} on hand` : '' },
    { id: 'spend', tone: 'sub', label: 'Bills & spending', figure: `${billsLeft} bills left` },
    { id: 'plan', tone: 'plan', label: 'Plan', figure: livePlan ? livePlan.title : 'New' },
    { id: 'owed', tone: 'owed', label: 'What I owe', figure: money(owedSum) },
    { id: 'save', tone: 'save', label: 'Savings & move', figure: '' },
  ];

  return (
    <MoneyPanelCtx.Provider value={panelApi}>
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
            <span>Due this week</span>
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
        {tab === 'flow' ? (
          <SubTabs
            label="Week, month or ledger"
            value={flowView}
            onChange={setFlowView}
            options={[
              ['week', 'Week', overdue.length ? `${overdue.length} overdue · ${money(dueWeek)}` : money(dueWeek)],
              ['month', monthName, money(sum(restOfMonth))],
              ['ledger', 'Ledger', `${monthPaid} of ${monthCount} paid`],
            ]}
          />
        ) : null}
        {tab === 'flow' && flowView === 'ledger' ? (
          <div className="money-ledger-toolbar">
            <SubTabs label="Ledger view" value={ledgerView} onChange={setLedgerView} options={[['date', 'By date'], ['category', 'By category'], ['selector', 'Selector tool']]} />
            <button type="button" className="mny-btn" aria-pressed={hidePaid} onClick={() => { setHidePaid(!hidePaid); writeSaved('lifehub-money-ledger-hide-paid', !hidePaid); }}>{hidePaid ? 'Show paid items' : 'Hide paid items'}</button>
          </div>
        ) : null}
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
            options={[['out', 'Outgoing', `${money(weekLeft(OUT_KINDS))} this wk`], ['bills', 'Bills', `${billsLeft} left`], ['paylater', 'Pay Later', pay?.total?.[1]?.text || ''], ['cash', 'Cash Advances', `${money(weekLeft(['cash']))} this wk`], ['subs', 'Subscriptions', `${money(subsMonthly)}/mo`], ['shop', 'Shopping', `${neededNow.length + (openNeeded?.rows.length || 0)} needed`]]}
          />
        ) : null}
        {tab === 'flow' && flowView === 'week' ? (
          <div className="mny-stack">
            <BalancingSheet period="week" book={book} model={model} onSave={save} tasks={financeTasks} />
            <Section tone="cash" title="Incoming funds" hint="Log money you expect; it shows up on the right to add to the sheet. Synced, not written to the sheet.">
              <IncomeSection list={incomeList} upcoming={incoming} />
            </Section>
          </div>
        ) : null}

        {tab === 'flow' && flowView === 'month' ? (
          <div className="mny-stack">
            <BalancingSheet period="month" book={book} model={model} onSave={save} tasks={financeTasks} />
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

        {tab === 'flow' && flowView === 'ledger' && ledgerView === 'date' ? (
          <div className="mny-stack">
            <Section tone="due" title={`${monthName} ledger`} figure={`${monthPaid} of ${monthCount}`} figureLabel="paid" href={link('Randy')}>
              <MonthView dues={monthDues} paidAt={paidAt} model={model} onPaid={onPaid} hidePaid={hidePaid} />
            </Section>
            <Section tone="due" title="After this month" figure={money(sum(dues.filter(d => fromDayKey(d.due) > monthEnd && d.days <= 35)))} figureLabel="next few weeks">
              <DueList dues={dues.filter(d => fromDayKey(d.due) > monthEnd)} onPaid={onPaid} by="week" days={35} incoming={incoming.filter(d => fromDayKey(d.due) > monthEnd)} />
            </Section>
          </div>
        ) : null}

        {tab === 'flow' && flowView === 'ledger' && ledgerView === 'category' ? (
          <Section tone="due" title={`${monthName} by category`} hint="Is everything paid? Bills, card payments, pay later and subscriptions side by side." href={link('Randy')}>
            <LedgerByCategory dues={monthDues} paidAt={paidAt} model={model} onPaid={onPaid} hidePaid={hidePaid} />
          </Section>
        ) : null}

        {tab === 'flow' && flowView === 'ledger' && ledgerView === 'selector' ? (
          <Section tone="due" title="Selector tool" hint="Choose types in the order you want them listed. Each type adds all matching payments; individual additions stay grouped by type.">
            <MoneySelector dues={ledgerMonthRows([...dues, ...monthDues], model.items, today)} paidAt={paidAt} hidePaid={hidePaid}
              renderRow={d => <MonthRow key={d.key} d={d} paidAt={paidAt} onPaid={onPaid} fullDate />} />
          </Section>
        ) : null}

        {tab === 'spend' && spendView === 'cash' ? (
          <Section tone="due" title={`Cash advances · ${monthName}`} hint="Dave, MoneyLion, Cleo… from the Cash Advances block on the Randy tab. Nothing counts as paid until you tap Paid." figure={money(weekLeft(['cash']))} figureLabel="left this week" href={link('Randy')}>
            <MonthView dues={monthDues} paidAt={paidAt} model={model} onPaid={onPaid} kinds={['cash']} />
          </Section>
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
              figureLabel={[cardsUsed !== undefined ? `${cardsUsed}% used` : '', model.cards?.total?.[2]?.text ? `${model.cards.total[2].text} free` : '', util.noLimit.length ? `${util.noLimit.join(', ')}: limit unknown, not in % used` : ''].filter(Boolean).join(' · ')}
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
            <Section tone="due" title={`Outgoing · ${monthName}`} hint="Bills, card minimums, Pay Later, cash advances and subscriptions together." figure={money(weekLeft(OUT_KINDS))} figureLabel="left this week" href={link('Randy')}>
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
              {model.toPurchase ? (
                <Fold title="To purchase" meta={`${model.toPurchase.rows.filter(r => !r.some(c => c.struck)).length} open`} open>
                  <SheetTable table={model.toPurchase} onSave={save} opts={{ check: 'Bought' }} />
                </Fold>
              ) : null}
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
      {panel?.type === 'line' ? (
        <LinePanel key={panel.id} id={panel.id} book={book} model={model} onSave={save} onPaid={onPaid} onBack={panel.back ? () => setPanel(panel.back!) : undefined} onClose={() => setPanel(null)} />
      ) : panel?.type === 'acct' ? (
        <AccountPanel key={panel.id} name={panel.id} book={book} model={model} onSave={save} onBack={panel.back ? () => setPanel(panel.back!) : undefined} onClose={() => setPanel(null)} />
      ) : null}
    </MoneyPanelCtx.Provider>
  );
}
