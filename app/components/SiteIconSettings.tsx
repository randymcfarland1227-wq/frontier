'use client';

import { useState } from 'react';
import { sources } from '../../lib/sources';
import { builtinIcon, fileToIcon, setIcon, useSiteIcons } from '../../lib/siteIcons';
import type { SourceId } from '../../lib/types';
import { SiteIcon } from './SiteIcon';

/** Settings → Site pictures: your photo for Self, brand logos for Candle / Resale, or any site. */
export function SiteIconSettings() {
  const { isCustom } = useSiteIcons();
  // Per-site result of the last upload, shown on that site's row ("Saved ✓" / what went wrong).
  const [status, setStatus] = useState<Record<string, { ok: boolean; text: string }>>({});

  const upload = async (id: SourceId, input: HTMLInputElement) => {
    const file = input.files?.[0];
    // Clear it so picking the same file again still counts as a change.
    input.value = '';
    if (!file) return;
    const heic = /\.(heic|heif)$/i.test(file.name) || /heic|heif/i.test(file.type);
    setStatus(s => ({ ...s, [id]: { ok: true, text: 'Saving…' } }));
    try {
      setIcon(id, await fileToIcon(file));
      setStatus(s => ({ ...s, [id]: { ok: true, text: 'Saved ✓' } }));
    } catch {
      setStatus(s => ({
        ...s,
        [id]: {
          ok: false,
          text: heic
            ? "iPhone/HEIC photos can't be read by the browser. Save it as JPG or PNG (Photos → File → Export) and upload that."
            : `"${file.name}" couldn't be read as a picture. Try a JPG or PNG.`,
        },
      }));
    }
  };

  return (
    <section className="sorting-page glass-panel icon-settings" aria-label="Site pictures">
      <div className="sorting-head">
        <div>
          <p className="section-label">Settings</p>
          <h2>Site pictures</h2>
          <p className="review-lede">
            The picture on each site card. Gmail, Outlook, TickTick and Radall use their real logos; upload your own photo
            for Self, or a brand logo for Peculiar Candle and Resale. Pictures sync to your other devices with the backup.
          </p>
        </div>
      </div>
      <div className="icon-grid">
        {sources.map(site => (
          <div key={site.id} className={`icon-tile ${site.id}`}>
            <SiteIcon source={site.id as SourceId} className="icon-tile-img" />
            <div className="icon-tile-main">
              <strong>{site.name}</strong>
              <span>{isCustom(site.id as SourceId) ? 'Your picture' : builtinIcon(site.id as SourceId) ? 'Real logo' : 'Symbol'}</span>
            </div>
            <label className="row-action ghost icon-upload">
              Upload
              <input type="file" accept="image/*" onChange={e => void upload(site.id as SourceId, e.currentTarget)} />
            </label>
            {isCustom(site.id as SourceId) ? (
              <button type="button" className="row-action ghost" onClick={() => setIcon(site.id as SourceId, null)}>
                Reset
              </button>
            ) : null}
            {status[site.id] ? (
              <p className={`icon-status${status[site.id].ok ? '' : ' is-error'}`} role={status[site.id].ok ? 'status' : 'alert'}>
                {status[site.id].text}
              </p>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}
