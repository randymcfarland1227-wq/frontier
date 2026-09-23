'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  FeaturedItem,
  FocusItem,
  SourceId,
  SourceSnapshot,
  SpaceId,
  TaskItem,
} from '../lib/types';
import { emptySnapshots, normalizeSourceId, sourceById, sources } from '../lib/sources';
import { readSaved, writeSaved, STORAGE_KEYS } from '../lib/storage';
import { originAllowed, requestSnapshot, sendComplete, sendStar } from '../lib/protocol';
import {
  addSelfItem,
  loadSelfItems,
  selfSnapshotFrom,
  toggleSelfComplete,
  toggleSelfStar,
  type SelfItem,
} from '../lib/adapters/self';
import {
  CONNECTOR_SOURCE_IDS,
  fetchConnectorSnapshots,
  isConnectorSource,
  openConnectorOrigin,
} from '../lib/connectors';
import { metricsAfterLocalComplete } from '../lib/actionable';
import {
  completeTickTickTaskInBackground,
  isTickTickHabit,
  projectIdFromTask,
} from '../lib/ticktickComplete';
import { Header } from './components/Header';
import { HomeView } from './components/HomeView';
import { SourceView } from './components/SourceView';
import { FocusDrawer } from './components/FocusDrawer';
import { SourceBridges } from './components/SourceBridges';
import {
  loadLedger,
  recordCompletion,
  computeStats,
  sourceShares,
  diffSnapshotCompletions,
  emptyStats,
  type CompletionLedger,
  type CompletionStats,
} from '../lib/completions';

const starterFocus: FocusItem[] = [
  { id: 1, text: 'Move one strong application forward', space: 'role', done: false },
  { id: 2, text: 'Prepare one item to list', space: 'resale', done: false },
  { id: 3, text: 'Capture one Self note', space: 'self', done: false },
];

function migrateSnapshots(raw: unknown): Record<SourceId, SourceSnapshot> {
  const base = emptySnapshots();
  if (!raw || typeof raw !== 'object') return base;
  const input = raw as Record<string, SourceSnapshot>;
  for (const [key, value] of Object.entries(input)) {
    const id = normalizeSourceId(key === 'search' ? 'search' : key);
    if (!id || !value) continue;
    base[id] = {
      source: id,
      metrics: value.metrics || {},
      featured: value.featured || [],
      tasks: value.tasks || [],
      refreshedAt: value.refreshedAt || '',
    };
  }
  return base;
}

function migrateFocus(raw: FocusItem[]): FocusItem[] {
  return raw.map(item => {
    const space = normalizeSourceId(String((item as FocusItem & { space: string }).space)) || 'self';
    return { ...item, space };
  });
}

function mergeConnectorSnapshots(
  current: Record<SourceId, SourceSnapshot>,
  incoming: Partial<Record<SourceId, SourceSnapshot>>,
): Record<SourceId, SourceSnapshot> {
  const next = { ...current };
  for (const id of CONNECTOR_SOURCE_IDS) {
    const snap = incoming[id];
    if (!snap) continue;
    // Always overwrite the four connector sources from network (do not wipe iframe sources).
    next[id] = {
      source: id,
      metrics: snap.metrics || {},
      featured: snap.featured || [],
      tasks: snap.tasks || [],
      refreshedAt: snap.refreshedAt || new Date().toISOString(),
    };
  }
  return next;
}

export function LifeHub() {
  const [active, setActive] = useState<SpaceId>('home');
  const [focusOpen, setFocusOpen] = useState(false);
  const [focus, setFocus] = useState<FocusItem[]>(starterFocus);
  const [snapshots, setSnapshots] = useState<Record<SourceId, SourceSnapshot>>(emptySnapshots);
  const [selfItems, setSelfItems] = useState<SelfItem[]>([]);
  const [ready, setReady] = useState(false);
  const [connectorSyncing, setConnectorSyncing] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  const [ledger, setLedger] = useState<CompletionLedger>({ entries: {} });
  const [completionStats, setCompletionStats] = useState<CompletionStats>(emptyStats());
  const snapshotsRef = useRef(snapshots);
  const frameRefs = useRef<Partial<Record<SourceId, HTMLIFrameElement | null>>>({});
  const sourceWindows = useRef<Partial<Record<SourceId, Window>>>({});

  const syncSelf = useCallback((items: SelfItem[]) => {
    setSelfItems(items);
    setSnapshots(current => ({ ...current, self: selfSnapshotFrom(items) }));
  }, []);

  const loadConnectors = useCallback(async () => {
    setConnectorSyncing(true);
    try {
      const incoming = await fetchConnectorSnapshots();
      setSnapshots(current => {
        let nextLedger = loadLedger();
        for (const id of CONNECTOR_SOURCE_IDS) {
          const snap = incoming[id];
          if (!snap) continue;
          nextLedger = diffSnapshotCompletions(id, current[id], snap, nextLedger);
        }
        setLedger(nextLedger);
        return mergeConnectorSnapshots(current, incoming);
      });
    } finally {
      setConnectorSyncing(false);
    }
  }, []);

  useEffect(() => {
    window.name = 'randys-life-hub';
    const savedFocus = readSaved<FocusItem[]>(STORAGE_KEYS.focus, readSaved(STORAGE_KEYS.legacyFocus, starterFocus));
    const savedSnaps = readSaved<unknown>(
      STORAGE_KEYS.snapshots,
      readSaved(STORAGE_KEYS.legacySnapshots, emptySnapshots()),
    );
    setFocus(migrateFocus(savedFocus));
    const snaps = migrateSnapshots(savedSnaps);
    const self = loadSelfItems();
    snaps.self = selfSnapshotFrom(self);
    setSelfItems(self);
    setSnapshots(snaps);
    setLedger(loadLedger());
    const savedTheme = readSaved<'light' | 'dark'>(STORAGE_KEYS.theme, 'dark');
    setTheme(savedTheme);
    document.documentElement.dataset.theme = savedTheme;
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    void loadConnectors();
  }, [ready, loadConnectors]);

  useEffect(() => {
    if (ready) writeSaved(STORAGE_KEYS.focus, focus);
  }, [focus, ready]);

  useEffect(() => {
    snapshotsRef.current = snapshots;
  }, [snapshots]);

  useEffect(() => {
    if (ready) writeSaved(STORAGE_KEYS.snapshots, snapshots);
  }, [snapshots, ready]);

  useEffect(() => {
    if (!ready) return;
    setCompletionStats(computeStats(ledger, snapshots));
  }, [ledger, snapshots, ready]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    if (ready) writeSaved(STORAGE_KEYS.theme, theme);
  }, [theme, ready]);

  useEffect(() => {
    const saveSnapshot = (payload: SourceSnapshot, preserveFeatured = false) => {
      const id = normalizeSourceId(String(payload.source));
      if (!id || id === 'self') return;
      // Do not let postMessage wipe connector JSON sources.
      if (isConnectorSource(id)) return;
      setSnapshots(current => {
        const nextSnap = {
          source: id,
          metrics: payload.metrics || {},
          featured: preserveFeatured ? current[id].featured : payload.featured || [],
          tasks: payload.tasks || current[id].tasks || [],
          refreshedAt: payload.refreshedAt || new Date().toISOString(),
        };
        const nextLedger = diffSnapshotCompletions(id, current[id], nextSnap, loadLedger());
        setLedger(nextLedger);
        return { ...current, [id]: nextSnap };
      });
    };

    const receive = (event: MessageEvent) => {
      if (event.data?.type === 'randys-workroom:complete') {
        const payload = event.data.payload || {};
        const id = normalizeSourceId(String(payload.source || ''));
        const taskId = String(payload.id || '');
        if (id && taskId) {
          setLedger(recordCompletion(id, taskId, { via: 'origin-snapshot', title: payload.title }));
        }
        return;
      }
      if (event.data?.type !== 'randys-workroom:snapshot') return;
      const payload = event.data.payload as SourceSnapshot;
      if (!payload) return;
      const id = normalizeSourceId(String(payload.source));
      if (!id) return;
      const def = sourceById[id];

      if (id === 'role') {
        const fromFrame = event.source === frameRefs.current.role?.contentWindow;
        const hostname = (() => {
          try {
            return new URL(event.origin).hostname;
          } catch {
            return '';
          }
        })();
        if (!fromFrame && !hostname.endsWith('.googleusercontent.com') && event.origin !== 'https://script.google.com') {
          return;
        }
        saveSnapshot(payload);
        return;
      }

      if (!originAllowed(event.origin, def.allowedOrigins)) return;
      const fromBridge = event.source === frameRefs.current[id]?.contentWindow;
      saveSnapshot(payload, Boolean(fromBridge && id === 'resale'));
    };

    const readHashSync = () => {
      const match = window.location.hash.match(/^#sync=(.+)$/);
      if (!match) return;
      try {
        const payload = JSON.parse(decodeURIComponent(atob(match[1]))) as SourceSnapshot;
        if (payload) saveSnapshot(payload);
      } catch {
        /* Ignore malformed sync links. */
      }
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    };

    const requestAll = () => {
      sources.forEach(source => {
        if (source.bridge !== 'iframe') return;
        const frame = frameRefs.current[source.id];
        requestSnapshot(frame?.contentWindow, source.allowedOrigins?.[0] || '*');
      });
      Object.entries(sourceWindows.current).forEach(([id, win]) => {
        const def = sourceById[id as SourceId];
        if (!def || def.bridge === 'local') return;
        const origin = def.allowedOrigins?.[0] || '*';
        requestSnapshot(win, origin.startsWith('.') ? '*' : origin);
      });
    };

    window.addEventListener('message', receive);
    window.addEventListener('hashchange', readHashSync);
    readHashSync();
    const timer = window.setInterval(requestAll, 12000);
    window.setTimeout(requestAll, 1200);
    return () => {
      window.removeEventListener('message', receive);
      window.removeEventListener('hashchange', readHashSync);
      window.clearInterval(timer);
    };
  }, []);

  const unfinished = focus.filter(item => !item.done).length;
  const enter = (id: SpaceId) => {
    setActive(id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const openSource = (id: SourceId) => {
    const def = sourceById[id];
    if (!def.url) return;
    const sourceWindow = window.open(def.url, `randys-${id}-source`);
    if (sourceWindow) sourceWindows.current[id] = sourceWindow;
    if (def.bridge === 'iframe' || def.bridge === 'popup') {
      const origin = def.allowedOrigins?.[0]?.startsWith('.') ? '*' : def.allowedOrigins?.[0] || '*';
      const request = () => requestSnapshot(sourceWindow, origin);
      window.setTimeout(request, 1200);
      window.setTimeout(request, 3200);
      window.setTimeout(request, 7000);
    }
  };

  const broadcastComplete = (source: SourceId, id: string) => {
    const def = sourceById[source];
    const origin = def.allowedOrigins?.[0]?.startsWith('.') ? '*' : def.allowedOrigins?.[0] || '*';
    sendComplete(frameRefs.current[source]?.contentWindow, source, id, origin);
    sendComplete(sourceWindows.current[source], source, id, origin);
  };

  const broadcastStar = (source: SourceId, id: string, starred: boolean) => {
    const def = sourceById[source];
    const origin = def.allowedOrigins?.[0]?.startsWith('.') ? '*' : def.allowedOrigins?.[0] || '*';
    sendStar(frameRefs.current[source]?.contentWindow, source, id, starred, origin);
    sendStar(sourceWindows.current[source], source, id, starred, origin);
  };

  const completeOnHub = (source: SourceId, id: string) => {
    const snapNow = snapshotsRef.current[source];
    const taskNow = snapNow?.tasks?.find(t => t.id === id);
    const featuredNow = snapNow?.featured?.find(f => f.id === id);
    const title = taskNow?.title || featuredNow?.title;
    if (source === 'self') {
      setLedger(recordCompletion('self', id, { via: 'self', title }));
      syncSelf(toggleSelfComplete(id));
      return;
    }

    setLedger(recordCompletion(source, id, { via: 'hub', title }));

    const def = sourceById[source];
    const isIframe = def.bridge === 'iframe';
    // Connectors (gmail/outlook/ticktick/radall/role): local dismiss — do not open origin.
    // Iframe origins: optimistic local done + broadcastComplete.
    // TickTick tasks: also POST complete via Worker (habits: local dismiss only).
    const removeFromLists = isConnectorSource(source);

    setSnapshots(current => {
      const snap = current[source];
      if (!snap) return current;
      const nextMetrics = metricsAfterLocalComplete(source, snap, id);
      const tasks = removeFromLists
        ? snap.tasks.filter(task => task.id !== id)
        : snap.tasks.map(task => (task.id === id ? { ...task, status: 'done' } : task));
      const featured = snap.featured.filter(item => item.id !== id);
      return {
        ...current,
        [source]: {
          ...snap,
          featured,
          tasks,
          metrics: nextMetrics,
        },
      };
    });

    if (source === 'ticktick') {
      const habit = isTickTickHabit({ id, kind: taskNow?.kind });
      if (!habit) {
        const projectId = projectIdFromTask({
          projectId: taskNow?.projectId,
          originUrl: taskNow?.originUrl || featuredNow?.originUrl,
          id,
        });
        if (projectId) {
          completeTickTickTaskInBackground({ taskId: id, projectId });
        } else {
          console.warn(
            '[Life Hub] TickTick complete skipped — missing projectId',
            { taskId: id },
          );
        }
      }
    }

    if (isIframe) {
      broadcastComplete(source, id);
    }
  };

  const starOnHub = (source: SourceId, task: TaskItem) => {
    if (source === 'self') {
      syncSelf(toggleSelfStar(task.id));
      return;
    }
    if (isConnectorSource(source)) {
      openConnectorOrigin(task, sourceById[source].url);
      return;
    }
    const nextStarred = !task.starred;
    setSnapshots(current => {
      const snap = current[source];
      const tasks = snap.tasks.map(t => (t.id === task.id ? { ...t, starred: nextStarred } : t));
      let featured = snap.featured;
      if (nextStarred && !featured.some(f => f.id === task.id)) {
        featured = [
          {
            id: task.id,
            title: task.title,
            detail: task.detail || '',
            meta: `${sourceById[source].shortName} · starred`,
            originUrl: task.originUrl,
            completable: true,
          },
          ...featured,
        ];
      } else if (!nextStarred) {
        featured = featured.filter(f => f.id !== task.id);
      }
      return { ...current, [source]: { ...snap, tasks, featured } };
    });
    broadcastStar(source, task.id, nextStarred);
  };

  const registerFrame = (id: SourceId, el: HTMLIFrameElement | null) => {
    frameRefs.current[id] = el;
  };

  return (
    <main className={`frontier-shell theme-${active === 'home' ? 'home' : active}`} data-color-mode={theme}>
      <Header
        active={active}
        enter={enter}
        unfinished={unfinished}
        openFocus={() => setFocusOpen(true)}
        onRefreshConnectors={() => void loadConnectors()}
        connectorSyncing={connectorSyncing}
        theme={theme}
        onToggleTheme={() => setTheme(t => (t === 'dark' ? 'light' : 'dark'))}
      />
      {active === 'home' ? (
        <HomeView
          enter={enter}
          snapshots={snapshots}
          openSource={openSource}
          onCompleteFeatured={(source, item) => completeOnHub(source, item.id)}
          onCompleteTask={(source, task) => completeOnHub(source, task.id)}
          onStarTask={(source, task) => starOnHub(source, task)}
          completionStats={completionStats}
          completionShares={sourceShares(completionStats)}
        />
      ) : (
        <SourceView
          sourceId={active}
          snapshot={snapshots[active]}
          openSource={() => openSource(active)}
          onCompleteFeatured={(item: FeaturedItem) => completeOnHub(active, item.id)}
          onCompleteTask={(task: TaskItem) => completeOnHub(active, task.id)}
          onStarTask={(task: TaskItem) => starOnHub(active, task)}
          selfItems={selfItems}
          onSelfAdd={(title, detail) => syncSelf(addSelfItem(title, detail))}
          onSelfComplete={id => syncSelf(toggleSelfComplete(id))}
          onSelfStar={id => syncSelf(toggleSelfStar(id))}
        />
      )}
      <FocusDrawer open={focusOpen} close={() => setFocusOpen(false)} focus={focus} setFocus={setFocus} enter={enter} />
      <SourceBridges register={registerFrame} />
    </main>
  );
}
