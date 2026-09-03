/**
 * Excel Tools for Google Sheets
 *
 * 1. Focus Cell — Excel-style row + column highlight that follows the
 *    active cell. Previous highlights cannot stick, because this script
 *    never paints cell backgrounds. It writes the current row/column to a
 *    hidden sheet; conditional formatting follows that cell.
 *
 * 2. Move Visible Records — moves filtered-in values from one column to
 *    another without overwriting destination cells. Writes are batched
 *    (two setValues calls) instead of one write per row.
 *
 * Install
 *   Extensions → Apps Script → replace Code.gs with this file → Save.
 *   Reload the spreadsheet. Use the "Excel Tools" menu.
 *   First run: Excel Tools → Enable Focus Cell (authorize when prompted).
 */

var FOCUS_SHEET_NAME = "_FocusCell";
var FOCUS_RULE_MARKER = "_FocusCell!";
var FOCUS_ROW_COLOR = "#FFF3CD";
var FOCUS_COL_COLOR = "#E8F5EE";
var FOCUS_MAX_ROWS = 2000;
var FOCUS_MAX_COLS = 40;

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Excel Tools")
    .addItem("Enable Focus Cell", "enableFocusCell")
    .addItem("Disable Focus Cell", "disableFocusCell")
    .addSeparator()
    .addItem("Move Visible Records…", "moveVisibleRecords")
    .addToUi();
}

/**
 * Simple trigger. Fires when the user clicks or arrows to a new cell.
 * One 3-cell write. Conditional formatting on the data sheet updates
 * itself, so the previous row/column highlight disappears.
 */
function onSelectionChange(e) {
  if (!e || !e.range) {
    return;
  }

  var sheet = e.range.getSheet();
  if (sheet.getName() === FOCUS_SHEET_NAME) {
    return;
  }

  var focus = e.source.getSheetByName(FOCUS_SHEET_NAME);
  if (!focus) {
    return;
  }

  var row = e.range.getRow();
  var col = e.range.getColumn();
  var name = sheet.getName();
  var prev = focus.getRange(1, 1, 1, 3).getValues()[0];

  if (prev[0] === row && prev[1] === col && prev[2] === name) {
    return;
  }

  focus.getRange(1, 1, 1, 3).setValues([[row, col, name]]);
}

function enableFocusCell() {
  var ss = SpreadsheetApp.getActive();
  var focus = ss.getSheetByName(FOCUS_SHEET_NAME);

  if (!focus) {
    focus = ss.insertSheet(FOCUS_SHEET_NAME);
    focus
      .getRange("A1:C1")
      .setValues([[1, 1, ss.getActiveSheet().getName()]]);
    focus.getRange("A2:C2").setValues([["row", "column", "sheet"]]);
    focus.hideSheet();
  }

  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].getName() === FOCUS_SHEET_NAME) {
      continue;
    }
    installFocusFormatting_(sheets[i]);
  }

  SpreadsheetApp.getUi().alert(
    "Focus Cell is on",
    "Click any cell. The current row and column highlight like Excel’s Focus Cell.\n\n" +
      "The previous highlight clears on its own. This script does not set background " +
      "colors on your data, so leftover fills cannot stick and your existing colors stay intact.",
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

function disableFocusCell() {
  var ss = SpreadsheetApp.getActive();
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].getName() === FOCUS_SHEET_NAME) {
      continue;
    }
    removeFocusFormatting_(sheets[i]);
  }

  var focus = ss.getSheetByName(FOCUS_SHEET_NAME);
  if (focus) {
    ss.deleteSheet(focus);
  }

  SpreadsheetApp.getUi().alert("Focus Cell is off.");
}

function installFocusFormatting_(sheet) {
  removeFocusFormatting_(sheet);

  var rows = Math.min(sheet.getMaxRows(), FOCUS_MAX_ROWS);
  var cols = Math.min(sheet.getMaxColumns(), FOCUS_MAX_COLS);
  var range = sheet.getRange(1, 1, rows, cols);
  var quotedName = quoteFormulaString_(sheet.getName());
  var rowRef = 'INDIRECT("' + FOCUS_SHEET_NAME + '!$A$1")';
  var colRef = 'INDIRECT("' + FOCUS_SHEET_NAME + '!$B$1")';
  var sheetRef = 'INDIRECT("' + FOCUS_SHEET_NAME + '!$C$1")';

  var rowFormula =
    "=AND(ROW()=" + rowRef + "," + sheetRef + "=" + quotedName + ")";
  var colFormula =
    "=AND(COLUMN()=" + colRef + "," + sheetRef + "=" + quotedName + ")";

  var colRule = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied(colFormula)
    .setBackground(FOCUS_COL_COLOR)
    .setRanges([range])
    .build();

  var rowRule = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied(rowFormula)
    .setBackground(FOCUS_ROW_COLOR)
    .setRanges([range])
    .build();

  var rules = sheet.getConditionalFormatRules();
  rules.push(colRule, rowRule);
  sheet.setConditionalFormatRules(rules);
}

function removeFocusFormatting_(sheet) {
  var rules = sheet.getConditionalFormatRules();
  var kept = [];

  for (var i = 0; i < rules.length; i++) {
    var condition = rules[i].getBooleanCondition();
    if (!condition) {
      kept.push(rules[i]);
      continue;
    }
    var values = condition.getCriteriaValues();
    var formula = values && values.length ? String(values[0]) : "";
    if (formula.indexOf(FOCUS_RULE_MARKER) === -1) {
      kept.push(rules[i]);
    }
  }

  sheet.setConditionalFormatRules(kept);
}

function quoteFormulaString_(value) {
  return '"' + String(value).replace(/"/g, '""') + '"';
}

/**
 * Move visible (not filtered-out) values from the selected column
 * into a destination column. Occupied destination cells are skipped.
 *
 * Slow version called getRange().setValue() inside the loop — hundreds
 * of spreadsheet writes. This version reads once, mutates arrays, and
 * writes each column once.
 */
function moveVisibleRecords() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getActiveSheet();
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
    "Enter the destination column (e.g. B, C, D):",
    ui.ButtonSet.OK_CANCEL
  );

  if (response.getSelectedButton() !== ui.Button.OK) {
    return;
  }

  var destinationLetter = response.getResponseText().trim().toUpperCase();
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

  // Selection follows the moved data instead of staying on the emptied source.
  sheet.setActiveRange(destinationRange);

  ui.alert(
    "Finished!\n\n" +
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
