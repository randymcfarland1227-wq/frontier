'use client';

import type { SourceId, SourceSnapshot } from '../../lib/types';
import { sourceById } from '../../lib/sources';
import { metricValue, updatedLabel } from '../../lib/protocol';
import { getActionableMetric } from '../../lib/actionable';

export function MetricGrid({
  sourceId,
  snapshot,
  compact = false,
}: {
  sourceId: SourceId;
  snapshot: SourceSnapshot;
  compact?: boolean;
}) {
  const def = sourceById[sourceId];
  const actionable = getActionableMetric(sourceId, snapshot);
  const consumed = new Set(actionable.consumes || [actionable.key]);

  const rest = def.metrics.filter(metric => !consumed.has(metric.key));
  const maxRest = compact ? Math.max(0, Math.min(2, rest.length)) : rest.length;
  const secondary = rest.slice(0, maxRest);

  // Always show at least the blue actionable metric, even when the source has no metric keys.
  const showActionable = true;

  return (
    <div className={compact ? `card-metrics ${sourceId}` : `room-metrics ${sourceId}`}>
      {showActionable ? (
        <article className="metric-actionable" key={`actionable-${actionable.key}`}>
          <strong>{Number.isFinite(actionable.value) ? actionable.value.toLocaleString() : '—'}</strong>
          <span>{actionable.label}</span>
        </article>
      ) : null}
      {secondary.map(metric => (
        <article key={metric.key}>
          <strong>{metricValue(snapshot.metrics, metric.key)}</strong>
          <span>{metric.label}</span>
        </article>
      ))}
      {compact ? null : <p>{updatedLabel(snapshot.refreshedAt)}</p>}
    </div>
  );
}
