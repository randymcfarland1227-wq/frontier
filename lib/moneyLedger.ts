import type { MoneyItem } from './money';
import type { BillDue } from './schedule';

/** Display filtering only: never changes the payment ledger or its totals. */
export function isLedgerPaid(d: BillDue, paidAt: Record<string, string>): boolean {
  return d.bill.id.startsWith('crossed:') || !!paidAt[d.key];
}

export function ledgerMonthRows(dues: BillDue[], items: MoneyItem[], today: Date): BillDue[] {
  const month = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const rows = new Map(dues.map(d => [d.key, d]));
  for (const item of items) {
    if (!item.skipped || !item.date?.startsWith(month) || rows.has(item.id)) continue;
    const [y, m, day] = item.date.split('-').map(Number);
    rows.set(item.id, {
      key: item.id, due: item.date,
      days: Math.round((new Date(y, m - 1, day).getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / 86_400_000),
      bill: { id: `crossed:${item.id}`, name: item.name, amount: item.amount, kind: item.kind,
        notes: [item.kind, item.provider, item.installment].filter(Boolean).join(' · ') },
    });
  }
  return [...rows.values()].sort((a, b) => a.due.localeCompare(b.due) || a.bill.name.localeCompare(b.bill.name));
}

const labels: Record<string, string> = { bill: 'Bills', card: 'Credit card payments', sub: 'Subscriptions', plan: 'Planned transfers' };
export function ledgerType(d: BillDue): { id: string; label: string } {
  const kind = d.bill.kind || 'bill';
  if (kind !== 'paylater') return { id: kind, label: labels[kind] || kind };
  // Notes are "Pay later · <provider> · <installment>"; a blank provider leaves the installment in slot 1.
  const slot = (d.bill.notes || '').split(' · ')[1]?.trim() || '';
  const provider = slot && !/^\d+\s*(\/|of)\s*\d+$/i.test(slot) ? slot : 'Pay later';
  const key = provider.toLowerCase().replace(/[^a-z0-9]/g, '');
  const label = ({ klarna: 'Klarna', afterpay: 'Afterpay', affirm: 'Affirm', zip: 'Zip' } as Record<string, string>)[key] || provider;
  return { id: `paylater:${key}`, label };
}

/** Existing month blocks: 1–7, 8–14, 15–21, 22–28, 29–last day. */
export function ledgerWeeks(today: Date): Array<{ from: string; to: string }> {
  const y = today.getFullYear(), m = today.getMonth();
  const last = new Date(y, m + 1, 0).getDate();
  const prefix = `${y}-${String(m + 1).padStart(2, '0')}-`;
  return Array.from({ length: Math.ceil(last / 7) }, (_, w) => ({
    from: prefix + String(w * 7 + 1).padStart(2, '0'),
    to: prefix + String(Math.min(w * 7 + 7, last)).padStart(2, '0'),
  }));
}

export function selectorRows(dues: BillDue[], from: string, to: string, paidAt: Record<string, string>, hidePaid: boolean, includeOverdue: boolean): BillDue[] {
  const unique = new Map(dues.map(d => [d.key, d]));
  return [...unique.values()].filter(d => !d.skipped && (!hidePaid || !isLedgerPaid(d, paidAt)) &&
    ((d.due >= from && d.due <= to) || (includeOverdue && d.days < 0 && !isLedgerPaid(d, paidAt))))
    .sort((a, b) => a.due.localeCompare(b.due) || a.bill.name.localeCompare(b.bill.name));
}

/** Type picks are cumulative, kept in click order, with manual additions grouped by their type. */
export function selectedLedgerGroups(dues: BillDue[], types: string[], items: string[]): Array<{ id: string; label: string; rows: BillDue[] }> {
  const ids = [...types];
  for (const key of items) {
    const row = dues.find(d => d.key === key);
    if (row && !ids.includes(ledgerType(row).id)) ids.push(ledgerType(row).id);
  }
  return ids.flatMap(id => {
    const rows = dues.filter(d => ledgerType(d).id === id && (types.includes(id) || items.includes(d.key)));
    return rows.length ? [{ id, label: ledgerType(rows[0]).label, rows }] : [];
  });
}
