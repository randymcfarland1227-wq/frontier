'use client';

import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  amountOf,
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
  /** Row toggle that crosses the row out in the sheet (Skip / Bought) */
  strike?: { on: string; off: string };
  /** Hide columns whose header and cells are all empty */
  limit?: number;
  rowClass?: (row: Cell[]) => string;
  /** Columns to leave out (indexes) */
  hide?: number[];
  numeric?: number[];
};

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
  return (
    <div className="mtable-wrap">
      <table className="mtable">
        <thead>
          <tr>
            {cols.map(i => (
              <th key={i} className={numeric.has(i) ? 'is-num' : ''}>
                {table.header[i]}
              </th>
            ))}
            {opts.strike ? <th aria-label="Actions" /> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => {
            const group = table.groups?.[ri] || '';
            const showGroup = group && group !== (table.groups?.[ri - 1] || '');
            const struck = row.some(c => c.struck);
            return (
              <Fragment key={`${row[0].r}`}>
                {showGroup ? (
                  <tr className="mtable-group">
                    <td colSpan={cols.length + (opts.strike ? 1 : 0)}>{group}</td>
                  </tr>
                ) : null}
                <tr className={`${struck ? 'is-struck' : ''} ${opts.rowClass?.(row) || ''}`}>
                  {cols.map(i => (
                    <td key={i} className={numeric.has(i) ? 'is-num' : ''}>
                      <EditCell cell={row[i]} onSave={onSave} placeholder="" />
                    </td>
                  ))}
                  {opts.strike ? (
                    <td className="mtable-act">
                      <button
                        type="button"
                        className="row-action ghost"
                        onClick={() =>
                          void onSave([{ tab: row[0].tab, r: row[0].r, c1: row[0].c, c2: row[row.length - 1].c, expect: row[0].text, strike: !struck }])
                        }
                        title={struck ? 'Un-cross it in the sheet' : 'Cross it out in the sheet'}
                      >
                        {struck ? opts.strike.off : opts.strike.on}
                      </button>
                    </td>
                  ) : null}
                </tr>
              </Fragment>
            );
          })}
          {opts.limit && table.rows.length > opts.limit ? (
            <tr className="mtable-more">
              <td colSpan={cols.length + (opts.strike ? 1 : 0)}>+{table.rows.length - opts.limit} more in the sheet</td>
            </tr>
          ) : null}
        </tbody>
        {table.total && table.total.some(c => c.text) ? (
          <tfoot>
            <tr>
              {cols.map(i => (
                <td key={i} className={numeric.has(i) ? 'is-num' : ''}>
                  <EditCell cell={table.total![i]} onSave={onSave} placeholder="" />
                </td>
              ))}
              {opts.strike ? <td /> : null}
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
// The page
// ---------------------------------------------------------------------------

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

  const moneyDues = useMemo(() => dues.filter(d => d.bill.kind || d.days >= 0), [dues]);
  const next7 = moneyDues.filter(d => d.days >= 0 && d.days <= 7);
  const monthEnd = useMemo(() => {
    const t = new Date();
    return new Date(t.getFullYear(), t.getMonth() + 1, 0);
  }, []);
  const restOfMonth = moneyDues.filter(d => d.days >= 0 && fromDayKey(d.due) <= monthEnd);
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
  const openWants = model.wants ? { ...model.wants, rows: model.wants.rows.filter(r => !r.some(c => c.struck)) } : null;
  const openNeeded = model.restockNeeded ? { ...model.restockNeeded, rows: model.restockNeeded.rows.filter(r => !r.some(c => c.struck)) } : null;
  const monthRe = new RegExp(`^(${today.toLocaleDateString('en-US', { month: 'long' })}|${today.toLocaleDateString('en-US', { month: 'short' })})[- ]?(${today.getFullYear()})?$`, 'i');
  const isNow = (row: Cell[]) => (row.slice(0, 2).some(c => monthRe.test(c.text)) ? 'is-now' : '');

  return (
    <div className="settings-view money-view">
      <section className="mpanel glass-panel money-hero">
        <div className="money-hero-head">
          <p className="section-label">Money</p>
          <h1>Radall</h1>
          <span className="mpanel-sub">
            Sheet as of {new Date(model.refreshedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · edits save
            straight to the sheet
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
          <Stat label="Cash on hand" value={model.cashOnHand?.text} />
          <Stat label="Balanced cash" value={model.balancedCash?.text} />
          <Stat label="Due next 7 days" value={money(sum(next7))} sub={`${next7.length} payments`} tone="warn" />
          <Stat label={`Left in ${today.toLocaleDateString([], { month: 'long' })}`} value={money(sum(restOfMonth))} sub={`${restOfMonth.length} payments`} />
          <Stat label="Pay later owed" value={pay?.total?.[1]?.text} sub={pay?.total?.[3]?.text ? `${pay.total[3].text} available` : undefined} />
          <Stat
            label="Cards"
            value={model.cards?.total?.[1]?.text}
            sub={model.cards?.total?.[2]?.text ? `${model.cards.total[2].text} available` : undefined}
          />
          {fico ? <Stat label="Credit score" value={String(Math.round(Number(fico)) || fico)} sub="FICO" /> : null}
        </div>
        {note ? <p className={`money-note is-${note.tone}`} role="status">{note.text}</p> : null}
      </section>

      <div className="money-grid">
        <Panel title="Coming up" sub="Bills, card mins, subscriptions, pay later" className="span-4">
          <ComingUp dues={moneyDues} onPaid={onPaid} />
        </Panel>

        <Panel title="This month" sub="Edit any amount or date — it saves to the sheet" href={link('Randy')} className="span-4">
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

        <Panel title="Cash" sub="Accounts, pending money, cards" href={link('Randy')} className="span-4">
          {model.balancing ? (
            <Sub title={<>Balancing <span>{model.cashOnHand?.text} on hand · {model.balancedCash?.text} balanced</span></>}>
              <SheetTable table={{ ...model.balancing, header: ['Account', ...model.balancing.header.slice(1)] }} onSave={save} />
            </Sub>
          ) : null}
          {model.accounts ? (
            <Sub title="Debit accounts">
              <SheetTable table={model.accounts} onSave={save} />
            </Sub>
          ) : null}
          {model.cards ? (
            <Sub title="Credit cards">
              <SheetTable table={model.cards} onSave={save} />
            </Sub>
          ) : null}
          {model.outstanding ? (
            <Sub title="Outstanding">
              <SheetTable table={model.outstanding} onSave={save} />
            </Sub>
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

        <Panel title="Upcoming spend" sub="Restock and purchases" href={link('Restock/Purchases')} className="span-6">
          <div className="mcols">
            <div>
              {model.upcomingSpend.rows.length ? (
                <div className="mspend-tiles">
                  {model.upcomingSpend.rows.map(([l, v]) => (
                    <span key={l.r} className="mspend-tile">
                      {l.text} <b>{v.text}</b>
                    </span>
                  ))}
                </div>
              ) : null}
              {neededNow ? (
                <Sub title={<>Restock now <span>Yes / Y Low</span></>}>
                  {neededNow.rows.length ? (
                    <SheetTable table={neededNow} onSave={save} opts={{ hide: [2, 3, 6] }} />
                  ) : (
                    <p className="sched-empty">Nothing marked Yes or Y Low.</p>
                  )}
                </Sub>
              ) : null}
              {model.recurring ? (
                <Sub title={<>All re-occurring <span>{model.recurring.rows.length} items · set Needed? to Yes / Y Low / No</span></>} open={false}>
                  <SheetTable table={model.recurring} onSave={save} opts={{ hide: [3] }} />
                </Sub>
              ) : null}
            </div>
            <div>
              {openNeeded ? (
                <Sub title={<>Needed purchases <span>{openNeeded.rows.length} open</span></>}>
                  {openNeeded.rows.length ? (
                    <SheetTable table={openNeeded} onSave={save} opts={{ strike: { on: 'Bought', off: 'Undo' }, hide: [0, 3] }} />
                  ) : (
                    <p className="sched-empty">All bought.</p>
                  )}
                </Sub>
              ) : null}
              {openWants ? (
                <Sub title={<>Wants <span>{openWants.rows.length} open</span></>}>
                  <SheetTable table={openWants} onSave={save} opts={{ strike: { on: 'Bought', off: 'Undo' }, hide: [0, 3] }} />
                </Sub>
              ) : null}
            </div>
          </div>
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
            {model.creditCards ? (
              <Sub title="Credit cards">
                <SheetTable table={model.creditCards} onSave={save} />
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
