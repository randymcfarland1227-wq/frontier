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
| 02 | `radall` | Radall Finances (Sheet) | Live: "Life Hub Mail Sync" Apps Script reads the **Task List** tab every 10 min → Worker `/api/radall/snapshot` (X-Mail-Key) → `lib/radallFeed.ts` (fallback `public/data/radall.json`) |
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
   - include `tasks[]` in snapshots — and keep recently finished ones as `status: "done"` with `completedAt` (ISO). Life Hub only counts a completion (and its Balance bucket) when a source reports it done; a task that just disappears is never counted. Candle does this (last 31 days).
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

### Gmail starred, live (2026-09-25)

- Apps Script **Life Hub Mail Sync** (standalone, script id `1xOI9TUs_NFK7qgutWpww3obmMhX5N6F3Y3HLMAAKszoqm0kdGsQBPlnq`, in Randy's account): `syncStarredMail` runs every 10 min (trigger made by `setupLifeHubMail`, which Randy runs once), POSTs starred threads to Worker `/api/gmail/snapshot` (`X-Mail-Key` = Worker secret `MAIL_PUSH_KEY`), and unstars ids returned in the reply.
- Life Hub pulls `GET /api/gmail/snapshot` (backup key) with the Role pull; newer than the morning file wins. Done on a Gmail item (after the area picker) → `POST /api/gmail/unstar` → unstarred in Gmail on the next run.

### Cards tidy-up + red/yellow/green featured (2026-09-25)

- Card header: sync time sits beside the name ("● live · 9:12 PM" when under 20 min old, else "synced …"); duplicate "Updated…" stamps and the repeated count line under Tasks are gone; TickTick has no description note.
- TickTick (wide card) lists Tasks and Habits side by side (`TaskList split`).
- Featured rows and Pinned priorities have a color dot: tap cycles red → yellow → green → none; lists sort red, yellow, green, then the rest (`lib/featuredLevels.ts`, `lifehub-featured-levels`, cloud-synced via `levels` in syncState — newest change wins).
- **Critical** (`!` next to the dot, `CriticalFlag`): must-do flag stored in the same levels map as `source::id::critical` (cloud-synced, no Worker change). Sorts above every color, always shows in Pinned priorities (pinned or not); Done or ✕ there clears it.
- Each card's starred list folds to its heading (tap the heading; shows the count while folded). Remembered per card on this device (`lifehub-collapsed-featured`, not synced). TickTick's Tasks | Habits split is always open — no Expand.
- TickTick has no star of its own, so its ☆ is kept by Life Hub (`lib/hubStars.ts`, `lifehub-hub-stars`, cloud-synced via `stars` in syncState — newest change wins). Starring adds the task to the Starred list; unstarring removes it (even items the old morning file featured).
- Self panel **Log done**: records something already finished off-site as a done Self task with a chosen day (past days land at noon) and a required area; counts in Review + Balance (`logSelfItem`, `recordCompletion(..., { at, focusAreaId })`). Undo reopens the task but does not remove the completion (the ledger has no removal yet).
- Backup-off note now says live TickTick / Gmail / Role Hub need backup on in that browser.

## Task sorting (bucket + goal per task)

- `lib/taskRules.ts`: rules keyed `source::t:<normalized title>` (or `source::id:<id>`), plus `source::*` site-wide defaults that fill unset fields. `{ area?, goal?, at }`; goal `none` = no goal on purpose. Stored `lifehub-task-rules`, cloud-synced as `rules` (newest wins — Worker redeploy needed when adding synced fields).
- Bucket: `resolveFocusArea` checks the rule first; `visibleLedger` re-sorts past completions by rule. Goal: `goalOf` = rule, else goal link; `goalMomentum` + Why "linked" counts include rule-sorted tasks.
- ⚙ in the header opens Settings → **Task sorting** (`app/components/TaskSorting.tsx`): every open task + every completed task, grouped by rule key, Bucket / Goal dropdowns, site-wide default row when a site is filtered.
- Marking done in Life Hub asks bucket + goal (`AreaPicker`) when either is unknown and saves the answer (option: every task from that site). Gmail/Outlook still ask the bucket unless a rule sets it.
- Review shows **N completed tasks need a bucket or goal** (`NeedsSorting`) for the chosen period — for things done on their own site.
- Won't-do TickTick tasks (status −1) and habits marked not completed (check-in status 1) never count: the Worker keeps only status 2.

### Live counts beside the title (2026-10-01)

- Right of "Randy's Life Hub." (above Why; drops below the title on a phone): **N done today** in green (same number as Review's collapsed count — `completionStats.today`, real completions only) and **N open · K sites** in amber (sum of every card's blue to-do number, `getActionableMetric`), plus a chip per site with open work (tap to open that site). Own colors on purpose — not the title's gradient. `app/components/HomeView.tsx`, `.hero-title-row` / `.hero-stat` in `app/globals.css`.
- Dark mode: header buttons (⚙, Light, Refresh, Today) were white boxes with pale text; now dark surface + light text.

### TickTick: "won't do" habits leave the to-do list (2026-10-01)

- A habit marked not completed for a day (check-in status 1) was dropped by the Worker, so the hub still listed it as to do. `/api/ticktick/done` now also returns `skipped: [{ id, stamp }]`; `pullTickTickDone` adds each stamp to that habit's `exDates`, so `habitDueOn` treats it as off that day — off the TickTick card, the habit count, Balance availability and suggestions. Still never a completion. Needs the Worker redeploy (`npm run deploy`); until then nothing changes.

## UI passes (2026-10-03)

- **Pass 1:** sections carry a tone + icon (`Collapsible` `tone`/`icon`/`summary`): Why gold, Review green, Self violet, Priority rose, Daily ops blue, Money amber, Ventures teal; collapsed bars show summary chips. Header site row → **Sites ▾** menu. Auto page size by width (`ZoomControl`: 100/112/125% at <1400/≥1400/≥1750 until a size is picked; % resets to Auto; an old stored 100 counts as unset). Review: tiles left, By source right; Balance two columns ≥1300px.
- **Pass 2:** `SourceCard` (`.card-v2`): header = icon · name · to-do chip + other metrics · one-line subtext (label · sync · links), ↗ and ▾; no number/metric grid/description/footer; Starred hidden when empty; `TaskList open` shows the list immediately.
- **Pass 3:** Priority is a workstation (`PriorityBoard`): Now / Next / Later lanes, drag to move/reorder (or ◀ ▶), search to pull any open task in, Done completes on its site. Stored in `lifehub-priority-lanes` (`source:id` → `{lane, order, at}`), cloud-synced as `priority`; the old `lifehub-priority-pins` list folds into Now once. Critical items show in Now until placed.

## Fall redesign (2026-10-03, PR after #50)

- **Theme:** fall palette (last layer of `globals.css`, `--c-<site>` vars). Day = hybrid: brown page `--bg`, cream boxes; page-level text uses `--page-*` vars (hero, row labels, footer). Night = espresso. Header is a dark brown bar in both. Task rows/featured rows/plan items sit in `--row` boxes.
- **Font:** `LH Text` (regular, medium for anything bold) / `LH Title` (semi-bold, headings/names/big numbers) — currently Barlow (full width) files; Randy is choosing from a round-3 preview. Swap by changing the `@font-face` URLs only.
- **Logos:** `public/logos/*.svg` (simple-icons, brand colors) for Gmail/Outlook/TickTick/Radall (Google Sheets). Uploads: Settings → Site pictures (`lib/siteIcons.ts`, 128px PNG data URLs, synced as `icons`). `SiteIcon` component everywhere a site is shown.
- **Layout:** Why is its own page (header ✦ Why, `SpaceId 'why'`). The Self tool (CapturesPanel) is the Self card's body in Daily ops; the separate Self section is gone. Daily ops = TickTick (full list, scrolls) | Self over Outlook | Gmail over Repair.
- **Doing now** (`PriorityBoard`): pinned + critical items grouped into one container per site (lanes data kept but unused).

## UX audit pass (2026-10-05)
Design critique + WCAG 2.1 AA + copy + design-system audit, then fixes (last block of `app/globals.css`):
- Phones/tablets: Daily ops and every card row stack (a later unconditioned 3-column rule had been overriding the breakpoints, so phones got three ~110px columns).
- Text floor 12px (was 9–11px for ~40% of text); row buttons 26px tall (36px on touch); priority dot / critical flag get a 7px invisible hit margin.
- One focus ring everywhere (`:focus-visible`, accent; cream on the brown page).
- Today drawer: role=dialog, focus moves to Close, Escape closes, cream surface, site names instead of ids.
- Contrast: `--accent-ink` (#9a3b14 day / #f0a174 night) for accent-coloured text; deeper Move/Resale tokens and Gmail/Radall pills; night filled buttons #b04e1e. Automated check passes on home, all 11 site pages, Why, Settings, drawer — day and night.
- Off-palette blues/purples (Balance badges, "needs action") moved into the fall palette.
- Cards hide stats that have no value yet ("— applied today"); secondary row detail (sender / due date) shrinks first and hides in cards under 400px; "today" hides in narrow TickTick columns but "overdue" stays (red).
- Copy: no file paths / "bridge stub" in site descriptions; "Pin" everywhere (site pages said "Priority"); Refresh tooltip in plain words.

## Five decisions (2026-10-05, after the audit)
- Home order: Priority → Daily ops → Role · move → Ventures → Review (Review + backup row moved to the bottom).
- Self card: add form is one line until clicked; closes on a click/tab outside the form (not on blur — Safari doesn't focus buttons) and resets to Task if nothing was typed.
- Why page shows every goal (no 6-card preview).
- Gmail keeps the sender visible in its card (34% max, "From " dropped in compact rows).
- Site page header is compact: logo tile + eyebrow + name + one-line intro (no "03" index, no decorative circle, no big symbol).
- Phone fixes on site pages: `.room-body` and `.task-board` use `minmax(0, 1fr)` so long titles truncate instead of clipping the page.

## Priority rework, TickTick box, smaller title (2026-10-06)
- **Title strip** is smaller (title ~42px max, tighter padding). "Done today" green brightened to stay readable at the smaller size.
- **TickTick box** next to "done today" / "open": same height; top half = TickTick tasks (the card's "to do"), bottom half = habits left today. Click opens TickTick's page.
- **TickTick column counts** now include starred items ("Tasks · 16 · 2 in Starred above"), so they match the card's "to do". Before, starred tasks/habits were left out of the column totals, which is why "14 tasks" sat next to "16 to do".
- **Priority = two stages** (`PriorityBoard.tsx`): **On deck** (everything pinned/critical, grouped by site, compact) → **Action list** (what Randy decided to do, numbered, in order; ▲▼ or drag). Rows show the site's subtext (task note / Self detail) under the title.
- **Side panel** (`PriorityPanel.tsx`): click any item → full note, "Open in <site> ↗", color/Critical, **Before this** (blockers / things that must happen first, tick-off list; open ones show "Waiting on N things first" on the row), and a **Plan** note. Rendered into `.frontier-shell` via a portal (the board's blur effect traps fixed elements). Escape / scrim / × close it.
- **Data** (`lib/priorityPins.ts`): no new synced field. Lane values reused so nothing migrates: `'now'` = On deck (`DECK`), `'next'` = Action list (`PLAN`). `note` and `before` ride on the same `priority` entry (the merge passes entries through whole; newest `at` wins), so no Worker deploy is needed.

## Schedule: calendar, maybe-plans, bills (2026-10-06)
- **Two views** (Randy, 2026-10-06), remembered per device in `lifehub-schedule-view`:
  - **Default (month view):** three columns, **Upcoming** (next 7 days, with bills on their due day plus overdue ones under Today) | **Needs to confirm** (invitations + maybe-plans, Yes/No, + Add a maybe) | **month calendar** (`MonthMini`, up to 2 items per day; dots on phones). Clicking a day opens a pop-out (`DayPopover`) with everything that day: Pay/Paid, Yes/No, Open/Reply, "+ Add a maybe this day", "See the week →". The pop-out is placed with layout offsets (not screen pixels, because the page zoom would skew them) and stays inside the calendar box. Escape or an outside click closes it. Clicking a day in the lists opens its pop-out.
  - **Expanded (`Expand ⤢`):** the original rail + week/month calendar described below.
- **Where:** first section on home (above Priority), `ScheduleSection.tsx`. Left rail: **Coming up** (next 7 days, ≤8 rows), **Not confirmed yet** (Google invitations with my status invited/maybe + Life Hub maybe-plans), **Bills due** (≤14 days). Right: `CalendarView.tsx`, a week view (3 days on phones) and month view; confirmed = solid, not confirmed = dashed + hatched; bills in the all-day row. Clicking anything shows a detail card above the calendar. Fig/plum (`--c-schedule #6b3a5a`) is the section color.
- **Data (private):** `apps-script/LifeHubSchedule.gs` (added to the Life Hub Mail Sync project) reads calendars that are switched on (last 7 days → next 6 weeks) and the Finances sheet's **Bills** tab every 10 min, then POSTs `{source:'schedule', events, bills}` to Worker `/api/schedule/snapshot` (X-Mail-Key). Life Hub GETs with the backup key (`lib/schedule.ts`), caching the last copy in `lifehub-schedule-cache`. Never in `public/data`. Setup steps: `docs/SCHEDULE_SETUP.md`.
- **Maybe-plans** (`lib/plans.ts`): title, day, optional from/to, note. Each shows how it fits: "Clashes with X (time)" (overlaps a confirmed timed event) / "Free then" / "That day: …". **Yes** opens a pre-filled Google Calendar event (template link, no API) and marks it `yes`; **No** marks it `no`. Plans are never deleted (status only), so the merge can't bring them back. Synced as the new `plans` field. **Needs a Worker deploy** to sync across devices (the Worker's `normalizeState` would otherwise drop it; local copies are kept meanwhile).
- **Bills** (`lib/schedule.ts` `billDues`): monthly by **Due day** (clamped to month length) and/or a one-off **Due date**; only dates after **Paid through**; with no Paid through, monthly bills count from today (a freshly filled sheet never shows false overdue; set Paid through to get real overdue warnings). **Paid** on Life Hub = ledger completion `radall` / `bill:<id>:<YYYY-MM-DD>` (real Hub Done, syncs, counts in Balance) and hides that due date. Autopay bills drop off after the date. Also shown in the Radall Finances card (next 21 days).

## Events, Priority v3, TickTick rings (2026-10-07)
- **Schedule → Events** (top half of the middle column; "Needs to confirm" is the bottom half; also in the expanded rail). `lib/events.ts`:
  - A Google event is listed automatically when all of these hold: confirmed, not `recurring`, and not on a holidays/birthdays calendar.
  - It must also be at least one of: all-day / multi-day, 4h+ long, or titled with an event word (shower, trip, party, dental, doctor, appointment, wedding…).
  - Up to 120 days ahead, with an icon by keyword and a countdown chip.
  - **✕** hides an event and **☆ Event** in a day pop-out shows one; both are stored in the new synced field `eventMarks` (id → {mark, at}, newest wins).
  - **+ Add an event** creates a plan with `kind: 'event'`, `status: 'yes'` and an optional `endDate`. It shows on the calendar and has a ↗ link to add it to Google.
- **Apps Script** (`LifeHubSchedule.gs`, pushed to the Mail Sync project): marks `recurring` events. After the 42-day window it also sends one-off or all-day events out to 120 days (max 200). The Worker's schedule size cap was raised to 1.5 MB.
- **Priority v3** (`PriorityBoard.tsx`, `.pb-v3`):
  - Two full-width lists. Action list on the left: numbered, 16px checkbox = Done, site logo, one line. On deck on the right: one thin header per site, "+ List".
  - Subtext moved to the side panel. Color and Critical show as a left edge or chip. Row tools show on hover (always on touch).
- **TickTick rings** (`TickTickRings.tsx`, hero box) show what share of today's tasks and of today's habits is *logged*: done (green) + won't do (amber) vs still open.
  - Done = today's ledger entries.
  - Won't do = habits skipped today, plus tasks closed as won't-do (Worker `/api/ticktick/done` now returns `wontDo`, status −1). Kept in `lifehub-ticktick-daylog` (this browser, today only).

## One type scale, Gmail stars, Self rows, Priority grid (2026-10-07)
- **Type scale** (last block of `globals.css`). Inside every card there are three text sizes: **15px** card name + its numbers, **13px** every item title (tasks, starred, Self, bills, emails, empty notes), **12px** everything secondary (labels, dates, senders, tags, stats, buttons). `--fs-name/--fs-item/--fs-meta`; the older `--item-fs/--meta-fs` now point at the same values.
- **Starred lists are one-line rows** again, the same as task rows (the sideways card strip is overridden inside cards).
- **Gmail**:
  - Stars are Life Hub stars (`HUB_STAR_SOURCES` + `TASKS_ARE_FEATURED` in `lib/hubStars.ts`). Every Gmail-starred email is a task in the card's list, and ☆ lifts one into "Starred action emails", keeping its sender line.
  - Synced through the existing `stars` field.
- **Self card**:
  - Opens on Tasks when the Inbox is empty, and empty tabs hide.
  - Empty notes are one short line; each item is one line (title, then the day chip; the note is in the hover text).
- **Priority On deck** is a grid of site boxes, `--cols = min(sites, 3)`: 2 sites → 2 across, 3 → 3, 4+ → 3 across and wrapping. Titles wrap to two lines at 12.5px. The Action list stays on the left.

## Star / Pin / 📅 → give it a day (2026-10-07)
- `DayMenu.tsx`: a small line that opens under a row with:
  - an optional toggle: ☆ Star on task rows, ◎ Pin to Priority on starred items;
  - **Today**, **Tomorrow**, a date picker, and **No day**.
- Giving a day pins the item to Priority (On deck) if it isn't already, and sets `due` on its Priority entry. That puts it on the calendar (the existing `calTasks` path); no new synced field.
- Used in:
  - TaskList ☆ (every site except Self, which keeps its own day box);
  - FeaturedList Pin;
  - Priority rows (a small 📅 next to "+ List", and on the action list).
- Rows with a day show a small day chip.
- TickTick rows: a round ✓ replaces Done. In the tasks | habits columns, names wrap to two lines, and "overdue" is a red left edge (still in the hover text).

## Self stars, moving Self tasks, finance task types (2026-10-07)
- **Self ★ no longer pins to Priority.**
  - Starred Self tasks sit in a **Starred** list at the top of the Self card. **Pin** there sends one to Priority, and the Self "+ Day" box stays.
  - One-time cleanup (`lifehub-selfpins-cleared`): auto-pinned Self items still On deck with no day, note or steps were unpinned.
- **Move a Self task to another site.**
  - The Self row's **Move** dropdown offers Finances, Repair Log, Role Hub, Move OS, Venture Lab, Resale and Candle. It sets `SelfItem.home`.
  - The task then shows in that card as `self:<id>`, counted in its open number. Done and ☆ still act on the Self task (rerouted in `completeOnHub` / `starOnHub`).
  - ☆ menu → **↩ Back to Self** returns it.
  - It stays a Life Hub item: nothing is written to the Radall sheet.
- **Task types** (`lib/taskTags.ts`, new synced field `tags`, Worker redeployed):
  - On Finances tasks, the ☆ / Pin menu has a **Type** box with suggestions (Items to buy, Bills, Subscriptions, Insurance, Paperwork, Taxes).
  - The type shows as the colored tag before the title. New tag tones were added, and tags are readable in day mode.
- **Radall card:** tasks first, then "Money due · next 3 weeks".

## Compact finance task types (2026-10-07)
- Finance types use small, sentence-case tags with bounded width, keeping task titles readable.
- Doing now / Focus rows and task search show the type after the title.
- Pinned featured rows hide the inactive critical (!) toggle; explicitly Critical items retain their label and control.

## Flow integration (2026-10-08, from Rock's local branch)
- **Buckets:** 9 attention buckets. The original 7 IDs are kept; `home` is renamed "Life Care, Organization & Systems", and `connection` and `creative` are new. Flow's sixth category, Life Care & Upkeep, and the supplemental care goals are in `goals.json`.
- **Rules:** Move OS counts as relocation (`home`), not body. Orientation/container TickTick items earn no credit. The shared manifest is `public/data/flow-map.json` (74 TickTick bindings, 87 routines).
- **Settings → "Review the homes for your work"** (`FlowSyncReview.tsx`, `lib/flowMigration.ts`):
  - Runs in Randy's own browser. **Inspect** is read-only. **Apply** writes a backup (localStorage + a downloaded JSON) first, then changes only the reviewed rows.
  - Never creates or deletes completions; ids, dates and counts are kept.
  - Covers the 74 TickTick definitions **and every other task in the real history**: every completed task from any site, plus remembered rules. It flags unsorted ones and ones done under more than one bucket.
- **Merge:** `focusUpdatedAt` lets a reviewed reclassification beat older manual marks in both merge orders.
- **Worker:** `/api/flow/ticktick/catalog`, a read-only full TickTick catalog, available only once the backup is claimed.
- **Tests:** `node tests/flow-migration.cjs`.
- **Not done:**
  - TickTick write-side sync (only read, compare and export exist).
  - Music Hub session-ID linkage.
  - A labeled baseline for workload after the bucket split; old aggregate workload is not split retroactively.
- `VITE_LOCAL_PREVIEW=true` is only for review builds.

## TickTick write-back, Flow on Why, music link, no-credit items (2026-10-08)
- **Write-back** (Settings → bottom of "Review the homes for your work"):
  - Load Flow's exported "reviewed sync plan" and tick changes.
  - Worker `POST /api/flow/ticktick/apply` writes **tasks only**, and only `title` / `content` / `repeatFlag`. It requires the claimed backup connection and takes at most 40 per call.
  - Each task is re-read first. It's skipped if it's no longer open, or if any changed field differs from what the plan saw (`changed_in_ticktick`).
  - The whole task is sent back with only those fields changed, so checklists, reminders, dates and tags are kept.
  - Before-values download first. **Undo** sends them back with the same stale check.
  - Habits stay read-only (their write API is unverified).
- **Why** opens on an embedded **Flow** tab (live flow-hub); "Goals & work" keeps the old view.
- **♪** on music tasks opens Music Hub (https://my-music-hub.randymcfarland1227.workers.dev/). Randy marks music sessions done in Life Hub; no session-ID linkage.
- **No-credit items:** `focus-areas.json` `noCredit` means listed and counted on the TickTick card, but no completion credit and not Balance workload. These were in `ignore` (hidden), which made TickTick show 6 where TickTick had 8.
