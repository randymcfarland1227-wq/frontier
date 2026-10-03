'use client';

import type { SourceId } from '../../lib/types';
import { sourceById } from '../../lib/sources';
import { useSiteIcons } from '../../lib/siteIcons';

/** A site's picture (real logo or your upload), falling back to its symbol. */
export function SiteIcon({ source, className = '' }: { source: SourceId; className?: string }) {
  const { iconFor, isCustom } = useSiteIcons();
  const src = iconFor(source);
  const def = sourceById[source];
  return (
    <span className={`site-icon ${src ? 'has-img' : ''} ${isCustom(source) ? 'is-photo' : ''} ${className}`} aria-hidden="true">
      {/* Plain <img>: this is a Vite site (no next/image), and sources are tiny SVGs / data URLs */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {src ? <img src={src} alt="" /> : def?.marker}
    </span>
  );
}
