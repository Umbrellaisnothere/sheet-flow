"use client"

import { forwardRef, useCallback, useRef, useState } from "react"

import { cn } from "@/lib/utils"
import {
  isCellInSelection,
  type CellRef,
  type Selection,
  type SheetRow,
} from "@/lib/sheet-engine"
import { COLUMN_HEADERS, COLUMN_WIDTHS } from "@/lib/sample-data"

interface SheetGridProps {
  rows: SheetRow[]
  focusOn: boolean
  active: CellRef
  selection: Selection
  movedCells: Set<string>
  onSelectCell: (cell: CellRef, extend: boolean) => void
  onSelectColumn: (col: number) => void
}

export const SheetGrid = forwardRef<HTMLDivElement, SheetGridProps>(
  function SheetGrid(
    {
      rows,
      focusOn,
      active,
      selection,
      movedCells,
      onSelectCell,
      onSelectColumn,
    },
    ref
  ) {
    const dragging = useRef(false)
    const [isDragging, setIsDragging] = useState(false)

    const handlePointerDown = useCallback(
      (event: React.PointerEvent, cell: CellRef) => {
        event.preventDefault()
        dragging.current = true
        setIsDragging(true)
        onSelectCell(cell, event.shiftKey)
        ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
      },
      [onSelectCell]
    )

    const handlePointerUp = useCallback(() => {
      dragging.current = false
      setIsDragging(false)
    }, [])

    const visibleRows = rows.filter((row) => !row.hiddenByFilter)
    const tableWidth =
      48 + COLUMN_WIDTHS.reduce((sum, width) => sum + width, 0)

    return (
      <div
        ref={ref}
        tabIndex={0}
        className={cn(
          "overflow-auto outline-none",
          isDragging && "select-none"
        )}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        aria-label="Pack list spreadsheet"
      >
        <table
          className="border-separate border-spacing-0 text-[13px]"
          style={{ width: tableWidth, minWidth: "100%" }}
        >
          <thead>
            <tr>
              <th
                className="sticky top-0 z-20 h-8 w-12 border-b border-r border-[#d0d7de] bg-[#f3f3f3] text-center text-[11px] font-semibold text-[#5f6368]"
              >
                {/* corner */}
              </th>
              {COLUMN_HEADERS.map((header, index) => {
                const col = index + 1
                const focused = focusOn && active.col === col
                return (
                  <th
                    key={header}
                    style={{ width: COLUMN_WIDTHS[index], minWidth: COLUMN_WIDTHS[index] }}
                    className={cn(
                      "sticky top-0 z-20 h-8 border-b border-r border-[#d0d7de] bg-[#f3f3f3] px-2 text-center text-[11px] font-semibold text-[#5f6368]",
                      focused && "bg-[#c6efce] text-[#0d652d]"
                    )}
                  >
                    <button
                      type="button"
                      className="w-full"
                      onClick={() => onSelectColumn(col)}
                    >
                      {String.fromCharCode(64 + col)}
                    </button>
                  </th>
                )
              })}
            </tr>
            <tr>
              <th className="h-8 w-12 border-b border-r border-[#d0d7de] bg-[#f3f3f3] text-center text-[11px] font-medium text-[#5f6368]">
                1
              </th>
              {COLUMN_HEADERS.map((header, index) => {
                const col = index + 1
                const focused = focusOn && (active.row === 1 || active.col === col)
                const selected = isCellInSelection(1, col, selection)
                const isActive = active.row === 1 && active.col === col
                return (
                  <th
                    key={header}
                    onPointerDown={(event) =>
                      handlePointerDown(event, { row: 1, col })
                    }
                    onPointerEnter={() => {
                      if (dragging.current) onSelectCell({ row: 1, col }, true)
                    }}
                    className={cn(
                      "h-8 border-b border-r border-[#d0d7de] bg-[#f8f9fa] px-2 text-left text-[12px] font-semibold text-[#3c4043]",
                      focused && !isActive && "bg-[#fff3cd]",
                      selected && !isActive && "bg-[#c6efce]",
                      isActive && "relative z-10 bg-white ring-2 ring-inset ring-[#217346]"
                    )}
                  >
                    {header}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => {
              const rowFocused = focusOn && active.row === row.rowNumber
              return (
                <tr key={row.rowNumber}>
                  <th
                    className={cn(
                      "h-8 w-12 border-b border-r border-[#d0d7de] bg-[#f3f3f3] text-center text-[11px] font-medium text-[#5f6368]",
                      rowFocused && "bg-[#fff3cd] text-[#7a5b00]"
                    )}
                  >
                    {row.rowNumber}
                  </th>
                  {row.values.map((value, index) => {
                    const col = index + 1
                    const colFocused = focusOn && active.col === col
                    const selected = isCellInSelection(
                      row.rowNumber,
                      col,
                      selection
                    )
                    const isActive =
                      active.row === row.rowNumber && active.col === col
                    const moved = movedCells.has(`${row.rowNumber}:${col}`)
                    const status = col === 3 ? String(value) : ""

                    return (
                      <td
                        key={col}
                        onPointerDown={(event) =>
                          handlePointerDown(event, {
                            row: row.rowNumber,
                            col,
                          })
                        }
                        onPointerEnter={() => {
                          if (dragging.current) {
                            onSelectCell({ row: row.rowNumber, col }, true)
                          }
                        }}
                        className={cn(
                          "h-8 max-w-0 border-b border-r border-[#d0d7de] bg-white px-2 align-middle",
                          rowFocused && "bg-[#fff3cd]",
                          colFocused && "bg-[#e8f5ee]",
                          rowFocused && colFocused && "bg-[#ffe8a3]",
                          selected &&
                            !isActive &&
                            "bg-[#c6efce]",
                          moved && "bg-[#b7e1cd] transition-colors duration-700",
                          isActive &&
                            "relative z-10 bg-white ring-2 ring-inset ring-[#217346]"
                        )}
                      >
                        <span
                          className={cn(
                            "block truncate",
                            status === "Ready" && "font-medium text-[#0d652d]",
                            status === "Hold" && "font-medium text-[#b06000]",
                            status === "Shipped" && "text-[#5f6368]"
                          )}
                        >
                          {value === "" ? "" : String(value)}
                        </span>
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    )
  }
)
