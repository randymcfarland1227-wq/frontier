'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';

type RoomId = 'search' | 'resale' | 'candle';
type SpaceId = 'home' | RoomId;
type FocusItem = { id: number; text: string; space: RoomId; done: boolean };
type FeaturedItem = { id: string; title: string; detail: string; meta: string };
type SourceSnapshot = { source: RoomId; metrics: Record<string, number>; featured: FeaturedItem[]; refreshedAt: string };

const JOB_HUB = 'https://script.google.com/macros/s/AKfycbyYuq1_GDfbLtx1YZwIk7Khvewegl3_xocLnM_gv7zzujapMXxxXDlgWsqaiCiI4a9EIA/exec';
const RESALE_HUB = 'https://randymcfarland1227-wq.github.io/sell-hub/';
const CANDLE_HUB = 'https://randymcfarland1227-wq.github.io/peculiar-candles/';

const spaces = [
  { id: 'search' as const, number: '01', name: 'Job Hunt', label: 'Applications and pipeline', description: 'Review applications, active opportunities, ready-to-apply roles, and starred pipeline items.', action: 'Open job hunt', marker: '↗' },
  { id: 'resale' as const, number: '02', name: 'Resale Hub', label: 'Listings and sales', description: 'Review items listed, items sold, listing views, and starred resale actions.', action: 'Open resale hub', marker: '◇' },
  { id: 'candle' as const, number: '03', name: 'Candle Making', label: 'Build and pour status', description: 'Review jars available, jars in use, low oils, curing candles, total pours, and starred candle log entries.', action: 'Open candle site', marker: '◒' },
];

const roomCopy = {
  search: { eyebrow: 'Applications and pipeline', title: 'Job Hunt', intro: 'Live job application numbers and the pipeline items you starred in the Job Search Hub.', feature: 'Starred pipeline items', empty: 'Star a pipeline item in the Job Search Hub to show it here.', url: JOB_HUB },
  resale: { eyebrow: 'Listings and sales', title: 'Resale Hub', intro: 'Live resale numbers and the actions you starred in the Resale Hub.', feature: 'Starred resale actions', empty: 'Star an action in the Resale Hub to show it here.', url: RESALE_HUB },
  candle: { eyebrow: 'Pours and supplies', title: 'Candle Making', intro: 'Live candle-making numbers and the log entries you starred in the candle site.', feature: 'Starred candle log entries', empty: 'Star a log entry in the candle site to show it here.', url: CANDLE_HUB },
};

const starterFocus: FocusItem[] = [
  { id: 1, text: 'Move one strong application forward', space: 'search', done: false },
  { id: 2, text: 'Prepare one item to list', space: 'resale', done: false },
  { id: 3, text: 'Record the next candle decision', space: 'candle', done: false },
];

const emptySnapshots: Record<RoomId, SourceSnapshot> = {
  search: { source: 'search', metrics: {}, featured: [], refreshedAt: '' },
  resale: { source: 'resale', metrics: {}, featured: [], refreshedAt: '' },
  candle: { source: 'candle', metrics: {}, featured: [], refreshedAt: '' },
};

const metricDefinitions: Record<RoomId, { key: string; label: string }[]> = {
  search: [{ key: 'applied', label: 'Jobs applied' }, { key: 'pipeline', label: 'Jobs in pipeline' }, { key: 'ready', label: 'Ready to apply' }, { key: 'activeRecords', label: 'Active job records' }],
  resale: [{ key: 'listed', label: 'Items listed' }, { key: 'sold', label: 'Items sold' }, { key: 'activeListings', label: 'Active listings' }, { key: 'listingViews', label: 'Listing views' }],
  candle: [{ key: 'jarsAvailable', label: 'Jars available' }, { key: 'jarsInUse', label: 'Jars in use' }, { key: 'oilsLow', label: 'Oils low on stock' }, { key: 'candlesCuring', label: 'Candles curing' }, { key: 'totalPoured', label: 'Total poured' }],
};

function readSaved<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try { return JSON.parse(localStorage.getItem(key) || '') as T; } catch { return fallback; }
}

function updatedLabel(value: string) {
  if (!value) return 'Connecting to source site…';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Connected to source site';
  return `Updated ${date.toLocaleDateString([], { month: 'short', day: 'numeric' })} at ${date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

function metricValue(snapshot: SourceSnapshot, key: string) {
  return Number.isFinite(snapshot.metrics[key]) ? snapshot.metrics[key].toLocaleString() : '—';
}

export default function Home() {
  const [active, setActive] = useState<SpaceId>('home');
  const [focusOpen, setFocusOpen] = useState(false);
  const [focus, setFocus] = useState<FocusItem[]>(starterFocus);
  const [snapshots, setSnapshots] = useState(emptySnapshots);
  const [ready, setReady] = useState(false);
  const searchFrame = useRef<HTMLIFrameElement>(null);
  const resaleFrame = useRef<HTMLIFrameElement>(null);
  const sourceWindows = useRef<Partial<Record<RoomId, Window>>>({});

  useEffect(() => {
    window.name = 'randys-work-room';
    setFocus(readSaved('workroom-focus', starterFocus));
    setSnapshots(readSaved('workroom-source-snapshots', emptySnapshots));
    setReady(true);
  }, []);
  useEffect(() => { if (ready) localStorage.setItem('workroom-focus', JSON.stringify(focus)); }, [focus, ready]);
  useEffect(() => { if (ready) localStorage.setItem('workroom-source-snapshots', JSON.stringify(snapshots)); }, [snapshots, ready]);

  useEffect(() => {
    const saveSnapshot = (payload: SourceSnapshot, preserveFeatured = false) => setSnapshots(current => ({
      ...current,
      [payload.source]: preserveFeatured ? { ...payload, featured: current[payload.source].featured } : payload,
    }));
    const receive = (event: MessageEvent) => {
      if (event.data?.type !== 'randys-workroom:snapshot') return;
      const payload = event.data.payload as SourceSnapshot;
      if (!payload || !['search', 'resale', 'candle'].includes(payload.source)) return;
      const hostname = (() => { try { return new URL(event.origin).hostname; } catch { return ''; } })();
      if (payload.source === 'search') {
        if (event.source !== searchFrame.current?.contentWindow && !hostname.endsWith('.googleusercontent.com')) return;
        saveSnapshot(payload);
        return;
      }
      if (event.origin !== 'https://randymcfarland1227-wq.github.io') return;
      const fromResaleBridge = payload.source === 'resale' && event.source === resaleFrame.current?.contentWindow;
      saveSnapshot(payload, fromResaleBridge);
    };
    const readHashSync = () => {
      const match = window.location.hash.match(/^#sync=(.+)$/);
      if (!match) return;
      try {
        const payload = JSON.parse(decodeURIComponent(atob(match[1]))) as SourceSnapshot;
        if (payload && ['search', 'resale', 'candle'].includes(payload.source)) saveSnapshot(payload);
      } catch { /* Ignore malformed sync links. */ }
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    };
    const request = () => {
      [searchFrame, resaleFrame].forEach(ref => ref.current?.contentWindow?.postMessage({ type: 'randys-workroom:request' }, '*'));
      Object.entries(sourceWindows.current).forEach(([room, sourceWindow]) => {
        if (room !== 'search') sourceWindow?.postMessage({ type: 'randys-workroom:request' }, 'https://randymcfarland1227-wq.github.io');
      });
    };
    window.addEventListener('message', receive);
    window.addEventListener('hashchange', readHashSync);
    readHashSync();
    const timer = window.setInterval(request, 12000);
    window.setTimeout(request, 1200);
    return () => { window.removeEventListener('message', receive); window.removeEventListener('hashchange', readHashSync); window.clearInterval(timer); };
  }, []);

  const unfinished = focus.filter(item => !item.done).length;
  const enter = (id: SpaceId) => { setActive(id); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const openSource = (room: RoomId) => {
    const sourceWindow = window.open(roomCopy[room].url, `randys-${room}-source`);
    if (sourceWindow) sourceWindows.current[room] = sourceWindow;
    if (room !== 'search') {
      const request = () => sourceWindow?.postMessage({ type: 'randys-workroom:request' }, 'https://randymcfarland1227-wq.github.io');
      window.setTimeout(request, 1200);
      window.setTimeout(request, 3200);
      window.setTimeout(request, 7000);
    }
  };

  return (
    <main className={`frontier-shell theme-${active}`}>
      <Header active={active} enter={enter} unfinished={unfinished} openFocus={() => setFocusOpen(true)} />
      {active === 'home' ? <HomeView enter={enter} snapshots={snapshots} /> : <RoomView room={active} snapshot={snapshots[active]} openSource={() => openSource(active)} />}
      <FocusDrawer open={focusOpen} close={() => setFocusOpen(false)} focus={focus} setFocus={setFocus} enter={enter} />
      <div className="source-bridges" aria-hidden="true">
        <iframe ref={searchFrame} src={JOB_HUB} title="Job Search Hub data connection" />
        <iframe ref={resaleFrame} src={RESALE_HUB} title="Resale Hub data connection" />
      </div>
    </main>
  );
}

function Header({ active, enter, unfinished, openFocus }: { active: SpaceId; enter: (id: SpaceId) => void; unfinished: number; openFocus: () => void }) {
  return <header className="topbar">
    <button className="wordmark" onClick={() => enter('home')} aria-label="Randy's Work Room home"><span className="wordmark-mark">R</span><span>RANDY&apos;S WORK ROOM</span></button>
    <nav className="room-nav" aria-label="Workspaces">{spaces.map(space => <button className={active === space.id ? 'active' : ''} key={space.id} onClick={() => enter(space.id)}>{space.name}</button>)}</nav>
    <button className="mode-button" type="button" onClick={openFocus}>Today <span>{String(unfinished).padStart(2, '0')}</span></button>
  </header>;
}

function HomeView({ enter, snapshots }: { enter: (id: SpaceId) => void; snapshots: Record<RoomId, SourceSnapshot> }) {
  const latest = Object.values(snapshots).map(item => item.refreshedAt).filter(Boolean).sort().at(-1) || '';
  return <>
    <section className="hero" id="top">
      <div className="hero-kicker"><span /> Job hunt, resale, and candle making</div>
      <h1>Randy&apos;s<br /><em>Work Room.</em></h1>
      <div className="hero-bottom"><p>One place to check live numbers and the items you chose to feature from each original site.</p><div className="current-intent"><span>Work Room status</span><strong>{updatedLabel(latest)}</strong></div></div>
    </section>
    <section className="space-grid" aria-label="Your three work sites">
      {spaces.map(space => {
        const snapshot = snapshots[space.id];
        return <article className={`space-card ${space.id}`} key={space.name}>
          <div className="card-top"><span>{space.number}</span><span className="marker">{space.marker}</span></div>
          <div className="card-copy"><p>{space.label}</p><h2>{space.name}</h2><p className="description">{space.description}</p></div>
          <MetricGrid room={space.id} snapshot={snapshot} compact />
          <FeaturedList room={space.id} snapshot={snapshot} compact />
          <button type="button" className="enter-button" onClick={() => enter(space.id)}>{space.action}<span>→</span></button>
        </article>;
      })}
    </section>
    <footer className="home-footer"><span>Randy&apos;s Work Room</span><p>Job hunt · Resale · Candle making</p><span>Est. 2026</span></footer>
  </>;
}

function MetricGrid({ room, snapshot, compact = false }: { room: RoomId; snapshot: SourceSnapshot; compact?: boolean }) {
  const definitions = metricDefinitions[room].slice(0, compact ? (room === 'candle' ? 5 : 3) : metricDefinitions[room].length);
  return <div className={compact ? `card-metrics ${room}` : `room-metrics ${room}`}>
    {definitions.map(metric => <article key={metric.key}><strong>{metricValue(snapshot, metric.key)}</strong><span>{metric.label}</span></article>)}
    <p>{updatedLabel(snapshot.refreshedAt)}</p>
  </div>;
}

function FeaturedList({ room, snapshot, compact = false }: { room: RoomId; snapshot: SourceSnapshot; compact?: boolean }) {
  const copy = roomCopy[room];
  const items = snapshot.featured.slice(0, compact ? 2 : 12);
  return <section className={`featured-list ${compact ? 'compact' : ''}`}>
    <div className="featured-heading"><span>★</span><h3>{copy.feature}</h3></div>
    {items.length ? items.map(item => <article className="featured-row" key={item.id}><div><strong>{item.title}</strong><p>{item.detail}</p><span>{item.meta}</span></div></article>) : <p className="featured-empty">{snapshot.refreshedAt ? copy.empty : 'Connecting to the source site…'}</p>}
    {compact && snapshot.featured.length > 2 ? <p className="featured-more">+{snapshot.featured.length - 2} more featured</p> : null}
  </section>;
}

function RoomView({ room, snapshot, openSource }: { room: RoomId; snapshot: SourceSnapshot; openSource: () => void }) {
  const copy = roomCopy[room];
  return <div className="room">
    <section className="room-hero"><div className="room-index">{room === 'search' ? '01' : room === 'resale' ? '02' : '03'}</div><div><p className="room-eyebrow">{copy.eyebrow}</p><h1>{copy.title}</h1><p className="room-intro">{copy.intro}</p></div><div className="room-symbol" aria-hidden="true">{room === 'search' ? '↗' : room === 'candle' ? '◒' : '◇'}</div></section>
    <MetricGrid room={room} snapshot={snapshot} />
    <section className="room-body"><aside className="room-aside"><p className="section-label">Original site</p><h2>Use the full site.</h2><p>Open it from here, then star pipeline items, resale actions, or candle logs. The Work Room will save each update.</p><button className="primary-link" type="button" onClick={openSource}>Open {copy.title} <span>↗</span></button></aside><div className="work-ledger"><FeaturedList room={room} snapshot={snapshot} /></div></section>
  </div>;
}

function FocusDrawer({ open, close, focus, setFocus, enter }: { open: boolean; close: () => void; focus: FocusItem[]; setFocus: (items: FocusItem[]) => void; enter: (id: SpaceId) => void }) {
  const [newText, setNewText] = useState('');
  function addFocus(event: FormEvent) { event.preventDefault(); if (!newText.trim()) return; setFocus([...focus, { id: Date.now(), text: newText.trim(), space: 'search', done: false }]); setNewText(''); }
  return <div className={`drawer-wrap ${open ? 'open' : ''}`} aria-hidden={!open}><button className="drawer-scrim" onClick={close} aria-label="Close daily focus" tabIndex={open ? 0 : -1} /><aside className="focus-drawer" aria-label="Today's focus"><div className="drawer-head"><div><p>All three sites</p><h2>Today&apos;s tasks</h2></div><button onClick={close} aria-label="Close">×</button></div><p className="drawer-intro">Tasks for the job hunt, resale work, and candle making.</p><div className="focus-list">{focus.map(item => <div className={`focus-item ${item.done ? 'done' : ''}`} key={item.id}><button className="check" onClick={() => setFocus(focus.map(current => current.id === item.id ? { ...current, done: !current.done } : current))} aria-label={item.done ? 'Mark incomplete' : 'Mark complete'}>{item.done ? '✓' : ''}</button><button className="focus-copy" onClick={() => { enter(item.space); close(); }}><span>{item.space}</span><strong>{item.text}</strong></button></div>)}</div><form className="quick-add" onSubmit={addFocus}><input value={newText} onChange={event => setNewText(event.target.value)} placeholder="Add a task for today…" aria-label="New focus item" /><button type="submit">+</button></form><p className="drawer-foot">These tasks are stored in this browser.</p></aside></div>;
}
