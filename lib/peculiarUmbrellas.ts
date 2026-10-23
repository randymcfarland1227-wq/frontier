import { loadLanes, saveLanes } from './priorityPins';

/**
 * 2026-10-22: PR #139 seeded 11 Peculiar Candle umbrella tasks as starred Self items (`self-pc-*`,
 * subtasks in lanes `self:self-pc-*`). Randy wants them with the Candle items instead, so they now
 * live in Peculiar Command Center as stepped tasks. These ids are retired: dropped on every load and
 * every cloud merge, so a copy still in the backup can't bring them back.
 */
const RETIRED = 'self-pc-';

/** Drop the retired umbrella items' Priority entries (their subtasks). */
export function removePeculiarUmbrellaLanes() {
  if (typeof window === 'undefined') return;
  try {
    const lanes = loadLanes();
    const stale = Object.keys(lanes).filter(k => k.startsWith(`self:${RETIRED}`));
    if (!stale.length) return;
    stale.forEach(k => delete lanes[k]);
    saveLanes(lanes);
    localStorage.removeItem('lifehub-peculiar-umbrellas-v1');
  } catch {
    /* storage unavailable — skip */
  }
}
