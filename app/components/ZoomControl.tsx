'use client';

import { useEffect, useState } from 'react';
import { readSaved, writeSaved, STORAGE_KEYS } from '../../lib/storage';

const MIN = 60;
const MAX = 160;
const STEP = 10;

/** Page zoom for this device (the layout re-flows at each size, it doesn't just magnify). */
export function ZoomControl() {
  const [zoom, setZoom] = useState(() => readSaved<number>(STORAGE_KEYS.zoom, 100));

  useEffect(() => {
    document.documentElement.style.setProperty('zoom', zoom === 100 ? '' : String(zoom / 100));
    writeSaved(STORAGE_KEYS.zoom, zoom);
  }, [zoom]);

  const step = (d: number) => setZoom(z => Math.min(MAX, Math.max(MIN, z + d)));

  return (
    <div className="zoom-control" role="group" aria-label="Page zoom">
      <button type="button" onClick={() => step(-STEP)} disabled={zoom <= MIN} aria-label="Zoom out" title="Zoom out">
        −
      </button>
      <button type="button" className="zoom-value" onClick={() => setZoom(100)} title="Reset to 100%">
        {zoom}%
      </button>
      <button type="button" onClick={() => step(STEP)} disabled={zoom >= MAX} aria-label="Zoom in" title="Zoom in">
        +
      </button>
    </div>
  );
}
