import assert from "node:assert/strict"
import test from "node:test"

import { safeNextPath } from "./safe-path.ts"

test("safe path: allows same-origin relative paths", () => {
  assert.equal(safeNextPath("/"), "/")
  assert.equal(safeNextPath("/instant"), "/instant")
  assert.equal(safeNextPath("/script?x=1"), "/script?x=1")
})

test("safe path: rejects absolute URLs", () => {
  assert.equal(safeNextPath("https://evil.example"), "/")
  assert.equal(safeNextPath("https://evil.example/phish"), "/")
  assert.equal(safeNextPath("http://evil.example"), "/")
})

test("safe path: rejects protocol-relative URLs", () => {
  assert.equal(safeNextPath("//evil.example"), "/")
  assert.equal(safeNextPath("//evil.example/x"), "/")
  assert.equal(safeNextPath("/\\evil.example"), "/")
})

test("safe path: rejects encoded and scheme attacks", () => {
  assert.equal(safeNextPath("/https://evil.example"), "/")
  assert.equal(safeNextPath("/foo://evil"), "/")
  assert.equal(safeNextPath("javascript:alert(1)"), "/")
})
