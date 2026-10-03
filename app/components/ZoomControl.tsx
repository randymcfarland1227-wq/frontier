'use client';

import { useEffect, useState } from 'react';
import { readSaved, writeSaved, STORAGE_KEYS } from '../../lib/storage';

const MIN = 60;
const MAX = 160;
const STEP = 10;

/** Default size by screen width: bigger monitors get bigger text so it stays readable. */
function autoZoom() {
  if (typeof window === 'undefined') return 100;
  const w = window.innerWidth;
  return w >= 1750 ? 125 : w >= 1400 ? 112 : 100;
}

/**
 * Page zoom for this device (the layout re-flows at each size, it doesn't just magnify).
 * Until you pick a size it follows the screen width ("Auto"); tapping the % goes back to Auto.
 */
export function ZoomControl() {
  // The first version saved 100 on every load, so a stored 100 means "never picked" → Auto.
  const [saved, setSaved] = useState<number | null>(() => {
    const v = readSaved<number | null>(STORAGE_KEYS.zoom, null);
    return typeof v === 'number' && v !== 100 ? v : null;
  });
  const [auto, setAuto] = useState(autoZoom);
  const zoom = saved ?? auto;

  useEffect(() => {
    const onResize = () => setAuto(autoZoom());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty('zoom', zoom === 100 ? '' : String(zoom / 100));
  }, [zoom]);

  const pick = (next: number | null) => {
    writeSaved(STORAGE_KEYS.zoom, next);
    setSaved(next);
  };
  const step = (d: number) => pick(Math.min(MAX, Math.max(MIN, zoom + d)));

  return (
    <div className="zoom-control" role="group" aria-label="Page zoom">
      <button type="button" onClick={() => step(-STEP)} disabled={zoom <= MIN} aria-label="Zoom out" title="Zoom out">
        −
      </button>
      <button
        type="button"
        className="zoom-value"
        onClick={() => pick(null)}
        title={saved === null ? 'Auto size for this screen' : 'Back to auto size for this screen'}
      >
        {saved === null ? 'Auto' : `${zoom}%`}
      </button>
      <button type="button" onClick={() => step(STEP)} disabled={zoom >= MAX} aria-label="Zoom in" title="Zoom in">
        +
      </button>
    </div>
  );
}
