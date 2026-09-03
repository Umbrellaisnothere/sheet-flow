/**
 * Excel Tools for Google Sheets
 *
 * Paste over Code.gs, Save, reload, then:
 * Excel Tools → Enable Focus Cell on this sheet
 *
 * Clicks never write cell values. They only tint a small color window
 * around the selection (your fills are saved and put back). Other tabs
 * stay untouched until you Enable them.
 *
 * Replace the whole file. Old helper-cell / conditional-format versions
 * force the sheet to recalculate and can take ~9 seconds per click.
 */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Excel Tools")
    .addItem("Enable Focus Cell on this sheet", "enableFocusCell")
    .addItem("Disable Focus Cell on this sheet", "disableFocusCell")
    .addSeparator()
    .addItem("Move Visible Records…", "moveVisibleRecords")
    .addToUi();
}

function onSelectionChange(e) {
  try {
    if (!e || !e.range) {
      return;
    }
    var range = e.range;
    var sheet = range.getSheet();
    var sid = String(sheet.getSheetId());
    if (!isFocusOn_(sid)) {
      return;
    }
    paintWindow_(sheet, sid, range.getRow(), range.getColumn());
  } catch (err) {}
}

function enableFocusCell() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getActiveSheet();
  var sid = String(sheet.getSheetId());
  var ui = SpreadsheetApp.getUi();
  try {
    restoreLegacyPaint_(sheet);
  } catch (err) {}
  try {
    restoreWindow_(sheet, sid);
  } catch (err2) {}
  try {
    stripOldFocusRules_(sheet);
  } catch (err3) {}
  try {
    cleanupLegacyHelpers_(ss, sheet);
  } catch (err4) {}
  try {
    deleteSheetNamed_(ss, "_FocusCell");
  } catch (err5) {}
  rememberFocusOn_(sid, true);
  try {
    paintWindow_(
      sheet,
      sid,
      sheet.getActiveCell().getRow(),
      sheet.getActiveCell().getColumn()
    );
  } catch (err6) {}
  ui.alert(
    "Focus Cell is on for \"" + sheet.getName() + "\"",
    "Clicks now only tint a small color window around the cell you selected. They do not write values, so the sheet does not recalculate. Other tabs are unchanged. Run Enable again on this tab if an old highlight is still sitting around.",
    ui.ButtonSet.OK
  );
}

function disableFocusCell() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getActiveSheet();
  var sid = String(sheet.getSheetId());
  try {
    restoreLegacyPaint_(sheet);
  } catch (err) {}
  try {
    restoreWindow_(sheet, sid);
  } catch (err2) {}
  try {
    stripOldFocusRules_(sheet);
  } catch (err3) {}
  try {
    cleanupLegacyHelpers_(ss, sheet);
  } catch (err4) {}
  rememberFocusOn_(sid, false);
  SpreadsheetApp.getUi().alert(
    "Focus Cell is off for \"" + sheet.getName() + "\"."
  );
}

function focusOnKey_(sid) {
  return "FC_on_" + sid;
}

function windowKey_(sid) {
  return "FC_w_" + sid;
}

function isFocusOn_(sid) {
  var key = focusOnKey_(sid);
  var hit = null;
  try {
    hit = CacheService.getScriptCache().get(key);
  } catch (err) {}
  if (hit === "1") {
    return true;
  }
  if (hit === "0") {
    return false;
  }
  try {
    hit = PropertiesService.getDocumentProperties().getProperty(key);
  } catch (err2) {
    return false;
  }
  if (hit === "1") {
    try {
      CacheService.getScriptCache().put(key, "1", 21600);
    } catch (err3) {}
    return true;
  }
  try {
    CacheService.getScriptCache().put(key, "0", 600);
  } catch (err4) {}
  return false;
}

function rememberFocusOn_(sid, on) {
  var key = focusOnKey_(sid);
  var val = on ? "1" : "0";
  try {
    CacheService.getScriptCache().put(key, val, 21600);
  } catch (err) {}
  try {
    var props = PropertiesService.getDocumentProperties();
    if (on) {
      props.setProperty(key, "1");
    } else {
      props.deleteProperty(key);
    }
  } catch (err2) {}
  if (!on) {
    try {
      CacheService.getScriptCache().remove(windowKey_(sid));
    } catch (err3) {}
  }
}

function readWindow_(sid) {
  var raw = null;
  try {
    raw = CacheService.getScriptCache().get(windowKey_(sid));
  } catch (err) {}
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (err2) {
    return null;
  }
}

function writeWindow_(sid, state) {
  try {
    CacheService.getScriptCache().put(
      windowKey_(sid),
      JSON.stringify(state),
      21600
    );
  } catch (err) {}
}

function paintWindow_(sheet, sid, row, col) {
  var prev = readWindow_(sid);
  if (prev && prev.r === row && prev.c === col) {
    return;
  }

  var maxR = sheet.getMaxRows();
  var maxC = sheet.getMaxColumns();
  var h = horizBand_(row, col, maxC);
  var v = vertBand_(row, col, maxR);
  var hRange = sheet.getRange(h.r, h.c, 1, h.n);
  var vRange = sheet.getRange(v.r, v.c, v.n, 1);
  var hBg = hRange.getBackgrounds();
  var vBg = vRange.getBackgrounds();
  if (prev) {
    stampOriginals_(hBg, h, true, prev);
    stampOriginals_(vBg, v, false, prev);
    applyRestore_(sheet, prev);
  }
  hRange.setBackground("#FFF3CD");
  vRange.setBackground("#FFF3CD");
  writeWindow_(sid, {
    r: row,
    c: col,
    h: h,
    v: v,
    hBg: hBg,
    vBg: vBg,
  });
}

function restoreWindow_(sheet, sid) {
  applyRestore_(sheet, readWindow_(sid));
  try {
    CacheService.getScriptCache().remove(windowKey_(sid));
  } catch (err) {}
}

function applyRestore_(sheet, prev) {
  if (!prev || !prev.h || !prev.v || !prev.hBg || !prev.vBg) {
    return;
  }
  try {
    sheet.getRange(prev.h.r, prev.h.c, 1, prev.h.n).setBackgrounds(prev.hBg);
    sheet.getRange(prev.v.r, prev.v.c, prev.v.n, 1).setBackgrounds(prev.vBg);
  } catch (err) {}
}

function stampOriginals_(bg, band, isRow, prev) {
  var i;
  var orig;
  for (i = 0; i < band.n; i++) {
    orig = isRow
      ? originalColor_(prev, band.r, band.c + i)
      : originalColor_(prev, band.r + i, band.c);
    if (orig) {
      if (isRow) {
        bg[0][i] = orig;
      } else {
        bg[i][0] = orig;
      }
    }
  }
}

function originalColor_(prev, row, col) {
  if (
    prev.h &&
    row === prev.h.r &&
    col >= prev.h.c &&
    col < prev.h.c + prev.h.n &&
    prev.hBg &&
    prev.hBg[0]
  ) {
    return prev.hBg[0][col - prev.h.c];
  }
  if (
    prev.v &&
    col === prev.v.c &&
    row >= prev.v.r &&
    row < prev.v.r + prev.v.n &&
    prev.vBg &&
    prev.vBg[row - prev.v.r]
  ) {
    return prev.vBg[row - prev.v.r][0];
  }
  return null;
}

function horizBand_(row, col, maxC) {
  var n = 20;
  var start = col - 10;
  if (start < 1) {
    start = 1;
  }
  if (start + n - 1 > maxC) {
    n = maxC - start + 1;
  }
  if (n < 1) {
    n = 1;
  }
  return { r: row, c: start, n: n };
}

function vertBand_(row, col, maxR) {
  var n = 40;
  var start = row - 20;
  if (start < 1) {
    start = 1;
  }
  if (start + n - 1 > maxR) {
    n = maxR - start + 1;
  }
  if (n < 1) {
    n = 1;
  }
  return { r: start, c: col, n: n };
}

function cleanupLegacyHelpers_(ss, sheet) {
  var sid = String(sheet.getSheetId());
  var ranges = [];
  var i;
  var name;
  var range;
  try {
    ranges = ss.getNamedRanges();
  } catch (err) {}
  for (i = 0; i < ranges.length; i++) {
    try {
      name = ranges[i].getName();
    } catch (errName) {
      continue;
    }
    if (
      name.indexOf("FocusCell_R_") !== 0 &&
      name.indexOf("FocusCell_C_") !== 0
    ) {
      continue;
    }
    try {
      range = ranges[i].getRange();
      if (range && range.getSheet().getSheetId() === sheet.getSheetId()) {
        sheet.showColumns(range.getColumn(), 1);
      }
    } catch (errShow) {}
    try {
      ranges[i].remove();
    } catch (errRemove) {}
  }
  var helperCol = null;
  try {
    helperCol = PropertiesService.getDocumentProperties().getProperty(
      "FC_c_" + sid
    );
  } catch (err4) {}
  if (helperCol) {
    try {
      sheet.showColumns(Number(helperCol), 2);
    } catch (err5) {}
    try {
      PropertiesService.getDocumentProperties().deleteProperty("FC_c_" + sid);
    } catch (err6) {}
    try {
      CacheService.getScriptCache().remove("FC_c_" + sid);
    } catch (err7) {}
  }
}

function stripOldFocusRules_(sheet) {
  var needles = [
    "_FocusCell!",
    "FocusCell_Row",
    "FocusCell_Sheet",
    "FocusCell_R_",
    "FocusCell_C_",
  ];
  var rules = sheet.getConditionalFormatRules();
  var kept = [];
  var i;
  var formula;
  var drop;
  var j;
  var condition;
  var values;
  for (i = 0; i < rules.length; i++) {
    condition = rules[i].getBooleanCondition();
    if (!condition) {
      kept.push(rules[i]);
      continue;
    }
    values = condition.getCriteriaValues();
    formula = values && values.length ? String(values[0]) : "";
    drop =
      formula.indexOf("OR(ROW()=$") !== -1 &&
      formula.indexOf("COLUMN()=$") !== -1;
    for (j = 0; j < needles.length; j++) {
      if (needles[j] && formula.indexOf(needles[j]) !== -1) {
        drop = true;
      }
    }
    if (!drop) {
      kept.push(rules[i]);
    }
  }
  if (kept.length !== rules.length) {
    sheet.setConditionalFormatRules(kept);
  }
}

function restoreLegacyPaint_(sheet) {
  var raw = null;
  try {
    raw = CacheService.getScriptCache().get("FocusCell_state");
  } catch (err) {}
  if (!raw) {
    try {
      raw = PropertiesService.getDocumentProperties().getProperty(
        "FocusCell_state"
      );
    } catch (err2) {}
  }
  if (!raw) {
    return;
  }
  try {
    var prev = JSON.parse(raw);
    if (prev && prev.rowBg && prev.colBg && prev.sid === sheet.getSheetId()) {
      sheet.getRange(prev.row, 1, 1, prev.lastCol).setBackgrounds(prev.rowBg);
      sheet.getRange(1, prev.col, prev.lastRow, 1).setBackgrounds(prev.colBg);
    }
  } catch (err3) {}
  try {
    CacheService.getScriptCache().remove("FocusCell_state");
  } catch (err4) {}
  try {
    PropertiesService.getDocumentProperties().deleteProperty("FocusCell_state");
  } catch (err5) {}
}

function deleteSheetNamed_(ss, name) {
  var sh = ss.getSheetByName(name);
  if (!sh || ss.getSheets().length < 2) {
    return;
  }
  ss.deleteSheet(sh);
}

function moveVisibleRecords() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var sourceRange = sheet.getActiveRange();
  var ui = SpreadsheetApp.getUi();

  if (!sourceRange) {
    ui.alert("Select the source records first.");
    return;
  }
  if (sourceRange.getNumColumns() !== 1) {
    ui.alert("Please select records from only one column.");
    return;
  }

  var sourceColumn = sourceRange.getColumn();
  var startRow = sourceRange.getRow();
  var numRows = sourceRange.getNumRows();
  var response = ui.prompt(
    "Move Visible Records",
    "Enter the destination column on this sheet (e.g. B, C, D):",
    ui.ButtonSet.OK_CANCEL
  );
  if (response.getSelectedButton() !== ui.Button.OK) {
    return;
  }

  var destinationLetter = String(response.getResponseText() || "")
    .trim()
    .toUpperCase();
  var destinationColumn = columnLetterToNumber(destinationLetter);
  if (!destinationColumn) {
    ui.alert("Invalid column. Please enter a column such as B, C, or D.");
    return;
  }
  if (destinationColumn === sourceColumn) {
    ui.alert("Destination must be a different column than the source.");
    return;
  }

  var sourceValues = sourceRange.getValues();
  var destinationRange = sheet.getRange(
    startRow,
    destinationColumn,
    numRows,
    1
  );
  var destinationValues = destinationRange.getValues();
  var nextSource = [];
  var nextDest = [];
  var moved = 0;
  var skipped = 0;
  var filter = sheet.getFilter();
  var i;
  var row;

  for (i = 0; i < numRows; i++) {
    nextSource[i] = [sourceValues[i][0]];
    nextDest[i] = [destinationValues[i][0]];
    row = startRow + i;
    if (filter && sheet.isRowHiddenByFilter(row)) {
      continue;
    }
    if (isBlank_(sourceValues[i][0])) {
      continue;
    }
    if (!isBlank_(destinationValues[i][0])) {
      skipped++;
      continue;
    }
    nextDest[i][0] = sourceValues[i][0];
    nextSource[i][0] = "";
    moved++;
  }

  if (moved > 0) {
    destinationRange.setValues(nextDest);
    sourceRange.setValues(nextSource);
  }
  sheet.setActiveRange(destinationRange);
  ui.alert(
    "Finished on \"" +
      sheet.getName() +
      "\"!\n\nMoved: " +
      moved +
      "\nSkipped because destination already had text: " +
      skipped
  );
}

function isBlank_(value) {
  if (value === null || value === undefined) {
    return true;
  }
  if (typeof value === "number") {
    return false;
  }
  return String(value).trim() === "";
}

function columnLetterToNumber(letter) {
  if (!letter || !/^[A-Z]+$/.test(letter)) {
    return 0;
  }
  var column = 0;
  var i;
  for (i = 0; i < letter.length; i++) {
    column = column * 26 + letter.charCodeAt(i) - 64;
  }
  return column;
}
