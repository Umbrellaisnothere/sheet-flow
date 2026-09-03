import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { copies } from "../scripts/sync-assets.mjs"

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8")
const source = read("apps-script/Code.gs")
const userscript = read("userscript/sheets-focus-cell.user.js")

function functionBody(name) {
  const start = source.indexOf("function " + name + "(")
  assert.notEqual(start, -1, "missing " + name)
  const next = source.indexOf("\nfunction ", start + 1)
  return source.slice(start, next === -1 ? source.length : next)
}

test("Apps Script has no top-level var/const/let (simple-trigger safe)", () => {
  for (const line of source.split("\n")) {
    if (/^(var|let|const)\s+/.test(line)) {
      assert.fail("top-level binding would break onSelectionChange: " + line)
    }
  }
  assert.match(source, /function onSelectionChange\(/)
  assert.doesNotMatch(source, /INDIRECT\(/)
  assert.doesNotMatch(source, /getRangeByName\(/)
})

test("click path only moves a rule: no value writes, no colour reads", () => {
  for (const name of ["onSelectionChange", "moveFocusRule_"]) {
    const body = functionBody(name)
    assert.doesNotMatch(body, /setValues?\(/, name)
    assert.doesNotMatch(body, /getBackgrounds?\(/, name)
    assert.doesNotMatch(body, /setBackgrounds\(/, name)
    assert.doesNotMatch(body, /getLastRow|getLastColumn|getMaxRows|getMaxColumns/, name)
  }
  assert.match(functionBody("onSelectionChange"), /moveFocusRule_/)
})

test("focus rule uses a constant formula so nothing recalculates", () => {
  const formula = functionBody("focusFormula_")
  assert.doesNotMatch(formula, /ROW\(\)|COLUMN\(\)/)
  assert.match(formula, /focuscell/)
  assert.match(functionBody("rulesWithoutFocus_"), /focuscell/)
})

test("userscript never writes to the spreadsheet", () => {
  assert.doesNotMatch(userscript, /SpreadsheetApp|google\.script\.run|fetch\(/)
  assert.match(userscript, /waffle-grid-container/)
  assert.match(userscript, /active-cell-border/)
  assert.match(userscript, /requestAnimationFrame/)
  assert.match(userscript, /pointerEvents/)
})

test("published copies are in sync with their sources", () => {
  for (const [from, to] of copies) {
    assert.equal(read(to), read(from), `${to} is stale, run npm run sync`)
  }
})
