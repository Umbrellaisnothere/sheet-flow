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
  assert.match(source, /getFormulas\(/)
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
  assert.match(userscript, /requestAnimationFrame|nextFrame/)
  assert.match(userscript, /@match\s+https:\/\/docs\.google\.com\/spreadsheets\/\*/)
  assert.match(userscript, /@include\s+https:\/\/docs\.google\.com\/spreadsheets\/\*/)
  assert.match(userscript, /@inject-into\s+auto/)
  assert.doesNotMatch(userscript, /@match\s+https:\/\/docs\.google\.com\/spreadsheets\/d\/\*/)
  assert.match(userscript, /pointerEvents/)
  assert.match(userscript, /localStorage/)
  assert.doesNotMatch(userscript, /innerHTML/)
})

test("published copies are in sync with their sources", () => {
  for (const [from, to] of copies) {
    assert.equal(read(to), read(from), `${to} is stale, run npm run sync`)
  }
})

test("the unpacked extension matches every Sheets URL in Chromium and Firefox", () => {
  const manifest = JSON.parse(read("extension/manifest.json"))
  assert.equal(manifest.manifest_version, 3)
  assert.equal(manifest.minimum_chrome_version, "109")
  assert.deepEqual(manifest.host_permissions, [
    "https://docs.google.com/spreadsheets/*",
  ])
  const script = manifest.content_scripts[0]
  assert.deepEqual(script.matches, ["https://docs.google.com/spreadsheets/*"])
  assert.equal(script.all_frames, true)
  assert.equal(script.run_at, "document_idle")
  assert.equal(manifest.browser_specific_settings.gecko.strict_min_version, "109.0")
})
