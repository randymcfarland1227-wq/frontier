'use client';

import { useState, type ReactNode } from 'react';
import type { BillDue } from '../../lib/schedule';
import { money } from '../../lib/schedule';
import { readSaved, writeSaved } from '../../lib/storage';
import { isLedgerPaid, ledgerType, ledgerWeeks, selectedLedgerGroups, selectorRows } from '../../lib/moneyLedger';

export function MoneySelector({ dues, paidAt, hidePaid, renderRow }: {
  dues: BillDue[]; paidAt: Record<string, string>; hidePaid: boolean; renderRow: (d: BillDue) => ReactNode;
}) {
  const today = new Date();
  const weeks = ledgerWeeks(today);
  const [week, setWeek] = useState(Math.floor((today.getDate() - 1) / 7));
  const [includeOverdue, setIncludeOverdue] = useState(true);
  const [types, setTypesState] = useState(() => readSaved<string[]>('lifehub-money-selector-types', []));
  const [items, setItemsState] = useState(() => readSaved<string[]>('lifehub-money-selector-items', []));
  const setTypes = (next: string[]) => { setTypesState(next); writeSaved('lifehub-money-selector-types', next); };
  const setItems = (next: string[]) => { setItemsState(next); writeSaved('lifehub-money-selector-items', next); };
  const [showItems, setShowItems] = useState(false);
  const [search, setSearch] = useState('');
  const range = weeks[Math.min(week, weeks.length - 1)];
  const candidates = selectorRows(dues, range.from, range.to, paidAt, false, includeOverdue);
  const visible = candidates.filter(d => !hidePaid || !isLedgerPaid(d, paidAt));
  const choices = [...new Map(candidates.map(d => [ledgerType(d).id, ledgerType(d)])).values()].sort((a, b) => a.label.localeCompare(b.label));
  const groups = selectedLedgerGroups(visible, types, items);
  const selected = groups.flatMap(g => g.rows);
  const total = selected.reduce((sum, d) => sum + (d.bill.amount || 0), 0);
  const left = selected.filter(d => !isLedgerPaid(d, paidAt)).reduce((sum, d) => sum + (d.bill.amount || 0), 0);
  const toggle = (list: string[], id: string) => list.includes(id) ? list.filter(x => x !== id) : [...list, id];
  const short = (key: string) => new Date(`${key}T12:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' });
  return <div className="money-selector">
    <div className="money-selector-controls">
      <label>Week <select value={week} onChange={e => setWeek(Number(e.target.value))}>
        {weeks.map((w, i) => <option value={i} key={w.from}>{short(w.from)}–{short(w.to)}{i === Math.floor((today.getDate() - 1) / 7) ? ' · This week' : ''}</option>)}
      </select></label>
      <label><input type="checkbox" checked={includeOverdue} onChange={e => setIncludeOverdue(e.target.checked)} /> Include all unpaid overdue items</label>
      <button type="button" className="mny-btn" onClick={() => { setTypes([]); setItems([]); }}>Clear selections</button>
    </div>
    <fieldset className="money-selector-types"><legend>Pick types to add to your list</legend>
      {choices.map(t => <label key={t.id} className={`mny-chip${types.includes(t.id) ? ' is-on' : ''}`}>
        <input type="checkbox" checked={types.includes(t.id)} onChange={() => setTypes(toggle(types, t.id))} /> {t.label}
        <small>{visible.filter(d => ledgerType(d).id === t.id).length}</small>
      </label>)}
      {!choices.length ? <p className="mny-empty">No payments in this range.</p> : null}
    </fieldset>
    <button type="button" className="mny-btn" aria-expanded={showItems} onClick={() => setShowItems(!showItems)}>{showItems ? 'Close item picker' : 'Add individual items'}</button>
    {showItems ? <div className="money-selector-picker">
      <label>Find an item <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Name or type" /></label>
      <ul>{visible.filter(d => `${d.bill.name} ${ledgerType(d).label}`.toLowerCase().includes(search.toLowerCase())).map(d => {
        const typePicked = types.includes(ledgerType(d).id);
        return <li key={d.key}><label><input type="checkbox" checked={typePicked || items.includes(d.key)} disabled={typePicked}
          onChange={() => setItems(toggle(items, d.key))} /><span>{d.bill.name}<small>{ledgerType(d).label} · {short(d.due)}{d.days < 0 && !isLedgerPaid(d, paidAt) ? ' · Overdue' : ''}{isLedgerPaid(d, paidAt) ? ' · Paid' : ''}{typePicked ? ' · Added by type' : ''}</small></span><b>{money(d.bill.amount) || '?'}</b></label></li>;
      })}</ul>
    </div> : null}
    <p className="money-selector-total" role="status">{selected.length} selected · {money(total)} total · {money(left)} unpaid</p>
    {groups.length ? groups.map(g => <section className="money-selector-group" key={g.id} aria-label={`${g.label} selected payments`}>
      <header><h3>{g.label}</h3><span>{g.rows.length} {g.rows.length === 1 ? 'item' : 'items'} · {money(g.rows.reduce((sum, d) => sum + (d.bill.amount || 0), 0))}</span></header>
      <ul>{g.rows.map(d => renderRow(d))}</ul>
    </section>) : <p className="mny-empty">{types.length || items.length ? 'No matching visible items. Try another week or show paid items.' : 'Choose a type or add individual items to build your list.'}</p>}
  </div>;
}
