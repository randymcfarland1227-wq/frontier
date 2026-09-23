import type { SourceId, WorkroomCompleteMessage, WorkroomStarMessage } from './types';

export function requestSnapshot(target: Window | null | undefined, targetOrigin = '*') {
  target?.postMessage({ type: 'randys-workroom:request' }, targetOrigin);
}

export function sendComplete(
  target: Window | null | undefined,
  source: SourceId,
  id: string,
  targetOrigin = '*',
) {
  const message: WorkroomCompleteMessage = {
    type: 'randys-workroom:complete',
    payload: { source, id },
  };
  target?.postMessage(message, targetOrigin);
}

export function sendStar(
  target: Window | null | undefined,
  source: SourceId,
  id: string,
  starred: boolean,
  targetOrigin = '*',
) {
  const message: WorkroomStarMessage = {
    type: 'randys-workroom:star',
    payload: { source, id, starred },
  };
  target?.postMessage(message, targetOrigin);
}

export function updatedLabel(value: string) {
  if (!value) return 'Connecting to source…';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Connected to source';
  return `Updated ${date.toLocaleDateString([], { month: 'short', day: 'numeric' })} at ${date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

export function metricValue(metrics: Record<string, number>, key: string) {
  return Number.isFinite(metrics[key]) ? metrics[key].toLocaleString() : '—';
}

export function originAllowed(eventOrigin: string, allowed?: string[]) {
  if (!allowed || allowed.length === 0) return false;
  try {
    const hostname = new URL(eventOrigin).hostname;
    return allowed.some(rule => {
      if (rule.startsWith('.')) return hostname.endsWith(rule) || hostname === rule.slice(1);
      try {
        return eventOrigin === rule || new URL(rule).origin === eventOrigin;
      } catch {
        return eventOrigin === rule;
      }
    });
  } catch {
    return false;
  }
}
