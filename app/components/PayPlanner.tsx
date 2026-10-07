'use client';

import { useMemo, useState, type InputHTMLAttributes } from 'react';
import { MONEY_KINDS, amountOf } from '../../lib/money';
import { newPayPlan, updatePayPlan, usePayPlans, type PayLine, type PayPlan } from '../../lib/payPlans';
import { addDays, dayKey, fromDayKey, money, type BillDue } from '../../lib/schedule';

const short = (key: string) => fromDayKey(key).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
const rangeTitle = (a: string, b: string) =>
  `${fromDayKey(a).toLocaleDateString([], { month: 'short', day: 'numeric' })} – ${fromDayKey(b).toLocaleDateString([], { month: 'short', day: 'numeric' })}`;

/** Number box that keeps what you type ("12.") and saves on leave / Enter; empty = undefined. */
function MoneyInput({
  value,
  onCommit,
  ...rest
}: { value?: number; onCommit: (n: number | undefined) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? (value === undefined ? '' : String(value));
  // Read the box itself (not state), so a quick type-and-leave still saves.
  const commit = (raw: string) => {
    const t = raw.trim();
    const next = t === '' ? undefined : (amountOf(t) ?? 0);
    if (next !== value) onCommit(next);
    setText(null);
  };
  return (
    <input
      {...rest}
      inputMode="decimal"
      value={shown}
      onChange={e => {
        const raw = e.target.value;
        setText(raw);
        // Save as you type whenever it's a whole number ("12." waits for the next digit).
        if (!raw.trim() || amountOf(raw.trim()) !== undefined) {
          const next = raw.trim() ? amountOf(raw.trim()) : undefined;
          if (next !== value) onCommit(next);
        }
      }}
      onBlur={e => commit(e.currentTarget.value)}
      onKeyDown={e => {
        if (e.key === 'Enter') commit(e.currentTarget.value);
      }}
    />
  );
}

/**
 * Plan payments, like the sheet's weekly planner: a stretch of days, the money you start with,
 * everything due in it (leave any out, change an amount, tick it paid), extra payments toward
 * cards and debts, and money coming in — with what's left at the bottom.
 */
export function PayPlanner({
  dues,
  debts,
  cashOnHand,
  balancedCash,
}: {
  /** Every dated money item (bills, card mins, subs, pay later) */
  dues: BillDue[];
  debts: Array<{ name: string; owed?: string }>;
  cashOnHand?: string;
  balancedCash?: string;
}) {
  const plans = usePayPlans();
  const live = plans.filter(p => !p.archived);
  const [openId, setOpenId] = useState<string | null>(null);
  const plan = live.find(p => p.id === openId) || live[0];

  const create = () => {
    const start = dayKey(new Date());
    const end = dayKey(addDays(new Date(), 13));
    const p = newPayPlan({ title: rangeTitle(start, end), start, end });
    setOpenId(p.id);
  };

  return (
    <div className="payplan">
      <div className="payplan-tabs" role="tablist" aria-label="Payment plans">
        {live.map(p => (
          <button key={p.id} type="button" role="tab" aria-selected={p.id === plan?.id} className={`layer-chip${p.id === plan?.id ? ' on' : ''}`} onClick={() => setOpenId(p.id)}>
            {p.title}
          </button>
        ))}
        <button type="button" className="layer-chip payplan-new" onClick={create}>
          + New plan
        </button>
      </div>
      {plan ? (
        <PlanEditor key={plan.id} plan={plan} dues={dues} debts={debts} cashOnHand={cashOnHand} balancedCash={balancedCash} />
      ) : (
        <p className="sched-empty">
          Make a plan for the next stretch (a paycheck, two weeks, the rest of the month): it lists what’s due, you add extra payments to cards and debts,
          and it shows what’s left.
        </p>
      )}
    </div>
  );
}

function PlanEditor({
  plan,
  dues,
  debts,
  cashOnHand,
  balancedCash,
}: {
  plan: PayPlan;
  dues: BillDue[];
  debts: Array<{ name: string; owed?: string }>;
  cashOnHand?: string;
  balancedCash?: string;
}) {
  const set = (patch: Partial<PayPlan>) => updatePayPlan(plan.id, patch);
  const setLine = (id: string, patch: Partial<PayLine>) => set({ lines: plan.lines.map(l => (l.id === id ? { ...l, ...patch } : l)) });
  const addLine = (dir: PayLine['dir']) =>
    set({ lines: [...plan.lines, { id: `l-${Date.now()}`, label: '', amount: 0, dir, date: dir === 'out' ? plan.start : undefined }] });
  const setDue = (key: string, patch: { amount?: number; skip?: boolean; done?: boolean }) =>
    set({ dues: { ...plan.dues, [key]: { ...plan.dues[key], ...patch } } });

  const inRange = useMemo(() => dues.filter(d => d.due >= plan.start && d.due <= plan.end), [dues, plan.start, plan.end]);
  const cash = amountOf(cashOnHand || '');
  const start = plan.startCash ?? cash ?? 0;
  const dueAmount = (d: BillDue) => plan.dues[d.key]?.amount ?? d.bill.amount ?? 0;
  const dueTotal = inRange.filter(d => !plan.dues[d.key]?.skip).reduce((s, d) => s + dueAmount(d), 0);
  const outTotal = plan.lines.filter(l => l.dir === 'out').reduce((s, l) => s + (l.amount || 0), 0);
  const inTotal = plan.lines.filter(l => l.dir === 'in').reduce((s, l) => s + (l.amount || 0), 0);
  const left = start + inTotal - dueTotal - outTotal;
  const paid =
    inRange.filter(d => plan.dues[d.key]?.done && !plan.dues[d.key]?.skip).reduce((s, d) => s + dueAmount(d), 0) +
    plan.lines.filter(l => l.dir === 'out' && l.done).reduce((s, l) => s + (l.amount || 0), 0);
  const unknown = inRange.filter(d => !plan.dues[d.key]?.skip && plan.dues[d.key]?.amount === undefined && d.bill.amount === undefined).length;

  return (
    <div className="payplan-body">
      <div className="payplan-setup">
        <label>
          <span>Plan</span>
          <input value={plan.title} onChange={e => set({ title: e.target.value })} />
        </label>
        <label>
          <span>From</span>
          <input type="date" value={plan.start} onChange={e => e.target.value && set({ start: e.target.value })} />
        </label>
        <label>
          <span>To</span>
          <input type="date" value={plan.end} min={plan.start} onChange={e => e.target.value && set({ end: e.target.value })} />
        </label>
        <label>
          <span>Start with</span>
          <MoneyInput
            value={plan.startCash}
            placeholder={cash !== undefined ? `${money(cash)} (cash on hand)` : '$0'}
            onCommit={n => set({ startCash: n })}
          />
        </label>
        <span className="payplan-quick">
          {cashOnHand ? (
            <button type="button" className="layer-chip" onClick={() => set({ startCash: undefined })}>
              Cash on hand {cashOnHand}
            </button>
          ) : null}
          {balancedCash ? (
            <button type="button" className="layer-chip" onClick={() => set({ startCash: amountOf(balancedCash) })}>
              Balanced {balancedCash}
            </button>
          ) : null}
        </span>
      </div>

      <div className="payplan-cols">
        <section>
          <h3>
            Due {short(plan.start)} – {short(plan.end)} <span>{money(dueTotal)}</span>
          </h3>
          {inRange.length ? (
            <ul className="payplan-list">
              {inRange.map(d => {
                const o = plan.dues[d.key] || {};
                const k = d.bill.kind;
                return (
                  <li
                    key={d.key}
                    className={`payplan-row${o.skip ? ' is-skip' : ''}${o.done ? ' is-done' : ''}`}
                    style={{ '--ev': k ? MONEY_KINDS[k].color : '#a8632a' } as React.CSSProperties}
                  >
                    <input type="checkbox" checked={!o.skip} onChange={() => setDue(d.key, { skip: !o.skip })} aria-label={`Include ${d.bill.name}`} title="Include in this plan" />
                    <span className="payplan-day">{short(d.due)}</span>
                    <span className="payplan-name">
                      {d.bill.name}
                      <small>{k ? MONEY_KINDS[k].label : 'Bill'}</small>
                    </span>
                    <MoneyInput
                      className="payplan-amt"
                      value={o.amount ?? d.bill.amount}
                      placeholder="?"
                      onCommit={n => setDue(d.key, { amount: n })}
                      aria-label={`Amount for ${d.bill.name}`}
                    />
                    <button type="button" className={`row-action ghost payplan-paid${o.done ? ' on' : ''}`} onClick={() => setDue(d.key, { done: !o.done })} aria-pressed={Boolean(o.done)}>
                      {o.done ? 'Paid ✓' : 'Paid'}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="sched-empty">Nothing from the sheet is due in these days.</p>
          )}
          {unknown ? <p className="payplan-hint">{unknown} without an amount — type one in to count it.</p> : null}
        </section>

        <section>
          <h3>
            Extra payments <span>{money(outTotal)}</span>
          </h3>
          <LineList lines={plan.lines.filter(l => l.dir === 'out')} debts={debts} onChange={setLine} onRemove={id => set({ lines: plan.lines.filter(l => l.id !== id) })} />
          <button type="button" className="sched-add" onClick={() => addLine('out')}>
            + Payment toward a card or debt
          </button>
          <h3>
            Money coming in <span>{money(inTotal)}</span>
          </h3>
          <LineList lines={plan.lines.filter(l => l.dir === 'in')} onChange={setLine} onRemove={id => set({ lines: plan.lines.filter(l => l.id !== id) })} />
          <button type="button" className="sched-add" onClick={() => addLine('in')}>
            + Money coming in (paycheck, eBay, Facebook…)
          </button>
        </section>
      </div>

      <div className={`payplan-sum${left < 0 ? ' is-short' : ''}`}>
        <span>
          Start <b>{money(start)}</b>
        </span>
        <span>
          + in <b>{money(inTotal)}</b>
        </span>
        <span>
          − due <b>{money(dueTotal)}</b>
        </span>
        <span>
          − extra <b>{money(outTotal)}</b>
        </span>
        <span className="payplan-left">
          = left <b>{money(left)}</b>
        </span>
        {paid ? <span className="payplan-paidsum">{money(paid)} paid so far</span> : null}
        <button
          type="button"
          className="row-action ghost payplan-archive"
          onClick={() => {
            if (window.confirm(`Put “${plan.title}” away? It stays saved.`)) set({ archived: true });
          }}
        >
          Done with plan
        </button>
      </div>
    </div>
  );
}

function LineList({
  lines,
  debts,
  onChange,
  onRemove,
}: {
  lines: PayLine[];
  debts?: Array<{ name: string; owed?: string }>;
  onChange: (id: string, patch: Partial<PayLine>) => void;
  onRemove: (id: string) => void;
}) {
  if (!lines.length) return null;
  const listId = debts ? 'payplan-debts' : undefined;
  return (
    <>
      {debts ? (
        <datalist id="payplan-debts">
          {debts.map(d => (
            <option key={d.name} value={d.name}>
              {d.owed ? `owes ${d.owed}` : ''}
            </option>
          ))}
        </datalist>
      ) : null}
    <ul className="payplan-list">
      {lines.map(l => {
        const owed = debts?.find(d => d.name === l.label)?.owed;
        return (
          <li key={l.id} className={`payplan-row is-line${l.done ? ' is-done' : ''}`}>
            <input
              className="payplan-label"
              list={listId}
              value={l.label}
              placeholder={l.dir === 'out' ? 'Card or debt (pick or type)' : 'Where from'}
              onChange={e => onChange(l.id, { label: e.target.value })}
              aria-label="What"
            />
            {owed ? <small className="payplan-owed">owes {owed}</small> : null}
            <input
              type="date"
              className="payplan-date"
              value={l.date || ''}
              onChange={e => onChange(l.id, { date: e.target.value || undefined })}
              aria-label="Day"
              title={l.dir === 'out' ? 'Day you’ll pay it — shows on the money calendar' : 'Day it comes in'}
            />
            <MoneyInput className="payplan-amt" value={l.amount || undefined} placeholder="$0" onCommit={n => onChange(l.id, { amount: n ?? 0 })} aria-label="Amount" />
            {l.dir === 'out' ? (
              <button type="button" className={`row-action ghost payplan-paid${l.done ? ' on' : ''}`} onClick={() => onChange(l.id, { done: !l.done })} aria-pressed={Boolean(l.done)}>
                {l.done ? 'Paid ✓' : 'Paid'}
              </button>
            ) : null}
            <button type="button" className="row-action ghost" onClick={() => onRemove(l.id)} aria-label="Remove">
              ✕
            </button>
          </li>
        );
      })}
    </ul>
    </>
  );
}
