'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { readSaved, writeSaved } from '../../lib/storage';
import { isSettled, owedOf, useDebtFile, type Bureau, type DebtFile as File, type DebtGroup, type DebtItem, type DebtMark, type DebtMarks, type MarkStatus } from '../../lib/debtFile';

// The debt file: one entity per collection, liability and ticket, each opening into its story.
// Summary (what I really owe) → four views → rows → a pop-out with reports, owners, offers, letters.

type View = 'credit' | 'md' | 'oos' | 'other';
const VIEW_KEY = 'lifehub-debt-view';

const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: n % 1 ? 2 : 0 });
const amt = (n: number | null | undefined) => (n === null || n === undefined ? '?' : usd(n));
const shortDate = (d: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  if (!m) return d;
  return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
};
const daysUntil = (d: string) => Math.ceil((new Date(`${d}T23:59:59`).getTime() - Date.now()) / 86400000);

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
const LETTER_SHORT: Record<string, string> = { 'mva-0703': 'Jul 3', 'mva-0724': 'Jul 24', 'mva-0807': 'Aug 7', 'mva-1015': 'Oct 15', 'ccu-0814': 'CCU Aug', 'ccu-1009': 'CCU Oct' };

export function DebtFile() {
  const { file, marks, status, refresh, setMark } = useDebtFile();
  const [view, setViewState] = useState<View>(() => readSaved<View>(VIEW_KEY, 'credit'));
  const [openId, setOpenId] = useState<string | null>(null);
  const setView = (v: View) => {
    setViewState(v);
    writeSaved(VIEW_KEY, v);
  };

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

  const by = (g: DebtGroup[]) => file.items.filter(i => g.includes(i.group));
  const credit = by(['credit']);
  const behind = by(['behind']);
  const md = by(['md']);
  const wv = by(['wv']);
  const oos = by(['oos']);
  const other = by(['liability']);
  const regLeft = (file.registration?.steps || []).reduce((s, x) => s + (x.amount || 0), 0);
  const open = openId ? file.items.find(i => i.id === openId) : undefined;

  const tiles: Array<{ v: View; label: string; figure: number; small: string; tone: string }> = [
    { v: 'credit', label: 'Credit & collections', figure: owedOf(credit, marks), small: `${credit.length} accounts · ${behind.length} behind now`, tone: 'owed' },
    { v: 'md', label: 'MD tickets & MVA', figure: owedOf(md, marks) + md.length * 30, small: `${md.length} flags · incl. $30 MVA fee each`, tone: 'due' },
    { v: 'oos', label: 'Out of state', figure: owedOf(oos, marks), small: `${oos.length} tickets & tolls`, tone: 'sub' },
    { v: 'other', label: 'Taxes & other', figure: owedOf(other, marks), small: `${other.length} letters`, tone: 'plan' },
  ];
  const grand = tiles.reduce((s, t) => s + t.figure, 0);

  return (
    <div className="dbt">
      <section className="dbt-sum" aria-label="What I really owe">
        <div className="dbt-sum-total">
          <span>What I really owe</span>
          <b>{usd(grand)}</b>
          <small>
            Before settlements · as of {shortDate(file.asOf)} ·{' '}
            <button type="button" className="dbt-link" onClick={() => void refresh()}>
              refresh
            </button>
          </small>
        </div>
        {tiles.map(t => (
          <button key={t.v} type="button" className={`dbt-tile tone-${t.tone}${view === t.v ? ' is-on' : ''}`} onClick={() => setView(t.v)}>
            <span>{t.label}</span>
            <b>{usd(t.figure)}</b>
            <small>{t.small}</small>
          </button>
        ))}
      </section>

      {view === 'credit' ? <CreditView file={file} items={credit} behind={behind} marks={marks} onOpen={setOpenId} /> : null}
      {view === 'md' ? <MdView file={file} items={md} wv={wv} marks={marks} onOpen={setOpenId} regLeft={regLeft} /> : null}
      {view === 'oos' ? (
        <Sec tone="sub" title="Out-of-state tickets & tolls" figure={usd(owedOf(oos, marks))} hint="DC, New York and Delaware. None of these block your MD registration — DC can boot with 2+ unpaid.">
          <Rows items={oos} marks={marks} onOpen={setOpenId} ticket />
        </Sec>
      ) : null}
      {view === 'other' ? (
        <Sec tone="plan" title="Taxes & other liabilities" figure={usd(owedOf(other, marks))} hint="Just the letters — no credit-report research needed.">
          <Rows items={other} marks={marks} onOpen={setOpenId} />
        </Sec>
      ) : null}

      {file.sources ? <p className="dbt-src">Sources: {file.sources}</p> : null}
      {open ? <Story item={open} file={file} mark={marks[open.id]} onMark={m => void setMark(open.id, m)} onClose={() => setOpenId(null)} /> : null}
    </div>
  );
}

function CreditView({ file, items, behind, marks, onOpen }: { file: File; items: DebtItem[]; behind: DebtItem[]; marks: DebtMarks; onOpen: (id: string) => void }) {
  const offers = items.flatMap(i => (i.offers || []).filter(o => o.active && !isSettled(marks[i.id])).map(o => ({ i, o })));
  return (
    <div className="dbt-cols">
      <Sec tone="owed" title="Collections & charge-offs" figure={usd(owedOf(items, marks))} hint="Tap any account for its full story.">
        <div className="dbt-grid-head dbt-credit-row">
          <span>Account</span>
          <span title="Experian · Equifax · TransUnion">EX EQ TU</span>
          <span>Now with</span>
          <span className="num">Owed</span>
        </div>
        {items.map(i => {
          const now = i.owners?.[i.owners.length - 1];
          return (
            <button key={i.id} type="button" className={`dbt-row dbt-credit-row${isSettled(marks[i.id]) ? ' is-settled' : ''}`} onClick={() => onOpen(i.id)}>
              <span className="dbt-name">
                <b>{i.name}</b>
                <small>{i.sub}</small>
              </span>
              <span className="dbt-bureaus">
                {BUREAUS.map(([b, label]) => (
                  <i key={b} className={onReport(i.reports?.[b]) ? 'on' : ''} title={`${label}: ${i.reports?.[b] || 'not reported'}`}>
                    {b}
                  </i>
                ))}
              </span>
              <span className="dbt-who">{now ? now.name : '—'}</span>
              <span className="num">
                <MarkChip mark={marks[i.id]} />
                {amt(i.amount)}
              </span>
            </button>
          );
        })}
      </Sec>
      <div className="dbt-stack">
        {offers.length ? (
          <Sec tone="plan" title="Active offers" hint="Open offers from the email/letters. Get any settlement in writing before paying.">
            {offers.map(({ i, o }) => (
              <button key={i.id + o.date} type="button" className="dbt-offer" onClick={() => onOpen(i.id)}>
                <b>{i.name}</b>
                <span>{o.text}</span>
                <small>
                  {o.who} · {shortDate(o.date)} · owed {amt(i.amount)}
                </small>
              </button>
            ))}
          </Sec>
        ) : null}
        <Sec tone="due" title="Behind now — not collections yet" figure={usd(owedOf(behind, marks))} hint="Open accounts with missed payments in Gmail.">
          <Rows items={behind} marks={marks} onOpen={onOpen} />
        </Sec>
        {file.scores?.length ? (
          <Sec tone="card" title="FICO 8 from your reports">
            <div className="dbt-scores">
              {file.scores.map(s => (
                <span key={s.bureau + s.date}>
                  <b>{s.score}</b>
                  {s.bureau} · {shortDate(s.date)}
                </span>
              ))}
            </div>
          </Sec>
        ) : null}
      </div>
    </div>
  );
}

function MdView({ file, items, wv, marks, onOpen, regLeft }: { file: File; items: DebtItem[]; wv: DebtItem[]; marks: DebtMarks; onOpen: (id: string) => void; regLeft: number }) {
  const reg = file.registration;
  const [done, setDone] = useState<Record<string, boolean>>(() => readSaved('lifehub-debt-reg', {}));
  useEffect(() => writeSaved('lifehub-debt-reg', done), [done]);
  const days = reg ? daysUntil(reg.due) : 0;
  const mdLetters = file.letters;
  const sorted = useMemo(() => [...items].sort((a, b) => (a.ticket?.date || '').localeCompare(b.ticket?.date || '')), [items]);
  return (
    <div className="dbt-cols">
      <div className="dbt-stack">
        {reg ? (
          <Sec tone="due" title={`Registration renewal — ${days} days`} figure={usd(regLeft)} figureLabel="known" hint={`${reg.vehicle} · due ${shortDate(reg.due)}. Pay tickets first, then the MVA flag fees.`}>
            <ol className="dbt-steps">
              {reg.steps.map((s, n) => (
                <li key={s.id} className={done[s.id] ? 'is-done' : ''}>
                  <label>
                    <input type="checkbox" checked={!!done[s.id]} onChange={e => setDone(d => ({ ...d, [s.id]: e.target.checked }))} />
                    <span className="dbt-step-n">{n + 1}</span>
                    <span className="dbt-step-t">
                      <b>{s.title}</b>
                      <small>{s.where}</small>
                      {s.note ? <small className="dbt-muted">{s.note}</small> : null}
                    </span>
                    <span className="num">
                      {amt(s.amount)}
                      {s.maybe ? <small>+ up to {usd(s.maybe)}</small> : null}
                    </span>
                  </label>
                </li>
              ))}
            </ol>
          </Sec>
        ) : null}
        <Sec tone="sub" title="Combination letters" hint="MVA invoices and CCU letters — which tickets each one bundles.">
          {mdLetters.map(l => {
            const inIt = items.filter(i => i.letters?.includes(l.id));
            return (
              <details key={l.id} className="mny-fold">
                <summary>
                  <span className="mny-fold-chev" aria-hidden="true" />
                  <span className="mny-fold-title">
                    {shortDate(l.date)} · {l.from}
                  </span>
                  <span className="mny-fold-meta">{l.count} flag{l.count === 1 ? '' : 's'}</span>
                  <span className="mny-fold-total">{usd(l.total)}</span>
                </summary>
                <div className="mny-fold-body">
                  <p className="dbt-muted">
                    {l.title}. {l.note}
                  </p>
                  {inIt.map(i => (
                    <button key={i.id} type="button" className="dbt-mini" onClick={() => onOpen(i.id)}>
                      {i.sub?.split(' · ')[1] || i.name} — {i.name}
                    </button>
                  ))}
                </div>
              </details>
            );
          })}
        </Sec>
      </div>
      <div className="dbt-stack">
        <Sec tone="owed" title="The 13 flags on tag 5GW5410" figure={usd(owedOf(items, marks))} figureLabel="fines" hint="Plus $30 MVA fee each. Tap a ticket for every notice it got.">
          <div className="dbt-grid-head dbt-tk-row">
            <span>When · where</span>
            <span>Appears in</span>
            <span className="num">Fine</span>
          </div>
          {sorted.map(i => (
            <button key={i.id} type="button" className={`dbt-row dbt-tk-row${isSettled(marks[i.id]) ? ' is-settled' : ''}`} onClick={() => onOpen(i.id)}>
              <span className="dbt-name">
                <b>{i.name}</b>
                <small>
                  {i.ticket?.date.slice(0, 10)} · {i.sub}
                </small>
              </span>
              <span className="dbt-chips">
                {(i.letters || []).map(l => (
                  <i key={l} className={l.startsWith('ccu') ? 'is-ccu' : ''}>
                    {LETTER_SHORT[l] || l}
                  </i>
                ))}
              </span>
              <span className="num">
                <MarkChip mark={marks[i.id]} />
                {amt(i.amount)}
              </span>
            </button>
          ))}
        </Sec>
        <details className="mny-fold dbt-wv">
          <summary>
            <span className="mny-fold-chev" aria-hidden="true" />
            <span className="mny-fold-title">Old WV plate N2B933 — 5 Baltimore cameras (2025)</span>
            <span className="mny-fold-meta">not flagged in MD · check if paid</span>
            <span className="mny-fold-total">{usd(owedOf(wv, marks))}</span>
          </summary>
          <div className="mny-fold-body">
            <Rows items={wv} marks={marks} onOpen={onOpen} ticket />
          </div>
        </details>
      </div>
    </div>
  );
}

function Rows({ items, marks, onOpen, ticket }: { items: DebtItem[]; marks: DebtMarks; onOpen: (id: string) => void; ticket?: boolean }) {
  return (
    <>
      {items.map(i => (
        <button key={i.id} type="button" className={`dbt-row dbt-plain-row${isSettled(marks[i.id]) ? ' is-settled' : ''}`} onClick={() => onOpen(i.id)}>
          <span className="dbt-name">
            <b>{i.name}</b>
            <small>{ticket && i.ticket ? `${i.ticket.date.slice(0, 10)} · ${i.sub}` : i.sub}</small>
          </span>
          <span className="dbt-status">{i.status}</span>
          <span className="num">
            <MarkChip mark={marks[i.id]} />
            {amt(i.amount)}
          </span>
        </button>
      ))}
    </>
  );
}

function MarkChip({ mark }: { mark?: DebtMark }) {
  return mark ? <em className={`dbt-mark is-${mark.status}`}>{MARK_LABEL[mark.status]}</em> : null;
}

function Story({ item, file, mark, onMark, onClose }: { item: DebtItem; file: File; mark?: DebtMark; onMark: (m: DebtMark | null) => void; onClose: () => void }) {
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
                <div key={l.id} className="dbt-offer-line">
                  <em>{shortDate(l.date)}</em>
                  <span>
                    {l.from} — {l.title}
                    <small>
                      {l.count} item{l.count === 1 ? '' : 's'} · {usd(l.total)}
                    </small>
                  </span>
                </div>
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
