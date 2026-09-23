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
