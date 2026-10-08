'use client';

import { useState } from 'react';
import { readSaved, writeSaved } from '../../lib/storage';
import { MUSIC_HUB_URL } from '../../lib/sources';

const TAB_KEY = 'lifehub-logs-tab';

type LogSite = {
  id: 'body' | 'marvel' | 'music';
  label: string;
  name: string;
  url: string;
  /** Can it run inside Life Hub with its real data? */
  embed: boolean;
  note?: string;
};

const SITES: LogSite[] = [
  { id: 'body', label: 'Nutrition & movement', name: 'Daylight Matrix', url: 'https://randymcfarland1227-wq.github.io/', embed: true },
  {
    id: 'marvel',
    label: 'Marvel',
    name: "Marvel's Den",
    url: 'https://marvels-den.randymcfarland1227.workers.dev/',
    embed: false,
    note:
      "Marvel's logs are saved in your browser for the Den's own address. Shown inside Life Hub, a browser keeps that storage separate, so the Den would look empty here — open it in its own window to log.",
  },
  { id: 'music', label: 'Music', name: 'My Music Hub', url: MUSIC_HUB_URL, embed: true },
];

/**
 * Logs: the sites where Randy records things (food + movement, Marvel's behavior, music
 * sessions), switchable in one place. Sites that can run inside Life Hub with their real data are
 * embedded; the rest open in their own window.
 */
export function LogsView() {
  const [tab, setTab] = useState<LogSite['id']>(() => {
    const saved = readSaved<string>(TAB_KEY, 'body');
    return SITES.some(s => s.id === saved) ? (saved as LogSite['id']) : 'body';
  });
  const site = SITES.find(s => s.id === tab) || SITES[0];
  const pick = (id: LogSite['id']) => {
    setTab(id);
    writeSaved(TAB_KEY, id);
  };
  return (
    <div className="settings-view logs-view">
      <div className="why-tabs">
        <div className="seg" role="tablist" aria-label="Logs">
          {SITES.map(s => (
            <button key={s.id} type="button" role="tab" aria-selected={s.id === tab} className={s.id === tab ? 'active' : ''} onClick={() => pick(s.id)}>
              {s.label}
            </button>
          ))}
        </div>
        <a className="row-action ghost" href={site.url} target="_blank" rel="noopener noreferrer">
          Open {site.name} ↗
        </a>
      </div>
      {site.embed ? (
        <iframe key={site.id} className="why-flow-frame" src={site.url} title={site.name} loading="lazy" allow="clipboard-write; microphone" />
      ) : (
        <div className="logs-card glass-panel">
          <p className="section-label">{site.label}</p>
          <h2>{site.name}</h2>
          <p className="review-lede">{site.note}</p>
          <a className="row-action" href={site.url} target="_blank" rel="noopener noreferrer">
            Open {site.name} ↗
          </a>
        </div>
      )}
    </div>
  );
}
