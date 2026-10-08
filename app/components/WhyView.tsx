'use client';

import { useState, type ReactNode } from 'react';
import { readSaved, writeSaved } from '../../lib/storage';

const FLOW_URL = 'https://randymcfarland1227-wq.github.io/flow-hub/';
const TAB_KEY = 'lifehub-why-tab';

/**
 * Why: Flow (goals, routines, the whole system) embedded right here — it's the place Randy goes
 * most — plus the existing goals-with-attached-work view. The chosen tab is remembered per device.
 */
export function WhyView({ goalsPanel }: { goalsPanel: ReactNode }) {
  const [tab, setTab] = useState<'flow' | 'goals'>(() => (readSaved<string>(TAB_KEY, 'flow') === 'goals' ? 'goals' : 'flow'));
  const pick = (t: 'flow' | 'goals') => {
    setTab(t);
    writeSaved(TAB_KEY, t);
  };
  return (
    <div className="settings-view why-view">
      <div className="why-tabs">
        <div className="seg" role="tablist" aria-label="Why">
          <button type="button" role="tab" aria-selected={tab === 'flow'} className={tab === 'flow' ? 'active' : ''} onClick={() => pick('flow')}>
            Flow
          </button>
          <button type="button" role="tab" aria-selected={tab === 'goals'} className={tab === 'goals' ? 'active' : ''} onClick={() => pick('goals')}>
            Goals &amp; work
          </button>
        </div>
        {tab === 'flow' ? (
          <a className="row-action ghost" href={FLOW_URL} target="_blank" rel="noopener noreferrer">
            Open Flow ↗
          </a>
        ) : null}
      </div>
      {tab === 'flow' ? (
        <iframe className="why-flow-frame" src={FLOW_URL} title="Flow — goals and routines" loading="lazy" />
      ) : (
        goalsPanel || <p className="review-empty">Loading goals…</p>
      )}
    </div>
  );
}
