# Schedule setup: Google Calendar + Bills

The Schedule section at the top of Life Hub (calendar, "Not confirmed yet", "Bills due") is built.
It needs three one-time steps that can only be done from Randy's Mac (they need his logins).
Until then, Life Hub says "Google Calendar not connected yet". Maybe-plans already work.

## How it fits together

```
Google Calendar ─┐
                 ├─ "Life Hub Schedule" Apps Script (every 10 min) ── POST /api/schedule/snapshot ──► Worker (KV)
Finances "Bills" ┘                                       (X-Mail-Key = MAIL_PUSH_KEY)                 │
                                                                                                       ▼
                                                     Life Hub  ◄── GET /api/schedule/snapshot (backup key)
```

Calendar and bill details never go into `public/data/*.json`, because those files are public.

## Step 1: Deploy the Worker (needs `wrangler` login)

Ship the Pages change first (merge the PR), then:

```sh
npm run deploy
```

This adds `/api/schedule/snapshot` and teaches the backup about `plans` (maybe-plans). Until it's
deployed, maybe-plans stay on the device they were added on.

## Step 2: Add the Apps Script (needs Randy's Google login)

1. Open the **Life Hub Mail Sync** Apps Script project
   (script id `1xOI9TUs_NFK7qgutWpww3obmMhX5N6F3Y3HLMAAKszoqm0kdGsQBPlnq`). It already holds the Worker
   key.
2. Add a new script file named `LifeHubSchedule` and paste in `apps-script/LifeHubSchedule.gs` from
   this repo. With clasp: copy the file into the local clone of that project, then `clasp push`.
3. Key name: Mail Sync stores the Worker key in the Script Property `LIFEHUB_MAIL_KEY`, and
   `KEY_PROPERTY` at the top of the file is set to that. The project's `appsscript.json` lists its
   scopes explicitly, so `https://www.googleapis.com/auth/calendar.readonly` has to be in it.
   (Done 2026-10-06: file pushed as `LifeHubSchedule`, scope added.)
4. Run **`setupLifeHubSchedule`** once from the editor and approve the Calendar and Sheets
   permissions. It:
   - creates a **Bills** tab in the Finances sheet (if there isn't one), with headers, notes,
     checkboxes and date formats,
   - adds a 10-minute trigger for `pushLifeHubSchedule`,
   - sends the first snapshot. The log should say `{"ok":true,"events":N,"bills":N}`.

Which calendars are included: every calendar that's switched on (checked) in Google Calendar's
sidebar. Declined events are left out. Invitations you haven't answered, and ones you said
"maybe" to, show under "Not confirmed yet".

## Step 3: Fill in the Bills tab (Randy)

One row per bill. Only **Bill** and either **Due day** or **Due date** are required.

| Column | What to put | Example |
|---|---|---|
| Bill | Name | Electric (BGE) |
| Amount | How much (optional) | 124.50 |
| Due day | Monthly bills: day of the month (1–31) | 18 |
| Due date | One-time bills, or to override the monthly day | 2026-11-02 |
| Pay link | Where you pay it. Paste the link. | https://www.bge.com/... |
| Autopay | Tick if it pays itself | ☑ |
| Paid through | The last due date you've paid (optional; without it, Life Hub only counts from today, so nothing shows overdue) | 2026-09-18 |
| Notes | Anything to remember | Paperless |

What Life Hub does with it:
- Shows each bill's next unpaid due date with a countdown ("2 days", "Due today", "3 days overdue").
  Bills due within 3 days are amber; overdue ones are red.
- **Pay ↗** opens the pay link. **Paid** marks that month paid on Life Hub. It's saved as a real
  Finances completion, so it counts in Review/Balance and syncs to other devices. Updating **Paid
  through** in the sheet does the same thing from the sheet side.
- Autopay bills show but stop nagging once the date passes.

## Not built yet (next iterations)

- Writing to Google Calendar directly. For now **Yes** opens a pre-filled Google Calendar event to save.
  Invitations are answered in Google Calendar (**Reply ↗**).
- Marking a bill paid on Life Hub doesn't write back to the sheet.
- Reminders/notifications before a bill is due.
