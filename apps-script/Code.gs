/**
 * Excel Tools for Google Sheets
 *
 * Paste over Code.gs, Save, reload, then:
 * Excel Tools → Enable Focus Cell on this sheet
 *
 * Read this before blaming the code for the delay.
 *
 * onSelectionChange is a server-side simple trigger. Every click travels to
 * Google, starts a script container, changes the document, and comes back.
 * That round trip is the delay. Google also drops selection events that land
 * within two seconds of each other, so fast clicking makes it look worse. No
 * version of this file can beat that floor.
 *
 * This version does the least work that is possible on the server: it moves
 * one conditional-format rule onto the selected rows and columns. It writes no
 * cell values, so nothing recalculates, and it reads no backgrounds, so your
 * fills are never touched or overwritten. Expect roughly 1-3 seconds.
 *
 * For an instant crosshair, use the browser userscript in this project
 * instead. It draws over the grid on the same frame as the click and never
 * contacts a server. Keep this file for Move Visible Records either way.
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
    var sheet = e.range.getSheet();
    if (!isFocusOn_(String(sheet.getSheetId()))) {
      return;
    }
    moveFocusRule_(sheet, e.range);
  } catch (err) {}
}

function focusColor_() {
  return "#FFF3CD";
}

/**
 * Always true, and recognizable when reading rules back. A constant has no
 * cell references, so Sheets never recalculates anything to evaluate it.
 */
function focusFormula_() {
  return '="focuscell"="focuscell"';
}

function moveFocusRule_(sheet, selection) {
  var firstRow = selection.getRow();
  var firstCol = selection.getColumn();
  var lastRow = firstRow + selection.getNumRows() - 1;
  var lastCol = firstCol + selection.getNumColumns() - 1;

  // Open-ended A1 ranges cover the full row and column without asking the
  // sheet how big it is, and they keep working when rows are added later.
  var rows = sheet.getRange(firstRow + ":" + lastRow);
  var cols = sheet.getRange(
    columnNumberToLetter_(firstCol) + ":" + columnNumberToLetter_(lastCol)
  );

  var rule = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied(focusFormula_())
    .setBackground(focusColor_())
    .setRanges([rows, cols])
    .build();

  var rules = rulesWithoutFocus_(sheet);
  // First, so the crosshair stays visible over the user's own colour rules.
  rules.unshift(rule);
  sheet.setConditionalFormatRules(rules);
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
    cleanupLegacyHelpers_(ss, sheet);
  } catch (err3) {}
  try {
    deleteSheetNamed_(ss, "_FocusCell");
  } catch (err4) {}
  rememberFocusOn_(sid, true);
  try {
    moveFocusRule_(sheet, sheet.getActiveRange() || sheet.getRange(1, 1));
  } catch (err5) {}
  ui.alert(
    "Focus Cell is on for \"" + sheet.getName() + "\"",
    "The highlight is now one conditional-format rule that moves with your selection. No cell values are written, so the sheet does not recalculate, and your fill colours are never overwritten.\n\nThis still waits on Google's onSelectionChange trigger, which takes a second or two per click and cannot be made instant. For a crosshair with no delay at all, install the browser userscript from this project and turn this off.",
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
    sheet.setConditionalFormatRules(rulesWithoutFocus_(sheet));
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
  try {
    CacheService.getScriptCache().put(key, on ? "1" : "0", 21600);
  } catch (err) {}
  try {
    var props = PropertiesService.getDocumentProperties();
    if (on) {
      props.setProperty(key, "1");
    } else {
      props.deleteProperty(key);
    }
  } catch (err2) {}
}

/** Every rule on the sheet except ours, in their original order. */
function rulesWithoutFocus_(sheet) {
  var needles = [
    "focuscell",
    "_FocusCell!",
    "FocusCell_Row",
    "FocusCell_Sheet",
    "FocusCell_R_",
    "FocusCell_C_",
  ];
  var rules = sheet.getConditionalFormatRules();
  var kept = [];
  var i;
  var j;
  var condition;
  var values;
  var formula;
  var drop;
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
      if (formula.indexOf(needles[j]) !== -1) {
        drop = true;
      }
    }
    if (!drop) {
      kept.push(rules[i]);
    }
  }
  return kept;
}

/** Undo the version that painted a colour window around the selection. */
function restoreWindow_(sheet, sid) {
  var raw = null;
  try {
    raw = CacheService.getScriptCache().get(windowKey_(sid));
  } catch (err) {}
  if (!raw) {
    return;
  }
  try {
    var prev = JSON.parse(raw);
    if (prev && prev.h && prev.v && prev.hBg && prev.vBg) {
      sheet.getRange(prev.h.r, prev.h.c, 1, prev.h.n).setBackgrounds(prev.hBg);
      sheet.getRange(prev.v.r, prev.v.c, prev.v.n, 1).setBackgrounds(prev.vBg);
    }
  } catch (err2) {}
  try {
    CacheService.getScriptCache().remove(windowKey_(sid));
  } catch (err3) {}
}

/** Undo the version that painted whole rows and columns. */
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

/** Unhide and forget the hidden helper columns the recalculating version added. */
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
  } catch (err2) {}
  if (helperCol) {
    try {
      sheet.showColumns(Number(helperCol), 2);
    } catch (err3) {}
    try {
      PropertiesService.getDocumentProperties().deleteProperty("FC_c_" + sid);
    } catch (err4) {}
    try {
      CacheService.getScriptCache().remove("FC_c_" + sid);
    } catch (err5) {}
  }
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
  if (destinationColumn > sheet.getMaxColumns()) {
    ui.alert(
      "Column " +
        destinationLetter +
        " does not exist on this sheet. Add columns first, or pick one that does."
    );
    return;
  }

  // Selecting a whole column hands back every row the sheet has, which can be
  // tens of thousands. Nothing past the last row of data can move anyway.
  var lastRow = sheet.getLastRow();
  if (startRow + numRows - 1 > lastRow) {
    numRows = Math.max(lastRow - startRow + 1, 1);
  }

  var sourceValues = sourceRange.offset(0, 0, numRows, 1).getValues();
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
    // isRowHiddenByFilter is one call per row, so ask only about rows that
    // have something to move. Blank rows are skipped either way.
    if (isBlank_(sourceValues[i][0])) {
      continue;
    }
    if (filter && sheet.isRowHiddenByFilter(row)) {
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
    sourceRange.offset(0, 0, numRows, 1).setValues(nextSource);
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

function columnNumberToLetter_(column) {
  var letter = "";
  var n = column;
  var rem;
  while (n > 0) {
    rem = (n - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    n = Math.floor((n - 1) / 26);
  }
  return letter;
}
