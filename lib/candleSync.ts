/**
 * Peculiar Command Center keeps all its studio data in this browser (localStorage
 * `peculiar-command-center-v1`, same origin as Life Hub). Life Hub's backup carries that bundle so
 * the phone and the Mac show the same Candle work. Pure helpers here are shared with the Worker.
 */

export type CandleBundle = { raw: string | null; at: string };

export const PCC_KEY = 'peculiar-command-center-v1';

/** Small stable hash, to notice when the Candle data changed since the last sync. */
export function hashText(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return `${text.length}:${(h >>> 0).toString(36)}`;
}

/** How far along a copy is: closed tasks + filled steps (first-sync tiebreak only). */
export function candleProgress(raw: string | null): number {
  if (!raw) return -1;
  try {
    const tasks = (JSON.parse(raw)?.state?.tasks || []) as Array<{ status?: string; steps?: Array<{ value?: string }> }>;
    let n = 0;
    for (const t of tasks) {
      if (t.status === 'COMPLETE') n += 2;
      for (const s of t.steps || []) if (String(s.value || '').trim()) n++;
    }
    return n;
  } catch {
    return -1;
  }
}

/**
 * Newest change wins. A copy that has never been synced has no time (''); between two of those —
 * the first sync after this shipped — the copy with more progress wins, so a stale phone can't
 * replace the Mac's newer work.
 */
export function mergeCandle(a: CandleBundle | undefined, b: CandleBundle | undefined): CandleBundle {
  if (!a?.raw) return b?.raw ? b : a || { raw: null, at: '' };
  if (!b?.raw) return a;
  if (a.at || b.at) return (b.at || '') > (a.at || '') ? b : a;
  return candleProgress(b.raw) > candleProgress(a.raw) ? b : a;
}

export function normalizeCandle(v: unknown): CandleBundle {
  const c = (v && typeof v === 'object' ? v : {}) as Partial<CandleBundle>;
  return { raw: typeof c.raw === 'string' ? c.raw : null, at: typeof c.at === 'string' ? c.at : '' };
}
