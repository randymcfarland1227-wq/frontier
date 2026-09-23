# Life Hub — Builder Handoff

**Audience:** another builder iterating Randy’s Life Hub.  
**Do not rebuild the whole hub from scratch.** Extend what is live.  
**Primary repo:** `randymcfarland1227-wq/frontier`  
**Live URL:** https://randymcfarland1227-wq.github.io/frontier/  
**Owner GitHub:** `randymcfarland1227-wq` · Cloudflare subdomain: `randymcfarland1227`  
**Timezone:** America/New_York

This file has two parts:

1. **What already exists** (shipped Life Hub)
2. **What to build next** (Focus balance · Why/goals · Captures) — schema only until sliced

Related docs already in repo: `LIFE_HUB.md` (ops + protocol). Prefer this handoff for product + schema.

---

## Part 1 — What already exists

### Product intent

Life Hub is a **static GitHub Pages SPA** that aggregates Randy’s life tools into one overview:

- Source cards (TickTick, mail, finance, resale, candle, move, etc.)
- Explicit **Priority** strip (promote from featured — not auto-filled)
- **Review** panel: completion counts (today / 7d / month / all-time) + share bars by source
- Dark mode + translucent iridescent accents
- Hub **Done** marks complete locally and, where possible, on the origin

Chain Randy already uses: **Goals hub → Routines hub → TickTick → Life Hub**.

| Hub | URL |
|-----|-----|
| Life Hub (this) | https://randymcfarland1227-wq.github.io/frontier/ |
| Goals | https://randymcfarland1227-wq.github.io/Goals-hub/ |
| Routines | https://randymcfarland1227-wq.github.io/routine-hub/ |
| Resale | https://randymcfarland1227-wq.github.io/sell-hub/ |
| Peculiar Candle | https://randymcfarland1227-wq.github.io/peculiar-command-center/ |

### Stack

| Layer | Choice |
|-------|--------|
| UI | React + TypeScript (`app/`, shared with Vite Pages entry) |
| Pages build | `npm run build:pages` → `dist-pages`, base `/frontier/` |
| Deploy | GitHub Actions `.github/workflows/deploy-pages.yml` on push to `main` |
| Connector data | Committed JSON under `public/data/*.json` (no secrets in Pages) |
| TickTick complete API | Cloudflare Worker `frontier-work-room` → `https://frontier-work-room.randymcfarland1227.workers.dev` |
| Node | `>= 22.13` |

**Secret rule:** TickTick Open API token lives only as Worker secret `TICKTICK_ACCESS_TOKEN` (and on the sync machine). Never put tokens in the Pages bundle or committed JSON.

### Layout (live UI)

1. **Header** — title, refresh, dark mode, nav into source rooms  
2. **Self** — full-width band (hub-native inbox)  
3. **Priority** — top strip; only items explicitly pinned from a source’s Featured list (`localStorage` `lifehub-priority-pins`)  
4. **Source rows**
   - Row 1: TickTick · Gmail · Outlook · Repair Log  
   - Row 2: Radall (Finance) · Role Hub · Move OS  
   - Row 3: Income/Venture Lab · Resale Hub · Peculiar Candle  
5. **Review** — completion stats + % / counts by source  
6. Per card: metrics (incl. blue **actionable count**), Featured (Pin / Done), Tasks (expand/collapse), Open origin  

Task boards inside cards should stay **single-column** on narrow widths; Done/Star must not stretch to card height (fix in `e1631c8`).

### Eleven sources

| id | Name | Data path | Bridge |
|----|------|-----------|--------|
| `ticktick` | TickTick | `public/data/ticktick.json` | connector JSON; Done → Worker API |
| `radall` | Radall Finances | `public/data/radall.json` | Sheets → JSON |
| `gmail` | Gmail Starred | `public/data/gmail.json` | Gmail MCP → JSON; Done = local dismiss |
| `outlook` | Outlook Blue category | `public/data/outlook.json` | Outlook MCP → JSON; Done = local dismiss |
| `resale` | Resale Hub | iframe postMessage | sell-hub |
| `role` | Role Hub | open link + optional `role.json` | iframe blocked by Apps Script CSP; legacy id `search` → `role` |
| `candle` | Peculiar Candle | iframe postMessage | peculiar-command-center |
| `income` | Income & Venture Lab | iframe (origin must post) | |
| `move` | Move OS | iframe (origin must post) | |
| `repair` | Site Repair Log | iframe (origin must post) | |
| `self` | Self inbox | `localStorage` `lifehub-self-inbox` | hub-native |

**TickTick rules:** show habits + due today + overdue only. Metrics: `dueToday`, `overdue`, `habits`. Related links on card: Goals + Routines.  
**Outlook rules:** Blue category only (not job-keyword heuristic).  
**Candle metrics:** `openStudioTasks`, `acceptedVessels`, `skusDefined`.  
**Move OS metrics:** `openTasks`, `completedTasks`, `pinnedFocus`.

### Core types (already in `lib/types.ts`)

```ts
type SourceId =
  | 'ticktick' | 'radall' | 'gmail' | 'outlook'
  | 'resale' | 'role' | 'candle' | 'income' | 'move' | 'repair' | 'self';

type FeaturedItem = {
  id: string; title: string; detail: string; meta: string;
  originUrl?: string; completable?: boolean;
};

type TaskItem = {
  id: string; title: string; detail?: string;
  status?: 'open' | 'done' | 'blocked' | string;
  due?: string; starred?: boolean; originUrl?: string;
  kind?: 'habit' | 'task' | 'mail' | string;
  projectId?: string; // TickTick Open API complete
};

type SourceSnapshot = {
  source: SourceId | 'search';
  metrics: Record<string, number>;
  featured: FeaturedItem[];
  tasks: TaskItem[];
  refreshedAt: string; // ISO
};
```

### postMessage protocol

Window name: `randys-life-hub`.  
Allowed parent origins: Pages `https://randymcfarland1227-wq.github.io` and Worker legacy host.

**Origin → hub**

```ts
{ type: 'randys-workroom:snapshot', payload: SourceSnapshot }
```

**Hub → origin**

```ts
{ type: 'randys-workroom:request' }
{ type: 'randys-workroom:complete', payload: { source: SourceId, id: string } }
{ type: 'randys-workroom:star', payload: { source: SourceId, id: string, starred: boolean } }
```

### Completion ledger (foundation for Balance)

- Key: `localStorage` `lifehub-completions`
- Shape: `{ entries: Record<`${source}::${taskId}`, CompletionEntry> }`
- `CompletionEntry`: `{ source, taskId, completedAt, title?, via: 'hub' | 'origin-snapshot' | 'connector-diff' | 'self' }`
- Deduped by source+taskId (keeps earliest)
- Recorded on hub Done, Self complete, inbound complete messages, and snapshot diffs
- Review UI: `lib/completions.ts` → `computeStats` + `sourceShares`

### Done behavior by source

| Source | Hub Done |
|--------|----------|
| gmail / outlook / radall / role | dismiss locally + ledger |
| ticktick **tasks** | optimistic dismiss + `POST` Worker `/api/ticktick/complete` `{ taskId, projectId }` |
| ticktick **habits** (`habit-*` / `kind: habit`) | local dismiss only (API has no habit complete) |
| iframe origins | optimistic + `broadcastComplete` |
| self | local complete |

Worker CORS allows github.io + localhost. Client: `lib/ticktickComplete.ts`.

### localStorage keys

| Key | Purpose |
|-----|---------|
| `lifehub-completions` | Completion ledger |
| `lifehub-priority-pins` | Explicit Priority pins |
| `lifehub-self-inbox` | Self items |
| `lifehub-source-snapshots` | Cached snapshots |
| `lifehub-theme` | Dark/light |
| `lifehub-focus` | Legacy starter FocusItem list (not the new FocusArea schema) |

### Important code map

| Path | Role |
|------|------|
| `app/life-hub.tsx` | Orchestration, complete/star, ledger |
| `app/components/*` | Header, HomeView, SourceCard, TaskList, FeaturedList, PriorityBoard, ReviewPanel, SelfInbox, … |
| `lib/sources.ts` | 11 source definitions + URLs |
| `lib/types.ts` | Domain + protocol types |
| `lib/completions.ts` | Ledger + Review stats |
| `lib/connectors.ts` | Fetch/merge `public/data/*.json` |
| `lib/ticktickComplete.ts` | Worker complete client |
| `lib/priorityPins.ts` | Priority promote/unpin |
| `lib/actionable.ts` | Blue actionable-count metric |
| `worker/index.ts` | TickTick complete proxy |
| `public/data/*` | Connector snapshots + `manifest.json` |
| `scripts/write-connector-snapshots.mjs` | Validate/write helper |

### Connector refresh (agent / routine)

Pages is static. Sync flow:

1. Pull Gmail / Sheets / Outlook / TickTick via MCP or API on a machine with access  
2. Map to `SourceSnapshot`  
3. Write `public/data/{gmail,radall,outlook,ticktick,role}.json` (+ `manifest.json`)  
4. Commit + push `main` → Actions rebuilds Pages  

Weekday routine intent: “Life Hub connector sync” ~8:36 AM ET — refresh snapshots, ping only on failure.

### Known gaps (do not confuse with Part 2)

- Role Hub: no live iframe; needs JSON export  
- Some iframe origins still thin on `tasks[]` / complete listeners  
- Star on connectors often opens origin (no two-way star API yet)  
- Completions are **per browser** (localStorage) — not cross-device yet  
- Legacy `FocusItem` in drawer ≠ new FocusArea balance model below  

---

## Part 2 — Build next (schema)

**Product ask:** use completed-task data to score attention across life focus areas; surface **Why** (goals) with attached work; hold **non-tasks** (research / learn / ideas) without polluting the task board.

**Build order (recommended):**

1. FocusArea map + tag completions (`focusAreaId`)  
2. Balance strip on Review  
3. Captures inbox  
4. Why panel wired to Goals hub  

### A. Focus areas (life balance)

#### `FocusArea`

```ts
type FocusAreaId = string; // kebab-case, e.g. 'self' | 'money' | 'body' | 'work' | 'venture' | 'home'

type FocusArea = {
  id: FocusAreaId;
  name: string;
  weight: number;      // 0–1; all weights should sum to 1
  benchmark?: number;  // target share of completions; default = weight
  /** How to attribute a completion or open item to this area */
  sourceMap: FocusSourceRule[];
  color?: string;      // optional UI accent
};

type FocusSourceRule = {
  source: SourceId;
  /** Optional TickTick projectId, tag, or title/prefix match */
  match?: {
    projectIds?: string[];
    tags?: string[];
    titleIncludes?: string[];
    kinds?: Array<'habit' | 'task' | 'mail'>;
  };
  /** If match omitted, all items from this source count toward the area */
};
```

**Suggested starter set (editable JSON):** Self, Money, Body, Work/Role, Venture, Home — weights set by Randy.

**Data home:** `public/data/focus-areas.json` (static, versioned with the site).

#### Extend `CompletionEntry`

```ts
type CompletionEntry = {
  source: SourceId;
  taskId: string;
  completedAt: string;
  title?: string;
  via: 'hub' | 'origin-snapshot' | 'connector-diff' | 'self';
  focusAreaId?: FocusAreaId; // resolve at record time via sourceMap; allow manual override later
};
```

Resolution: on `recordCompletion`, run `sourceMap` rules (TickTick `projectId` / tags first, then source default). Persist `focusAreaId` so history stays stable if maps change.

#### Derived `BalanceScore` (do not persist unless caching)

Windows: `today` | `last7` | `month` (reuse ledger windows).

```ts
type AreaBalance = {
  focusAreaId: FocusAreaId;
  count: number;
  actualShare: number;  // count / totalCompletionsInWindow
  benchmark: number;
  delta: number;        // actualShare - benchmark
  score: number;        // e.g. 100 - Math.min(100, Math.abs(delta) * 100)
};

type BalanceReport = {
  window: 'today' | 'last7' | 'month';
  total: number;
  areas: AreaBalance[];
};
```

**UI:** Balance strip on Review — one bar per FocusArea; near benchmark = healthy; starved or overloaded = warn. Does **not** replace source share bars; it answers “am I feeding the right life areas?”

**Attribution tip:** TickTick projects/lists are the cheapest mapper (e.g. project Finance → Money, habit Walk → Body). Gmail/Outlook may map whole source to Work or Money until tags exist.

---

### B. Why / goals (importance → attached work)

Goals **live in Goals hub**. Life Hub mirrors and links; do not fork a second goals database long-term.

#### `Goal`

```ts
type Goal = {
  id: string;
  title: string;
  why: string;                 // one sentence — the “why”
  status: 'active' | 'paused' | 'done';
  focusAreaId?: FocusAreaId;
  horizon?: 'now' | 'quarter' | 'year';
  updatedAt?: string;
};
```

#### `GoalLink`

```ts
type GoalLink = {
  id: string;
  goalId: string;
  target:
    | { type: 'task'; source: SourceId; taskId: string }
    | { type: 'ticktick'; taskId: string; projectId?: string }
    | { type: 'capture'; captureId: string }
    | { type: 'featured'; source: SourceId; featuredId: string };
  role: 'drives' | 'supports' | 'blocks';
};
```

**UI — Why panel:** each active goal shows `why`, focus chip, linked open tasks/captures, and optional **momentum** = completions in window whose task is linked to that goal.

**Data homes (iterate cheap → solid):**

1. First: `public/data/goals.json` + `public/data/goal-links.json` (or one file) exported/synced from Goals hub  
2. Later: Goals hub posts snapshot over postMessage or static export in its deploy  

**Existing product chain to respect:** Goals builds routines → routines feed TickTick → TickTick appears on Life Hub. Why panel should prefer linking to TickTick/hub tasks that already exist rather than inventing parallel task lists.

---

### C. Captures (non-tasks)

Things that are **not** tasks yet: research, look into, learn, ideas.

#### `Capture`

```ts
type CaptureKind = 'research' | 'learn' | 'lookinto' | 'idea';

type CaptureStatus = 'inbox' | 'parked' | 'promoted' | 'dropped';

type Capture = {
  id: string;
  kind: CaptureKind;
  title: string;
  notes?: string;
  url?: string;
  focusAreaId?: FocusAreaId;
  goalId?: string;
  status: CaptureStatus;
  createdAt: string;
  reviewedAt?: string;
  /** Set when promoted into a real task */
  promotedTo?: { source: SourceId; taskId: string };
};
```

**Rules**

- Captures **never** appear on the task board or in Balance until **promoted** and then **completed** as a task.  
- **Promote** → create TickTick task (or Self item) + optional `GoalLink`; keep capture as paper trail (`status: 'promoted'`).  
- **Park** = keep without nagging. **Drop** = soft delete / archive.

**UI:** “Ideas & research” inbox (separate from Self tasks and Priority).

**Data home:** start `localStorage` key `lifehub-captures`; promote may call TickTick later via Worker. Optional later sync to JSON if cross-device needed.

---

### D. How the three pieces sit on the hub

| Section | Reads | Writes |
|---------|-------|--------|
| Balance | CompletionEntry + FocusArea | none (derived) |
| Why | Goal + GoalLink + open tasks/captures | link / unlink |
| Captures | Capture list | add, park, promote, drop |

```text
                    ┌─────────────┐
   Goals hub ──────►│ Goal + why  │──► Why panel
                    └──────┬──────┘
                           │ GoalLink
              ┌────────────┼────────────┐
              ▼            ▼            ▼
         TickTick      Hub tasks     Captures
         / sources                   (inbox)
              │            │            │
              └──── Done ──┴────────────┘
                           ▼
                  CompletionEntry
                  (+ focusAreaId)
                           ▼
                     Balance strip
```

### E. Example `focus-areas.json` (illustrative)

```json
{
  "version": 1,
  "areas": [
    {
      "id": "self",
      "name": "Self",
      "weight": 0.15,
      "sourceMap": [{ "source": "self" }]
    },
    {
      "id": "money",
      "name": "Money",
      "weight": 0.2,
      "sourceMap": [
        { "source": "radall" },
        { "source": "resale" },
        { "source": "ticktick", "match": { "titleIncludes": ["bill", "budget", "pay"] } }
      ]
    },
    {
      "id": "body",
      "name": "Body",
      "weight": 0.15,
      "sourceMap": [
        { "source": "move" },
        { "source": "ticktick", "match": { "kinds": ["habit"] } }
      ]
    },
    {
      "id": "work",
      "name": "Work",
      "weight": 0.25,
      "sourceMap": [
        { "source": "role" },
        { "source": "gmail" },
        { "source": "outlook" }
      ]
    },
    {
      "id": "venture",
      "name": "Venture",
      "weight": 0.15,
      "sourceMap": [
        { "source": "candle" },
        { "source": "income" }
      ]
    },
    {
      "id": "home",
      "name": "Home",
      "weight": 0.1,
      "sourceMap": [
        { "source": "repair" },
        { "source": "ticktick", "match": { "titleIncludes": ["home", "house", "fix"] } }
      ]
    }
  ]
}
```

Weights and maps are product decisions — confirm with Randy before locking.

### F. Acceptance criteria (when implementing)

**Focus / Balance**

- [ ] `focus-areas.json` loads; weights documented  
- [ ] New completions get `focusAreaId` when a rule matches  
- [ ] Review shows Balance for at least `last7`  
- [ ] Unmapped completions counted in an “Other” bucket (not silently dropped)

**Why**

- [ ] Active goals with `why` visible  
- [ ] At least TickTick + Self tasks can be linked  
- [ ] Completing a linked task reflects in that goal’s momentum

**Captures**

- [ ] Add / park / drop / promote without placing items on task boards  
- [ ] Promote creates a real task and sets `promotedTo`  
- [ ] Captures do not inflate Balance until completed as tasks

**Non-goals for v1**

- Cross-device ledger sync  
- Replacing Goals hub  
- Auto-Priority from Balance  
- Habit complete via TickTick API (still unsupported)

---

## Part 3 — Ops notes for the builder

```bash
# Pages (primary site)
npm run build:pages
npm run preview:pages

# Worker (TickTick complete only — only when changing worker/)
npx wrangler deploy   # after wrangler login; secret already named TICKTICK_ACCESS_TOKEN
```

Pushing to `main` triggers Pages. Prefer small PRs. Do not commit secrets.

If touching layout CSS: task rows use `align-items: flex-start`; boards single-column inside source cards; featured actions wrap; avoid tall stretched Done/Star bars.

---

## Changelog pointer

Recent relevant commits on `main` (as of 2026-09-23):

- `e1631c8` — Fix cramped task cards / stretched Done·Star  
- `ca21b4b` — TickTick complete via Worker Open API  
- `ef0b9bf` — Done everywhere + blue actionable metrics  

See `LIFE_HUB.md` for protocol and connector sync detail.  
This handoff is the **product + schema** source for Focus · Why · Captures.
