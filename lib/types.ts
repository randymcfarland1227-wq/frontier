/** Life Hub shared types + postMessage protocol shapes. See LIFE_HUB.md */

export type SourceId =
  | 'ticktick'
  | 'radall'
  | 'gmail'
  | 'outlook'
  | 'resale'
  | 'role'
  | 'candle'
  | 'income'
  | 'move'
  | 'repair'
  | 'self';

/** Legacy Work Room id for Role Hub snapshots */
export type LegacySourceId = 'search';

export type SpaceId = 'home' | SourceId;

export type FeaturedItem = {
  id: string;
  title: string;
  detail: string;
  meta: string;
  originUrl?: string;
  completable?: boolean;
};

export type TaskItem = {
  id: string;
  title: string;
  detail?: string;
  status?: 'open' | 'done' | 'blocked' | string;
  due?: string;
  starred?: boolean;
  originUrl?: string;
};

export type SourceSnapshot = {
  source: SourceId | LegacySourceId;
  metrics: Record<string, number>;
  featured: FeaturedItem[];
  tasks: TaskItem[];
  refreshedAt: string;
};

export type FocusItem = {
  id: number;
  text: string;
  space: SourceId;
  done: boolean;
};

export type WorkroomRequestMessage = { type: 'randys-workroom:request' };

export type WorkroomSnapshotMessage = {
  type: 'randys-workroom:snapshot';
  payload: SourceSnapshot;
};

export type WorkroomCompleteMessage = {
  type: 'randys-workroom:complete';
  payload: { source: SourceId; id: string };
};

export type WorkroomStarMessage = {
  type: 'randys-workroom:star';
  payload: { source: SourceId; id: string; starred: boolean };
};

export type WorkroomMessage =
  | WorkroomRequestMessage
  | WorkroomSnapshotMessage
  | WorkroomCompleteMessage
  | WorkroomStarMessage;

export type MetricDefinition = { key: string; label: string };

export type SourceDefinition = {
  id: SourceId;
  number: string;
  name: string;
  shortName: string;
  label: string;
  description: string;
  action: string;
  marker: string;
  eyebrow: string;
  intro: string;
  feature: string;
  empty: string;
  url: string | null;
  bridge: 'iframe' | 'popup' | 'local' | 'none';
  placeholder?: boolean;
  metrics: MetricDefinition[];
  allowedOrigins?: string[];
};
