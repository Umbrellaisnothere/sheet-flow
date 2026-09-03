import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")
const source = fs.readFileSync(path.join(root, "apps-script", "Code.gs"), "utf8")

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
  assert.equal(/var\s+FOCUS_SHEET_NAME/.test(source), false)
  assert.match(source, /function onSelectionChange\(/)
  assert.doesNotMatch(source, /INDIRECT\(/)
  assert.doesNotMatch(source, /getRangeByName\(/)
  assert.doesNotMatch(source, /removeNamedRange\(/)
})

test("click path does not write values or rebuild conditional formatting", () => {
  const body = functionBody("onSelectionChange")
  assert.doesNotMatch(body, /setValues/)
  assert.doesNotMatch(body, /getLastRow/)
  assert.doesNotMatch(body, /getLastColumn/)
  assert.doesNotMatch(body, /getConditionalFormatRules/)
  assert.doesNotMatch(body, /getNamedRanges/)
  assert.doesNotMatch(body, /newConditionalFormatRule/)
  assert.match(body, /paintWindow_/)
})

test("paint window restores a small color band instead of the whole row", () => {
  const body = functionBody("paintWindow_")
  assert.match(body, /getBackgrounds/)
  assert.match(body, /setBackground/)
  assert.doesNotMatch(body, /setValues/)
  assert.doesNotMatch(body, /getLastRow/)
  assert.doesNotMatch(body, /getLastColumn/)
})
