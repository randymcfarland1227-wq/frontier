import type { SourceAdapter } from './types';
import { ticktickAdapter } from './ticktick';
import { radallAdapter } from './radall';
import { gmailAdapter } from './gmail';
import { outlookAdapter } from './outlook';
import { resaleAdapter } from './resale';
import { roleAdapter } from './role';
import { candleAdapter } from './candle';
import { incomeAdapter } from './income';
import { moveAdapter } from './move';
import { repairAdapter } from './repair';
import { selfAdapter } from './self';
import type { SourceId } from '../types';

export type { SourceAdapter } from './types';

export const adapters: SourceAdapter[] = [
  ticktickAdapter,
  radallAdapter,
  gmailAdapter,
  outlookAdapter,
  resaleAdapter,
  roleAdapter,
  candleAdapter,
  incomeAdapter,
  moveAdapter,
  repairAdapter,
  selfAdapter,
];

export const adapterById = Object.fromEntries(adapters.map(a => [a.id, a])) as Record<SourceId, SourceAdapter>;
