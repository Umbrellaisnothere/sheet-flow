/**
 * Excel Tools for Google Sheets
 *
 * Paste over Code.gs, Save, reload, then:
 * Excel Tools → Enable Focus Cell on this sheet
 *
 * Clicks write TWO hidden cells on this tab only. Highlight is a small
 * conditional-format overlay (your fills are never overwritten). Other
 * tabs are untouched until you Enable them.
 *
 * The 8s paint version is gone. Do not keep any old script.
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
    var helperCol = helperCol_(String(sheet.getSheetId()));
    if (!helperCol) {
      return;
    }
    sheet
      .getRange(1, helperCol, 1, 2)
      .setValues([[e.range.getRow(), e.range.getColumn()]]);
  } catch (err) {}
}

function enableFocusCell() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getActiveSheet();
  var ui = SpreadsheetApp.getUi();

  undoPaintIfAny_(sheet);
  stripOldFocusRules_(sheet);
  deleteSheetNamed_(ss, "_FocusCell");

  var helper = ensureHelpers_(ss, sheet);
  var helperCol = helper.getColumn();
  rememberHelperCol_(sheet, helperCol);
  stripOldFocusRules_(sheet);
  addFocusRule_(sheet, helper);

  helper.setValues([
    [sheet.getActiveCell().getRow(), sheet.getActiveCell().getColumn()],
  ]);

  ui.alert(
    "Focus Cell is on for \"" + sheet.getName() + "\"",
    "Each click now writes two hidden cells. Highlight covers this tab’s data block (up to 80 rows × 12 columns) so it stays fast. Run Enable again if you add a large new block of rows.",
    ui.ButtonSet.OK
  );
}

function disableFocusCell() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getActiveSheet();
  undoPaintIfAny_(sheet);
  stripOldFocusRules_(sheet);
  forgetHelperCol_(sheet);
  SpreadsheetApp.getUi().alert(
    "Focus Cell is off for \"" + sheet.getName() + "\"."
  );
}

function helperColKey_(sid) {
  return "FC_c_" + sid;
}

function helperCol_(sid) {
  var key = helperColKey_(sid);
  var hit = null;
  try {
    hit = CacheService.getScriptCache().get(key);
  } catch (err) {}
  if (hit) {
    return Number(hit);
  }
  try {
    hit = PropertiesService.getDocumentProperties().getProperty(key);
  } catch (err2) {
    return 0;
  }
  if (!hit) {
    return 0;
  }
  try {
    CacheService.getScriptCache().put(key, hit, 21600);
  } catch (err3) {}
  return Number(hit);
}

function rememberHelperCol_(sheet, col) {
  var key = helperColKey_(String(sheet.getSheetId()));
  var val = String(col);
  try {
    CacheService.getScriptCache().put(key, val, 21600);
  } catch (err) {}
  try {
    PropertiesService.getDocumentProperties().setProperty(key, val);
  } catch (err2) {}
}

function forgetHelperCol_(sheet) {
  var key = helperColKey_(String(sheet.getSheetId()));
  try {
    CacheService.getScriptCache().remove(key);
  } catch (err) {}
  try {
    PropertiesService.getDocumentProperties().deleteProperty(key);
  } catch (err2) {}
}

function ensureHelpers_(ss, sheet) {
  var existing = ss.getRangeByName("FocusCell_R_" + sheet.getSheetId());
  if (existing) {
    return sheet.getRange(existing.getRow(), existing.getColumn(), 1, 2);
  }
  var col = sheet.getLastColumn() + 1;
  if (col < 2) {
    col = 2;
  }
  var helper = sheet.getRange(1, col, 1, 2);
  helper.setValues([[1, 1]]);
  try {
    sheet.hideColumns(col, 2);
  } catch (err) {}
  ss.setNamedRange("FocusCell_R_" + sheet.getSheetId(), sheet.getRange(1, col));
  ss.setNamedRange("FocusCell_C_" + sheet.getSheetId(), sheet.getRange(1, col + 1));
  return helper;
}

function addFocusRule_(sheet, helper) {
  var rowA1 = absA1_(helper.offset(0, 0, 1, 1));
  var colA1 = absA1_(helper.offset(0, 1, 1, 1));
  var helperCol = helper.getColumn();
  var rows = Math.min(Math.max(sheet.getLastRow(), 1), 80, sheet.getMaxRows());
  var cols = Math.min(Math.max(helperCol - 1, 1), 12, sheet.getMaxColumns());
  var range = sheet.getRange(1, 1, rows, cols);
  var formula = "=OR(ROW()=" + rowA1 + ",COLUMN()=" + colA1 + ")";
  var rule = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied(formula)
    .setBackground("#FFF3CD")
    .setRanges([range])
    .build();
  var rules = sheet.getConditionalFormatRules();
  rules.push(rule);
  sheet.setConditionalFormatRules(rules);
}

function stripOldFocusRules_(sheet) {
  var ss = sheet.getParent();
  var rowCell = ss.getRangeByName("FocusCell_R_" + sheet.getSheetId());
  var colCell = ss.getRangeByName("FocusCell_C_" + sheet.getSheetId());
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
  sheet.setConditionalFormatRules(kept);
}

function undoPaintIfAny_(sheet) {
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

function absA1_(range) {
  var a1 = range.getA1Notation();
  var i = 0;
  while (i < a1.length && a1.charCodeAt(i) >= 65 && a1.charCodeAt(i) <= 90) {
    i++;
  }
  return "$" + a1.substring(0, i) + "$" + a1.substring(i);
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
