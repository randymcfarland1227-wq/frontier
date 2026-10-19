'use client';

import { useState } from 'react';
import { countdown, fromDayKey, money, type BillDue } from '../../lib/schedule';
import { BillChangeForm, BillPinButton, FlagBadges, billChangeText } from './BillControls';

/** How loud the countdown is: overdue / within 3 days / later / skipped. */
function urgency(d: BillDue) {
  if (d.skipped) return 'is-skipped';
  if (d.days < 0) return d.bill.nonCritical ? 'is-overdue is-noncritical' : 'is-overdue';
  if (d.days <= 3) return 'is-soon';
  return 'is-later';
}

/**
 * Bills: "3 days · Electric · $120 · Pay ↗ · Paid · Pin · Change".
 * Paid on Life Hub = a real completion (Radall), so it counts in Review/Balance and syncs.
 * Change = skip / move / amount this time + a note (lib/billEdits.ts).
 */
export function BillsList({
  dues,
  onPaid,
  limit,
  empty = 'No bills due in the next few weeks.',
  compact = false,
}: {
  dues: BillDue[];
  onPaid: (due: BillDue) => void;
  limit?: number;
  empty?: string;
  /** One-line rows the size of Events / Needs to confirm (the Schedule's boxes) */
  compact?: boolean;
}) {
  const [changing, setChanging] = useState<string | null>(null);
  const shown = limit ? dues.slice(0, limit) : dues;
  if (!dues.length) return <p className="sched-empty">{empty}</p>;
  return (
    <ul className={`bill-list${compact ? ' is-compact' : ''}`}>
      {shown.map(d => {
        const date = fromDayKey(d.due).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
        const changed = billChangeText(d);
        if (compact) {
          const when = d.skipped ? 'Skipped' : d.days < 0 ? `${-d.days} ${d.days === -1 ? 'day' : 'days'} late` : d.days === 0 ? 'Today' : d.days === 1 ? 'Tomorrow' : `In ${d.days} days`;
          return (
            <li key={d.key} className="bill-item">
              <div className={`bill-line ${urgency(d)}`}>
                <span className="bill-line-text" title={[d.bill.name, money(d.bill.amount), date, changed || d.bill.notes].filter(Boolean).join(' · ')}>
                  <strong>{d.bill.name}</strong>
                  <small>{[money(d.bill.amount), date, changed].filter(Boolean).join(' · ')}</small>
                  <FlagBadges d={d} />
                </span>
                <span className="bill-line-when">{when}</span>
                <span className="bill-line-tools">
                  {d.skipped ? null : (
                    <button type="button" className="bill-line-btn" onClick={() => onPaid(d)} aria-label={`Mark ${d.bill.name} paid for ${date}`} title="Mark paid">
                      Paid
                    </button>
                  )}
                  {d.skipped ? null : <BillPinButton due={d} className="bill-line-btn is-extra" />}
                  <button
                    type="button"
                    className="bill-line-btn is-extra"
                    aria-expanded={changing === d.key}
                    onClick={() => setChanging(c => (c === d.key ? null : d.key))}
                    aria-label={`Change ${d.bill.name}: skip, move or amount`}
                    title="Skip, move or change the amount this time"
                  >
                    ⋯
                  </button>
                </span>
              </div>
              {changing === d.key ? <BillChangeForm due={d} onDone={() => setChanging(null)} /> : null}
            </li>
          );
        }
        return (
          <li key={d.key} className="bill-item">
            <div className={`bill-row ${urgency(d)}${d.bill.autopay ? ' is-auto' : ''}`}>
              <span className="bill-when" title={date}>
                {d.skipped ? (
                  <b>Skip</b>
                ) : (
                  <>
                    <b>{d.days > 1 ? d.days : countdown(d.days)}</b>
                    {d.days > 1 ? <span>days</span> : null}
                  </>
                )}
              </span>
              <span className="bill-main">
                <strong>{d.bill.name}</strong>
                <span className="bill-sub">
                  {[money(d.bill.amount), date, d.bill.autopay ? 'Autopay' : '', changed || d.bill.notes || ''].filter(Boolean).join(' · ')}
                  <FlagBadges d={d} />
                </span>
              </span>
              <span className="bill-actions">
                {d.bill.payUrl && !d.skipped ? (
                  <a className="row-action bill-pay" href={d.bill.payUrl} target="_blank" rel="noopener noreferrer" aria-label={`Pay ${d.bill.name} (opens the payment site)`}>
                    Pay ↗
                  </a>
                ) : null}
                {d.skipped ? null : (
                  <button type="button" className="row-action ghost" onClick={() => onPaid(d)} aria-label={`Mark ${d.bill.name} paid for ${date}`} title="Mark paid">
                    Paid
                  </button>
                )}
                {d.skipped ? null : <BillPinButton due={d} />}
                <button
                  type="button"
                  className="row-action ghost"
                  aria-expanded={changing === d.key}
                  onClick={() => setChanging(c => (c === d.key ? null : d.key))}
                  aria-label={`Change ${d.bill.name}: skip, move or amount`}
                  title="Skip, move or change the amount this time"
                >
                  Change
                </button>
              </span>
            </div>
            {changing === d.key ? <BillChangeForm due={d} onDone={() => setChanging(null)} /> : null}
          </li>
        );
      })}
      {limit && dues.length > limit ? <li className="sched-more">+{dues.length - limit} more later</li> : null}
    </ul>
  );
}
