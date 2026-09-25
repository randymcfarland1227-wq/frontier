'use client';

import type { Level } from '../../lib/featuredLevels';
import { LEVEL_LABEL } from '../../lib/featuredLevels';

/** Tap to cycle: none → red → yellow → green → none. */
export function LevelDot({ level, title, onCycle }: { level: Level | null; title: string; onCycle: () => void }) {
  const label = level ? LEVEL_LABEL[level] : 'No priority color';
  return (
    <button
      type="button"
      className={`level-dot level-${level || 'none'}`}
      onClick={onCycle}
      aria-label={`${label} for ${title} — tap to change`}
      title={`${label} — tap to change (red → yellow → green → none)`}
    />
  );
}
