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
import { dayName, fromDayKey, money, startOfDay, startOfWeek, type BillDue } from '../../lib/schedule';

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

function Panel({
  title,
  sub,
  href,
  className = '',
  children,
}: {
  title: string;
  sub?: ReactNode;
  href?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`mpanel glass-panel ${className}`}>
      <header className="mpanel-head">
        <h2>{title}</h2>
        {sub ? <span className="mpanel-sub">{sub}</span> : null}
        {href ? (
          <a className="mpanel-link" href={href} target="_blank" rel="noopener noreferrer">
            Sheet ↗
          </a>
        ) : null}
      </header>
      {children}
    </section>
  );
}

function Sub({ title, children, open = true, wide = false }: { title: ReactNode; children: ReactNode; open?: boolean; wide?: boolean }) {
  return (
    <details className={`msub${wide ? ' is-wide' : ''}`} open={open}>
      <summary>{title}</summary>
      {children}
    </details>
  );
}

// ---------------------------------------------------------------------------
// Coming up: every dated money item, by week, with Paid
// ---------------------------------------------------------------------------

function ComingUp({ dues, onPaid }: { dues: BillDue[]; onPaid: (d: BillDue) => void }) {
  const today = startOfDay(new Date());
  const upcoming = dues.filter(d => d.days >= 0 && d.days <= 35);
  const earlier = dues.filter(d => d.days < 0 && fromDayKey(d.due).getMonth() === today.getMonth());
  const weeks = new Map<string, BillDue[]>();
  for (const d of upcoming) {
    const wk = startOfWeek(fromDayKey(d.due)).toISOString();
    weeks.set(wk, [...(weeks.get(wk) || []), d]);
  }
  const row = (d: BillDue) => {
    const k = d.bill.kind;
    const color = k ? MONEY_KINDS[k].color : '#a8632a';
    const [, provider, installment] = (d.bill.notes || '').split(' · ');
    return (
      <li key={d.key} className={`mdue${d.days < 0 ? ' is-past' : d.days <= 2 ? ' is-near' : ''}`} style={{ '--ev': color } as React.CSSProperties}>
        <span className="mdue-day">{d.days < 0 ? fromDayKey(d.due).toLocaleDateString([], { month: 'short', day: 'numeric' }) : dayName(fromDayKey(d.due))}</span>
        <span className="mdue-tag">{k === 'paylater' ? provider || 'Pay later' : k ? MONEY_KINDS[k].label : 'Bill'}</span>
        <span className="mdue-name">
          {d.bill.name}
          {installment ? <small> {installment}</small> : null}
        </span>
        <span className="mdue-amt">{money(d.bill.amount) || '?'}</span>
        <button type="button" className="row-action ghost mdue-paid" onClick={() => onPaid(d)} aria-label={`Mark ${d.bill.name} paid`} title="Mark paid on Life Hub">
          Paid
        </button>
      </li>
    );
  };
  return (
    <>
      {[...weeks.entries()].map(([wk, list]) => {
        const start = new Date(wk);
        const total = list.reduce((s, d) => s + (d.bill.amount || 0), 0);
        const weeksOut = Math.round((start.getTime() - startOfWeek(today).getTime()) / (7 * 86_400_000));
        const label = weeksOut === 0 ? 'This week' : weeksOut === 1 ? 'Next week' : `Week of ${start.toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
        return (
          <div key={wk} className="mweek">
            <h3>
              {label} <span>{money(total)}</span>
            </h3>
            <ul className="mdue-list">{list.map(row)}</ul>
          </div>
        );
      })}
      {!upcoming.length ? <p className="sched-empty">Nothing dated in the next 5 weeks.</p> : null}
      {earlier.length ? (
        <Sub title={`Earlier this month · ${earlier.length}`} open={false}>
          <ul className="mdue-list">{earlier.map(row)}</ul>
        </Sub>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Top row: Cash | Cards | Outstanding — what you have and what you owe, at a glance
// ---------------------------------------------------------------------------

function CashCard({ model, onSave }: { model: MoneyModel; onSave: Save }) {
  const accts = model.accounts;
  return (
    <section className="mtop glass-panel" aria-label="Cash">
      <header className="mtop-head">
        <h2>Cash</h2>
      </header>
      <div className="mtop-big">
        <span>
          <small>On hand</small>
          <b>{model.cashOnHand?.text || '—'}</b>
        </span>
        <span>
          <small>Balanced</small>
          <b>{model.balancedCash?.text || '—'}</b>
        </span>
      </div>
      {accts ? (
        <ul className="mtop-list">
          <li className="mtop-list-head">
            <span>Account</span>
            <span>Checking</span>
            <span>Savings</span>
          </li>
          {accts.rows.map(r => (
            <li key={r[0].r}>
              <span className="mtop-name">{r[0].text}</span>
              <EditCell cell={r[1]} onSave={onSave} className="is-num" placeholder="—" />
              <EditCell cell={r[2]} onSave={onSave} className="is-num" placeholder="—" />
            </li>
          ))}
          {accts.total ? (
            <li className="mtop-total">
              <span>Total</span>
              <EditCell cell={accts.total[1]} onSave={onSave} className="is-num" placeholder="" />
              <EditCell cell={accts.total[2]} onSave={onSave} className="is-num" placeholder="" />
            </li>
          ) : null}
        </ul>
      ) : null}
    </section>
  );
}

function CardsCard({ model, onSave }: { model: MoneyModel; onSave: Save }) {
  const cards = cardSummaries(model);
  const [open, setOpen] = useState<string | null>(null);
  const total = model.cards?.total;
  return (
    <section className="mtop glass-panel" aria-label="Credit cards">
      <header className="mtop-head">
        <h2>Credit cards</h2>
        {total ? (
          <span className="mpanel-sub">
            {total[1]?.text} owed · {total[2]?.text} available
          </span>
        ) : null}
      </header>
      <ul className="mcards">
        {cards.map(c => {
          const isOpen = open === c.name;
          const bal = amountOf(c.balance?.text || '') || 0;
          const avail = amountOf(c.available?.text || '');
          const limit = amountOf(c.limit?.text || '') ?? (avail !== undefined ? bal + avail : undefined);
          const used = limit ? Math.min(100, Math.round((bal / limit) * 100)) : undefined;
          return (
            <li key={c.name} className={`mcard${isOpen ? ' is-open' : ''}`}>
              <button type="button" className="mcard-row" onClick={() => setOpen(isOpen ? null : c.name)} aria-expanded={isOpen}>
                <span className="mcard-name">{c.name}</span>
                <span className="mcard-bal">{c.balance?.text || '—'}</span>
                <span className="mcard-bar" aria-hidden="true">
                  <i style={{ width: `${used ?? 0}%` }} className={used !== undefined && used > 30 ? 'is-high' : ''} />
                </span>
                <span className="mcard-min">{c.min?.text && c.min.text !== '$0.00' ? `${c.min.text} min${c.minDate?.text && c.minDate.text !== 'N/a' ? ` · ${c.minDate.text}` : ''}` : ''}</span>
              </button>
              {isOpen ? (
                <div className="mcard-detail">
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
                  {c.matrix
                    ? c.matrix.header.map((h, i) =>
                        i > 0 && h && c.matrix!.row[i]?.text !== undefined && !/^bal$/i.test(h) ? (
                          <label key={h}>
                            <span>{h === 'Avi Cred' ? 'Balance (matrix)' : h}</span>
                            <EditCell cell={c.matrix!.row[i]} onSave={onSave} />
                          </label>
                        ) : null,
                      )
                    : null}
                  {used !== undefined ? <p className="mcard-used">{used}% used{limit ? ` of ${money(limit)}` : ''}</p> : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function OutstandingCard({ model, onSave }: { model: MoneyModel; onSave: Save }) {
  const t = model.outstanding;
  const total = (t?.rows || []).reduce((s, r) => s + (amountOf(r[1]?.text || '') || 0), 0);
  return (
    <section className="mtop glass-panel" aria-label="Outstanding">
      <header className="mtop-head">
        <h2>Outstanding</h2>
        <span className="mpanel-sub">{money(total)} known</span>
      </header>
      {t ? (
        <ul className="mtop-list is-two">
          {t.rows.map(r => (
            <li key={r[0].r}>
              <EditCell cell={r[0]} onSave={onSave} className="mtop-name" />
              <EditCell cell={r[1]} onSave={onSave} className="is-num" placeholder="?" />
            </li>
          ))}
        </ul>
      ) : (
        <p className="sched-empty">No Outstanding block found on the Randy tab.</p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

const NEEDED_OPTIONS = ['Yes', 'Y Low', 'No', 'Ordered'];

export function MoneyPage({
  model,
  dues,
  onPaid,
  onSave,
  onRefresh,
  syncing,
}: {
  model: MoneyModel | null;
  dues: BillDue[];
  onPaid: (d: BillDue) => void;
  onSave: (edits: CellEdit[]) => Promise<{ ok: boolean; results: EditResult[]; error?: string }>;
  onRefresh: () => void;
  syncing: boolean;
}) {
  const [note, setNote] = useState<{ text: string; tone: 'ok' | 'bad' } | null>(null);
  const [provider, setProvider] = useState('All');
  useEffect(() => {
    if (!note) return;
    const t = window.setTimeout(() => setNote(null), 6000);
    return () => window.clearTimeout(t);
  }, [note]);

  const save: Save = async edits => {
    setNote({ text: 'Saving to the sheet…', tone: 'ok' });
    const res = await onSave(edits);
    const bad = res.results.find(r => !r.ok);
    if (!res.ok || bad) setNote({ text: ERRORS[bad?.error || res.error || ''] || `Couldn’t save: ${bad?.error || res.error || 'unknown error'}`, tone: 'bad' });
    else setNote({ text: 'Saved to the sheet ✓', tone: 'ok' });
    return res;
  };

  const sheetDues = useMemo(() => dues.filter(d => d.bill.kind !== 'plan'), [dues]);
  const next7 = dues.filter(d => d.days >= 0 && d.days <= 7);
  const monthEnd = useMemo(() => {
    const t = new Date();
    return new Date(t.getFullYear(), t.getMonth() + 1, 0);
  }, []);
  const restOfMonth = dues.filter(d => d.days >= 0 && fromDayKey(d.due) <= monthEnd);
  const sum = (list: BillDue[]) => list.reduce((s, d) => s + (d.bill.amount || 0), 0);

  if (!model) {
    return (
      <div className="settings-view money-view">
        <section className="mpanel glass-panel">
          <h2>Money</h2>
          <p className="sched-empty">
            Waiting for the Radall sheet. It arrives with Google’s next sync (every 10 minutes) — or press Refresh at the top.
          </p>
        </section>
      </div>
    );
  }

  const link = (tab: string) => sheetLink(model, tab);
  const fico = model.scores.find(s => /fico/i.test(s.label))?.value;
  const pay = model.paylaterSums;
  const providers = ['All', ...new Set((model.ledger?.rows || []).map(r => r[4]?.text).filter(Boolean))];
  const today = startOfDay(new Date());
  const ledgerAhead = model.ledger
    ? {
        ...model.ledger,
        rows: model.ledger.rows.filter(r => {
          const when = r[0]?.text ? parseSheetDate(r[0].text, today) : undefined;
          return (!when || fromDayKey(when) >= today) && (provider === 'All' || r[4]?.text === provider);
        }),
      }
    : null;
  const neededNow = model.recurring
    ? { ...model.recurring, rows: model.recurring.rows.filter(r => /^(yes|y\s*low)$/i.test(r[0].text)) }
    : null;
  const struckOf = (t: Table | null, bought: boolean) => (t ? { ...t, rows: t.rows.filter(r => r.some(c => c.struck) === bought) } : null);
  const openNeeded = struckOf(model.restockNeeded, false);
  const openWants = struckOf(model.wants, false);
  const boughtRows = [...(struckOf(model.restockNeeded, true)?.rows || []), ...(struckOf(model.wants, true)?.rows || [])];
  const bought = model.wants && boughtRows.length ? { ...model.wants, key: 'bought', groups: undefined, rows: boughtRows } : null;
  const lastRow = (t: Table | null) => (t && t.rows.length ? t.rows[t.rows.length - 1][0].r : t ? undefined : undefined);
  const moveTo = (row: Cell[], target: Table | null, label: string) => {
    const after = lastRow(target);
    if (after === undefined) return null;
    return (
      <button
        type="button"
        className="row-action ghost"
        title={`Move it to ${label} in the sheet`}
        onClick={() =>
          void save([{ tab: row[0].tab, r: row[0].r, c: row[0].c, c1: row[0].c, c2: row[row.length - 1].c, expect: row[0].text, moveAfter: after }])
        }
      >
        → {label}
      </button>
    );
  };
  const monthRe = new RegExp(`^(${today.toLocaleDateString('en-US', { month: 'long' })}|${today.toLocaleDateString('en-US', { month: 'short' })})[- ]?(${today.getFullYear()})?$`, 'i');
  const isNow = (row: Cell[]) => (row.slice(0, 2).some(c => monthRe.test(c.text)) ? 'is-now' : '');

  return (
    <div className="settings-view money-view">
      <section className="mpanel glass-panel money-hero">
        <div className="money-hero-head">
          <p className="section-label">Money</p>
          <h1>Radall</h1>
          <span className="mpanel-sub">
            Sheet as of {new Date(model.refreshedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · click any
            value to change it in the sheet
          </span>
          <span className="money-hero-actions">
            <button type="button" className="row-action ghost" onClick={onRefresh} disabled={syncing}>
              {syncing ? 'Syncing…' : 'Refresh'}
            </button>
            {model.sheetUrl ? (
              <a className="row-action ghost" href={model.sheetUrl} target="_blank" rel="noopener noreferrer">
                Open sheet ↗
              </a>
            ) : null}
          </span>
        </div>
        <div className="money-stats">
          <Stat label="Due next 7 days" value={money(sum(next7))} sub={`${next7.length} payments`} tone="warn" />
          <Stat label={`Left in ${today.toLocaleDateString([], { month: 'long' })}`} value={money(sum(restOfMonth))} sub={`${restOfMonth.length} payments`} />
          <Stat label="Pay later owed" value={pay?.total?.[1]?.text} sub={pay?.total?.[3]?.text ? `${pay.total[3].text} available` : undefined} />
          {fico ? <Stat label="Credit score" value={String(Math.round(Number(fico)) || fico)} sub="FICO" /> : null}
        </div>
        {note ? (
          <p className={`money-note is-${note.tone}`} role="status">
            {note.text}
          </p>
        ) : null}
      </section>

      <div className="money-top">
        <CashCard model={model} onSave={save} />
        <CardsCard model={model} onSave={save} />
        <OutstandingCard model={model} onSave={save} />
      </div>

      <div className="money-grid">
        <Panel title="Plan payments" sub="Pick the days, see what’s due, add extra payments — saved in Life Hub, not the sheet" className="span-12">
          <PayPlanner dues={sheetDues} debts={debtOptions(model)} cashOnHand={model.cashOnHand?.text} balancedCash={model.balancedCash?.text} />
        </Panel>

        <Panel title="Coming up" sub="Bills, card mins, subscriptions, pay later, planned" className="span-4">
          <ComingUp dues={dues} onPaid={onPaid} />
        </Panel>

        <Panel title="This month" sub="Click to edit — saves to the sheet" href={link('Randy')} className="span-4">
          {model.bills ? (
            <Sub title={<>Bills <span>{model.bills.total?.[2]?.text}</span></>}>
              <SheetTable table={model.bills} onSave={save} />
            </Sub>
          ) : null}
          {model.cardMins ? (
            <Sub title={<>Card minimums <span>{model.cardMins.total?.[2]?.text}</span></>}>
              <SheetTable table={{ ...model.cardMins, header: ['Date Due', 'Card', 'Amount'] }} onSave={save} />
            </Sub>
          ) : null}
          {model.subs ? (
            <Sub title={<>Subscriptions <span>{model.subs.total?.[2]?.text}</span></>}>
              <SheetTable table={model.subs} onSave={save} opts={{ strike: { on: 'Skip', off: 'Unskip' } }} />
              {model.subsOther.length ? (
                <SheetTable
                  table={{ key: 'subsOther', title: 'Trial / paused', tab: 'Randy', header: ['Status', 'Subscription', 'Amount'], rows: model.subsOther }}
                  onSave={save}
                />
              ) : null}
            </Sub>
          ) : null}
        </Panel>

        <Panel title="Balancing" sub="Accounts plus pending money → cash on hand" href={link('Randy')} className="span-4">
          {model.balancing ? (
            <SheetTable table={{ ...model.balancing, header: ['Account', ...model.balancing.header.slice(1)] }} onSave={save} />
          ) : null}
        </Panel>

        <Panel title="Pay later" sub="Klarna, Affirm, Afterpay — add Zip rows to the Full Ledger and they show here" href={link('Paylater')} className="span-6">
          {pay ? (
            <div className="mproviders">
              {pay.rows.map(r => (
                <div key={r[0].r} className="mprovider">
                  <strong>{r[0].text.replace(/\s*sum$/i, '')}</strong>
                  <span>
                    <EditCell cell={r[1]} onSave={save} /> owed
                  </span>
                  <span className="mprovider-avail">
                    <EditCell cell={r[3]} onSave={save} /> available
                  </span>
                </div>
              ))}
            </div>
          ) : null}
          <div className="mcols mcols-wide2">
            {model.buckets ? (
              <Sub title={<>By week <span>{model.monthTotal ? `${model.monthTotal.label} ${model.monthTotal.cell.text}` : ''}</span></>}>
                <SheetTable table={model.buckets} onSave={save} />
              </Sub>
            ) : null}
            {ledgerAhead ? (
              <Sub title={<>Upcoming installments <span>{ledgerAhead.rows.length}</span></>}>
                <div className="mfilter" role="group" aria-label="Provider">
                  {providers.map(p => (
                    <button key={p} type="button" className={`layer-chip${provider === p ? ' on' : ''}`} aria-pressed={provider === p} onClick={() => setProvider(p)}>
                      {p}
                    </button>
                  ))}
                </div>
                <SheetTable table={ledgerAhead} onSave={save} opts={{ limit: 14 }} />
              </Sub>
            ) : null}
          </div>
        </Panel>

        <Panel title="Restock & purchases" sub="Tick to cross off what you bought · move between lists" href={link('Restock/Purchases')} className="span-6">
          {model.upcomingSpend.rows.length ? (
            <div className="mspend-tiles">
              {model.upcomingSpend.rows.map(([l, v]) => (
                <span key={l.r} className="mspend-tile">
                  {l.text} <b>{v.text}</b>
                </span>
              ))}
            </div>
          ) : null}
          {openNeeded ? (
            <Sub title={<>Needed purchases <span>{openNeeded.rows.length} open</span></>}>
              {openNeeded.rows.length ? (
                <SheetTable table={openNeeded} onSave={save} opts={{ check: 'Bought', hide: [0, 3, 6], actions: row => moveTo(row, model.wants, 'Wants') }} />
              ) : (
                <p className="sched-empty">Nothing open — everything here is bought.</p>
              )}
            </Sub>
          ) : null}
          {openWants ? (
            <Sub title={<>Wants <span>{openWants.rows.length} open</span></>}>
              <SheetTable table={openWants} onSave={save} opts={{ check: 'Bought', hide: [0, 3, 6], actions: row => moveTo(row, model.restockNeeded, 'Needed') }} />
            </Sub>
          ) : null}
          {model.recurring ? (
            <Sub title={<>Re-occurring restock <span>{neededNow?.rows.length || 0} needed now · set Needed? from the dropdown</span></>}>
              <SheetTable table={model.recurring} onSave={save} opts={{ hide: [3, 6], select: { col: 0, options: NEEDED_OPTIONS }, rowClass: r => (/^(yes|y\s*low)$/i.test(r[0].text) ? 'is-now' : '') }} />
            </Sub>
          ) : null}
          {bought ? (
            <Sub title={<>Bought <span>{bought.rows.length} crossed off</span></>} open={false}>
              <SheetTable table={bought} onSave={save} opts={{ check: 'Bought', hide: [0, 3, 6] }} />
            </Sub>
          ) : null}
        </Panel>

        <Panel title="What’s owed" sub="Non-credit, collections, payoff plans" href={link('Non-Credit')} className="span-12">
          <div className="mcols mcols-3">
            {model.nonCredit.map(t => (
              <Sub key={t.key} title={<>{t.title} <span>{t.total?.[t.total.length - 1]?.text}</span></>} open={t.rows.length <= 6}>
                <SheetTable table={t} onSave={save} />
              </Sub>
            ))}
            {model.collections ? (
              <Sub title="Collections / past due" wide>
                <SheetTable table={model.collections} onSave={save} />
              </Sub>
            ) : null}
            {model.payoff ? (
              <Sub title={<>Payoff priorities <span>from the CC/Savings Planner</span></>} wide>
                <SheetTable table={model.payoff} onSave={save} />
              </Sub>
            ) : null}
            {model.plans.map(t => (
              <Sub key={t.key} title={t.title} open={false}>
                <SheetTable table={t} onSave={save} opts={{ rowClass: isNow }} />
              </Sub>
            ))}
          </div>
        </Panel>

        <Panel title="Credit" sub="Scores, accounts, utilization" href={link('Credit Matrix')} className="span-6">
          {model.scores.length ? (
            <div className="mspend-tiles">
              {model.scores.map(s => (
                <span key={s.label} className="mspend-tile">
                  {s.label} <b>{s.value}</b>
                </span>
              ))}
            </div>
          ) : null}
          <div className="mcols">
            {model.creditAccounts ? (
              <Sub title="Current accounts">
                <SheetTable table={model.creditAccounts} onSave={save} />
              </Sub>
            ) : null}
            {model.utilEst ? (
              <Sub title="Utilization estimate" open={false}>
                <SheetTable table={model.utilEst} onSave={save} />
              </Sub>
            ) : null}
          </div>
        </Panel>

        <Panel title="Savings & move" sub="Values are estimates; dates in the planner are older" href={link('Move Sav /COG Estimate')} className="span-6">
          {model.savings ? (
            <Sub title="Savings balances">
              <SheetTable table={{ ...model.savings, header: ['Fund', ...model.savings.header.slice(1)] }} onSave={save} />
            </Sub>
          ) : null}
          <div className="mcols">
            {model.move.map(t => (
              <Sub key={t.key} title={t.title} open={t.rows.length <= 8}>
                <SheetTable table={t} onSave={save} />
              </Sub>
            ))}
          </div>
        </Panel>
      </div>

      {model.missing.length ? (
        <p className="money-missing">
          Couldn’t find these headings in the sheet (renamed or moved?): {model.missing.join(', ')}. Everything else still shows.
        </p>
      ) : null}
      <p className="money-foot">
        Every change from Life Hub is logged on the sheet’s “Life Hub edits” tab. Money here never turns into tasks — it lives on the calendar and this page.
      </p>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value?: string; sub?: string; tone?: 'warn' }) {
  return (
    <div className={`mstat${tone ? ` is-${tone}` : ''}`}>
      <span className="mstat-label">{label}</span>
      <b>{value || '—'}</b>
      {sub ? <span className="mstat-sub">{sub}</span> : null}
    </div>
  );
}
