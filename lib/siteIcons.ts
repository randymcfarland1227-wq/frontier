'use client';

/**
 * Site pictures: real logos for Gmail / Outlook / TickTick / Radall (Google Sheets) bundled in
 * public/logos, plus pictures you upload (your photo for Self, brand logos for Candle / Resale…).
 * Uploads are shrunk to a small square and cloud-synced; newest change per site wins.
 */

import { useCallback, useEffect, useState } from 'react';
import type { SourceId } from './types';
import { readSaved, writeSaved, STORAGE_KEYS } from './storage';

export type IconMap = Record<string, { src: string | null; at: string }>;
export const SITE_ICONS_EVENT = 'lifehub:site-icons';

function baseUrl(): string {
  const raw = (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env?.BASE_URL;
  return typeof raw === 'string' && raw.length ? (raw.endsWith('/') ? raw : `${raw}/`) : '/';
}

const BUILTIN: Partial<Record<SourceId, string>> = {
  gmail: 'logos/gmail.svg',
  outlook: 'logos/microsoftoutlook.svg',
  ticktick: 'logos/ticktick.svg',
  radall: 'logos/googlesheets.svg',
};

export function builtinIcon(source: SourceId): string | undefined {
  const p = BUILTIN[source];
  return p ? `${baseUrl()}${p}` : undefined;
}

export function loadIcons(): IconMap {
  return readSaved<IconMap>(STORAGE_KEYS.siteIcons, {});
}

export function setIcon(source: SourceId, src: string | null) {
  const all = loadIcons();
  all[source] = { src, at: new Date().toISOString() };
  writeSaved(STORAGE_KEYS.siteIcons, all);
  window.dispatchEvent(new CustomEvent(SITE_ICONS_EVENT));
}

/** Read an image file and shrink it to a centered square (keeps the backup small). */
export function fileToIcon(file: File, size = 128): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read_failed'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('not_an_image'));
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('no_canvas'));
        const s = Math.min(img.width, img.height);
        ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
        resolve(canvas.toDataURL('image/png'));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export function useSiteIcons() {
  const [icons, setIcons] = useState<IconMap>(() => loadIcons());
  useEffect(() => {
    const reload = () => setIcons(loadIcons());
    window.addEventListener(SITE_ICONS_EVENT, reload);
    window.addEventListener('lifehub:synced', reload);
    return () => {
      window.removeEventListener(SITE_ICONS_EVENT, reload);
      window.removeEventListener('lifehub:synced', reload);
    };
  }, []);
  /** Your upload first, then the bundled logo; undefined → show the site's symbol. */
  const iconFor = useCallback((source: SourceId) => icons[source]?.src || builtinIcon(source), [icons]);
  const isCustom = useCallback((source: SourceId) => Boolean(icons[source]?.src), [icons]);
  return { iconFor, isCustom };
}
