'use client';

import type { SourceSnapshot } from '../../lib/types';
import { setRoleActive, shelfOf } from '../../lib/roleShelves';

/**
 * Lists kept apart from a site's open tasks. Role Hub (Certs to get, Portfolio to add): Active moves
 * one into the open tasks and the open row's ☆ menu has ↩ to put it back. Resale (Decisions to make,
 * Waiting on offers): handled on the Resale site, so rows just open it.
 */
export function ShelfList({ snapshot, compact = false }: { snapshot: SourceSnapshot; compact?: boolean }) {
  const shelves = (snapshot.shelves || []).filter(s => s.items.length);
  if (!shelves.length) return null;
  return (
    <div className={`shelves${compact ? ' is-compact' : ''}`}>
      {shelves.map(s => (
        <details key={s.id} className={`shelf shelf-${s.id}`} open={!compact}>
          <summary>
            <span className="shelf-chev" aria-hidden="true" />
            <span className="shelf-name">{s.label}</span>
            <span className="shelf-count">{s.items.length}</span>
          </summary>
          <ul>
            {s.items.map(t => (
              <li key={t.id} className="shelf-row">
                {t.originUrl ? (
                  <a className="shelf-title" href={t.originUrl} target="_blank" rel="noopener noreferrer" title={[t.title, t.detail].filter(Boolean).join(' — ')}>
                    {t.title}
                  </a>
                ) : (
                  <span className="shelf-title" title={[t.title, t.detail].filter(Boolean).join(' — ')}>
                    {t.title}
                  </span>
                )}
                {shelfOf(t.id) ? (
                  <button
                    type="button"
                    className="row-action shelf-go"
                    onClick={() => setRoleActive(t.id, true)}
                    title="Start working on it — moves it to the open tasks"
                    aria-label={`Make ${t.title} active`}
                  >
                    Active →
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ))}
    </div>
  );
}
