# Randy's Life Hub (frontier upgrade)

Phase 1 scaffold on branch `life-hub-upgrade`.

## Live URL

**Primary:** [https://randymcfarland1227-wq.github.io/frontier/](https://randymcfarland1227-wq.github.io/frontier/)

GitHub Pages deploys automatically on push/merge to `main` via `.github/workflows/deploy-pages.yml` (`npm run build:pages` → `dist-pages`). A copy also lives at `docs/deploy-pages.yml`. The workflow uses `actions/configure-pages` with `enablement: true`, so the first successful run on `main` should turn on Pages for the repo (GitHub Actions source). Until then the live URL 404s.


**Cloudflare Worker (optional / legacy):** worker name `frontier-work-room` still maps to `https://frontier-work-room.randymcfarland1227.workers.dev` if you run `npm run deploy` later. The hub UI does **not** require Cloudflare — connector cards read static `public/data/*.json` committed by an agent sync (no secrets on Pages).

### Local Pages build

```bash
npm run build:pages    # Vite SPA → dist-pages with base /frontier/
npm run preview:pages  # preview the Pages build
```

Node **>= 22.13** (`engines` in package.json). Use `fnm use 22` if needed.

## Sources (11)

| # | id | Name | Bridge / adapter |
|---|----|------|------------------|
| 01 | `ticktick` | TickTick | Static JSON stub (`public/data/ticktick.json`) until token |
| 02 | `radall` | Radall Finances (Sheet) | Static JSON from Sheets MCP → `public/data/radall.json` |
| 03 | `gmail` | Gmail Starred | Static JSON from Gmail MCP → `public/data/gmail.json` |
| 04 | `outlook` | Outlook job inquiries | Static JSON from Outlook MCP → `public/data/outlook.json` |
| 05 | `resale` | Resale Hub | Hidden iframe + postMessage (existing sell-hub) |
| 06 | `role` | Role Hub | Hidden iframe + postMessage (Apps Script; legacy id `search` still accepted) |
| 07 | `candle` | Peculiar Candle Pre Launch | iframe + postMessage (`peculiar-command-center`) |
| 08 | `income` | Income & Venture Lab | iframe ready; origin must post snapshots |
| 09 | `move` | Move OS | iframe ready; origin must post snapshots |
| 10 | `repair` | Site Repair Log | iframe ready; origin must post snapshots |
| 11 | `self` | Self inbox | Hub-native `localStorage` (add / star / complete) |

## postMessage protocol

Window name: `randys-life-hub` (was `randys-work-room`).

Parent origins that should allow (hub may load on either):

- `https://randymcfarland1227-wq.github.io` (GitHub Pages primary)
- `https://frontier-work-room.randymcfarland1227.workers.dev` (legacy Worker)

### Inbound — origin → hub

```ts
{
  type: 'randys-workroom:snapshot',
  payload: {
    source: SourceId | 'search', // 'search' normalizes to 'role'
    metrics: Record<string, number>,
    featured: FeaturedItem[],
    tasks: TaskItem[],
    refreshedAt: string // ISO
  }
}
```

`FeaturedItem`: `{ id, title, detail, meta, originUrl?, completable? }`  
`TaskItem`: `{ id, title, detail?, status?, due?, starred?, originUrl? }`

Also supported: `#sync=<base64(json SourceSnapshot)>` hash bootstrap (legacy).

### Outbound — hub → origin

```ts
{ type: 'randys-workroom:request' }

{ type: 'randys-workroom:complete', payload: { source: SourceId, id: string } }

{ type: 'randys-workroom:star', payload: { source: SourceId, id: string, starred: boolean } }
```

Origins that already speak snapshots (Role Hub / Resale) should add listeners for `complete` (and optionally `star`) so hub Done buttons mark complete on the origin.

## UI per card

- Key metrics (adapter / snapshot)
- Starred / featured strip
- Task count + collapsed **Expand full list**
- One-click **Open** to origin URL (disabled for placeholder / Self)
- Detail room with complete / star handlers

## Self inbox

- Key: `lifehub-self-inbox`
- Add, complete, star in-browser
- Starred open items become `featured` on the Self card
- Later: categorize-to-origin

## Connector snapshots (Gmail / Radall / Outlook / TickTick)

Pages is static — there are **no Cloudflare secrets** on the site.

### How refresh works

1. An agent (or future routine) calls MCP connectors on a machine that has access:
   - **Gmail** `search_threads` — `is:starred -in:draft`, pageSize 30
   - **Radall** Google Sheets `read_range` on spreadsheet `19rw8MAYTZ70Qy2GFAi0DaCGdsp7hQc67l8nkvw17jQk`, tab **Task List**
   - **Outlook** `list_mail_messages` — job-inquiry search or inbox fallback
   - **TickTick** Open API only if `TICKTICK_ACCESS_TOKEN` (or similar) exists; otherwise empty stub
2. Map to `SourceSnapshot` (see `lib/types.ts`)
3. Run `node scripts/write-connector-snapshots.mjs --dir /tmp/lifehub-sync --map-raw` (or write `public/data/*.json` directly)
4. Commit + push to `main` → GitHub Actions rebuilds Pages

Hub SPA (`lib/connectors.ts`) fetches `BASE_URL + 'data/<id>.json'` after localStorage hydrate (and on **Refresh**). It merges **only** `gmail` / `radall` / `outlook` / `ticktick` and never wipes iframe-bridged sources.

### Complete / star on connector cards

**Done on the hub** always `recordCompletion`s in the ledger, then:
- **gmail / outlook / radall / role**: remove the item from local `tasks` + `featured` (dismiss). Do not require opening mail.
- **ticktick tasks**: optimistic local dismiss + background `POST` to Worker `https://frontier-work-room.randymcfarland1227.workers.dev/api/ticktick/complete` (Bearer `TICKTICK_ACCESS_TOKEN` stays on the Worker — never in the Pages bundle). Retries once; on failure keeps dismissed and logs a soft console warning. Requires `projectId` on the task (from snapshot or `#p/{projectId}/tasks/...` in `originUrl`).
- **ticktick habits** (`kind: habit` / id `habit-*`): local dismiss only — TickTick Open API does not support habit complete.
- **iframe origins** (resale, candle, income, move, repair): optimistic mark done / remove from open list + `broadcastComplete` (`randys-workroom:complete`).
- **self**: local complete as before.

Star on connector items still opens the origin URL until two-way API star exists.

### Worker: TickTick complete

- Route: `OPTIONS` + `POST /api/ticktick/complete` on `frontier-work-room`
- Body: `{ "taskId": "...", "projectId": "..." }` → TickTick `POST /open/v1/project/{projectId}/task/{taskId}/complete`
- Secret: `npx wrangler secret put TICKTICK_ACCESS_TOKEN` then `npx wrangler deploy` (from repo root after `wrangler login`)
- Client helper: `lib/ticktickComplete.ts`

### Layout extras

- `public/data/*.json` + `manifest.json` — committed snapshots
- `lib/connectors.ts` — fetch + merge helpers
- `scripts/write-connector-snapshots.mjs` — validate/write helper (see `scripts/README.md`)

## Still needed (later passes)

1. **Origin bridges** — sell-hub, Role Hub script, peculiar-command-center (candle), income-venture-lab, move-os, site-repair-log should:
   - include `tasks[]` in snapshots
   - listen for `randys-workroom:complete` / `:star`
   - allow both Pages and Worker parent origins (see above)
2. **TickTick token** — already on sync box for snapshots; also set Worker secret `TICKTICK_ACCESS_TOKEN` via wrangler (do not commit the token)
3. **Two-way connector actions** — TickTick task complete via Worker is live; star + other connectors still open-origin until APIs exist
4. **Worker deploy** — `npx wrangler deploy` after secret put (Pages is primary; workers.dev hosts the complete API)

## Layout

- `lib/types.ts` — protocol + domain types
- `lib/sources.ts` — 11 source definitions
- `lib/adapters/*` — stubs + Self implementation
- `app/components/*` — Header, cards, lists, Self inbox, bridges
- `app/life-hub.tsx` — orchestration, postMessage, complete/star fan-out (shared by Next + Vite Pages)
- `app/page.tsx` — thin Next entry
- `index.html` + `src/main.tsx` + `vite.github.config.ts` — GitHub Pages SPA entry (`base: /frontier/`)


## 2026-09-23 hub upgrade notes

### Connectors
- **TickTick**: today view only — due today + overdue tasks, plus all habits (habit badge in UI). Metrics: `dueToday`, `overdue`, `habits`.
- **Outlook**: Blue category only (Graph `categories` matching Blue / Blue category). No job-inquiry keyword heuristic. Metrics: `blue`, `unread`, `flagged`.
- **Role Hub**: Apps Script sets `X-Frame-Options` / CSP `frame-ancestors`, so iframe + postMessage bridge cannot work from Life Hub. Card is open-link + optional `public/data/role.json` connector snapshot (honest empty until an export exists). Legacy postMessage id `search` still maps to `role`.

### Origin metric labels
- **Peculiar Candle**: `openStudioTasks`, `acceptedVessels`, `skusDefined` (pre-launch).
- **Move OS**: `openTasks`, `completedTasks`, `pinnedFocus` (replacing unclear sessions/streak/planned).

### UI
- Self full-width band; rows: TickTick/Gmail/Outlook/Repair · Radall/Role/Move · Income/Resale/Candle.
- Priority board starts empty; promote featured items via **Priority** to pin (`localStorage` `lifehub-priority-pins`). Remove unpins without un-featuring. Review panel unchanged (completion stats + share bars).
- Dark mode toggle (persisted). Glass / iridescent accents.
- Task boards with habit chips, full-width show-more under a clamped 2-column (or single-col narrow) grid.

### Completion ledger
- `localStorage` key `lifehub-completions`: map of `source::taskId` → `{ completedAt, via, title }`.
- Counts hub Done, Self complete, inbound `randys-workroom:complete`, and snapshot diffs (task gone or status→done) for iframe + connector refreshes.
- Deduped by source+taskId (keeps earliest). TickTick Open API does not expose “completed today” without extra calls — connector diffs only see tasks dropping out of the today/overdue/habits snapshot.

### Focus areas + Balance (slice 1–2 of BUILDER_HANDOFF Part 2)

- Config: `public/data/focus-areas.json` — areas, weights (sum to 1), `sourceMap` rules. Edit + push to change; no code change needed.
- Rule resolution (`lib/focusAreas.ts`): most specific match wins — `projectIds`/`tags` (3) + `titleIncludes` (2) + `kinds` (1), summed; bare source = 0; ties → area listed first. No match → **Other** (counted, shown). `excludeSources` (currently `repair`) never count toward Balance.
- `CompletionEntry.focusAreaId` is set at record time and persisted. Entries recorded before this (or before the config loaded) are backfilled using the current snapshot's task (projectId/kind), then title.
- Review → **Balance**: per-area share vs target tick, Today / 7 days / Month; on target = within ±5 pts. Overall = 100 − total-variation distance.

### Captures — Ideas & research (slice 3)

- Home, under Self: add Idea / Research / Look into / Learn with optional link, notes, focus area. Stored in `localStorage` `lifehub-captures` (`lib/captures.ts`).
- Inbox / Parked / Promoted / Dropped. Captures never appear on task boards or in Balance.
- **Promote** creates a Self task (notes + link as detail), carrying `focusAreaId` + `fromCaptureId`; the capture keeps `promotedTo` as a paper trail and shows whether the task is done. Completing that task records the capture's area (override), so it counts in Balance only then.
- Later: promote straight to TickTick (needs a Worker create endpoint), `goalId` once the Why panel lands.

### Why panel — goals + attached work (slice 4)

- Home, between Review and Self. Goals = Goals hub **efforts** (title, reason = "why", how), read live from the Goals hub Apps Script (`?action=efforts`, `?action=reviews` — CORS `*`). If that fails, falls back to `public/data/goals.json` (snapshot of the same efforts; refresh it when goals change). Life Hub never writes goals.
- `goals.json` also maps Goals categories → focus areas (`categories[].focusAreaId`) with per-goal `areaOverrides` (Marvel training → Marvel, Clean Spaces → Home).
- Each card: category, area, latest bi-weekly review (On Track / Slipping / Stalled), why, "N done this week · M linked". Goals with no work are dashed.
- Links: `public/data/goal-links.json` (44 starter links matched by TickTick title) + per-browser adds/unlinks in `localStorage` `lifehub-goal-links`. Link any open TickTick task/habit, source task, Self item, or idea; a promoted idea counts through its Self task.
- Ledger fix: TickTick habits are keyed per local day (`ticktick::habit-…::YYYY-MM-DD`) so a daily habit counts every day, not once all-time.

### Cloud backup + retiring the Worker copy (2026-09-23)

- **Backup:** Worker `GET/PUT /api/state` on KV namespace `LIFEHUB_STATE` (id `e26625e45a6a4f408ca3f45c91ff7aca`). Stores completions, ideas, Self items, goal links (`lib/syncState.ts` — same merge on Worker and browser; merges only combine, never drop). Review → "Turn on backup" generates a device key in the browser; the Worker keeps only its SHA-256 (first device claims). "Link another device" copies `…/frontier/#sync-key=<key>` (fragment, never sent to a server). Syncs 2 s after edits, on tab focus, and every 5 min.
- **Retired copy:** any page load on `frontier-work-room.randymcfarland1227.workers.dev` now serves a handoff page that reads that origin's `lifehub-completions` + `lifehub-self-inbox` and redirects to Pages with `#import=<base64>`; Pages merges it in and shows "Brought over N completions". `/api/*` and Home Screen icon files keep working.
- Deploy order matters: ship Pages (import support) before `npm run deploy` of the Worker.

### Done-only counting, Routine Hub categories, Role Hub live, UI (2026-09-23)

- **Only real "done" counts:** `diffSnapshotCompletions` records a task only when a source reports it `status: 'done'` (optionally with `completedAt`). A task that just disappears (rescheduled, filtered, regenerated — e.g. Resale's auto-actions) no longer counts. Hub Done still counts.
- **Routine Hub categories:** `focus-areas.json` → `routines` loads Routine Hub `?action=routines` live (fallback `data/routines.json`); TickTick titles matching a routine take its category → area (`categoryAreas`, per-routine `routineAreas` for mixed Organizing items). Score 4. `rulesVersion: 2` re-sorts older history; hand-set areas (`focusManual`) never change.
- **Role Hub:** Role Hub posts a snapshot to Life Hub (window opener) on load: `appliedToday`, `appliedWeek`, `pipeline`, `ready`; last-7-days applications as `done` tasks (each counts once as a Work completion on its applied date) + ready-to-submit roles as open tasks. Life Hub accepts `role` postMessages (newer `refreshedAt` wins over `role.json`). Open Role Hub from the Life Hub card to refresh it.
- **UI:** Review → By source rows expand to list what was completed; every source card collapses to its header (saved per browser); Self card quick-add with Task / Thought / Idea / Research / Look into / Learn (non-tasks go to Thoughts, ideas & research).

### Buckets v3, cleanup, Resale done, Self merge, new home order (2026-09-23)

- **Area names** (ids unchanged): self = Mind & Grounding, money = Money / Finance, body = Body & Physical Care, work = Role & Professional Development, venture = Ventures & Opportunities, marvel = Marvel, home = Organizing, Cleaning, Upkeep & Planning. `rulesVersion: 3`: Routine Hub planning routines and the Life Planning list → home.
- **Gmail / Outlook:** Done opens an area picker (`AreaPicker`); the choice is stored as a hand-set area (`focusManual`).
- **Cleanup:** `isRealCompletion` (lib/syncState.ts) drops legacy `via: 'origin-snapshot'` entries (tasks that only disappeared) except Role Hub — applied in `loadLedger`, the backup merge, and the Worker. Source-reported completions now use `via: 'origin-done'`.
- **Resale:** sell-hub sends its last 7 days of Listing Posted / Price Drop / Offer Sent / Completed / Shipped / Listing Ended actions as done tasks (from the Item Actions sheet) and pings Life Hub the moment one happens.
- **Self merged** into "Thoughts, ideas, research & tasks" (Task is a kind; Tasks tab; star = pin to Priority). No standalone Self card on home.
- **Home order:** one-line title + small status → Why → Review (stats | Balance side by side) → Self panel → Priority → source rows.

### TickTick completions feed (2026-09-23)

- Worker `GET /api/ticktick/done?from&to&start&end` → TickTick Open API `POST /task/completed` + `GET /habit` + `GET /habit/checkins`; `POST /api/ticktick/habit-checkin` → `POST /habit/{id}/checkin` (value = habit goal). Both require the backup key (`X-Sync-Key`) once the backup is claimed.
- `lib/ticktickDone.ts` pulls it on load / tab focus / every 10 min. TickTick ledger keys are per day (`ticktick::<id>::YYYY-MM-DD`) with a same-day guard against older undated keys.
- Targets: 15% each except Marvel 10%.

### Done stays done after refresh (2026-09-23)

- Connector snapshots (`gmail`/`outlook`/`radall`/`role`/`ticktick` JSON) are written once each morning, so reloading used to bring back items already marked Done on the hub. `hideLedgerDone` (`app/life-hub.tsx`) now hides any open connector item the ledger has as done — after every connector load and after a cloud-backup sync (so Done on one device hides it on the others). TickTick only hides items done *today*, since recurring tasks and habits reuse ids.

### Collapsible home sections + tighter spacing (2026-09-23)

- Why, Review, Self, Priority and each source row fold to a one-line bar (`app/components/Collapsible.tsx`), remembered per browser in `lifehub-collapsed-cards` as `section:<id>` next to the per-card entries. Collapsed bars show a blue count where one fits: Review = completed today, source rows = sum of their cards' blue to-do numbers. A collapsed source card shows its own blue number beside its name.
- Spacing: 10px between home sections and between cards. Source rows no longer get the older standalone `.space-grid` side padding and 54px bottom gap.

### Euphoria look + tighter card headers (2026-09-23)

- End of `app/globals.css` ("Euphoria pass"): neon violet / magenta / electric-blue / cyan palette. A fixed glow layer (`.frontier-shell::before`, `--aurora`) sits behind frosted see-through cards and panels (`--glass-card`, blur + saturate), with shimmering iridescent edges on every panel, a soft glow around each card's source-color bar, a holographic "Life Hub." title, and blue → violet → magenta to-do numbers and count badges. Works in light and dark mode.
- Card number row → title gap cut from 22px to 6px (2px when collapsed).

### Balance v2 — progress + focus (2026-09-24)

Replaces the share-vs-target Balance. `lib/energy.ts`, `app/components/BalanceStrip.tsx`.
- **Available per bucket per day** = open items on every source (not Gmail/Outlook, not excluded sources) + done that day + TickTick habits **due** that day (schedule from the Worker's `/api/ticktick/done` `schedule`, parsed by `habitDueOn`). Recorded per day in `lifehub-daily-availability` (cloud-synced, max per day).
- **Goal** = available × pace. Paces are set in the ⚙ panel (`lifehub-balance-settings`, cloud-synced, newest wins). Defaults: routine buckets 60%; Ventures 14%, Role 15%, Money 20%.
- **Progress** (done ÷ goal): Charge < 0.75 ≤ In-Line ≤ 1.3 < On-Fire.
- **Focus**: bucket's share of the day's completions vs a fair share = ½·(1/active buckets) + ½·(goal ÷ all goals). Overfocused > 1.4× fair, Underfocused < 0.5× fair (both need an 8-pt gap).
- Week / Month average each day's ratios and shares. Area `weight`s in focus-areas.json are no longer used by Balance.

### Role Hub push (2026-09-24)

- Role Hub (`next_move_app` Apps Script, signed-in only) now POSTs its snapshot to the Worker `POST /api/role/snapshot` (header `X-Role-Key` = Worker secret `ROLE_PUSH_KEY`, also stored in Role Hub's Script Properties by `setupLifeHubPush`) from `getDashboardData()`, throttled to once a minute. Life Hub reads `GET /api/role/snapshot` (backup key) on load / focus / every 10 min (`lib/roleFeed.ts`); newer `refreshedAt` wins.
- Snapshot: `appliedToday`, `applied` (all roles applied), `pipeline`, `ready`; last 14 days of applications as done tasks (count once each, on the applied date) + up to 25 ready-to-apply roles.

### Balance v2.1 — capacity, counts, suggestions (2026-09-24)

- **Focus is count-based and capacity-capped:** a bucket's fair count = its fair slice × the period's completions, but never more than its own goal (min 1 when it has work). Underfocused = done < ½ fair count and ≥ 1 task short; Overfocused = done > 1.4× fair count and ≥ 2 over. Small buckets (e.g. Money with 2–3 tasks) need just one task to be Balanced.
- **Progress over a period** = total done ÷ total goal (strong and light days balance out). A bucket with nothing on its plate and nothing done is idle ("Nothing on its plate right now"), never Charge.
- Each row shows counts ("3 done · 2 more to In-Line · 1 more to Balanced") and, when Charge or Underfocused, up to 3 open items that would charge it (`bucketSuggestions`: TickTick habits due today first, then TickTick tasks, Self, other sites).

### TickTick: count late-logged work on its due day (2026-09-25)

- The Worker's done feed now includes each completed task's `dueAt` / `allDay`.
- `attributeTickTickTasks` (lib/ticktickDone.ts): a task ticked after its due day counts on its due day (all-day → midday); ticked on/before its due day → when ticked. Several ticks of the same task within 2 minutes = clicking through overdue recurring copies (postponing), so every copy lands on the latest copy's day and counts once.
- Already-recorded entries (hub Done, older rules) are moved earlier with `moveCompletionEarlier` — only ever earlier, so the backup merge (keeps earliest) converges. Habits already counted on their check-in day.

### Role Hub tasks, Resale stars, pearl dark mode (2026-09-25)

- Role Hub's own task list (`_Hub Tasks`) is in its snapshot (`hubtask:<ID>`, open + last 50 done). Done on Life Hub → `POST /api/role/complete` (backup key) queues it in KV; Role Hub's next push gets `{ complete: [...] }` back and sets Done in its sheet (`applyLifeHubCompletions_`).
- Completion rule: a done task that was never seen open and has no date isn't counted (avoids counting old finished tasks as done today).
- Resale: Life Hub now keeps the featured list Resale sends (it used to ignore it for the embedded copy); sell-hub reloads its stars when another tab changes them.
- Dark mode: source pages, form fields and the Today drawer use translucent "pearl" glass (`--pearl-glass`, `--pearl-sheen`, `--pearl-edge`) instead of white.

### Role Hub certs + portfolio ideas (2026-09-25)

- Role Hub (v39) sends certs (`cert:<ID>`, open until Completed) and portfolio ideas (`portfolio:<ID>`, open while Idea/Exploring/In progress; Parked left out; done at Added to portfolio). Both count toward Role & Professional Development.
- Featuring: Role Hub's cert cards and portfolio rows have a ☆ that uses the same `_Hub Featured` tab as roles (`Cert|<ID>`, `Portfolio|<ID>`); featured ones appear on the Role card. Starring on Life Hub queues `{ id, action: 'star'|'unstar' }` via `POST /api/role/complete`; Done on certs/ideas queues a completion (cert → Completed, idea → ADDED). Role Hub applies the queue on its next push.
- Role Hub's star no longer pops open a Life Hub tab; it pushes the change directly.

### TickTick card = live Today view; reminders ignored (2026-09-25)

- Worker `GET /api/ticktick/open` (backup key): every open, dated task across all lists + inbox. `lib/ticktickLive.ts` keeps tasks due today or overdue, plus habits due today (schedule) not yet checked in, and replaces the morning-file TickTick snapshot (newer wins in `mergeConnectorSnapshots`). Metrics: dueToday, overdue, habits.
- `focus-areas.json` → `ignore.ticktick`: titles containing "reminder", plus "Nutrition Flow — Use Macro Tracker", "Gym Session Standards", "Life Path & Active Project Direction". Ignored items are dropped from the card, workload and suggestions, never recorded as completions, and hidden from counts (`visibleLedger`; kept in storage).
