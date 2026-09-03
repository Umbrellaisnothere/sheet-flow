/**
 * Excel Tools for Google Sheets
 *
 * Paste this entire file into the Apps Script project ATTACHED to your
 * spreadsheet (Extensions → Apps Script). Replace Code.gs in full.
 *
 * Sheets conditional formatting cannot reference another tab (that was
 * "Conditional format rule cannot reference a different sheet"). Helper
 * cells live on THIS worksheet, two hidden columns past the data. Clicks
 * only write those two cells. Enable installs the rule once.
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

function focusRowRangeName_(sheet) {
  return "FocusCell_R_" + sheet.getSheetId();
}

function focusColRangeName_(sheet) {
  return "FocusCell_C_" + sheet.getSheetId();
}

function oldHelperSheetName_() {
  return "_FocusCell";
}

/**
 * Click handler. Looks up this sheet’s helper cells and writes row + col.
 * No formatting, no other tabs.
 */
function onSelectionChange(e) {
  try {
    if (!e || !e.range) {
      return;
    }

    var sheet = e.range.getSheet();
    var ss = e.source;
    if (!ss) {
      return;
    }

    var rowCell = ss.getRangeByName(focusRowRangeName_(sheet));
    if (!rowCell) {
      return;
    }

    sheet
      .getRange(rowCell.getRow(), rowCell.getColumn(), 1, 2)
      .setValues([[e.range.getRow(), e.range.getColumn()]]);
  } catch (err) {
    // Simple triggers should not throw into the Sheets UI.
  }
}

function enableFocusCell() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getActiveSheet();
  var ui = SpreadsheetApp.getUi();

  if (sheet.getName() === oldHelperSheetName_()) {
    ui.alert("Switch to your data worksheet, then enable Focus Cell again.");
    return;
  }

  deleteOldHelperSheet_(ss);
  removeNamedRangeIf_(ss, "FocusCell_Row");
  removeNamedRangeIf_(ss, "FocusCell_Col");
  removeNamedRangeIf_(ss, "FocusCell_Sheet");

  var helper = ensureHelperOnSheet_(ss, sheet);
  installFocusFormatting_(sheet, helper);
  helper.setValues([
    [sheet.getActiveCell().getRow(), sheet.getActiveCell().getColumn()],
  ]);

  ui.alert(
    "Focus Cell is on for \"" + sheet.getName() + "\"",
    "The highlight rule only reads two hidden cells on this same sheet, which Sheets allows.\n\n" +
      "If you unhide columns, leave the last two (focus helpers) hidden.",
    ui.ButtonSet.OK
  );
}

function disableFocusCell() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getActiveSheet();
  var ui = SpreadsheetApp.getUi();

  if (sheet.getName() === oldHelperSheetName_()) {
    ui.alert("Switch to your data worksheet, then disable Focus Cell again.");
    return;
  }

  removeFocusFormatting_(sheet);
  ui.alert("Focus Cell is off for \"" + sheet.getName() + "\".");
}

function ensureHelperOnSheet_(ss, sheet) {
  var existing = ss.getRangeByName(focusRowRangeName_(sheet));
  var colExisting = ss.getRangeByName(focusColRangeName_(sheet));
  if (existing && colExisting) {
    return sheet.getRange(existing.getRow(), existing.getColumn(), 1, 2);
  }

  var col = sheet.getLastColumn() + 1;
  if (col < 2) {
    col = 2;
  }

  var helper = sheet.getRange(1, col, 1, 2);
  helper.setValues([[1, 1]]);
  sheet.getRange(1, col).setNote("Focus Cell row helper. Keep this column hidden.");
  sheet.getRange(1, col + 1).setNote("Focus Cell column helper. Keep this column hidden.");
  sheet.hideColumns(col, 2);

  ss.setNamedRange(focusRowRangeName_(sheet), sheet.getRange(1, col));
  ss.setNamedRange(focusColRangeName_(sheet), sheet.getRange(1, col + 1));

  return helper;
}

function focusDataRange_(sheet, helper) {
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  var helperCol = helper.getColumn();
  var rows = Math.min(Math.max(lastRow + 20, 30), 800, sheet.getMaxRows());
  var cols = Math.min(Math.max(helperCol - 1, lastCol, 1), 26, sheet.getMaxColumns());
  if (cols < 1) {
    cols = 1;
  }
  return sheet.getRange(1, 1, rows, cols);
}

function installFocusFormatting_(sheet, helper) {
  removeFocusFormatting_(sheet);

  var rowA1 = absA1_(helper.offset(0, 0, 1, 1));
  var colA1 = absA1_(helper.offset(0, 1, 1, 1));
  var formula = "=OR(ROW()=" + rowA1 + ",COLUMN()=" + colA1 + ")";
  var range = focusDataRange_(sheet, helper);

  var rule = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied(formula)
    .setBackground("#FFF3CD")
    .setRanges([range])
    .build();

  var rules = sheet.getConditionalFormatRules();
  rules.push(rule);
  sheet.setConditionalFormatRules(rules);
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
  } catch (err) {
    // Already gone.
  }
}

/**
 * Move visible values on the ACTIVE worksheet.
 * Two reads, two writes. No per-row setValue.
 */
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

  var helper = SpreadsheetApp.getActiveSpreadsheet().getRangeByName(
    focusRowRangeName_(sheet)
  );
  if (helper && destinationColumn === helper.getColumn()) {
    ui.alert("That column is the hidden Focus Cell helper. Pick another column.");
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
