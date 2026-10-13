/**
 * Next occurrence of a TickTick repeating task, for "won't do" from Life Hub (the series moves on;
 * see worker/index.ts handleTickTickWontDo). Simple RRULEs only — anything else returns null so the
 * caller refuses instead of guessing. Dates are UTC-midnight day values.
 */

const BYDAY: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

/** The next occurrence after `from` for simple RRULEs; null when the rule isn't one we can step safely. */
export function nextRepeat(rule: string, from: Date): Date | null {
  if (!/^RRULE:/.test(rule) || /COUNT=|UNTIL=|BYSETPOS=|BYWEEKNO=|BYYEARDAY=/.test(rule)) return null;
  const parts = Object.fromEntries(rule.slice(6).split(";").map(p => p.split("=") as [string, string]));
  const interval = Math.max(1, Number(parts.INTERVAL || 1));
  const add = (days: number) => new Date(from.getTime() + days * 86400000);
  switch (parts.FREQ) {
    case "DAILY":
      return add(interval);
    case "WEEKLY": {
      if (!parts.BYDAY) return add(7 * interval);
      if (interval !== 1) return null;
      const days = new Set(parts.BYDAY.split(",").map(x => BYDAY[x.replace(/^[+-]?\d+/, "")]).filter(x => x !== undefined));
      for (let i = 1; i <= 7; i++) if (days.has(add(i).getUTCDay())) return add(i);
      return null;
    }
    case "MONTHLY": {
      if (parts.BYDAY) return null;
      const day = parts.BYMONTHDAY ? Number(parts.BYMONTHDAY) : from.getUTCDate();
      if (!(day >= 1 && day <= 31)) return null;
      const y = from.getUTCFullYear();
      const mo = from.getUTCMonth() + interval;
      const last = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
      return new Date(Date.UTC(y, mo, Math.min(day, last)));
    }
    case "YEARLY":
      return parts.BYDAY || parts.BYMONTH ? null : new Date(Date.UTC(from.getUTCFullYear() + interval, from.getUTCMonth(), from.getUTCDate()));
    default:
      return null;
  }
}
