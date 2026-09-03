import assert from "node:assert/strict"
import test from "node:test"

import {
  applyStatusFilter,
  columnLetterToNumber,
  columnNumberToLetter,
  isBlank,
  moveVisibleRecords,
  normalizeSelection,
  type SheetRow,
} from "./sheet-engine.ts"

function row(rowNumber: number, values: SheetRow["values"], hidden = false): SheetRow {
  return { rowNumber, values, hiddenByFilter: hidden }
}

test("column letters round-trip", () => {
  assert.equal(columnLetterToNumber("E"), 5)
  assert.equal(columnLetterToNumber(" aa "), 27)
  assert.equal(columnLetterToNumber("E1"), 0)
  assert.equal(columnNumberToLetter(5), "E")
  assert.equal(columnNumberToLetter(27), "AA")
})

test("blank treats whitespace as empty and keeps zero", () => {
  assert.equal(isBlank(""), true)
  assert.equal(isBlank("  "), true)
  assert.equal(isBlank(0), false)
  assert.equal(isBlank("A-12"), false)
})

test("move visible records is batched, skips hidden and occupied", () => {
  const rows = [
    row(2, ["WH-1", "Ready", "A-12", ""], false),
    row(3, ["WH-2", "Hold", "B-03", ""], true),
    row(4, ["WH-3", "Ready", "A-14", "C-04"], false),
    row(5, ["WH-4", "Ready", "", ""], false),
    row(6, ["WH-5", "Ready", "G-04", ""], false),
  ]

  const result = moveVisibleRecords(
    rows,
    { startRow: 2, endRow: 6, startCol: 3, endCol: 3 },
    4
  )

  assert.equal(result.moved, 2)
  assert.equal(result.skippedOccupied, 1)
  assert.equal(result.skippedEmpty, 1)
  assert.equal(result.skippedHidden, 1)
  assert.equal(result.rows[0].values[3], "A-12")
  assert.equal(result.rows[0].values[2], "")
  assert.equal(result.rows[1].values[2], "B-03")
  assert.equal(result.rows[2].values[2], "A-14")
  assert.equal(result.rows[2].values[3], "C-04")
  assert.equal(result.rows[4].values[3], "G-04")
})

test("filter hides non-matching statuses without dropping rows", () => {
  const rows = [
    row(2, ["a", "x", "Ready"], false),
    row(3, ["b", "x", "Hold"], false),
  ]
  const filtered = applyStatusFilter(rows, "Ready")
  assert.equal(filtered[0].hiddenByFilter, false)
  assert.equal(filtered[1].hiddenByFilter, true)
  assert.equal(filtered.length, 2)
})

test("normalizeSelection orders the range", () => {
  const selection = normalizeSelection({ row: 10, col: 4 }, { row: 2, col: 4 })
  assert.deepEqual(selection, {
    startRow: 2,
    endRow: 10,
    startCol: 4,
    endCol: 4,
  })
})
