'use client';

/**
 * Outstanding (was "What I owe"), from Randy's 2026-10-22 drawings: every MD ticket in ONE box —
 * collapsed by source (count · sum · sum with the MVA flag fee), each source opens to its tickets
 * (flag · date · amount · amount with flag · plan sign) — out-of-state tickets the same way below it,
 * then part 2 in three columns: Pay laters · Taxes / Legal · Projects / Required.
 */

import { useState, type ReactNode } from 'react';
import { amountOf, parseSheetDate, type Cell, type MoneyModel, type Table } from '../../lib/money';
import { fromDayKey, money, type BillDue } from '../../lib/schedule';
import { isSettled, type DebtFile, type DebtItem, type DebtMarks } from '../../lib/debtFile';
import { isLedgerPaid } from '../../lib/moneyLedger';
import { readSaved, writeSaved } from '../../lib/storage';
import { isOwedDone, setOwedDone, useOwedDone, type OwedDone } from '../../lib/owedComplete';

type CellView = (c: Cell | undefined, placeholder?: string) => ReactNode;

/** MVA administrative flag fee per flagged ticket (the 10/15 MVA letter: 13 × $30). */
export const FLAG_FEE = 30;
const OPEN_KEY = 'lifehub-outstanding-open';

const usd = (n?: number | null) => (n === undefined || n === null ? '?' : money(n));
const md = (k?: string) => (k ? fromDayKey(k.slice(0, 10)).toLocaleDateString([], { month: 'short', day: 'numeric', year: k.slice(0, 4) === String(new Date().getFullYear()) ? undefined : '2-digit' }) : '—');
const daysUntil = (d: string) => Math.ceil((new Date(`${d}T23:59:59`).getTime() - Date.now()) / 86400000);
/** A sum with an unknown amount in it: "$310 + ?", or just "? + $30" when the known part is only fees. */
const unk = (n: number, unknown: boolean) => (!unknown ? usd(n) : n ? `${usd(n)} + ?` : '?');
const counts = (i: DebtItem, marks: DebtMarks) => !i.unverified && !isSettled(marks[i.id]);
const isFlagged = (i: DebtItem) => Boolean(i.ticket?.flagged) && !/^not /i.test(i.ticket?.flagged || '');

type Source = { id: string; label: string; items: DebtItem[]; how?: string; plan?: 'yes' | 'ask' };

const MD_SOURCES: Array<[string, string]> = [
  ['city', 'Baltimore City'],
  ['county', 'Baltimore County'],
  ['ccu', 'Work zone · CCU'],
  ['mdta', 'MDTA (toll flag)'],
];
const OOS_SOURCES: Array<[string, string]> = [
  ['dc-', 'Washington, DC'],
  ['ny-', 'New York · New Jersey'],
  ['de-', 'Delaware'],
];

function mdSources(file: DebtFile): Source[] {
  const md = file.items.filter(i => i.group === 'md');
  const steps = file.registration?.steps || [];
  const out: Source[] = MD_SOURCES.map(([id, label]) => {
    const st = steps.find(s => s.id === id);
    return { id, label, items: md.filter(i => i.step === id), how: st?.where, plan: st?.plan?.state === 'yes' || st?.plan?.state === 'ask' ? st.plan.state : undefined };
  });
  const rest = md.filter(i => !MD_SOURCES.some(([id]) => id === i.step));
  if (rest.length) out.push({ id: 'other', label: 'Other MD', items: rest });
  const wv = file.items.filter(i => i.group === 'wv');
  if (wv.length) out.push({ id: 'wv', label: 'Old WV plate (2025)', items: wv, how: 'Not flagged in MD — check whether these were paid.' });
  return out.filter(s => s.items.length);
}

function oosSources(file: DebtFile): Source[] {
  const oos = file.items.filter(i => i.group === 'oos');
  return OOS_SOURCES.map(([p, label]) => ({ id: p, label, items: oos.filter(i => i.id.startsWith(p)) })).filter(s => s.items.length);
}

const extraOf = (i: DebtItem, kind: 'md' | 'oos') => (kind === 'md' ? (isFlagged(i) ? FLAG_FEE : 0) : i.maybe || 0);
function sums(items: DebtItem[], marks: DebtMarks, kind: 'md' | 'oos') {
  const live = items.filter(i => counts(i, marks));
  const sum = live.reduce((s, i) => s + (i.amount || 0), 0);
  const extra = live.reduce((s, i) => s + extraOf(i, kind), 0);
  return { n: live.length, sum, withExtra: sum + extra, unknown: live.some(i => i.amount === null) };
}

/** Totals the header dashboard shows. */
export function ticketTotals(file: DebtFile | null, marks: DebtMarks) {
  if (!file) return { md: 0, mdFlag: 0, oos: 0, oosFee: 0 };
  const m = sums([...file.items.filter(i => i.group === 'md' || i.group === 'wv')], marks, 'md');
  const o = sums(file.items.filter(i => i.group === 'oos'), marks, 'oos');
  return { md: m.sum, mdFlag: m.withExtra, oos: o.sum, oosFee: o.withExtra };
}

function TicketBox({ title, tone, kind, sources, marks, onOpen, head, foot }: { title: string; tone: string; kind: 'md' | 'oos'; sources: Source[]; marks: DebtMarks; onOpen: (id: string) => void; head?: ReactNode; foot?: ReactNode }) {
  const [open, setOpenState] = useState<Record<string, boolean>>(() => readSaved(OPEN_KEY, {}));
  const toggle = (id: string) => {
    const next = { ...open, [id]: !open[id] };
    setOpenState(next);
    writeSaved(OPEN_KEY, next);
  };
  const all = sums(sources.flatMap(s => s.items), marks, kind);
  const extraLabel = kind === 'md' ? 'With flag' : 'With fees';
  return (
    <section className={`mny-sec tone-${tone} ob-box`}>
      <header className="mny-sec-head">
        <div className="mny-sec-titles">
          <h2>{title}</h2>
          {head ? <p>{head}</p> : null}
        </div>
        <div className="mny-sec-figure">
          <b>{usd(all.withExtra)}</b>
          <span>
            {all.n} tickets · {usd(all.sum)} before {kind === 'md' ? 'flag fees' : 'fees'}
          </span>
        </div>
      </header>
      <div className="mny-sec-body">
        <div className="ob-t" role="table" aria-label={title}>
          <div className="ob-r ob-h" role="row">
            <span>Source</span>
            <span className="num">Tickets</span>
            <span className="num">Sum</span>
            <span className="num">{extraLabel}</span>
          </div>
          {sources.map(s => {
            const t = sums(s.items, marks, kind);
            const isOpen = Boolean(open[`${kind}:${s.id}`]);
            return (
              <div key={s.id} className={`ob-src${isOpen ? ' is-open' : ''}`}>
                <button type="button" className="ob-r ob-srow" role="row" aria-expanded={isOpen} onClick={() => toggle(`${kind}:${s.id}`)}>
                  <span className="ob-name">
                    <i className="mny-fold-chev" aria-hidden="true" />
                    {s.label}
                    {s.plan ? <em className={`dbt-plan is-${s.plan}`}>{s.plan === 'yes' ? 'Plan ✓' : 'Plan?'}</em> : null}
                  </span>
                  <span className="num">{t.n}</span>
                  <span className="num">{unk(t.sum, t.unknown)}</span>
                  <span className="num">
                    <b>{unk(t.withExtra, t.unknown)}</b>
                  </span>
                </button>
                {isOpen ? (
                  <div className="ob-tickets">
                    {s.how ? <p className="ob-how">{s.how}</p> : null}
                    {[...s.items]
                      .sort((a, b) => (a.ticket?.date || '').localeCompare(b.ticket?.date || ''))
                      .map(i => {
                        const settled = isSettled(marks[i.id]);
                        const extra = extraOf(i, kind);
                        return (
                          <button key={i.id} type="button" className={`ob-r ob-tk${settled ? ' is-settled' : ''}`} onClick={() => onOpen(i.id)} title={i.sub || i.name}>
                            <span className="ob-name">
                              <i className={`ob-flag${isFlagged(i) ? ' is-on' : ''}`} title={i.ticket?.flagged || 'no flag'}>
                                {isFlagged(i) ? '⚑' : ''}
                              </i>
                              <b className="ob-date">{md(i.ticket?.date)}</b>
                              <span className="ob-where">{i.name.replace(/ — (\d+) in a (\d+)/, ' · $1/$2').replace(/ \((\w{3} \d+[^)]*)\)$/, '')}</span>
                              {i.plan?.state === 'yes' || i.plan?.state === 'ask' ? <em className={`dbt-plan is-${i.plan.state}`}>{i.plan.state === 'yes' ? 'Plan ✓' : 'Plan?'}</em> : null}
                              {marks[i.id] ? <em className={`dbt-mark is-${marks[i.id].status}`}>{marks[i.id].status}</em> : null}
                            </span>
                            <span />
                            <span className="num">{usd(i.amount)}</span>
                            <span className="num">{extra ? `${i.amount === null ? '? + ' : ''}${usd((i.amount || 0) + extra)}` : usd(i.amount)}</span>
                          </button>
                        );
                      })}
                  </div>
                ) : null}
              </div>
            );
          })}
          <div className="ob-r ob-foot" role="row">
            <span>Sum</span>
            <span className="num">{all.n}</span>
            <span className="num">{usd(all.sum)}</span>
            <span className="num">
              <b>{usd(all.withExtra)}</b>
            </span>
          </div>
        </div>
        {foot}
      </div>
    </section>
  );
}

// ─────────────────────────── part 2 ───────────────────────────

export type OwedLine = { recurring?: boolean; key: string; name: string; amount?: number; cell?: Cell; date?: string; note?: string; itemId?: string; done?: boolean; unverified?: boolean };
const rowsOf = (t?: Table | null) => (t?.rows || []).filter(r => r.some(c => c.text.trim()));
const lineSum = (xs: OwedLine[]) => xs.filter(x => !x.done && !x.unverified).reduce((s, x) => s + (x.amount || 0), 0);

export function outstandingParts(model: MoneyModel | null, file: DebtFile | null, marks: DebtMarks, monthDues: BillDue[], paidAt: Record<string, string>, owedDone: OwedDone = {}) {
  const nc = (re: RegExp) => model?.nonCredit.find(t => re.test(t.title)) || null;
  const item = (i: DebtItem): OwedLine => ({ key: i.id, name: i.name, amount: i.amount ?? undefined, itemId: i.id, note: i.status, done: isSettled(marks[i.id]), unverified: i.unverified });
  const sheetLine = (r: Cell[], name: number, amt: number, note?: number, date?: number): OwedLine => ({
    key: `${r[0].tab}:${r[0].r}`,
    name: r[name]?.text.trim() || '',
    cell: r[amt],
    amount: amountOf(r[amt]?.text || ''),
    note: note !== undefined ? r[note]?.text : undefined,
    date: date !== undefined && r[date]?.text ? parseSheetDate(r[date].text) : undefined,
    done: r.some(c => c.struck) || (note !== undefined && /complete|paid/i.test(r[note]?.text || '')),
  });
  const plDues = monthDues.filter(d => d.bill.kind === 'paylater' && !isLedgerPaid(d, paidAt) && !d.skipped).sort((a, b) => a.due.localeCompare(b.due));

  const payLater: OwedLine[] = rowsOf(model?.paylaterSums).map(r => {
    const prov = r[0].text.replace(/\s*sum$/i, '').trim();
    const next = plDues.find(d => `${d.bill.name} ${d.bill.notes || ''}`.toLowerCase().includes(prov.toLowerCase()));
    return { ...sheetLine(r, 0, 1), name: prov, date: next?.due, note: next ? `next ${money(next.bill.amount)}` : undefined };
  });
  const cashAdv: OwedLine[] = rowsOf(model?.cashAdvances).map(r => sheetLine(r, 1, 2, undefined, 0));
  const liab = nc(/non.?car|liabilit/i);
  const advances: OwedLine[] = rowsOf(liab)
    .filter(r => !/t-?mobile/i.test(r.map(c => c.text).join(' ')))
    .map(r => sheetLine(r, 0, 3, 1));

  const liabItems = (file?.items || []).filter(i => i.group === 'liability');
  const taxes: OwedLine[] = [
    ...liabItems.filter(i => !/t-?mobile/i.test(i.name)).map(item),
    ...rowsOf(nc(/regulat/i))
      .filter(r => !/tax/i.test(r[0].text))
      .map(r => sheetLine(r, 0, 3, 1)),
  ];
  const projects: OwedLine[] = [
    ...rowsOf(nc(/repair/i)).map(r => sheetLine(r, 0, 3, 1)),
    ...liabItems.filter(i => /t-?mobile/i.test(i.name)).map(item),
    ...rowsOf(model?.outstanding)
      .filter(r => !/ticket/i.test(r[0].text))
      .map(r => sheetLine(r, 0, 1, 2)),
  ];
  // Marked complete on Life Hub (recurring pay-later plans only for this month).
  const mark = (xs: OwedLine[], recurring = false) => xs.map(x => ({ ...x, recurring, done: x.done || isOwedDone(owedDone, x.key) }));
  return { payLater: mark(payLater, true), cashAdv: mark(cashAdv), advances: mark(advances), taxes: mark(taxes), projects: mark(projects), sum: lineSum };
}

function OwedCol({ tone, title, groups, cell, onOpen }: { tone: string; title: string; groups: Array<[string, OwedLine[]]>; cell: CellView; onOpen: (id: string) => void }) {
  const total = groups.reduce((s, [, xs]) => s + lineSum(xs), 0);
  const line = (x: OwedLine) => (
    <div key={x.key} className={`ob-line${x.done ? ' is-settled' : ''}`}>
      {x.itemId ? (
        <button type="button" className="ob-line-name" onClick={() => onOpen(x.itemId!)} title={x.note}>
          {x.name}
        </button>
      ) : (
        <span className="ob-line-name" title={x.note}>
          {x.name}
        </span>
      )}
      <span className="num">{x.cell ? cell(x.cell, '—') : usd(x.amount)}</span>
      <small>{x.unverified ? 'unverified · not counted' : x.date ? md(x.date) : x.done ? 'done' : x.note && x.note.length < 22 ? x.note : '—'}</small>
      {x.itemId ? <span /> : (
        <button type="button" className="ob-check" onClick={() => setOwedDone(x.key, !x.done, x.recurring)} title={x.done ? 'Put back on the list' : x.recurring ? 'Paid for this month' : 'Complete — takes it off the list'} aria-label={`${x.done ? 'Reopen' : 'Complete'} ${x.name}`}>
          {x.done ? '↩' : '✓'}
        </button>
      )}
    </div>
  );
  return (
    <section className={`mny-sec tone-${tone} ob-col`}>
      <header className="mny-sec-head">
        <div className="mny-sec-titles">
          <h2>{title}</h2>
        </div>
        <div className="mny-sec-figure">
          <b>{usd(total)}</b>
        </div>
      </header>
      <div className="mny-sec-body">
        {groups.map(([label, xs]) =>
          xs.length ? (
            <div key={label} className="ob-grp">
              {groups.length > 1 ? (
                <h5>
                  {label} <span>{usd(lineSum(xs))}</span>
                </h5>
              ) : null}
              {xs.filter(x => !x.done || x.itemId).map(x => line(x))}
              {xs.some(x => x.done && !x.itemId) ? (
                <details className="ob-done">
                  <summary>Done · {xs.filter(x => x.done && !x.itemId).length}</summary>
                  {xs.filter(x => x.done && !x.itemId).map(x => line(x))}
                </details>
              ) : null}
            </div>
          ) : null,
        )}
      </div>
    </section>
  );
}

export function OutstandingView({ file, marks, onOpen, onLetter, model, monthDues, paidAt, cell }: { file: DebtFile; marks: DebtMarks; onOpen: (id: string) => void; onLetter: (id: string) => void; model: MoneyModel | null; monthDues: BillDue[]; paidAt: Record<string, string>; cell: CellView }) {
  const reg = file.registration;
  const days = reg ? daysUntil(reg.due) : 0;
  const owedDone = useOwedDone();
  const parts = outstandingParts(model, file, marks, monthDues, paidAt, owedDone);
  return (
    <div className="mny-stack">
      <TicketBox
        title="MD tickets"
        tone="owed"
        kind="md"
        sources={mdSources(file)}
        marks={marks}
        onOpen={onOpen}
        head={reg ? `${reg.vehicle} · registration renews by ${md(reg.due)} (${days} days) — every flag must be cleared first. Flag fee $${FLAG_FEE} per flagged ticket.` : undefined}
        foot={
          file.letters.length ? (
            <div className="dbt-letters ob-letters">
              <small>Letters:</small>
              {[...file.letters]
                .sort((a, b) => b.date.localeCompare(a.date))
                .map(l => (
                  <button key={l.id} type="button" className="dbt-letter" onClick={() => onLetter(l.id)}>
                    <b>{md(l.date)}</b> {l.from.replace('MD Central Collection Unit', 'CCU').replace('MVA Administrative Flag Unit', 'MVA')} <em>{usd(l.total)}</em>
                  </button>
                ))}
            </div>
          ) : null
        }
      />
      <TicketBox title="Out-of-state tickets" tone="sub" kind="oos" sources={oosSources(file)} marks={marks} onOpen={onOpen} head="None block the MD registration. DC can boot a car with 2+ unpaid." />
      <div className="ob-cols">
        <OwedCol
          tone="due"
          title="Pay laters"
          cell={cell}
          onOpen={onOpen}
          groups={[['Pay later', parts.payLater]]}
        />
        <OwedCol
          tone="card"
          title="Cash advances"
          cell={cell}
          onOpen={onOpen}
          groups={[
            ['Cash advances', parts.cashAdv],
            ['Older advances', parts.advances],
          ]}
        />
        <OwedCol tone="plan" title="Taxes / Legal" cell={cell} onOpen={onOpen} groups={[['Taxes', parts.taxes]]} />
        <OwedCol tone="shop" title="Projects / Required" cell={cell} onOpen={onOpen} groups={[['Projects', parts.projects]]} />
      </div>
    </div>
  );
}
