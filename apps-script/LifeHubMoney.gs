/**
 * Life Hub Money — sends the money tabs of the Radall sheet to Life Hub, and applies edits made on
 * Life Hub's Money page back to the sheet.
 *
 * Lives in the "Life Hub Mail Sync" Apps Script project (script id 1xOI9TUs…), next to Code.js:
 *   - syncStarredMail (10-minute trigger + Life Hub's Refresh) calls lhPushMoney_(key).
 *   - doPost routes { action: 'moneyEdit', edits } to lhMoneyEdit_(edits).
 *
 * The site does the reading (it finds each block by its heading), so this file only ships what
 * the tabs show: display values, which cells are crossed out, which hold formulas, and merges.
 * Edits are guarded: the tab must be on the list, the cell must still show what Life Hub showed
 * (`expect`), and formula cells are never written. Every change is logged on a "Life Hub edits" tab.
 */

var LH_MONEY = {
  WORKER_URL: 'https://frontier-work-room.randymcfarland1227.workers.dev/api/money/snapshot',
  SHEET_ID: '19rw8MAYTZ70Qy2GFAi0DaCGdsp7hQc67l8nkvw17jQk',
  TABS: ['Randy', 'Paylater', 'Restock/Purchases', 'Credit Matrix', 'Non-Credit', '🌟 CC/Savings Planner', 'Move Sav /COG Estimate'],
  LOG_TAB: 'Life Hub edits',
};

/** Everything Life Hub needs from the money tabs, as shown. */
function lhMoneySnapshot_() {
  var ss = SpreadsheetApp.openById(LH_MONEY.SHEET_ID);
  var tabs = {};
  LH_MONEY.TABS.forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) return;
    var rows = sh.getLastRow();
    var cols = sh.getLastColumn();
    if (!rows || !cols) return;
    var range = sh.getRange(1, 1, rows, cols);
    var v = range.getDisplayValues();
    var struck = [];
    range.getFontLines().forEach(function (r, i) {
      r.forEach(function (l, j) { if (l === 'line-through' && v[i][j] !== '') struck.push([i, j]); });
    });
    var formulas = [];
    range.getFormulas().forEach(function (r, i) {
      r.forEach(function (f, j) { if (f) formulas.push([i, j]); });
    });
    var merges = range.getMergedRanges().map(function (m) {
      return [m.getRow() - 1, m.getColumn() - 1, m.getLastRow() - 1, m.getLastColumn() - 1];
    });
    // Trim empty trailing columns per row to keep the snapshot small.
    var trimmed = v.map(function (r) {
      var end = r.length;
      while (end > 0 && r[end - 1] === '') end--;
      return r.slice(0, end);
    });
    tabs[name] = { gid: sh.getSheetId(), v: trimmed, s: struck, f: formulas, m: merges };
  });
  return {
    source: 'money',
    refreshedAt: new Date().toISOString(),
    sheetUrl: 'https://docs.google.com/spreadsheets/d/' + LH_MONEY.SHEET_ID + '/edit',
    tabs: tabs,
  };
}

/** Send the money snapshot to the Worker (called from syncStarredMail). */
function lhPushMoney_(key) {
  var snap = lhMoneySnapshot_();
  var res = UrlFetchApp.fetch(LH_MONEY.WORKER_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'X-Mail-Key': key },
    payload: JSON.stringify(snap),
    muteHttpExceptions: true,
  });
  return 'money HTTP ' + res.getResponseCode() + ' · ' + Object.keys(snap.tabs).length + ' tabs';
}

/**
 * Apply edits from Life Hub. Each edit is one of:
 *   { tab, r, c, expect, value }        set a cell (0-based row/col) — typed like you typed it
 *   { tab, r, c1, c2, expect, strike }  cross out / un-cross a row segment (first cell must match expect)
 *   { tab, r, c1, c2, expect, moveAfter } move a row segment to a new row inserted under row `moveAfter`
 *                                         (e.g. Needed Purchases → Wants); the old row is removed
 * Returns per-edit results and a fresh snapshot.
 */
function lhMoneyEdit_(edits) {
  var ss = SpreadsheetApp.openById(LH_MONEY.SHEET_ID);
  var results = (edits || []).slice(0, 20).map(function (e) {
    try {
      if (!e || LH_MONEY.TABS.indexOf(e.tab) < 0) return { ok: false, error: 'tab not allowed' };
      var sh = ss.getSheetByName(e.tab);
      if (!sh) return { ok: false, error: 'no tab' };
      var r = Number(e.r) + 1;
      var c = Number(e.c !== undefined ? e.c : e.c1) + 1;
      if (!(r >= 1 && c >= 1)) return { ok: false, error: 'bad cell' };
      var cell = sh.getRange(r, c);
      var now = cell.getDisplayValue();
      if (String(e.expect === undefined ? '' : e.expect) !== now) return { ok: false, error: 'changed', now: now };
      if (e.moveAfter !== undefined) return lhMoveRow_(ss, sh, e, r, c, now);
      if (e.strike !== undefined) {
        var c2 = Number(e.c2) + 1;
        if (!(c2 >= c && c2 - c < 12)) return { ok: false, error: 'bad range' };
        var seg = sh.getRange(r, c, 1, c2 - c + 1);
        seg.setFontLine(e.strike ? 'line-through' : 'none');
        lhMoneyLog_(ss, e.tab, seg.getA1Notation(), now, e.strike ? 'crossed out' : 'un-crossed');
        return { ok: true };
      }
      if (cell.getFormula()) return { ok: false, error: 'formula' };
      var value = String(e.value === undefined ? '' : e.value).slice(0, 200);
      if (/^[=+@]/.test(value)) return { ok: false, error: 'no formulas from Life Hub' };
      cell.setValue(value);
      lhMoneyLog_(ss, e.tab, cell.getA1Notation(), now, cell.getDisplayValue());
      return { ok: true, now: cell.getDisplayValue() };
    } catch (err) {
      return { ok: false, error: String(err).slice(0, 120) };
    }
  });
  SpreadsheetApp.flush();
  return { ok: true, results: results, snapshot: lhMoneySnapshot_() };
}

/** One row per change on the "Life Hub edits" tab, so anything can be undone by hand. */
function lhMoneyLog_(ss, tab, a1, before, after) {
  var log = ss.getSheetByName(LH_MONEY.LOG_TAB);
  if (!log) {
    log = ss.insertSheet(LH_MONEY.LOG_TAB);
    log.getRange(1, 1, 1, 5).setValues([['When', 'Tab', 'Cell', 'Before', 'After']]).setFontWeight('bold');
    log.setFrozenRows(1);
  }
  log.appendRow([new Date(), tab, a1, "'" + before, "'" + after]);
}

/**
 * Move one item (row segment c1..c2) to a fresh row inserted right under `moveAfter` — the last row
 * of the list it's going to — so both lists stay together with their blank separators. The old row
 * is deleted when nothing else sits on it; otherwise only its segment is cleared.
 */
function lhMoveRow_(ss, sh, e, r, c, now) {
  var c2 = Number(e.c2) + 1;
  var after = Number(e.moveAfter) + 1;
  if (!(c2 >= c && c2 - c < 12 && after >= 1 && after <= sh.getMaxRows())) return { ok: false, error: 'bad range' };
  if (after === r) return { ok: false, error: 'same place' };
  var width = c2 - c + 1;
  sh.insertRowAfter(after);
  var target = after + 1;
  var from = r > after ? r + 1 : r; // the insert pushed the source down if it was below
  sh.getRange(from, c, 1, width).copyTo(sh.getRange(target, c, 1, width));
  var lastCol = sh.getLastColumn();
  var row = sh.getRange(from, 1, 1, lastCol).getValues()[0];
  var elsewhere = row.some(function (v, i) { return (i + 1 < c || i + 1 > c2) && v !== '' && v !== null; });
  if (elsewhere) sh.getRange(from, c, 1, width).clear();
  else sh.deleteRow(from);
  lhMoneyLog_(ss, e.tab, 'row ' + r + ' → under row ' + after, now, 'moved');
  return { ok: true };
}
