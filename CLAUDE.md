# Randy's Life Hub (repo: `frontier`)

A static React + TypeScript SPA on GitHub Pages that pulls Randy's life tools into one page:
source cards, a completion ledger, Balance across life areas, a Why panel of goals, and a Self
panel of tasks/thoughts/ideas. When Randy says "the Life Hub", he means this repo.

- **Live:** https://randymcfarland1227-wq.github.io/frontier/
- **Read first:** `LIFE_HUB.md` (how every piece works, newest notes at the bottom).
  `docs/BUILDER_HANDOFF.md` is the original spec; everything in its Part 2 is built.
- **Owner:** Randy (`randymcfarland1227-wq`). Timezone America/New_York.

## How it fits together

| Piece | Where | Notes |
|---|---|---|
| Life Hub site | this repo → GitHub Pages | Push to `main` = live deploy (Actions `deploy-pages.yml`) |
| Worker `frontier-work-room` | `worker/index.ts`, `wrangler.jsonc` | TickTick complete, TickTick done feed, habit check-in, cloud backup (`/api/state`, KV `LIFEHUB_STATE`). Other page loads = handoff page for the retired old copy |
| Focus areas + targets | `public/data/focus-areas.json` | Area **ids never change** (history keys on them); names can. Bump `rulesVersion` to re-sort history |
| Connector snapshots | `public/data/{gmail,outlook,radall,ticktick,role}.json` | Written by an external morning sync (not in this repo) |
| Goals (Why panel) | Goals hub Apps Script `?action=efforts/reviews` | Live read; fallback `public/data/goals.json`. Never write goals here |
| TickTick areas | Routine Hub Apps Script `?action=routines` | Live read; fallback `public/data/routines.json` |
| Role Hub | Apps Script `next_move_app` (script id `1PhvVFI8iAgQPTcauO7QLG7K9QadhEiuiFQq0xlCnVIhuASmDnJiodI7f`; source lives on Randy's Mac, not in a repo yet) | Posts a snapshot to Life Hub via `window.opener` (`workroomSnapshot` in `JavaScript.html`) |
| Resale | repo `sell-hub` (`js/app.js` → `resaleWorkroomSnapshot`) | Sends real finished actions as done tasks |

## Rules that matter

- **Only real completions count.** Hub Done, a source reporting `status: 'done'`, or TickTick's
  own completed list/check-ins. A task that merely disappears is never a completion. Legacy
  `via: 'origin-snapshot'` entries are filtered everywhere (`isRealCompletion` in `lib/syncState.ts`).
- **Merges only combine.** `lib/syncState.ts` runs identically on the Worker and in the browser.
  Don't add code that overwrites the backup.
- **Never claim, read, or handle Randy's backup key.** The first browser to turn on backup claims
  the store; the Worker only keeps a SHA-256. Private endpoints need that key.
- **Workflow:** branch → PR → merge only when Randy says so (merge deploys live). Run
  `npx tsc --noEmit -p .`, `npm run lint` (3 pre-existing `set-state-in-effect` errors in
  `app/life-hub.tsx` are known), and `npm run build:pages` before a PR. Preview with
  `npm run preview:pages`.
- **Deploy order:** when a change spans both, ship Pages first, then the Worker (`npm run deploy`).

## What a cloud session can't do

These need logins that only exist on Randy's Mac. Hand them back to a local session:
- **Worker deploys** (`npm run deploy` / `wrangler`), secrets, KV.
- **Apps Script deploys** (`clasp`). Pinned deployments need `clasp redeploy <id> -V <n>`, not
  `clasp deploy --deploymentId`.
- **Testing the private Worker endpoints**, which need Randy's backup key.

Editing code, opening PRs, and changing `public/data/*.json` all work anywhere.

## Randy's preferences

Plain-language explanations, not jargon. Verify before claiming something works, and say what
wasn't tested. Ask before changing area targets or other product decisions.
