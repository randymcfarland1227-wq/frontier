'use client';

/**
 * Money page boards from Randy's 2026-10-22 drawings: the pinned header dashboard, the Week board
 * (week strip + fixed Overdue / Upcoming boxes beside the balancing sheet), Accounts (bank boxes,
 * eBay / Poshmark with item-level sales, compact table), the credit card and loan tables, and the
 * "Pay from" picker. Sheet numbers come from lib/money.ts; what the sheet has no column for (APR, card
 * fees, loan terms, sales, pay-from) lives in lib/moneyMeta.ts.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { amountOf, cardSummaries, MONEY_KINDS, parseSheetDate, type Cell, type MoneyModel } from '../../lib/money';
import { addDays, dayKey, fromDayKey, money, startOfDay, type BillDue } from '../../lib/schedule';
import { mondayOf, srcKey, updatePick, useBalancePicks } from '../../lib/balancePicks';
import { metaName, monthlyCarry, removeMeta, setMeta, useMoneyMeta, type MetaEntry } from '../../lib/moneyMeta';
import { isOverdue } from '../../lib/billEdits';
import { isLedgerPaid, ledgerMonthRows } from '../../lib/moneyLedger';
import { readSaved, writeSaved } from '../../lib/storage';

export type CellView = (c: Cell | undefined, placeholder?: string) => ReactNode;
type Get = (key: string) => MetaEntry | undefined;

const num = (c?: Cell) => amountOf(c?.text || '');
const usd = (n?: number) => (n === undefined ? '—' : money(n));
const pct = (n?: number) => (n === undefined ? '—' : `${Math.round(n)}%`);
const md = (k?: string) => (k ? fromDayKey(k).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '—');
const sumOf = (xs: Array<number | undefined>) => xs.reduce<number>((s, x) => s + (x || 0), 0);
/** Loose name match: one name starts with the other (Cap 1 S ↔ Cap 1 Sec), closest length wins. */
function nearest<T>(name: string, list: T[], nameOf: (x: T) => string): T | undefined {
  const k = metaName(name);
  if (!k) return undefined;
  return list
    .filter(x => {
      const o = metaName(nameOf(x));
      return o && (o === k || o.startsWith(k) || k.startsWith(o));
    })
    .sort((a, b) => Math.abs(metaName(nameOf(a)).length - k.length) - Math.abs(metaName(nameOf(b)).length - k.length))[0];
}
const isPaid = (d: BillDue, paidAt: Record<string, string>) => isLedgerPaid(d, paidAt) || Boolean(d.skipped);

// ─────────────────────────── shared bits ───────────────────────────

function Box({ tone, title, figure, figureLabel, hint, className = '', children }: { tone: string; title: ReactNode; figure?: ReactNode; figureLabel?: string; hint?: string; className?: string; children: ReactNode }) {
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
      </header>
      <div className="mny-sec-body">{children}</div>
    </section>
  );
}

/** A number typed on Life Hub (not the sheet): click to edit, Enter or leave to save, empty clears. */
export function MetaNum({ id, field, value, placeholder = 'add', prefix = '', suffix = '', title }: { id: string; field: 'apr' | 'fee' | 'principal' | 'paymentsLeft' | 'amount'; value?: number; placeholder?: string; prefix?: string; suffix?: string; title?: string }) {
  const [edit, setEdit] = useState(false);
  const [text, setText] = useState('');
  if (edit) {
    const done = (keep: boolean) => {
      setEdit(false);
      if (!keep) return;
      const n = text.trim() === '' ? undefined : Number(text.replace(/[$,%\s]/g, ''));
      if (n === undefined || Number.isFinite(n)) setMeta(id, { [field]: n });
    };
    return (
      <input
        className="mb-in"
        autoFocus
        inputMode="decimal"
        value={text}
        aria-label={title || field}
        onChange={e => setText(e.target.value)}
        onBlur={() => done(true)}
        onKeyDown={e => {
          if (e.key === 'Enter') done(true);
          if (e.key === 'Escape') done(false);
        }}
      />
    );
  }
  return (
    <button
      type="button"
      className={`mb-meta${value === undefined ? ' is-empty' : ''}`}
      title={title ? `${title} — typed on Life Hub, not in the sheet` : 'Typed on Life Hub, not in the sheet'}
      onClick={() => {
        setText(value === undefined ? '' : String(value));
        setEdit(true);
      }}
    >
      {value === undefined ? `+ ${placeholder}` : `${prefix}${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}${suffix}`}
    </button>
  );
}

function PaidMark({ d, paidAt }: { d?: BillDue; paidAt: Record<string, string> }) {
  if (!d) return <span className="mb-dim">—</span>;
  if (isPaid(d, paidAt)) return <span className="mb-ok">✓ paid</span>;
  return <span className={d.days < 0 ? 'mb-late' : 'mb-dim'}>{d.days < 0 ? 'not yet · late' : 'not yet'}</span>;
}

// ─────────────────────────── accounts ───────────────────────────

export type BankRow = { name: string; label: string; now?: number; pend?: number; sav?: number; nowCell?: Cell; pendCell?: Cell; resale?: 'ebay' | 'posh' };

/** The balancing list's accounts (Chase, BofA, Ally, eBay, Poshmark…) + Debit Accounts not on it. */
export function bankRows(model: MoneyModel): BankRow[] {
  const t = model.balancing;
  const pendCol = t ? t.header.findIndex(h => /^pend/i.test(h)) : -1;
  const debit = (model.accounts?.rows || []).filter(r => r[0]?.text.trim());
  const out: BankRow[] = (t?.rows || [])
    .filter(r => r[0]?.text.trim() && !/^(cash on hand|balanced cash|total)/i.test(r[0].text))
    .map(r => {
      const name = r[0].text.trim();
      const d = debit.find(x => metaName(x[0].text) === metaName(name));
      const resale = /ebay/i.test(name) ? 'ebay' : /posh/i.test(name) ? 'posh' : undefined;
      return {
        name,
        label: resale === 'ebay' ? 'eBay' : resale === 'posh' ? 'Poshmark' : /^bofa$/i.test(name) ? 'BofA' : name.replace(/\s*\(pend\)\s*/i, ''),
        now: num(r[1]),
        nowCell: r[1],
        pend: pendCol >= 0 ? num(r[pendCol]) : undefined,
        pendCell: pendCol >= 0 ? r[pendCol] : undefined,
        sav: d ? num(d[2]) : undefined,
        resale,
      };
    });
  for (const d of debit) {
    if (out.some(o => metaName(o.name) === metaName(d[0].text))) continue;
    out.push({ name: d[0].text.trim(), label: d[0].text.trim().replace(/\s+/g, ' '), now: num(d[1]), nowCell: d[1], sav: num(d[2]) });
  }
  return out;
}

/** When Life Hub last saw each balance change (the sheet keeps no per-account date). */
function useBalanceSeen(rows: BankRow[], get: Get) {
  const sig = rows.map(r => `${r.name}:${r.now ?? ''}:${r.pend ?? ''}`).join('|');
  useEffect(() => {
    for (const r of rows) {
      const k = `bal:${metaName(r.name)}`;
      const cur = r.now ?? 0;
      const prev = get(k);
      if (!prev) setMeta(k, { amount: cur, state: 'avail', name: 'first' });
      else if (prev.amount !== cur) setMeta(k, { amount: cur, name: undefined });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  return (r: BankRow) => {
    const e = get(`bal:${metaName(r.name)}`);
    if (!e) return '';
    return e.name === 'first' ? 'no change seen yet' : `changed ${new Date(e.at).toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
  };
}

type Sale = MetaEntry & { id: string };
function useSales(): Sale[] {
  const { meta } = useMoneyMeta();
  return Object.entries(meta)
    .filter(([k, v]) => k.startsWith('sale:') && !v.gone)
    .map(([k, v]) => ({ ...v, id: k }))
    .sort((a, b) => (a.state === b.state ? (a.availOn || '').localeCompare(b.availOn || '') : a.state === 'pend' ? -1 : 1));
}

function SaleAdd({ platform }: { platform: 'ebay' | 'posh' }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [state, setState] = useState<'pend' | 'avail'>('pend');
  const [availOn, setAvailOn] = useState('');
  if (!open) {
    return (
      <button type="button" className="mny-btn mb-add" onClick={() => setOpen(true)}>
        + Add a sale
      </button>
    );
  }
  const n = Number(amount.replace(/[$,\s]/g, ''));
  return (
    <form
      className="mb-sale-form"
      onSubmit={e => {
        e.preventDefault();
        if (!name.trim() || !Number.isFinite(n)) return;
        setMeta(`sale:${Date.now().toString(36)}`, { platform, name: name.trim(), amount: n, state, availOn: availOn || undefined });
        setOpen(false);
        setName('');
        setAmount('');
        setAvailOn('');
      }}
    >
      <input placeholder="Item (BBC hoodie)" value={name} onChange={e => setName(e.target.value)} aria-label="Item" autoFocus />
      <input placeholder="$" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} aria-label="Amount" />
      <select value={state} onChange={e => setState(e.target.value as 'pend' | 'avail')} aria-label="Pending or available">
        <option value="pend">Pending</option>
        <option value="avail">Available</option>
      </select>
      <input type="date" value={availOn} onChange={e => setAvailOn(e.target.value)} aria-label="Est. available on" title="Est. available on" />
      <button type="submit" className="mny-btn">
        Add
      </button>
      <button type="button" className="mny-btn" onClick={() => setOpen(false)}>
        Cancel
      </button>
    </form>
  );
}

function ResaleBox({ row, sales }: { row: BankRow; sales: Sale[] }) {
  const mine = sales.filter(s => s.platform === row.resale);
  const itemPend = sumOf(mine.filter(s => s.state === 'pend').map(s => s.amount));
  const itemAvail = sumOf(mine.filter(s => s.state === 'avail').map(s => s.amount));
  return (
    <div className={`mb-acct is-resale is-${row.resale}`}>
      <div className="mb-acct-head">
        <b>{row.label}</b>
      </div>
      <div className="mb-trio">
        <span>
          <small>Avail</small>
          <b>{usd(row.now ?? 0)}</b>
        </span>
        <span>
          <small>Pend</small>
          <b className="mb-pend">{usd(row.pend ?? 0)}</b>
        </span>
        <span>
          <small>Both</small>
          <b>{usd((row.now || 0) + (row.pend || 0))}</b>
        </span>
      </div>
      <ul className="mb-sales">
        {mine.map(s => (
          <li key={s.id} className={`is-${s.state}`}>
            <span className="mb-sale-name">{s.name}</span>
            <button type="button" className={`mb-pill is-${s.state}`} title="Switch pending / available" onClick={() => setMeta(s.id, { state: s.state === 'pend' ? 'avail' : 'pend' })}>
              {s.state === 'pend' ? 'pending' : 'available'}
            </button>
            <small>{s.state === 'pend' ? (s.availOn ? `est. avail ${md(s.availOn)}` : 'no date') : ''}</small>
            <b>{usd(s.amount)}</b>
            <button type="button" className="mb-x" aria-label={`Remove ${s.name}`} onClick={() => removeMeta(s.id)}>
              ✕
            </button>
          </li>
        ))}
        {!mine.length ? <li className="mb-dim">No sales listed yet — add each one to see what’s pending vs available.</li> : null}
      </ul>
      {mine.length ? (
        <p className="mb-dim mb-check">
          Items: {usd(itemPend)} pending · {usd(itemAvail)} available
          {row.pend !== undefined && Math.abs(itemPend - row.pend) > 0.5 ? ` · sheet says ${usd(row.pend)} pending` : ''}
        </p>
      ) : null}
      <SaleAdd platform={row.resale as 'ebay' | 'posh'} />
    </div>
  );
}

export function AccountsBoard({ model, cell }: { model: MoneyModel; cell: CellView }) {
  const { get } = useMoneyMeta();
  const rows = bankRows(model);
  const seen = useBalanceSeen(rows, get);
  const sales = useSales();
  const banks = rows.filter(r => !r.resale);
  const resale = rows.filter(r => r.resale);
  const synced = new Date(model.refreshedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const totNow = sumOf(rows.map(r => r.now));
  const totPend = sumOf(rows.map(r => r.pend));
  return (
    <div className="mny-stack">
      <div className="mb-acct-row">
        {banks.map(r => (
          <div key={r.name} className="mb-acct">
            <div className="mb-acct-head">
              <b>{r.label}</b>
              <span className="mb-now">{cell(r.nowCell, '$0')}</span>
            </div>
            <small className="mb-dim">
              {seen(r) || `sheet ${synced}`}
              {r.pend ? ` · ${usd(r.pend)} pending` : ''}
              {r.sav !== undefined ? ` · savings ${usd(r.sav)}` : ''}
            </small>
          </div>
        ))}
      </div>
      <div className="mb-acct-row is-two">
        {resale.map(r => (
          <ResaleBox key={r.name} row={r} sales={sales} />
        ))}
      </div>
      <Box tone="cash" title="Quick look" figure={usd(totNow + totPend)} figureLabel="avail + pending">
        <table className="mb-table">
          <thead>
            <tr>
              <th>Account</th>
              <th className="num">Avail</th>
              <th className="num">Pend</th>
              <th className="num">Both</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.name}>
                <td>{r.label}</td>
                <td className="num">{cell(r.nowCell, '$0')}</td>
                <td className="num">{r.pendCell ? cell(r.pendCell, '—') : '—'}</td>
                <td className="num">{usd((r.now || 0) + (r.pend || 0))}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Sum</td>
              <td className="num">{usd(totNow)}</td>
              <td className="num">{usd(totPend)}</td>
              <td className="num">{usd(totNow + totPend)}</td>
            </tr>
          </tfoot>
        </table>
      </Box>
    </div>
  );
}

// ─────────────────────────── cards & loans ───────────────────────────

/** Cards whose issuer charges a monthly fee on top of interest (Randy will type the amounts). */
const FEE_CARDS = /milestone|indigo|destiny/i;

export type CardRow = { name: string; key: string; bal?: number; avail?: number; limit?: number; util?: number; min?: number; due?: BillDue; apr?: number; fee?: number; carry?: number };

export function cardRows(model: MoneyModel, monthDues: BillDue[], get: Get): CardRow[] {
  // This month's card payments, crossed-off ones too (struck in the sheet = paid).
  const cardDues = ledgerMonthRows(monthDues, model.items, new Date()).filter(d => d.bill.kind === 'card');
  const sums = cardSummaries(model);
  // Each payment belongs to the one card its name is closest to (Cap 1 S → Cap 1 Sec, not Cap 1 Savor).
  const ownerOf = (d: BillDue) => nearest(d.bill.name, sums, x => x.name);
  return sums.map(c => {
    const bal = num(c.balance);
    const avail = num(c.available);
    const limit = avail !== undefined && bal !== undefined ? bal + avail : num(c.limit);
    const key = `card:${metaName(c.name)}`;
    const m = get(key);
    const day = c.minDate?.text ? parseSheetDate(c.minDate.text) : undefined;
    const due = cardDues.find(d => ownerOf(d) === c) || (day ? cardDues.find(d => !ownerOf(d) && (d.orig || d.due) === day && d.bill.amount === num(c.min)) : undefined);
    return { name: c.name.replace(/\s+/g, ' '), key, bal, avail, limit, util: limit ? ((bal || 0) / limit) * 100 : undefined, min: num(c.min), due, apr: m?.apr, fee: m?.fee, carry: monthlyCarry(bal || 0, m?.apr) };
  });
}

export function CardsTable({ model, monthDues, paidAt }: { model: MoneyModel; monthDues: BillDue[]; paidAt: Record<string, string> }) {
  const { get } = useMoneyMeta();
  const rows = cardRows(model, monthDues, get);
  const lim = sumOf(rows.filter(r => r.limit).map(r => r.limit));
  const balLim = sumOf(rows.filter(r => r.limit).map(r => r.bal));
  const carry = sumOf(rows.map(r => r.carry));
  const fees = sumOf(rows.map(r => r.fee));
  const noApr = rows.filter(r => r.bal && r.apr === undefined).length;
  return (
    <div className="mb-scroll">
      <table className="mb-table mb-cards">
        <thead>
          <tr>
            <th>Card</th>
            <th className="num">Balance</th>
            <th className="num" title="APR % (typed on Life Hub)">APR</th>
            <th className="num" title="Interest this month at the APR on the current balance">Monthly carry</th>
            <th className="num" title="Extra monthly fee (Milestone, Indigo, Destiny)">Fee</th>
            <th className="num">Avail</th>
            <th className="num">Util</th>
            <th>Due</th>
            <th>Paid this month</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.key}>
              <td>{r.name}</td>
              <td className="num">{usd(r.bal)}</td>
              <td className="num">
                <MetaNum id={r.key} field="apr" value={r.apr} placeholder="APR" suffix="%" title={`${r.name} APR`} />
              </td>
              <td className="num">{r.carry !== undefined ? usd(r.carry) : <span className="mb-dim">—</span>}</td>
              <td className="num">{FEE_CARDS.test(r.name) || r.fee !== undefined ? <MetaNum id={r.key} field="fee" value={r.fee} placeholder="fee" prefix="$" title={`${r.name} monthly fee`} /> : <span className="mb-dim">—</span>}</td>
              <td className="num">{usd(r.avail)}</td>
              <td className={`num${r.util !== undefined && r.util >= 90 ? ' mb-late' : ''}`}>{pct(r.util)}</td>
              <td>
                {r.due ? md(r.due.due) : '—'}
                {r.min ? <small className="mb-dim"> · {usd(r.min)}</small> : null}
              </td>
              <td>
                <PaidMark d={r.due} paidAt={paidAt} />
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td>Totals</td>
            <td className="num">{usd(sumOf(rows.map(r => r.bal)))}</td>
            <td />
            <td className="num">{noApr === rows.filter(r => r.bal).length ? '—' : usd(carry)}</td>
            <td className="num">{fees ? usd(fees) : '—'}</td>
            <td className="num">{usd(sumOf(rows.map(r => r.avail)))}</td>
            <td className="num" title="Balance ÷ limit over cards with a known limit">{lim ? pct((balLim / lim) * 100) : '—'}</td>
            <td colSpan={2} className="mb-dim">
              {noApr ? `${noApr} without an APR yet` : `${usd(carry + fees)} a month to carry`}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export type LoanRow = { name: string; what: string; key: string; balCell?: Cell; bal?: number; principal?: number; paymentsLeft?: number; closed?: boolean; due?: BillDue; payment?: number };

export function loanRows(model: MoneyModel, monthDues: BillDue[], get: Get): LoanRow[] {
  const bills = ledgerMonthRows(monthDues, model.items, new Date()).filter(d => (d.bill.kind || 'bill') === 'bill');
  return (model.creditAccounts?.rows || [])
    .filter(r => r[0]?.text.trim())
    .map(r => {
      const name = r[0].text.trim();
      const key = `loan:${metaName(name)}`;
      const m = get(key);
      const due = nearest(name, bills, d => d.bill.name);
      return { name, what: r[1]?.text || '', key, balCell: r[2], bal: num(r[2]), principal: m?.principal, paymentsLeft: m?.paymentsLeft, closed: m?.closed, due, payment: due?.bill.amount ?? num(r[4]) };
    });
}

export function LoansTable({ model, monthDues, paidAt, cell }: { model: MoneyModel; monthDues: BillDue[]; paidAt: Record<string, string>; cell: CellView }) {
  const { get } = useMoneyMeta();
  const rows = loanRows(model, monthDues, get);
  const groups: Array<[string, LoanRow[]]> = [
    ['Active', rows.filter(r => !r.closed)],
    ['Closed', rows.filter(r => r.closed)],
  ];
  return (
    <div className="mb-scroll">
      <table className="mb-table mb-loans">
        <thead>
          <tr>
            <th>Account</th>
            <th className="num" title="Balance left — the sheet's Bal cell">Balance left</th>
            <th className="num" title="Original amount (typed on Life Hub)">Principal</th>
            <th className="num">Payments left</th>
            <th className="num">% paid</th>
            <th>Due</th>
            <th>Paid this month</th>
            <th />
          </tr>
        </thead>
        {groups.map(([label, list]) =>
          list.length ? (
            <tbody key={label}>
              <tr className="mb-grp">
                <td colSpan={8}>
                  {label} · {list.length} · {usd(sumOf(list.map(r => r.bal)))}
                </td>
              </tr>
              {list.map(r => (
                <tr key={r.key} className={r.closed ? 'is-closed' : ''}>
                  <td>
                    {r.name} <small className="mb-dim">{r.what}</small>
                  </td>
                  <td className="num">{cell(r.balCell, 'add')}</td>
                  <td className="num">
                    <MetaNum id={r.key} field="principal" value={r.principal} placeholder="principal" prefix="$" title={`${r.name} original amount`} />
                  </td>
                  <td className="num">
                    <MetaNum id={r.key} field="paymentsLeft" value={r.paymentsLeft} placeholder="count" title={`${r.name} payments left`} />
                  </td>
                  <td className="num">{r.principal && r.bal !== undefined ? pct(((r.principal - r.bal) / r.principal) * 100) : <span className="mb-dim">—</span>}</td>
                  <td>
                    {r.due ? md(r.due.due) : '—'}
                    {r.payment ? <small className="mb-dim"> · {usd(r.payment)}</small> : null}
                  </td>
                  <td>{r.closed ? <span className="mb-dim">closed</span> : <PaidMark d={r.due} paidAt={paidAt} />}</td>
                  <td>
                    <button type="button" className="mb-x is-word" onClick={() => setMeta(r.key, { closed: r.closed ? undefined : true })}>
                      {r.closed ? 'reopen' : 'closed?'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          ) : null,
        )}
      </table>
    </div>
  );
}

// ─────────────────────────── week ───────────────────────────

function WeekLine({ d, paidAt, onPaid, onOpen, cols }: { d: BillDue; paidAt: Record<string, string>; onPaid: (d: BillDue) => void; onOpen?: (key: string) => void; cols: 'late' | 'soon' }) {
  const kind = d.bill.kind || 'bill';
  return (
    <li className="mb-wl" style={{ ['--k' as string]: MONEY_KINDS[kind]?.color }}>
      <button type="button" className="mb-wl-name" onClick={() => onOpen?.(d.key)} title={MONEY_KINDS[kind]?.label}>
        {d.bill.name.trim()}
      </button>
      <b className="num">{d.bill.amount !== undefined ? usd(d.bill.amount) : '?'}</b>
      <span>{cols === 'late' ? md(d.due) : fromDayKey(d.due).toLocaleDateString([], { weekday: 'short', day: 'numeric' })}</span>
      <span className={d.bill.payBy ? 'mb-late' : 'mb-dim'}>{cols === 'late' ? (d.bill.payBy ? md(d.bill.payBy) : '—') : d.days === 0 ? 'today' : `${d.days}d`}</span>
      <button type="button" className="mb-x is-word" onClick={() => onPaid(d)} disabled={Boolean(paidAt[d.key])}>
        Paid
      </button>
    </li>
  );
}

export function WeekBoard({ dues, monthDues, paidAt, onPaid, onOpen, children }: { dues: BillDue[]; monthDues: BillDue[]; paidAt: Record<string, string>; onPaid: (d: BillDue) => void; onOpen?: (key: string) => void; children: ReactNode }) {
  const today = startOfDay(new Date());
  const mon = mondayOf(today);
  const sunday = addDays(mon, 6);
  const all = [...new Map([...monthDues, ...dues].map(d => [d.key, d])).values()].filter(d => !d.skipped && d.bill.kind !== 'plan');
  const overdue = dues.filter(d => isOverdue(d) && !paidAt[d.key]).sort((a, b) => a.due.localeCompare(b.due));
  const open = dues.filter(d => d.days >= 0 && !d.skipped && !paidAt[d.key] && d.bill.kind !== 'plan').sort((a, b) => a.due.localeCompare(b.due));
  const thisWeek = open.filter(d => fromDayKey(d.due) <= sunday);
  const nextWeek = open.filter(d => fromDayKey(d.due) > sunday && fromDayKey(d.due) <= addDays(sunday, 7));
  const days = Array.from({ length: 7 }, (_, i) => dayKey(addDays(mon, i)));
  const todayK = dayKey(today);
  const lateSum = sumOf(overdue.map(d => d.bill.amount));
  return (
    <div className="mny-stack">
      <div className="mb-week" role="list" aria-label="This week, Monday to Sunday">
        {days.map(k => {
          const items = all.filter(d => d.due === k);
          const left = sumOf(items.filter(d => !isPaid(d, paidAt)).map(d => d.bill.amount));
          return (
            <div key={k} role="listitem" className={`mb-day${k === todayK ? ' is-today' : ''}${k < todayK ? ' is-past' : ''}`}>
              <div className="mb-day-head">
                <small>{fromDayKey(k).toLocaleDateString([], { weekday: 'short' })}</small>
                <b>{fromDayKey(k).getDate()}</b>
              </div>
              <ul>
                {items.map(d => (
                  <li key={d.key} className={isPaid(d, paidAt) ? 'is-paid' : ''} style={{ ['--k' as string]: MONEY_KINDS[d.bill.kind || 'bill']?.color }}>
                    <button type="button" onClick={() => onOpen?.(d.key)}>
                      <span>{d.bill.name.trim()}</span>
                      <b>{d.bill.amount !== undefined ? usd(d.bill.amount) : '?'}</b>
                    </button>
                  </li>
                ))}
              </ul>
              {left ? <small className="mb-day-sum">{usd(left)} left</small> : null}
            </div>
          );
        })}
      </div>
      <div className="mb-week-grid">
        <div className="mb-week-left">
          {overdue.length ? (
            <Box tone="owed" title="Overdue" figure={usd(lateSum)} figureLabel={`${overdue.length} not paid`} className="mb-fixed">
              <div className="mb-wl-head is-late">
                <span>Bill</span>
                <span className="num">Amount</span>
                <span>Due</span>
                <span>Pay by</span>
                <span />
              </div>
              <ul className="mb-wl-list">
                {overdue.map(d => (
                  <WeekLine key={d.key} d={d} paidAt={paidAt} onPaid={onPaid} onOpen={onOpen} cols="late" />
                ))}
              </ul>
            </Box>
          ) : null}
          <Box tone="due" title="Upcoming · this week" figure={usd(sumOf(thisWeek.map(d => d.bill.amount)))} figureLabel={`${thisWeek.length} through Sun`} className="mb-fixed">
            <div className="mb-wl-head">
              <span>Bill</span>
              <span className="num">Amount</span>
              <span>Day</span>
              <span>In</span>
              <span />
            </div>
            <ul className="mb-wl-list">
              {thisWeek.map(d => (
                <WeekLine key={d.key} d={d} paidAt={paidAt} onPaid={onPaid} onOpen={onOpen} cols="soon" />
              ))}
              {!thisWeek.length ? <li className="mb-dim">Nothing else due this week.</li> : null}
              {nextWeek.length ? <li className="mb-wl-div">Next week · {usd(sumOf(nextWeek.map(d => d.bill.amount)))}</li> : null}
              {nextWeek.map(d => (
                <WeekLine key={d.key} d={d} paidAt={paidAt} onPaid={onPaid} onOpen={onOpen} cols="soon" />
              ))}
            </ul>
          </Box>
        </div>
        <div className="mb-week-right">{children}</div>
      </div>
    </div>
  );
}

// ─────────────────────────── pay from ───────────────────────────

const PAY_KINDS: Array<[string, string]> = [
  ['bill', 'Bills'],
  ['card', 'Card payments'],
  ['paylater', 'Pay later'],
  ['cash', 'Cash advances'],
  ['sub', 'Subscriptions'],
];

/** Which account or card pays each bill, subscription and pay later — and what each one has to cover. */
export function PaySources({ model, dues, monthDues, paidAt }: { model: MoneyModel; dues: BillDue[]; monthDues: BillDue[]; paidAt: Record<string, string> }) {
  const { get } = useMoneyMeta();
  const plan = useBalancePicks();
  const banks = bankRows(model).filter(r => !r.resale);
  const cards = cardSummaries(model).map(c => c.name.replace(/\s+/g, ' '));
  const list = [...new Map([...dues.filter(isOverdue), ...monthDues].map(d => [d.key, d])).values()]
    .filter(d => !isPaid(d, paidAt) && (d.days >= 0 || isOverdue(d)) && d.bill.kind !== 'plan')
    .sort((a, b) => a.due.localeCompare(b.due));
  const fromOf = (d: BillDue) => {
    const src = srcKey('pay', d.bill.name);
    return get(`from:${src}`)?.acct || plan.entries[d.key]?.acct || plan.remembered.get(src)?.acct || '';
  };
  const pick = (d: BillDue, acct: string) => {
    const src = srcKey('pay', d.bill.name);
    setMeta(`from:${src}`, { acct: acct || undefined });
    // A bank account also becomes the balancing sheet's remembered account; a card leaves the bank alone.
    const bank = banks.find(b => b.name === acct);
    updatePick(`src:${src}`, { mark: null, acct: bank ? bank.name : undefined });
  };
  const totals = new Map<string, { n: number; sum: number; late: number }>();
  for (const d of list) {
    const k = fromOf(d) || '';
    const t = totals.get(k) || { n: 0, sum: 0, late: 0 };
    t.n += 1;
    t.sum += d.bill.amount || 0;
    if (d.days < 0) t.late += d.bill.amount || 0;
    totals.set(k, t);
  }
  const order = [...banks.map(b => b.name), ...cards, ''];
  const chips = order.filter(k => totals.has(k));
  const label = (k: string) => (k ? banks.find(b => b.name === k)?.label || k : 'Not set');
  return (
    <div className="mny-stack">
      <div className="mb-src-sum">
        {chips.map(k => {
          const t = totals.get(k)!;
          const bank = banks.find(b => b.name === k);
          const short = bank && bank.now !== undefined && bank.now < t.sum;
          return (
            <div key={k || 'none'} className={`mb-src-chip${k ? '' : ' is-none'}${short ? ' is-short' : ''}`}>
              <small>{label(k)}</small>
              <b>{usd(t.sum)}</b>
              <small>
                {t.n} due{t.late ? ` · ${usd(t.late)} late` : ''}
                {bank?.now !== undefined ? ` · has ${usd(bank.now)}` : ''}
              </small>
            </div>
          );
        })}
      </div>
      <div className="mb-src-cols">
        {PAY_KINDS.map(([kind, title]) => {
          const xs = list.filter(d => (d.bill.kind || 'bill') === kind);
          if (!xs.length) return null;
          return (
            <Box key={kind} tone={kind === 'sub' ? 'sub' : kind === 'card' ? 'card' : 'due'} title={title} figure={usd(sumOf(xs.map(d => d.bill.amount)))}>
              <ul className="mb-src-list">
                {xs.map(d => (
                  <li key={d.key} className={d.days < 0 ? 'is-late' : ''}>
                    <span className="mb-src-name">{d.bill.name.trim()}</span>
                    <small>{d.days < 0 ? `late · ${md(d.due)}` : md(d.due)}</small>
                    <b className="num">{d.bill.amount !== undefined ? usd(d.bill.amount) : '?'}</b>
                    <select value={fromOf(d)} onChange={e => pick(d, e.target.value)} aria-label={`Pay ${d.bill.name} from`}>
                      <option value="">Pay from…</option>
                      <optgroup label="Accounts">
                        {banks.map(b => (
                          <option key={b.name} value={b.name}>
                            {b.label}
                          </option>
                        ))}
                      </optgroup>
                      <optgroup label="Cards">
                        {cards.map(c => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </optgroup>
                    </select>
                  </li>
                ))}
              </ul>
            </Box>
          );
        })}
      </div>
      <p className="mb-dim">The choice sticks to that bill / subscription for every month. Picking a bank account also sets it on the balancing sheet; a card keeps it off your bank accounts.</p>
    </div>
  );
}

// ─────────────────────────── header dashboard ───────────────────────────

export type DashCredit = {
  scores: Array<{ bureau: string; score?: number; date?: string }>;
  active: { n: number; sum: number };
  collections: { n: number; sum: number };
  closed: { n: number; sum: number };
};
export type DashOwed = Array<{ label: string; sum: number; note?: string; go: string }>;

const PIN_KEY = 'lifehub-money-dash-pinned';

export function MoneyDash({
  model,
  overdue,
  monthPaid,
  monthCount,
  credit,
  owed,
  onGo,
  onOpenAccount,
  onOpenCard,
  top,
  tabs,
}: {
  model: MoneyModel;
  overdue: BillDue[];
  monthPaid: number;
  monthCount: number;
  credit: DashCredit;
  owed: DashOwed;
  onGo: (where: string) => void;
  /** A row opens its entity's shared panel */
  onOpenAccount: (name: string) => void;
  onOpenCard: (name: string) => void;
  /** Sync line, buttons and save notes */
  top: ReactNode;
  /** The page's tab bar — pinned along with the dashboard so it stays reachable */
  tabs?: ReactNode;
}) {
  const [pinned, setPinned] = useState(() => readSaved<boolean>(PIN_KEY, true));
  // Once the page scrolls past it, the pinned dashboard shrinks to its sum boxes.
  const mark = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const el = mark.current;
    if (!el) return;
    const check = () => setScrolled(el.getBoundingClientRect().top < -40);
    check();
    window.addEventListener('scroll', check, { passive: true });
    return () => window.removeEventListener('scroll', check);
  }, []);
  const { get } = useMoneyMeta();
  const rows = bankRows(model);
  const cards = cardRows(model, [], get);
  const savT = model.savings;
  const goals = (savT?.rows || []).filter(r => r[0]?.text.trim()).map(r => r[0].text.replace(/\s*\(.*\)\s*/, '').trim());
  const savAccts = (savT?.header || []).slice(1).map((h, i) => ({ name: h.trim(), col: i + 1 })).filter(a => a.name);
  const savCell = (gi: number, col: number) => num(savT?.rows.filter(r => r[0]?.text.trim())[gi]?.[col]);
  // Only goals / accounts holding money get a grid column / row; empty ones are counted in the note.
  const goalIdx = goals.map((_, gi) => gi).filter(gi => savAccts.some(a => savCell(gi, a.col)));
  const acctList = savAccts.filter(a => goals.some((_, gi) => savCell(gi, a.col)));
  const emptyGoals = goals.filter((_, gi) => !goalIdx.includes(gi));
  const lateBy = (k: string) => overdue.filter(d => (d.bill.kind || 'bill') === k);
  const lateBoxes: Array<[string, string, string]> = [
    ['bill', 'Bills', 'bills'],
    ['card', 'Cards', 'cards'],
    ['sub', 'Subs', 'subs'],
    ['paylater', 'Pay later', 'paylater'],
    ['cash', 'Advances', 'cash'],
  ];
  const owedSum = sumOf(owed.map(o => o.sum));
  const cardLim = sumOf(cards.filter(c => c.limit).map(c => c.limit));
  const cardBal = sumOf(cards.filter(c => c.limit).map(c => c.bal));
  const paidPct = monthCount ? Math.round((monthPaid / monthCount) * 100) : undefined;
  const toggle = () => {
    setPinned(!pinned);
    writeSaved(PIN_KEY, !pinned);
  };
  return (
    <>
    <div ref={mark} className="mb-dash-mark" aria-hidden="true" />
    <section className={`mb-dash${pinned ? ' is-pinned' : ''}${pinned && scrolled ? ' is-compact' : ''}`} aria-label="Money at a glance">
      <div className="mb-dash-top">
        <p className="mny-eyebrow">Money · at a glance</p>
        {top}
        <button type="button" className="mny-btn" aria-pressed={pinned} onClick={toggle} title={pinned ? 'Stop pinning this to the top while you scroll' : 'Keep this at the top while you scroll'}>
          {pinned ? 'Unpin' : 'Pin'}
        </button>
      </div>
      <div className="mb-dash-cols">
        <DashCol tone="cash" go="accounts" onGo={onGo}>
          <h3>Cash · pend</h3>
          <div className="mb-dc-grid is-3">
            <span />
            <small>avail</small>
            <small>pend</small>
            {rows.map(r => (
              <DashRow key={r.name} onOpen={() => onOpenAccount(r.name)} label={r.label}>
                <b>{usd(r.now ?? 0)}</b>
                <b className="mb-pend">{r.pend ? usd(r.pend) : '·'}</b>
              </DashRow>
            ))}
          </div>
          <div className="mb-dc-sums">
            <span>
              <small>avail</small>
              <b>{usd(sumOf(rows.map(r => r.now)))}</b>
            </span>
            <span>
              <small>pend</small>
              <b>{usd(sumOf(rows.map(r => r.pend)))}</b>
            </span>
            <span>
              <small>both</small>
              <b>{usd(sumOf(rows.map(r => (r.now || 0) + (r.pend || 0))))}</b>
            </span>
          </div>
        </DashCol>
        <DashCol tone="card" go="cards" onGo={onGo}>
          <h3>Cards</h3>
          <div className="mb-dc-grid is-4">
            <span />
            <small>limit</small>
            <small>avail</small>
            <small>util</small>
            {cards.map(c => (
              <DashRow key={c.key} onOpen={() => onOpenCard(c.name)} label={c.name.replace(/^cap(ital)?\s*1\s*/i, 'C1 ')} title={c.name}>
                <b>{usd(c.limit)}</b>
                <b>{usd(c.avail)}</b>
                <b className={c.util !== undefined && c.util >= 90 ? 'mb-late' : ''}>{pct(c.util)}</b>
              </DashRow>
            ))}
          </div>
          <div className="mb-dc-sums">
            <span>
              <small>limit</small>
              <b>{usd(cardLim)}</b>
            </span>
            <span>
              <small>avail</small>
              <b>{usd(sumOf(cards.map(c => c.avail)))}</b>
            </span>
            <span>
              <small>util</small>
              <b>{cardLim ? pct((cardBal / cardLim) * 100) : '—'}</b>
            </span>
          </div>
        </DashCol>
        <DashCol tone="save" go="savings" onGo={onGo}>
          <h3>Savings</h3>
          <div className="mb-dc-grid" style={{ gridTemplateColumns: `minmax(0, 1fr) repeat(${goalIdx.length + 1}, minmax(0, 1fr))` }}>
            <span />
            {goalIdx.map(gi => (
              <small key={gi} title={goals[gi]}>
                {goals[gi].replace(/savings?/i, '').trim() || goals[gi]}
              </small>
            ))}
            <small>sum</small>
            {acctList.map(a => (
              <Frag key={a.name}>
                <span>{a.name}</span>
                {goalIdx.map(gi => (
                  <b key={gi}>{savCell(gi, a.col) !== undefined ? usd(savCell(gi, a.col)) : '·'}</b>
                ))}
                <b>{usd(sumOf(goals.map((_, gi) => savCell(gi, a.col))))}</b>
              </Frag>
            ))}
          </div>
          {emptyGoals.length ? <small className="mb-dim">Empty: {emptyGoals.join(', ')}</small> : null}
          <div className="mb-dc-sums">
            {goalIdx.map(gi => (
              <span key={gi}>
                <small>{goals[gi].replace(/savings?/i, '').trim() || goals[gi]}</small>
                <b>{usd(sumOf(savAccts.map(a => savCell(gi, a.col))))}</b>
              </span>
            ))}
            <span>
              <small>all</small>
              <b>{usd(sumOf(goals.flatMap((_, gi) => savAccts.map(a => savCell(gi, a.col)))))}</b>
            </span>
          </div>
        </DashCol>
        <DashCol tone="due" go="week" onGo={onGo}>
          <h3>Bills · routine</h3>
          <div className="mb-dc-big">
            <b>{paidPct !== undefined ? `${paidPct}%` : '—'}</b>
            <small>
              of {new Date().toLocaleDateString([], { month: 'long' })} paid · {monthPaid} of {monthCount}
            </small>
            <i className="mb-bar" aria-hidden="true">
              <i style={{ width: `${paidPct || 0}%` }} />
            </i>
          </div>
          {overdue.length ? (
            <div className="mb-dc-sums is-late">
              {lateBoxes.map(([k, label]) =>
                lateBy(k).length ? (
                  <span key={k}>
                    <small>{label}</small>
                    <b>{usd(sumOf(lateBy(k).map(d => d.bill.amount)))}</b>
                    <small>{lateBy(k).length} late</small>
                  </span>
                ) : null,
              )}
            </div>
          ) : null}
          {overdue.length ? (
            <div className="mb-dc-sums is-late mb-only-compact">
              <span>
                <small>overdue · {overdue.length}</small>
                <b>{usd(sumOf(overdue.map(d => d.bill.amount)))}</b>
              </span>
            </div>
          ) : null}
        </DashCol>
        <DashCol tone="plan" go="credit" onGo={onGo}>
          <h3>Credit</h3>
          <div className="mb-dc-scores">
            {credit.scores.map(s => (
              <span key={s.bureau} className={`bu-${bureauKey(s.bureau)}`}>
                <b>{s.score ?? '—'}</b>
                <small className="bu-name">{s.bureau}</small>
                <small>{s.date ? md(s.date) : ''}</small>
              </span>
            ))}
          </div>
          <div className="mb-dc-grid is-cs">
            <span />
            <small>#</small>
            <small>sum</small>
            <span>Active</span>
            <b>{credit.active.n}</b>
            <b>{usd(credit.active.sum)}</b>
            <span>Collections</span>
            <b className="mb-late">{credit.collections.n}</b>
            <b className="mb-late">{usd(credit.collections.sum)}</b>
            <span>Closed</span>
            <b>{credit.closed.n}</b>
            <b>{usd(credit.closed.sum)}</b>
          </div>
          <div className="mb-dc-sums">
            <span>
              <small>coll. + closed</small>
              <b>{credit.collections.n + credit.closed.n}</b>
            </span>
            <span>
              <small>amount</small>
              <b>{usd(credit.collections.sum + credit.closed.sum)}</b>
            </span>
          </div>
        </DashCol>
        <DashCol tone="owed" go="owed" onGo={onGo}>
          <h3>Outstanding</h3>
          <div className="mb-dc-grid is-2">
            {owed.map(o => (
              <Frag key={o.label}>
                <span title={o.note}>{o.label}</span>
                <b>{usd(o.sum)}</b>
              </Frag>
            ))}
          </div>
          <div className="mb-dc-sums">
            <span>
              <small>total</small>
              <b>{usd(owedSum)}</b>
            </span>
          </div>
        </DashCol>
      </div>
      {tabs}
    </section>
    </>
  );
}

/** Bureau → short key ('ex' | 'eq' | 'tu'); the colors live in globals.css as .bu-ex / .bu-eq / .bu-tu. */
export function bureauKey(name: string): 'ex' | 'eq' | 'tu' | '' {
  const n = name.toLowerCase();
  return n.startsWith('ex') ? 'ex' : n.startsWith('eq') ? 'eq' : n.startsWith('t') ? 'tu' : '';
}

/** One dashboard row: name + figures in the parent grid, the whole row clicks through to its panel. */
function DashRow({ label, title, onOpen, children }: { label: string; title?: string; onOpen: () => void; children: ReactNode }) {
  return (
    <div
      className="mb-dc-row"
      onClick={e => {
        e.stopPropagation();
        onOpen();
      }}
    >
      <button type="button" className="mb-dc-link" title={title || label}>
        {label}
      </button>
      {children}
    </div>
  );
}

function DashCol({ tone, go, onGo, children }: { tone: string; go: string; onGo: (where: string) => void; children: ReactNode }) {
  return (
    <div
      className={`mb-dc tone-${tone}`}
      role="button"
      tabIndex={0}
      onClick={() => onGo(go)}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onGo(go);
        }
      }}
    >
      {children}
    </div>
  );
}

function Frag({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
