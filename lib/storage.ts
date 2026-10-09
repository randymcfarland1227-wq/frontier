export function readSaved<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Fired with the storage key after every successful write (cloud backup listens). */
export const LOCAL_WRITE_EVENT = 'lifehub:local-write';

export function writeSaved(key: string, value: unknown) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
    window.dispatchEvent(new CustomEvent(LOCAL_WRITE_EVENT, { detail: key }));
  } catch {
    /* quota / private mode */
  }
}

export const STORAGE_KEYS = {
  focus: 'lifehub-focus',
  snapshots: 'lifehub-source-snapshots',
  self: 'lifehub-self-inbox',
  completions: 'lifehub-completions',
  theme: 'lifehub-theme',
  priorityPins: 'lifehub-priority-pins',
  /** Priority workstation lanes: "source:id" → { lane, order, at } — cloud-synced */
  priorityLanes: 'lifehub-priority-lanes',
  /** Bill changes logged on Life Hub (skip / move / amount / note per due) — cloud-synced */
  billEdits: 'lifehub-bill-edits',
  /** Days folded in the Money page's 7-day list (this device) */
  moneyFoldedDays: 'lifehub-money-folded-days',
  /** Maybe-plans not confirmed yet (Schedule) — cloud-synced */
  plans: 'lifehub-plans',
  /** Money page payment plans — cloud-synced */
  payPlans: 'lifehub-pay-plans',
  /** Schedule events shown / hidden in the Events list — cloud-synced */
  eventMarks: 'lifehub-event-marks',
  /** Task type labels ("Items to buy"…) per task — cloud-synced */
  taskTags: 'lifehub-task-tags',
  /** Items removed from Life Hub (not done) — cloud-synced */
  hiddenItems: 'lifehub-hidden-items',
  /** Subscriptions added on Life Hub — cloud-synced */
  lifeSubs: 'lifehub-subs',
  /** Uploaded site pictures (Self photo, brand logos) — cloud-synced */
  siteIcons: 'lifehub-site-icons',
  captures: 'lifehub-captures',
  goalLinks: 'lifehub-goal-links',
  /** Cloud backup key for this device — never synced */
  sync: 'lifehub-sync',
  /** Source cards collapsed to their header */
  collapsedCards: 'lifehub-collapsed-cards',
  /** Page zoom % on this device */
  zoom: 'lifehub-zoom',
  /** Cards whose starred list is folded to its heading */
  collapsedFeatured: 'lifehub-collapsed-featured',
  /** Red / yellow / green on featured + pinned items — cloud-synced */
  featuredLevels: 'lifehub-featured-levels',
  /** Stars Life Hub keeps for sources without their own (TickTick) — cloud-synced */
  hubStars: 'lifehub-hub-stars',
  /** Task sorting: bucket + goal per task name — cloud-synced */
  taskRules: 'lifehub-task-rules',
  /** Balance paces (settings gear) — cloud-synced */
  balanceSettings: 'lifehub-balance-settings',
  /** Each day's available work per bucket — cloud-synced */
  dailyAvailability: 'lifehub-daily-availability',
  /** Migrate from prior Work Room keys once */
  legacyFocus: 'workroom-focus',
  legacySnapshots: 'workroom-source-snapshots',
} as const;
