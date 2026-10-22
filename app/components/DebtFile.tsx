'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Cell, MoneyModel } from '../../lib/money';
import type { BillDue } from '../../lib/schedule';
import { OutstandingView } from './OutstandingView';
import { isSettled, owedOf, useDebtFile, type Bureau, type DebtFile as File, type DebtItem, type DebtLetter, type DebtMark, type DebtMarks, type DebtPlan, type MarkStatus } from '../../lib/debtFile';

// The debt file, two pages of one story.
//  Credit   → one dense table (owner, balance, bureaus, dates, falls-off, lowest settlement, offer).
//  Outstanding → MD tickets by source, out-of-state, then pay laters · taxes / legal · projects (OutstandingView.tsx).
// Every row is an entity: tap it for its pop-out (owners, timeline, offers, plan, letters).

/** 'credit' = what touches the credit reports; 'owed' = tickets, tolls, taxes and other non-credit liabilities. */
export type DebtScope = 'credit' | 'owed';
type Dlg = { kind: 'item' | 'letter'; id: string };
/** Rough floor debt buyers settle for — an estimate for planning, never a promise. */
const FLOOR = 0.25;

const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: n % 1 ? 2 : 0 });
const amt = (n: number | null | undefined) => (n === null || n === undefined ? '?' : usd(n));
const shortDate = (d: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  if (!m) return d;
  return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
};
/** '2030-10' → 'Oct 2030' */
const monthYear = (d?: string) => {
  const m = d ? /^(\d{4})-(\d{2})/.exec(d) : null;
  return m ? new Date(+m[1], +m[2] - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '—';
};
/** "Kenilworth Dr — 46 in a 30" → "Kenilworth Dr · 46/30" */
const compactName = (n: string) => n.replace(/ — (\d+) in a (\d+)/, ' · $1/$2').replace(/ — /g, ' · ');

const MARKS: Array<[MarkStatus, string]> = [
  ['paid', 'Paid'],
  ['plan', 'On a plan'],
  ['disputed', 'Disputing'],
  ['gone', 'Not owed / gone'],
];
const MARK_LABEL: Record<MarkStatus, string> = { paid: 'Paid', plan: 'On a plan', disputed: 'Disputing', gone: 'Gone' };
const BUREAUS: Array<[Bureau, string]> = [
  ['EX', 'Experian'],
  ['EQ', 'Equifax'],
  ['TU', 'TransUnion'],
];
/** A bureau line like "Was there May 14 — gone by Jul 14" keeps the history but doesn't count as on the report now. */
const onReport = (line?: string | null) => Boolean(line) && !/^(was there|gone|not )/i.test(line || '');
const PLAN_LABEL: Record<DebtPlan['state'], string> = { yes: 'Plan offered', ask: 'Ask about a plan', none: 'Pay in full' };

export function DebtFile({ scope, sheet, scores = [], model = null, monthDues = [], paidAt = {}, cell }: { scope: DebtScope; sheet?: ReactNode; scores?: Array<{ bureau: string; date: string; score: number }>; model?: MoneyModel | null; monthDues?: BillDue[]; paidAt?: Record<string, string>; cell?: (c: Cell | undefined, placeholder?: string) => ReactNode }) {
  const { file, marks, status, refresh, setMark } = useDebtFile();
  const [dlg, setDlg] = useState<Dlg | null>(null);

  if (!file) {
    return (
      <div className="dbt-empty">
        {status === 'loading' ? 'Loading your debt file…' : status === 'locked' ? 'This device isn’t linked to your backup key, so the private debt file can’t load.' : status === 'empty' ? 'No debt file saved yet.' : 'Couldn’t reach the Worker.'}
        {status !== 'loading' ? (
          <button type="button" className="mny-btn" onClick={() => void refresh()}>
            Try again
          </button>
        ) : null}
      </div>
    );
  }

  const open = dlg?.kind === 'item' ? file.items.find(i => i.id === dlg.id) : undefined;
  const openLetter = dlg?.kind === 'letter' ? file.letters.find(l => l.id === dlg.id) : undefined;
  const onOpen = (id: string) => setDlg({ kind: 'item', id });
  const onLetter = (id: string) => setDlg({ kind: 'letter', id });

  return (
    <div className="dbt">
      {scope === 'credit' ? (
        <CreditView file={{ ...file, scores: [...(file.scores || []), ...scores] }} marks={marks} onOpen={onOpen} onRefresh={() => void refresh()} extra={sheet} />
      ) : (
        <OutstandingView file={file} marks={marks} onOpen={onOpen} onLetter={onLetter} model={model} monthDues={monthDues} paidAt={paidAt} cell={cell || (c => c?.text || '—')} />
      )}
      {file.sources ? <p className="dbt-src">Sources: {file.sources}</p> : null}
      {open ? <Story item={open} file={file} mark={marks[open.id]} onMark={m => void setMark(open.id, m)} onClose={() => setDlg(null)} onLetter={onLetter} /> : null}
      {openLetter ? <LetterStory letter={openLetter} file={file} marks={marks} onOpen={onOpen} onClose={() => setDlg(null)} /> : null}
    </div>
  );
}

/* ───────────────────────────── Credit ───────────────────────────── */

type Settle = { seen: number | null; seenActive: boolean; floor: number };
function settleOf(i: DebtItem): Settle {
  const seen = i.settle?.lowest ?? null;
  return { seen, seenActive: Boolean(i.offers?.some(o => o.active)), floor: Math.round((i.amount || 0) * FLOOR * 100) / 100 };
}
const pct = (part: number, whole: number | null) => (whole ? `${Math.round((part / whole) * 100)}%` : '');
const fallsKey = (i: DebtItem) => i.dates?.fallsOff || '9999-99';

function CreditView({ file, marks, onOpen, onRefresh, extra }: { file: File; marks: DebtMarks; onOpen: (id: string) => void; onRefresh: () => void; extra?: ReactNode }) {
  const credit = file.items.filter(i => i.group === 'credit');
  const behind = file.items.filter(i => i.group === 'behind');
  const live = credit.filter(i => !isSettled(marks[i.id]));
  const rows = [...credit].sort((a, b) => (isSettled(marks[a.id]) ? 1 : 0) - (isSettled(marks[b.id]) ? 1 : 0) || (b.amount || 0) - (a.amount || 0));
  const owed = owedOf(credit, marks);
  const best = live.reduce((s, i) => {
    const st = settleOf(i);
    return s + (st.seen !== null ? Math.min(st.seen, i.amount || 0) : st.floor);
  }, 0);
  const aging = [...live].filter(i => i.dates?.fallsOff).sort((a, b) => fallsKey(a).localeCompare(fallsKey(b)));
  const years = [...new Set(aging.map(i => (i.dates?.fallsOff || '').slice(0, 4)))];
  const firstOff = aging[0];

  return (
    <>
      <section className="dbt-sum dbt-sum-credit" aria-label="Credit scores">
        <div className="dbt-sum-total">
          <span>What’s hurting my credit</span>
          <b>{usd(owed + owedOf(behind, marks))}</b>
          <small>
            {live.length} collections & charge-offs · {behind.length} past due · as of {shortDate(file.asOf)} ·{' '}
            <button type="button" className="dbt-link" onClick={onRefresh}>
              refresh
            </button>
          </small>
        </div>
        {BUREAUS.map(([b, label]) => {
          const [now, prev] = (file.scores || []).filter(x => x.bureau === label).sort((a, c) => c.date.localeCompare(a.date));
          return (
            <div key={b} className="dbt-tile tone-card" aria-label={`${label} score`}>
              <span>{label}</span>
              <b>{now ? now.score : '—'}</b>
              <small title={now && prev ? `${now.score - prev.score >= 0 ? '+' : ''}${now.score - prev.score} since ${shortDate(prev.date)}` : undefined}>
                {now ? shortDate(now.date) : 'no report yet'}
                {now && prev ? <em className={now.score >= prev.score ? 'dbt-up' : 'dbt-down'}> {now.score - prev.score >= 0 ? '▲' : '▼'}{Math.abs(now.score - prev.score)}</em> : null}
              </small>
            </div>
          );
        })}
      </section>

      {extra}

      <Sec tone="owed" title="Collections & charge-offs" figure={usd(owed)} figureLabel="owed" hint="Tap a row for its full story: owners, timeline, offers, letters.">
        <div className="dbt-ct">
          <div className="dbt-ct-head dbt-ct-row">
            <span>Account</span>
            <span>Owner now</span>
            <span className="num">Owed</span>
            <span title="Experian · Equifax · TransUnion">EX EQ TU</span>
            <span>Started</span>
            <span>Falls off</span>
            <span>Lowest settle</span>
            <span>Offer</span>
          </div>
          {rows.map(i => {
            const st = settleOf(i);
            const now = i.owners?.[i.owners.length - 1];
            const act = (i.offers || []).find(o => o.active);
            const d = i.dates;
            return (
              <button key={i.id} type="button" className={`dbt-row dbt-ct-row${isSettled(marks[i.id]) ? ' is-settled' : ''}`} onClick={() => onOpen(i.id)}>
                <span className="dbt-name" data-l="Account">
                  <b>{i.name}</b>
                  <small>{i.status}</small>
                </span>
                <span className="dbt-who" data-l="Owner now">
                  {now ? now.name : '—'}
                </span>
                <span className="num" data-l="Owed">
                  <MarkChip mark={marks[i.id]} />
                  {amt(i.amount)}
                </span>
                <span className="dbt-bureaus" data-l="Reports">
                  {BUREAUS.map(([b, label]) => (
                    <i key={b} className={onReport(i.reports?.[b]) ? 'on' : ''} title={`${label}: ${i.reports?.[b] || 'not reported'}`}>
                      {b}
                    </i>
                  ))}
                </span>
                <span className="dbt-two" data-l="Started">
                  {d?.opened ? <b>{shortDate(d.opened)}</b> : <b>—</b>}
                  <small>{d?.dofd ? `1st late ~${monthYear(d.dofd)}` : d?.openedLabel || ''}</small>
                </span>
                <span className="dbt-two" data-l="Falls off">
                  <b className={`dbt-fall is-${d?.basis || 'none'}`}>{d?.fallsOff ? `${d.basis === 'latest' ? 'by ' : '~'}${monthYear(d.fallsOff)}` : '—'}</b>
                  <small>{d?.basis === 'est' ? 'est.' : d?.basis === 'latest' ? 'latest · real date earlier' : ''}</small>
                </span>
                <span className="dbt-two" data-l="Lowest settle">
                  {st.seen !== null ? (
                    <>
                      <b className="dbt-seen">
                        {usd(st.seen)} · {pct(st.seen, i.amount)}
                      </b>
                      <small>
                        seen {i.settle?.who}
                        {st.seenActive ? '' : ' · expired'} · floor ~{usd(Math.min(st.floor, st.seen))}
                      </small>
                    </>
                  ) : isSettled(marks[i.id]) || !i.amount ? (
                    <b>—</b>
                  ) : (
                    <>
                      <b className="dbt-est">~{usd(st.floor)} · 25%</b>
                      <small>estimate · none seen</small>
                    </>
                  )}
                </span>
                <span className="dbt-offer-cell" data-l="Offer" title={act?.text}>
                  {act ? (
                    <>
                      <b>{act.who}</b>
                      <small>{act.expires ? `by ${shortDate(act.expires)} · ` : ''}{act.text}</small>
                    </>
                  ) : (
                    <small>{i.plan?.state === 'yes' ? 'Plan ✓' : 'no active offer'}</small>
                  )}
                </span>
              </button>
            );
          })}
          <div className="dbt-ct-total dbt-ct-row">
            <span>
              <b>Total</b>
            </span>
            <span />
            <span className="num">
              <b>{usd(owed)}</b>
            </span>
            <span />
            <span />
            <span />
            <span className="dbt-two">
              <b className="dbt-est">~{usd(best)}</b>
              <small>if each settled at its lowest seen / ~25% floor (estimate)</small>
            </span>
            <span />
          </div>
        </div>
        <p className="dbt-foot">
          “Falls off” = 7 years from the first missed payment. “~” is inferred from the Jul 2026 reports and the letters; “by” is the latest it can be (the date the collector added it) — the real date is earlier. Paying a collection never restarts the clock. Floors are planning estimates, not offers; get any settlement in writing first.
        </p>
      </Sec>

      <div className="dbt-cols dbt-cols-even">
        {aging.length ? (
          <Sec tone="save" title="When it ages off" hint={firstOff ? `First to go: ${firstOff.name} · ${firstOff.dates?.basis === 'latest' ? 'by ' : '~'}${monthYear(firstOff.dates?.fallsOff)}` : undefined}>
            <div className="dbt-years">
              {years.map(y => (
                <div key={y}>
                  <h5>{y}</h5>
                  {aging
                    .filter(i => i.dates?.fallsOff?.startsWith(y))
                    .map(i => (
                      <button key={i.id} type="button" className="dbt-mini" onClick={() => onOpen(i.id)}>
                        <b>{monthYear(i.dates?.fallsOff).slice(0, 3)}</b> {i.name} <em>{i.dates?.basis === 'est' ? 'est.' : 'latest'}</em>
                      </button>
                    ))}
                </div>
              ))}
            </div>
          </Sec>
        ) : null}
        <Sec tone="due" title="Behind now — not collections yet" figure={usd(owedOf(behind, marks))} hint="Open accounts with a missed payment. Pay these and they never reach collections.">
          {behind.map(i => {
            const pb = file.payby?.find(p => i.name.toLowerCase().includes(p.match.toLowerCase()));
            return (
              <button key={i.id} type="button" className={`dbt-row dbt-plain-row${isSettled(marks[i.id]) ? ' is-settled' : ''}`} onClick={() => onOpen(i.id)}>
                <span className="dbt-name">
                  <b>{i.name}</b>
                  <small>{pb ? `pay by ${shortDate(pb.date)} · ${pb.why}` : i.sub}</small>
                </span>
                <span className="dbt-status">{i.status}</span>
                <span className="num">
                  <MarkChip mark={marks[i.id]} />
                  {amt(i.amount)}
                </span>
              </button>
            );
          })}
        </Sec>
      </div>
    </>
  );
}

function PlanChip({ plan }: { plan: DebtPlan }) {
  return plan.state === 'none' ? null : <em className={`dbt-plan is-${plan.state}`}>{plan.state === 'yes' ? 'Plan ✓' : 'Plan?'}</em>;
}

/** Name and amount only — everything else lives in the pop-out. */
function TicketRow({ item, marks, onOpen }: { item: DebtItem; marks: DebtMarks; onOpen: (id: string) => void }) {
  return (
    <button type="button" className={`dbt-tk${isSettled(marks[item.id]) ? ' is-settled' : ''}`} onClick={() => onOpen(item.id)} title={item.sub}>
      <span className="dbt-tk-name">{compactName(item.name)}</span>
      {item.unverified ? <em className="dbt-mark">unverified</em> : null}
      {item.plan ? <PlanChip plan={item.plan} /> : null}
      <MarkChip mark={marks[item.id]} />
      <span className="num">{amt(item.amount)}</span>
    </button>
  );
}

function MarkChip({ mark }: { mark?: DebtMark }) {
  return mark ? <em className={`dbt-mark is-${mark.status}`}>{MARK_LABEL[mark.status]}</em> : null;
}

function Story({ item, file, mark, onMark, onClose, onLetter }: { item: DebtItem; file: File; mark?: DebtMark; onMark: (m: DebtMark | null) => void; onClose: () => void; onLetter: (id: string) => void }) {
  const [note, setNote] = useState(mark?.note || '');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const letters = (item.letters || []).map(id => file.letters.find(l => l.id === id)).filter(Boolean);
  const events = [...item.timeline].sort((a, b) => a.date.localeCompare(b.date));
  return (
    <div className="bal-dlg-backdrop" onClick={onClose}>
      <div className="bal-dlg dbt-story" role="dialog" aria-modal="true" aria-label={`${item.name} story`} onClick={e => e.stopPropagation()}>
        <button type="button" className="bal-dlg-x" onClick={onClose} aria-label="Close">
          ✕
        </button>
        <header className="dbt-story-head">
          <div>
            <h3>{item.name}</h3>
            <p>{item.sub}</p>
          </div>
          <div className="dbt-story-amt">
            <b>{amt(item.amount)}</b>
            <span>
              {item.status}
              {item.maybe ? ` · + up to ${usd(item.maybe)}` : ''}
              {item.blocksRegistration ? ' · blocks renewal' : ''}
            </span>
          </div>
        </header>

        <div className="dbt-marks">
          {MARKS.map(([s, label]) => (
            <button key={s} type="button" className={`mny-btn${mark?.status === s ? ' is-on' : ''}`} onClick={() => onMark(mark?.status === s ? null : { status: s, note })}>
              {label}
            </button>
          ))}
          <input className="dbt-note" placeholder="Note (confirmation #, who you talked to…)" value={note} onChange={e => setNote(e.target.value)} onBlur={() => mark && note !== (mark.note || '') && onMark({ ...mark, note })} />
        </div>

        {item.step && file.registration ? (
          <Block title="Where it sits in the registration">
            <p>
              Step {file.registration.steps.findIndex(x => x.id === item.step) + 1}: <b>{file.registration.steps.find(x => x.id === item.step)?.title}</b> — renewal due {shortDate(file.registration.due)}.
            </p>
          </Block>
        ) : null}

        {item.dates ? (
          <Block title="Dates & when it falls off">
            <dl className="dbt-dl">
              {item.dates.opened ? (
                <>
                  <dt>{item.dates.openedLabel || 'Opened'}</dt>
                  <dd>{shortDate(item.dates.opened)}</dd>
                </>
              ) : null}
              {item.dates.dofd ? (
                <>
                  <dt>First missed payment</dt>
                  <dd>~{monthYear(item.dates.dofd)} (estimate)</dd>
                </>
              ) : null}
              <dt>Falls off reports</dt>
              <dd>
                <b>{item.dates.fallsOff ? `${item.dates.basis === 'latest' ? 'by ' : '~'}${monthYear(item.dates.fallsOff)}` : '—'}</b>
                {item.dates.basis === 'est' ? ' (estimate)' : item.dates.basis === 'latest' ? ' (latest possible)' : ''}
              </dd>
            </dl>
            {item.dates.note ? <p className="dbt-muted">{item.dates.note}</p> : null}
          </Block>
        ) : null}

        {item.group === 'credit' && item.amount ? (
          <Block title="Lowest settlement">
            <dl className="dbt-dl">
              {item.settle?.lowest ? (
                <>
                  <dt>Lowest offer seen</dt>
                  <dd>
                    <b>{usd(item.settle.lowest)}</b> · {pct(item.settle.lowest, item.amount)} of {usd(item.amount)} — {item.settle.who}, {item.settle.date ? shortDate(item.settle.date) : ''}
                    {item.offers?.some(o => o.active) ? '' : ' (expired)'}
                  </dd>
                </>
              ) : null}
              <dt>Estimated floor</dt>
              <dd>~{usd(settleOf(item).floor)} · 25% of the balance — a planning estimate, not an offer</dd>
            </dl>
            {item.settle?.note ? <p className="dbt-muted">{item.settle.note}</p> : null}
          </Block>
        ) : null}

        {item.plan ? (
          <Block title="Payment plan">
            <p className={`dbt-planline is-${item.plan.state}`}>
              <b>{PLAN_LABEL[item.plan.state]}.</b> {item.plan.terms}
            </p>
            {item.plan.enroll ? <p>Enroll: {item.plan.enroll}</p> : null}
            {item.plan.source ? <p className="dbt-muted">From: {item.plan.source}</p> : null}
          </Block>
        ) : null}

        {item.ticket ? (
          <Block title="The ticket">
            <dl className="dbt-dl">
              <dt>Issued by</dt>
              <dd>{item.ticket.who}</dd>
              <dt>When</dt>
              <dd>{item.ticket.date}</dd>
              <dt>Where</dt>
              <dd>{item.ticket.where}</dd>
              <dt>Speed / type</dt>
              <dd>{item.ticket.speed}</dd>
              {item.ticket.pin ? (
                <>
                  <dt>PIN</dt>
                  <dd>{item.ticket.pin}</dd>
                </>
              ) : null}
              {item.ticket.flagged ? (
                <>
                  <dt>MVA flag</dt>
                  <dd>{item.ticket.flagged}</dd>
                </>
              ) : null}
            </dl>
          </Block>
        ) : null}

        {item.reports ? (
          <Block title="On my credit reports">
            <div className="dbt-rep">
              {BUREAUS.map(([b, label]) => (
                <div key={b} className={onReport(item.reports?.[b]) ? 'on' : ''}>
                  <b>{label}</b>
                  <span>{item.reports?.[b] || 'Not reported'}</span>
                </div>
              ))}
            </div>
          </Block>
        ) : null}

        {item.owners?.length ? (
          <Block title="Who has owned / collected it">
            <ol className="dbt-chain">
              {item.owners.map(o => (
                <li key={o.role + o.name}>
                  <small>{o.role}</small>
                  <b>{o.name}</b>
                  {o.from || o.note ? (
                    <span>
                      {o.from ? `since ${shortDate(o.from)}` : ''}
                      {o.from && o.note ? ' · ' : ''}
                      {o.note}
                    </span>
                  ) : null}
                </li>
              ))}
            </ol>
          </Block>
        ) : null}

        {item.offers?.length ? (
          <Block title="Offers">
            {item.offers.map(o => (
              <div key={o.date + o.who} className={`dbt-offer-line${o.active ? ' is-active' : ''}`}>
                <em>{o.active ? 'Active' : 'Expired'}</em>
                <span>
                  {o.text}
                  <small>
                    {o.who} · {shortDate(o.date)}
                    {o.expires ? ` · expired ${shortDate(o.expires)}` : ''}
                  </small>
                </span>
              </div>
            ))}
          </Block>
        ) : null}

        {letters.length ? (
          <Block title="Combination letters it appears in">
            {letters.map(l =>
              l ? (
                <button key={l.id} type="button" className="dbt-offer-line dbt-lbtn" onClick={() => onLetter(l.id)}>
                  <em>{shortDate(l.date)}</em>
                  <span>
                    {l.from} — {l.title}
                    <small>
                      {l.count} item{l.count === 1 ? '' : 's'} · {usd(l.total)}
                    </small>
                  </span>
                </button>
              ) : null,
            )}
          </Block>
        ) : null}

        <Block title="Letters, emails & report history">
          <ol className="dbt-time">
            {events.map((e, n) => (
              <li key={n} className={`is-${e.kind}`}>
                <time>{shortDate(e.date)}</time>
                <i>{e.kind}</i>
                <span>{e.text}</span>
              </li>
            ))}
          </ol>
        </Block>

        {item.facts?.length ? (
          <Block title="Worth knowing">
            <ul className="dbt-facts">
              {item.facts.map(f => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </Block>
        ) : null}

        {item.pay || item.next ? (
          <Block title={item.pay ? 'Where to pay' : 'Next step'}>
            {item.pay ? <p>{item.pay}</p> : null}
            {item.next ? <p className="dbt-next">{item.next}</p> : null}
          </Block>
        ) : null}
      </div>
    </div>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="dbt-block">
      <h4>{title}</h4>
      {children}
    </section>
  );
}

function Sec({ tone, title, figure, figureLabel, hint, children }: { tone: string; title: string; figure?: string; figureLabel?: string; hint?: string; children: ReactNode }) {
  return (
    <section className={`mny-sec tone-${tone}`}>
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

function LetterStory({ letter, file, marks, onOpen, onClose }: { letter: DebtLetter; file: File; marks: DebtMarks; onOpen: (id: string) => void; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const inIt = useMemo(() => file.items.filter(i => i.letters?.includes(letter.id)), [file.items, letter.id]);
  return (
    <div className="bal-dlg-backdrop" onClick={onClose}>
      <div className="bal-dlg dbt-story" role="dialog" aria-modal="true" aria-label={`${letter.title}`} onClick={e => e.stopPropagation()}>
        <button type="button" className="bal-dlg-x" onClick={onClose} aria-label="Close">
          ✕
        </button>
        <header className="dbt-story-head">
          <div>
            <h3>{letter.from}</h3>
            <p>
              {shortDate(letter.date)} · {letter.title}
            </p>
          </div>
          <div className="dbt-story-amt">
            <b>{usd(letter.total)}</b>
            <span>
              {letter.count} item{letter.count === 1 ? '' : 's'}
            </span>
          </div>
        </header>
        {letter.note ? <p className="dbt-muted">{letter.note}</p> : null}
        {letter.plan ? (
          <Block title="Payment plan">
            <p className={`dbt-planline is-${letter.plan.state}`}>
              <b>{PLAN_LABEL[letter.plan.state]}.</b> {letter.plan.terms}
            </p>
          </Block>
        ) : null}
        <Block title="Tickets it covers">
          <div className="dbt-tk-grid">
            {inIt.map(i => (
              <TicketRow key={i.id} item={i} marks={marks} onOpen={onOpen} />
            ))}
          </div>
        </Block>
      </div>
    </div>
  );
}
