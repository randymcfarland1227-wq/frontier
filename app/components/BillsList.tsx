'use client';

import { countdown, fromDayKey, money, type BillDue } from '../../lib/schedule';

/** How loud the countdown is: overdue / within 3 days / later. */
function urgency(days: number) {
  if (days < 0) return 'is-overdue';
  if (days <= 3) return 'is-soon';
  return 'is-later';
}

/**
 * Bills from the Finances sheet's "Bills" tab: "3 days · Electric · $120 · Pay ↗ · Paid".
 * Paid on Life Hub = a real completion (Radall), so it counts in Review/Balance and syncs.
 */
export function BillsList({
  dues,
  onPaid,
  limit,
  empty = 'No bills due in the next few weeks.',
  pin,
}: {
  dues: BillDue[];
  onPaid: (due: BillDue) => void;
  /** Pin a payment to Doing now (On deck, under Radall Finances) */
  pin?: { isPinned: (due: BillDue) => boolean; toggle: (due: BillDue) => void };
  limit?: number;
  empty?: string;
}) {
  const shown = limit ? dues.slice(0, limit) : dues;
  if (!dues.length) return <p className="sched-empty">{empty}</p>;
  return (
    <ul className="bill-list">
      {shown.map(d => {
        const date = fromDayKey(d.due).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
        return (
          <li key={d.key} className={`bill-row ${urgency(d.days)}${d.bill.autopay ? ' is-auto' : ''}`}>
            <span className="bill-when" title={date}>
              <b>{d.days > 1 ? d.days : countdown(d.days)}</b>
              {d.days > 1 ? <span>days</span> : null}
            </span>
            <span className="bill-main">
              <strong>{d.bill.name}</strong>
              <span className="bill-sub">
                {[money(d.bill.amount), date, d.bill.autopay ? 'Autopay' : '', d.bill.notes || ''].filter(Boolean).join(' · ')}
              </span>
            </span>
            <span className="bill-actions">
              {d.bill.payUrl ? (
                <a className="row-action bill-pay" href={d.bill.payUrl} target="_blank" rel="noopener noreferrer" aria-label={`Pay ${d.bill.name} (opens the payment site)`}>
                  Pay ↗
                </a>
              ) : null}
              {pin ? (
                <button
                  type="button"
                  className={`row-action ghost bill-pin${pin.isPinned(d) ? ' is-on' : ''}`}
                  aria-pressed={pin.isPinned(d)}
                  onClick={() => pin.toggle(d)}
                  title={pin.isPinned(d) ? 'In Doing now — click to take it off' : 'Pin to Doing now'}
                  aria-label={`${pin.isPinned(d) ? 'Unpin' : 'Pin'} ${d.bill.name} ${pin.isPinned(d) ? 'from' : 'to'} Doing now`}
                >
                  {pin.isPinned(d) ? 'Pinned' : 'Pin'}
                </button>
              ) : null}
              <button type="button" className="row-action ghost" onClick={() => onPaid(d)} aria-label={`Mark ${d.bill.name} paid for ${date}`} title="Mark paid">
                Paid
              </button>
            </span>
          </li>
        );
      })}
      {limit && dues.length > limit ? <li className="sched-more">+{dues.length - limit} more later</li> : null}
    </ul>
  );
}
