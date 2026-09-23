/** Captures: non-tasks (research / learn / look into / ideas). Never on task boards or Balance until promoted. */

import type { SourceId } from './types';
import type { FocusAreaId } from './focusAreas';
import { readSaved, writeSaved, STORAGE_KEYS } from './storage';

export type CaptureKind = 'research' | 'learn' | 'lookinto' | 'idea';

export type CaptureStatus = 'inbox' | 'parked' | 'promoted' | 'dropped';

export type Capture = {
  id: string;
  kind: CaptureKind;
  title: string;
  notes?: string;
  url?: string;
  focusAreaId?: FocusAreaId;
  goalId?: string;
  status: CaptureStatus;
  createdAt: string;
  reviewedAt?: string;
  /** Set when promoted into a real task */
  promotedTo?: { source: SourceId; taskId: string };
};

export const CAPTURE_KINDS: Array<{ id: CaptureKind; label: string }> = [
  { id: 'idea', label: 'Idea' },
  { id: 'research', label: 'Research' },
  { id: 'lookinto', label: 'Look into' },
  { id: 'learn', label: 'Learn' },
];

export function loadCaptures(): Capture[] {
  return readSaved<Capture[]>(STORAGE_KEYS.captures, []);
}

function save(items: Capture[]): Capture[] {
  writeSaved(STORAGE_KEYS.captures, items);
  return items;
}

/** Accept bare domains ("example.com/x") as https links; drop anything that isn't http(s). */
export function normalizeUrl(raw: string): string | undefined {
  const value = raw.trim();
  if (!value) return undefined;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export function addCapture(input: {
  kind: CaptureKind;
  title: string;
  notes?: string;
  url?: string;
  focusAreaId?: FocusAreaId;
}): Capture[] {
  const capture: Capture = {
    id: `cap-${Date.now()}`,
    kind: input.kind,
    title: input.title.trim(),
    notes: input.notes?.trim() || undefined,
    url: input.url ? normalizeUrl(input.url) : undefined,
    focusAreaId: input.focusAreaId || undefined,
    status: 'inbox',
    createdAt: new Date().toISOString(),
  };
  return save([capture, ...loadCaptures()]);
}

export function updateCapture(id: string, patch: Partial<Omit<Capture, 'id' | 'createdAt'>>): Capture[] {
  return save(
    loadCaptures().map(c => (c.id === id ? { ...c, ...patch, reviewedAt: new Date().toISOString() } : c)),
  );
}

export function setCaptureStatus(id: string, status: Exclude<CaptureStatus, 'promoted'>): Capture[] {
  return updateCapture(id, { status });
}

export function markPromoted(id: string, promotedTo: { source: SourceId; taskId: string }): Capture[] {
  return updateCapture(id, { status: 'promoted', promotedTo });
}
