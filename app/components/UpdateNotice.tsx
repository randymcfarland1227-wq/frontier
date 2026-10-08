'use client';

import { useEffect, useState } from 'react';

/** The main script this page loaded with (its file name changes on every deploy). */
function currentBundle(): string {
  const s = [...document.querySelectorAll<HTMLScriptElement>('script[type="module"][src]')].find(x => /\/assets\/index-[^/]+\.js/.test(x.src));
  return s ? new URL(s.src).pathname.split('/').pop() || '' : '';
}

/**
 * Life Hub tabs stay open for days, so a deploy can go unseen (old buckets, old pages). Every few
 * minutes (and when the tab comes back into view) this compares the live index.html's script with
 * the one this page is running, and offers a one-tap reload when they differ.
 */
export function UpdateNotice() {
  const [stale, setStale] = useState(false);
  useEffect(() => {
    const mine = currentBundle();
    if (!mine) return;
    const base = (import.meta.env.BASE_URL || '/').replace(/\/?$/, '/');
    const check = async () => {
      try {
        const html = await (await fetch(`${base}index.html?check=${Date.now()}`, { cache: 'no-store' })).text();
        const live = html.match(/\/assets\/(index-[^"']+\.js)/)?.[1];
        if (live && live !== mine) setStale(true);
      } catch {
        /* offline — try again later */
      }
    };
    const timer = window.setInterval(check, 5 * 60_000);
    const onVisible = () => document.visibilityState === 'visible' && void check();
    document.addEventListener('visibilitychange', onVisible);
    void check();
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  if (!stale) return null;
  return (
    <div className="update-notice" role="status">
      Life Hub was updated.
      <button type="button" className="row-action" onClick={() => window.location.reload()}>
        Reload
      </button>
    </div>
  );
}
