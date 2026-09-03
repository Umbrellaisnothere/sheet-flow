import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")
const source = fs.readFileSync(path.join(root, "apps-script", "Code.gs"), "utf8")

test("Apps Script has no top-level var/const/let (simple-trigger safe)", () => {
  for (const line of source.split("\n")) {
    if (/^(var|let|const)\s+/.test(line)) {
      assert.fail("top-level binding would break onSelectionChange: " + line)
    }
  }
  assert.equal(/var\s+FOCUS_SHEET_NAME/.test(source), false)
  assert.match(source, /function applyFocus_\(/)
  assert.match(source, /getRangeList/)
  assert.doesNotMatch(source, /INDIRECT\(/)
})
