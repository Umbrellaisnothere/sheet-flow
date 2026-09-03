"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"

import { columnNumberToLetter } from "@/lib/sheet-engine"

const ROWS = 24
const COLS = 10

type Mode = "cell" | "range" | "rows" | "columns"

type Pick = {
  mode: Mode
  row: number
  col: number
  rowEnd: number
  colEnd: number
}

const START: Pick = { mode: "cell", row: 4, col: 3, rowEnd: 4, colEnd: 3 }

function label(pick: Pick) {
  const a = `${columnNumberToLetter(pick.col)}${pick.row}`
  if (pick.mode === "cell") return a
  if (pick.mode === "rows") return `rows ${pick.row}:${pick.rowEnd}`
  if (pick.mode === "columns") {
    return `columns ${columnNumberToLetter(pick.col)}:${columnNumberToLetter(pick.colEnd)}`
  }
  return `${a}:${columnNumberToLetter(pick.colEnd)}${pick.rowEnd}`
}

/**
 * A stand-in for the Google Sheets grid that exposes the same DOM contract the
 * userscript reads: a #waffle-grid-container, four .active-cell-border
 * elements around the current cell, and .selection rects for wider picks.
 * Whole-row and whole-column picks are drawn overflowing the container, which
 * is how Sheets marks them and how the script tells them apart.
 */
export function SheetsDomMock() {
  const [pick, setPick] = useState<Pick>(START)
  const gridRef = useRef<HTMLDivElement>(null)
  const cellsRef = useRef<Map<string, HTMLTableCellElement>>(new Map())
  const bordersRef = useRef<(HTMLDivElement | null)[]>([])
  const selectionRef = useRef<HTMLDivElement>(null)

  const setCellRef = useCallback(
    (key: string) => (node: HTMLTableCellElement | null) => {
      if (node) cellsRef.current.set(key, node)
      else cellsRef.current.delete(key)
    },
    []
  )

  useLayoutEffect(() => {
    const grid = gridRef.current
    const anchor = cellsRef.current.get(`${pick.row}-${pick.col}`)
    const end = cellsRef.current.get(`${pick.rowEnd}-${pick.colEnd}`)
    const selection = selectionRef.current
    if (!grid || !anchor || !end || !selection) return

    const base = grid.getBoundingClientRect()
    const a = anchor.getBoundingClientRect()
    const b = end.getBoundingClientRect()
    const top = a.top - base.top + grid.scrollTop
    const left = a.left - base.left + grid.scrollLeft
    const width = b.right - a.left
    const height = b.bottom - a.top

    const [borderTop, borderRight, borderBottom, borderLeft] =
      bordersRef.current
    if (borderTop) {
      Object.assign(borderTop.style, {
        top: `${top}px`,
        left: `${left}px`,
        width: `${a.width}px`,
        height: "2px",
      })
    }
    if (borderRight) {
      Object.assign(borderRight.style, {
        top: `${top}px`,
        left: `${left + a.width - 2}px`,
        width: "2px",
        height: `${a.height}px`,
      })
    }
    if (borderBottom) {
      Object.assign(borderBottom.style, {
        top: `${top + a.height - 2}px`,
        left: `${left}px`,
        width: `${a.width}px`,
        height: "2px",
      })
    }
    if (borderLeft) {
      Object.assign(borderLeft.style, {
        top: `${top}px`,
        left: `${left}px`,
        width: "2px",
        height: `${a.height}px`,
      })
    }

    if (pick.mode === "cell") {
      selection.style.display = "none"
      return
    }

    // Sheets draws a whole-row pick wider than the grid and a whole-column
    // pick taller than it. The script uses that to spot full-span picks.
    const overflow = 200
    Object.assign(selection.style, {
      display: "block",
      top: `${top}px`,
      left: pick.mode === "rows" ? "0px" : `${left}px`,
      width:
        pick.mode === "rows" ? `${base.width + overflow}px` : `${width}px`,
      height:
        pick.mode === "columns" ? `${base.height + overflow}px` : `${height}px`,
    })
  }, [pick])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const step =
        event.key === "ArrowDown"
          ? [1, 0]
          : event.key === "ArrowUp"
            ? [-1, 0]
            : event.key === "ArrowRight"
              ? [0, 1]
              : event.key === "ArrowLeft"
                ? [0, -1]
                : null
      if (!step) return
      event.preventDefault()
      setPick((current) => {
        const row = Math.min(Math.max(current.row + step[0], 1), ROWS)
        const col = Math.min(Math.max(current.col + step[1], 1), COLS)
        return { mode: "cell", row, col, rowEnd: row, colEnd: col }
      })
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const clickCell = (row: number, col: number, shift: boolean) => {
    setPick((current) =>
      shift
        ? {
            mode: "range",
            row: Math.min(current.row, row),
            col: Math.min(current.col, col),
            rowEnd: Math.max(current.row, row),
            colEnd: Math.max(current.col, col),
          }
        : { mode: "cell", row, col, rowEnd: row, colEnd: col }
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="rounded-md border bg-muted/40 px-2 py-1 font-mono text-xs">
          {label(pick)}
        </span>
        <span className="text-muted-foreground">
          Click a cell, shift-click for a block, or click a row or column
          header. Arrow keys move. Ctrl+Shift+H toggles the overlay.
        </span>
      </div>

      <div
        id="waffle-grid-container"
        ref={gridRef}
        className="relative max-h-[420px] overflow-auto border border-[#c0c0c0] bg-white"
      >
        <table className="border-collapse text-[13px]" cellPadding={0}>
          <thead>
            <tr>
              <th className="sticky top-0 left-0 z-30 h-7 w-11 border-r border-b border-[#c0c0c0] bg-[#f8f9fa]" />
              {Array.from({ length: COLS }, (_, index) => (
                <th
                  key={index}
                  onClick={() =>
                    setPick({
                      mode: "columns",
                      row: 1,
                      col: index + 1,
                      rowEnd: ROWS,
                      colEnd: index + 1,
                    })
                  }
                  className="sticky top-0 z-20 h-7 w-24 cursor-pointer border-r border-b border-[#c0c0c0] bg-[#f8f9fa] text-center text-[11px] font-medium text-[#5f6368] hover:bg-[#e8eaed]"
                >
                  {columnNumberToLetter(index + 1)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: ROWS }, (_, rowIndex) => {
              const row = rowIndex + 1
              return (
                <tr key={row}>
                  <th
                    onClick={() =>
                      setPick({
                        mode: "rows",
                        row,
                        col: 1,
                        rowEnd: row,
                        colEnd: COLS,
                      })
                    }
                    className="sticky left-0 z-20 h-7 w-11 cursor-pointer border-r border-b border-[#c0c0c0] bg-[#f8f9fa] text-center text-[11px] font-medium text-[#5f6368] hover:bg-[#e8eaed]"
                  >
                    {row}
                  </th>
                  {Array.from({ length: COLS }, (_, colIndex) => {
                    const col = colIndex + 1
                    return (
                      <td
                        key={col}
                        ref={setCellRef(`${row}-${col}`)}
                        onClick={(event) =>
                          clickCell(row, col, event.shiftKey)
                        }
                        className="h-7 w-24 cursor-cell border-r border-b border-[#e0e0e0] px-1.5 text-[#202124]"
                      >
                        {row === 1
                          ? ["SKU", "Item", "Qty", "Bin", "Status"][colIndex] ??
                            ""
                          : colIndex === 0
                            ? `SKU-${1000 + row}`
                            : colIndex === 2
                              ? row * 3
                              : ""}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>

        <div className="pointer-events-none absolute inset-0 z-10">
          {[0, 1, 2, 3].map((index) => (
            <div
              key={index}
              ref={(node) => {
                bordersRef.current[index] = node
              }}
              className="active-cell-border"
              style={{ position: "absolute", background: "#1a73e8" }}
            />
          ))}
          <div
            ref={selectionRef}
            className="selection"
            style={{
              position: "absolute",
              display: "none",
              border: "2px solid #1a73e8",
              background: "rgba(26,115,232,0.04)",
            }}
          />
        </div>
      </div>
    </div>
  )
}
