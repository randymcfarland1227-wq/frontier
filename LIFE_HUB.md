# Randy's Life Hub (frontier upgrade)

Phase 1 scaffold on branch `life-hub-upgrade`. Worker name stays **`frontier-work-room`** so deploys keep replacing `https://frontier-work-room.randymcfarland1227.workers.dev`.

## Sources (11)

| # | id | Name | Bridge / adapter |
|---|----|------|------------------|
| 01 | `ticktick` | TickTick | API stub (`lib/adapters/ticktick.ts`) |
| 02 | `radall` | Radall Finances (Sheet) | API stub — sheet id `19rw8MAYTZ70Qy2GFAi0DaCGdsp7hQc67l8nkvw17jQk` |
| 03 | `gmail` | Gmail Starred | API stub |
| 04 | `outlook` | Outlook job inquiries | API stub |
| 05 | `resale` | Resale Hub | Hidden iframe + postMessage (existing sell-hub) |
| 06 | `role` | Role Hub | Hidden iframe + postMessage (Apps Script; legacy id `search` still accepted) |
| 07 | `candle` | Peculiar Candle Pre Launch | **Placeholder only** |
| 08 | `income` | Income & Venture Lab | iframe ready; origin must post snapshots |
| 09 | `move` | Move OS | iframe ready; origin must post snapshots |
| 10 | `repair` | Site Repair Log | iframe ready; origin must post snapshots |
| 11 | `self` | Self inbox | Hub-native `localStorage` (add / star / complete) |

## postMessage protocol

Window name: `randys-life-hub` (was `randys-work-room`).

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

## Still needed (later passes)

1. **Origin bridges** — update sell-hub, Role Hub script, income-venture-lab, move-os, site-repair-log to:
   - include `tasks[]` in snapshots
   - listen for `randys-workroom:complete` / `:star`
2. **API secrets** — TickTick, Gmail, Outlook (Graph), Google Sheets (Radall Task list tab)
3. **Candle** — replace placeholder when pre-launch site is ready
4. **Deploy** — `npm run deploy` (wrangler) when credentials available; Node **>= 22.13** preferred (`engines` in package.json)

## Layout

- `lib/types.ts` — protocol + domain types
- `lib/sources.ts` — 11 source definitions
- `lib/adapters/*` — stubs + Self implementation
- `app/components/*` — Header, cards, lists, Self inbox, bridges
- `app/page.tsx` — orchestration, postMessage, complete/star fan-out
