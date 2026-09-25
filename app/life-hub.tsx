'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { applyHubStars, HUB_STAR_SOURCES, HUB_STARS_EVENT, loadHubStars, setHubStar } from '../lib/hubStars';
import { originAllowed, requestSnapshot, sendComplete, sendStar } from '../lib/protocol';
import {
  addSelfItem,
  loadSelfItems,
  logSelfItem,
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
  diffSnapshotCompletions,
  emptyStats,
  type CompletionLedger,
  saveLedger,
  type CompletionStats,
} from '../lib/completions';
import { addCapture, loadCaptures, markPromoted, setCaptureStatus, type Capture } from '../lib/captures';
import { CapturesPanel } from './components/CapturesPanel';
import { WhyPanel } from './components/WhyPanel';
import { AreaPicker } from './components/AreaPicker';
import { loadPriorityPins, pinKey, savePriorityPins } from '../lib/priorityPins';
import { checkInTickTickHabit, getHabitSchedule, pullTickTickDone } from '../lib/ticktickDone';
import {
  bucketSuggestions,
  dayKey,
  loadBalanceSettings,
  recordAvailability,
  saveBalanceSettings,
  todayAvailability,
  type BalanceSettings,
  type HabitSchedule,
} from '../lib/energy';
import { BalanceStrip } from './components/BalanceStrip';
import { completeRoleTask, pullRoleSnapshot, starRoleItem } from '../lib/roleFeed';
import { pullGmailSnapshot, unstarGmail } from '../lib/gmailFeed';
import { buildTickTickToday, fetchOpenTickTick } from '../lib/ticktickLive';
import { isIgnoredItem, resolveFocusArea } from '../lib/focusAreas';

/** Sources where one bucket doesn't fit every item — ask on Done. */
const ASK_AREA_SOURCES: SourceId[] = ['gmail', 'outlook'];
import { consumeLocationHash, startCloudSync, SYNCED_EVENT } from '../lib/cloudSync';
import {
  addLink,
  goalOf,
  linkGoalIndex,
  loadGoals,
  loadSeedLinks,
  mergeLinks,
  removeLink,
  type GoalLink,
  type GoalsData,
} from '../lib/goals';
import { ruleFor, saveTaskRule, sourceRuleKey, taskRuleKey, useTaskRules } from '../lib/taskRules';
import { TaskSorting } from './components/TaskSorting';
import { NeedsSorting } from './components/NeedsSorting';
import { backfillFocusAreas, loadFocusAreas, type FocusAreaConfig } from '../lib/focusAreas';

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
    // Role Hub and TickTick also arrive live; keep whichever is newer than the morning file.
    if ((id === 'role' || id === 'ticktick' || id === 'gmail') && Date.parse(current[id]?.refreshedAt || '') > Date.parse(snap.refreshedAt || '')) continue;
    // Always overwrite the four connector sources from network (do not wipe iframe sources).
    next[id] = {
      source: id,
      metrics: snap.metrics || {},
      featured: snap.featured || [],
      // Reminders / reference notes aren't tasks.
      tasks: (snap.tasks || []).filter(t => !isIgnoredItem(id, t.title)),
      refreshedAt: snap.refreshedAt || new Date().toISOString(),
    };
  }
  return next;
}

function localDay(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/**
 * Connector snapshots are written once each morning, so an item marked Done on the hub is still
 * in the file until the next sync. Hide anything the ledger already has as done so it stays gone
 * after a refresh. TickTick ids repeat (recurring tasks, habits), so only today's Done hides them.
 */
function hideLedgerDone(
  snapshots: Record<SourceId, SourceSnapshot>,
  ledger: CompletionLedger,
): Record<SourceId, SourceSnapshot> {
  const today = localDay(new Date().toISOString());
  const done = new Set<string>();
  for (const e of Object.values(ledger.entries)) {
    if (e.source === 'ticktick' && localDay(e.completedAt) !== today) continue;
    done.add(`${e.source}::${e.taskId}`);
  }
  let next = snapshots;
  for (const id of CONNECTOR_SOURCE_IDS) {
    let snap = next[id];
    if (!snap) continue;
    const isDone = (itemId: string) => done.has(`${id}::${itemId}`);
    const hide = new Set([
      ...snap.tasks.filter(t => t.status !== 'done' && isDone(t.id)).map(t => t.id),
      ...snap.featured.filter(f => isDone(f.id) && !snap!.tasks.some(t => t.id === f.id && t.status === 'done')).map(f => f.id),
    ]);
    if (!hide.size) continue;
    let metrics = snap.metrics;
    for (const itemId of hide) metrics = metricsAfterLocalComplete(id, { ...snap, metrics }, itemId);
    snap = {
      ...snap,
      metrics,
      tasks: snap.tasks.filter(t => !hide.has(t.id)),
      featured: snap.featured.filter(f => !hide.has(f.id)),
    };
    next = { ...next, [id]: snap };
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
  const [focusConfig, setFocusConfig] = useState<FocusAreaConfig | null>(null);
  const [habitSchedule, setHabitSchedule] = useState<HabitSchedule[] | null>(null);
  const [balanceSettings, setBalanceSettings] = useState<BalanceSettings>(() => loadBalanceSettings());
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [goalsData, setGoalsData] = useState<GoalsData | null>(null);
  const [seedLinks, setSeedLinks] = useState<GoalLink[]>([]);
  const [goalLinks, setGoalLinks] = useState<GoalLink[]>([]);
  const [pendingArea, setPendingArea] = useState<{
    source: SourceId;
    id: string;
    title: string;
    area?: string;
    goal?: string;
  } | null>(null);
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
        return hideLedgerDone(mergeConnectorSnapshots(current, incoming), nextLedger);
      });
    } finally {
      setConnectorSyncing(false);
    }
  }, []);

  useEffect(() => {
    window.name = 'randys-life-hub';
    consumeLocationHash();
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
    setCaptures(loadCaptures());
    setSnapshots(snaps);
    setLedger(loadLedger());
    const savedTheme = readSaved<'light' | 'dark'>(STORAGE_KEYS.theme, 'dark');
    setTheme(savedTheme);
    document.documentElement.dataset.theme = savedTheme;
    setReady(true);
    startCloudSync();
  }, []);

  useEffect(() => {
    if (!ready) return;
    void loadConnectors();
    void loadFocusAreas().then(config => {
      if (config) setFocusConfig(config);
    });
    void loadGoals().then(setGoalsData);
    void loadSeedLinks().then(seed => {
      setSeedLinks(seed);
      setGoalLinks(mergeLinks(seed));
    });
  }, [ready, loadConnectors]);

  // Role Hub's pushed snapshot (applications) — on load, on return, every 10 min. Newer wins.
  useEffect(() => {
    if (!ready) return;
    const pullGmail = () =>
      void pullGmailSnapshot().then(snap => {
        if (!snap) return;
        setSnapshots(current =>
          Date.parse(current.gmail?.refreshedAt || '') >= Date.parse(snap.refreshedAt) ? current : { ...current, gmail: snap },
        );
      });
    const pullRole = () =>
      void pullRoleSnapshot().then(snap => {
        if (!snap) return;
        setSnapshots(current => {
          if (Date.parse(current.role?.refreshedAt || '') >= Date.parse(snap.refreshedAt)) return current;
          setLedger(diffSnapshotCompletions('role', current.role, snap, loadLedger()));
          return { ...current, role: snap };
        });
      });
    const pull = () => {
      pullRole();
      pullGmail();
    };
    pull();
    const onVisible = () => document.visibilityState === 'visible' && pull();
    document.addEventListener('visibilitychange', onVisible);
    const timer = window.setInterval(pull, 10 * 60 * 1000);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(timer);
    };
  }, [ready]);

  // Work finished inside the TickTick app (tasks + habit check-ins) — on load, on return, every 10 min.
  useEffect(() => {
    if (!ready) return;
    const pull = () =>
      void pullTickTickDone().then(async next => {
        if (next) setLedger(next);
        const schedule = getHabitSchedule();
        setHabitSchedule(schedule);
        // Live Today list: due today + overdue tasks, and habits due today not yet checked in.
        const open = await fetchOpenTickTick();
        if (open) {
          const led = next ?? loadLedger();
          setSnapshots(current => ({ ...current, ticktick: buildTickTickToday(open, schedule, led, current.ticktick) }));
        }
      });
    pull();
    const onVisible = () => document.visibilityState === 'visible' && pull();
    document.addEventListener('visibilitychange', onVisible);
    const timer = window.setInterval(pull, 10 * 60 * 1000);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(timer);
    };
  }, [ready]);

  // Cloud backup merged new data into storage (another device, or the old Worker copy).
  const seedLinksRef = useRef<GoalLink[]>([]);
  useEffect(() => {
    seedLinksRef.current = seedLinks;
  }, [seedLinks]);
  useEffect(() => {
    const reload = () => {
      const synced = loadLedger();
      setLedger(synced);
      setSnapshots(current => hideLedgerDone(current, synced));
      setCaptures(loadCaptures());
      syncSelf(loadSelfItems());
      setGoalLinks(mergeLinks(seedLinksRef.current));
      setBalanceSettings(loadBalanceSettings());
    };
    window.addEventListener(SYNCED_EVENT, reload);
    return () => window.removeEventListener(SYNCED_EVENT, reload);
  }, [syncSelf]);

  // Tag untagged history once areas are known; re-runs as snapshots arrive with project/kind info.
  const taggedLedger = useMemo(() => {
    if (!focusConfig) return ledger;
    const copy: CompletionLedger = structuredClone(ledger);
    return backfillFocusAreas(copy, focusConfig, snapshots) ? copy : ledger;
  }, [ledger, focusConfig, snapshots]);

  useEffect(() => {
    if (taggedLedger !== ledger) saveLedger(taggedLedger);
  }, [taggedLedger, ledger]);

  // What the page shows and scores: without reminders / reference notes (kept in storage, just not counted).
  // Task sorting rules (bucket + goal per task), cloud-synced.
  const { rules: taskRules } = useTaskRules();
  const linkIdx = useMemo(() => linkGoalIndex(goalLinks, captures), [goalLinks, captures]);

  const visibleLedger = useMemo(() => {
    if (!focusConfig) return taggedLedger;
    const entries: typeof taggedLedger.entries = {};
    for (const [k, e] of Object.entries(taggedLedger.entries)) {
      if (isIgnoredItem(e.source, e.title, focusConfig)) continue;
      // A bucket picked on Task sorting re-sorts past completions of that task too.
      const picked = ruleFor(e.source, e.title, e.taskId, taskRules).area;
      entries[k] =
        picked && picked !== e.focusAreaId && focusConfig.areas.some(a => a.id === picked) ? { ...e, focusAreaId: picked } : e;
    }
    return { entries };
  }, [taggedLedger, focusConfig, taskRules]);

  // TickTick has no star of its own: Life Hub keeps those stars (cloud-synced).
  const [hubStars, setHubStars] = useState(() => loadHubStars());
  useEffect(() => {
    const reload = () => setHubStars(loadHubStars());
    window.addEventListener(HUB_STARS_EVENT, reload);
    window.addEventListener('lifehub:synced', reload);
    return () => {
      window.removeEventListener(HUB_STARS_EVENT, reload);
      window.removeEventListener('lifehub:synced', reload);
    };
  }, []);

  // Same for what's listed: reminders / reference notes never show, wherever they came from.
  const visibleSnapshots = useMemo(() => {
    const out = { ...snapshots };
    for (const id of HUB_STAR_SOURCES) {
      if (out[id]) out[id] = applyHubStars(id, out[id], hubStars);
    }
    if (!focusConfig?.ignore) return out;
    for (const id of Object.keys(out) as SourceId[]) {
      const snap = out[id];
      if (!snap || !focusConfig.ignore[id]) continue;
      const tasks = snap.tasks.filter(t => !isIgnoredItem(id, t.title, focusConfig));
      let metrics = snap.metrics;
      if (id === 'ticktick') {
        // Counts come from what's listed, so they match the list.
        const today = dayKey(new Date());
        const open = tasks.filter(t => t.status !== 'done');
        const isHabit = (t: TaskItem) => t.kind === 'habit' || t.id.startsWith('habit-');
        metrics = {
          ...metrics,
          dueToday: open.filter(t => !isHabit(t) && (t.due || '').slice(0, 10) >= today).length,
          overdue: open.filter(t => !isHabit(t) && t.due && t.due.slice(0, 10) < today).length,
          habits: open.filter(isHabit).length,
        };
      }
      out[id] = {
        ...snap,
        metrics,
        tasks,
        featured: snap.featured.filter(f => !isIgnoredItem(id, f.title, focusConfig)),
      };
    }
    return out;
  }, [snapshots, focusConfig, hubStars]);

  // Today's workload per bucket (open items + done today + habits due today), remembered per day.
  const todayAvail = useMemo(
    () => (focusConfig ? todayAvailability(focusConfig, visibleSnapshots, selfItems, visibleLedger, habitSchedule) : {}),
    [focusConfig, visibleSnapshots, selfItems, visibleLedger, habitSchedule],
  );
  useEffect(() => {
    if (focusConfig && Object.keys(todayAvail).length) recordAvailability(dayKey(new Date()), todayAvail);
  }, [focusConfig, todayAvail]);
  const chargeSuggestions = useMemo(
    () => (focusConfig ? bucketSuggestions(focusConfig, visibleSnapshots, selfItems, visibleLedger, habitSchedule) : {}),
    [focusConfig, visibleSnapshots, selfItems, visibleLedger, habitSchedule],
  );

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
    setCompletionStats(computeStats(visibleLedger, visibleSnapshots));
  }, [visibleLedger, visibleSnapshots, ready]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    if (ready) writeSaved(STORAGE_KEYS.theme, theme);
  }, [theme, ready]);

  useEffect(() => {
    const saveSnapshot = (payload: SourceSnapshot, preserveFeatured = false) => {
      const id = normalizeSourceId(String(payload.source));
      if (!id || id === 'self') return;
      // Do not let postMessage wipe connector JSON sources — except Role Hub, which posts
      // its own live snapshot when opened; accept it only if newer than what we have.
      if (isConnectorSource(id) && id !== 'role') return;
      if (
        id === 'role' &&
        Date.parse(snapshotsRef.current.role?.refreshedAt || '') > Date.parse(payload.refreshedAt || '')
      ) {
        return;
      }
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
          const task = snapshotsRef.current[id]?.tasks?.find(t => t.id === taskId);
          setLedger(
            recordCompletion(id, taskId, { via: 'origin-done', title: payload.title || task?.title, task }),
          );
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
      // Resale's featured list is its own (stars set on the Resale site or from here), so take it as sent.
      saveSnapshot(payload);
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

  const completeOnHub = (source: SourceId, id: string, chosenArea?: string) => {
    const snapNow = snapshotsRef.current[source];
    const taskNow = snapNow?.tasks?.find(t => t.id === id);
    const featuredNow = snapNow?.featured?.find(f => f.id === id);
    const selfItem = source === 'self' ? loadSelfItems().find(i => i.id === id) : undefined;
    const title = taskNow?.title || featuredNow?.title || selfItem?.title;
    if (!chosenArea && focusConfig) {
      // Ask what it's for when the bucket or goal isn't known yet (mail always needs its bucket picked).
      const picked = ruleFor(source, title, id);
      const area =
        picked.area ||
        selfItem?.focusAreaId ||
        (ASK_AREA_SOURCES.includes(source)
          ? undefined
          : resolveFocusArea({ source, taskId: id, title, kind: taskNow?.kind, projectId: taskNow?.projectId }));
      const goal = goalOf(source, title, [id], taskRules, linkIdx);
      if (!area || !goal) {
        setPendingArea({ source, id, title: title || '', area, goal });
        return;
      }
    }
    if (source === 'self') {
      setLedger(
        recordCompletion('self', id, { via: 'self', title, task: taskNow, focusAreaId: chosenArea || selfItem?.focusAreaId }),
      );
      syncSelf(toggleSelfComplete(id));
      return;
    }

    setLedger(recordCompletion(source, id, { via: 'hub', title, task: taskNow, focusAreaId: chosenArea }));

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

    if (source === 'role') completeRoleTask(id);
    if (source === 'gmail') unstarGmail(id);

    if (source === 'ticktick') {
      const habit = isTickTickHabit({ id, kind: taskNow?.kind });
      if (habit) {
        checkInTickTickHabit(id);
      } else {
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
    if (HUB_STAR_SOURCES.includes(source)) {
      setHubStar(source, task.id, !task.starred);
      return;
    }
    // Role Hub stars are queued and applied in Role Hub; other file-fed sources open their site.
    if (isConnectorSource(source) && !(source === 'role' && !task.id.startsWith('hubtask:'))) {
      openConnectorOrigin(task, sourceById[source].url);
      return;
    }
    const nextStarred = !task.starred;
    if (source === 'role') starRoleItem(task.id, nextStarred);
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
    if (source !== 'role') broadcastStar(source, task.id, nextStarred);
  };

  const promoteCapture = (capture: Capture) => {
    const detail = [capture.notes, capture.url].filter(Boolean).join('\n');
    const items = addSelfItem(capture.title, detail, {
      focusAreaId: capture.focusAreaId,
      fromCaptureId: capture.id,
    });
    syncSelf(items);
    setCaptures(markPromoted(capture.id, { source: 'self', taskId: items[0].id }));
  };

  const registerFrame = (id: SourceId, el: HTMLIFrameElement | null) => {
    frameRefs.current[id] = el;
  };

  return (
    <main className={`frontier-shell theme-${active === 'home' || active === 'settings' ? 'home' : active}`} data-color-mode={theme}>
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
          snapshots={visibleSnapshots}
          openSource={openSource}
          onCompleteFeatured={(source, item) => completeOnHub(source, item.id)}
          onCompleteTask={(source, task) => completeOnHub(source, task.id)}
          onStarTask={(source, task) => starOnHub(source, task)}
          completionStats={completionStats}
          ledger={visibleLedger}
          focusConfig={focusConfig}
          renderSorting={entries =>
            focusConfig ? (
              <NeedsSorting
                entries={entries}
                areas={focusConfig.areas}
                goals={goalsData}
                links={goalLinks}
                captures={captures}
                openSorting={() => enter('settings')}
              />
            ) : null
          }
          renderBalance={period =>
            focusConfig ? (
              <BalanceStrip
                window={period}
                suggestions={chargeSuggestions}
                ledger={visibleLedger}
                config={focusConfig}
                today={todayAvail}
                settings={balanceSettings}
                onSaveSettings={paces => setBalanceSettings(saveBalanceSettings(paces))}
              />
            ) : null
          }
          whyPanel={
            goalsData ? (
              <WhyPanel
                data={goalsData}
                links={goalLinks}
                ledger={visibleLedger}
                captures={captures}
                snapshots={visibleSnapshots}
                selfItems={selfItems}
                areas={focusConfig?.areas || []}
                onLink={(goalId, target, label) => setGoalLinks(addLink(seedLinks, goalId, target, label))}
                onUnlink={linkId => setGoalLinks(removeLink(seedLinks, linkId))}
              />
            ) : null
          }
          capturesPanel={
            <CapturesPanel
              captures={captures}
              areas={focusConfig?.areas || []}
              selfItems={selfItems}
              onAdd={input => setCaptures(addCapture(input))}
              onAddTask={(title, detail, focusAreaId) =>
                syncSelf(addSelfItem(title, detail, focusAreaId ? { focusAreaId } : undefined))
              }
              onLogTask={(title, detail, focusAreaId, at) => {
                const items = logSelfItem(title, detail, focusAreaId || undefined, at);
                setLedger(
                  recordCompletion('self', items[0].id, { via: 'self', title: items[0].title, at, focusAreaId: focusAreaId || undefined }),
                );
                syncSelf(items);
              }}
              onTaskDone={id => completeOnHub('self', id)}
              onTaskUndo={id => syncSelf(toggleSelfComplete(id))}
              onTaskStar={id => {
                // Starring a Self task pins it to Priority (and unstarring unpins it).
                const items = toggleSelfStar(id);
                const key = pinKey('self', id);
                const pins = loadPriorityPins().filter(k => k !== key);
                savePriorityPins(items.find(i => i.id === id)?.starred ? [key, ...pins] : pins);
                syncSelf(items);
              }}
              onStatus={(id, status) => setCaptures(setCaptureStatus(id, status))}
              onPromote={promoteCapture}
            />
          }
        />
      ) : active === 'settings' ? (
        <div className="settings-view">
          <TaskSorting
            snapshots={visibleSnapshots}
            ledger={visibleLedger}
            config={focusConfig}
            goals={goalsData}
            links={goalLinks}
            captures={captures}
          />
        </div>
      ) : (
        <SourceView
          sourceId={active}
          snapshot={visibleSnapshots[active]}
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
      {pendingArea && focusConfig ? (
        <AreaPicker
          title={pendingArea.title}
          sourceName={sourceById[pendingArea.source].shortName}
          areas={focusConfig.areas}
          goals={goalsData}
          suggested={
            pendingArea.area ||
            focusConfig.areas.find(a => a.sourceMap.some(r => r.source === pendingArea.source && !r.match))?.id
          }
          initialGoal={pendingArea.goal}
          onPick={choice => {
            const p = pendingArea;
            setPendingArea(null);
            // Remember it, so the same task (or every task from this site) sorts itself next time.
            saveTaskRule(choice.wholeSource ? sourceRuleKey(p.source) : taskRuleKey(p.source, p.title, p.id), {
              area: choice.area,
              goal: choice.goal,
            });
            completeOnHub(p.source, p.id, choice.area);
          }}
          onCancel={() => setPendingArea(null)}
        />
      ) : null}
    </main>
  );
}
