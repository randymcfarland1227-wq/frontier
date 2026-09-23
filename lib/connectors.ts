import type { SourceId, SourceSnapshot } from './types';
import { normalizeSourceId } from './sources';

/** Connector sources served as static JSON under public/data/ (GitHub Pages). */
export const CONNECTOR_SOURCE_IDS = ['gmail', 'radall', 'outlook', 'ticktick', 'role'] as const;

export type ConnectorSourceId = (typeof CONNECTOR_SOURCE_IDS)[number];

export function isConnectorSource(id: string): id is ConnectorSourceId {
  return (CONNECTOR_SOURCE_IDS as readonly string[]).includes(id);
}

function baseUrl(): string {
  const raw = (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env?.BASE_URL;
  if (typeof raw === 'string' && raw.length) {
    return raw.endsWith('/') ? raw : `${raw}/`;
  }
  // Vite Pages uses /frontier/; Next/vinext local may be /
  if (typeof window !== 'undefined') {
    const path = window.location.pathname || '/';
    if (path.startsWith('/frontier')) return '/frontier/';
  }
  return '/';
}

function isSnapshot(value: unknown, id: ConnectorSourceId): value is SourceSnapshot {
  if (!value || typeof value !== 'object') return false;
  const snap = value as SourceSnapshot;
  const source = normalizeSourceId(String(snap.source));
  return (
    source === id &&
    typeof snap.refreshedAt === 'string' &&
    !!snap.refreshedAt &&
    typeof snap.metrics === 'object' &&
    snap.metrics !== null &&
    Array.isArray(snap.featured) &&
    Array.isArray(snap.tasks)
  );
}

async function fetchOne(id: ConnectorSourceId): Promise<SourceSnapshot | null> {
  const url = `${baseUrl()}data/${id}.json`;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    const json: unknown = await res.json();
    if (!isSnapshot(json, id)) return null;
    return {
      source: id,
      metrics: json.metrics || {},
      featured: json.featured || [],
      tasks: json.tasks || [],
      refreshedAt: json.refreshedAt,
    };
  } catch {
    return null;
  }
}

/**
 * Load static connector snapshots from `public/data/<id>.json`.
 * Only returns the four connector ids — never touches iframe-bridged sources.
 */
export async function fetchConnectorSnapshots(): Promise<Partial<Record<SourceId, SourceSnapshot>>> {
  const entries = await Promise.all(
    CONNECTOR_SOURCE_IDS.map(async id => {
      const snap = await fetchOne(id);
      return snap ? ([id, snap] as const) : null;
    }),
  );
  const out: Partial<Record<SourceId, SourceSnapshot>> = {};
  for (const entry of entries) {
    if (entry) out[entry[0]] = entry[1];
  }
  return out;
}

/** Open origin URL for connector complete/star until two-way API exists. */
export function openConnectorOrigin(
  item: { originUrl?: string },
  fallbackUrl?: string | null,
): boolean {
  const href = item.originUrl || fallbackUrl || null;
  if (!href) return false;
  window.open(href, '_blank', 'noopener,noreferrer');
  return true;
}
