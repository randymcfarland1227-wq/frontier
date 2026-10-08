/** Color family for a task-type tag (Resale: Ship → yellow, End Listing → red, List → light blue, …). */
export function tagTone(tag?: string): string {
  const t = (tag || '').toLowerCase();
  if (t.startsWith('ship')) return 'ship';
  if (t.startsWith('end')) return 'end';
  if (t.startsWith('list')) return 'list';
  if (t.startsWith('local')) return 'deal';
  if (/offer/.test(t)) return 'offer';
  if (/price|drop/.test(t)) return 'price';
  if (/refresh|relist|boost/.test(t)) return 'refresh';
  // Finance task types set on Life Hub
  if (/buy|shopping|purchase/.test(t)) return 'buy';
  if (/subscri/.test(t)) return 'sub';
  if (/bill/.test(t)) return 'bill';
  if (/insur/.test(t)) return 'insure';
  if (/paper|tax/.test(t)) return 'paper';
  return 'other';
}
