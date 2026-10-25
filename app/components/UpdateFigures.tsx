'use client';

import { useEffect, useMemo, useState } from 'react';
import { amountOf, cardSummaries, type Cell, type CellEdit, type EditResult, type MoneyModel } from '../../lib/money';
import { loanRows } from './MoneyBoards';
import { metaName, setMeta, useMoneyMeta } from '../../lib/moneyMeta';

type Save = (edits: CellEdit[]) => Promise<{ ok: boolean; results: EditResult[]; error?: string }>;
type Field = { id: string; group: string; label: string; cell: Cell };

const PICKS_KEY = 'figures:picks';
const ERRORS: Record<string, string> = {
  changed: 'changed in the sheet meanwhile',
  formula: 'is a formula',
  busy: 'Google was busy',
  wrong_key: 'not linked to the backup',
  not_configured: 'sheet saving not set up',
};
const fmt = (n: number) => {
  const body = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 });
  return `${n < 0 ? '-' : ''}$${body}`;
};

/** What the box would write: money-looking input becomes $1,234.50 style; anything else is kept as typed. */
function normalize(raw: string): string {
  const t = raw.trim();
  if (!t) return '';
  if (!/^-?\$?\s*-?[\d,]*\.?\d+$/.test(t)) return t;
  const n = amountOf(t);
  return n === undefined ? t : fmt(n);
}

/** Every cell the tool can refresh, grouped. */
function allFields(model: MoneyModel, monthDues: Parameters<typeof loanRows>[1], get: Parameters<typeof loanRows>[2]): Field[] {
  const out: Field[] = [];
  for (const r of model.accounts?.rows || []) {
    const name = r[0]?.text.trim();
    if (!name) continue;
    if (r[1]) out.push({ id: `a:${metaName(name)}:1`, group: 'Accounts', label: `${name} · checking`, cell: r[1] });
    if (r[2]) out.push({ id: `a:${metaName(name)}:2`, group: 'Accounts', label: `${name} · savings`, cell: r[2] });
  }
  for (const c of cardSummaries(model)) {
    if (c.balance) out.push({ id: `c:${metaName(c.name)}:bal`, group: 'Cards', label: `${c.name} · balance`, cell: c.balance });
    if (c.available) out.push({ id: `c:${metaName(c.name)}:avail`, group: 'Cards', label: `${c.name} · available`, cell: c.available });
  }
  for (const l of loanRows(model, monthDues, get)) {
    if (l.balCell && !l.closed) out.push({ id: `l:${metaName(l.name)}`, group: 'Loans', label: `${l.name} · balance left`, cell: l.balCell });
  }
  for (const r of model.outstanding?.rows || []) {
    if (r[0]?.text.trim() && r[1]) out.push({ id: `o:${metaName(r[0].text)}`, group: 'Outstanding', label: r[0].text.trim(), cell: r[1] });
  }
  return out;
}

export function UpdateFiguresButton({ model, monthDues, onSave }: { model: MoneyModel; monthDues: Parameters<typeof loanRows>[1]; onSave: Save }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="mny-btn" onClick={() => setOpen(true)} title="Type today’s balances once — they save to the sheet and every page follows">
        Update figures
      </button>
      {open ? <UpdateFigures model={model} monthDues={monthDues} onSave={onSave} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function UpdateFigures({ model, monthDues, onSave, onClose }: { model: MoneyModel; monthDues: Parameters<typeof loanRows>[1]; onSave: Save; onClose: () => void }) {
  const { get } = useMoneyMeta();
  const fields = useMemo(() => allFields(model, monthDues, get), [model, monthDues, get]);
  const saved = get(PICKS_KEY)?.picks;
  const picks = useMemo(() => (saved ? saved : fields.filter(f => f.id.endsWith(':1') && f.id.startsWith('a:')).map(f => f.id)), [saved, fields]);
  const shown = fields.filter(f => picks.includes(f.id));
  const [vals, setVals] = useState<Record<string, string>>({});
  const [step, setStep] = useState<'edit' | 'review' | 'done'>('edit');
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fails, setFails] = useState<string[]>([]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const changes = shown
    .filter(f => !f.cell.formula && vals[f.id] !== undefined)
    .map(f => ({ f, next: normalize(vals[f.id]) }))
    .filter(x => x.next !== x.f.cell.text.trim() && !(x.next === '' && !x.f.cell.text.trim()));

  const togglePick = (id: string) => setMeta(PICKS_KEY, { picks: picks.includes(id) ? picks.filter(x => x !== id) : [...picks, id] });

  const submit = async () => {
    setBusy(true);
    const edits: CellEdit[] = changes.map(({ f, next }) => ({ tab: f.cell.tab, r: f.cell.r, c: f.cell.c, expect: f.cell.text, value: next }));
    const res = await onSave(edits);
    const bad: string[] = [];
    changes.forEach(({ f }, i) => {
      const r = res.results[i];
      if (!res.ok || !r || !r.ok) bad.push(`${f.label} — ${ERRORS[r?.error || res.error || ''] || r?.error || res.error || 'not saved'}`);
    });
    setFails(bad);
    setVals({});
    setBusy(false);
    setStep('done');
  };

  const groups = ['Accounts', 'Cards', 'Loans', 'Outstanding'];
  return (
    <div className="bal-dlg-backdrop" onClick={onClose}>
      <div className="bal-dlg uf-dlg" role="dialog" aria-modal="true" aria-label="Update figures" onClick={e => e.stopPropagation()}>
        <button type="button" className="bal-dlg-x" onClick={onClose} aria-label="Close">✕</button>
        <p className="section-label">Update figures</p>
        {step === 'edit' ? (
          <>
            <p className="mb-dim uf-hint">Type today’s numbers. Only the ones you change are saved — to the sheet in one go — and every page follows.</p>
            {picking ? (
              <div className="uf-pick">
                {groups.map(g => (
                  <div key={g}>
                    <b>{g}</b>
                    {fields.filter(f => f.group === g).map(f => (
                      <label key={f.id}>
                        <input type="checkbox" checked={picks.includes(f.id)} onChange={() => togglePick(f.id)} /> {f.label}
                      </label>
                    ))}
                  </div>
                ))}
              </div>
            ) : (
              <ul className="uf-list">
                {groups.map(g => {
                  const rows = shown.filter(f => f.group === g);
                  if (!rows.length) return null;
                  return (
                    <li key={g}>
                      <b className="uf-group">{g}</b>
                      <ul>
                        {rows.map(f => (
                          <li key={f.id} className="uf-row">
                            <span className="uf-label">{f.label}</span>
                            {f.cell.formula ? (
                              <span className="uf-formula" title="Worked out by a formula in the sheet">{f.cell.text || '—'} · formula</span>
                            ) : (
                              <input
                                className={`uf-in${vals[f.id] !== undefined && normalize(vals[f.id]) !== f.cell.text.trim() ? ' is-changed' : ''}`}
                                inputMode="decimal"
                                value={vals[f.id] ?? f.cell.text}
                                onChange={e => setVals(v => ({ ...v, [f.id]: e.target.value }))}
                                onFocus={e => e.currentTarget.select()}
                                aria-label={f.label}
                              />
                            )}
                          </li>
                        ))}
                      </ul>
                    </li>
                  );
                })}
                {!shown.length ? <li className="mny-empty">Nothing picked — use “Choose items”.</li> : null}
              </ul>
            )}
            <div className="bal-dlg-actions">
              <button type="button" className="bal-btn is-quiet uf-choose" onClick={() => setPicking(p => !p)}>{picking ? 'Done choosing' : 'Choose items'}</button>
              {!picking ? (
                <button type="button" className="bal-btn is-primary" disabled={!changes.length} onClick={() => setStep('review')}>
                  Review {changes.length || ''} change{changes.length === 1 ? '' : 's'}
                </button>
              ) : null}
            </div>
          </>
        ) : null}
        {step === 'review' ? (
          <>
            <ul className="uf-list">
              {changes.map(({ f, next }) => (
                <li key={f.id} className="uf-row">
                  <span className="uf-label">{f.label}</span>
                  <span className="uf-diff"><s>{f.cell.text || '—'}</s> → <b>{next || 'blank'}</b></span>
                </li>
              ))}
            </ul>
            <div className="bal-dlg-actions">
              <button type="button" className="bal-btn is-quiet uf-choose" onClick={() => setStep('edit')}>Back</button>
              <button type="button" className="bal-btn is-primary" disabled={busy} onClick={() => void submit()}>{busy ? 'Saving…' : `Save ${changes.length} to the sheet`}</button>
            </div>
          </>
        ) : null}
        {step === 'done' ? (
          <>
            <p className={fails.length ? 'money-note is-bad' : 'money-note is-ok'}>{fails.length ? `${fails.length} didn’t save:` : 'Saved to the sheet ✓ — every page now shows the new figures.'}</p>
            {fails.length ? <ul className="uf-fails">{fails.map(f => <li key={f}>{f}</li>)}</ul> : null}
            <div className="bal-dlg-actions">
              <button type="button" className="bal-btn is-primary" onClick={onClose}>Close</button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
