import assert from "node:assert/strict"
import test from "node:test"

import { parseApiColor, parseApiOpacity } from "./validate.ts"

test("validation: accepts #rgb and stores #rrggbb", () => {
  assert.equal(parseApiColor("#1a7"), "#11aa77")
  assert.equal(parseApiColor("1a7"), "#11aa77")
})

test("validation: accepts #rrggbb", () => {
  assert.equal(parseApiColor("#1a73e8"), "#1a73e8")
  assert.equal(parseApiColor("1A73E8"), "#1a73e8")
})

test("validation: rejects invalid colour", () => {
  assert.equal(parseApiColor(""), null)
  assert.equal(parseApiColor("#gggggg"), null)
  assert.equal(parseApiColor("#1234"), null)
  assert.equal(parseApiColor("#1234567"), null)
  assert.equal(parseApiColor("blue"), null)
})

test("validation: rejects CSS injection in colour", () => {
  assert.equal(parseApiColor("red; background: url(https://evil)"), null)
  assert.equal(parseApiColor("javascript:alert(1)"), null)
  assert.equal(parseApiColor("expression(alert(1))"), null)
  assert.equal(parseApiColor("#1a73e8);color:red"), null)
  assert.equal(parseApiColor("url(https://evil.example)"), null)
})

test("validation: rejects opacity below 0.05", () => {
  assert.equal(parseApiOpacity("0.04"), null)
  assert.equal(parseApiOpacity(0), null)
  assert.equal(parseApiOpacity("0.049"), null)
})

test("validation: rejects opacity above 0.50", () => {
  assert.equal(parseApiOpacity("0.51"), null)
  assert.equal(parseApiOpacity(0.9), null)
  assert.equal(parseApiOpacity("1"), null)
})

test("validation: rejects malformed opacity", () => {
  assert.equal(parseApiOpacity(""), null)
  assert.equal(parseApiOpacity("opacity"), null)
  assert.equal(parseApiOpacity("0.1;alert(1)"), null)
  assert.equal(parseApiOpacity("NaN"), null)
  assert.equal(parseApiOpacity(Infinity), null)
})

test("validation: canonical opacity strings", () => {
  assert.equal(parseApiOpacity("0.05"), "0.05")
  assert.equal(parseApiOpacity("0.1"), "0.1")
  assert.equal(parseApiOpacity("0.25"), "0.25")
  assert.equal(parseApiOpacity("0.5"), "0.5")
  assert.equal(parseApiOpacity("0.50"), "0.5")
})
