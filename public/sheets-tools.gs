/**
 * Excel Tools for Google Sheets
 *
 * Paste this entire file into the Apps Script project ATTACHED to your
 * spreadsheet (Extensions → Apps Script). Do not run it as a standalone
 * project. It only touches the worksheet you are on.
 *
 * Why there are no global var/const values
 *   Simple triggers (onSelectionChange, onOpen) often cannot see top-level
 *   variables and throw: ReferenceError: FOCUS_SHEET_NAME is not defined.
 *   Function declarations are visible. Constants live inside functions.
 *
 * 1. Focus Cell — overlay highlight via conditional formatting on THIS
 *    sheet. A hidden helper tab stores the active row/column (formatting
 *    cannot read PropertiesService). Your data cells are never painted.
 *
 * 2. Move Visible Records — batched move of filtered-in values on THIS
 *    sheet, without overwriting destination cells.
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

function focusHelperName_() {
  return "_FocusCell";
}

function focusRuleMarker_() {
  return "_FocusCell!";
}

/**
 * Fires when you click or arrow to a cell on the current worksheet.
 * Safe to run as a simple trigger: no globals, no UI, no extra services.
 */
function onSelectionChange(e) {
  try {
    if (!e || !e.range) {
      return;
    }

    var sheet = e.range.getSheet();
    var helperName = focusHelperName_();
    if (sheet.getName() === helperName) {
      return;
    }

    var ss = e.source ? e.source : SpreadsheetApp.getActiveSpreadsheet();
    var focus = ensureFocusHelper_(ss, sheet);
    if (!focus) {
      return;
    }

    var name = sheet.getName();
    var prev = focus.getRange(1, 1, 1, 3).getValues()[0];
    if (String(prev[2]) !== name) {
      installFocusFormatting_(sheet);
    }

    var row = e.range.getRow();
    var col = e.range.getColumn();
    if (prev[0] === row && prev[1] === col && String(prev[2]) === name) {
      return;
    }

    focus.getRange(1, 1, 1, 3).setValues([[row, col, name]]);
  } catch (err) {
    // Simple triggers should not throw into the Sheets UI.
  }
}

function enableFocusCell() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getActiveSheet();
  var ui = SpreadsheetApp.getUi();

  if (sheet.getName() === focusHelperName_()) {
    ui.alert("Switch to your data worksheet, then enable Focus Cell again.");
    return;
  }

  var focus = ensureFocusHelper_(ss, sheet);
  if (!focus) {
    ui.alert("Could not create the hidden helper tab. Try reloading the spreadsheet.");
    return;
  }

  installFocusFormatting_(sheet);
  focus
    .getRange(1, 1, 1, 3)
    .setValues([[sheet.getActiveCell().getRow(), sheet.getActiveCell().getColumn(), sheet.getName()]]);
  ss.setActiveSheet(sheet);

  ui.alert(
    "Focus Cell is on for \"" +
      sheet.getName() +
      "\"",
    "Click any cell on this worksheet. The current row and column highlight like Excel.\n\n" +
      "The previous highlight clears on its own. Other sheets are left alone until you click them.",
    ui.ButtonSet.OK
  );
}

function disableFocusCell() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getActiveSheet();
  var ui = SpreadsheetApp.getUi();

  if (sheet.getName() === focusHelperName_()) {
    ui.alert("Switch to your data worksheet, then disable Focus Cell again.");
    return;
  }

  removeFocusFormatting_(sheet);
  ui.alert("Focus Cell is off for \"" + sheet.getName() + "\".");
}

function ensureFocusHelper_(ss, dataSheet) {
  var helperName = focusHelperName_();
  var focus = ss.getSheetByName(helperName);
  if (focus) {
    return focus;
  }

  var current = dataSheet ? dataSheet : ss.getActiveSheet();
  focus = ss.insertSheet(helperName);
  focus.getRange("A1:C1").setValues([[1, 1, current.getName()]]);
  focus.getRange("A2:C2").setValues([["row", "column", "sheet"]]);
  focus.hideSheet();
  ss.setActiveSheet(current);
  return focus;
}

function installFocusFormatting_(sheet) {
  removeFocusFormatting_(sheet);

  var helperName = focusHelperName_();
  var rows = Math.min(sheet.getMaxRows(), 2000);
  var cols = Math.min(sheet.getMaxColumns(), 40);
  var range = sheet.getRange(1, 1, rows, cols);
  var quotedName = quoteFormulaString_(sheet.getName());
  var rowRef = 'INDIRECT("' + helperName + '!$A$1")';
  var colRef = 'INDIRECT("' + helperName + '!$B$1")';
  var sheetRef = 'INDIRECT("' + helperName + '!$C$1")';

  var rowFormula =
    "=AND(ROW()=" + rowRef + "," + sheetRef + "=" + quotedName + ")";
  var colFormula =
    "=AND(COLUMN()=" + colRef + "," + sheetRef + "=" + quotedName + ")";

  var colRule = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied(colFormula)
    .setBackground("#E8F5EE")
    .setRanges([range])
    .build();

  var rowRule = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied(rowFormula)
    .setBackground("#FFF3CD")
    .setRanges([range])
    .build();

  var rules = sheet.getConditionalFormatRules();
  rules.push(colRule, rowRule);
  sheet.setConditionalFormatRules(rules);
}

function removeFocusFormatting_(sheet) {
  var rules = sheet.getConditionalFormatRules();
  var marker = focusRuleMarker_();
  var kept = [];

  for (var i = 0; i < rules.length; i++) {
    var condition = rules[i].getBooleanCondition();
    if (!condition) {
      kept.push(rules[i]);
      continue;
    }
    var values = condition.getCriteriaValues();
    var formula = values && values.length ? String(values[0]) : "";
    if (formula.indexOf(marker) === -1) {
      kept.push(rules[i]);
    }
  }

  sheet.setConditionalFormatRules(kept);
}

function quoteFormulaString_(value) {
  return '"' + String(value).replace(/"/g, '""') + '"';
}

/**
 * Move visible (not filtered-out) values on the ACTIVE worksheet.
 * Reads once, writes each column once.
 */
function moveVisibleRecords() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var sourceRange = sheet.getActiveRange();
  var ui = SpreadsheetApp.getUi();

  if (sheet.getName() === focusHelperName_()) {
    ui.alert("Switch to your data worksheet first.");
    return;
  }

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

  for (var i = 0; i < numRows; i++) {
    nextSource[i] = [sourceValues[i][0]];
    nextDest[i] = [destinationValues[i][0]];

    var row = startRow + i;

    if (filter && sheet.isRowHiddenByFilter(row)) {
      continue;
    }

    if (sheet.isRowHiddenByUser(row)) {
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

  destinationRange.setValues(nextDest);
  sourceRange.setValues(nextSource);
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
