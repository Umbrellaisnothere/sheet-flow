import assert from "node:assert/strict"
import test from "node:test"
import vm from "node:vm"

import {
  codeSource,
  fakeSheet,
  foreignRule,
  gradientRule,
  loadScript,
  selectionOf,
} from "./script-harness.mjs"

test("Code.gs is syntactically valid", () => {
  assert.doesNotThrow(() => new vm.Script(codeSource))
})

test("every menu item points at a function that exists", () => {
  const referenced = [...codeSource.matchAll(/addItem\([^,]+,\s*"([^"]+)"/g)].map(
    (match) => match[1]
  )
  assert.ok(referenced.length >= 3, "expected the Excel Tools menu items")
  for (const name of referenced) {
    assert.match(
      codeSource,
      new RegExp("function " + name + "\\("),
      "menu points at missing function " + name
    )
  }
})

test("nothing clears a background, which would wipe the user's colours", () => {
  assert.doesNotMatch(codeSource, /setBackgrounds?\(\s*null/)
  assert.doesNotMatch(codeSource, /\.clearFormat\(/)
  assert.doesNotMatch(codeSource, /clearConditionalFormatRules\(/)
})

test("column letters round-trip in both directions", () => {
  const { columnLetterToNumber, columnNumberToLetter_ } = loadScript()
  for (const [letter, number] of [
    ["A", 1],
    ["Z", 26],
    ["AA", 27],
    ["AZ", 52],
    ["BA", 53],
    ["ZZ", 702],
    ["AAA", 703],
  ]) {
    assert.equal(columnLetterToNumber(letter), number, letter)
    assert.equal(columnNumberToLetter_(number), letter, String(number))
  }
  assert.equal(columnLetterToNumber("a1"), 0)
  assert.equal(columnLetterToNumber(""), 0)
})

test("blank treats whitespace as empty but keeps zero", () => {
  const { isBlank_ } = loadScript()
  assert.equal(isBlank_(""), true)
  assert.equal(isBlank_("   "), true)
  assert.equal(isBlank_(null), true)
  assert.equal(isBlank_(undefined), true)
  assert.equal(isBlank_(0), false)
  assert.equal(isBlank_("0"), false)
})

test("the focus rule lands on the whole row and column of one cell", () => {
  const script = loadScript()
  const sheet = fakeSheet()
  script.moveFocusRule_(sheet, selectionOf(5, 3))

  assert.equal(sheet.rules.length, 1)
  assert.deepEqual(
    Array.from(sheet.rules[0].getRanges(), (range) => range.a1),
    ["5:5", "C:C"]
  )
  assert.match(sheet.rules[0].getBooleanCondition().getCriteriaValues()[0], /focuscell/)
})

test("a multi-cell selection covers every row and column it spans", () => {
  const script = loadScript()
  const sheet = fakeSheet()
  script.moveFocusRule_(sheet, selectionOf(4, 2, 6, 3))

  assert.deepEqual(
    Array.from(sheet.rules[0].getRanges(), (range) => range.a1),
    ["4:9", "B:D"]
  )
})

test("clicking repeatedly never accumulates rules", () => {
  const script = loadScript()
  const sheet = fakeSheet()
  for (let row = 1; row <= 50; row++) {
    script.moveFocusRule_(sheet, selectionOf(row, 1))
  }
  // The old failure mode here is a rule per click, which would eventually
  // hit the per-sheet limit and grind the tab to a halt.
  assert.equal(sheet.rules.length, 1)
  assert.deepEqual(
    Array.from(sheet.rules[0].getRanges(), (range) => range.a1),
    ["50:50", "A:A"]
  )
})

test("the user's own rules survive, in order, and stay behind ours", () => {
  const script = loadScript()
  const mine = foreignRule('=$E2="Ready"')
  const other = foreignRule("=ISBLANK($A2)")
  const gradient = gradientRule()
  const sheet = fakeSheet({ rules: [mine, gradient, other] })

  script.moveFocusRule_(sheet, selectionOf(2, 2))
  script.moveFocusRule_(sheet, selectionOf(9, 4))

  assert.equal(sheet.rules.length, 4)
  assert.equal(sheet.rules[1], mine)
  assert.equal(sheet.rules[2], gradient)
  assert.equal(sheet.rules[3], other)
  assert.match(sheet.rules[0].getBooleanCondition().getCriteriaValues()[0], /focuscell/)
})

test("the click path touches the sheet twice and writes no values", () => {
  const script = loadScript()
  const sheet = fakeSheet()
  script.moveFocusRule_(sheet, selectionOf(7, 7))

  const api = sheet.calls.filter((call) => !call.startsWith("getRange"))
  assert.deepEqual(api, [
    "getConditionalFormatRules",
    "setConditionalFormatRules",
  ])
  assert.equal(
    sheet.calls.some((call) => call.startsWith("setValues")),
    false
  )
})

test("the highlight only runs on a sheet that was enabled", () => {
  const script = loadScript()
  assert.equal(script.isFocusOn_("1"), false)
  script.rememberFocusOn_("1", true)
  assert.equal(script.isFocusOn_("1"), true)
  assert.equal(script.isFocusOn_("2"), false)
  script.rememberFocusOn_("1", false)
  assert.equal(script.isFocusOn_("1"), false)
})

test("a selection change on a sheet that was never enabled does nothing", () => {
  const script = loadScript()
  const sheet = fakeSheet()
  script.onSelectionChange({
    range: { ...selectionOf(3, 3), getSheet: () => sheet },
  })
  assert.deepEqual(sheet.calls, [])
})

test("onSelectionChange survives a malformed event", () => {
  const script = loadScript()
  for (const event of [undefined, null, {}, { range: null }]) {
    assert.doesNotThrow(() => script.onSelectionChange(event))
  }
})

test("move asks about hidden rows only for rows that have data", () => {
  const script = loadScript()
  const source = { a1: "D2:D2000", row: 2 }
  const values = {}
  values["2,4,1999,1"] = Array.from({ length: 1999 }, (_, index) =>
    index < 3 ? [`SKU-${index}`] : [""]
  )
  const sheet = fakeSheet({
    lastRow: 2000,
    filtered: true,
    values,
    activeRange: {
      ...selectionOf(2, 4, 1999, 1),
      a1: "D2:D2000",
      getValues: () => values["2,4,1999,1"],
      setValues: () => {},
      offset: (r, c, rows, cols) => sheet.getRange(2 + r, 4 + c, rows, cols),
    },
  })
  sheet.values["2,5,1999,1"] = Array.from({ length: 1999 }, () => [""])

  script.SpreadsheetApp.getActiveSpreadsheet = () => ({
    getActiveSheet: () => sheet,
  })
  script.SpreadsheetApp.getUi = () => ({
    ButtonSet: { OK_CANCEL: "OK_CANCEL" },
    Button: { OK: "OK" },
    alert: () => {},
    prompt: () => ({
      getSelectedButton: () => "OK",
      getResponseText: () => "E",
    }),
  })

  script.moveVisibleRecords()

  const filterCalls = sheet.calls.filter((call) =>
    call.startsWith("isRowHiddenByFilter")
  )
  // One call per row would be ~2000 round trips and time the script out.
  assert.equal(filterCalls.length, 3)
  assert.ok(source)
})
