# Life Hub connector sync scripts

Static GitHub Pages cannot call Gmail / Sheets / Outlook / TickTick APIs with secrets.
Connectors are refreshed by an agent (or cron) that:

1. Calls MCP (Gmail, Google Sheets, Outlook) or TickTick Open API with a token
2. Maps results to `SourceSnapshot` JSON
3. Writes `public/data/<source>.json` (+ `manifest.json`)
4. Commits and pushes to `main` so Pages redeploys

## `write-connector-snapshots.mjs`

Validates and writes snapshots into `public/data/`.

```bash
# Map raw MCP dumps from /tmp/lifehub-sync/*-raw.json
node scripts/write-connector-snapshots.mjs --dir /tmp/lifehub-sync --map-raw

# Or pipe a single SourceSnapshot
cat gmail.json | node scripts/write-connector-snapshots.mjs --stdin

# Or write one file
node scripts/write-connector-snapshots.mjs --file ./gmail.json
```

Expected dump names in `--dir`:

| File | Role |
|------|------|
| `gmail-raw.json` / `gmail.json` | Starred Gmail threads |
| `radall-raw.json` / `radall.json` | Radall Task List sheet |
| `outlook-raw.json` / `outlook.json` | Outlook job inquiries |
| `ticktick-raw.json` / `ticktick.json` | TickTick tasks (optional) |

If TickTick has no token / no dump, the script writes an empty stub with a “token pending” featured note.

## Snapshot shape

See `lib/types.ts` (`SourceSnapshot`). Do **not** fabricate rows. Do **not** commit tokens.

## After write

```bash
npm run build:pages
git add public/data scripts LIFE_HUB.md lib/connectors.ts app/
git commit -m "Refresh Life Hub connector snapshots"
git push origin main
```

Hub SPA loads `import.meta.env.BASE_URL + 'data/<id>.json'` on mount (and Refresh).
