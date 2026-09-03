/**
 * Excel Tools for Google Sheets
 *
 * Paste this entire file over Code.gs (Extensions → Apps Script), Save,
 * reload, then Excel Tools → Enable Focus Cell on this sheet.
 *
 * Why this is faster
 *   Conditional formatting on hundreds of rows cannot stay under ~3s.
 *   Clicks now recolor ONLY the active row + column, then put your
 *   original fills back when you leave. Other tabs are not touched
 *   unless you click them (Enable per sheet). No setBackground(null),
 *   so existing colors are stored and restored, not erased.
 *
 * No top-level var/const — simple triggers cannot see them.
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

function focusColor_() {
  return "#FFF3CD";
}

function focusStateKey_() {
  return "FocusCell_state";
}

function oldHelperSheetName_() {
  return "_FocusCell";
}

function focusRowRangeName_(sheet) {
  return "FocusCell_R_" + sheet.getSheetId();
}

function focusColRangeName_(sheet) {
  return "FocusCell_C_" + sheet.getSheetId();
}

function onSelectionChange(e) {
  try {
    if (!e || !e.range) {
      return;
    }
    var sheet = e.range.getSheet();
    var prev = focusReadState_();
    var sid = String(sheet.getSheetId());
    if (!prev || !prev.on || prev.on[sid] !== 1) {
      return;
    }
    applyFocus_(sheet, e.range.getRow(), e.range.getColumn(), prev);
  } catch (err) {
    // Simple triggers should not throw into the Sheets UI.
  }
}

function enableFocusCell() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getActiveSheet();
  var ui = SpreadsheetApp.getUi();

  deleteOldHelperSheet_(ss);
  removeFocusFormatting_(sheet);
  cleanupOldHelpers_(ss, sheet);

  var prev = focusReadState_() || {};
  if (!prev.on) {
    prev.on = {};
  }
  prev.on[String(sheet.getSheetId())] = 1;
  focusWriteState_(prev);

  applyFocus_(
    sheet,
    sheet.getActiveCell().getRow(),
    sheet.getActiveCell().getColumn(),
    prev
  );

  ui.alert(
    "Focus Cell is on for \"" + sheet.getName() + "\"",
    "Old highlight rules were removed. Clicks now tint only this tab’s active row and column, then restore your original fills.",
    ui.ButtonSet.OK
  );
}

function disableFocusCell() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getActiveSheet();
  var ui = SpreadsheetApp.getUi();

  restoreFocusIfAny_(sheet);
  var prev = focusReadState_() || {};
  if (prev.on) {
    delete prev.on[String(sheet.getSheetId())];
  }
  if (prev.sid === sheet.getSheetId()) {
    prev.rowBg = null;
    prev.colBg = null;
  }
  focusWriteState_(prev);
  removeFocusFormatting_(sheet);

  ui.alert("Focus Cell is off for \"" + sheet.getName() + "\".");
}

function applyFocus_(sheet, row, col, prev) {
  if (!prev) {
    prev = focusReadState_() || {};
  }
  var sid = sheet.getSheetId();

  if (prev.sid === sid && prev.row === row && prev.col === col && prev.rowBg) {
    return;
  }

  if (prev.rowBg && prev.colBg) {
    restoreFocusState_(prev, sheet);
  }

  var lastRow = boundsLastRow_(sheet, prev, sid, row);
  var lastCol = boundsLastCol_(sheet, prev, sid, col);

  var rowRange = sheet.getRange(row, 1, 1, lastCol);
  var colRange = sheet.getRange(1, col, lastRow, 1);
  var rowBg = rowRange.getBackgrounds();
  var colBg = colRange.getBackgrounds();

  sheet
    .getRangeList([rowRange.getA1Notation(), colRange.getA1Notation()])
    .setBackground(focusColor_());

  focusWriteState_({
    on: prev.on || {},
    sid: sid,
    row: row,
    col: col,
    lastRow: lastRow,
    lastCol: lastCol,
    rowBg: rowBg,
    colBg: colBg,
  });
}

function boundsLastRow_(sheet, prev, sid, row) {
  var lastRow =
    prev && prev.sid === sid && prev.lastRow ? prev.lastRow : sheet.getLastRow();
  if (row > lastRow) {
    lastRow = sheet.getLastRow();
  }
  lastRow = Math.max(lastRow, row, 1);
  return Math.min(lastRow, 300);
}

function boundsLastCol_(sheet, prev, sid, col) {
  var lastCol =
    prev && prev.sid === sid && prev.lastCol ? prev.lastCol : sheet.getLastColumn();
  if (col > lastCol) {
    lastCol = sheet.getLastColumn();
  }
  lastCol = Math.max(lastCol, col, 1);
  return Math.min(lastCol, 26);
}

function restoreFocusIfAny_(sheet) {
  var prev = focusReadState_();
  if (!prev || !prev.rowBg) {
    return;
  }
  restoreFocusState_(prev, sheet);
}

function restoreFocusState_(prev, currentSheet) {
  var sheet = currentSheet;
  if (!sheet || sheet.getSheetId() !== prev.sid) {
    sheet = sheetById_(prev.sid);
  }
  if (!sheet) {
    return;
  }
  try {
    sheet.getRange(prev.row, 1, 1, prev.lastCol).setBackgrounds(prev.rowBg);
    sheet.getRange(1, prev.col, prev.lastRow, 1).setBackgrounds(prev.colBg);
  } catch (err) {
    // Sheet size may have changed.
  }
}

function sheetById_(sid) {
  var sheets = SpreadsheetApp.getActiveSpreadsheet().getSheets();
  var i;
  for (i = 0; i < sheets.length; i++) {
    if (sheets[i].getSheetId() === sid) {
      return sheets[i];
    }
  }
  return null;
}

function focusCache_() {
  try {
    var doc = CacheService.getDocumentCache();
    if (doc) {
      return doc;
    }
  } catch (err) {}
  try {
    return CacheService.getScriptCache();
  } catch (err2) {
    return null;
  }
}

function focusReadState_() {
  var raw = null;
  try {
    var cache = focusCache_();
    if (cache) {
      raw = cache.get(focusStateKey_());
    }
  } catch (err) {}
  if (!raw) {
    try {
      raw = PropertiesService.getDocumentProperties().getProperty(
        focusStateKey_()
      );
    } catch (err2) {}
  }
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (err3) {
    return null;
  }
}

function focusWriteState_(state) {
  var raw = state ? JSON.stringify(state) : "";
  var cached = false;
  try {
    var cache = focusCache_();
    if (cache) {
      if (raw) {
        cache.put(focusStateKey_(), raw, 21600);
      } else {
        cache.remove(focusStateKey_());
      }
      cached = true;
    }
  } catch (err) {}
  if (cached) {
    return;
  }
  try {
    var props = PropertiesService.getDocumentProperties();
    if (raw) {
      props.setProperty(focusStateKey_(), raw);
    } else {
      props.deleteProperty(focusStateKey_());
    }
  } catch (err2) {}
}

function cleanupOldHelpers_(ss, sheet) {
  var rowCell = ss.getRangeByName(focusRowRangeName_(sheet));
  if (rowCell) {
    var c = rowCell.getColumn();
    try {
      sheet.getRange(1, c, 1, 2).clearContent().clearNote();
      sheet.showColumns(c, 2);
    } catch (err) {}
  }
  removeNamedRangeIf_(ss, focusRowRangeName_(sheet));
  removeNamedRangeIf_(ss, focusColRangeName_(sheet));
  removeNamedRangeIf_(ss, "FocusCell_Row");
  removeNamedRangeIf_(ss, "FocusCell_Col");
  removeNamedRangeIf_(ss, "FocusCell_Sheet");
}

function removeFocusFormatting_(sheet) {
  var ss = sheet.getParent();
  var rowCell = ss.getRangeByName(focusRowRangeName_(sheet));
  var colCell = ss.getRangeByName(focusColRangeName_(sheet));
  var needles = ["_FocusCell!", "FocusCell_Row", "FocusCell_Sheet"];
  if (rowCell) {
    needles.push(absA1_(rowCell));
  }
  if (colCell) {
    needles.push(absA1_(colCell));
  }

  var rules = sheet.getConditionalFormatRules();
  var kept = [];
  var i;
  var j;
  var drop;
  var formula;
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
    drop = false;
    if (
      formula.indexOf("OR(ROW()=$") !== -1 &&
      formula.indexOf("COLUMN()=$") !== -1
    ) {
      drop = true;
    }
    for (j = 0; j < needles.length; j++) {
      if (needles[j] && formula.indexOf(needles[j]) !== -1) {
        drop = true;
        break;
      }
    }
    if (!drop) {
      kept.push(rules[i]);
    }
  }

  sheet.setConditionalFormatRules(kept);
}

function absA1_(range) {
  var a1 = range.getA1Notation();
  var i = 0;
  while (i < a1.length && a1.charCodeAt(i) >= 65 && a1.charCodeAt(i) <= 90) {
    i++;
  }
  return "$" + a1.substring(0, i) + "$" + a1.substring(i);
}

function deleteOldHelperSheet_(ss) {
  var focus = ss.getSheetByName(oldHelperSheetName_());
  if (!focus) {
    return;
  }
  if (ss.getSheets().length < 2) {
    return;
  }
  ss.deleteSheet(focus);
}

function removeNamedRangeIf_(ss, name) {
  try {
    if (ss.getRangeByName(name)) {
      ss.removeNamedRange(name);
    }
  } catch (err) {}
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
  var row;
  var i;

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
      "\"!\n\n" +
      "Moved: " +
      moved +
      "\n" +
      "Skipped because destination already had text: " +
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
  for (var i = 0; i < letter.length; i++) {
    column = column * 26 + letter.charCodeAt(i) - 64;
  }
  return column;
}
