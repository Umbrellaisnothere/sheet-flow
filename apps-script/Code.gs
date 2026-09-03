/**
 * Excel Tools for Google Sheets
 *
 * Paste this entire file into the Apps Script project ATTACHED to your
 * spreadsheet (Extensions → Apps Script). Replace Code.gs in full.
 *
 * Speed
 *   Clicks only write three cells. Highlight rules are installed once
 *   (Enable) on this sheet’s used area — not 2,000×40 INDIRECT formulas
 *   on every selection. Move Visible Records reads twice and writes twice.
 *
 * No top-level var/const — simple triggers cannot see them
 *   (ReferenceError: FOCUS_SHEET_NAME is not defined).
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
  return "FocusCell_Row";
}

/**
 * Click handler. One sheet lookup + one 3-cell write. No formatting,
 * no inserts, no reads — that work belongs in Enable, not on every click.
 */
function onSelectionChange(e) {
  try {
    if (!e || !e.range) {
      return;
    }

    var sheet = e.range.getSheet();
    if (sheet.getName() === focusHelperName_()) {
      return;
    }

    var ss = e.source;
    if (!ss) {
      return;
    }

    var focus = ss.getSheetByName(focusHelperName_());
    if (!focus) {
      return;
    }

    focus
      .getRange(1, 1, 1, 3)
      .setValues([[e.range.getRow(), e.range.getColumn(), sheet.getName()]]);
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
    ui.alert(
      "Could not create the hidden helper tab. Try reloading the spreadsheet."
    );
    return;
  }

  ensureNamedRanges_(ss, focus);
  installFocusFormatting_(sheet);
  focus
    .getRange(1, 1, 1, 3)
    .setValues([
      [
        sheet.getActiveCell().getRow(),
        sheet.getActiveCell().getColumn(),
        sheet.getName(),
      ],
    ]);
  ss.setActiveSheet(sheet);

  ui.alert(
    "Focus Cell is on for \"" + sheet.getName() + "\"",
    "Clicks now only update three helper cells, so the highlight should feel instant.\n\n" +
      "Rules cover this sheet’s used area (not the whole grid). Run Enable again if you add a large block of new rows.",
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

function ensureNamedRanges_(ss, focus) {
  ss.setNamedRange("FocusCell_Row", focus.getRange("A1"));
  ss.setNamedRange("FocusCell_Col", focus.getRange("B1"));
  ss.setNamedRange("FocusCell_Sheet", focus.getRange("C1"));
}

function focusDataRange_(sheet) {
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  var rows = Math.min(Math.max(lastRow + 20, 30), 800, sheet.getMaxRows());
  var cols = Math.min(Math.max(lastCol + 1, 8), 26, sheet.getMaxColumns());
  return sheet.getRange(1, 1, rows, cols);
}

function installFocusFormatting_(sheet) {
  removeFocusFormatting_(sheet);

  var range = focusDataRange_(sheet);
  var quotedName = quoteFormulaString_(sheet.getName());
  var formula =
    "=AND(OR(ROW()=FocusCell_Row,COLUMN()=FocusCell_Col),FocusCell_Sheet=" +
    quotedName +
    ")";

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
 * Move visible values on the ACTIVE worksheet.
 * Two reads, two writes. No per-row setValue. No hidden-by-user scan.
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
