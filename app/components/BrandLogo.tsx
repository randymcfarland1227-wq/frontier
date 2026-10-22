'use client';

import { useState } from 'react';

// Brand pictures next to bill / subscription names. Looks the brand up by words in its name and loads the
// site's own icon; nothing renders when the name isn't a known brand (or the icon fails to load).
const BRANDS: Array<[RegExp, string]> = [
  [/\bflex\b/i, 'getflex.com'],
  [/apple|icloud|itunes/i, 'apple.com'],
  [/google|youtube|gmail/i, 'google.com'],
  [/netflix/i, 'netflix.com'],
  [/spotify/i, 'spotify.com'],
  [/hulu/i, 'hulu.com'],
  [/disney/i, 'disneyplus.com'],
  [/\bmax\b|hbo/i, 'max.com'],
  [/paramount/i, 'paramountplus.com'],
  [/peacock/i, 'peacocktv.com'],
  [/amazon|prime video|audible/i, 'amazon.com'],
  [/instacart/i, 'instacart.com'],
  [/canva/i, 'canva.com'],
  [/chatgpt|openai/i, 'openai.com'],
  [/anthropic|claude/i, 'claude.ai'],
  [/nvidia/i, 'nvidia.com'],
  [/github/i, 'github.com'],
  [/microsoft|xbox|office 365/i, 'microsoft.com'],
  [/adobe/i, 'adobe.com'],
  [/dropbox/i, 'dropbox.com'],
  [/klarna/i, 'klarna.com'],
  [/afterpay/i, 'afterpay.com'],
  [/affirm/i, 'affirm.com'],
  [/\bzip\b/i, 'zip.co'],
  [/split ?pay/i, 'splitpay.com'],
  [/verizon/i, 'verizon.com'],
  [/xfinity|comcast/i, 'xfinity.com'],
  [/t-?mobile/i, 't-mobile.com'],
  [/fortiva/i, 'myfortiva.com'],
  [/milestone|concora/i, 'mymilestonecard.com'],
  [/toyota/i, 'toyotafinancial.com'],
  [/geico/i, 'geico.com'],
  [/progressive/i, 'progressive.com'],
  [/chase/i, 'chase.com'],
  [/capital one/i, 'capitalone.com'],
  [/discover/i, 'discover.com'],
  [/citi/i, 'citi.com'],
  [/truist/i, 'truist.com'],
  [/cleo/i, 'meetcleo.com'],
  [/moneylion/i, 'moneylion.com'],
  [/venmo/i, 'venmo.com'],
  [/paypal/i, 'paypal.com'],
  [/shopify/i, 'shopify.com'],
  [/cloudflare/i, 'cloudflare.com'],
  [/doordash/i, 'doordash.com'],
  [/uber/i, 'uber.com'],
  [/walmart/i, 'walmart.com'],
  [/costco/i, 'costco.com'],
  [/bj'?s/i, 'bjs.com'],
  [/chewy/i, 'chewy.com'],
  [/safeway/i, 'safeway.com'],
  [/candle ?science/i, 'candlescience.com'],
  [/soundcore|anker/i, 'soundcore.com'],
  [/planet fitness/i, 'planetfitness.com'],
  [/duolingo/i, 'duolingo.com'],
  [/strava/i, 'strava.com'],
  [/draftkings/i, 'draftkings.com'],
];

export function brandDomain(name: string): string | null {
  for (const [re, domain] of BRANDS) if (re.test(name)) return domain;
  return null;
}

export function BrandLogo({ name, size = 18 }: { name: string; size?: number }) {
  const [bad, setBad] = useState(false);
  const domain = brandDomain(name);
  if (!domain || bad) return null;
  return (
    <img
      className="brand-logo"
      src={`https://www.google.com/s2/favicons?domain=${domain}&sz=64`}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      onError={() => setBad(true)}
    />
  );
}
