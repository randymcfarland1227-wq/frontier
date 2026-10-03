'use client';

import { useState } from 'react';
import { sources } from '../../lib/sources';
import { builtinIcon, fileToIcon, setIcon, useSiteIcons } from '../../lib/siteIcons';
import type { SourceId } from '../../lib/types';
import { SiteIcon } from './SiteIcon';

/** Settings → Site pictures: your photo for Self, brand logos for Candle / Resale, or any site. */
export function SiteIconSettings() {
  const { isCustom } = useSiteIcons();
  const [error, setError] = useState('');

  const upload = async (id: SourceId, file?: File) => {
    if (!file) return;
    setError('');
    try {
      setIcon(id, await fileToIcon(file));
    } catch {
      setError('That file could not be read as a picture.');
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
      {error ? <p className="review-empty" role="alert">{error}</p> : null}
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
              <input type="file" accept="image/*" onChange={e => void upload(site.id as SourceId, e.target.files?.[0])} />
            </label>
            {isCustom(site.id as SourceId) ? (
              <button type="button" className="row-action ghost" onClick={() => setIcon(site.id as SourceId, null)}>
                Reset
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}
