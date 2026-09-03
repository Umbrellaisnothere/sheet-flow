export type CellValue = string | number
export type StatusFilter = "all" | "Ready" | "Hold" | "Shipped"

export interface SheetRow {
  rowNumber: number
  values: CellValue[]
  hiddenByFilter: boolean
}

export interface CellRef {
  row: number
  col: number
}

export interface Selection {
  startRow: number
  endRow: number
  startCol: number
  endCol: number
}

export interface MoveResult {
  rows: SheetRow[]
  moved: number
  skippedOccupied: number
  skippedEmpty: number
  skippedHidden: number
  movedCells: string[]
}

export const STATUS_COL = 3
export const HEADER_ROW = 1

export function isBlank(value: CellValue | null | undefined): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === "number") return false
  return String(value).trim() === ""
}

export function columnLetterToNumber(letter: string): number {
  const trimmed = letter.trim().toUpperCase()
  if (!/^[A-Z]+$/.test(trimmed)) return 0

  let column = 0
  for (let i = 0; i < trimmed.length; i++) {
    column = column * 26 + (trimmed.charCodeAt(i) - 64)
  }
  return column
}

export function columnNumberToLetter(column: number): string {
  if (column < 1) return ""
  let result = ""
  let n = column
  while (n > 0) {
    const rem = (n - 1) % 26
    result = String.fromCharCode(65 + rem) + result
    n = Math.floor((n - 1) / 26)
  }
  return result
}

export function normalizeSelection(anchor: CellRef, active: CellRef): Selection {
  return {
    startRow: Math.min(anchor.row, active.row),
    endRow: Math.max(anchor.row, active.row),
    startCol: Math.min(anchor.col, active.col),
    endCol: Math.max(anchor.col, active.col),
  }
}

export function selectionColCount(selection: Selection): number {
  return selection.endCol - selection.startCol + 1
}

export function isCellInSelection(row: number, col: number, selection: Selection): boolean {
  return (
    row >= selection.startRow &&
    row <= selection.endRow &&
    col >= selection.startCol &&
    col <= selection.endCol
  )
}

export function cellKey(row: number, col: number): string {
  return `${row}:${col}`
}

export function applyStatusFilter(rows: SheetRow[], filter: StatusFilter): SheetRow[] {
  return rows.map((row) => ({
    ...row,
    hiddenByFilter:
      filter !== "all" && String(row.values[STATUS_COL - 1]) !== filter,
  }))
}

export function previewMove(
  rows: SheetRow[],
  selection: Selection,
  destinationCol: number
): Omit<MoveResult, "rows" | "movedCells"> {
  return moveVisibleRecords(rows, selection, destinationCol, true)
}

export function moveVisibleRecords(
  rows: SheetRow[],
  selection: Selection,
  destinationCol: number,
  dryRun = false
): MoveResult {
  const sourceCol = selection.startCol
  const nextRows = dryRun ? rows : rows.map((row) => ({ ...row, values: [...row.values] }))

  let moved = 0
  let skippedOccupied = 0
  let skippedEmpty = 0
  let skippedHidden = 0
  const movedCells: string[] = []

  for (const row of nextRows) {
    if (row.rowNumber < selection.startRow || row.rowNumber > selection.endRow) {
      continue
    }

    if (row.hiddenByFilter) {
      skippedHidden++
      continue
    }

    const sourceValue = row.values[sourceCol - 1]
    const destValue = row.values[destinationCol - 1]

    if (isBlank(sourceValue)) {
      skippedEmpty++
      continue
    }

    if (!isBlank(destValue)) {
      skippedOccupied++
      continue
    }

    if (!dryRun) {
      row.values[destinationCol - 1] = sourceValue
      row.values[sourceCol - 1] = ""
      movedCells.push(cellKey(row.rowNumber, destinationCol))
    }
    moved++
  }

  return {
    rows: nextRows,
    moved,
    skippedOccupied,
    skippedEmpty,
    skippedHidden,
    movedCells,
  }
}

export function a1OfSelection(selection: Selection): string {
  const start =
    columnNumberToLetter(selection.startCol) + String(selection.startRow)
  const end = columnNumberToLetter(selection.endCol) + String(selection.endRow)
  return start === end ? start : `${start}:${end}`
}
