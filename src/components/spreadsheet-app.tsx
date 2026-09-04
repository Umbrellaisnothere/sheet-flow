"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import {
  Copy,
  Crosshair,
  Filter,
  RotateCcw,
  ArrowRightLeft,
  Check,
  Keyboard,
  Zap,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import {
  a1OfSelection,
  applyStatusFilter,
  columnLetterToNumber,
  columnNumberToLetter,
  moveVisibleRecords,
  normalizeSelection,
  previewMove,
  selectionColCount,
  type CellRef,
  type Selection,
  type StatusFilter,
} from "@/lib/sheet-engine"
import {
  COLUMN_HEADERS,
  LAST_DATA_ROW,
  SHEET_NAME,
  createSampleRows,
} from "@/lib/sample-data"
import { ScriptPanel } from "@/components/script-panel"
import { SheetGrid } from "@/components/sheet-grid"

export function SpreadsheetApp({ scriptSource }: { scriptSource: string }) {
  const [rows, setRows] = useState(createSampleRows)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("Ready")
  const displayRows = useMemo(
    () => applyStatusFilter(rows, statusFilter),
    [rows, statusFilter]
  )
  const [focusOn, setFocusOn] = useState(true)
  const [anchor, setAnchor] = useState<CellRef>({ row: 2, col: 4 })
  const [active, setActive] = useState<CellRef>({ row: LAST_DATA_ROW, col: 4 })
  const [moveOpen, setMoveOpen] = useState(false)
  const [destLetter, setDestLetter] = useState("E")
  const [destError, setDestError] = useState("")
  const [movedCells, setMovedCells] = useState<Set<string>>(new Set())
  const [lastMove, setLastMove] = useState<{
    moved: number
    skippedOccupied: number
  } | null>(null)
  const gridRef = useRef<HTMLDivElement>(null)

  const selection = useMemo(
    () => normalizeSelection(anchor, active),
    [anchor, active]
  )

  useEffect(() => {
    if (movedCells.size === 0) return
    const timer = window.setTimeout(() => setMovedCells(new Set()), 2400)
    return () => window.clearTimeout(timer)
  }, [movedCells])

  const setCaret = useCallback((next: CellRef, extend: boolean) => {
    const col = Math.min(Math.max(next.col, 1), COLUMN_HEADERS.length)
    const row = Math.min(Math.max(next.row, 1), LAST_DATA_ROW)
    const clamped = { row, col }
    setActive(clamped)
    if (!extend) setAnchor(clamped)
  }, [])

  const selectColumn = useCallback((col: number) => {
    setAnchor({ row: 2, col })
    setActive({ row: LAST_DATA_ROW, col })
  }, [])

  const handleReset = useCallback(() => {
    setRows(createSampleRows())
    setAnchor({ row: 2, col: 4 })
    setActive({ row: LAST_DATA_ROW, col: 4 })
    setMovedCells(new Set())
    setLastMove(null)
    setDestLetter("E")
    toast.success("Sheet restored to the sample pick list.")
  }, [])

  const openMove = useCallback(() => {
    if (selectionColCount(selection) !== 1) {
      toast.error("Select records from only one column.")
      return
    }
    const suggested = Math.min(selection.startCol + 1, COLUMN_HEADERS.length)
    setDestLetter(columnNumberToLetter(suggested))
    setDestError("")
    setMoveOpen(true)
  }, [selection])

  const destCol = columnLetterToNumber(destLetter)
  const preview = useMemo(() => {
    if (!destCol || destCol === selection.startCol) return null
    if (destCol > COLUMN_HEADERS.length) return null
    if (selectionColCount(selection) !== 1) return null
    return previewMove(displayRows, selection, destCol)
  }, [destCol, displayRows, selection])

  const runMove = useCallback(() => {
    if (selectionColCount(selection) !== 1) {
      setDestError("Please select records from only one column.")
      return
    }
    if (!destCol || destCol > COLUMN_HEADERS.length) {
      setDestError("Invalid column. Use a letter such as B, C, or E.")
      return
    }
    if (destCol === selection.startCol) {
      setDestError("Destination must be a different column than the source.")
      return
    }

    const result = moveVisibleRecords(displayRows, selection, destCol)
    setRows(result.rows)
    setMovedCells(new Set(result.movedCells))
    setLastMove({
      moved: result.moved,
      skippedOccupied: result.skippedOccupied,
    })
    setAnchor({ row: selection.startRow, col: destCol })
    setActive({ row: selection.endRow, col: destCol })
    setMoveOpen(false)
    toast.success(
      `Moved ${result.moved}. Skipped because destination already had text: ${result.skippedOccupied}.`
    )
  }, [destCol, displayRows, selection])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "m") {
        event.preventDefault()
        openMove()
        return
      }

      const step = { row: 0, col: 0 }
      if (event.key === "ArrowUp") step.row = -1
      else if (event.key === "ArrowDown") step.row = 1
      else if (event.key === "ArrowLeft") step.col = -1
      else if (event.key === "ArrowRight") step.col = 1
      else return

      event.preventDefault()
      setCaret(
        { row: active.row + step.row, col: active.col + step.col },
        event.shiftKey
      )
    }

    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [active, openMove, setCaret])

  const visibleCount = displayRows.filter((row) => !row.hiddenByFilter).length
  const hiddenCount = displayRows.length - visibleCount

  return (
    <div className="flex min-h-full flex-1 flex-col bg-[#f3f3f3]">
      <header className="border-b border-[#d0d0d0] bg-[#217346] text-white">
        <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-3 px-4 py-4 sm:px-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Crosshair className="size-5" />
              <p className="text-xs font-medium tracking-wide uppercase opacity-80">
                Google Sheets add-on
              </p>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Focus Cell
            </h1>
            <p className="max-w-xl text-sm text-white/85">
              Excel highlights the active row and column, then clears them when
              you move. Sheets does not. This restores that, without rewriting
              the whole sheet on every click, and moves filtered records without
              the leftover-selection bug.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a
              href="/instant"
              className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-white px-2.5 text-sm font-medium text-[#217346] hover:bg-white/90"
            >
              <Zap data-icon="inline-start" />
              Instant crosshair
            </a>
            <a
              href="/script"
              className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-white/40 px-2.5 text-sm font-medium text-white hover:bg-white/10"
            >
              <Copy data-icon="inline-start" />
              Get Apps Script
            </a>
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-4 px-4 py-4 sm:px-6 lg:py-6">
        <Toolbar
          focusOn={focusOn}
          onFocusChange={setFocusOn}
          statusFilter={statusFilter}
          onStatusFilter={setStatusFilter}
          onMove={openMove}
          onReset={handleReset}
          selection={selection}
          visibleCount={visibleCount}
          hiddenCount={hiddenCount}
        />

        <div className="grid flex-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <section className="min-w-0 rounded-lg border border-[#d0d0d0] bg-white shadow-sm">
            <div className="flex items-center justify-between gap-3 border-b border-[#d0d0d0] bg-[#f8f8f8] px-3 py-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate text-sm font-medium">{SHEET_NAME}</span>
                <Badge variant="secondary">{a1OfSelection(selection)}</Badge>
              </div>
              <p className="hidden text-xs text-muted-foreground sm:flex sm:items-center sm:gap-1">
                <Keyboard className="size-3.5" />
                Arrows move · Shift+arrows extend · Ctrl/⌘+M moves records
              </p>
            </div>
            <SheetGrid
              ref={gridRef}
              rows={displayRows}
              focusOn={focusOn}
              active={active}
              selection={selection}
              movedCells={movedCells}
              onSelectCell={(cell, extend) => setCaret(cell, extend)}
              onSelectColumn={selectColumn}
            />
            {visibleCount === 0 ? (
              <div className="border-t border-[#d0d0d0] px-4 py-8 text-center text-sm text-muted-foreground">
                No visible rows for this filter. Choose All statuses to show
                hidden records.
              </div>
            ) : null}
          </section>

          <aside className="space-y-4">
            <HowItWorks
              lastMove={lastMove}
              selection={selection}
              focusOn={focusOn}
            />
          </aside>
        </div>

        <ScriptPanel scriptSource={scriptSource} />
      </div>

      <Dialog open={moveOpen} onOpenChange={setMoveOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Move visible records</DialogTitle>
            <DialogDescription>
              Hidden (filtered) rows stay put. Destination cells that already
              have a value are never overwritten.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-lg border bg-muted/40 px-3 py-2">
                <p className="text-xs text-muted-foreground">Source</p>
                <p className="font-medium">
                  {columnNumberToLetter(selection.startCol)} (
                  {COLUMN_HEADERS[selection.startCol - 1]})
                </p>
              </div>
              <div className="rounded-lg border bg-muted/40 px-3 py-2">
                <p className="text-xs text-muted-foreground">Range</p>
                <p className="font-medium">{a1OfSelection(selection)}</p>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dest-col">Destination column</Label>
              <Input
                id="dest-col"
                value={destLetter}
                onChange={(event) => {
                  setDestLetter(event.target.value.toUpperCase())
                  setDestError("")
                }}
                placeholder="E"
                autoFocus
                aria-invalid={destError ? true : undefined}
              />
              {destError ? (
                <p className="text-xs text-destructive">{destError}</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Enter a letter such as E for Pack location.
                </p>
              )}
            </div>
            {preview ? (
              <Alert>
                <Check />
                <AlertTitle>Will write in one pass</AlertTitle>
                <AlertDescription>
                  Move {preview.moved}. Skip {preview.skippedOccupied} occupied
                  {preview.skippedEmpty ? `, ${preview.skippedEmpty} empty` : ""}
                  {preview.skippedHidden
                    ? `, ${preview.skippedHidden} hidden`
                    : ""}
                  . Selection then jumps to the destination column.
                </AlertDescription>
              </Alert>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoveOpen(false)}>
              Cancel
            </Button>
            <Button onClick={runMove}>Move records</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Toolbar({
  focusOn,
  onFocusChange,
  statusFilter,
  onStatusFilter,
  onMove,
  onReset,
  selection,
  visibleCount,
  hiddenCount,
}: {
  focusOn: boolean
  onFocusChange: (value: boolean) => void
  statusFilter: StatusFilter
  onStatusFilter: (value: StatusFilter) => void
  onMove: () => void
  onReset: () => void
  selection: Selection
  visibleCount: number
  hiddenCount: number
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-[#d0d0d0] bg-white p-3 shadow-sm sm:flex-row sm:flex-wrap sm:items-center">
      <Button
        type="button"
        variant={focusOn ? "default" : "outline"}
        onClick={() => onFocusChange(!focusOn)}
        className={cn(focusOn && "bg-[#217346] hover:bg-[#1b5c38]")}
        aria-pressed={focusOn}
      >
        <Crosshair data-icon="inline-start" />
        Focus Cell {focusOn ? "on" : "off"}
      </Button>

      <div className="flex items-center gap-2">
        <Filter className="size-4 text-muted-foreground" />
        <label className="sr-only" htmlFor="status-filter">
          Status filter
        </label>
        <select
          id="status-filter"
          value={statusFilter}
          onChange={(event) =>
            onStatusFilter((event.target.value as StatusFilter) || "all")
          }
          className="h-8 min-w-44 rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <option value="all">All statuses</option>
          <option value="Ready">Ready (filtered)</option>
          <option value="Hold">Hold</option>
          <option value="Shipped">Shipped</option>
        </select>
      </div>

      <Button type="button" onClick={onMove}>
        <ArrowRightLeft data-icon="inline-start" />
        Move visible records
      </Button>

      <Button type="button" variant="outline" onClick={onReset}>
        <RotateCcw data-icon="inline-start" />
        Reset sheet
      </Button>

      <div className="sm:ml-auto flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>
          {visibleCount} visible
          {hiddenCount ? ` · ${hiddenCount} hidden by filter` : ""}
        </span>
        <Separator orientation="vertical" className="hidden h-4 sm:block" />
        <span className="hidden sm:inline">
          Source {a1OfSelection(selection)}
        </span>
      </div>
    </div>
  )
}

function HowItWorks({
  lastMove,
  selection,
  focusOn,
}: {
  lastMove: { moved: number; skippedOccupied: number } | null
  selection: Selection
  focusOn: boolean
}) {
  return (
    <div className="rounded-lg border border-[#d0d0d0] bg-white p-4 shadow-sm">
      <h2 className="font-heading text-base font-medium">Why the Apps Script highlight cannot be instant</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Every click in Sheets has to travel to Google and back before a script
        can paint anything. That round trip is the delay. This playground, and
        the userscript you install, draw the crosshair in the browser instead.
        Paste Code.gs only for Move Visible Records.
      </p>
      <ol className="mt-3 space-y-2 text-sm">
        <li>
          <span className="font-medium">1. Click around the grid.</span>{" "}
          {focusOn
            ? "Only the active row and column stay highlighted."
            : "Turn Focus Cell on to see the Excel crosshair."}
        </li>
        <li>
          <span className="font-medium">2. Filter is already Ready.</span> Hold
          and Shipped rows are hidden, the same as a Sheets filter.
        </li>
        <li>
          <span className="font-medium">3. Selection starts on D2:D17</span>{" "}
          (Pick location). Move those visible values into E (Pack location).
        </li>
      </ol>
      {lastMove ? (
        <Alert className="mt-4">
          <Check />
          <AlertTitle>Last move</AlertTitle>
          <AlertDescription>
            Moved {lastMove.moved}. Skipped {lastMove.skippedOccupied} because
            the pack location already had text. Selection is now{" "}
            {a1OfSelection(selection)} — the emptied pick cells are no longer
            selected.
          </AlertDescription>
        </Alert>
      ) : (
        <p className="mt-4 text-xs text-muted-foreground">
          Occupied pack bins (Pine crate, Glass vial) are left alone. Empty pick
          cells are skipped. Hidden rows never move.
        </p>
      )}
    </div>
  )
}
