'use client';

import type { SourceId, SourceSnapshot } from '../../lib/types';
import { sourceById } from '../../lib/sources';
import { metricValue, updatedLabel } from '../../lib/protocol';

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
  const definitions = def.metrics.slice(0, compact ? Math.min(3, def.metrics.length) : def.metrics.length);
  return (
    <div className={compact ? `card-metrics ${sourceId}` : `room-metrics ${sourceId}`}>
      {definitions.map(metric => (
        <article key={metric.key}>
          <strong>{metricValue(snapshot.metrics, metric.key)}</strong>
          <span>{metric.label}</span>
        </article>
      ))}
      <p>{updatedLabel(snapshot.refreshedAt)}</p>
    </div>
  );
}
