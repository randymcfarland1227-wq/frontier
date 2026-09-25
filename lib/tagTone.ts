/** Color family for a task-type tag (Resale: Ship → yellow, End Listing → red, List → light blue, …). */
export function tagTone(tag?: string): string {
  const t = (tag || '').toLowerCase();
  if (t.startsWith('ship')) return 'ship';
  if (t.startsWith('end')) return 'end';
  if (t.startsWith('list')) return 'list';
  if (t.startsWith('local')) return 'deal';
  if (/offer/.test(t)) return 'offer';
  if (/price|drop/.test(t)) return 'price';
  if (/refresh|relist/.test(t)) return 'refresh';
  return 'other';
}
