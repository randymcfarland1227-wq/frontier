/**
 * Life Hub Schedule — sends Google Calendar + the Finances sheet's "Bills" tab to Life Hub.
 *
 * Every 10 minutes it reads:
 *   - every calendar you have switched on in Google Calendar (last 7 days → next 6 weeks, plus
 *     one-off / all-day events up to ~4 months ahead for the Events list), and
 *   - the "Bills" tab of the Finances spreadsheet,
 * then POSTs one private snapshot to the Life Hub Worker (/api/schedule/snapshot). Life Hub only
 * reads it back with your backup key, so none of this lands in the public website files.
 *
 * Setup (once): add this file to the "Life Hub Mail Sync" Apps Script project (it already has
 * the Worker key), then run `setupLifeHubSchedule` and approve the Calendar + Sheets permissions.
 * See docs/SCHEDULE_SETUP.md.
 */

var LH_SCHEDULE = {
  WORKER_URL: 'https://frontier-work-room.randymcfarland1227.workers.dev/api/schedule/snapshot',
  /** Radall Finances spreadsheet */
  FINANCE_SHEET_ID: '19rw8MAYTZ70Qy2GFAi0DaCGdsp7hQc67l8nkvw17jQk',
  BILLS_TAB: 'Bills',
  DAYS_BACK: 7,
  DAYS_AHEAD: 42,
  MAX_EVENTS: 800,
  /** Further out (Life Hub's Events list): one-off and all-day events only, up to this many days ahead */
  EVENTS_AHEAD: 120,
  MAX_FAR_EVENTS: 200,
  /**
   * Script property holding the Worker's MAIL_PUSH_KEY secret (Mail Sync stores it as LIFEHUB_MAIL_KEY). If that ever
   * changes, change this one line to match.
   */
  KEY_PROPERTY: 'LIFEHUB_MAIL_KEY',
};

/** Bills tab columns, in order. Life Hub finds them by name, so you can move them around. */
var LH_BILL_HEADERS = ['Bill', 'Amount', 'Due day', 'Due date', 'Pay link', 'Autopay', 'Paid through', 'Notes'];

/** Run once: makes the Bills tab (if missing), adds the 10-minute trigger, and sends a first snapshot. */
function setupLifeHubSchedule() {
  lhScheduleKey_(); // fail early with a clear message if the key isn't there
  lhEnsureBillsTab_(SpreadsheetApp.openById(LH_SCHEDULE.FINANCE_SHEET_ID));
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'pushLifeHubSchedule'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('pushLifeHubSchedule').timeBased().everyMinutes(10).create();
  var result = pushLifeHubSchedule();
  Logger.log('Life Hub Schedule is set up. First send: ' + JSON.stringify(result));
}

/** The 10-minute job. */
function pushLifeHubSchedule() {
  var snapshot = {
    source: 'schedule',
    refreshedAt: new Date().toISOString(),
    calendars: [],
    events: [],
    bills: [],
  };
  var cal = lhReadCalendars_();
  snapshot.calendars = cal.calendars;
  snapshot.events = cal.events;
  snapshot.bills = lhReadBills_();

  var res = UrlFetchApp.fetch(LH_SCHEDULE.WORKER_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'X-Mail-Key': lhScheduleKey_() },
    payload: JSON.stringify(snapshot),
    muteHttpExceptions: true,
  });
  var code = res.getResponseCode();
  if (code !== 200) throw new Error('Life Hub said ' + code + ': ' + res.getContentText().slice(0, 200));
  return JSON.parse(res.getContentText());
}

function lhScheduleKey_() {
  var key = PropertiesService.getScriptProperties().getProperty(LH_SCHEDULE.KEY_PROPERTY);
  if (!key) {
    throw new Error(
      'Missing script property "' + LH_SCHEDULE.KEY_PROPERTY + '". Put this file in the Life Hub Mail Sync project, ' +
        'or set that property to the Worker secret MAIL_PUSH_KEY (Project Settings → Script properties).',
    );
  }
  return key;
}

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

function lhReadCalendars_() {
  var now = new Date();
  var from = new Date(now.getTime() - LH_SCHEDULE.DAYS_BACK * 864e5);
  var to = new Date(now.getTime() + LH_SCHEDULE.DAYS_AHEAD * 864e5);
  var far = new Date(now.getTime() + LH_SCHEDULE.EVENTS_AHEAD * 864e5);
  var calendars = [];
  var events = [];
  var farCount = 0;
  CalendarApp.getAllCalendars().forEach(function (cal) {
    // Only what you see in Google Calendar (switched on, not hidden).
    if (cal.isHidden() || !cal.isSelected()) return;
    var name = cal.getName();
    var color = cal.getColor();
    var tz = cal.getTimeZone() || Session.getScriptTimeZone();
    calendars.push({ name: name, color: color });
    cal.getEvents(from, to).forEach(function (ev) {
      if (events.length >= LH_SCHEDULE.MAX_EVENTS) return;
      var item = lhEventItem_(ev, cal, name, color, tz);
      if (item) events.push(item);
    });
    // Beyond the calendar window, only things worth seeing coming (trips, appointments, parties):
    // one-off or all-day events — no weekly repeats — so the snapshot stays small.
    cal.getEvents(to, far).forEach(function (ev) {
      if (farCount >= LH_SCHEDULE.MAX_FAR_EVENTS) return;
      if (ev.getStartTime() < to) return; // already sent in the first pass
      if (ev.isRecurringEvent() && !ev.isAllDayEvent()) return;
      var item = lhEventItem_(ev, cal, name, color, tz);
      if (!item) return;
      events.push(item);
      farCount++;
    });
  });
  return { calendars: calendars, events: events };
}

function lhEventItem_(ev, cal, name, color, tz) {
  var status = lhStatus_(ev);
  if (status === 'no') return null; // declined
  var allDay = ev.isAllDayEvent();
  var start = allDay ? Utilities.formatDate(ev.getAllDayStartDate(), tz, 'yyyy-MM-dd') : ev.getStartTime().toISOString();
  var end = allDay ? Utilities.formatDate(ev.getAllDayEndDate(), tz, 'yyyy-MM-dd') : ev.getEndTime().toISOString();
  var item = {
    // Recurring events share one id, so the start keeps each occurrence apart.
    id: ev.getId() + '|' + start,
    title: ev.getTitle() || '(No title)',
    start: start,
    end: end,
    allDay: allDay,
    calendar: name,
    color: color,
    myStatus: status,
    url: lhEventUrl_(ev, cal),
  };
  // Weekly classes etc. never count as "Events" on Life Hub.
  if (ev.isRecurringEvent()) item.recurring = true;
  var where = ev.getLocation();
  if (where) item.location = where.slice(0, 200);
  if (status === 'invited' || status === 'maybe') {
    var creators = ev.getCreators();
    if (creators && creators.length) item.organizer = creators[0];
  }
  return item;
}

function lhStatus_(ev) {
  var s = String(ev.getMyStatus() || '').toLowerCase();
  if (s === 'owner' || s === 'yes' || s === 'maybe' || s === 'invited' || s === 'no') return s;
  return 'yes';
}

/** Link that opens the event in Google Calendar. */
function lhEventUrl_(ev, cal) {
  try {
    var eid = Utilities.base64EncodeWebSafe(ev.getId().split('@')[0] + ' ' + cal.getId()).replace(/=+$/, '');
    return 'https://www.google.com/calendar/event?eid=' + eid;
  } catch (e) {
    return 'https://calendar.google.com/calendar/r';
  }
}

// ---------------------------------------------------------------------------
// Bills
// ---------------------------------------------------------------------------

function lhReadBills_() {
  var ss = SpreadsheetApp.openById(LH_SCHEDULE.FINANCE_SHEET_ID);
  var sheet = ss.getSheetByName(LH_SCHEDULE.BILLS_TAB);
  if (!sheet || sheet.getLastRow() < 2) return [];
  var range = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn());
  var values = range.getValues();
  var rich = range.getRichTextValues();
  var tz = ss.getSpreadsheetTimeZone();
  var col = {};
  values[0].forEach(function (h, i) { col[String(h).trim().toLowerCase()] = i; });
  var get = function (row, name) { return col[name] === undefined ? '' : values[row][col[name]]; };
  var day = function (v) {
    if (v instanceof Date) return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
    var s = String(v || '').trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
  };
  var seen = {};
  var bills = [];
  for (var r = 1; r < values.length; r++) {
    var name = String(get(r, 'bill') || '').trim();
    if (!name) continue;
    var slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'bill';
    var id = seen[slug] ? slug + '-' + (r + 1) : slug;
    seen[slug] = true;
    var bill = { id: id, name: name };
    var amount = Number(String(get(r, 'amount')).replace(/[$,]/g, ''));
    if (get(r, 'amount') !== '' && isFinite(amount)) bill.amount = amount;
    var dueDay = Number(get(r, 'due day'));
    if (dueDay >= 1 && dueDay <= 31) bill.dueDay = Math.round(dueDay);
    var dueDate = day(get(r, 'due date'));
    if (dueDate) bill.dueDate = dueDate;
    var paid = day(get(r, 'paid through'));
    if (paid) bill.paidThrough = paid;
    var link = lhLink_(get(r, 'pay link'), col['pay link'] === undefined ? null : rich[r][col['pay link']]);
    if (link) bill.payUrl = link;
    var auto = get(r, 'autopay');
    if (auto === true || /^(yes|y|true|auto)$/i.test(String(auto))) bill.autopay = true;
    var notes = String(get(r, 'notes') || '').trim();
    if (notes) bill.notes = notes.slice(0, 300);
    if (bill.dueDay || bill.dueDate) bills.push(bill);
  }
  return bills;
}

/** A pay link typed as text, or a linked cell (Insert → Link). Only http(s) links are sent. */
function lhLink_(value, richText) {
  var url = richText && richText.getLinkUrl ? richText.getLinkUrl() : null;
  if (!url && richText && richText.getRuns) {
    richText.getRuns().forEach(function (run) { if (!url && run.getLinkUrl()) url = run.getLinkUrl(); });
  }
  if (!url) url = String(value || '').trim();
  if (url && !/^https?:\/\//i.test(url) && /^[\w-]+(\.[\w-]+)+/.test(url)) url = 'https://' + url;
  return /^https?:\/\//i.test(url) ? url : '';
}

/** Creates the Bills tab with headers, checkboxes and date formats (leaves an existing tab alone). */
function lhEnsureBillsTab_(ss) {
  var sheet = ss.getSheetByName(LH_SCHEDULE.BILLS_TAB);
  if (sheet) return sheet;
  sheet = ss.insertSheet(LH_SCHEDULE.BILLS_TAB);
  sheet.getRange(1, 1, 1, LH_BILL_HEADERS.length).setValues([LH_BILL_HEADERS]).setFontWeight('bold');
  sheet.setFrozenRows(1);
  var rows = 200;
  sheet.getRange(2, 2, rows, 1).setNumberFormat('$#,##0.00');
  sheet.getRange(2, 3, rows, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireNumberBetween(1, 31).setAllowInvalid(false)
      .setHelpText('Day of the month it is due (1–31). Leave empty for a one-time bill.').build(),
  );
  sheet.getRange(2, 4, rows, 1).setNumberFormat('yyyy-mm-dd');
  sheet.getRange(2, 6, rows, 1).insertCheckboxes();
  sheet.getRange(2, 7, rows, 1).setNumberFormat('yyyy-mm-dd');
  var notes = [
    'Name of the bill, e.g. "Electric (BGE)"',
    'How much (optional)',
    'Monthly bills: day of the month it is due (1–31)',
    'One-time bills (or to override the monthly day): the exact due date',
    'Where you pay it — paste the link, Life Hub shows a Pay button',
    'Tick if it pays itself; Life Hub stops nagging once the date passes',
    'The last due date you have paid. Life Hub shows the next one after this, and flags it overdue if it passes. Empty = counts from today. (Marking paid on Life Hub also works.)',
    'Anything to remember',
  ];
  notes.forEach(function (n, i) { sheet.getRange(1, i + 1).setNote(n); });
  sheet.setColumnWidth(1, 200);
  sheet.setColumnWidth(5, 260);
  sheet.setColumnWidth(8, 260);
  return sheet;
}
