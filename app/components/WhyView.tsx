'use client';

import { useState, type ReactNode } from 'react';
import { readSaved, writeSaved } from '../../lib/storage';
import type { GoalsData } from '../../lib/goals';
import { WhySummary } from './WhySummary';

const FLOW_URL = 'https://randymcfarland1227-wq.github.io/flow-hub/';
const TAB_KEY = 'lifehub-why-tab';

/**
 * Why: a Summary (last month's reviews + goals overview), Flow (goals, routines, the whole system) embedded right here — it's the place Randy goes
 * most — plus the existing goals-with-attached-work view. The chosen tab is remembered per device.
 */
type WhyTab = 'summary' | 'flow' | 'goals';
const TABS: WhyTab[] = ['summary', 'flow', 'goals'];

export function WhyView({ goalsPanel, goals }: { goalsPanel: ReactNode; goals: GoalsData | null }) {
  const [tab, setTab] = useState<WhyTab>(() => {
    const saved = readSaved<string>(TAB_KEY, 'summary') as WhyTab;
    return TABS.includes(saved) ? saved : 'summary';
  });
  const pick = (t: WhyTab) => {
    setTab(t);
    writeSaved(TAB_KEY, t);
  };
  return (
    <div className="settings-view why-view">
      <div className="why-tabs">
        <div className="seg" role="tablist" aria-label="Why">
          <button type="button" role="tab" aria-selected={tab === 'summary'} className={tab === 'summary' ? 'active' : ''} onClick={() => pick('summary')}>
            Summary
          </button>
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
      {tab === 'summary' ? (
        <WhySummary goals={goals} />
      ) : tab === 'flow' ? (
        <iframe className="why-flow-frame" src={FLOW_URL} title="Flow — goals and routines" loading="lazy" />
      ) : (
        goalsPanel || <p className="review-empty">Loading goals…</p>
      )}
    </div>
  );
}
